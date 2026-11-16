package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"syscall"
)

// Bedrock add-ons (.mcaddon, .mcpack) are zips of packs: each pack is a folder
// with a manifest.json, a behavior pack (game rules, mobs, items, scripts) or
// a resource pack (textures, sounds). A .mcaddon holds one or more .mcpack
// files, or the pack folders themselves. The server runs a pack when it's in
// behavior_packs/ or resource_packs/ and the world lists it in
// worlds/<world>/world_behavior_packs.json or world_resource_packs.json. The
// panel uploads the file into .addon-uploads/ and this unpacks and lists it
// in one go; the server loads it on its next start.

const (
	behaviorPacks = "behavior_packs"
	resourcePacks = "resource_packs"
	// A pack inside a .mcaddon is read into memory to be opened as a zip.
	innerPackMax = 512 << 20
)

var (
	errNoPack        = errors.New("no Bedrock pack (manifest.json) in the file")
	errSkinPack      = errors.New("a skin pack, which players add in their own game")
	errWorldTemplate = errors.New("a world template, which goes in Worlds")
	validPackUUID    = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	packFolderChars  = regexp.MustCompile(`[^A-Za-z0-9_-]+`)
	packColorCodes   = regexp.MustCompile(`§.`)
	textKey          = regexp.MustCompile(`^[a-z_]+(\.[a-z_]+)+$`) // e.g. "pack.name"
)

// The folders the Bedrock server ships with its own packs in; never removed.
var builtinPackPrefixes = []string{"vanilla", "chemistry", "experimental", "editor"}

type packManifest struct {
	Header struct {
		Name    string          `json:"name"`
		UUID    string          `json:"uuid"`
		Version json.RawMessage `json:"version"`
	} `json:"header"`
	Modules []struct {
		Type string `json:"type"`
	} `json:"modules"`
	Dependencies []struct {
		ModuleName string          `json:"module_name"`
		Version    json.RawMessage `json:"version"`
	} `json:"dependencies"`
}

type bedrockPack struct {
	UUID    string `json:"uuid"`
	Name    string `json:"name"`
	Type    string `json:"type"` // "behavior" or "resource"
	Version []int  `json:"version"`
	Folder  string `json:"folder,omitempty"`
	// Beta: its scripts use a beta Script API, which runs only with the
	// world's "Beta APIs" experiment on.
	Beta bool `json:"beta,omitempty"`
}

type worldPackEntry struct {
	PackID  string `json:"pack_id"`
	Version any    `json:"version"`
}

// readManifest parses a manifest.json, which authors often write with
// comments and trailing commas that Minecraft itself accepts.
func readManifest(data []byte) (*packManifest, error) {
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	var m packManifest
	if err := json.Unmarshal(data, &m); err != nil {
		if err := json.Unmarshal(looseJSON(data), &m); err != nil {
			return nil, errNoPack
		}
	}
	if !validPackUUID.MatchString(m.Header.UUID) {
		return nil, errNoPack
	}
	m.Header.UUID = strings.ToLower(m.Header.UUID)
	return &m, nil
}

// looseJSON drops // and /* */ comments and commas before a closing bracket.
func looseJSON(data []byte) []byte {
	var out bytes.Buffer
	inString, escaped := false, false
	for i := 0; i < len(data); i++ {
		c := data[i]
		if inString {
			out.WriteByte(c)
			switch {
			case escaped:
				escaped = false
			case c == '\\':
				escaped = true
			case c == '"':
				inString = false
			}
			continue
		}
		switch {
		case c == '"':
			inString = true
			out.WriteByte(c)
		case c == '/' && i+1 < len(data) && data[i+1] == '/':
			for i < len(data) && data[i] != '\n' {
				i++
			}
			out.WriteByte('\n')
		case c == '/' && i+1 < len(data) && data[i+1] == '*':
			i += 2
			for i+1 < len(data) && !(data[i] == '*' && data[i+1] == '/') {
				i++
			}
			i++
		case c == ']' || c == '}':
			// Take back a comma (and the blanks after it) written just before.
			b := out.Bytes()
			j := len(b) - 1
			for j >= 0 && (b[j] == ' ' || b[j] == '\n' || b[j] == '\r' || b[j] == '\t') {
				j--
			}
			if j >= 0 && b[j] == ',' {
				out.Truncate(j)
			}
			out.WriteByte(c)
		default:
			out.WriteByte(c)
		}
	}
	return out.Bytes()
}

