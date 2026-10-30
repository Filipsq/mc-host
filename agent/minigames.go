package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"path"
	"strings"
	"time"
)

// Minigames: a server for a few friends with a lobby and five games of our
// own, Spleef, TNT Run, SkyWars, Chowany (hide and seek) and Parkour, ready
// as soon as it starts. Minigame plugins come without maps, and maps from the
// internet can't be handed out (their authors keep the rights), so the games
// are a data pack of ours (the minigames folder): its functions build the map
// and run the rounds, with ordinary commands of Minecraft 1.21.5 and newer.
// Everyone joins with the plain game (Bedrock too, with crossplay).
//
// The world is empty, like classic Skyblock's (skyMapGenerator). The agent
// writes the data pack into the world's folder when it makes the container,
// so Minecraft loads it as the world starts, and once the server answers over
// RCON it sets the game rules and builds the map (function mg:build), only
// into a world that is still empty around spawn and only once per world
// (minigamesMarker), so an uploaded world is never touched.

//go:embed minigames
var minigamesPack embed.FS

// The data pack's folder in the world; written over on every new container, so an agent update brings the newer games.
const minigamesPackDir = "datapacks/mchost-minigry"

const minigamesMarker = ".mchost-minigames"

// Chunks the map touches, kept loaded while it's built: the lobby, Spleef,
// TNT Run, SkyWars and its copy, Chowany and Parkour.
var minigamesLoad = []string{
	"forceload add -16 -16 15 15",
	"forceload add 88 -12 112 12",
	"forceload add -112 -12 -88 12",
	"forceload add -28 -178 28 -122",
	"forceload add -28 -378 28 -322",
	"forceload add -18 132 18 176",
	"forceload add -8 245 8 352",
}

// After the build only SkyWars stays loaded: each round copies its islands back from the copy.
var minigamesKeep = []string{"forceload remove all", "forceload add -28 -178 28 -122", "forceload add -28 -378 28 -322"}

// Empty means void at spawn and nothing built yet; the lobby's floor is at y 99.
const minigamesEmpty = "execute if block 0 0 0 minecraft:air if block 0 63 0 minecraft:air if block 0 99 0 minecraft:air if block 100 100 0 minecraft:air"

// Rules for every start. Game rules were renamed in 1.21.11 and team options
// may spell their values either way; the server answers the name it doesn't
// know with an error, which changes nothing. They aren't in the data pack,
// where one line Minecraft can't read would drop its whole function.
var minigamesRules = []string{
	"gamerule spawnRadius 0", "gamerule respawn_radius 0",
	"gamerule doImmediateRespawn true", "gamerule immediate_respawn true",
	"gamerule doDaylightCycle false", "gamerule advance_time false",
	"gamerule doWeatherCycle false", "gamerule advance_weather false",
	"gamerule doMobSpawning false", "gamerule spawn_mobs false",
	"gamerule doInsomnia false", "gamerule spawn_phantoms false",
	"gamerule announceAdvancements false", "gamerule show_advancement_messages false",
	"time set 6000", "weather clear",
	"team add mg_seek", "team add mg_hide",
	"team modify mg_seek color red", "team modify mg_hide color green",
	"team modify mg_seek friendlyFire false", "team modify mg_hide friendlyFire false",
	// Hiders can't see each other's names through walls, and the seekers can't see theirs.
	"team modify mg_hide nametagVisibility hideForOtherTeams", "team modify mg_hide nametagVisibility hide_for_other_teams",
}

// prepareMinigames puts the data pack in the world's folder of a new or remade container.
func (a *agent) prepareMinigames(ctx context.Context, id, kind, level string) {
	if kind != "minigames" || a.volumesDir == "" {
		return
	}
	s, err := a.openFiles(ctx, id)
	if err != nil {
		log.Printf("minigames %s: %v", id, err)
		return
	}
	defer s.Close()
	dir := path.Join(level, minigamesPackDir)
	if err := s.root.RemoveAll(dir); err != nil {
		log.Printf("minigames %s: %v", id, err)
		return
	}
	err = fs.WalkDir(minigamesPack, "minigames", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		f, err := minigamesPack.Open(name)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = s.writeFile(path.Join(dir, strings.TrimPrefix(name, "minigames/")), f)
		return err
	})
	if err != nil {
		log.Printf("minigames %s: %v", id, err)
	}
}

// minigames sets the rules once per start and builds the map the first time
// the world answers. Called with each sample once the server answers over RCON.
func (a *agent) minigames(ctx context.Context, name, level string, m *serverMetrics, run func(string) (string, error)) {
	m.mu.Lock()
	done := m.minigames
	m.mu.Unlock()
	if done {
		return
	}
	if level == "" {
		level = defaultJavaLevel
	}
	marker := "/data/" + level + "/" + minigamesMarker
	out, err := a.docker.Exec(ctx, name, []string{"sh", "-c", `test -f "$1" && echo yes`, "sh", marker})
	if err != nil {
		return
	}
	if !strings.Contains(out, "yes") {
		built, ok := a.buildMinigames(name, m, run)
		if !ok {
			return // tried again with the next sample
		}
		if built {
			if _, err := a.docker.Exec(ctx, name, []string{"touch", marker}); err != nil {
				log.Printf("minigames %s: %v", name, err)
				return
			}
		}
	}
	for _, c := range minigamesRules {
		if _, err := run(c); err != nil {
			return
		}
	}
	m.mu.Lock()
	m.minigames = true
	m.mu.Unlock()
}

// buildMinigames builds the map, or nothing if the world isn't empty. ok
// false: try again later (the server didn't answer, or the chunks aren't loaded
// yet). built false: don't mark the world, so the next start tries again (the
// data pack didn't load). Once the world was found empty, a build cut short
// starts over without asking again (what it placed would say no).
func (a *agent) buildMinigames(name string, m *serverMetrics, run func(string) (string, error)) (built, ok bool) {
	for _, c := range minigamesLoad {
		if _, err := run(c); err != nil {
			return false, false
		}
	}
	time.Sleep(skyMapWait)
	m.mu.Lock()
	building := m.minigamesBuilding
	m.mu.Unlock()
	if !building {
		out, err := run(minigamesEmpty)
		if err != nil || strings.Contains(out, "not loaded") {
			return false, false
		}
		if building = strings.Contains(out, "passed"); !building {
			log.Printf("minigames %s: the world isn't empty, not building the map", name)
		}
		m.mu.Lock()
		m.minigamesBuilding = building
		m.mu.Unlock()
	}
	built = true
	if building {
		out, err := run("function mg:build")
		if err != nil {
			return false, false
		}
		if strings.Contains(out, "not loaded") {
			return false, false
		}
		if strings.Contains(strings.ToLower(out), "unknown") {
			// Minecraft couldn't read the data pack (its log says why); nothing was built.
			log.Printf("minigames %s: no map built: %s", name, strings.TrimSpace(out))
			built = false
		}
	}
	for _, c := range minigamesKeep {
		if _, err := run(c); err != nil {
			return false, false
		}
	}
	return built, true
}
