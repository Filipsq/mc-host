package main

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
)

// The machine has room for MEMORY_LIMIT_MB of plan memory. Paid servers hold
// their share even while stopped, so their owners can always start them (the
// panel stops selling plans once it's all sold). Free servers only count while
// awake, and one that doesn't fit has to wait until another falls asleep.

var errFull = errors.New("full")

type containerSummary struct {
	State  string            `json:"State"`
	Labels map[string]string `json:"Labels"`
}

// startServer starts a server's container, refusing a free one with errFull
// when the machine has no memory left for it.
func (a *agent) startServer(ctx context.Context, id string) error {
	// One start at a time, so two free servers can't both take the last slot.
	a.startMu.Lock()
	defer a.startMu.Unlock()
	if a.memoryLimit > 0 {
		info, err := a.docker.InspectContainer(ctx, containerName(id))
		if err != nil {
			return err
		}
		if info.Config.Labels["mchost.autostop"] == "true" && info.State.Status != "running" {
			var list []containerSummary
			query := url.Values{"all": {"1"}, "filters": {`{"label":["mchost.server"]}`}}
			if err := a.docker.call(ctx, http.MethodGet, "/containers/json", query, nil, &list); err != nil {
				return err
			}
			need, _ := strconv.Atoi(info.Config.Labels["mchost.memory"])
			if a.memoryInUse(list, id)+need > a.memoryLimit {
				return errFull
			}
		}
	}
	if a.overDisk(ctx, id) {
		a.setMarker(id, "disk")
		return errDiskFull
	}
	a.clearMarkers(id)
	return a.docker.StartContainer(ctx, containerName(id))
}

// memoryInUse adds up the plan memory held by every server except skip.
func (a *agent) memoryInUse(list []containerSummary, skip string) int {
	total := 0
	for _, c := range list {
		id := c.Labels["mchost.server"]
		if id == skip {
			continue
		}
		awake := c.State == "running" || c.State == "restarting"
		paid := c.Labels["mchost.autostop"] != "true" && !a.hasMarker(id, "suspended")
		if awake || paid {
			mb, _ := strconv.Atoi(c.Labels["mchost.memory"])
			total += mb
		}
	}
	return total
}
