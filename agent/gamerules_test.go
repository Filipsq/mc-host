package main

import (
	"slices"
	"testing"
)

func TestSyncGameRules(t *testing.T) {
	m := &serverMetrics{}
	var ran []string
	run := func(cmd string) (string, error) { ran = append(ran, cmd); return "", nil }
	env := []string{"ALLOW_NETHER=false", "PVP=true", "SPAWN_MONSTERS=FALSE"}
	syncGameRules(env, false, m, run)
	syncGameRules(env, false, m, run) // once per start
	want := []string{
		"minecraft:gamerule minecraft:allow_entering_nether_using_portals false", "minecraft:gamerule allowEnteringNetherUsingPortals false",
		"minecraft:gamerule minecraft:pvp true", "minecraft:gamerule pvp true",
		"minecraft:gamerule minecraft:spawn_monsters false", "minecraft:gamerule spawnMonsters false",
	}
	if !slices.Equal(ran, want) || !m.gameRules {
		t.Fatalf("ran %q", ran)
	}

	m, ran = &serverMetrics{}, nil
	syncGameRules(env, true, m, run)
	if len(ran) != 0 || !m.gameRules {
		t.Fatalf("minigames: ran %q", ran)
	}
}
