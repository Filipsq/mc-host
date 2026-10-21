package main

import (
	"context"
	"log"
	"strings"
	"time"
)

// Classic Skyblock: one map everyone shares, like the old Skyblock maps, with
// a starting island (grass, a tree and a chest) and a sand island further off,
// in an empty world. Old maps can't be handed out (their authors keep the
// rights) and don't load on new versions, so the agent builds ours: the
// server makes an empty world (skyMapGenerator), and once it answers over RCON
// the agent places the islands with ordinary commands, which work the same on
// every version the panel offers (1.18.2 onwards). It builds only into a world
// that is still empty around spawn, so an uploaded world is never touched, and
// only once per world (skyMapMarker in the world's folder).

// The world: a single layer of air, so nothing but void. Plains, not the void
// biome, so monsters still spawn on what players build; no structures, so no
// floating villages.
const skyMapGenerator = `{"layers":[{"block":"minecraft:air","height":1}],"biome":"minecraft:plains","features":false,"lakes":false,"structure_overrides":[]}`

const skyMapMarker = ".mchost-skymap"

// Chunks the islands touch, kept loaded while they're built.
var skyMapLoad = []string{"forceload add -16 -16 79 16"}

// Empty means void at spawn: in any generated world the ground at y 0 is stone, never plain air.
// Both islands' chunks are asked about, so the answer comes only once all are loaded.
const skyMapEmpty = "execute if block 0 0 0 minecraft:air if block 0 40 0 minecraft:air if block 0 63 0 minecraft:air if block 60 0 0 minecraft:air"

var skyMapBuild = []string{
	// Starting island: an L of dirt three blocks deep under grass, as on the old maps.
	"fill -1 61 -1 4 62 1 minecraft:dirt",
	"fill -1 61 2 1 62 4 minecraft:dirt",
	"fill -1 63 -1 4 63 1 minecraft:grass_block",
	"fill -1 63 2 1 63 4 minecraft:grass_block",
	// An oak tree. Its leaves never wither (persistent), yet breaking them still drops saplings.
	"fill 1 67 -2 5 68 2 minecraft:oak_leaves[persistent=true]",
	"fill 2 69 -1 4 70 1 minecraft:oak_leaves[persistent=true]",
	"fill 3 64 0 3 69 0 minecraft:oak_log",
	// The chest: lava and ice make a cobblestone generator, the rest grows into food.
	"setblock 0 64 4 minecraft:chest[facing=north]",
	"item replace block 0 64 4 container.0 with minecraft:lava_bucket 1",
	"item replace block 0 64 4 container.1 with minecraft:ice 2",
	"item replace block 0 64 4 container.2 with minecraft:melon_slice 1",
	"item replace block 0 64 4 container.3 with minecraft:red_mushroom 1",
	"item replace block 0 64 4 container.4 with minecraft:brown_mushroom 1",
	"item replace block 0 64 4 container.5 with minecraft:bone_meal 3",
	// Sand island, 60 blocks east: reached by building a bridge. Sandstone underneath holds the sand up.
	"fill 58 60 -2 62 60 2 minecraft:sandstone",
	"fill 58 61 -2 62 62 2 minecraft:sand",
	"setblock 60 63 0 minecraft:cactus",
	"setblock 62 63 2 minecraft:chest[facing=west]",
	"item replace block 62 63 2 container.0 with minecraft:obsidian 10",
	"item replace block 62 63 2 container.1 with minecraft:sugar_cane 1",
	"item replace block 62 63 2 container.2 with minecraft:pumpkin_seeds 1",
	// Everyone starts on the grass by the tree.
	"setworldspawn 0 64 0",
}

// Spawn exactly at the world spawn, not anywhere within 10 blocks (over the
// void). The rule was renamed in 1.21.11; the server answers the other name
// with an error, which changes nothing.
var skyMapRules = []string{"gamerule spawnRadius 0", "gamerule respawn_radius 0", "forceload remove all"}

// skyMap builds a classic Skyblock server's islands the first time its world
// answers. Called with each sample once the server answers over RCON.
func (a *agent) skyMap(ctx context.Context, name, level string, m *serverMetrics, run func(string) (string, error)) {
	m.mu.Lock()
	done := m.skyMap
	m.mu.Unlock()
	if done {
		return
	}
	if level == "" {
		level = defaultJavaLevel
	}
	marker := "/data/" + level + "/" + skyMapMarker
	out, err := a.docker.Exec(ctx, name, []string{"sh", "-c", `test -f "$1" && echo yes`, "sh", marker})
	if err != nil {
		return
	}
	if !strings.Contains(out, "yes") {
		if !a.buildSkyMap(name, m, run) {
			return // tried again with the next sample
		}
		if _, err := a.docker.Exec(ctx, name, []string{"touch", marker}); err != nil {
			log.Printf("skymap %s: %v", name, err)
			return
		}
	}
	m.mu.Lock()
	m.skyMap = true
	m.mu.Unlock()
}

// skyMapWait gives the server time to load the chunks it was told to keep loaded.
var skyMapWait = 3 * time.Second

// buildSkyMap places the islands, or nothing if the world isn't empty. False:
// try again later (the server didn't answer, or the chunks aren't loaded yet).
// Once the world was found empty, a build cut short starts over without asking
// again (the islands it placed would say no).
func (a *agent) buildSkyMap(name string, m *serverMetrics, run func(string) (string, error)) bool {
	for _, c := range skyMapLoad {
		if _, err := run(c); err != nil {
			return false
		}
	}
	time.Sleep(skyMapWait)
	m.mu.Lock()
	building := m.skyMapBuilding
	m.mu.Unlock()
	if !building {
		out, err := run(skyMapEmpty)
		if err != nil || strings.Contains(out, "not loaded") {
			return false
		}
		if building = strings.Contains(out, "passed"); !building {
			log.Printf("skymap %s: the world isn't empty, not building islands", name)
		}
		m.mu.Lock()
		m.skyMapBuilding = building
		m.mu.Unlock()
	}
	var cmds []string
	if building {
		cmds = skyMapBuild
	}
	for _, c := range append(cmds, skyMapRules...) {
		out, err := run(c)
		if err != nil || strings.Contains(out, "not loaded") {
			return false
		}
	}
	return true
}
