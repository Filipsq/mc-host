package main

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// The panel's file manager. A server's files live in its Docker volume; the
// agent reaches them through the host's volume directory (VOLUMES_DIR, mounted
// into the agent at the same path) and opens each server's with os.Root, so
// no path or symlink can lead outside that server's own files. Changes wait
// for a backup or restore of the same server to finish, and new files get the
// owner of the server's folder, so the game can still change them.

const (
	listLimit     = 5000   // entries shown per folder
	unzipMaxFiles = 20_000 // entries one archive may hold
)

var (
	errFilesOff    = errors.New("file access is not set up on this host")
	errNoSpace     = errors.New("not enough free disk space")
	errBusy        = errors.New("a backup or restore of this server is in progress")
	errBadPath     = errors.New("invalid path")
	errNotDir      = errors.New("not a folder")
	errNotFile     = errors.New("not a file")
	errTooBig      = errors.New("file too big")
	errBadArchive  = errors.New("not a zip archive this panel can unpack")
	errExists      = errors.New("already exists")
	errIsServerTop = errors.New("the server's top folder can't be changed")
)

type fileEntry struct {
	Name     string    `json:"name"`
	Type     string    `json:"type"` // dir, file, link or other
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
}

// serverFiles is one server's files, opened for a single request.
type serverFiles struct {
	id       string
	root     *os.Root
	dir      string // the volume's folder on the host
	uid, gid int    // who owns the server's files
}

func (s *serverFiles) Close() { s.root.Close() }

// openFiles opens the server's volume. Returns errNotFound if the server has none.
func (a *agent) openFiles(ctx context.Context, id string) (*serverFiles, error) {
	if a.volumesDir == "" {
		return nil, errFilesOff
	}
	dir, err := a.docker.VolumeMountpoint(ctx, containerName(id))
	if err != nil {
		return nil, err
	}
	if rel, err := filepath.Rel(a.volumesDir, dir); err != nil || !filepath.IsLocal(rel) {
		log.Printf("files %s: volume at %s is outside VOLUMES_DIR %s", id, dir, a.volumesDir)
		return nil, errFilesOff
	}
	root, err := os.OpenRoot(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, errFilesOff // the host's volume directory isn't mounted into the agent
	} else if err != nil {
		return nil, err
	}
	s := &serverFiles{id: id, root: root, dir: dir}
	if fi, err := root.Stat("."); err == nil {
		if st, ok := fi.Sys().(*syscall.Stat_t); ok {
			s.uid, s.gid = int(st.Uid), int(st.Gid)
		}
	}
	return s, nil
}

// cleanPath turns a path from the panel ("/plugins/x.yml", "plugins/", "")
// into one relative to the server's files, "." being the top folder.
func cleanPath(p string) (string, error) {
	if len(p) > 1024 || strings.ContainsRune(p, 0) {
		return "", errBadPath
	}
	if c := path.Clean("/" + p)[1:]; c != "" {
		return c, nil
	}
	return ".", nil
}

// freeSpace reports how many bytes can still be written without going under
// the space the host keeps free.
func (a *agent) freeSpace(s *serverFiles) int64 {
	var st syscall.Statfs_t
	if err := syscall.Statfs(s.dir, &st); err != nil {
		return 0
	}
	return int64(st.Bavail)*st.Bsize - a.diskReserve
}

// mkdirAll makes the folder and any missing parents, owned by the server's user.
func (s *serverFiles) mkdirAll(name string) error {
	if name == "." {
		return nil
	}
	parts := strings.Split(name, "/")
	for i := range parts {
		p := strings.Join(parts[:i+1], "/")
		err := s.root.Mkdir(p, 0o755)
		if err == nil {
			if err := s.root.Chown(p, s.uid, s.gid); err != nil {
				return err
			}
			continue
		}
		if !errors.Is(err, fs.ErrExist) {
			return err
		}
		if fi, err := s.root.Stat(p); err != nil {
			return err
		} else if !fi.IsDir() {
			return errNotDir
		}
	}
	return nil
}

