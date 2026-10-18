package main

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

// GET /stats: the machine and every server on it at a glance, for the admin panel.

type serverStats struct {
	ID           string `json:"id"`
	State        string `json:"state"` // as in GET /servers/{id}
	Health       string `json:"health,omitempty"`
	StopReason   string `json:"stopReason,omitempty"`
	MemoryMb     int    `json:"memoryMb"`               // the plan's memory
	MemoryUsedMb *int   `json:"memoryUsedMb,omitempty"` // what it uses right now, while running
	DiskMb       *int64 `json:"diskMb,omitempty"`       // what its files take, as last measured
	DiskLimitMb  int64  `json:"diskLimitMb,omitempty"`  // what its plan allows; 0 for no limit
	Players      *int   `json:"players,omitempty"`      // online at the last metrics sample, while running
	MaxPlayers   int    `json:"maxPlayers,omitempty"`   // when the server reports it
}

type hostStats struct {
	CPUs              int        `json:"cpus"`
	Load              [3]float64 `json:"load"` // 1, 5 and 15 minute load averages
	MemoryTotalMb     int64      `json:"memoryTotalMb"`
	MemoryAvailableMb int64      `json:"memoryAvailableMb"`
	DiskTotalMb       int64      `json:"diskTotalMb"`
	DiskFreeMb        int64      `json:"diskFreeMb"`
}

func (a *agent) stats(w http.ResponseWriter, r *http.Request) {
	var list []containerSummary
	query := url.Values{"all": {"1"}, "filters": {`{"label":["mchost.server"]}`}}
	if a.handleDockerErr(w, a.docker.call(r.Context(), http.MethodGet, "/containers/json", query, nil, &list)) {
		return
	}
	servers := make([]serverStats, len(list))
	var wg sync.WaitGroup
	slots := make(chan struct{}, 8) // Docker answers stats slowly; don't ask about all at once
	for i, c := range list {
		wg.Add(1)
		go func() {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			servers[i] = a.serverStats(r.Context(), c)
		}()
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, map[string]any{
		"memoryLimitMb": a.memoryCap(),
		"memoryHeldMb":  a.memoryInUse(list, ""),
		"host":          a.hostStats(),
		"servers":       servers,
	})
}

func (a *agent) serverStats(ctx context.Context, c containerSummary) serverStats {
	id := c.Labels["mchost.server"]
	s := serverStats{ID: id, State: c.State, DiskLimitMb: a.diskLimit(id) >> 20}
	s.MemoryMb, _ = strconv.Atoi(c.Labels["mchost.memory"])
	if u, ok := a.cachedDiskUse(id); ok {
		mb := u.bytes >> 20
		s.DiskMb = &mb
	}
	info, err := a.docker.InspectContainer(ctx, containerName(id))
	if err != nil {
		return s
	}
	s.State = info.State.Status
	if info.State.Health != nil {
		s.Health = info.State.Health.Status
	}
	if s.State != "running" && s.State != "restarting" {
		s.StopReason = a.stopReason(id, info)
		return s
	}
	s.Players, s.MaxPlayers = a.playersOnline(id)
	var st struct {
		Memory struct {
			Usage int64            `json:"usage"`
			Stats map[string]int64 `json:"stats"`
		} `json:"memory_stats"`
	}
	query := url.Values{"stream": {"false"}, "one-shot": {"true"}}
	if err := a.docker.call(ctx, http.MethodGet, "/containers/"+containerName(id)+"/stats", query, nil, &st); err == nil {
		mb := int(memoryUsed(st.Memory.Usage, st.Memory.Stats) >> 20)
		s.MemoryUsedMb = &mb
	}
	return s
}

// memoryUsed works it out like `docker stats`: page cache the kernel can drop
// doesn't count. Cgroup v1 reports it as total_inactive_file, v2 as inactive_file.
func memoryUsed(usage int64, stats map[string]int64) int64 {
	if v, v1 := stats["total_inactive_file"]; v1 && v < usage {
		return usage - v
	}
	if v := stats["inactive_file"]; v < usage {
		return usage - v
	}
	return usage
}

func (a *agent) hostStats() hostStats {
	h := hostStats{CPUs: runtime.NumCPU()}
	// /proc isn't namespaced for these: inside the agent's container they describe the machine.
	h.MemoryTotalMb, h.MemoryAvailableMb, _ = readMeminfo()
	if b, err := os.ReadFile("/proc/loadavg"); err == nil {
		for i, v := range strings.Fields(string(b)) {
			if i < 3 {
				h.Load[i], _ = strconv.ParseFloat(v, 64)
			}
		}
	}
	// The disk the worlds live on (the volumes are mounted from the machine).
	dir := a.volumesDir
	if dir == "" {
		dir = a.backupDir
	}
	var fs syscall.Statfs_t
	if dir != "" && syscall.Statfs(dir, &fs) == nil {
		h.DiskTotalMb = int64(fs.Blocks) * fs.Bsize >> 20
		h.DiskFreeMb = int64(fs.Bavail) * fs.Bsize >> 20
	}
	return h
}

// playersOnline is who the metrics sampler last saw online; nil before its first sample.
func (a *agent) playersOnline(id string) (*int, int) {
	v, ok := a.metrics.Load(id)
	if !ok {
		return nil, 0
	}
	m := v.(*serverMetrics)
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.samples) == 0 {
		return nil, 0
	}
	n := m.count
	return &n, m.maxPlayers
}
