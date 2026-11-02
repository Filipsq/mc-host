package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// crossplayAgent is an agent whose server abc12345 has crossplay set as given,
// with GeyserMC played by a local server that counts its downloads.
func crossplayAgent(t *testing.T, crossplay bool) (*agent, string, *atomic.Int32) {
	t.Helper()
	tmp := t.TempDir()
	volumes := filepath.Join(tmp, "volumes")
	data := filepath.Join(volumes, "mc-abc12345", "_data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	sock := filepath.Join(tmp, "docker.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	labels := map[string]string{"mchost.server": "abc12345"}
	if crossplay {
		labels["mchost.crossplay"] = "true"
	}
	fake := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/volumes/mc-abc12345":
			writeJSON(w, 200, map[string]string{"Mountpoint": data})
		case "/containers/mc-abc12345/json":
			writeJSON(w, 200, map[string]any{"Config": map[string]any{"Labels": labels}})
		default:
			writeError(w, 404, "not found")
		}
	})}
	go fake.Serve(ln)
	t.Cleanup(func() { fake.Close() })

	var downloads atomic.Int32
	geyser := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downloads.Add(1)
		w.Write([]byte("jar from " + r.URL.Path))
	}))
	t.Cleanup(geyser.Close)
	old := crossplayJars
	crossplayJars = []crossplayJar{{geyser.URL + "/geyser", "mchost-geyser.jar"}, {geyser.URL + "/floodgate", "mchost-floodgate.jar"}}
	t.Cleanup(func() { crossplayJars = old })

	a := &agent{docker: NewDocker(sock), volumesDir: volumes, stateDir: filepath.Join(tmp, "state")}
	return a, data, &downloads
}

func TestFixCrossplayPutsGeyserAndFloodgateIn(t *testing.T) {
	a, data, downloads := crossplayAgent(t, true)
	a.fixCrossplay(context.Background(), "abc12345")
	for _, name := range []string{"mchost-geyser.jar", "mchost-floodgate.jar"} {
		b, err := os.ReadFile(filepath.Join(data, "plugins", name))
		if err != nil || !strings.HasPrefix(string(b), "jar from /") {
			t.Fatalf("%s: %q %v", name, b, err)
		}
	}
	// The next start uses the agent's copies.
	a.fixCrossplay(context.Background(), "abc12345")
	if n := downloads.Load(); n != 2 {
		t.Fatalf("downloads = %d, want 2", n)
	}
}

func TestFixCrossplayRefreshesOldCopiesInTheBackground(t *testing.T) {
	a, _, downloads := crossplayAgent(t, true)
	a.fixCrossplay(context.Background(), "abc12345")
	old := time.Now().Add(-2 * crossplayRefresh)
	for _, j := range crossplayJars {
		os.Chtimes(filepath.Join(a.crossplayCacheDir(), j.file), old, old)
	}
	a.fixCrossplay(context.Background(), "abc12345")
	deadline := time.Now().Add(5 * time.Second)
	for downloads.Load() < 4 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if n := downloads.Load(); n != 4 {
		t.Fatalf("downloads = %d, want 4", n)
	}
}

func TestFixCrossplayTakesThemOutWhenOff(t *testing.T) {
	a, data, downloads := crossplayAgent(t, false)
	plugins := filepath.Join(data, "plugins")
	os.MkdirAll(plugins, 0o755)
	for _, name := range []string{"mchost-geyser.jar", "mchost-floodgate.jar", "Mine.jar"} {
		os.WriteFile(filepath.Join(plugins, name), []byte("x"), 0o644)
	}
	a.fixCrossplay(context.Background(), "abc12345")
	left, _ := filepath.Glob(filepath.Join(plugins, "*"))
	if len(left) != 1 || filepath.Base(left[0]) != "Mine.jar" {
		t.Fatalf("left: %v", left)
	}
	if n := downloads.Load(); n != 0 {
		t.Fatalf("downloads = %d with crossplay off", n)
	}
}

func TestFixCrossplayStartsAnywayWhenGeyserMCIsDown(t *testing.T) {
	a, data, _ := crossplayAgent(t, true)
	crossplayJars = []crossplayJar{{"http://127.0.0.1:1/geyser", "mchost-geyser.jar"}}
	a.fixCrossplay(context.Background(), "abc12345")
	if _, err := os.Stat(filepath.Join(data, "plugins", "mchost-geyser.jar")); err == nil {
		t.Fatal("a jar appeared without a download")
	}
}

func TestFixCrossplayDoesNotHoldAStartOnASlowDownload(t *testing.T) {
	a, data, _ := crossplayAgent(t, true)
	release := make(chan struct{})
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-release
		w.Write([]byte("jar"))
	}))
	t.Cleanup(slow.Close)
	t.Cleanup(func() { close(release) })
	crossplayJars = []crossplayJar{{slow.URL + "/geyser", "mchost-geyser.jar"}}
	oldWait := crossplayWait
	crossplayWait = 100 * time.Millisecond
	t.Cleanup(func() { crossplayWait = oldWait })
	began := time.Now()
	a.fixCrossplay(context.Background(), "abc12345")
	if d := time.Since(began); d > 2*time.Second {
		t.Fatalf("the start waited %v", d)
	}
	if _, err := os.Stat(filepath.Join(data, "plugins", "mchost-geyser.jar")); err == nil {
		t.Fatal("a jar appeared before its download ended")
	}
}
