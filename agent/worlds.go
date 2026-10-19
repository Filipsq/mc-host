package main

import (
	"archive/zip"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"
)

// Worlds are the folders in a server's files that hold a Minecraft world (a
// level.dat). Java keeps them at the top of /data, and Paper keeps a world's
// nether and end beside it as <name>_nether and <name>_the_end; Bedrock keeps
// them in worlds/. The panel lists them, downloads one as a zip a
// single-player game can open, makes one from an uploaded zip, and deletes the
// ones the server isn't running. Which one it runs is the container's level
// (see createRequest.Level).

const (
	defaultJavaLevel    = "world"         // the image's level-name
	defaultBedrockLevel = "Bedrock level" // the Bedrock server's level-name
)

var (
	validWorldName = regexp.MustCompile(`^[\p{L}\p{N}_-][\p{L}\p{N} _.()-]{0,63}$`)
	errWorldActive = errors.New("the server runs this world")
	errNoWorld     = errors.New("no Minecraft world (level.dat) in the archive")
)

type worldInfo struct {
	Name     string    `json:"name"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"` // when the world was last saved
	NewGame  bool      `json:"newGame,omitempty"`
}

// savedByNewGame reports whether a Java world was saved by Minecraft 26.1 or
// newer. 26.1 moved the world's seed and dimensions out of level.dat (into
// data/minecraft/world_gen_settings.dat) and its dimensions into dimensions/,
// so 1.21.11 and older can't open it at all ("No key dimensions in MapLike").
func (s *serverFiles) savedByNewGame(dir string) bool {
	for _, p := range []string{dir + "/data/minecraft/world_gen_settings.dat", dir + "/dimensions/minecraft/overworld"} {
		if _, err := s.root.Lstat(p); err == nil {
			return true
		}
	}
	return false
}

// worldRequest reads ?edition= and the world's name (from the path, or ?name=).
func worldRequest(r *http.Request) (bedrock bool, name string, err error) {
	switch r.URL.Query().Get("edition") {
	case "", "JAVA":
	case "BEDROCK":
		bedrock = true
	default:
		return false, "", errBadPath
	}
	name = r.PathValue("name")
	if name == "" {
		name = r.URL.Query().Get("name")
	}
	if !validWorldName.MatchString(name) {
		return false, "", errBadPath
	}
	return bedrock, name, nil
}

// worldDir is the folder a world's own files are in.
func worldDir(bedrock bool, name string) string {
	if bedrock {
		return "worlds/" + name
	}
	return name
}

// worldParts are all the folders that belong to a world.
func worldParts(bedrock bool, name string) []string {
	if bedrock {
		return []string{worldDir(true, name)}
	}
	return []string{name, name + "_nether", name + "_the_end"}
}

// isWorld reports whether the folder holds a world.
func (s *serverFiles) isWorld(dir string) bool {
	if fi, err := s.root.Lstat(dir); err != nil || !fi.IsDir() {
		return false
	}
	fi, err := s.root.Lstat(dir + "/level.dat")
	return err == nil && fi.Mode().IsRegular()
}

// size adds up the files in a folder; 0 if it isn't there.
func (s *serverFiles) size(dir string) int64 {
	var total int64
	fs.WalkDir(s.root.FS(), dir, func(_ string, d fs.DirEntry, err error) error {
		if err == nil && d.Type().IsRegular() {
			if fi, err := d.Info(); err == nil {
				total += fi.Size()
			}
		}
		return nil
	})
	return total
}

