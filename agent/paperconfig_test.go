package main

import (
	"context"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func paperConfigAgent(t *testing.T, logLines string) (*agent, string) {
	t.Helper()
	tmp := t.TempDir()
	volumes := filepath.Join(tmp, "volumes")
	data := filepath.Join(volumes, "mc-abc12345", "_data")
	os.MkdirAll(filepath.Join(data, "config"), 0o755)
	os.WriteFile(filepath.Join(data, "config", "paper-world-defaults.yml"), []byte("hard: default\n"), 0o644)
	os.WriteFile(filepath.Join(data, "config", "paper-global.yml"), []byte("x: 1\n"), 0o644)
	sock := filepath.Join(tmp, "docker.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	fake := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/volumes/mc-abc12345":
			writeJSON(w, 200, map[string]string{"Mountpoint": data})
		case "/containers/mc-abc12345/json":
			writeJSON(w, 200, map[string]any{"Config": map[string]any{"Tty": true}})
		case "/containers/mc-abc12345/logs":
			w.Write([]byte(logLines))
		default:
			writeError(w, 404, "not found")
		}
	})}
	go fake.Serve(ln)
	t.Cleanup(func() { fake.Close() })
	return &agent{docker: NewDocker(sock), volumesDir: volumes}, data
}

func TestFixPaperConfigSetsAsideAFileTheOlderPaperCantRead(t *testing.T) {
	a, data := paperConfigAgent(t, "[20:35:51 ERROR]: Encountered an unexpected exception\n"+
		`org.spongepowered.configurate.serialize.SerializationException: [entities, spawning, monster-spawn-max-light-level] of type java.lang.Integer: java.lang.NumberFormatException: For input string: "default"`+"\n"+
		"\tat io.papermc.paper.configuration.Configurations.initializeWorldDefaultsConfiguration(Configurations.java:154)\n")
	a.fixPaperConfig(context.Background(), "abc12345")
	if _, err := os.Stat(filepath.Join(data, "config", "paper-world-defaults.yml.old")); err != nil {
		t.Fatal("not set aside:", err)
	}
	if _, err := os.Stat(filepath.Join(data, "config", "paper-global.yml")); err != nil {
		t.Fatal("the global config went too:", err)
	}
}

func TestFixPaperConfigLeavesAServerThatStartedFine(t *testing.T) {
	a, data := paperConfigAgent(t, "[20:35:48 INFO]: Starting minecraft server version 1.20.1\n[20:36:00 INFO]: Done (12.3s)!\n")
	a.fixPaperConfig(context.Background(), "abc12345")
	if _, err := os.Stat(filepath.Join(data, "config", "paper-world-defaults.yml")); err != nil {
		t.Fatal("moved without a reason:", err)
	}
}
