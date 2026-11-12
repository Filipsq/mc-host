package main

import (
	"strings"
)

// A Java world keeps its difficulty in level.dat, and once the world exists
// the server goes by that, not by server.properties: picking another
// difficulty in the panel's Settings changed the file but not the game. So
// once per start, when the server answers over RCON, the agent asks the world
// for its difficulty and sets the one from the settings if it differs (the
// world then saves it). Hardcore is always hard, so it's left alone.
func syncDifficulty(env []string, m *serverMetrics, run func(string) (string, error)) {
	m.mu.Lock()
	done := m.difficulty
	m.mu.Unlock()
	if done {
		return
	}
	want := strings.ToLower(envValue(env, "DIFFICULTY"))
	if difficulties[want] && !strings.EqualFold(envValue(env, "HARDCORE"), "true") {
		// minecraft: so a plugin's own /difficulty doesn't answer instead.
		out, err := run("minecraft:difficulty")
		if err != nil {
			return // tried again with the next sample
		}
		if !strings.Contains(strings.ToLower(out), want) {
			if _, err := run("minecraft:difficulty " + want); err != nil {
				return
			}
		}
	}
	m.mu.Lock()
	m.difficulty = true
	m.mu.Unlock()
}

// envValue is the value of name in a container's environment, "" if unset.
func envValue(env []string, name string) string {
	for _, e := range env {
		if v, ok := strings.CutPrefix(e, name+"="); ok {
			return v
		}
	}
	return ""
}
