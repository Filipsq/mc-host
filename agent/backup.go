package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Backups are gzipped tarballs of a server's world volume, made by a
// throwaway helper container. They live in BACKUP_DIR/<server id>/<UTC
// time>.tar.gz. The plan sets how many are kept (the mchost.backups label),
// and a scheduler makes one a day for every server that has run since its
// last backup.

const (
	backupImage      = "alpine:3.22"
	backupTimeFormat = "20060102-150405"
	backupEvery      = 24 * time.Hour
)

var (
	backupFile        = regexp.MustCompile(`^\d{8}-\d{6}\.tar\.gz$`)
	errNoBackups      = errors.New("backups are not included in this plan")
	errBackupNotFound = errors.New("backup not found")
)

type backupInfo struct {
	Name      string    `json:"name"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
}

func (a *agent) backupPath(id string, file ...string) string {
	return filepath.Join(append([]string{a.backupDir, id}, file...)...)
}

func backupsKept(info *ContainerInfo) int {
	n, _ := strconv.Atoi(info.Config.Labels["mchost.backups"])
	return n
}

// lockServer makes backups and restores of one server wait for each other.
func (a *agent) lockServer(id string) (unlock func()) {
	m, _ := a.serverLocks.LoadOrStore(id, &sync.Mutex{})
	mu := m.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

// listBackups returns a server's backups, newest first.
func (a *agent) listBackups(id string) ([]backupInfo, error) {
	entries, err := os.ReadDir(a.backupPath(id))
	if errors.Is(err, fs.ErrNotExist) {
		return []backupInfo{}, nil
	}
	if err != nil {
		return nil, err
	}
	list := []backupInfo{}
	for _, e := range entries {
		if !backupFile.MatchString(e.Name()) {
			continue
		}
		created, err := time.Parse(backupTimeFormat, strings.TrimSuffix(e.Name(), ".tar.gz"))
		if err != nil {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		list = append(list, backupInfo{Name: e.Name(), Size: fi.Size(), CreatedAt: created})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].CreatedAt.After(list[j].CreatedAt) })
	return list, nil
}

// backup copies the server's world into a new backup, then drops the oldest
// ones beyond what its plan keeps.
func (a *agent) backup(ctx context.Context, id string) (backupInfo, error) {
	defer a.lockServer(id)()
	name := containerName(id)
	info, err := a.docker.InspectContainer(ctx, name)
	if err != nil {
		return backupInfo{}, err
	}
	keep := backupsKept(info)
	if keep <= 0 {
		return backupInfo{}, errNoBackups
	}
	if err := os.MkdirAll(a.backupPath(id), 0o755); err != nil {
		return backupInfo{}, err
	}
	if info.State.Status == "running" {
		resume := a.pauseSaving(ctx, name, info.Config.Labels["mchost.edition"])
		defer resume()
	}

	created := time.Now().UTC().Truncate(time.Second)
	file := created.Format(backupTimeFormat) + ".tar.gz"
	partial := file + ".partial"
	if err := a.runHelper(ctx, id, false, "tar", "-czf", "/backups/"+id+"/"+partial, "-C", "/data", "."); err != nil {
		os.Remove(a.backupPath(id, partial))
		return backupInfo{}, err
	}
	if err := os.Rename(a.backupPath(id, partial), a.backupPath(id, file)); err != nil {
		return backupInfo{}, err
	}
	fi, err := os.Stat(a.backupPath(id, file))
	if err != nil {
		return backupInfo{}, err
	}
	a.pruneBackups(id, keep)
	return backupInfo{Name: file, Size: fi.Size(), CreatedAt: created}, nil
}

// pauseSaving stops a running server from writing its world while it's being
// copied, after flushing what it has. The returned function turns saving back
// on. Failures only make the copy less tidy, so they're logged, not returned.
func (a *agent) pauseSaving(ctx context.Context, name, edition string) (resume func()) {
	run := func(ctx context.Context, cmd ...string) {
		if out, err := a.docker.Exec(ctx, name, cmd); err != nil {
			log.Printf("%s: %v: %v %s", name, cmd, err, out)
		}
	}
	// Turn saving back on even if the request that asked for the backup is gone.
	later := func(cmd ...string) func() {
		return func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			run(ctx, cmd...)
		}
	}
	if edition == "BEDROCK" {
		run(ctx, "send-command", "save hold")
		// Bedrock finishes the save in progress within moments of "save hold".
		select {
		case <-ctx.Done():
		case <-time.After(5 * time.Second):
		}
		return later("send-command", "save resume")
	}
	run(ctx, "rcon-cli", "save-off")
	run(ctx, "rcon-cli", "save-all", "flush")
	return later("rcon-cli", "save-on")
}

// pruneBackups deletes all but the newest keep backups, and any half-written
// ones (callers hold the server's lock, so none is in progress).
func (a *agent) pruneBackups(id string, keep int) {
	list, err := a.listBackups(id)
	if err != nil {
		log.Printf("prune backups %s: %v", id, err)
		return
	}
	for i := keep; i < len(list); i++ {
		if err := os.Remove(a.backupPath(id, list[i].Name)); err != nil {
			log.Printf("prune backup %s/%s: %v", id, list[i].Name, err)
		}
	}
	partials, _ := filepath.Glob(a.backupPath(id, "*.partial"))
	for _, p := range partials {
		os.Remove(p)
	}
}

// restore replaces the server's world with a backup. A running server is
// stopped for it and started again afterwards.
func (a *agent) restore(ctx context.Context, id, file string) error {
	defer a.lockServer(id)()
	if _, err := os.Stat(a.backupPath(id, file)); errors.Is(err, fs.ErrNotExist) {
		return errBackupNotFound
	} else if err != nil {
		return err
	}
	name := containerName(id)
	info, err := a.docker.InspectContainer(ctx, name)
	if err != nil {
		return err
	}
	wasRunning := info.State.Status == "running" || info.State.Status == "restarting"
	if wasRunning {
		a.setMarker(id, "stopped") // keeps the router from waking it mid-restore
		if err := a.docker.StopContainer(ctx, name, 60); err != nil {
			return err
		}
	}
	// Unpack next to the world first, so a broken backup leaves the world as it was.
	script := strings.Join([]string{
		"set -e",
		"rm -rf /data/.restoring",
		"mkdir /data/.restoring",
		"tar -xzf /backups/" + id + "/" + file + " -C /data/.restoring",
		`find /data -mindepth 1 -maxdepth 1 ! -name .restoring -exec rm -rf {} \;`,
		`find /data/.restoring -mindepth 1 -maxdepth 1 -exec mv {} /data/ \;`,
		"rmdir /data/.restoring",
	}, "\n")
	if err := a.runHelper(ctx, id, true, "sh", "-c", script); err != nil {
		return err
	}
	if wasRunning {
		return a.startServer(ctx, id)
	}
	return nil
}

// runHelper runs cmd in a throwaway container that has the server's world at
// /data and the backups at /backups.
func (a *agent) runHelper(ctx context.Context, id string, writeWorld bool, cmd ...string) error {
	if err := a.ensureImage(ctx, backupImage); err != nil {
		return err
	}
	backups := map[string]any{"Type": "volume", "Source": a.backupMount, "Target": "/backups"}
	if filepath.IsAbs(a.backupMount) {
		backups["Type"] = "bind"
	}
	spec := map[string]any{
		"Image": backupImage,
		"Cmd":   cmd,
		"HostConfig": map[string]any{
			"NetworkMode": "none",
			"Mounts": []map[string]any{
				{"Type": "volume", "Source": containerName(id), "Target": "/data", "ReadOnly": !writeWorld},
				backups,
			},
		},
	}
	code, out, err := a.docker.RunOnce(ctx, "mcb-"+id, spec)
	if err != nil {
		return err
	}
	if code != 0 {
		return fmt.Errorf("%s exited with %d: %s", cmd[0], code, out)
	}
	return nil
}

// watchBackups makes the daily backups.
func (a *agent) watchBackups(ctx context.Context) {
	tick := time.NewTicker(30 * time.Minute)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if err := a.backupDue(ctx); err != nil {
				log.Printf("backup check: %v", err)
			}
		}
	}
}

// backupDue backs up every server whose newest backup is a day old, unless it
// hasn't run since then (its world can't have changed).
func (a *agent) backupDue(ctx context.Context) error {
	var list []containerSummary
	query := url.Values{"all": {"1"}, "filters": {`{"label":["mchost.backups"]}`}}
	if err := a.docker.call(ctx, http.MethodGet, "/containers/json", query, nil, &list); err != nil {
		return err
	}
	for _, c := range list {
		id := c.Labels["mchost.server"]
		if n, _ := strconv.Atoi(c.Labels["mchost.backups"]); n <= 0 || !validID.MatchString(id) || a.hasMarker(id, "suspended") {
			continue
		}
		backups, err := a.listBackups(id)
		if err != nil {
			log.Printf("backup check %s: %v", id, err)
			continue
		}
		if len(backups) > 0 {
			last := backups[0].CreatedAt
			if time.Since(last) < backupEvery {
				continue
			}
			if c.State != "running" && c.State != "restarting" {
				info, err := a.docker.InspectContainer(ctx, containerName(id))
				if err != nil {
					continue
				}
				if stopped, err := time.Parse(time.RFC3339Nano, info.State.FinishedAt); err == nil && stopped.Before(last) {
					continue
				}
			}
		}
		if b, err := a.backup(ctx, id); err != nil {
			log.Printf("daily backup %s: %v", id, err)
		} else {
			log.Printf("daily backup %s: %s (%d bytes)", id, b.Name, b.Size)
		}
	}
	return nil
}

func (a *agent) backupFileFrom(w http.ResponseWriter, r *http.Request) (id, file string, ok bool) {
	if id, ok = a.idFrom(w, r); !ok {
		return "", "", false
	}
	file = r.PathValue("file")
	if !backupFile.MatchString(file) {
		writeError(w, http.StatusBadRequest, "invalid backup name")
		return "", "", false
	}
	return id, file, true
}

func (a *agent) backupsList(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	// Backups outlive the container (e.g. while a plan change rebuilds it).
	keep := 0
	info, err := a.docker.InspectContainer(r.Context(), containerName(id))
	if err == nil {
		keep = backupsKept(info)
	} else if !errors.Is(err, errNotFound) {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	list, err := a.listBackups(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"keep": keep, "backups": list})
}

func (a *agent) backupsCreate(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	// Finish even if the panel stops waiting, so no half-made backup is left.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), time.Hour)
	defer cancel()
	b, err := a.backup(ctx, id)
	if a.handleDockerErr(w, err) {
		return
	}
	log.Printf("backup %s: %s (%d bytes)", id, b.Name, b.Size)
	writeJSON(w, http.StatusCreated, b)
}

func (a *agent) backupDownload(w http.ResponseWriter, r *http.Request) {
	id, file, ok := a.backupFileFrom(w, r)
	if !ok {
		return
	}
	f, err := os.Open(a.backupPath(id, file))
	if errors.Is(err, fs.ErrNotExist) {
		writeError(w, http.StatusNotFound, errBackupNotFound.Error())
		return
	} else if err != nil {
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
	http.ServeContent(w, r, file, fi.ModTime(), f)
}

func (a *agent) backupRestore(w http.ResponseWriter, r *http.Request) {
	id, file, ok := a.backupFileFrom(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), time.Hour)
	defer cancel()
	if a.handleDockerErr(w, a.restore(ctx, id, file)) {
		return
	}
	log.Printf("restored %s from %s", id, file)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
