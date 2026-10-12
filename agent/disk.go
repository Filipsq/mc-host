package main

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// Each server may use the disk space of its plan, as the panel tells the agent
// (diskMb when creating a server, and the whole list now and then through PUT
// /disk-limits). The agent measures every server's files every few minutes.
// Uploads that would go over the limit are refused. A server the game itself
// grows more than a tenth over its limit is stopped, and it can't start (nor
// be woken by a player) until its owner deletes enough files.

const (
	diskCheckEvery = 10 * time.Minute
	diskFresh      = time.Minute // how old a measurement may be when deciding to start a server
)

var (
	errDiskFull = errors.New("the server uses more disk space than its plan allows")
	errQuota    = errors.New("this would go over the plan's disk space")
)

type diskUse struct {
	bytes int64
	at    time.Time
}

// diskLimit is the server's limit in bytes, or 0 if it has none.
func (a *agent) diskLimit(id string) int64 {
	a.diskMu.Lock()
	defer a.diskMu.Unlock()
	return a.diskLimits[id] << 20
}

// hardDiskLimit is where a server gets stopped: a tenth over its limit, so a
// world that grows a little past it while people play isn't cut off at once.
func hardDiskLimit(limit int64) int64 { return limit + limit/10 }

// setDiskLimits stores limits in MB. With replace, servers not listed lose theirs.
func (a *agent) setDiskLimits(limits map[string]int64, replace bool) error {
	a.diskMu.Lock()
	defer a.diskMu.Unlock()
	if replace || a.diskLimits == nil {
		a.diskLimits = map[string]int64{}
	}
	for id, mb := range limits {
		if mb > 0 {
			a.diskLimits[id] = mb
		} else {
			delete(a.diskLimits, id)
		}
	}
	b, err := json.Marshal(a.diskLimits)
	if err != nil {
		return err
	}
	tmp := filepath.Join(a.stateDir, ".disk-limits.json.tmp")
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(a.stateDir, "disk-limits.json"))
}

func (a *agent) loadDiskLimits() {
	a.diskLimits = map[string]int64{}
	b, err := os.ReadFile(filepath.Join(a.stateDir, "disk-limits.json"))
	if err == nil {
		err = json.Unmarshal(b, &a.diskLimits)
	}
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		log.Printf("disk limits: %v", err)
	}
}

