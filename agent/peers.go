package main

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
)

// With more than one game machine, Java players still connect to the main
// machine's router (the wildcard DNS name points there). Servers on the other
// machines are listed here by the site, as their Java address -> that
// machine's router; the main router passes those players on unchanged.

// PUT /peer-routes {"routes": {"<java address>": "<host:port>", ...}}: replaces the list.
func (a *agent) putPeerRoutes(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Routes map[string]string `json:"routes"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	routes := map[string]string{}
	for host, addr := range body.Routes {
		host = normalizeHost(host)
		if _, _, err := net.SplitHostPort(addr); !validHost.MatchString(host) || err != nil {
			writeError(w, http.StatusBadRequest, "invalid route "+host)
			return
		}
		routes[host] = addr
	}
	b, _ := json.Marshal(routes)
	if err := os.WriteFile(filepath.Join(a.stateDir, "peer-routes.json"), b, 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.peerMu.Lock()
	a.peerRoutes = routes
	a.peerMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// loadPeerRoutes reads the last list, so players get through before the site sends it again.
func (a *agent) loadPeerRoutes() {
	routes := map[string]string{}
	b, err := os.ReadFile(filepath.Join(a.stateDir, "peer-routes.json"))
	if err == nil {
		err = json.Unmarshal(b, &routes)
	}
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		log.Printf("peer routes: %v", err)
	}
	a.peerMu.Lock()
	a.peerRoutes = routes
	a.peerMu.Unlock()
}

// lookupRoute finds the server for a Java address (or a server's own domain) here, or else the machine it's on.
func (a *agent) lookupRoute(ctx context.Context, host string) (*routeTarget, error) {
	host = a.canonicalHost(host)
	t, err := a.lookupByHost(ctx, host)
	if t != nil || err != nil {
		return t, err
	}
	a.peerMu.RLock()
	addr, ok := a.peerRoutes[host]
	a.peerMu.RUnlock()
	if !ok {
		return nil, nil
	}
	return &routeTarget{Peer: addr}, nil
}
