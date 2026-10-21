package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

// A server's own domain (the "własna domena" add-on): the owner points, say,
// graj.mojserwer.pl at their server's Java address with a CNAME, players type
// their domain, and the handshake carries it. The site lists those domains here
// as domain -> the server's Java address; the router looks the address up as
// if the player had typed it. Every machine gets the list, since a server on
// another machine is reached with the handshake passed on unchanged.

// PUT /host-aliases {"aliases": {"<own domain>": "<java address>", ...}}: replaces the list.
func (a *agent) putHostAliases(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Aliases map[string]string `json:"aliases"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	aliases := map[string]string{}
	for alias, host := range body.Aliases {
		alias, host = normalizeHost(alias), normalizeHost(host)
		if !validHost.MatchString(alias) || !validHost.MatchString(host) {
			writeError(w, http.StatusBadRequest, "invalid alias "+alias)
			return
		}
		aliases[alias] = host
	}
	b, _ := json.Marshal(aliases)
	if err := os.WriteFile(filepath.Join(a.stateDir, "host-aliases.json"), b, 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.aliasMu.Lock()
	a.hostAliases = aliases
	a.aliasMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// loadHostAliases reads the last list, so own domains work before the site sends it again.
func (a *agent) loadHostAliases() {
	aliases := map[string]string{}
	b, err := os.ReadFile(filepath.Join(a.stateDir, "host-aliases.json"))
	if err == nil {
		err = json.Unmarshal(b, &aliases)
	}
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		log.Printf("host aliases: %v", err)
	}
	a.aliasMu.Lock()
	a.hostAliases = aliases
	a.aliasMu.Unlock()
}

// canonicalHost turns an own domain into the server's Java address; any other host stays as it is.
func (a *agent) canonicalHost(host string) string {
	a.aliasMu.RLock()
	defer a.aliasMu.RUnlock()
	if h, ok := a.hostAliases[host]; ok {
		return h
	}
	return host
}
