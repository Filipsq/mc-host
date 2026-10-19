package main

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Moving a server to another machine (when its plan needs more memory than this
// one has left): the site stops it here and downloads its files (export), uploads
// them to the other machine's agent (import) with its backups, creates it there,
// then deletes it here.

const (
	moveExport = ".move-out.tar.gz"
	moveImport = ".move-in.tar.gz"
)

var errServerHere = errors.New("this server already exists on this machine")

// exportFiles stops the server and sends all its files as one gzipped tarball.
func (a *agent) exportFiles(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Hour)
	defer cancel()
	defer a.lockServer(id)()
	name := containerName(id)
	if _, err := a.docker.InspectContainer(ctx, name); a.handleDockerErr(w, err) {
		return
	}
	a.setMarker(id, "stopped") // keeps the router from waking it while it's copied
	if a.handleDockerErr(w, a.docker.StopContainer(ctx, name, 60)) {
		return
	}
	if err := os.MkdirAll(a.backupPath(id), 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer os.Remove(a.backupPath(id, moveExport))
	if a.handleDockerErr(w, a.runHelper(ctx, id, false, "tar", "-czf", "/backups/"+id+"/"+moveExport, "-C", "/data", ".")) {
		return
	}
	f, err := os.Open(a.backupPath(id, moveExport))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Length", strconv.FormatInt(fi.Size(), 10))
	if _, err := io.Copy(w, f); err != nil {
		log.Printf("export %s: %v", id, err)
		return
	}
	log.Printf("exported %s (%d bytes)", id, fi.Size())
}

// importFiles fills the volume of a server that isn't on this machine yet with
// a tarball from exportFiles. The site then creates the server as usual.
func (a *agent) importFiles(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 2*time.Hour)
	defer cancel()
	defer a.lockServer(id)()
	if _, err := a.docker.InspectContainer(ctx, containerName(id)); err == nil {
		writeError(w, http.StatusConflict, errServerHere.Error())
		return
	} else if !errors.Is(err, errNotFound) {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Room for the tarball and what it unpacks to (worlds pack to about a third).
	free := a.diskFree(a.backupDir)
	if r.ContentLength < 0 || 4*r.ContentLength > free {
		writeError(w, http.StatusInsufficientStorage, errNoSpace.Error())
		return
	}
	if err := os.MkdirAll(a.backupPath(id), 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer os.Remove(a.backupPath(id, moveImport))
	if err := writeAll(a.backupPath(id, moveImport), http.MaxBytesReader(w, r.Body, r.ContentLength)); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Docker makes the volume when the helper first mounts it.
	script := strings.Join([]string{
		"set -e",
		`find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} \;`,
		"tar -xzf /backups/" + id + "/" + moveImport + " -C /data",
	}, "\n")
	if a.handleDockerErr(w, a.runHelper(ctx, id, true, "sh", "-c", script)) {
		return
	}
	log.Printf("imported %s (%d bytes)", id, r.ContentLength)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// backupUpload saves a backup brought over from the machine the server was on.
func (a *agent) backupUpload(w http.ResponseWriter, r *http.Request) {
	id, file, ok := a.backupFileFrom(w, r)
	if !ok {
		return
	}
	defer a.lockServer(id)()
	if r.ContentLength < 0 || r.ContentLength > a.diskFree(a.backupDir) {
		writeError(w, http.StatusInsufficientStorage, errNoSpace.Error())
		return
	}
	if err := os.MkdirAll(a.backupPath(id), 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	partial := a.backupPath(id, file+".partial")
	if err := writeAll(partial, http.MaxBytesReader(w, r.Body, r.ContentLength)); err != nil {
		os.Remove(partial)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := os.Rename(partial, a.backupPath(id, file)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

// diskFree reports how many bytes can be written at dir without going under the
// space the host keeps free.
func (a *agent) diskFree(dir string) int64 {
	var st syscall.Statfs_t
	if err := syscall.Statfs(dir, &st); err != nil {
		return 0
	}
	return int64(st.Bavail)*st.Bsize - a.diskReserve
}

func writeAll(path string, r io.Reader) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}
