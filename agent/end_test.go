package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEndPacksComplete(t *testing.T) {
	for _, name := range []string{"off", "on"} {
		ns := "mchost_end_" + name
		// Both folder spellings, before and after Minecraft 1.21 renamed them.
		for _, f := range []string{"pack.mcmeta", "data/minecraft/tags/function/load.json", "data/minecraft/tags/functions/load.json",
			"data/" + ns + "/function/load.mcfunction", "data/" + ns + "/functions/check.mcfunction", "data/" + ns + "/function/check.mcfunction"} {
			b, err := endPacks.ReadFile("endpacks/" + name + "/" + f)
			if err != nil {
				t.Fatal(err)
			}
			if strings.HasSuffix(f, "check.mcfunction") && !strings.Contains(string(b), "schedule function "+ns+":check") {
				t.Errorf("%s/%s doesn't schedule itself again", name, f)
			}
		}
	}
}

func TestPrepareEnd(t *testing.T) {
	_, a, data := filesAgent(t)
	off, back := filepath.Join(data, "world", endOffPackDir), filepath.Join(data, "world", endOnPackDir)
	ctx := context.Background()
	no, yes := false, true
	exists := func(p string) bool { _, err := os.Stat(p); return err == nil }

	// An older site says nothing: nothing is written.
	a.prepareEnd(ctx, createRequest{ID: "abc12345", Kind: "fabric"})
	if exists(off) || exists(filepath.Join(data, "bukkit.yml")) {
		t.Fatal("wrote something without being asked")
	}
	// Mod server, End on from the start: nothing either.
	a.prepareEnd(ctx, createRequest{ID: "abc12345", Kind: "fabric", AllowEnd: &yes})
	if exists(off) || exists(back) {
		t.Fatal("a data pack for a server that never turned the End off")
	}
	// Off: the data pack is there.
	a.prepareEnd(ctx, createRequest{ID: "abc12345", Kind: "forge", AllowEnd: &no})
	if !exists(filepath.Join(off, "pack.mcmeta")) || !exists(filepath.Join(off, "data/mchost_end_off/function/check.mcfunction")) || exists(back) {
		t.Fatal("End off: no data pack")
	}
	// On again: the portals come back.
	a.prepareEnd(ctx, createRequest{ID: "abc12345", Kind: "forge", AllowEnd: &yes})
	if exists(off) || !exists(filepath.Join(back, "data/mchost_end_on/function/check.mcfunction")) {
		t.Fatal("End on again: the off pack stayed or the on pack is missing")
	}
	// Off again: the on pack goes.
	a.prepareEnd(ctx, createRequest{ID: "abc12345", Kind: "forge", AllowEnd: &no})
	if !exists(off) || exists(back) {
		t.Fatal("End off again")
	}
	// The world it runs gets the pack.
	a.prepareEnd(ctx, createRequest{ID: "abc12345", Kind: "neoforge", Level: "world-2", AllowEnd: &no})
	if !exists(filepath.Join(data, "world-2", endOffPackDir, "pack.mcmeta")) {
		t.Fatal("not in the server's own world")
	}
}

func TestPrepareEndPaper(t *testing.T) {
	_, a, data := filesAgent(t)
	ctx := context.Background()
	bukkit := filepath.Join(data, "bukkit.yml")
	no, yes := false, true
	read := func() string { b, _ := os.ReadFile(bukkit); return string(b) }

	a.prepareEnd(ctx, createRequest{ID: "abc12345", Kind: "vanilla", AllowEnd: &yes})
	if _, err := os.Stat(bukkit); err == nil {
		t.Fatal("wrote bukkit.yml for Bukkit's default")
	}
	a.prepareEnd(ctx, createRequest{ID: "abc12345", Kind: "vanilla", AllowEnd: &no})
	if got := read(); got != "settings:\n  allow-end: false\n" {
		t.Fatalf("new bukkit.yml: %q", got)
	}
	if _, err := os.Stat(filepath.Join(data, "world", endOffPackDir)); err == nil {
		t.Fatal("Paper got the data pack")
	}

	full := "settings:\n  allow-end: true\n  warn-on-overload: true\nspawn-limits:\n  monsters: 70\n"
	os.WriteFile(bukkit, []byte(full), 0o644)
	a.prepareEnd(ctx, createRequest{ID: "abc12345", Kind: "skyblock", AllowEnd: &no})
	if got := read(); got != strings.Replace(full, "allow-end: true", "allow-end: false", 1) {
		t.Fatalf("off: %q", got)
	}
	a.prepareEnd(ctx, createRequest{ID: "abc12345", Kind: "skyblock", AllowEnd: &yes})
	if got := read(); got != full {
		t.Fatalf("on: %q", got)
	}
	os.WriteFile(bukkit, []byte("settings:\n  warn-on-overload: true\n"), 0o644)
	a.prepareEnd(ctx, createRequest{ID: "abc12345", Kind: "vanilla", AllowEnd: &no})
	if got := read(); got != "settings:\n  allow-end: false\n  warn-on-overload: true\n" {
		t.Fatalf("missing key: %q", got)
	}

	// A mod server that had the End off and became a Paper one: its portals come back.
	os.MkdirAll(filepath.Join(data, "world", endOffPackDir), 0o755)
	a.prepareEnd(ctx, createRequest{ID: "abc12345", Kind: "vanilla", AllowEnd: &yes})
	if _, err := os.Stat(filepath.Join(data, "world", endOffPackDir)); err == nil {
		t.Fatal("the off pack stayed on Paper")
	}
	if _, err := os.Stat(filepath.Join(data, "world", endOnPackDir, "pack.mcmeta")); err != nil {
		t.Fatal(err)
	}
}
