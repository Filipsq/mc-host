package main

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
)

// Every function the data pack calls is in it, and its JSON reads.
func TestMinigamesPack(t *testing.T) {
	have := map[string]bool{}
	var texts []string
	err := fs.WalkDir(minigamesPack, "minigames", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := minigamesPack.ReadFile(name)
		if err != nil {
			return err
		}
		switch {
		case strings.HasSuffix(name, ".mcfunction"):
			have["mg:"+strings.TrimSuffix(strings.TrimPrefix(name, "minigames/data/mg/function/"), ".mcfunction")] = true
		case strings.HasSuffix(name, ".json") || strings.HasSuffix(name, ".mcmeta"):
			var v any
			if err := json.Unmarshal(b, &v); err != nil {
				t.Errorf("%s: %v", name, err)
			}
		default:
			t.Errorf("unexpected file %s", name)
		}
		texts = append(texts, string(b))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	called := regexp.MustCompile(`(?:function |"function": ")(mg:[a-z_/0-9]+)`)
	for _, text := range texts {
		for _, m := range called.FindAllStringSubmatch(text, -1) {
			if !have[m[1]] {
				t.Errorf("%s is called but not in the pack", m[1])
			}
		}
	}
	for _, f := range []string{"mg:load", "mg:tick", "mg:build"} {
		if !have[f] {
			t.Errorf("no %s", f)
		}
	}
	for _, tag := range []string{"load", "tick"} {
		if _, err := minigamesPack.ReadFile("minigames/data/minecraft/tags/function/" + tag + ".json"); err != nil {
			t.Error(err)
		}
	}
}

func TestPrepareMinigames(t *testing.T) {
	_, a, data := filesAgent(t)
	pack := filepath.Join(data, "world", minigamesPackDir)

	a.prepareMinigames(context.Background(), "abc12345", "vanilla", "world")
	if _, err := os.Stat(pack); err == nil {
		t.Fatal("a plain server got the minigames")
	}

	// A file left from an older pack goes; the pack's files are all there.
	os.MkdirAll(filepath.Join(pack, "data"), 0o755)
	os.WriteFile(filepath.Join(pack, "data", "old.mcfunction"), []byte("say old"), 0o644)
	a.prepareMinigames(context.Background(), "abc12345", "minigames", "world")
	if _, err := os.Stat(filepath.Join(pack, "data", "old.mcfunction")); err == nil {
		t.Error("an old file stayed")
	}
	for _, f := range []string{"pack.mcmeta", "data/minecraft/tags/function/tick.json", "data/mg/function/build/lobby.mcfunction", "data/mg/advancement/hide_hit.json"} {
		want, _ := minigamesPack.ReadFile("minigames/" + f)
		if got, err := os.ReadFile(filepath.Join(pack, f)); err != nil || string(got) != string(want) {
			t.Errorf("%s: %v", f, err)
		}
	}
}

func TestMinigames(t *testing.T) {
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
		case "/containers/mc-mini1234/exec":
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
	build := slices.Concat(minigamesLoad, []string{minigamesEmpty, "function mg:build"}, minigamesKeep, minigamesRules)

	// Chunks not loaded yet: nothing built, asked again next time.
	m := &serverMetrics{}
	answers["execute"] = "That position is not loaded"
	a.minigames(context.Background(), "mc-mini1234", "", m, run)
	if m.minigames || slices.Contains(sent, "function mg:build") {
		t.Fatalf("built before the chunks loaded: %q", sent)
	}

	// A new empty world: the map goes in, then the marker and the rules.
	answers["execute"] = "Test passed"
	answers["function"] = "Executed 512 commands from function 'mg:build'"
	sent = nil
	a.minigames(context.Background(), "mc-mini1234", "", m, run)
	if !slices.Equal(sent, build) || !m.minigames || !markers["/data/world/"+minigamesMarker] {
		t.Fatalf("sent %q, done %v, markers %v", sent, m.minigames, markers)
	}
	sent = nil
	a.minigames(context.Background(), "mc-mini1234", "", m, run)
	if len(sent) != 0 {
		t.Fatalf("ran twice in one start: %q", sent)
	}
	// Started again: only the rules.
	m = &serverMetrics{}
	a.minigames(context.Background(), "mc-mini1234", "", m, run)
	if !slices.Equal(sent, minigamesRules) || !m.minigames {
		t.Fatalf("after a restart sent %q", sent)
	}

	// An uploaded world with ground at spawn is left alone.
	m, sent = &serverMetrics{}, nil
	answers["execute"] = "Test failed"
	a.minigames(context.Background(), "mc-mini1234", "uploaded", m, run)
	if slices.Contains(sent, "function mg:build") || !m.minigames || !markers["/data/uploaded/"+minigamesMarker] {
		t.Fatalf("touched an uploaded world: %q", sent)
	}

	// The data pack didn't load: no marker, so the next start tries again.
	m, sent = &serverMetrics{}, nil
	answers["execute"] = "Test passed"
	answers["function"] = "Unknown function mg:build"
	a.minigames(context.Background(), "mc-mini1234", "broken", m, run)
	if !m.minigames || markers["/data/broken/"+minigamesMarker] {
		t.Fatalf("marked a world with no map: %v %v", m.minigames, markers)
	}

	// A build cut short finishes next time without asking again.
	m, sent = &serverMetrics{}, nil
	answers["function"] = "Executed 512 commands"
	fail = "function"
	a.minigames(context.Background(), "mc-mini1234", "world-2", m, run)
	if m.minigames {
		t.Fatal("done after a failed build")
	}
	answers["execute"], fail, sent = "Test failed", "", nil
	a.minigames(context.Background(), "mc-mini1234", "world-2", m, run)
	if slices.Contains(sent, minigamesEmpty) || !slices.Contains(sent, "function mg:build") || !m.minigames || !markers["/data/world-2/"+minigamesMarker] {
		t.Fatalf("second try sent %q", sent)
	}
}

func TestMinigamesSpec(t *testing.T) {
	a := &agent{}
	off, protect := false, 16
	req := createRequest{ID: "mini1234", Name: "X", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 25570, Kind: "minigames", Version: "1.21.11", LevelType: "amplified", Hostname: "mini.mchost.pl", PVP: &off, SpawnProtection: &protect}
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	spec := a.containerSpec(req, images["JAVA"])
	env := specEnv(spec)
	for _, want := range []string{"TYPE=PAPER\n", "VERSION=1.21.11\n", "LEVEL_TYPE=flat\n", "GENERATOR_SETTINGS=" + skyMapGenerator + "\n", "PVP=true\n", "SPAWN_PROTECTION=0\n"} {
		if !strings.Contains(env, want) {
			t.Errorf("env missing %q:\n%s", want, env)
		}
	}
	if strings.Contains(env, "amplified") {
		t.Errorf("the empty world must not get another level type:\n%s", env)
	}
	if spec["Labels"].(map[string]string)["mchost.minigames"] != "true" {
		t.Error("no minigames label")
	}
}
