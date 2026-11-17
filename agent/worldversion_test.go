package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestNoteWorldVersionKeepsTheNewest(t *testing.T) {
	a, data := paperConfigAgent(t, "[12:58:28 INFO]: Loading properties\n[12:58:28 INFO]: Starting minecraft server version 26.1.2\n")
	os.MkdirAll(filepath.Join(data, "world"), 0o755)
	note := func() string {
		m := &serverMetrics{startedAt: "2026-11-17T12:58:00Z"}
		a.noteWorldVersion(context.Background(), "abc12345", "", m)
		if !m.worldVersion {
			t.Fatal("start not marked as noted")
		}
		b, _ := os.ReadFile(filepath.Join(data, "world", worldVersionFile))
		return string(b)
	}
	if got := note(); got != "26.1.2\n" {
		t.Fatalf("first start: %q", got)
	}
	os.WriteFile(filepath.Join(data, "world", worldVersionFile), []byte("26.3\n"), 0o644)
	if got := note(); got != "26.3\n" {
		t.Fatalf("an older version replaced a newer one: %q", got)
	}
}

func TestCompareVersions(t *testing.T) {
	for _, c := range []struct {
		a, b string
		less bool
	}{{"1.21.11", "26.1", true}, {"26.1", "26.1.2", true}, {"26.1.2", "26.3", true}, {"26.3", "26.3", false}, {"26.3", "26.2", false}} {
		if got := compareVersions(c.a, c.b) < 0; got != c.less {
			t.Errorf("%s < %s: %v", c.a, c.b, got)
		}
	}
}
