package main

import (
	"bufio"
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// The machine has room for MEMORY_LIMIT_MB of plan memory. Paid servers hold
// their share even while stopped, so their owners can always start them (the
// panel stops selling plans once it's all sold). Free servers only count while
// awake, and one that doesn't fit has to wait until another falls asleep.
//
// With MEMORY_OVERBOOK above 1 the panel sells that many times the limit, as
// most hosts do: a stopped server uses no memory, and a running Java server
// only as much as its players need (its heap starts small). Then only running
// servers count, against the limit times the factor, and a free server also
// waits until the machine really has its memory free.

var errFull = errors.New("full")

// initialHeapMb is the heap a Java server starts with; it grows up to the plan.
const initialHeapMb = 1024

// freeMemoryMarginMb is what has to stay free on the machine after a free server
// starts, when overbooking and other servers are running: room for them to grow.
const freeMemoryMarginMb = 1024

// meminfoPath describes the whole machine, also inside the agent's container.
var meminfoPath = "/proc/meminfo"

type containerSummary struct {
	State  string            `json:"State"`
	Labels map[string]string `json:"Labels"`
}

// memoryCap is how much plan memory servers may hold together; 0 means no limit.
func (a *agent) memoryCap() int {
	return int(float64(a.memoryLimit) * max(a.overbook, 1))
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
			inUse := a.memoryInUse(list, id)
			if inUse+need > a.memoryCap() {
				return errFull
			}
			if a.overbook > 1 {
				// The margin is for servers already running to grow into; with
				// none, a small machine can still run one free server.
				margin := 0
				if inUse > 0 {
					margin = freeMemoryMarginMb
				}
				if free, ok := memoryAvailableMb(); ok && free < int64(need+margin) {
					return errFull
				}
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
		// Overbooked, a stopped paid server's memory is sold again: it isn't using it.
		paid := a.overbook <= 1 && c.Labels["mchost.autostop"] != "true" && !a.hasMarker(id, "suspended")
		if awake || paid {
			mb, _ := strconv.Atoi(c.Labels["mchost.memory"])
			total += mb
		}
	}
	return total
}

// memoryAvailableMb is how much memory the machine can still give out
// (MemAvailable: free memory plus caches it can drop).
func memoryAvailableMb() (int64, bool) {
	_, avail, ok := readMeminfo()
	return avail, ok
}

func readMeminfo() (totalMb, availableMb int64, ok bool) {
	f, err := os.Open(meminfoPath)
	if err != nil {
		return 0, 0, false
	}
	defer f.Close()
	found := 0
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 2 {
			continue
		}
		kb, err := strconv.ParseInt(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			totalMb = kb >> 10
			found++
		case "MemAvailable:":
			availableMb = kb >> 10
			found++
		}
	}
	return totalMb, availableMb, found == 2
}