// PUT /disk-limits {"limits": {"<id>": <MB>, ...}}: every server's limit, replacing the old list.
func (a *agent) putDiskLimits(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Limits map[string]int64 `json:"limits"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	for id := range body.Limits {
		if !validID.MatchString(id) {
			writeError(w, http.StatusBadRequest, "invalid id")
			return
		}
	}
	if err := a.setDiskLimits(body.Limits, true); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// cachedDiskUse is the last measurement of the server's files, if there is one.
func (a *agent) cachedDiskUse(id string) (diskUse, bool) {
	v, ok := a.diskUsage.Load(id)
	if !ok {
		return diskUse{}, false
	}
	return v.(diskUse), true
}

// diskUsed is how much disk the server's files take, measured again if the
// last measurement is older than maxAge.
func (a *agent) diskUsed(ctx context.Context, id string, maxAge time.Duration) (int64, error) {
	if u, ok := a.cachedDiskUse(id); ok && time.Since(u.at) < maxAge {
		return u.bytes, nil
	}
	return a.measureDisk(ctx, id)
}

// measureDisk adds up the space the server's files take on disk (links aren't followed).
func (a *agent) measureDisk(ctx context.Context, id string) (int64, error) {
	s, err := a.openFiles(ctx, id)
	if err != nil {
		return 0, err
	}
	defer s.Close()
	var total int64
	err = fs.WalkDir(s.root.FS(), ".", func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // removed while we looked; the game changes files all the time
		}
		if fi, err := d.Info(); err == nil {
			if st, ok := fi.Sys().(*syscall.Stat_t); ok {
				total += st.Blocks * 512
			} else {
				total += fi.Size()
			}
		}
		return ctx.Err()
	})
	if err != nil {
		return 0, err
	}
	a.diskUsage.Store(id, diskUse{bytes: total, at: time.Now()})
	return total, nil
}

// remeasureDisk measures again in the background after the owner changed files,
// so the panel soon shows the new figure (and a server they emptied enough may
// start again). One measurement per server at a time.
func (a *agent) remeasureDisk(id string) {
	if _, busy := a.diskMeasuring.LoadOrStore(id, true); busy {
		return
	}
	go func() {
		defer a.diskMeasuring.Delete(id)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		used, err := a.measureDisk(ctx, id)
		if err != nil {
			return
		}
		info, err := a.docker.InspectContainer(ctx, containerName(id))
		running := err == nil && (info.State.Status == "running" || info.State.Status == "restarting")
		a.checkDisk(ctx, id, used, running)
	}()
}

// quotaRoom is how many bytes may be written to replace the file at name
// ("" for new files) without the server going over its limit. Replacing a file
// with one no bigger is always allowed, so an owner over the limit can still
// edit settings. Measured fresh: the owner may have just uploaded something.
func (a *agent) quotaRoom(ctx context.Context, s *serverFiles, name string) (int64, error) {
	limit := a.diskLimit(s.id)
	if limit <= 0 {
		return math.MaxInt64, nil
	}
	used, err := a.measureDisk(ctx, s.id)
	if err != nil {
		return 0, err
	}
	var old int64
	if name != "" {
		if fi, err := s.root.Lstat(name); err == nil && fi.Mode().IsRegular() {
			old = fi.Size()
		}
	}
	return max(old, limit-used+old), nil
}

// overDisk reports whether the server is too far over its limit to start.
func (a *agent) overDisk(ctx context.Context, id string) bool {
	limit := a.diskLimit(id)
	if limit <= 0 || a.volumesDir == "" {
		return false
	}
	used, err := a.diskUsed(ctx, id, diskFresh)
	if err != nil {
		return false // can't tell: don't keep the server down for it
	}
	return used > hardDiskLimit(limit)
}

// checkDisk acts on a measurement: a server too far over its limit is marked
// (and stopped, if it runs); one back under it loses the mark, so a free
// server can be woken by players again.
func (a *agent) checkDisk(ctx context.Context, id string, used int64, running bool) {
	limit := a.diskLimit(id)
	if limit <= 0 || used <= hardDiskLimit(limit) {
		if a.hasMarker(id, "disk") {
			_ = os.Remove(a.markerPath(id, "disk"))
		}
		return
	}
	if !a.hasMarker(id, "disk") {
		a.setMarker(id, "disk")
		log.Printf("disk: %s uses %d MB, its limit is %d MB", id, used>>20, limit>>20)
	}
	if running {
		if err := a.docker.StopContainer(ctx, containerName(id), 60); err != nil && !errors.Is(err, errNotFound) {
			log.Printf("disk: stop %s: %v", id, err)
		}
	}
}

// watchDisk measures every server's files now and then and enforces the limits.
func (a *agent) watchDisk(ctx context.Context) {
	if a.volumesDir == "" {
		return
	}
	for {
		var list []containerSummary
		query := url.Values{"all": {"1"}, "filters": {`{"label":["mchost.server"]}`}}
		if err := a.docker.call(ctx, http.MethodGet, "/containers/json", query, nil, &list); err != nil {
			log.Printf("disk: list servers: %v", err)
		}
		for _, c := range list {
			id := c.Labels["mchost.server"]
			used, err := a.measureDisk(ctx, id)
			if err != nil {
				if !errors.Is(err, errNotFound) {
					log.Printf("disk: measure %s: %v", id, err)
				}
				continue
			}
			a.checkDisk(ctx, id, used, c.State == "running" || c.State == "restarting")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(diskCheckEvery):
		}
	}
}

// diskInfo is what the status and stats endpoints say about a server's disk.
func (a *agent) diskInfo(id string) map[string]int64 {
	info := map[string]int64{}
	if u, ok := a.cachedDiskUse(id); ok {
		info["diskMb"] = u.bytes >> 20
	}
	if limit := a.diskLimit(id); limit > 0 {
		info["diskLimitMb"] = limit >> 20
	}
	return info
}
