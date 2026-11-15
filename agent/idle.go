package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Bedrock and Terraria have no built-in autostop, so the agent watches them
// instead: a free server with nobody online for the idle period is put to
// sleep. Its owner wakes it from the panel (there's no hostname to route on).
// Bedrock's players come from its console; Terraria's from the connections
// to its port.

func (a *agent) watchIdle(ctx context.Context) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if err := a.sleepIdle(ctx); err != nil {
				log.Printf("idle check: %v", err)
			}
		}
	}
}

func (a *agent) sleepIdle(ctx context.Context) error {
	filters := `{"label":["mchost.autostop=true"],"status":["running"]}`
	var list []struct {
		Labels map[string]string `json:"Labels"`
	}
	if err := a.docker.call(ctx, http.MethodGet, "/containers/json", url.Values{"filters": {filters}}, nil, &list); err != nil {
		return err
	}
	for _, c := range list {
		id := c.Labels["mchost.server"]
		var idle time.Duration
		var joined bool
		var err error
		switch c.Labels["mchost.edition"] {
		case "BEDROCK":
			idle, joined, err = a.bedrockIdleFor(ctx, id)
		case "TERRARIA":
			idle, joined, err = a.terrariaIdleFor(ctx, id)
		default:
			continue // Java's image stops by itself
		}
		if err != nil {
			log.Printf("idle check %s: %v", id, err)
			continue
		}
		if idle < a.idleLimit(joined) {
			continue
		}
		log.Printf("putting %s to sleep after %s with no players", id, idle.Round(time.Second))
		a.setMarker(id, "sleeping")
		if err := a.docker.StopContainer(ctx, containerName(id), 60); err != nil { // Terraria saves its world first
			log.Printf("sleep %s: %v", id, err)
		}
	}
	return nil
}

// idleLimit is how long a Bedrock or Terraria server may have nobody online
// before it sleeps: the idle period once someone has played since the start,
// and at least firstJoinGrace before anyone has, so whoever clicked Start can
// open the game and join (with the 100 s idle period, free Bedrock servers
// went to sleep before anyone could join, 2026-11-15).
func (a *agent) idleLimit(joined bool) time.Duration {
	if joined {
		return a.idle
	}
	return max(a.idle, firstJoinGrace)
}

// bedrockIdleFor returns how long the server has had nobody online (0 if
// someone is), and whether anyone has joined since it started.
func (a *agent) bedrockIdleFor(ctx context.Context, id string) (time.Duration, bool, error) {
	name := containerName(id)
	info, err := a.docker.InspectContainer(ctx, name)
	if err != nil {
		return 0, false, err
	}
	started, err := time.Parse(time.RFC3339Nano, info.State.StartedAt)
	if err != nil {
		return 0, false, fmt.Errorf("parse StartedAt: %w", err)
	}
	var lines []string
	err = a.docker.Logs(ctx, name, LogOptions{Since: started.Unix(), Timestamps: true}, func(line string) error {
		lines = append(lines, line)
		return nil
	})
	if err != nil {
		return 0, false, err
	}
	online, last := countBedrockPlayers(lines, started)
	if online > 0 {
		return 0, true, nil
	}
	return time.Since(last), last.After(started), nil
}

// countBedrockPlayers replays join/leave lines from a timestamped log and
// returns who is still online and when the last join/leave happened.
func countBedrockPlayers(lines []string, since time.Time) (online int, lastActivity time.Time) {
	lastActivity = since
	for _, line := range lines {
		ts, msg, ok := strings.Cut(line, " ")
		if !ok {
			continue
		}
		var delta int
		switch {
		case strings.Contains(msg, "Player connected:"):
			delta = 1
		case strings.Contains(msg, "Player disconnected:"):
			delta = -1
		default:
			continue
		}
		online = max(0, online+delta)
		if t, err := time.Parse(time.RFC3339Nano, ts); err == nil && t.After(lastActivity) {
			lastActivity = t
		}
	}
	return online, lastActivity
}

// terrariaIdleFor returns how long the server has had nobody connected (0 if
// someone is), and whether anyone has played since it started.
func (a *agent) terrariaIdleFor(ctx context.Context, id string) (time.Duration, bool, error) {
	name := containerName(id)
	info, err := a.docker.InspectContainer(ctx, name)
	if err != nil {
		return 0, false, err
	}
	last, err := time.Parse(time.RFC3339Nano, info.State.StartedAt)
	if err != nil {
		return 0, false, fmt.Errorf("parse StartedAt: %w", err)
	}
	// Still making its world (which can take minutes) or loading it: nobody
	// could have joined yet, so the idle time starts once the server is up.
	if info.State.Health == nil || info.State.Health.Status != "healthy" {
		a.terrariaUp.Store(id, time.Now())
		return 0, false, nil
	}
	n, err := a.terrariaConnections(ctx, name)
	if err != nil {
		return 0, false, err
	}
	if n > 0 {
		a.lastPlayed.Store(id, time.Now())
		return 0, true, nil
	}
	if v, ok := a.lastPlayed.Load(id); ok && v.(time.Time).After(last) {
		return time.Since(v.(time.Time)), true, nil
	}
	if up, ok := a.terrariaUp.Load(id); ok && up.(time.Time).After(last) {
		last = up.(time.Time)
	}
	return time.Since(last), false, nil
}
