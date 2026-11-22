package main

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"strings"
	"syscall"
)

// filesZip sends the files and folders the owner ticked in the panel as one
// zip ({"paths": [...]} in the body), a folder with everything in it. Paths
// from one folder come under their own names; from several, under their whole
// path. If a folder is among them and the server is running, it holds off
// saving meanwhile, like a world download, so a world in it is consistent.
func (a *agent) filesZip(w http.ResponseWriter, r *http.Request) {
	id, s, ok := a.filesFrom(w, r)
	if !ok {
		return
	}
	defer s.Close()
	var req struct {
		Paths []string `json:"paths"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20)).Decode(&req); err != nil || len(req.Paths) == 0 || len(req.Paths) > listLimit {
		writeFileError(w, errBadPath)
		return
	}
	type pick struct {
		path string
		dir  bool
	}
	var picks []pick
	seen := map[string]bool{}
	parents := map[string]bool{}
	folders := false
	for _, p := range req.Paths {
		name, err := cleanPath(p)
		if err != nil || name == "." {
			writeFileError(w, errBadPath)
			return
		}
		if seen[name] {
			continue
		}
		seen[name] = true
		fi, err := s.root.Lstat(name)
		if errors.Is(err, fs.ErrNotExist) {
			continue // removed since the list was shown; the rest still come
		} else if err != nil {
			writeFileError(w, err)
			return
		}
		if !fi.IsDir() && !fi.Mode().IsRegular() {
			continue // links aren't followed, like everywhere in the panel
		}
		picks = append(picks, pick{name, fi.IsDir()})
		parents[path.Dir(name)] = true
		folders = folders || fi.IsDir()
	}
	if len(picks) == 0 {
		writeFileError(w, fs.ErrNotExist)
		return
	}
	// The panel ticks things in one folder: the zip starts from there.
	strip := ""
	if len(parents) == 1 {
		if dir := path.Dir(picks[0].path); dir != "." {
			strip = dir + "/"
		}
	}

	if folders {
		if info, err := a.docker.InspectContainer(r.Context(), containerName(id)); err == nil && info.State.Status == "running" {
			unlock, ok := a.tryLockServer(id) // not mid-backup, which turns saving back on when it ends
			if !ok {
				writeFileError(w, errBusy)
				return
			}
			defer unlock()
			defer a.pauseSaving(r.Context(), containerName(id), info.Config.Labels["mchost.edition"])()
		}
	}

	w.Header().Set("Content-Type", "application/zip")
	zw := zip.NewWriter(w)
	for _, p := range picks {
		name := strings.TrimPrefix(p.path, strip)
		var err error
		if p.dir {
			err = s.zipTree(zw, p.path, name+"/", true)
		} else {
			err = s.zipFile(zw, p.path, name)
		}
		if err != nil {
			// The response has started, so all that's left is to cut it short.
			log.Printf("files zip %s: %v", id, err)
			return
		}
	}
	if err := zw.Close(); err != nil {
		log.Printf("files zip %s: %v", id, err)
	}
}

// zipTree adds a folder's files to the zip under prefix; a missing folder adds
// nothing. With dirs, folders get entries of their own, so empty ones come too.
func (s *serverFiles) zipTree(zw *zip.Writer, dir, prefix string, dirs bool) error {
	if _, err := s.root.Lstat(dir); errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return fs.WalkDir(s.root.FS(), dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if p != dir && errors.Is(err, fs.ErrNotExist) {
				return nil // removed meanwhile
			}
			return err
		}
		name := prefix + strings.TrimPrefix(strings.TrimPrefix(p, dir), "/")
		if d.IsDir() {
			if !dirs || name == "" {
				return nil
			}
			fi, err := d.Info()
			if err != nil {
				return nil
			}
			_, err = zw.CreateHeader(&zip.FileHeader{Name: strings.TrimSuffix(name, "/") + "/", Modified: fi.ModTime()})
			return err
		}
		// session.lock belongs to the running server; links aren't followed.
		if !d.Type().IsRegular() || d.Name() == "session.lock" {
			return nil
		}
		return s.zipFile(zw, p, name)
	})
}

// zipFile adds one file to the zip as name; one removed meanwhile is left out.
func (s *serverFiles) zipFile(zw *zip.Writer, p, name string) error {
	// Non-blocking, so a named pipe someone left in the world can't hang the download.
	f, err := s.root.OpenFile(p, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return err
	}
	if !fi.Mode().IsRegular() {
		return nil
	}
	h := &zip.FileHeader{Name: name, Method: zip.Deflate, Modified: fi.ModTime()}
	if packed(p) {
		h.Method = zip.Store
	}
	out, err := zw.CreateHeader(h)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, f)
	return err
}

// packed reports files that are compressed already, which deflate only slows down.
func packed(p string) bool {
	switch strings.ToLower(path.Ext(p)) {
	case ".mca", ".mcc", ".ldb", ".jar", ".zip", ".gz", ".tgz", ".xz", ".7z", ".rar",
		".mcpack", ".mcaddon", ".mcworld", ".png", ".jpg", ".jpeg", ".webp", ".ogg", ".mp3":
		return true
	}
	return false
}