// writeFile replaces name with the contents of r, through a temporary file
// next to it, so a broken upload never leaves half a file behind.
func (s *serverFiles) writeFile(name string, r io.Reader) (int64, error) {
	if err := s.mkdirAll(path.Dir(name)); err != nil {
		return 0, err
	}
	if fi, err := s.root.Lstat(name); err == nil && fi.IsDir() {
		return 0, errNotFile
	}
	suffix := make([]byte, 6)
	_, _ = rand.Read(suffix)
	tmp := path.Join(path.Dir(name), "."+path.Base(name)+".upload-"+hex.EncodeToString(suffix))
	f, err := s.root.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return 0, err
	}
	n, err := io.Copy(f, r)
	if err == nil {
		err = f.Chown(s.uid, s.gid)
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = s.root.Rename(tmp, name)
	}
	if err != nil {
		s.root.Remove(tmp)
		return 0, err
	}
	return n, nil
}

// tryLockServer is lockServer for the panel's changes: rather than wait for a
// backup or restore, it reports that one is running.
func (a *agent) tryLockServer(id string) (unlock func(), ok bool) {
	m, _ := a.serverLocks.LoadOrStore(id, &sync.Mutex{})
	mu := m.(*sync.Mutex)
	if !mu.TryLock() {
		return nil, false
	}
	return mu.Unlock, true
}

// filesFrom opens the server's files for a handler, writing the error response if it can't.
func (a *agent) filesFrom(w http.ResponseWriter, r *http.Request) (id string, s *serverFiles, ok bool) {
	if id, ok = a.idFrom(w, r); !ok {
		return "", nil, false
	}
	s, err := a.openFiles(r.Context(), id)
	if err != nil {
		writeFileError(w, err)
		return "", nil, false
	}
	return id, s, true
}

// filesChange runs a change to the server's files, unless a backup or restore is running.
func (a *agent) filesChange(w http.ResponseWriter, r *http.Request, change func(s *serverFiles) (any, error)) {
	id, s, ok := a.filesFrom(w, r)
	if !ok {
		return
	}
	defer s.Close()
	unlock, ok := a.tryLockServer(id)
	if !ok {
		writeFileError(w, errBusy)
		return
	}
	defer unlock()
	resp, err := change(s)
	if err != nil {
		writeFileError(w, err)
		return
	}
	a.remeasureDisk(id)
	if resp == nil {
		resp = map[string]bool{"ok": true}
	}
	writeJSON(w, http.StatusOK, resp)
}

func writeFileError(w http.ResponseWriter, err error) {
	var tooBig *http.MaxBytesError
	switch {
	case errors.Is(err, errNotFound):
		writeError(w, http.StatusNotFound, "server not found")
	case errors.Is(err, errFilesOff):
		writeError(w, http.StatusServiceUnavailable, err.Error())
	case errors.Is(err, errBusy):
		writeError(w, http.StatusConflict, "busy")
	case errors.Is(err, errWorldActive):
		writeError(w, http.StatusConflict, "active")
	case errors.Is(err, errNoWorld):
		writeError(w, http.StatusBadRequest, "noWorld")
	case errors.Is(err, errExists), errors.Is(err, fs.ErrExist):
		writeError(w, http.StatusConflict, "exists")
	case errors.Is(err, fs.ErrNotExist):
		writeError(w, http.StatusNotFound, "no such file or folder")
	case errors.Is(err, errQuota):
		writeError(w, http.StatusInsufficientStorage, "quota")
	case errors.Is(err, errNoSpace), errors.Is(err, syscall.ENOSPC):
		writeError(w, http.StatusInsufficientStorage, errNoSpace.Error())
	case errors.As(err, &tooBig), errors.Is(err, errTooBig):
		writeError(w, http.StatusRequestEntityTooLarge, errTooBig.Error())
	case errors.Is(err, errBadPath), errors.Is(err, errNotDir), errors.Is(err, errNotFile), errors.Is(err, errBadArchive),
		errors.Is(err, errIsServerTop), errors.Is(err, syscall.ENOTDIR), errors.Is(err, syscall.EISDIR),
		errors.Is(err, syscall.EINVAL), errors.Is(err, syscall.ENOTEMPTY), strings.Contains(err.Error(), "path escapes"):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		log.Printf("files: %v", err)
		writeError(w, http.StatusInternalServerError, err.Error())
	}
}

