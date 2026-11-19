package main

import (
	"errors"
	"io/fs"
	"log"
	"net/http"
	"path"
	"regexp"
	"sort"
	"strconv"
	"time"
)

// Trimming a world deletes its region files far from the middle, so a map a
// plugin, a pregenerator or someone flying generated out to a million blocks
// stops eating the server's disk. A Java world keeps its chunks in region
// files of 32×32 chunks (512×512 blocks), r.X.Z.mca in region/, with the
// entities and points of interest of the same area in entities/ and poi/ under
// the same name, and a chunk too big for its region in c.X.Z.mcc beside it.
// Deleted areas are simply generated again when someone goes there. Only a
// stopped server is trimmed, and it can't start until the trim is over.

const (
	trimMinRadius = 1000       // blocks; a smaller cut would take players' bases near spawn too
	trimMaxRadius = 30_000_000 // Minecraft's own world limit
	regionBlocks  = 512
)

var (
	errTrimRunning = errors.New("the server is running")
	errTrimming    = errors.New("the server's world is being trimmed")
	regionFile     = regexp.MustCompile(`^r\.(-?\d+)\.(-?\d+)\.mca$`)
	bigChunkFile   = regexp.MustCompile(`^c\.(-?\d+)\.(-?\d+)\.mcc$`)
	// The radii the panel offers, with how much each would free.
	trimRadii = []int{1000, 2000, 5000, 10000, 20000, 50000, 100000}
)

// trimFile is one region (or oversized chunk) file of a world.
type trimFile struct {
	path      string
	size      int64
	rx, rz    int // the region it belongs to
	dimension string
}

// trimArea is a square of blocks around (x, z) reaching radius blocks each way.
type trimArea struct{ x, z, radius int }

// keeps reports whether any block of region (rx, rz) is inside the area.
func (t trimArea) keeps(rx, rz int) bool {
	minX, minZ := rx*regionBlocks, rz*regionBlocks
	maxX, maxZ := minX+regionBlocks-1, minZ+regionBlocks-1
	return maxX >= t.x-t.radius && minX <= t.x+t.radius && maxZ >= t.z-t.radius && minZ <= t.z+t.radius
}

