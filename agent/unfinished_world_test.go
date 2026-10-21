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

	a := &agent{}
	for _, kind := range []string{"vanilla", "skyblock"} {
		req := createRequest{ID: "abc12345", Name: "X", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 30001, Hostname: "x.mchost.pl", Kind: kind}
		ep := a.containerSpec(req, imageFor(req.Edition, req.Version, req.Kind))["Entrypoint"].([]string)
		if !strings.HasPrefix(ep[2], unfinishedWorldScript) || !strings.HasSuffix(ep[2], "exec /image/scripts/start\n") {
			t.Errorf("%s entrypoint: %q", kind, ep)
		}
	}
}
