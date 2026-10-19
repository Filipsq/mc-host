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
	// ...as long as the machine really has the memory, with room to spare for the running one.
	available(2048 + freeMemoryMarginMb - 1)
	if err := a.startServer(ctx, "free1234"); !errors.Is(err, errFull) {
		t.Fatalf("overbooked, machine short of memory: %v", err)
	}
	// Alone on the machine it only keeps 10% of it (781 MB of 7812) spare.
	list[0]["State"] = "exited"
	available(2048 + 781)
	if err := a.startServer(ctx, "free1234"); err != nil {
		t.Fatalf("overbooked, alone on the machine: %v", err)
	}
	available(2048 + 780)
	if err := a.startServer(ctx, "free1234"); !errors.Is(err, errFull) {
		t.Fatalf("overbooked, alone, short of memory: %v", err)
	}
	list[0]["State"] = "running"
	// Running servers' plans may go past the factor while the memory is really free.
	available(8000)
	list[1]["State"] = "running"
	if err := a.startServer(ctx, "free1234"); err != nil {
		t.Fatalf("overbooked, over the factor with memory free: %v", err)
	}
	if a.memoryCap() != 7680 {
		t.Fatalf("cap = %d", a.memoryCap())
	}
}

func TestSmallMachineFitsTwoFreeServers(t *testing.T) {
	tmp := t.TempDir()
	sock := filepath.Join(tmp, "docker.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	labels := func(id string) map[string]string {
		return map[string]string{"mchost.server": id, "mchost.memory": "1536", "mchost.autostop": "true"}
	}
	list := []map[string]any{{"State": "running", "Labels": labels("first123")}}
	fake := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/containers/json":
			writeJSON(w, 200, list)
		case "/containers/mc-second12/json":
			writeJSON(w, 200, map[string]any{"State": map[string]any{"Status": "exited"}, "Config": map[string]any{"Labels": labels("second12")}})
		case "/containers/mc-second12/start":
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
		os.WriteFile(meminfoPath, fmt.Appendf(nil, "MemTotal:        3800000 kB\nMemAvailable:    %d kB\n", mb<<10), 0o644)
	}
	a := &agent{docker: NewDocker(sock), stateDir: tmp, memoryLimit: 2560, overbook: 2, freeMemory: 1536}
	ctx := context.Background()

	// One free server running: the second needs its starting heap plus a small margin.
	available(initialHeapMb + smallMachineMarginMb)
	if err := a.startServer(ctx, "second12"); err != nil {
		t.Fatalf("second free server: %v", err)
	}
	available(initialHeapMb + smallMachineMarginMb - 1)
	if err := a.startServer(ctx, "second12"); !errors.Is(err, errFull) {
		t.Fatalf("short of memory: %v", err)
	}

	// Free servers get the machine's smaller memory and some swap; paid ones keep their plan.
	spec := a.containerSpec(createRequest{ID: "second12", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 30001, Autostop: true}, "img")
	hc := spec["HostConfig"].(map[string]any)
	if hc["Memory"] != int64(1536+512)<<20 || hc["MemorySwap"] != int64(1536+512+freeSwapMb)<<20 {
		t.Fatalf("free server memory %v swap %v", hc["Memory"], hc["MemorySwap"])
	}
	if spec["Labels"].(map[string]string)["mchost.memory"] != "1536" {
		t.Fatalf("label %v", spec["Labels"])
	}
	spec = a.containerSpec(createRequest{ID: "paid1234", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 30002}, "img")
	hc = spec["HostConfig"].(map[string]any)
	if hc["Memory"] != int64(2048+512)<<20 || hc["MemorySwap"] != hc["Memory"] {
		t.Fatalf("paid server memory %v swap %v", hc["Memory"], hc["MemorySwap"])
	}
}
