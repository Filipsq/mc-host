package main

import (
	"context"
	"os"
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
