package main

import (
	"encoding/json"
	"net"
	"net/http"
	"path/filepath"
	"testing"
)

func TestStats(t *testing.T) {
	tmp := t.TempDir()
	sock := filepath.Join(tmp, "docker.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	labels := func(id, mb, autostop string) map[string]string {
		return map[string]string{"mchost.server": id, "mchost.memory": mb, "mchost.autostop": autostop}
	}
	inspect := func(status string, exit int, health string, l map[string]string) map[string]any {
		state := map[string]any{"Status": status, "ExitCode": exit}
		if health != "" {
			state["Health"] = map[string]string{"Status": health}
		}
		return map[string]any{"State": state, "Config": map[string]any{"Labels": l}}
	}
	paid, free := labels("paid1234", "3072", "false"), labels("free1234", "2048", "true")
	fake := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/containers/json":
			writeJSON(w, 200, []map[string]any{{"State": "running", "Labels": paid}, {"State": "exited", "Labels": free}})
		case "/containers/mc-paid1234/json":
			writeJSON(w, 200, inspect("running", 0, "healthy", paid))
		case "/containers/mc-free1234/json":
			writeJSON(w, 200, inspect("exited", 1, "", free))
		case "/containers/mc-paid1234/stats":
			if r.URL.Query().Get("stream") != "false" {
				t.Errorf("stats must not stream")
			}
			writeJSON(w, 200, map[string]any{"memory_stats": map[string]any{
				"usage": 1600 << 20, "stats": map[string]int64{"inactive_file": 100 << 20},
			}})
		default:
			writeError(w, 404, "no such container")
		}
	})}
	go fake.Serve(ln)
	t.Cleanup(func() { fake.Close() })

	a := &agent{docker: NewDocker(sock), token: "t", stateDir: tmp, memoryLimit: 8192, backupDir: tmp}
	rec := call(t, a.routes(), "GET", "/stats", nil)
	if rec.Code != 200 {
		t.Fatalf("stats: %d %s", rec.Code, rec.Body)
	}
	var got struct {
		MemoryLimitMb int           `json:"memoryLimitMb"`
		MemoryHeldMb  int           `json:"memoryHeldMb"`
		Host          hostStats     `json:"host"`
		Servers       []serverStats `json:"servers"`
	}
	json.Unmarshal(rec.Body.Bytes(), &got)
	// The paid server holds its memory; the free one is asleep (crashed, here) and doesn't.
	if got.MemoryLimitMb != 8192 || got.MemoryHeldMb != 3072 {
		t.Fatalf("memory = %d of %d", got.MemoryHeldMb, got.MemoryLimitMb)
	}
	paidGot, freeGot := got.Servers[0], got.Servers[1]
	if paidGot.MemoryUsedMb == nil || *paidGot.MemoryUsedMb != 1500 {
		t.Fatalf("memory used = %v", paidGot.MemoryUsedMb)
	}
	paidGot.MemoryUsedMb = nil
	want := []serverStats{
		{ID: "paid1234", State: "running", Health: "healthy", MemoryMb: 3072},
		{ID: "free1234", State: "exited", StopReason: "crashed", MemoryMb: 2048},
	}
	if len(got.Servers) != 2 || paidGot != want[0] || freeGot != want[1] {
		t.Fatalf("servers = %+v", got.Servers)
	}
	if got.Host.CPUs < 1 || got.Host.MemoryTotalMb <= 0 || got.Host.DiskTotalMb <= 0 || got.Host.DiskFreeMb > got.Host.DiskTotalMb {
		t.Fatalf("host = %+v", got.Host)
	}
}

func TestMemoryUsed(t *testing.T) {
	const mb = 1 << 20
	cases := []struct {
		name  string
		usage int64
		stats map[string]int64
		want  int64
	}{
		// Cgroup v1 reports both; only the hierarchy total counts, once.
		{"v1", 1600 * mb, map[string]int64{"inactive_file": 100 * mb, "total_inactive_file": 100 * mb}, 1500 * mb},
		{"v2", 1600 * mb, map[string]int64{"inactive_file": 100 * mb}, 1500 * mb},
		{"nothing to drop", 1 * mb, map[string]int64{"total_inactive_file": 0}, 1 * mb},
		{"bogus cache", 1 * mb, map[string]int64{"inactive_file": 5 * mb}, 1 * mb},
	}
	for _, c := range cases {
		if got := memoryUsed(c.usage, c.stats); got != c.want {
			t.Errorf("%s: %d, want %d", c.name, got>>20, c.want>>20)
		}
	}
}
