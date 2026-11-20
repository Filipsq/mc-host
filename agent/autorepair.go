package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Auto-repair: a server that crashed on a cause the agent knows how to fix is
// started again by the agent, so its owner doesn't find it in "Awaria" and
// have to click Uruchom for the fixes to happen. The fixes themselves are the
// ones every start already makes (startServer: healEnv adds the mods Fabric
// said were missing or lets the image take alpha builds, fixBrokenMods sets
// aside the owner's jars that stopped the start); a lost network gets waited
// out. Nothing here touches a world.
//
// Docker already restarts a crashed container once (RestartPolicy on-failure,
// one retry) with the same settings, which only helps a one-off. The agent
// steps in after that, when the container is "exited":
//   - a fixable cause: started again at once, each cause once an hour;
//   - no network (the image couldn't reach Modrinth, Paper's or Mojang's
//     servers by name): started again once the machine resolves names again,
//     after 1, 3 and 10 minutes, for up to networkFresh after the crash;
//   - killed for lack of memory (OOMKilled): started again once, if the
//     machine has its plan's memory free now;
//   - a whitelist name with no Minecraft account ("Could not resolve user
//     from Playerdb"): started again with that name by its offline ID;
//   - anything else (a world saved by a newer Minecraft, an unknown crash):
//     left as it is, and the console says what happened.
//
// At most repairMax starts per server in repairWindow, so a crash that keeps
// coming back stays "Awaria" instead of loading the machine.

const (
	repairEvery  = 20 * time.Second
	repairWindow = time.Hour
	repairMax    = 3
	// A crash older than this (the agent was restarted, or it happened long
	// before) is left for the owner: they may have left it that way.
	repairFresh = 15 * time.Minute
	// A crash for want of network stays worth starting again for longer: an
	// outage can outlast repairFresh, and an agent restarted meanwhile (an
	// update) forgets the crashes it was waiting on. On 2026-11-20 at 11:56 UTC
	// servers on n5, n6 and n7 lost their network at once and stayed "Awaria".
	networkFresh = 6 * time.Hour
)

var networkWaits = []time.Duration{time.Minute, 3 * time.Minute, 10 * time.Minute}

// repairState is one server's auto-repair history.
type repairState struct {
	mu       sync.Mutex
	tries    []time.Time          // starts the agent made, within repairWindow
	causes   map[string]time.Time // fixable causes given their one start, and when
	crash    string               // FinishedAt of the crash being handled
	waitTill time.Time            // not before this (a network crash, or a machine with no room)
	network  bool                 // the crash being handled was for want of network
	done     bool                 // this crash is left for the owner
}

// pending tells whether the agent is about to start a server that crashed at finishedAt.
func (r *repairState) pending(finishedAt string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.crash == finishedAt && !r.done
}

func (a *agent) repairFor(id string) *repairState {
	v, _ := a.repairs.LoadOrStore(id, &repairState{causes: map[string]time.Time{}})
	return v.(*repairState)
}

// repairPending tells the panel to show the server as starting, not crashed, while a repair waits.
func (a *agent) repairPending(id string, info *ContainerInfo) bool {
	v, ok := a.repairs.Load(id)
	return ok && v.(*repairState).pending(info.State.FinishedAt)
}

func (a *agent) watchCrashes(ctx context.Context) {
	tick := time.NewTicker(repairEvery)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			a.repairCrashed(ctx, time.Now())
		}
	}
}

func (a *agent) repairCrashed(ctx context.Context, now time.Time) {
	if a.docker == nil {
		return
	}
	var list []containerSummary
	query := url.Values{"all": {"1"}, "filters": {`{"label":["mchost.server"],"status":["exited"]}`}}
	if err := a.docker.call(ctx, http.MethodGet, "/containers/json", query, nil, &list); err != nil {
		return
	}
	for _, c := range list {
		if id := c.Labels["mchost.server"]; validID.MatchString(id) {
			a.repairServer(ctx, id, now)
		}
	}
}

// crashCause sorts what stopped a start into what auto-repair does about it.
const (
	causeNone    = ""
	causeNetwork = "network"
)