// packVersion reads a manifest version: [1, 0, 0] or, in newer manifests, "1.0.0".
func packVersion(raw json.RawMessage) []int {
	var nums []int
	if json.Unmarshal(raw, &nums) == nil && len(nums) > 0 {
		return nums
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		s, _, _ = strings.Cut(s, "-")
		for _, part := range strings.Split(s, ".") {
			n, err := strconv.Atoi(part)
			if err != nil {
				break
			}
			nums = append(nums, n)
		}
	}
	for len(nums) < 3 {
		nums = append(nums, 0)
	}
	return nums
}

// packKind is "behavior", "resource", or an error for packs a server can't use.
func (m *packManifest) packKind() (string, error) {
	kind := ""
	for _, mod := range m.Modules {
		switch mod.Type {
		case "data", "script", "javascript", "client_data":
			kind = "behavior"
		case "resources":
			if kind == "" {
				kind = "resource"
			}
		case "skin_pack":
			return "", errSkinPack
		case "world_template":
			return "", errWorldTemplate
		}
	}
	if kind == "" {
		return "", errNoPack
	}
	return kind, nil
}

// usesBetaScripts reports whether the pack's scripts need the Beta APIs experiment.
func (m *packManifest) usesBetaScripts() bool {
	for _, d := range m.Dependencies {
		if strings.HasPrefix(d.ModuleName, "@minecraft/") && strings.Contains(string(d.Version), "beta") {
			return true
		}
	}
	return false
}

func (m *packManifest) displayName(fallback string) string {
	name := strings.TrimSpace(packColorCodes.ReplaceAllString(m.Header.Name, ""))
	// "pack.name" is looked up in the pack's texts; the file's name says more.
	if name == "" || textKey.MatchString(name) {
		name = fallback
	}
	if len([]rune(name)) > 80 {
		name = string([]rune(name)[:80])
	}
	return name
}

// foundPack is one pack in an uploaded file: its manifest and where its files are.
type foundPack struct {
	manifest *packManifest
	zr       *zip.Reader
	root     string // the pack's folder inside zr ("" for the top)
	fallback string // a name to show if the manifest has none
}

// findPacks lists the packs in an archive: every folder with a manifest.json
// that isn't inside another pack, and the packs inside .mcpack/.zip files in it.
func (a *agent) findPacks(r *http.Request, s *serverFiles, zr *zip.Reader, fallback string, depth int) ([]foundPack, error) {
	var roots []string
	manifests := map[string]*zip.File{}
	for _, zf := range zr.File {
		rel := archivePath(zf)
		if path.Base(rel) == "manifest.json" && zf.Mode().IsRegular() {
			dir := path.Dir(rel)
			if dir == "." {
				dir = ""
			}
			manifests[dir] = zf
			roots = append(roots, dir)
		}
	}
	sort.Slice(roots, func(i, j int) bool { return len(roots[i]) < len(roots[j]) })
	var packs []foundPack
	var firstErr error
	inside := func(dir string) bool {
		for _, p := range packs {
			if p.root == "" || strings.HasPrefix(dir, p.root+"/") {
				return true
			}
		}
		return false
	}
	for _, dir := range roots {
		if inside(dir) {
			continue
		}
		rc, err := manifests[dir].Open()
		if err != nil {
			return nil, errBadArchive
		}
		data, err := io.ReadAll(io.LimitReader(rc, 1<<20))
		rc.Close()
		if err != nil {
			return nil, errBadArchive
		}
		m, err := readManifest(data)
		if err == nil {
			_, err = m.packKind()
		}
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		name := fallback
		if dir != "" {
			name = path.Base(dir)
		}
		packs = append(packs, foundPack{manifest: m, zr: zr, root: dir, fallback: name})
	}
	// A .mcaddon's packs, zipped one by one (not ones inside a pack's own folder).
	if depth == 0 {
		own := len(packs)
		inside := func(dir string) bool {
			for _, p := range packs[:own] {
				if p.root == "" || dir == p.root || strings.HasPrefix(dir, p.root+"/") {
					return true
				}
			}
			return false
		}
		for _, zf := range zr.File {
			rel := archivePath(zf)
			ext := strings.ToLower(path.Ext(rel))
			if !zf.Mode().IsRegular() || (ext != ".mcpack" && ext != ".zip") || inside(path.Dir(rel)) {
				continue
			}
			if zf.UncompressedSize64 > innerPackMax {
				return nil, errTooBig
			}
			rc, err := zf.Open()
			if err != nil {
				return nil, errBadArchive
			}
			data, err := io.ReadAll(io.LimitReader(rc, innerPackMax))
			rc.Close()
			if err != nil {
				return nil, errBadArchive
			}
			inner, err := a.openArchive(r.Context(), s, bytes.NewReader(data), int64(len(data)))
			if err != nil {
				return nil, err
			}
			found, err := a.findPacks(r, s, inner, strings.TrimSuffix(path.Base(rel), path.Ext(rel)), depth+1)
			if err != nil {
				if firstErr == nil {
					firstErr = err
				}
				continue
			}
			packs = append(packs, found...)
		}
	}
	if len(packs) == 0 {
		if firstErr == nil {
			firstErr = errNoPack
		}
		return nil, firstErr
	}
	return packs, nil
}

