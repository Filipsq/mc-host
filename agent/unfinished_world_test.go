package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestUnfinishedWorldScript(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("no bash")
	}
	dir := t.TempDir()
	mk := func(p string) {
		os.MkdirAll(filepath.Dir(filepath.Join(dir, p)), 0o755)
		os.WriteFile(filepath.Join(dir, p), []byte("x"), 0o644)
	}
	mk("world/dimensions/minecraft/overworld/region/r.0.0.mca") // cut short: no level.dat
	mk("played/dimensions/minecraft/overworld/region/r.0.0.mca")
	mk("played/players/data/p.dat") // someone played: kept
	mk("ok/level.dat")
	mk("ok/dimensions/minecraft/overworld/region/r.0.0.mca")
	run := func(level string) string {
		cmd := exec.Command("bash", "-c", strings.ReplaceAll(unfinishedWorldScript, "cd /data", "cd "+dir))
		cmd.Env = append(os.Environ(), "LEVEL="+level)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%v: %s", err, out)
		}
		return string(out)
	}
	if out := run("world"); !strings.Contains(out, "moved it to world-przerwany-") {
		t.Errorf("unfinished world not moved: %q", out)
	}
	if _, err := os.Stat(filepath.Join(dir, "world")); !os.IsNotExist(err) {
		t.Error("world still there")
	}
	for _, level := range []string{"played", "ok", "missing"} {
		if out := run(level); out != "" {
			t.Errorf("%s: %q", level, out)
		}
	}
	for _, p := range []string{"played/players/data/p.dat", "ok/level.dat"} {
		if _, err := os.Stat(filepath.Join(dir, p)); err != nil {
			t.Errorf("%s gone", p)
		}
	}

	// A world made on Paper, opened by Fabric: its world settings are copied where Fabric reads them.
	mk("paperw/level.dat")
	mk("paperw/players/data/p.dat")
	mk("paperw/data/minecraft/world_clocks.dat")
	mk("paperw/dimensions/minecraft/overworld/data/paper/metadata.dat")
	for _, f := range []string{"world_gen_settings", "game_rules", "weather", "world_clocks"} {
		mk("paperw/dimensions/minecraft/overworld/data/minecraft/" + f + ".dat")
	}
	os.WriteFile(filepath.Join(dir, "paperw/data/minecraft/world_clocks.dat"), []byte("own"), 0o644)
	runType := func(level, typ string) string {
		cmd := exec.Command("bash", "-c", strings.ReplaceAll(unfinishedWorldScript, "cd /data", "cd "+dir))
		cmd.Env = append(os.Environ(), "LEVEL="+level, "TYPE="+typ)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%v: %s", err, out)
		}
		return string(out)
	}
	if out := runType("paperw", "PAPER"); out != "" {
		t.Errorf("Paper itself got a copy: %q", out)
	}
	if out := runType("paperw", "FABRIC"); !strings.Contains(out, "made on Paper") {
		t.Errorf("Paper world not fixed for Fabric: %q", out)
	}
	for _, f := range []string{"world_gen_settings", "game_rules", "weather"} {
		if _, err := os.Stat(filepath.Join(dir, "paperw/data/minecraft", f+".dat")); err != nil {
			t.Errorf("%s not copied", f)
		}
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "paperw/data/minecraft/world_clocks.dat")); string(b) != "own" {
		t.Error("an existing file was overwritten")
	}
	if out := runType("paperw", "FABRIC"); out != "" {
		t.Errorf("copied twice: %q", out)
	}

	// An IP ban on the router's address is lifted; other bans stay.
	if _, err := exec.LookPath("jq"); err == nil {
		os.WriteFile(filepath.Join(dir, "banned-ips.json"), []byte(`[{"ip":"172.17.0.1","source":"x"},{"ip":"203.0.113.9","source":"y"},{"ip":"10.88.0.1"}]`), 0o644)
		if out := run("ok"); !strings.Contains(out, "lifted IP bans") {
			t.Errorf("router ban not lifted: %q", out)
		}
		b, _ := os.ReadFile(filepath.Join(dir, "banned-ips.json"))
		if strings.Contains(string(b), "172.17.0.1") || strings.Contains(string(b), "10.88.0.1") || !strings.Contains(string(b), "203.0.113.9") {
			t.Errorf("banned-ips.json: %s", b)
		}
		if out := run("ok"); out != "" {
			t.Errorf("lifted twice: %q", out)
		}
	}

	a := &agent{}
	for _, kind := range []string{"vanilla", "skyblock"} {
		req := createRequest{ID: "abc12345", Name: "X", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 30001, Hostname: "x.mchost.pl", Kind: kind}
		ep := a.containerSpec(req, imageFor(req.Edition, req.Version, req.Kind))["Entrypoint"].([]string)
		if !strings.HasPrefix(ep[2], unfinishedWorldScript) || !strings.HasSuffix(ep[2], "exec /image/scripts/start\n") {
			t.Errorf("%s entrypoint: %q", kind, ep)
		}
	}
}
