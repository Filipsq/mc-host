package main

import (
	"context"
	"net/http"
	"net/url"
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
