package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestVoiceChatPort(t *testing.T) {
	a := &agent{idle: 5 * time.Minute}
	req := createRequest{ID: "abc12345", Name: "Test", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 30007, Hostname: "ekipa.mchost.pl", Kind: "fabric", VoiceHost: "n3.mchost.pl"}
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	spec := a.containerSpec(req, images["JAVA"])
	ports := spec["HostConfig"].(map[string]any)["PortBindings"].(map[string]any)
	if b, ok := ports["31007/udp"].([]map[string]string); !ok || b[0]["HostIp"] != "" || b[0]["HostPort"] != "31007" {
		t.Fatalf("voice port should be open to everyone over UDP: %v", ports)
	}
	if _, ok := spec["ExposedPorts"].(map[string]any)["31007/udp"]; !ok {
		t.Fatal("voice port should be exposed")
	}
	ep := spec["Entrypoint"].([]string)
	if !strings.Contains(ep[2], "config/voicechat") || !strings.Contains(ep[2], "voice_host=n3.mchost.pl") || !strings.Contains(ep[2], unfinishedWorldScript) {
		t.Fatalf("entrypoint: %s", ep[2])
	}

	// Old sites send no voiceHost: nothing changes.
	req.VoiceHost = ""
	if _, ok := a.containerSpec(req, images["JAVA"])["HostConfig"].(map[string]any)["PortBindings"].(map[string]any)["31007/udp"]; ok {
		t.Fatal("no voice port without voiceHost")
	}

	for _, bad := range []createRequest{
		{ID: "abc12345", Edition: "BEDROCK", MemoryMb: 2048, CPUs: 1, Port: 30007, VoiceHost: "n3.mchost.pl"},
		{ID: "abc12345", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 30007, Hostname: "ekipa.mchost.pl", VoiceHost: "bad host"},
		{ID: "abc12345", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 65000, Hostname: "ekipa.mchost.pl", VoiceHost: "n3.mchost.pl"},
		{ID: "abc12345", Edition: "TERRARIA", MemoryMb: 2048, CPUs: 1, Port: 30007, VoiceHost: "n3.mchost.pl"},
	} {
		if bad.validate() == nil {
			t.Errorf("should be refused: %+v", bad)
		}
	}
}

func TestVoiceScript(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("no bash")
	}
	run := func(dir string, req createRequest) string {
		cmd := exec.Command("bash", "-c", strings.ReplaceAll(voiceScript(req), "cd /data", "cd "+dir))
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%v: %s", err, out)
		}
		return string(out)
	}
	read := func(p string) string {
		b, _ := os.ReadFile(p)
		return string(b)
	}

	// A mod server: the owner's other settings stay, ours replace the old values.
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "config/voicechat"), 0o755)
	conf := filepath.Join(dir, "config/voicechat/voicechat-server.properties")
	os.WriteFile(conf, []byte("port=24454\nmax_voice_distance=48.0\nvoice_host=\n"), 0o644)
	req := createRequest{Port: 30007, Kind: "neoforge", VoiceHost: "n3.mchost.pl"}
	if out := run(dir, req); !strings.Contains(out, "n3.mchost.pl:31007") {
		t.Fatalf("no message: %q", out)
	}
	if got := read(conf); got != "port=31007\nmax_voice_distance=48.0\nvoice_host=n3.mchost.pl\n" {
		t.Fatalf("config:\n%s", got)
	}
	run(dir, req) // again: nothing doubled
	if got := read(conf); strings.Count(got, "port=") != 1 {
		t.Fatalf("doubled:\n%s", got)
	}

	// A new mod server with no config folder yet: what the script makes belongs
	// to the server's user (the owner of /data), not root, or Forge can't write fml.toml.
	if os.Geteuid() == 0 {
		dir = t.TempDir()
		os.Chown(dir, 1000, 1000)
		run(dir, req)
		for _, p := range []string{"config", "config/voicechat", "config/voicechat/voicechat-server.properties"} {
			if fi, err := os.Stat(filepath.Join(dir, p)); err != nil || fi.Sys().(*syscall.Stat_t).Uid != 1000 {
				t.Errorf("%s not owned by the server's user", p)
			}
		}
	}

	// Paper without the plugin: no folder made.
	dir = t.TempDir()
	os.MkdirAll(filepath.Join(dir, "plugins"), 0o755)
	paper := createRequest{Port: 30007, Kind: "vanilla", VoiceHost: "ekipa.mchost.pl"}
	run(dir, paper)
	if _, err := os.Stat(filepath.Join(dir, "plugins/voicechat")); !os.IsNotExist(err) {
		t.Fatal("folder made without the plugin")
	}
	// Uploaded jar: written.
	os.WriteFile(filepath.Join(dir, "plugins/voicechat-bukkit-2.5.30.jar"), []byte("x"), 0o644)
	run(dir, paper)
	if got := read(filepath.Join(dir, "plugins/voicechat/voicechat-server.properties")); got != "port=31007\nvoice_host=ekipa.mchost.pl\n" {
		t.Fatalf("paper config:\n%s", got)
	}
	// Added in the panel (downloaded later, as the server starts): written straight away.
	dir = t.TempDir()
	paper.Plugins = []string{"9eGKb6K1"}
	run(dir, paper)
	if _, err := os.Stat(filepath.Join(dir, "plugins/voicechat/voicechat-server.properties")); err != nil {
		t.Fatal(err)
	}
}
