package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestStartFreeServerOverbooked(t *testing.T) {
	tmp := t.TempDir()
	sock := filepath.Join(tmp, "docker.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	labels := func(id, mb, autostop string) map[string]string {
		return map[string]string{"mchost.server": id, "mchost.memory": mb, "mchost.autostop": autostop}
	}
	free := labels("free1234", "2048", "true")
	list := []map[string]any{
		{"State": "running", "Labels": labels("paidup12", "3072", "false")},
		{"State": "exited", "Labels": labels("paiddown", "3072", "false")}, // stopped by its owner
		{"State": "exited", "Labels": free},
	}
	started := 0
	fake := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/containers/json":
			writeJSON(w, 200, list)
		case "/containers/mc-free1234/json":
			writeJSON(w, 200, map[string]any{"State": map[string]any{"Status": "exited"}, "Config": map[string]any{"Labels": free}})
		case "/containers/mc-free1234/start":
			started++
			w.WriteHeader(http.StatusNoContent)
		default:
			writeError(w, 404, "no such container")
		}
	})}
	go fake.Serve(ln)
	t.Cleanup(func() { fake.Close() })

	old := meminfoPath
	t.Cleanup(func() { meminfoPath = old })
	meminfoPath = filepath.Join(tmp, "meminfo")
	available := func(mb int) {
		os.WriteFile(meminfoPath, fmt.Appendf(nil, "MemTotal:        8000000 kB\nMemFree:  100 kB\nMemAvailable:    %d kB\n", mb<<10), 0o644)
	}
	available(4096)
	a := &agent{docker: NewDocker(sock), stateDir: tmp, memoryLimit: 5120, overbook: 1}
	ctx := context.Background()

	// Not overbooked: the stopped paid server keeps its 3 GB, so 2 GB more doesn't fit in 5.
	if err := a.startServer(ctx, "free1234"); !errors.Is(err, errFull) {
		t.Fatalf("without overbooking: %v", err)
	}

	// Overbooked 1.5 times: only running servers count, against 7.5 GB.
	a.overbook = 1.5
	if err := a.startServer(ctx, "free1234"); err != nil || started != 1 {
		t.Fatalf("overbooked, with memory free: %v (started %d)", err, started)
	}
	// ...as long as the machine really has the memory, with room to spare.
	available(2048 + freeMemoryMarginMb - 1)
	if err := a.startServer(ctx, "free1234"); !errors.Is(err, errFull) {
		t.Fatalf("overbooked, machine short of memory: %v", err)
	}
	// Running servers' plans still can't go past the factor.
	available(8000)
	list[1]["State"] = "running"
	if err := a.startServer(ctx, "free1234"); !errors.Is(err, errFull) {
		t.Fatalf("overbooked, over the factor: %v", err)
	}
	if a.memoryCap() != 7680 {
		t.Fatalf("cap = %d", a.memoryCap())
	}
}
