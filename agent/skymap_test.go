package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
)

func TestSkyMap(t *testing.T) {
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
		case "/containers/mc-sky12345/exec":
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
	answers := map[string]string{} // command prefix -> reply
	fail := ""
	run := func(c string) (string, error) {
		sent = append(sent, c)
		if fail != "" && strings.HasPrefix(c, fail) {
			return "", errors.New("connection reset")
		}
		for p, out := range answers {
			if strings.HasPrefix(c, p) {
				return out, nil
			}
		}
		return "", nil
	}
	build := append(append(append([]string{}, skyMapLoad...), skyMapEmpty), append(append([]string{}, skyMapBuild...), skyMapRules...)...)

	// Chunks not loaded yet: nothing built, asked again next time.
	m := &serverMetrics{}
	answers["execute"] = "That position is not loaded"
	a.skyMap(context.Background(), "mc-sky12345", "", m, run)
	if m.skyMap || slices.Contains(sent, skyMapBuild[0]) {
		t.Fatalf("built before the chunks loaded: %q", sent)
	}

	// A new empty world: the islands go in, then the marker.
	answers["execute"] = "Test passed"
	sent = nil
	a.skyMap(context.Background(), "mc-sky12345", "", m, run)
	if !slices.Equal(sent, build) || !m.skyMap || !markers["/data/world/"+skyMapMarker] {
		t.Fatalf("sent %q, done %v, markers %v", sent, m.skyMap, markers)
	}
	sent = nil
	a.skyMap(context.Background(), "mc-sky12345", "", m, run)
	if len(sent) != 0 {
		t.Fatalf("built twice: %q", sent)
	}
	// Started again: the marker says it's done.
	m = &serverMetrics{}
	a.skyMap(context.Background(), "mc-sky12345", "", m, run)
	if len(sent) != 0 || !m.skyMap {
		t.Fatalf("rebuilt after a restart: %q", sent)
	}

	// An uploaded world with ground at spawn is left alone.
	m = &serverMetrics{}
	answers["execute"] = "Test failed"
	a.skyMap(context.Background(), "mc-sky12345", "uploaded", m, run)
	if slices.Contains(sent, skyMapBuild[0]) || !m.skyMap || !markers["/data/uploaded/"+skyMapMarker] {
		t.Fatalf("touched an uploaded world: %q", sent)
	}

	// A build cut short finishes next time without asking again (its own islands would say no).
	m, sent = &serverMetrics{}, nil
	answers["execute"] = "Test passed"
	fail = "setblock"
	a.skyMap(context.Background(), "mc-sky12345", "world-2", m, run)
	if m.skyMap {
		t.Fatal("done after a failed build")
	}
	answers["execute"], fail, sent = "Test failed", "", nil
	a.skyMap(context.Background(), "mc-sky12345", "world-2", m, run)
	if slices.Contains(sent, skyMapEmpty) || !slices.Contains(sent, skyMapBuild[len(skyMapBuild)-1]) || !m.skyMap {
		t.Fatalf("second try sent %q", sent)
	}
}

func TestSkyMapSpec(t *testing.T) {
	a := &agent{}
	req := createRequest{ID: "sky12345", Name: "X", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 25570, Kind: "skymap", Version: "1.21.11", LevelType: "amplified", Hostname: "sky.mchost.pl"}
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	spec := a.containerSpec(req, images["JAVA"])
	env := specEnv(spec)
	for _, want := range []string{"TYPE=PAPER\n", "VERSION=1.21.11\n", "LEVEL_TYPE=flat\n", "GENERATOR_SETTINGS=" + skyMapGenerator + "\n", "MODRINTH_PROJECTS=\n"} {
		if !strings.Contains(env, want) {
			t.Errorf("env missing %q:\n%s", want, env)
		}
	}
	if strings.Contains(env, "amplified") {
		t.Errorf("the empty world must not get another level type:\n%s", env)
	}
	if spec["Labels"].(map[string]string)["mchost.skymap"] != "true" {
		t.Error("no skymap label")
	}
	var g map[string]any
	if err := json.Unmarshal([]byte(skyMapGenerator), &g); err != nil {
		t.Fatal(err)
	}
}