// worlds lists the server's worlds by name.
func (s *serverFiles) worlds(bedrock bool) ([]worldInfo, error) {
	dir := "."
	if bedrock {
		dir = "worlds"
	}
	f, err := s.root.Open(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return []worldInfo{}, nil
	} else if err != nil {
		return nil, err
	}
	names, err := f.Readdirnames(-1)
	f.Close()
	if err != nil {
		return nil, err
	}
	found := map[string]bool{}
	for _, n := range names {
		if validWorldName.MatchString(n) && s.isWorld(path.Join(dir, n)) {
			found[n] = true
		}
	}
	list := []worldInfo{}
	for n := range found {
		// Paper's nether and end of a world are part of it, not worlds of their own.
		if base, ok := strings.CutSuffix(n, "_nether"); ok && found[base] && !bedrock {
			continue
		}
		if base, ok := strings.CutSuffix(n, "_the_end"); ok && found[base] && !bedrock {
			continue
		}
		w := worldInfo{Name: n}
		for _, p := range worldParts(bedrock, n) {
			w.Size += s.size(p)
		}
		if fi, err := s.root.Lstat(worldDir(bedrock, n) + "/level.dat"); err == nil {
			w.Modified = fi.ModTime().UTC().Truncate(time.Second)
		}
		w.NewGame = !bedrock && s.savedByNewGame(n)
		list = append(list, w)
	}
	sort.Slice(list, func(i, j int) bool { return strings.ToLower(list[i].Name) < strings.ToLower(list[j].Name) })
	return list, nil
}

// activeWorld is the world the server's container runs.
func (a *agent) activeWorld(r *http.Request, id string, bedrock bool) string {
	if info, err := a.docker.InspectContainer(r.Context(), containerName(id)); err == nil {
		if level := info.Config.Labels["mchost.level"]; level != "" {
			return level
		}
	}
	if bedrock {
		return defaultBedrockLevel
	}
	return defaultJavaLevel
}

func (a *agent) worldsList(w http.ResponseWriter, r *http.Request) {
	id, s, ok := a.filesFrom(w, r)
	if !ok {
		return
	}
	defer s.Close()
	bedrock := r.URL.Query().Get("edition") == "BEDROCK"
	list, err := s.worlds(bedrock)
	if err != nil {
		writeFileError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"worlds": list, "active": a.activeWorld(r, id, bedrock)})
}

// worldDownload sends a world as a zip. A Java world comes as one folder a
// single-player game can open, with Paper's nether and end moved back inside
// it; a Bedrock world comes with its files at the top, as a .mcworld has them.
// A running server holds off saving meanwhile, so the copy is consistent.
func (a *agent) worldDownload(w http.ResponseWriter, r *http.Request) {
	id, s, ok := a.filesFrom(w, r)
	if !ok {
		return
	}
	defer s.Close()
	bedrock, name, err := worldRequest(r)
	if err != nil {
		writeFileError(w, err)
		return
	}
	base := worldDir(bedrock, name)
	if !s.isWorld(base) {
		writeFileError(w, fs.ErrNotExist)
		return
	}
	unlock, ok := a.tryLockServer(id) // not mid-backup or mid-restore
	if !ok {
		writeFileError(w, errBusy)
		return
	}
	defer unlock()
	if info, err := a.docker.InspectContainer(r.Context(), containerName(id)); err == nil && info.State.Status == "running" {
		edition := "JAVA"
		if bedrock {
			edition = "BEDROCK"
		}
		defer a.pauseSaving(r.Context(), containerName(id), edition)()
	}

	w.Header().Set("Content-Type", "application/zip")
	zw := zip.NewWriter(w)
	into := name + "/"
	if bedrock {
		into = ""
	}
	parts := [][2]string{{base, into}}
	if _, err := s.root.Lstat(base + "/DIM-1"); !bedrock && err != nil {
		parts = append(parts, [2]string{name + "_nether/DIM-1", into + "DIM-1/"})
	}
	if _, err := s.root.Lstat(base + "/DIM1"); !bedrock && err != nil {
		parts = append(parts, [2]string{name + "_the_end/DIM1", into + "DIM1/"})
	}
	for _, p := range parts {
		if err := s.zipFolder(zw, p[0], p[1]); err != nil {
			// The response has started, so all that's left is to cut it short.
			log.Printf("world download %s/%s: %v", id, name, err)
			return
		}
	}
	if err := zw.Close(); err != nil {
		log.Printf("world download %s/%s: %v", id, name, err)
	}
}