func (a *agent) repairServer(ctx context.Context, id string, now time.Time) {
	if a.hasMarker(id, "stopped") || a.hasMarker(id, "suspended") || a.hasMarker(id, "disk") || a.hasMarker(id, "sleeping") {
		return
	}
	info, err := a.docker.InspectContainer(ctx, containerName(id))
	if err != nil || info.State.Status != "exited" || info.State.ExitCode == 0 {
		return
	}
	finished, err := time.Parse(time.RFC3339Nano, info.State.FinishedAt)
	if err != nil {
		return
	}
	r := a.repairFor(id)
	r.mu.Lock()
	known := r.crash == info.State.FinishedAt
	r.mu.Unlock()
	if !known {
		// A new crash: read why, before it counts as pending (stopReason).
		cause := causeNone
		if now.Sub(finished) <= networkFresh && a.stopReason(id, info) == "crashed" {
			cause = a.crashCause(ctx, id, info)
			if cause == causeNone && info.State.OOMKilled && a.roomFor(info) {
				cause = "out of memory" // killed when memory ran out (its own or the machine's): started again while there's room
			}
			if cause != causeNetwork && now.Sub(finished) > repairFresh {
				cause = causeNone
			}
		}
		r.mu.Lock()
		r.crash, r.done, r.waitTill, r.network = info.State.FinishedAt, true, time.Time{}, cause == causeNetwork
		r.tries = slices.DeleteFunc(r.tries, func(t time.Time) bool { return now.Sub(t) > repairWindow })
		switch {
		case cause == causeNone:
		case len(r.tries) >= repairMax:
			log.Printf("auto-repair %s: crashed again (%s), %d starts in the last hour, left for the owner", id, cause, len(r.tries))
		case cause == causeNetwork:
			r.done = false
			r.waitTill = finished.Add(networkWaits[min(len(r.tries), len(networkWaits)-1)])
			log.Printf("auto-repair %s: no network at start, trying again from %s", id, r.waitTill.Format(time.TimeOnly))
		case now.Sub(r.causes[cause]) < repairWindow:
			log.Printf("auto-repair %s: %s again after a start that should have fixed it, left for the owner", id, cause)
		default:
			r.done = false
			r.causes[cause] = now
			log.Printf("auto-repair %s: crashed on %s, starting again with it fixed", id, cause)
		}
	} else {
		r.mu.Lock()
	}
	if r.done || now.Before(r.waitTill) {
		r.mu.Unlock()
		return
	}
	waitNet := r.network
	r.mu.Unlock()
	if waitNet && !a.networkUp(ctx) {
		if now.Sub(finished) > networkFresh { // still no network after hours: Awaria, and the console says why
			r.mu.Lock()
			r.done = true
			r.mu.Unlock()
		}
		return
	}
	r.mu.Lock()
	r.tries = append(r.tries, now)
	r.done = true // this crash is handled; the next one has its own FinishedAt
	r.mu.Unlock()
	start := a.startServer
	if a.repairStart != nil {
		start = a.repairStart
	}
	if err := start(ctx, id); err != nil {
		if errors.Is(err, errFull) && now.Sub(finished) < repairWindow {
			// The machine has no free server's room awake now: try again in a minute, not counted.
			r.mu.Lock()
			r.tries = r.tries[:len(r.tries)-1]
			r.done, r.waitTill = false, now.Add(time.Minute)
			r.mu.Unlock()
			return
		}
		log.Printf("auto-repair %s: start: %v", id, err)
		return
	}
	log.Printf("auto-repair %s: started again", id)
}

// networkUp tells whether the machine resolves the names a start downloads from.
var networkUp = func(ctx context.Context) bool {
	lookCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for _, host := range []string{"api.modrinth.com", "piston-meta.mojang.com"} {
		if _, err := net.DefaultResolver.LookupHost(lookCtx, host); err != nil {
			return false
		}
	}
	return true
}

func (a *agent) networkUp(ctx context.Context) bool { return networkUp(ctx) }

// crashCause reads the last run's log: causeNetwork, a fixable cause (named,
// so it gets one start), or causeNone.
func (a *agent) crashCause(ctx context.Context, id string, info *ContainerInfo) string {
	logCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	opts := LogOptions{Tail: 400}
	if t, err := time.Parse(time.RFC3339Nano, info.State.StartedAt); err == nil {
		opts.Since = t.Unix()
	}
	var lines []string
	_ = a.docker.Logs(logCtx, containerName(id), opts, func(line string) error {
		lines = append(lines, line)
		return nil
	})
	return crashCauseFrom(lines, info.Config.Env)
}

var (
	// The image (mc-image-helper, curl) or Minecraft couldn't reach a server by
	// name or at all: "UnknownHostException: fill.papermc.io",
	// "Temporary failure in name resolution", "Network is unreachable".
	networkTrouble = regexp.MustCompile(`UnknownHostException|Temporary failure in name resolution|Name or service not known|Could not resolve host|Network is unreachable|No route to host|ConnectTimeoutException|connect timed out|Connection timed out`)
)

// crashCauseFrom is crashCause on the log lines and the container's env.
func crashCauseFrom(lines []string, env []string) string {
	// Only what came after the last full start counts.
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.Contains(lines[i], "Done (") {
			lines = lines[i+1:]
			break
		}
	}
	var network bool
	for _, line := range lines {
		// A world from a newer Minecraft: the owner picks the version, never the agent.
		if strings.Contains(line, "saved with newer version") || strings.Contains(line, "must be opened in an older version") {
			return causeNone
		}
		if networkTrouble.MatchString(line) {
			network = true
		}
	}
	fabric := slices.Contains(env, "TYPE=FABRIC")
	switch {
	case slices.Contains(env, "TYPE=MODRINTH") && len(packNeeds(lines)) > 0:
		return "pack needs " + strings.Join(packNeeds(lines), ",")
	case fabric && len(missingModIDs(lines)) > 0:
		return "missing mods " + strings.Join(missingModIDs(lines), ",")
	case slices.Contains(env, betaMods) && slices.ContainsFunc(lines, needsAlpha):
		return "alpha builds"
	case !findModCrash(lines).empty():
		return "broken mods"
	case network:
		return causeNetwork
	case len(unknownPlayers(lines)) > 0:
		// A whitelist name with no Minecraft account (healEnv lists it by its offline ID).
		return "whitelist " + strings.Join(unknownPlayers(lines), ",")
	}
	return causeNone
}

// roomFor tells whether the machine has the server's plan memory free now, so
// a server killed for lack of memory isn't started into the same shortage.
func (a *agent) roomFor(info *ContainerInfo) bool {
	need, _ := strconv.Atoi(info.Config.Labels["mchost.memory"])
	_, avail, ok := readMeminfo()
	return ok && avail >= int64(need)
}
