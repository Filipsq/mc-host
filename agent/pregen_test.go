package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
)

func TestPregen(t *testing.T) {
	sock := filepath.Join(t.TempDir(), "docker.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	marker := false
	var cmd []string
	fake := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.URL.Path {
		case "/containers/mc-pack1234/exec":
			var body struct{ Cmd []string }
			json.NewDecoder(r.Body).Decode(&body)
			cmd = body.Cmd
			writeJSON(w, 201, map[string]string{"Id": "e1"})
		case "/exec/e1/start":
			out := ""
			switch {
			case cmd[0] == "touch":
				marker = true
			case marker:
				out = "yes\n"
			}
			w.Write(frame(1, out))
		case "/exec/e1/json":
			writeJSON(w, 200, map[string]int{"ExitCode": 0})
		default:
			writeError(w, 404, "no such container")
		}
	})}
	go fake.Serve(ln)
	t.Cleanup(func() { fake.Close() })

	a := &agent{docker: NewDocker(sock), token: "t"}
	m := &serverMetrics{}
	var sent []string
	run := func(c string) (string, error) { sent = append(sent, c); return "", nil }
	step := func(players int, want ...string) {
		t.Helper()
		sent = nil
		a.pregen(context.Background(), "mc-pack1234", m, run, players)
		if !slices.Equal(sent, want) {
			t.Fatalf("with %d players sent %q, want %q", players, sent, want)
		}
	}

	step(0, "chunky silent", "chunky spawn", "chunky radius "+pregenRadius, "chunky start")
	step(0) // nothing new
	step(2, "chunky pause")
	step(1)
	step(0, "chunky continue")
	// The server started again (the sampler clears the state): it only continues.
	m.pregen = ""
	step(0, "chunky continue")
	if !marker || !strings.Contains(strings.Join(cmd, " "), pregenMarker) {
		t.Errorf("marker %v, last exec %q", marker, cmd)
	}
}
