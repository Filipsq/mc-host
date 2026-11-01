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
	for _, name := range []string{"missingmodschecker.jar", "missingmodschecker-1.0.1.jar", "ftbquestsfreezefix-fabric-1.0.0-1.20.1.jar", "Barsita-1.19.2-1.1.2.jar", "modernfix.jar"} {
		if err := os.WriteFile(filepath.Join(dir, "mods", name), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	bin := t.TempDir() // offline: the Chunky download fails and is skipped
	if err := os.WriteFile(filepath.Join(bin, "curl"), []byte("#!/bin/sh\nexit 22\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("bash", "-c", packScript)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"))
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

func TestPackScriptAddsMissingLibraries(t *testing.T) {
	dir := t.TempDir()
	mods := filepath.Join(dir, "mods")
	if err := os.MkdirAll(mods, 0o755); err != nil {
		t.Fatal(err)
	}
	jar := func(name, meta string) {
		f, err := os.Create(filepath.Join(mods, name))
		if err != nil {
			t.Fatal(err)
		}
		z := zip.NewWriter(f)
		if meta != "" {
			w, _ := z.Create("fabric.mod.json")
			w.Write([]byte(meta))
		}
		z.Close()
		f.Close()
	}
	jar("waystones.jar", `{"id": "waystones", "depends": {"balm-fabric": "*", "fabricloader": ">=0.14"}}`)
	jar("bop.jar", `{"id": "biomesoplenty", "depends": {"terrablender": "*", "minecraft": "1.20.1"}}`)
	jar("questing.jar", `{"id": "certain_questing_additions", "depends": {"ftbquests": "*", "architectury": "*"}}`)
	jar("ftbquests.jar", `{"id": "ftbquests", // not quite JSON
	}`)
	jar("arch.jar", `{"id": "architectury", "provides": ["architectury-api"]}`)
	jar("forge-only.jar", "")

	// A stand-in curl answers like Modrinth and FTB's Maven and logs what was fetched.
	bin := t.TempDir()
	fake := `#!/bin/bash
url="${@: -1}"; out=; prev=
for a in "$@"; do [ "$prev" = -o ] && out=$a; prev=$a; done
echo "$url" >>"$LOG"
case $url in
  *maven-metadata.xml) echo '<versions><version>2001.2.9</version><version>2001.2.13</version><version>2101.1.0</version></versions>' ;;
  *api.modrinth.com/v2/project/balm/*) echo '[{"files":[{"primary":true,"url":"https://cdn/balm-fabric-1.20.1-7.3.44.jar","filename":"balm-fabric-1.20.1-7.3.44.jar"}]}]' ;;
  *api.modrinth.com/v2/project/terrablender/*) echo '[]' ;;
  *api.modrinth.com/v2/project/chunky/*) echo '[{"files":[{"primary":true,"url":"https://cdn/Chunky-Fabric-1.3.146.jar","filename":"Chunky-Fabric-1.3.146.jar"}]}]' ;;
  *) echo jar >"$out" ;;
esac
`
	if err := os.WriteFile(filepath.Join(bin, "curl"), []byte(fake), 0o755); err != nil {
		t.Fatal(err)
	}
	log := filepath.Join(bin, "log")
	cmd := exec.Command("bash", "-c", packScript)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"), "VERSION=1.20.1", "LOG="+log)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	for _, name := range []string{"balm-fabric-1.20.1-7.3.44.jar", "ftb-library-fabric-2001.2.13.jar", "Chunky-Fabric-1.3.146.jar"} {
		if _, err := os.Stat(filepath.Join(mods, name)); err != nil {
			t.Errorf("%s not added: %s", name, out)
		}
	}
	if !strings.Contains(string(out), "could not download terrablender for 1.20.1") {
		t.Errorf("no word on the missing terrablender: %s", out)
	}
	fetched, _ := os.ReadFile(log)
	if strings.Count(string(fetched), "project/balm/") != 1 || strings.Contains(string(fetched), "architectury") {
		t.Errorf("fetched:\n%s", fetched)
	}

	// Everything there now but TerraBlender: the next start only tries that again.
	os.Remove(log)
	jar("tb.jar", `{"id": "terrablender"}`)
	jar("balm-fabric-1.20.1-7.3.44.jar", `{"id": "balm-fabric"}`)
	jar("ftb-library-fabric-2001.2.13.jar", `{"id": "ftblibrary"}`)
	cmd = exec.Command("bash", "-c", packScript)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"), "VERSION=1.20.1", "LOG="+log)
	if out, err := cmd.CombinedOutput(); err != nil || strings.Contains(string(out), "added") {
		t.Fatalf("%v: %s", err, out)
	}
	if fetched, _ := os.ReadFile(log); len(fetched) != 0 {
		t.Errorf("fetched again:\n%s", fetched)
	}
}

func TestPackScriptRemovesModsForgeCouldNotLoad(t *testing.T) {
	dir := t.TempDir()
	for _, d := range []string{"mods", "crash-reports", "libraries/net/minecraftforge"} {
		if err := os.MkdirAll(filepath.Join(dir, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	mods := []string{"TwilightCaveFix-1.0.0.jar", "ConnectorExtras-1.11.2+1.20.1.jar", "Audio Improvements v1.3.1 - Forge 1.20.1.jar", "clientkeys-1.0.jar", "jei.jar", "needsnewer.jar"}
	put := func() {
		for _, name := range mods {
			if err := os.WriteFile(filepath.Join(dir, "mods", name), nil, 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	put()
	report := "-- MOD twilightfixes --\nDetails:\n\tMod File: /data/mods/TwilightCaveFix-1.0.0.jar\n\tFailure message: Mod twilightfixes requires twilightforest 4.3.2145 or above\n\t\tCurrently, twilightforest is not installed\n" +
		"-- MOD connectorextras_architectury_bridge --\nDetails:\n\tMod File: /data/mods/ConnectorExtras-1.11.2+1.20.1.jar#460!/META-INF/jarjar/architectury-bridge-1.11.2+1.20.1.jar\n\tFailure message: Mod connectorextras_architectury_bridge requires connectormod 1.0.0-beta.18 or above\n\t\tCurrently, connectormod is not installed\n" +
		"-- MOD audio --\nDetails:\n\tMod File: /data/mods/Audio Improvements v1.3.1 - Forge 1.20.1.jar\n\tFailure message: Mod audio requires flib 0.0.14 or above\n\t\tCurrently, flib is not installed\n" +
		"-- MOD clientkeys --\nDetails:\n\tMod File: /data/./mods/clientkeys-1.0.jar\n\tFailure message: Client Keys (clientkeys) has failed to load correctly\n\t\tjava.lang.RuntimeException: Attempted to load class net/minecraft/client/KeyMapping for invalid dist DEDICATED_SERVER\n" +
		"-- MOD newer --\nDetails:\n\tMod File: /data/mods/needsnewer.jar\n\tFailure message: Mod newer requires geckolib 4.5 or above\n\t\tCurrently, geckolib is 4.2\n"
	if err := os.WriteFile(filepath.Join(dir, "crash-reports", "crash-2026-10-20_06.26.21-fml.txt"), []byte(report), 0o644); err != nil {
		t.Fatal(err)
	}
	// Offline: the Chunky download fails and is skipped.
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "curl"), []byte("#!/bin/sh\nexit 22\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	run := func(version string) string {
		cmd := exec.Command("bash", "-c", packScript)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(), "MODRINTH_VERSION="+version, "PATH="+bin+":"+os.Getenv("PATH"))
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%v: %s", err, out)
		}
		return string(out)
	}
	left := func() string {
		names, _ := filepath.Glob(filepath.Join(dir, "mods", "*"))
		for i, n := range names {
			names[i] = filepath.Base(n)
		}
		return strings.Join(names, ",")
	}

	out := run("bdRIjRgs")
	if got := left(); got != "jei.jar,needsnewer.jar" {
		t.Fatalf("mods left: %s\n%s", got, out)
	}
	// The image puts them back on the next start; they go again.
	put()
	run("bdRIjRgs")
	if got := left(); got != "jei.jar,needsnewer.jar" {
		t.Fatalf("mods left after the image put them back: %s", got)
	}
	// A new pack version may have what they need: they stay, and the old report is not read again.
	put()
	run("newver01")
	if got := left(); got != strings.Join([]string{"Audio Improvements v1.3.1 - Forge 1.20.1.jar", "ConnectorExtras-1.11.2+1.20.1.jar", "TwilightCaveFix-1.0.0.jar", "clientkeys-1.0.jar", "jei.jar", "needsnewer.jar"}, ",") {
		t.Fatalf("mods left on a new version: %s", got)
	}
}
