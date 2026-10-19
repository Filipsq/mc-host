package main

import (
	"archive/zip"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrepareIslands(t *testing.T) {
	_, a, data := filesAgent(t)
	cfg := filepath.Join(data, "plugins", "BentoBox", "addons", "AOneBlock", "config.yml")

	// A plain server gets nothing.
	a.prepareIslands(context.Background(), "abc12345", "vanilla")
	if _, err := os.Stat(filepath.Join(data, "plugins")); err == nil {
		t.Fatal("vanilla server got island settings")
	}

	// A new OneBlock server: just the setting, for BentoBox to fill in.
	a.prepareIslands(context.Background(), "abc12345", "oneblock")
	if b, _ := os.ReadFile(cfg); string(b) != islandsConfig {
		t.Fatalf("new config = %q", b)
	}

	// The owner turns it off again: it stays off.
	os.WriteFile(cfg, []byte("mine"), 0o644)
	a.prepareIslands(context.Background(), "abc12345", "oneblock")
	if b, _ := os.ReadFile(cfg); string(b) != "mine" {
		t.Fatalf("owner's settings changed: %q", b)
	}

	// A Skyblock server that already ran: the setting BentoBox wrote is switched on, nothing else changes.
	written := `island:
  max-team-size: 4
  create-island-on-first-login:
    # Toggles the automatic island creation upon the player's first login on your server.
    # If set to false, this will disable this feature entirely.
    # Added since 1.9.0.
    enable: false
    # Island creation can be delayed.
    delay: 5
    abort-on-logout: true
  reset:
    # disabled features
    enable: false
`
	sky := filepath.Join(data, "plugins", "BentoBox", "addons", "BSkyBlock", "config.yml")
	os.MkdirAll(filepath.Dir(sky), 0o755)
	os.WriteFile(sky, []byte(written), 0o644)
	a.prepareIslands(context.Background(), "abc12345", "skyblock")
	b, _ := os.ReadFile(sky)
	want := strings.Replace(written, "    enable: false\n    # Island", "    enable: true\n    # Island", 1)
	if string(b) != want {
		t.Fatalf("patched config:\n%s", b)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(sky), ".mchost-first-login")); err != nil {
		t.Fatal("no marker, so it would be switched on again after the owner turns it off")
	}
}

func TestIslandsContainer(t *testing.T) {
	a := &agent{}
	for kind, want := range map[string]bool{"vanilla": false, "skyblock": true, "oneblock": true, "fabric": false} {
		req := createRequest{ID: "abc12345", Name: "Wyspa", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 30001, Hostname: "wyspa.mchost.pl", Kind: kind}
		if err := req.validate(); err != nil {
			t.Fatal(err)
		}
		spec := a.containerSpec(req, imageFor(req.Edition, req.Version, req.Kind))
		env := strings.Join(spec["Env"].([]string), "\n")
		ep, _ := spec["Entrypoint"].([]string)
		if got := strings.Contains(env, "PRE_START_SCRIPT="+addonsScriptPath) && len(ep) == 3; got != want {
			t.Errorf("%s: add-on mover = %v, want %v (entrypoint %q)", kind, got, want, ep)
		}
		if want && (!strings.Contains(ep[2], addonsScript) || !strings.HasSuffix(ep[2], "exec /image/scripts/start\n")) {
			t.Errorf("%s: entrypoint must write the script and start the image as usual:\n%s", kind, ep[2])
		}
	}
}

func TestAddonsScript(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("no bash")
	}
	dir := t.TempDir()
	plugins := filepath.Join(dir, "plugins")
	addons := filepath.Join(plugins, "BentoBox", "addons")
	os.MkdirAll(addons, 0o755)
	jar := func(name string, entries ...string) {
		f, err := os.Create(filepath.Join(plugins, name))
		if err != nil {
			t.Fatal(err)
		}
		z := zip.NewWriter(f)
		for _, e := range entries {
			w, _ := z.Create(e)
			w.Write([]byte("name: x\n"))
		}
		z.Close()
		f.Close()
	}
	run := func() string {
		cmd := exec.Command("bash", "-c", addonsScript)
		cmd.Dir = dir
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%v: %s", err, out)
		}
		return string(out)
	}
	list := func(d string) string {
		var names []string
		entries, _ := os.ReadDir(d)
		for _, e := range entries {
			if !e.IsDir() {
				names = append(names, e.Name())
			}
		}
		return strings.Join(names, " ")
	}

	jar("BentoBox-3.10.0.jar", "plugin.yml", "world/bentobox/bentobox/BentoBox.class")
	jar("AOneBlock-1.22.0.jar", "addon.yml", "plugin.yml", "world/bentobox/aoneblock/AOneBlock.class")
	jar("Level-2.21.0.jar", "addon.yml", "plugin.yml", "world/bentobox/level/Level.class")
	jar("AuthMe-5.6.0.jar", "plugin.yml", "fr/xephi/authme/addon.yml.bak")
	os.WriteFile(filepath.Join(addons, "Mine.jar"), []byte("the owner's"), 0o644)
	out := run()
	if !strings.Contains(out, "AOneBlock-1.22.0.jar moved") {
		t.Errorf("output: %s", out)
	}
	if got := list(plugins); got != "AuthMe-5.6.0.jar BentoBox-3.10.0.jar" {
		t.Errorf("left in plugins: %s", got)
	}
	if got := list(addons); got != ".mchost-moved AOneBlock-1.22.0.jar Level-2.21.0.jar Mine.jar" {
		t.Errorf("in addons: %s", got)
	}

	// The next start downloads a newer AOneBlock (and no longer Level): the old ones go.
	jar("AOneBlock-1.23.0.jar", "addon.yml", "plugin.yml", "world/bentobox/aoneblock/AOneBlock.class")
	run()
	if got := list(addons); got != ".mchost-moved AOneBlock-1.23.0.jar Mine.jar" {
		t.Errorf("after an update: %s", got)
	}

	// A start that downloaded nothing keeps what's there.
	run()
	if got := list(addons); got != ".mchost-moved AOneBlock-1.23.0.jar Mine.jar" {
		t.Errorf("after a start with nothing new: %s", got)
	}
}

func TestPackScriptRemovesExcludedMods(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "mods"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"missingmodschecker.jar", "missingmodschecker-1.0.1.jar", "ftbquestsfreezefix-fabric-1.0.0-1.20.1.jar", "modernfix.jar"} {
		if err := os.WriteFile(filepath.Join(dir, "mods", name), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	cmd := exec.Command("bash", "-c", packScript)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	left, _ := filepath.Glob(filepath.Join(dir, "mods", "*"))
	if len(left) != 1 || filepath.Base(left[0]) != "modernfix.jar" {
		t.Fatalf("mods left: %v", left)
	}
	// No mods folder yet (first start): still exits cleanly.
	cmd = exec.Command("bash", "-c", packScript)
	cmd.Dir = t.TempDir()
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
}
