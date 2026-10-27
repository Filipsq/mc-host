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

func TestHalloween(t *testing.T) {
	skyMapWait = 0
	sock := filepath.Join(t.TempDir(), "docker.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	markers := map[string]bool{}
	var cmd []string
	fake := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.URL.Path {
		case "/containers/mc-hw12345/exec":
			var body struct{ Cmd []string }
			json.NewDecoder(r.Body).Decode(&body)
			cmd = body.Cmd
			writeJSON(w, 201, map[string]string{"Id": "e1"})
		case "/exec/e1/start":
			out := ""
			if cmd[0] == "touch" {
				markers[cmd[1]] = true
			} else if markers[cmd[len(cmd)-1]] {
				out = "yes\n"
			}
			w.Write(frame(1, out))
		default:
			writeError(w, 404, "no such container")
		}
	})}
	go fake.Serve(ln)
	t.Cleanup(func() { fake.Close() })
	a := &agent{docker: NewDocker(sock), token: "t"}

	var sent []string
	age, fail := "The time is 40", ""
	run := func(c string) (string, error) {
		sent = append(sent, c)
		if fail != "" && strings.HasPrefix(c, fail) {
			return "", context.DeadlineExceeded
		}
		if c == "time query gametime" {
			return age, nil
		}
		return "", nil
	}
	build := append(append(append([]string{"time query gametime"}, halloweenSpawn...), halloweenBuild...), halloweenRules...)

	// A new world, nobody on: the square goes in, then the marker; no pumpkin heads yet.
	m := &serverMetrics{}
	a.halloween(context.Background(), "mc-hw12345", "", m, run, 0)
	if !slices.Equal(sent, build) || !m.halloween || !markers["/data/world/"+halloweenMarker] {
		t.Fatalf("sent %q, done %v, markers %v", sent, m.halloween, markers)
	}
	// Players on: only the pumpkin heads, never the square twice.
	sent = nil
	a.halloween(context.Background(), "mc-hw12345", "", m, run, 2)
	if !slices.Equal(sent, halloweenHeads) {
		t.Fatalf("with players sent %q", sent)
	}
	// Started again: the marker says it's done.
	m, sent = &serverMetrics{}, nil
	a.halloween(context.Background(), "mc-hw12345", "", m, run, 0)
	if len(sent) != 0 || !m.halloween {
		t.Fatalf("rebuilt after a restart: %q", sent)
	}

	// An uploaded world, long played, is left alone.
	m, sent, age = &serverMetrics{}, nil, "The time is 9123456"
	a.halloween(context.Background(), "mc-hw12345", "uploaded", m, run, 0)
	if slices.Contains(sent, halloweenBuild[0]) || !m.halloween || !markers["/data/uploaded/"+halloweenMarker] {
		t.Fatalf("touched an uploaded world: %q", sent)
	}

	// A build cut short finishes next time without asking the age again.
	m, sent, age = &serverMetrics{}, nil, "The time is 100"
	fail = "setblock"
	a.halloween(context.Background(), "mc-hw12345", "world-2", m, run, 0)
	if m.halloween {
		t.Fatal("done after a failed build")
	}
	fail, sent, age = "", nil, "The time is 99999"
	a.halloween(context.Background(), "mc-hw12345", "world-2", m, run, 0)
	if slices.Contains(sent, "time query gametime") || !slices.Contains(sent, halloweenBuild[len(halloweenBuild)-1]) || !m.halloween {
		t.Fatalf("second try sent %q", sent)
	}
}

func TestHalloweenSpec(t *testing.T) {
	a := &agent{}
	req := createRequest{ID: "hw123456", Name: "X", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 25570, Kind: "halloween", Version: "1.21.11", Crossplay: true, Hostname: "hw.mchost.pl"}
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	spec := a.containerSpec(req, images["JAVA"])
	env := specEnv(spec)
	for _, want := range []string{"TYPE=PAPER\n", "VERSION=1.21.11\n"} {
		if !strings.Contains(env, want) {
			t.Errorf("env missing %q:\n%s", want, env)
		}
	}
	if labels := spec["Labels"].(map[string]string); labels["mchost.halloween"] != "true" {
		t.Errorf("labels %v", labels)
	}
}