// zipFolder adds a folder's files to the zip under prefix; a missing folder adds nothing.
func (s *serverFiles) zipFolder(zw *zip.Writer, dir, prefix string) error {
	if _, err := s.root.Lstat(dir); errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return fs.WalkDir(s.root.FS(), dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		// session.lock belongs to the running server; links aren't followed.
		if !d.Type().IsRegular() || d.Name() == "session.lock" {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return nil // removed meanwhile
		}
		h := &zip.FileHeader{Name: prefix + strings.TrimPrefix(p, dir+"/"), Method: zip.Deflate, Modified: fi.ModTime()}
		// Region and Bedrock database files are compressed already.
		if ext := path.Ext(p); ext == ".mca" || ext == ".mcc" || ext == ".ldb" {
			h.Method = zip.Store
		}
		out, err := zw.CreateHeader(h)
		if err != nil {
			return err
		}
		f, err := s.root.OpenFile(p, os.O_RDONLY|syscall.O_NONBLOCK, 0)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = io.Copy(out, f)
		return err
	})
}

// worldImport makes the world ?name= from an uploaded zip (?path=), which is
// deleted afterwards. The world may be at the zip's top (a .mcworld) or in a
// folder in it, as single-player saves are usually zipped.
func (a *agent) worldImport(w http.ResponseWriter, r *http.Request) {
	a.filesChange(w, r, func(s *serverFiles) (any, error) {
		bedrock, name, err := worldRequest(r)
		if err != nil {
			return nil, err
		}
		upload, err := cleanPath(r.URL.Query().Get("path"))
		if err != nil || upload == "." {
			return nil, errBadPath
		}
		defer s.root.Remove(upload)
		for _, p := range worldParts(bedrock, name) {
			if _, err := s.root.Lstat(p); err == nil {
				return nil, errExists
			}
		}
		f, err := s.root.OpenFile(upload, os.O_RDONLY|syscall.O_NONBLOCK, 0)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		fi, err := f.Stat()
		if err != nil {
			return nil, err
		}
		if !fi.Mode().IsRegular() {
			return nil, errNotFile
		}
		zr, err := a.openArchive(r.Context(), s, f, fi.Size())
		if err != nil {
			return nil, err
		}
		// The world is the folder with the level.dat nearest the top.
		top := ""
		depth := -1
		for _, zf := range zr.File {
			rel := archivePath(zf)
			if path.Base(rel) != "level.dat" || !zf.Mode().IsRegular() {
				continue
			}
			if d := strings.Count(rel, "/"); depth < 0 || d < depth {
				top, depth = path.Dir(rel), d
			}
		}
		if depth < 0 {
			return nil, errNoWorld
		}

		// Unpacked next to where it goes, then moved there whole.
		suffix := make([]byte, 6)
		_, _ = rand.Read(suffix)
		dest := worldDir(bedrock, name)
		tmp := path.Join(path.Dir(dest), ".import-"+hex.EncodeToString(suffix))
		if err := s.mkdirAll(tmp); err != nil {
			return nil, err
		}
		files := 0
		for _, zf := range zr.File {
			rel := archivePath(zf)
			if top != "." {
				var ok bool
				if rel, ok = strings.CutPrefix(rel, top+"/"); !ok {
					continue
				}
			}
			if rel == "" || rel == "." {
				continue
			}
			switch mode := zf.Mode(); {
			case mode.IsDir():
				err = s.mkdirAll(path.Join(tmp, rel))
			case mode.IsRegular():
				err = s.extract(zf, path.Join(tmp, rel))
				files++
			}
			if err != nil {
				s.root.RemoveAll(tmp)
				return nil, err
			}
		}
		if err := s.root.Rename(tmp, dest); err != nil {
			s.root.RemoveAll(tmp)
			return nil, err
		}
		return map[string]any{"name": name, "files": files}, nil
	})
}

// worldDelete deletes a world, with Paper's nether and end; never the one the server runs.
func (a *agent) worldDelete(w http.ResponseWriter, r *http.Request) {
	a.filesChange(w, r, func(s *serverFiles) (any, error) {
		bedrock, name, err := worldRequest(r)
		if err != nil {
			return nil, err
		}
		if name == a.activeWorld(r, r.PathValue("id"), bedrock) {
			return nil, errWorldActive
		}
		if !s.isWorld(worldDir(bedrock, name)) {
			return nil, fs.ErrNotExist
		}
		for _, p := range worldParts(bedrock, name) {
			if err := s.root.RemoveAll(p); err != nil {
				return nil, err
			}
		}
		return nil, nil
	})
}
