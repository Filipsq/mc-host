package main

import (
	"context"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

// The image looks up every whitelist name at Mojang when a premium server
// starts, and stops the start on a name with no Minecraft account ("Could not
// resolve user from Playerdb", ww123 2026-11-01). Fiq wants the whitelist to
// take any name (2026-11-08), so the agent asks Mojang itself and lists a name
// with no account by its offline ID ("<name>:offline"). The server starts; that
// player still can't join a premium server, they need Non-premium.

var mojangAPI = "https://api.mojang.com"

// whitelistEntries is what goes in the image's WHITELIST.
func whitelistEntries(req *createRequest) []string {
	players := make([]string, len(req.Players))
	copy(players, req.Players)
	if req.offline() {
		// Non-premium players have no Mojang account to look up; the image
		// gives them the IDs an offline server uses instead.
		for i, p := range players {
			players[i] = p + ":offline"
		}
		return players
	}
	if mojangAPI == "" || len(players) == 0 {
		return players
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	for i, p := range players {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if noMojangAccount(ctx, p) {
				players[i] = p + ":offline"
			}
		}()
	}
	wg.Wait()
	return players
}

// noMojangAccount is true only when Mojang says there's no such player; false when it can't be asked.
func noMojangAccount(ctx context.Context, name string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, mojangAPI+"/users/profiles/minecraft/"+url.PathEscape(name), nil)
	if err != nil {
		return false
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	res.Body.Close()
	return res.StatusCode == http.StatusNotFound || res.StatusCode == http.StatusNoContent
}

// playerdbMiss is the image refusing to start on a whitelist name it couldn't
// look up: Mojang wasn't reachable when the container was built, so the name
// went in as is (smp on n5, 2026-11-20: "11Habcio_lk", a start that failed for days).
var playerdbMiss = regexp.MustCompile(`Could not resolve user from Playerdb: (\S+)`)

// unknownPlayers lists the whitelist names the last start couldn't look up.
func unknownPlayers(lines []string) []string {
	var names []string
	for _, line := range lines {
		if m := playerdbMiss.FindStringSubmatch(line); m != nil {
			names = appendNew(names, m[1])
		}
	}
	return names
}

func (a *agent) lastStartUnknownPlayers(ctx context.Context, id string) []string {
	var names []string
	a.lastStartHad(ctx, id, func(line string) bool {
		names = append(names, unknownPlayers([]string{line})...)
		return false
	})
	var out []string
	for _, n := range names {
		// Only a name Mojang says has no account: a premium player keeps their own ID.
		lookCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		none := noMojangAccount(lookCtx, n)
		cancel()
		if none {
			out = appendNew(out, n)
		}
	}
	return out
}

// offlineWhitelist lists names in WHITELIST by their offline ID, so the image doesn't look them up.
func offlineWhitelist(env []string, names []string) []string {
	out := slices.Clone(env)
	for i, e := range out {
		list, ok := strings.CutPrefix(e, "WHITELIST=")
		if !ok {
			continue
		}
		players := strings.Split(list, ",")
		for j, p := range players {
			if slices.Contains(names, p) {
				players[j] = p + ":offline"
			}
		}
		out[i] = "WHITELIST=" + strings.Join(players, ",")
	}
	return out
}