// reach is how many blocks from (x, z) the region's farthest block lies, along x or z.
func (t trimArea) reach(rx, rz int) int {
	minX, minZ := rx*regionBlocks, rz*regionBlocks
	maxX, maxZ := minX+regionBlocks-1, minZ+regionBlocks-1
	return max(abs(minX-t.x), abs(maxX-t.x), abs(minZ-t.z), abs(maxZ-t.z))
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// floorDiv divides rounding down, as Minecraft maps chunks to regions.
func floorDiv(a, b int) int {
	q := a / b
	if (a%b != 0) && ((a < 0) != (b < 0)) {
		q--
	}
	return q
}

// dimensionOf names the dimension whose region folder is dir: Paper keeps the
// nether as world_nether/DIM-1, vanilla as world/DIM-1, and 26.1+ as
// world/dimensions/minecraft/the_nether. Anything else (a data pack's own
// dimension) is named by its folder.
func dimensionOf(world, dir string) string {
	switch {
	case dir == world, dir == world+"/dimensions/minecraft/overworld":
		return "overworld"
	case path.Base(dir) == "DIM-1", path.Base(dir) == "the_nether":
		return "nether"
	case path.Base(dir) == "DIM1", path.Base(dir) == "the_end":
		return "end"
	}
	return dir
}

// trimFiles lists the region files of the Java world name, with its nether and end.
func (s *serverFiles) trimFiles(name string) []trimFile {
	var list []trimFile
	for _, part := range worldParts(false, name) {
		fs.WalkDir(s.root.FS(), part, func(p string, d fs.DirEntry, err error) error {
			if err != nil || !d.Type().IsRegular() {
				return nil
			}
			dir := path.Dir(p)
			switch path.Base(dir) {
			case "region", "entities", "poi":
			default:
				return nil
			}
			f := trimFile{path: p, dimension: dimensionOf(name, path.Dir(dir))}
			if m := regionFile.FindStringSubmatch(d.Name()); m != nil {
				f.rx, _ = strconv.Atoi(m[1])
				f.rz, _ = strconv.Atoi(m[2])
			} else if m := bigChunkFile.FindStringSubmatch(d.Name()); m != nil {
				cx, _ := strconv.Atoi(m[1])
				cz, _ := strconv.Atoi(m[2])
				f.rx, f.rz = floorDiv(cx, 32), floorDiv(cz, 32)
			} else {
				return nil
			}
			if fi, err := d.Info(); err == nil {
				f.size = fi.Size()
			}
			list = append(list, f)
			return nil
		})
	}
	return list
}

type trimCut struct {
	Radius int   `json:"radius"`
	Files  int   `json:"files"`
	Bytes  int64 `json:"bytes"`
}

type trimDimension struct {
	Dimension   string `json:"dimension"`
	Files       int    `json:"files"`
	Bytes       int64  `json:"bytes"`
	Reach       int    `json:"reach"`       // blocks from the middle to the farthest generated area
	RemoveFiles int    `json:"removeFiles"` // with the radius asked for
	RemoveBytes int64  `json:"removeBytes"`
}

type trimPreview struct {
	Files      int             `json:"files"`
	Bytes      int64           `json:"bytes"`
	Reach      int             `json:"reach"`
	Dimensions []trimDimension `json:"dimensions"`
	Cuts       []trimCut       `json:"cuts"` // what each of trimRadii would free
	Cut        *trimCut        `json:"cut,omitempty"`
}

func previewTrim(files []trimFile, area trimArea, asked bool) trimPreview {
	p := trimPreview{Dimensions: []trimDimension{}}
	dims := map[string]*trimDimension{}
	var order []string
	for _, f := range files {
		d := dims[f.dimension]
		if d == nil {
			d = &trimDimension{Dimension: f.dimension}
			dims[f.dimension] = d
			order = append(order, f.dimension)
		}
		d.Files++
		d.Bytes += f.size
		d.Reach = max(d.Reach, area.reach(f.rx, f.rz))
		if asked && !area.keeps(f.rx, f.rz) {
			d.RemoveFiles++
			d.RemoveBytes += f.size
		}
		p.Files++
		p.Bytes += f.size
		p.Reach = max(p.Reach, d.Reach)
	}
	rank := map[string]int{"overworld": 0, "nether": 1, "end": 2}
	sort.SliceStable(order, func(i, j int) bool {
		ri, ok := rank[order[i]]
		if !ok {
			ri = 3
		}
		rj, ok := rank[order[j]]
		if !ok {
			rj = 3
		}
		return ri < rj
	})
	for _, name := range order {
		p.Dimensions = append(p.Dimensions, *dims[name])
	}
	for _, r := range trimRadii {
		cut := trimCut{Radius: r}
		a := trimArea{area.x, area.z, r}
		for _, f := range files {
			if !a.keeps(f.rx, f.rz) {
				cut.Files++
				cut.Bytes += f.size
			}
		}
		p.Cuts = append(p.Cuts, cut)
	}
	if asked {
		cut := trimCut{Radius: area.radius}
		for _, d := range p.Dimensions {
			cut.Files += d.RemoveFiles
			cut.Bytes += d.RemoveBytes
		}
		p.Cut = &cut
	}
	return p
}

// trimRequest reads the Java world's name and ?x=&z=&radius= (radius optional
// for a preview).
func trimRequest(r *http.Request, needRadius bool) (name string, area trimArea, asked bool, err error) {
	bedrock, name, err := worldRequest(r)
	if err != nil {
		return "", area, false, err
	}
	if bedrock {
		return "", area, false, errBadPath // Bedrock worlds keep chunks in a database, not region files
	}
	q := r.URL.Query()
	num := func(key string, lo, hi int) (int, error) {
		v := q.Get(key)
		if v == "" {
			return 0, nil
		}
		n, err := strconv.Atoi(v)
		if err != nil || n < lo || n > hi {
			return 0, errBadPath
		}
		return n, nil
	}
	if area.x, err = num("x", -trimMaxRadius, trimMaxRadius); err != nil {
		return
	}
	if area.z, err = num("z", -trimMaxRadius, trimMaxRadius); err != nil {
		return
	}
	if q.Get("radius") == "" {
		if needRadius {
			err = errBadPath
		}
		return
	}
	if area.radius, err = num("radius", trimMinRadius, trimMaxRadius); err != nil {
		return
	}
	return name, area, true, nil
}

func (a *agent) worldTrimPreview(w http.ResponseWriter, r *http.Request) {
	_, s, ok := a.filesFrom(w, r)
	if !ok {
		return
	}
	defer s.Close()
	name, area, asked, err := trimRequest(r, false)
	if err != nil {
		writeFileError(w, err)
		return
	}
	if !s.isWorld(name) {
		writeFileError(w, fs.ErrNotExist)
		return
	}
	writeJSON(w, http.StatusOK, previewTrim(s.trimFiles(name), area, asked))
}

// worldTrim deletes the world's region files outside the area.
func (a *agent) worldTrim(w http.ResponseWriter, r *http.Request) {
	id, s, ok := a.filesFrom(w, r)
	if !ok {
		return
	}
	defer s.Close()
	name, area, _, err := trimRequest(r, true)
	if err != nil {
		writeFileError(w, err)
		return
	}
	if !s.isWorld(name) {
		writeFileError(w, fs.ErrNotExist)
		return
	}
	// Under startMu, so a start already under way finishes before the check
	// below, and none can begin until the trim is over.
	a.startMu.Lock()
	a.trimming.Store(id, true)
	a.startMu.Unlock()
	defer a.trimming.Delete(id)
	if info, err := a.docker.InspectContainer(r.Context(), containerName(id)); err == nil && (info.State.Status == "running" || info.State.Status == "restarting") {
		writeError(w, http.StatusConflict, "running")
		return
	}
	unlock, ok := a.tryLockServer(id) // not mid-backup or mid-restore
	if !ok {
		writeFileError(w, errBusy)
		return
	}
	defer unlock()

	start := time.Now()
	var removed int
	var freed int64
	for _, f := range s.trimFiles(name) {
		if area.keeps(f.rx, f.rz) {
			continue
		}
		if err := s.root.Remove(f.path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			log.Printf("trim %s: %v", id, err)
			continue
		}
		removed++
		freed += f.size
	}
	log.Printf("trim %s/%s: %d files, %d MB outside %d blocks of %d,%d (%s)", id, name, removed, freed>>20, area.radius, area.x, area.z, time.Since(start).Round(time.Second))
	a.remeasureDisk(id) // a server stopped for its disk may start again
	writeJSON(w, http.StatusOK, map[string]any{"files": removed, "bytes": freed})
}

type usageEntry struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Size int64  `json:"size"`
}

// filesUsage lists what is at the top of the server's files, biggest first,
// so the owner sees what takes their disk.
func (a *agent) filesUsage(w http.ResponseWriter, r *http.Request) {
	_, s, ok := a.filesFrom(w, r)
	if !ok {
		return
	}
	defer s.Close()
	f, err := s.root.Open(".")
	if err != nil {
		writeFileError(w, err)
		return
	}
	names, err := f.Readdirnames(-1)
	f.Close()
	if err != nil {
		writeFileError(w, err)
		return
	}
	entries := []usageEntry{}
	var total int64
	for _, n := range names {
		fi, err := s.root.Lstat(n)
		if err != nil {
			continue
		}
		e := usageEntry{Name: n, Type: "file"}
		switch {
		case fi.IsDir():
			e.Type, e.Size = "dir", s.size(n)
		case fi.Mode().IsRegular():
			e.Size = fi.Size()
		default:
			continue
		}
		total += e.Size
		entries = append(entries, e)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Size > entries[j].Size })
	if len(entries) > 30 {
		entries = entries[:30]
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": entries, "total": total})
}
