package main

import (
	"context"
	"log"
	"strings"
)

// Big mod packs generate new chunks slowly, so players exploring a new world
// wait for the map to appear. Mod pack servers get Chunky (packScript), and
// the agent has it generate the map around spawn while nobody is online,
// pausing it as soon as someone joins. Chunky remembers its task, so once the
// area is done continue and pause do nothing.

const pregenRadius = "1000" // blocks around spawn: about 16,000 chunks

// pregenMarker says the task was set up once, so a restart only continues it.
const pregenMarker = "/data/.mchost-pregen"

// pregen starts, pauses or continues the server's Chunky task when the number
// of players online goes between none and some. Called with each sample once
// the server answers over RCON; the state starts over when the container does.
func (a *agent) pregen(ctx context.Context, name string, m *serverMetrics, run func(string) (string, error), players int) {
	want := "running"
	if players > 0 {
		want = "paused"
	}
	m.mu.Lock()
	same := m.pregen == want
	m.mu.Unlock()
	if same {
		return
	}
	var cmds []string
	switch {
	case want == "paused":
		cmds = []string{"chunky pause"}
	case a.pregenStarted(ctx, name):
		cmds = []string{"chunky continue"}
	default:
		// silent: progress would fill the console the owner reads.
		cmds = []string{"chunky silent", "chunky spawn", "chunky radius " + pregenRadius, "chunky start"}
	}
	for _, c := range cmds {
		if _, err := run(c); err != nil {
			return // tried again with the next sample
		}
	}
	if want == "running" {
		if _, err := a.docker.Exec(ctx, name, []string{"touch", pregenMarker}); err != nil {
			log.Printf("pregen %s: %v", name, err)
		}
	}
	m.mu.Lock()
	m.pregen = want
	m.mu.Unlock()
}

func (a *agent) pregenStarted(ctx context.Context, name string) bool {
	out, err := a.docker.Exec(ctx, name, []string{"sh", "-c", "test -f " + pregenMarker + " && echo yes"})
	return err == nil && strings.Contains(out, "yes")
}
