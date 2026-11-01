package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoginScript(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("no bash")
	}
	if _, err := exec.LookPath("jq"); err != nil {
		t.Skip("no jq")
	}
	dir := t.TempDir()
	mods := filepath.Join(dir, "mods")
	if err := os.MkdirAll(mods, 0o755); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(mods, "pack-mod.jar"), []byte("jar"), 0o644)

	// A stand-in curl answers like Modrinth: EasyAuth and Fabric API for 1.20.1, nothing for 1.16.5.
	bin := t.TempDir()
	fake := `#!/bin/bash
url="${@: -1}"; out=; prev=
for a in "$@"; do [ "$prev" = -o ] && out=$a; prev=$a; done
echo "$url" >>"$LOG"
case $url in
  *project/` + easyAuth + `/*1.20.1*) echo '[{"files":[{"primary":true,"url":"https://cdn/easyauth.jar","filename":"easyauth-mc1.20.1-3.0.jar"}]}]' ;;
  *project/` + fabricAPI + `/*1.20.1*) echo '[{"files":[{"primary":true,"url":"https://cdn/fapi.jar","filename":"fabric-api-0.92.jar"}]}]' ;;
  *api.modrinth.com*) echo '[]' ;;
  *) echo jar >"$out" ;;
esac
`
	if err := os.WriteFile(filepath.Join(bin, "curl"), []byte(fake), 0o755); err != nil {
		t.Fatal(err)
	}
	log := filepath.Join(bin, "log")
	run := func(env ...string) (string, error) {
		cmd := exec.Command("bash", "-c", loginScript+"exit 0\n")
		cmd.Dir = dir
		cmd.Env = append(append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"), "LOG="+log), env...)
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	exists := func(name string) bool { _, err := os.Stat(filepath.Join(mods, name)); return err == nil }
	on := []string{"MCHOST_LOGIN=" + easyAuth, "MCHOST_LOGIN_LOADER=fabric", "MCHOST_LOGIN_VERSION=1.20.1"}

	if out, err := run(on...); err != nil || !exists("easyauth-mc1.20.1-3.0.jar") || !exists("fabric-api-0.92.jar") {
		t.Fatalf("%v: %s", err, out)
	}
	// Already there: nothing fetched again.
	os.Remove(log)
	if out, err := run(on...); err != nil || strings.Contains(out, "added") {
		t.Fatalf("%v: %s", err, out)
	}
	if b, _ := os.ReadFile(log); len(b) != 0 {
		t.Errorf("fetched again:\n%s", b)
	}
	// Non-premium off: what it added goes, the pack's own mods stay.
	if out, err := run(); err != nil || exists("easyauth-mc1.20.1-3.0.jar") || exists("fabric-api-0.92.jar") || !exists("pack-mod.jar") {
		t.Fatalf("%v: %s", err, out)
	}
	if _, err := os.Stat(filepath.Join(dir, ".mchost-login-mod")); err == nil {
		t.Error("list left behind")
	}
	// A pack that has Fabric API already doesn't get a second one.
	os.WriteFile(filepath.Join(mods, "fabric-api-0.90.jar"), []byte("jar"), 0o644)
	if out, err := run(on...); err != nil || exists("fabric-api-0.92.jar") || !exists("easyauth-mc1.20.1-3.0.jar") {
		t.Fatalf("%v: %s", err, out)
	}
	// No login mod for the version: the server must not start without it.
	out, err := run("MCHOST_LOGIN="+easyAuth, "MCHOST_LOGIN_LOADER=fabric", "MCHOST_LOGIN_VERSION=1.16.5")
	if err == nil || !strings.Contains(out, "won't start") {
		t.Errorf("started without a login mod: %v %s", err, out)
	}
	if exists("easyauth-mc1.20.1-3.0.jar") {
		t.Error("the old version's login mod was kept")
	}
}

func TestLoginEntrypoint(t *testing.T) {
	if !strings.Contains(loginEntrypoint[2], loginScript) || !strings.Contains(packScript, loginScript) {
		t.Error("loginScript missing from an entrypoint")
	}
}
