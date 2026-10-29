package main

import (
	"context"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func ownerOf(t *testing.T, p string) uint32 {
	t.Helper()
	fi, err := os.Lstat(p)
	if err != nil {
		t.Fatal(err)
	}
	return fi.Sys().(*syscall.Stat_t).Uid
}

func TestFixOwnersGivesRootFilesToTheFolderOwner(t *testing.T) {
	if os.Getuid() != 0 {
		t.Skip("needs root to make root-owned files")
	}
	_, a, data := filesAgent(t)
	deep := filepath.Join(data, "behavior_packs", "vanilla", "structures", "ruin")
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(deep, "ruin4.nbt")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Root files under a folder the game (uid 1000) owns, as after the old one-time fix.
	if err := os.Chown(data, 1000, 1000); err != nil {
		t.Fatal(err)
	}
	a.fixOwners(context.Background(), "abc12345")
	for _, p := range []string{file, deep, filepath.Join(data, "behavior_packs")} {
		if got := ownerOf(t, p); got != 1000 {
			t.Errorf("%s owned by %d, want 1000", p, got)
		}
	}
}

func TestFixOwnersLeavesARootServerAlone(t *testing.T) {
	if os.Getuid() != 0 {
		t.Skip("needs root to make root-owned files")
	}
	_, a, data := filesAgent(t)
	file := filepath.Join(data, "server.properties")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	a.fixOwners(context.Background(), "abc12345")
	if got := ownerOf(t, file); got != 0 {
		t.Errorf("owned by %d, want root kept", got)
	}
}
