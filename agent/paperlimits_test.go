package main

import (
	"strings"
	"testing"
)

const paperDefaultsSample = `_version: 31
anticheat:
  obfuscation:
    items:
      enable-item-obfuscation: false
chunks:
  auto-save-interval: default
  delay-chunk-unloads-by: 10s
  entity-per-chunk-save-limit:
    arrow: -1
    ender_pearl: -1
    experience_orb: 40
    fireball: -1
    small_fireball: -1
    snowball: -1
  fixed-chunk-inhabited-time: -1
collisions:
  max-entity-collisions: 8
`

func TestSetEntitySaveLimits(t *testing.T) {
	got := setEntitySaveLimits(paperDefaultsSample, paperEntityLimits)
	for _, want := range []string{
		"    arrow: 16\n", "    ender_pearl: 8\n", "    experience_orb: 40\n", // owner's value stays
		"    snowball: 8\n", "    item: 256\n  fixed-chunk-inhabited-time: -1\n",
		"collisions:\n  max-entity-collisions: 8\n",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
	if again := setEntitySaveLimits(got, paperEntityLimits); again != got {
		t.Errorf("second run changed the file:\n%s", again)
	}
}

func TestSetEntitySaveLimitsEmptySection(t *testing.T) {
	got := setEntitySaveLimits("chunks:\n  entity-per-chunk-save-limit: {}\n  max-auto-save-chunks-per-tick: 24\n", map[string]int{"item": 256})
	want := "chunks:\n  entity-per-chunk-save-limit:\n    item: 256\n  max-auto-save-chunks-per-tick: 24\n"
	if got != want {
		t.Errorf("got\n%s", got)
	}
}

func TestSetEntitySaveLimitsNoSection(t *testing.T) {
	text := "_version: 31\nentities:\n  spawning:\n    count-all-mobs-for-spawning: false\n"
	if got := setEntitySaveLimits(text, paperEntityLimits); got != text {
		t.Errorf("changed a file without the section:\n%s", got)
	}
}