// filesList lists a folder: folders first, then files, by name.
func (a *agent) filesList(w http.ResponseWriter, r *http.Request) {
	_, s, ok := a.filesFrom(w, r)
	if !ok {
		return
	}
	defer s.Close()
	dir, err := cleanPath(r.URL.Query().Get("path"))
	if err != nil {
		writeFileError(w, err)
		return
	}
	f, err := s.root.Open(dir)
	if err != nil {
		writeFileError(w, err)
		return
	}
	defer f.Close()
	if fi, err := f.Stat(); err != nil {
		writeFileError(w, err)
		return
	} else if !fi.IsDir() {
		writeFileError(w, errNotDir)
		return
	}
	names, err := f.Readdirnames(-1)
	if err != nil {
		writeFileError(w, err)
		return
	}
	sort.Slice(names, func(i, j int) bool { return strings.ToLower(names[i]) < strings.ToLower(names[j]) })
	truncated := len(names) > listLimit
	if truncated {
		names = names[:listLimit]
	}
	entries := make([]fileEntry, 0, len(names))
	for _, n := range names {
		fi, err := s.root.Lstat(path.Join(dir, n))
		if err != nil {
			continue // removed meanwhile
		}
		e := fileEntry{Name: n, Type: "other", Modified: fi.ModTime().UTC().Truncate(time.Second)}
		switch m := fi.Mode(); {
		case m.IsDir():
			e.Type = "dir"
		case m.IsRegular():
			e.Type, e.Size = "file", fi.Size()
		case m&fs.ModeSymlink != 0:
			e.Type = "link"
		}
		entries = append(entries, e)
	}
	sort.SliceStable(entries, func(i, j int) bool { return entries[i].Type == "dir" && entries[j].Type != "dir" })
	writeJSON(w, http.StatusOK, map[string]any{"path": dir, "entries": entries, "truncated": truncated})
}

// filesRead sends a file. With ?max= a bigger file is refused (413), for the text editor.
func (a *agent) filesRead(w http.ResponseWriter, r *http.Request) {
	_, s, ok := a.filesFrom(w, r)
	if !ok {
		return
	}
	defer s.Close()
	name, err := cleanPath(r.URL.Query().Get("path"))
	if err != nil {
		writeFileError(w, err)
		return
	}
	// Non-blocking, so a named pipe someone left in the world can't hang the request.
	f, err := s.root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		writeFileError(w, err)
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		writeFileError(w, err)
		return
	}
	if !fi.Mode().IsRegular() {
		writeFileError(w, errNotFile)
		return
	}
	if max, _ := strconv.ParseInt(r.URL.Query().Get("max"), 10, 64); max > 0 && fi.Size() > max {
		writeFileError(w, errTooBig)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeContent(w, r, fi.Name(), fi.ModTime(), f)
}

// filesWrite saves the request body as a file (an upload or an edit), making missing folders.
func (a *agent) filesWrite(w http.ResponseWriter, r *http.Request) {
	a.filesChange(w, r, func(s *serverFiles) (any, error) {
		name, err := cleanPath(r.URL.Query().Get("path"))
		if err != nil {
			return nil, err
		}
		if name == "." {
			return nil, errIsServerTop
		}
		free := a.freeSpace(s)
		room, err := a.quotaRoom(r.Context(), s, name)
		if err != nil {
			return nil, err
		}
		switch {
		case r.ContentLength > a.uploadMax:
			return nil, errTooBig
		case r.ContentLength > free || free <= 0:
			return nil, errNoSpace
		case r.ContentLength > room:
			return nil, errQuota
		}
		n, err := s.writeFile(name, http.MaxBytesReader(w, r.Body, min(a.uploadMax, free, room)))
		if err != nil {
			return nil, err
		}
		return map[string]int64{"size": n}, nil
	})
}

func (a *agent) filesMkdir(w http.ResponseWriter, r *http.Request) {
	a.filesChange(w, r, func(s *serverFiles) (any, error) {
		name, err := cleanPath(r.URL.Query().Get("path"))
		if err != nil {
			return nil, err
		}
		if _, err := s.root.Lstat(name); err == nil {
			return nil, errExists
		}
		return nil, s.mkdirAll(name)
	})
}

