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

// Bedrock has no built-in autostop, so the agent watches the console instead:
// a free Bedrock server with nobody online for the idle period is put to sleep.
// Its owner wakes it from the panel (Bedrock has no hostname to route on).

func (a *agent) watchIdleBedrock(ctx context.Context) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if err := a.sleepIdleBedrock(ctx); err != nil {
				log.Printf("idle check: %v", err)
			}
		}
	}
}

func (a *agent) sleepIdleBedrock(ctx context.Context) error {
	filters := `{"label":["mchost.edition=BEDROCK","mchost.autostop=true"],"status":["running"]}`
	var list []struct {
		Labels map[string]string `json:"Labels"`
	}
	if err := a.docker.call(ctx, http.MethodGet, "/containers/json", url.Values{"filters": {filters}}, nil, &list); err != nil {
		return err
	}
	for _, c := range list {
		id := c.Labels["mchost.server"]
		idle, err := a.bedrockIdleFor(ctx, id)
		if err != nil {
			log.Printf("idle check %s: %v", id, err)
			continue
		}
		if idle < a.idle {
			continue
		}
		log.Printf("putting %s to sleep after %s with no players", id, idle.Round(time.Second))
		a.setMarker(id, "sleeping")
		if err := a.docker.StopContainer(ctx, containerName(id), 30); err != nil {
			log.Printf("sleep %s: %v", id, err)
		}
	}
	return nil
}

// bedrockIdleFor returns how long the server has had nobody online (0 if someone is).
func (a *agent) bedrockIdleFor(ctx context.Context, id string) (time.Duration, error) {
	name := containerName(id)
	info, err := a.docker.InspectContainer(ctx, name)
	if err != nil {
		return 0, err
	}
	started, err := time.Parse(time.RFC3339Nano, info.State.StartedAt)
	if err != nil {
		return 0, fmt.Errorf("parse StartedAt: %w", err)
	}
	var lines []string
	err = a.docker.Logs(ctx, name, LogOptions{Since: started.Unix(), Timestamps: true}, func(line string) error {
		lines = append(lines, line)
		return nil
	})
	if err != nil {
		return 0, err
	}
	online, last := countBedrockPlayers(lines, started)
	if online > 0 {
		return 0, nil
	}
	return time.Since(last), nil
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