// packFolders maps the pack UUIDs in behavior_packs/ or resource_packs/ to their folders.
func (s *serverFiles) packFolders(dir string) map[string]string {
	folders := map[string]string{}
	entries, err := fs.ReadDir(s.root.FS(), dir)
	if err != nil {
		return folders
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		data, err := fs.ReadFile(s.root.FS(), dir+"/"+e.Name()+"/manifest.json")
		if err != nil {
			continue
		}
		if m, err := readManifest(data); err == nil {
			folders[m.Header.UUID] = e.Name()
		}
	}
	return folders
}

func isBuiltinPack(folder string) bool {
	for _, p := range builtinPackPrefixes {
		if strings.HasPrefix(strings.ToLower(folder), p) {
			return true
		}
	}
	return false
}

func packsDir(kind string) string {
	if kind == "resource" {
		return resourcePacks
	}
	return behaviorPacks
}

func worldPacksFile(world, kind string) string {
	return worldDir(true, world) + "/world_" + kind + "_packs.json"
}

// worldPackList reads a world's list of packs ([] if it has none yet).
func (s *serverFiles) worldPackList(world, kind string) []worldPackEntry {
	var list []worldPackEntry
	data, err := fs.ReadFile(s.root.FS(), worldPacksFile(world, kind))
	if err == nil && json.Unmarshal(looseJSON(data), &list) != nil {
		list = nil
	}
	return list
}

