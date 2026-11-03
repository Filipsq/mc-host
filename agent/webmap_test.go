package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWebMapPort(t *testing.T) {
	a := &agent{idle: 5 * time.Minute}
	req := createRequest{ID: "abc12345", Name: "Test", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 30007, Hostname: "ekipa.mchost.pl", Kind: "vanilla", VoiceHost: "n3.mchost.pl"}
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	spec := a.containerSpec(req, images["JAVA"])
	ports := spec["HostConfig"].(map[string]any)["PortBindings"].(map[string]any)
	if b, ok := ports["8100/tcp"].([]map[string]string); !ok || b[0]["HostIp"] != "" || b[0]["HostPort"] != "32007" {
		t.Fatalf("map port should be open to everyone over TCP: %v", ports)
	}
	if _, ok := spec["ExposedPorts"].(map[string]any)["8100/tcp"]; !ok {
		t.Fatal("map port should be exposed")
	}
	ep := spec["Entrypoint"].([]string)
	if !strings.Contains(ep[2], "plugins/BlueMap") || !strings.Contains(ep[2], "voicechat") {
		t.Fatalf("entrypoint: %s", ep[2])
	}
	req.VoiceHost = ""
	if _, ok := a.containerSpec(req, images["JAVA"])["HostConfig"].(map[string]any)["PortBindings"].(map[string]any)["8100/tcp"]; ok {
		t.Fatal("no map port without voiceHost")
	}
	bad := createRequest{ID: "abc12345", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 64000, Hostname: "ekipa.mchost.pl", VoiceHost: "n3.mchost.pl"}
	if bad.validate() == nil {
		t.Error("no room for the map port: should be refused")
	}
}

func TestBlueMapScript(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("no bash")
	}
	run := func(dir string, req createRequest) {
		if out, err := exec.Command("bash", "-c", strings.ReplaceAll(blueMapScript(req), "cd /data", "cd "+dir)).CombinedOutput(); err != nil {
			t.Fatalf("%v: %s", err, out)
		}
	}
	read := func(p string) string { b, _ := os.ReadFile(p); return string(b) }

	// Paper without BlueMap: no folder made.
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "plugins"), 0o755)
	paper := createRequest{Port: 30007, Kind: "vanilla", VoiceHost: "n3.mchost.pl"}
	run(dir, paper)
	if _, err := os.Stat(filepath.Join(dir, "plugins/BlueMap")); !os.IsNotExist(err) {
		t.Fatal("folder made without BlueMap")
	}
	// Added in the panel: core.conf accepts the download before the first start.
	paper.Plugins = []string{"swbUV1cr"}
	run(dir, paper)
	if got := read(filepath.Join(dir, "plugins/BlueMap/core.conf")); got != "accept-download: true\n" {
		t.Fatalf("core.conf: %q", got)
	}
	// BlueMap's own file: only that line changes.
	conf := filepath.Join(dir, "plugins/BlueMap/core.conf")
	os.WriteFile(conf, []byte("# comment\naccept-download: false\nrender-thread-count: 1\n"), 0o644)
	run(dir, paper)
	if got := read(conf); got != "# comment\naccept-download: true\nrender-thread-count: 1\n" {
		t.Fatalf("core.conf: %q", got)
	}

	// A mod pack that brings the mod itself.
	dir = t.TempDir()
	os.MkdirAll(filepath.Join(dir, "mods"), 0o755)
	os.WriteFile(filepath.Join(dir, "mods/bluemap-5.12-fabric.jar"), []byte("x"), 0o644)
	run(dir, createRequest{Port: 30007, Kind: "modpack", VoiceHost: "n3.mchost.pl"})
	if got := read(filepath.Join(dir, "config/bluemap/core.conf")); got != "accept-download: true\n" {
		t.Fatalf("mod core.conf: %q", got)
	}
}
