package main

import (
	"context"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Halloween Survival: an ordinary world on Paper, where everyone joins with the
// plain game (Bedrock too, with crossplay), with a spooky square the agent
// builds at spawn the first time the world answers: pumpkins and jack
// o'lanterns, a dead tree with cobwebs, a little graveyard, a witch's cauldron
// and a chest of treats, inside a fence with soul lanterns. The night falls
// right away. While players are on, zombies and skeletons get pumpkins on
// their heads. Halloween maps from the internet can't be handed out (their
// authors keep the rights), so the agent builds ours, with ordinary commands
// that work the same on every version the panel offers it on (1.19.4 onwards).
//
// The square goes only into a world that has just been made (its game time is
// young), so an uploaded world is never touched, and only once per world
// (halloweenMarker in the world's folder).

const halloweenMarker = ".mchost-halloween"

// A world older than this many ticks (10 minutes of play) wasn't just made.
const halloweenFreshTicks = 12000

// Spawn moves onto the ground at its column, so everything below can be placed
// relative to it: commands sent over RCON run at the world spawn. Run again
// after a build cut short, it lands on the same spot, since the square keeps
// the spawn's column a plain path.
var halloweenSpawn = []string{
	"forceload add ~-16 ~-16 ~16 ~16",
	"execute positioned over motion_blocking_no_leaves run setworldspawn ~ ~ ~",
}

var halloweenBuild = []string{
	// A clear square of podzol with a path cross, on ground filled in below.
	"fill ~-7 ~ ~-7 ~7 ~12 ~7 minecraft:air",
	"fill ~-7 ~-4 ~-7 ~7 ~-2 ~7 minecraft:dirt replace minecraft:air",
	"fill ~-7 ~-4 ~-7 ~7 ~-2 ~7 minecraft:dirt replace minecraft:water",
	"fill ~-7 ~-1 ~-7 ~7 ~-1 ~7 minecraft:podzol",
	"fill ~-7 ~-1 ~-7 ~-3 ~-1 ~-3 minecraft:coarse_dirt",
	"fill ~-1 ~-1 ~-7 ~1 ~-1 ~7 minecraft:dirt_path",
	"fill ~-7 ~-1 ~-1 ~7 ~-1 ~1 minecraft:dirt_path",
	// A dark fence around it, open where the paths leave, with soul lanterns on the corners.
	"fill ~-7 ~ ~-7 ~7 ~ ~-7 minecraft:dark_oak_fence",
	"fill ~-7 ~ ~7 ~7 ~ ~7 minecraft:dark_oak_fence",
	"fill ~-7 ~ ~-6 ~-7 ~ ~6 minecraft:dark_oak_fence",
	"fill ~7 ~ ~-6 ~7 ~ ~6 minecraft:dark_oak_fence",
	"fill ~-1 ~ ~-7 ~1 ~ ~-7 minecraft:air",
	"fill ~-1 ~ ~7 ~1 ~ ~7 minecraft:air",
	"fill ~-7 ~ ~-1 ~-7 ~ ~1 minecraft:air",
	"fill ~7 ~ ~-1 ~7 ~ ~1 minecraft:air",
	"setblock ~-7 ~1 ~-7 minecraft:soul_lantern",
	"setblock ~7 ~1 ~-7 minecraft:soul_lantern",
	"setblock ~-7 ~1 ~7 minecraft:soul_lantern",
	"setblock ~7 ~1 ~7 minecraft:soul_lantern",
	// Jack o'lanterns either side of each path, looking in.
	"setblock ~-2 ~ ~-6 minecraft:jack_o_lantern[facing=south]",
	"setblock ~2 ~ ~-6 minecraft:jack_o_lantern[facing=south]",
	"setblock ~-2 ~ ~6 minecraft:jack_o_lantern[facing=north]",
	"setblock ~2 ~ ~6 minecraft:jack_o_lantern[facing=north]",
	"setblock ~-6 ~ ~-2 minecraft:jack_o_lantern[facing=east]",
	"setblock ~-6 ~ ~2 minecraft:jack_o_lantern[facing=east]",
	"setblock ~6 ~ ~-2 minecraft:jack_o_lantern[facing=west]",
	"setblock ~6 ~ ~2 minecraft:jack_o_lantern[facing=west]",
	// North-west: a pumpkin patch.
	"setblock ~-6 ~ ~-5 minecraft:pumpkin",
	"setblock ~-5 ~ ~-6 minecraft:pumpkin",
	"setblock ~-4 ~ ~-4 minecraft:pumpkin",
	"setblock ~-6 ~ ~-3 minecraft:pumpkin",
	"setblock ~-3 ~ ~-5 minecraft:carved_pumpkin[facing=south]",
	"setblock ~-4 ~ ~-6 minecraft:pumpkin",
	// North-east: a dead tree with cobwebs and a lantern hanging from a branch.
	"fill ~5 ~ ~-5 ~5 ~4 ~-5 minecraft:dark_oak_log",
	"setblock ~4 ~3 ~-5 minecraft:dark_oak_log[axis=x]",
	"setblock ~6 ~4 ~-5 minecraft:dark_oak_log[axis=x]",
	"setblock ~5 ~4 ~-4 minecraft:dark_oak_log[axis=z]",
	"setblock ~5 ~5 ~-5 minecraft:dark_oak_log",
	"setblock ~6 ~3 ~-5 minecraft:soul_lantern[hanging=true]",
	"setblock ~3 ~3 ~-5 minecraft:cobweb",
	"setblock ~4 ~4 ~-5 minecraft:cobweb",
	"setblock ~5 ~4 ~-6 minecraft:cobweb",
	"setblock ~6 ~ ~-6 minecraft:cobweb",
	"setblock ~3 ~ ~-3 minecraft:cobweb",
	// South-west: a little graveyard with headstones, mounds and candles.
	"setblock ~-6 ~ ~3 minecraft:mossy_cobblestone_wall",
	"setblock ~-4 ~ ~3 minecraft:cobblestone_wall",
	"setblock ~-2 ~ ~3 minecraft:mossy_cobblestone_wall",
	"fill ~-6 ~-1 ~4 ~-6 ~-1 ~5 minecraft:coarse_dirt",
	"fill ~-4 ~-1 ~4 ~-4 ~-1 ~5 minecraft:coarse_dirt",
	"fill ~-2 ~-1 ~4 ~-2 ~-1 ~5 minecraft:coarse_dirt",
	"setblock ~-5 ~ ~6 minecraft:cobweb",
	"setblock ~-3 ~ ~6 minecraft:candle[candles=3,lit=true]",
	// South-east: a witch's cauldron by a soul fire, and the chest of treats.
	"setblock ~5 ~ ~5 minecraft:water_cauldron[level=3]",
	"setblock ~6 ~ ~5 minecraft:soul_campfire",
	"setblock ~4 ~ ~6 minecraft:cobweb",
	"setblock ~3 ~ ~4 minecraft:chest[facing=west]",
	"item replace block ~3 ~ ~4 container.0 with minecraft:cookie 16",
	"item replace block ~3 ~ ~4 container.1 with minecraft:pumpkin_pie 8",
	"item replace block ~3 ~ ~4 container.2 with minecraft:cake 1",
	"item replace block ~3 ~ ~4 container.3 with minecraft:honey_bottle 3",
	"item replace block ~3 ~ ~4 container.4 with minecraft:sweet_berries 16",
	"item replace block ~3 ~ ~4 container.5 with minecraft:carved_pumpkin 2",
	"item replace block ~3 ~ ~4 container.6 with minecraft:jack_o_lantern 4",
	"item replace block ~3 ~ ~4 container.7 with minecraft:pumpkin_seeds 4",
	// Night falls as soon as the world is made.
	"time set 13000",
}

// Spawn exactly on the square, not anywhere within 10 blocks. The rule was
// renamed in 1.21.11; the server answers the other name with an error, which
// changes nothing.
var halloweenRules = []string{"gamerule spawnRadius 0", "gamerule respawn_radius 0", "forceload remove all"}

// Monsters that get a pumpkin on their head once (the tag remembers them).
// A head keeps them from burning in the sun, like a helmet: Halloween's monsters see the morning too.
var halloweenHeads = []string{
	"execute as @e[type=minecraft:zombie,tag=!mchost_hw] run item replace entity @s armor.head with minecraft:jack_o_lantern",
	"execute as @e[type=minecraft:husk,tag=!mchost_hw] run item replace entity @s armor.head with minecraft:jack_o_lantern",
	"execute as @e[type=minecraft:skeleton,tag=!mchost_hw] run item replace entity @s armor.head with minecraft:carved_pumpkin",
	"execute as @e[type=minecraft:stray,tag=!mchost_hw] run item replace entity @s armor.head with minecraft:carved_pumpkin",
	"tag @e[type=minecraft:zombie,tag=!mchost_hw] add mchost_hw",
	"tag @e[type=minecraft:husk,tag=!mchost_hw] add mchost_hw",
	"tag @e[type=minecraft:skeleton,tag=!mchost_hw] add mchost_hw",
	"tag @e[type=minecraft:stray,tag=!mchost_hw] add mchost_hw",
}

var lastNumber = regexp.MustCompile(`(\d+)\D*$`)

// halloween builds a Halloween server's square the first time its world
// answers, and puts pumpkins on monsters' heads while anyone plays. Called with
// each sample once the server answers over RCON.
func (a *agent) halloween(ctx context.Context, name, level string, m *serverMetrics, run func(string) (string, error), players int) {
	if players > 0 {
		for _, c := range halloweenHeads {
			if _, err := run(c); err != nil {
				break
			}
		}
	}
	m.mu.Lock()
	done := m.halloween
	m.mu.Unlock()
	if done {
		return
	}
	if level == "" {
		level = defaultJavaLevel
	}
	marker := "/data/" + level + "/" + halloweenMarker
	out, err := a.docker.Exec(ctx, name, []string{"sh", "-c", `test -f "$1" && echo yes`, "sh", marker})
	if err != nil {
		return
	}
	if !strings.Contains(out, "yes") {
		if !a.buildHalloween(name, m, run) {
			return // tried again with the next sample
		}
		if _, err := a.docker.Exec(ctx, name, []string{"touch", marker}); err != nil {
			log.Printf("halloween %s: %v", name, err)
			return
		}
	}
	m.mu.Lock()
	m.halloween = true
	m.mu.Unlock()
}

// buildHalloween places the square, or nothing if the world isn't new. False:
// try again later (the server didn't answer). Once the world was found new, a
// build cut short starts over without asking again (it has aged meanwhile).
func (a *agent) buildHalloween(name string, m *serverMetrics, run func(string) (string, error)) bool {
	m.mu.Lock()
	building := m.halloweenBuilding
	m.mu.Unlock()
	if !building {
		out, err := run("time query gametime")
		if err != nil {
			return false
		}
		match := lastNumber.FindStringSubmatch(strings.TrimSpace(out))
		if match == nil {
			log.Printf("halloween %s: can't read the world's age from %q, not building", name, out)
		} else if ticks, _ := strconv.Atoi(match[1]); ticks < halloweenFreshTicks {
			building = true
		} else {
			log.Printf("halloween %s: the world isn't new (%d ticks), not building", name, ticks)
		}
		m.mu.Lock()
		m.halloweenBuilding = building
		m.mu.Unlock()
	}
	var cmds []string
	if building {
		cmds = append(append(cmds, halloweenSpawn...), halloweenBuild...)
	}
	for _, c := range append(cmds, halloweenRules...) {
		out, err := run(c)
		if err != nil || strings.Contains(out, "not loaded") {
			return false
		}
		if c == halloweenSpawn[0] {
			time.Sleep(skyMapWait) // the chunks it keeps loaded come in
		}
	}
	return true
}
