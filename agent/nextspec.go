package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
)

// A change that needs a new container (e.g. a plugin taken off) while the
// server is running waits for its next start: the site leaves the spec here
// and whatever starts the server next, its owner or a player waking it up,
// builds the new container first. Without this a sleeping free server woke
// up in its old container and fetched the removed plugin again.

func (a *agent) nextSpecPath(id string) string { return a.markerPath(id, "next.json") }

// putNext keeps the spec for the server's next start. The server keeps running as it is.
func (a *agent) putNext(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	req.ID = r.PathValue("id")
	if err := req.validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	body, _ := json.Marshal(req)
	if err := os.WriteFile(a.nextSpecPath(req.ID), body, 0o600); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// dropNext forgets a waiting spec: a newer one was just applied, or the server left.
func (a *agent) dropNext(id string) { _ = os.Remove(a.nextSpecPath(id)) }

// startWithNext starts the server, first building its container from the
// spec waiting for its next start, when there is one.
func (a *agent) startWithNext(ctx context.Context, id string) error {
	body, err := os.ReadFile(a.nextSpecPath(id))
	if err != nil {
		return a.startServer(ctx, id)
	}
	var req createRequest
	if json.Unmarshal(body, &req) != nil || req.ID != id || req.validate() != nil {
		a.dropNext(id)
		return a.startServer(ctx, id)
	}
	unlock := a.lockServer(id) // not mid-backup or mid-restore
	defer unlock()
	if _, err := os.Stat(a.nextSpecPath(id)); err != nil {
		return a.startServer(ctx, id) // applied meanwhile
	}
	if err := a.rebuild(ctx, req, true); err != nil {
		// Full: the new container is made and starts once there is room.
		if !errors.Is(err, errFull) && !errors.Is(err, errDiskFull) {
			log.Printf("next start of %s: %v", containerName(id), err)
		}
		return err
	}
	log.Printf("started %s with its waiting changes", containerName(id))
	return nil
}