// filesRename renames or moves a file or folder to ?to=, never over an existing one.
func (a *agent) filesRename(w http.ResponseWriter, r *http.Request) {
	a.filesChange(w, r, func(s *serverFiles) (any, error) {
		from, err := cleanPath(r.URL.Query().Get("path"))
		if err != nil {
			return nil, err
		}
		to, err := cleanPath(r.URL.Query().Get("to"))
		if err != nil {
			return nil, err
		}
		if from == "." || to == "." {
			return nil, errIsServerTop
		}
		if _, err := s.root.Lstat(from); err != nil {
			return nil, err
		}
		if _, err := s.root.Lstat(to); err == nil {
			return nil, errExists
		}
		if err := s.mkdirAll(path.Dir(to)); err != nil {
			return nil, err
		}
		return nil, s.root.Rename(from, to)
	})
}

func (a *agent) filesDelete(w http.ResponseWriter, r *http.Request) {
	a.filesChange(w, r, func(s *serverFiles) (any, error) {
		name, err := cleanPath(r.URL.Query().Get("path"))
		if err != nil {
			return nil, err
		}
		if name == "." {
			return nil, errIsServerTop
		}
		if _, err := s.root.Lstat(name); err != nil {
			return nil, err
		}
		return nil, s.root.RemoveAll(name)
	})
}

// filesUnzip unpacks a zip archive into ?to= (by default, the folder it's in).
// Existing files with the same names are replaced; links inside are skipped.
func (a *agent) filesUnzip(w http.ResponseWriter, r *http.Request) {
	a.filesChange(w, r, func(s *serverFiles) (any, error) {
		q := r.URL.Query()
		name, err := cleanPath(q.Get("path"))
		if err != nil {
			return nil, err
		}
		to := path.Dir(name)
		if q.Get("to") != "" {
			if to, err = cleanPath(q.Get("to")); err != nil {
				return nil, err
			}
		}
		f, err := s.root.OpenFile(name, os.O_RDONLY|syscall.O_NONBLOCK, 0)
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
		if err := s.mkdirAll(to); err != nil {
			return nil, err
		}
		files := 0
		for _, zf := range zr.File {
			rel := archivePath(zf)
			if rel == "" {
				continue
			}
			dest := path.Join(to, rel)
			switch mode := zf.Mode(); {
			case mode.IsDir():
				err = s.mkdirAll(dest)
			case mode.IsRegular():
				err = s.extract(zf, dest)
				files++
			}
			if err != nil {
				return nil, fmt.Errorf("%s: %w", rel, err)
			}
		}
		return map[string]int{"files": files}, nil
	})
}

// openArchive reads a zip's contents list and checks that it unpacks within
// the disk space left, the server's quota and the agent's limit.
func (a *agent) openArchive(ctx context.Context, s *serverFiles, f io.ReaderAt, size int64) (*zip.Reader, error) {
	zr, err := zip.NewReader(f, size)
	if err != nil || len(zr.File) > unzipMaxFiles {
		return nil, errBadArchive
	}
	// The sizes an archive declares are enforced while unpacking (archive/zip
	// fails on more data), so they're a safe budget against zip bombs.
	var total uint64
	for _, zf := range zr.File {
		total += zf.UncompressedSize64
	}
	if free := a.freeSpace(s); free <= 0 || total > uint64(free) {
		return nil, errNoSpace
	}
	if room, err := a.quotaRoom(ctx, s, ""); err != nil {
		return nil, err
	} else if total > uint64(room) {
		return nil, errQuota
	}
	if total > uint64(a.unzipMax) {
		return nil, errTooBig
	}
	return zr, nil
}

// archivePath is where a zip entry unpacks, relative to the folder it unpacks
// into; "" for entries to skip (the folder itself, macOS's resource forks).
func archivePath(zf *zip.File) string {
	rel := path.Clean("/" + strings.ReplaceAll(zf.Name, `\`, "/"))[1:]
	if rel == "__MACOSX" || strings.HasPrefix(rel, "__MACOSX/") {
		return ""
	}
	return rel
}

func (s *serverFiles) extract(zf *zip.File, dest string) error {
	if err := s.mkdirAll(path.Dir(dest)); err != nil {
		return err
	}
	rc, err := zf.Open()
	if err != nil {
		return errBadArchive
	}
	defer rc.Close()
	f, err := s.root.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	_, err = io.Copy(f, rc)
	if errors.Is(err, zip.ErrFormat) || errors.Is(err, zip.ErrChecksum) || errors.Is(err, zip.ErrAlgorithm) {
		err = errBadArchive
	}
	if err == nil {
		err = f.Chown(s.uid, s.gid)
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return err
}