func (s *serverFiles) writeWorldPackList(world, kind string, list []worldPackEntry) error {
	if list == nil {
		list = []worldPackEntry{}
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	_, err = s.writeFile(worldPacksFile(world, kind), bytes.NewReader(data))
	return err
}

// installPack unpacks one pack into its folder (replacing an older copy of it)
// and lists it first in the world, so it wins over packs listed before it.
func (s *serverFiles) installPack(p foundPack, world string) (bedrockPack, error) {
	m := p.manifest
	kind, _ := m.packKind()
	dir := packsDir(kind)
	name := m.displayName(p.fallback)
	folder := strings.Trim(packFolderChars.ReplaceAllString(name, "_"), "_")
	if len(folder) > 40 {
		folder = folder[:40]
	}
	if folder == "" {
		folder = "pack"
	}
	folder += "-" + m.Header.UUID[:8]
	if old, ok := s.packFolders(dir)[m.Header.UUID]; ok && !isBuiltinPack(old) {
		if err := s.root.RemoveAll(dir + "/" + old); err != nil {
			return bedrockPack{}, err
		}
	}
	dest := dir + "/" + folder
	if err := s.root.RemoveAll(dest); err != nil {
		return bedrockPack{}, err
	}
	if err := s.mkdirAll(dest); err != nil {
		return bedrockPack{}, err
	}
	for _, zf := range p.zr.File {
		rel := archivePath(zf)
		if p.root != "" {
			if !strings.HasPrefix(rel, p.root+"/") {
				continue
			}
			rel = strings.TrimPrefix(rel, p.root+"/")
		}
		if rel == "" {
			continue
		}
		var err error
		switch mode := zf.Mode(); {
		case mode.IsDir():
			err = s.mkdirAll(dest + "/" + rel)
		case mode.IsRegular():
			err = s.extract(zf, dest+"/"+rel)
		}
		if err != nil {
			s.root.RemoveAll(dest)
			return bedrockPack{}, err
		}
	}
	version := packVersion(m.Header.Version)
	list := []worldPackEntry{{PackID: m.Header.UUID, Version: version}}
	for _, e := range s.worldPackList(world, kind) {
		if strings.ToLower(e.PackID) != m.Header.UUID {
			list = append(list, e)
		}
	}
	if err := s.writeWorldPackList(world, kind, list); err != nil {
		return bedrockPack{}, err
	}
	return bedrockPack{UUID: m.Header.UUID, Name: name, Type: kind, Version: version, Folder: folder, Beta: m.usesBetaScripts()}, nil
}

func packWorld(r *http.Request) (string, error) {
	world := r.URL.Query().Get("world")
	if world == "" {
		world = defaultBedrockLevel
	}
	if !validWorldName.MatchString(world) {
		return "", errBadPath
	}
	return world, nil
}

// bedrockPacksImport unpacks an uploaded .mcaddon/.mcpack (?path=, deleted
// afterwards) and turns its packs on in the world ?world=.
func (a *agent) bedrockPacksImport(w http.ResponseWriter, r *http.Request) {
	a.filesChange(w, r, func(s *serverFiles) (any, error) {
		world, err := packWorld(r)
		if err != nil {
			return nil, err
		}
		upload, err := cleanPath(r.URL.Query().Get("path"))
		if err != nil || upload == "." {
			return nil, errBadPath
		}
		defer s.root.Remove(upload)
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
		found, err := a.findPacks(r, s, zr, "pack", 0)
		if err != nil {
			return nil, err
		}
		// The same order every time: behavior packs first, then by name.
		sort.SliceStable(found, func(i, j int) bool {
			ki, _ := found[i].manifest.packKind()
			kj, _ := found[j].manifest.packKind()
			if ki != kj {
				return ki == "behavior"
			}
			return found[i].fallback < found[j].fallback
		})
		installed := []bedrockPack{}
		for _, p := range found {
			pack, err := s.installPack(p, world)
			if err != nil {
				return nil, err
			}
			installed = append(installed, pack)
		}
		return map[string]any{"packs": installed}, nil
	})
}

// bedrockPacksList lists the packs the world ?world= runs, by the names in their manifests.
func (a *agent) bedrockPacksList(w http.ResponseWriter, r *http.Request) {
	_, s, ok := a.filesFrom(w, r)
	if !ok {
		return
	}
	defer s.Close()
	world, err := packWorld(r)
	if err != nil {
		writeFileError(w, err)
		return
	}
	packs := []bedrockPack{}
	for _, kind := range []string{"behavior", "resource"} {
		dir := packsDir(kind)
		folders := s.packFolders(dir)
		for _, e := range s.worldPackList(world, kind) {
			id := strings.ToLower(e.PackID)
			pack := bedrockPack{UUID: id, Name: id, Type: kind}
			if folder, ok := folders[id]; ok {
				pack.Folder = folder
				if data, err := fs.ReadFile(s.root.FS(), dir+"/"+folder+"/manifest.json"); err == nil {
					if m, err := readManifest(data); err == nil {
						// Our folders are "<name>-<uuid start>", with _ for spaces.
						pack.Name = m.displayName(strings.ReplaceAll(strings.TrimSuffix(folder, "-"+id[:8]), "_", " "))
						pack.Version = packVersion(m.Header.Version)
						pack.Beta = m.usesBetaScripts()
					}
				}
			}
			packs = append(packs, pack)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"packs": packs})
}

// bedrockPackRemove takes the pack {uuid} off the world ?world= and deletes
// its folder (never one of the server's own packs).
func (a *agent) bedrockPackRemove(w http.ResponseWriter, r *http.Request) {
	a.filesChange(w, r, func(s *serverFiles) (any, error) {
		world, err := packWorld(r)
		if err != nil {
			return nil, err
		}
		id := strings.ToLower(r.PathValue("uuid"))
		if !validPackUUID.MatchString(id) {
			return nil, errBadPath
		}
		for _, kind := range []string{"behavior", "resource"} {
			list := s.worldPackList(world, kind)
			kept := make([]worldPackEntry, 0, len(list))
			for _, e := range list {
				if strings.ToLower(e.PackID) != id {
					kept = append(kept, e)
				}
			}
			if len(kept) != len(list) {
				if err := s.writeWorldPackList(world, kind, kept); err != nil {
					return nil, err
				}
			}
			dir := packsDir(kind)
			if folder, ok := s.packFolders(dir)[id]; ok && !isBuiltinPack(folder) {
				if err := s.root.RemoveAll(dir + "/" + folder); err != nil {
					return nil, err
				}
			}
		}
		return nil, nil
	})
}
