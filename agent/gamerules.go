package main

import (
	"strings"
)

// Since Minecraft 1.21.9 some server.properties options are game rules kept in
// the world: allow-nether, pvp, enable-command-block and spawn-monsters do
// nothing there any more. So the Nether checkbox in the panel's Settings
// changed nothing on a new server ("chillsmp", 2026-11-14), and nor did PvP,
// command blocks or monsters. Once per start, when the server answers over
// RCON, the agent sets those rules from the container's settings. 1.21.11
// renamed the rules (minecraft:allow_entering_nether_using_portals), 1.21.9
// and 1.21.10 use the old names; the name a server doesn't know is refused,
// so both are sent. Older versions have no such rules and still read
// server.properties, so the refusals change nothing there.
var settingRules = []struct {
	env, rule, oldRule string
}{
	{"ALLOW_NETHER", "minecraft:allow_entering_nether_using_portals", "allowEnteringNetherUsingPortals"},
	{"PVP", "minecraft:pvp", "pvp"},
	{"ENABLE_COMMAND_BLOCK", "minecraft:command_blocks_work", "commandBlocksEnabled"},
	{"SPAWN_MONSTERS", "minecraft:spawn_monsters", "spawnMonsters"},
}

func syncGameRules(env []string, minigames bool, m *serverMetrics, run func(string) (string, error)) {
	m.mu.Lock()
	done := m.gameRules
	m.mu.Unlock()
	if done {
		return
	}
	if !minigames { // the minigames' own data pack runs its rules
		for _, r := range settingRules {
			v := strings.ToLower(envValue(env, r.env))
			if v != "true" && v != "false" {
				continue
			}
			// minecraft: so a plugin's own /gamerule doesn't answer instead.
			if _, err := run("minecraft:gamerule " + r.rule + " " + v); err != nil {
				return // tried again with the next sample
			}
			_, _ = run("minecraft:gamerule " + r.oldRule + " " + v)
		}
	}
	m.mu.Lock()
	m.gameRules = true
	m.mu.Unlock()
}
