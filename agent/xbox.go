package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Xbox, PlayStation and Switch players can't type a server's address: the
// game only lets them join friends. MCXboxBroadcast signs in to an Xbox
// account of the owner's choosing and shows the server as that account's
// game in the Friends tab; when someone joins, it hands the game's NetherNet
// offer to the server's own HTTP signaling (our port, TCP), and the game then
// plays straight to the server as from any other Bedrock device. It also
// accepts friend requests by itself. One small container per server, next to
// it, which keeps running while the server sleeps: joining through it wakes a
// sleeping server as joining by address does (bedrock.go).
// See https://github.com/MCXboxBroadcast/Broadcaster.

const (
	xboxImage    = "ghcr.io/mcxboxbroadcast/standalone:latest"
	xboxMemoryMb = 384 // Java with a 192 MB heap
	xboxHeapMb   = 192
)

func xboxName(id string) string { return "mcxbox-" + id }

// xboxConfig is the broadcaster's config.yml: where to send joins, what the
// Friends tab shows when the server can't be asked (it is, every 30 s), and
// friends who haven't joined for a month are dropped (an account holds 1000).
func xboxConfig(name, address string, port int) string {
	q := func(s string) string { b, _ := json.Marshal(s); return string(b) } // a JSON string is a YAML one
	return fmt.Sprintf(`session:
  remote-address: %s
  remote-port: %s
  update-interval: 30
  query-server: true
  config-fallback: true
  session-info:
    host-name: %s
    world-name: "mchosting.pl"
    players: 0
    max-players: 20
friend-sync:
  update-interval: 60
  auto-friend: true
  initial-invite: true
  expiry:
    enabled: true
    days: 30
    check: 1800
notifications:
  enabled: false
debug-mode: false
suppress-session-update-message: true
config-version: 9
`, q(address), q(strconv.Itoa(port)), q(name))
}

func xboxSpec(id, name, address string, port int) map[string]any {
	script := fmt.Sprintf(`printf '%%s' "$XBOX_CONFIG" > /opt/app/config/config.yml && exec java -Xmx%dm -XX:+UseSerialGC -jar /opt/app/MCXboxBroadcastStandalone.jar`, xboxHeapMb)
	return map[string]any{
		"Image":      xboxImage,
		"Entrypoint": []string{"sh", "-c", script},
		"Cmd":        []string{},
		"Env":        []string{"XBOX_CONFIG=" + xboxConfig(name, address, port)},
		"OpenStdin":  true, // its console reads commands; a closed one ends it
		"Labels":     map[string]string{"mchost.xbox": id, "mchost.xbox.port": strconv.Itoa(port)},
		"HostConfig": map[string]any{
			// On the machine's own network: it reaches the server at the
			// address players do, and Xbox Live like any program here.
			"NetworkMode":   "host",
			"Memory":        int64(xboxMemoryMb) << 20,
			"MemorySwap":    int64(xboxMemoryMb) << 20,
			"NanoCpus":      int64(5e8),
			"RestartPolicy": map[string]any{"Name": "unless-stopped"},
			// The sign-in lives in its config folder (cache/), kept across rebuilds.
			"Mounts":    []map[string]any{{"Type": "volume", "Source": xboxName(id), "Target": "/opt/app/config"}},
			"LogConfig": map[string]any{"Type": "json-file", "Config": map[string]string{"max-size": "2m", "max-file": "2"}},
		},
	}
}

// xboxTarget is where the broadcaster sends joins: the machine's public
// address and the server's port, as players type it.
func xboxTarget() string {
	if ip := publicIPv4(); ip != "" {
		return ip
	}
	return "127.0.0.1"
}

// syncXbox makes the server's broadcaster match what the owner chose: running
// and pointed at the server's port, or gone with its sign-in.
func (a *agent) syncXbox(ctx context.Context, id, name string, port int, on bool) error {
	cname := xboxName(id)
	if !on {
		return a.removeXbox(ctx, id, true)
	}
	info, err := a.docker.InspectContainer(ctx, cname)
	switch {
	case err == nil && info.Config.Labels["mchost.xbox.port"] == strconv.Itoa(port):
		if info.State.Status != "running" && info.State.Status != "restarting" {
			return a.docker.StartContainer(ctx, cname)
		}
		return nil
	case err == nil:
		// The server moved to another port: same sign-in, new target.
		if err := a.docker.RemoveContainer(ctx, cname); err != nil && !errors.Is(err, errNotFound) {
			return err
		}
	case !errors.Is(err, errNotFound):
		return err
	}
	// A newer build each time one is made: Xbox Live and NetherNet still change.
	pullCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	if err := a.docker.PullImage(pullCtx, xboxImage); err != nil {
		log.Printf("pull %s: %v (using the one we have)", xboxImage, err)
	}
	cancel()
	if err := a.ensureImage(ctx, xboxImage); err != nil {
		return err
	}
	if err := a.docker.CreateContainer(ctx, cname, xboxSpec(id, name, xboxTarget(), port)); err != nil {
		return err
	}
	log.Printf("xbox: broadcasting %s (port %d)", id, port)
	return a.docker.StartContainer(ctx, cname)
}

// removeXbox takes the broadcaster away and, with signOut, the account's sign-in too.
func (a *agent) removeXbox(ctx context.Context, id string, signOut bool) error {
	if err := a.docker.RemoveContainer(ctx, xboxName(id)); err != nil && !errors.Is(err, errNotFound) {
		return err
	}
	if signOut {
		if err := a.docker.RemoveVolume(ctx, xboxName(id)); err != nil && !errors.Is(err, errNotFound) {
			return err
		}
	}
	return nil
}

// syncXboxLater brings the broadcaster in line after the server's container
// was made, without holding up the server's start (its image may need pulling).
func (a *agent) syncXboxLater(ctx context.Context, req createRequest) {
	if req.Xbox == nil {
		return // an older site: as it is
	}
	// Only a game Bedrock players join has anything to show them.
	on := *req.Xbox && (req.Edition == "BEDROCK" || (req.Edition == "JAVA" && req.Crossplay))
	go func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Minute)
		defer cancel()
		if err := a.syncXbox(ctx, req.ID, req.Name, req.Port, on); err != nil {
			log.Printf("xbox %s: %v", req.ID, err)
		}
	}()
}

type xboxStatus struct {
	// off: not set up; starting; code: waiting for the owner to sign in with
	// Code at URL; signedIn: signed in, making the game session; live: shown
	// to friends; error: it keeps stopping (Message is its last line).
	State    string `json:"state"`
	Code     string `json:"code,omitempty"`
	URL      string `json:"url,omitempty"`
	Gamertag string `json:"gamertag,omitempty"`
	Friends  int    `json:"friends"`
	Message  string `json:"message,omitempty"`
}

var (
	xboxCodeLine    = regexp.MustCompile(`open the page (\S+) and enter the code (\S+) to authenticate`)
	xboxSignedIn    = regexp.MustCompile(`Successfully authenticated as (.+?) \(\d+\) with (\d+)/\d+ friends`)
	xboxLive        = regexp.MustCompile(`Creation of Xbox LIVE session was successful|Updated session|Rotated session`)
	xboxFriendAdded = regexp.MustCompile(`Added .+ as a friend`)
	xboxFriendGone  = regexp.MustCompile(`Removed .+ as a friend|from friends due to inactivity`)
)

// parseXboxLog reads the broadcaster's state from its output since it started.
func parseXboxLog(lines []string) xboxStatus {
	st := xboxStatus{State: "starting"}
	for _, line := range lines {
		switch {
		case xboxCodeLine.MatchString(line):
			m := xboxCodeLine.FindStringSubmatch(line)
			st = xboxStatus{State: "code", URL: m[1], Code: m[2]}
		case xboxSignedIn.MatchString(line):
			m := xboxSignedIn.FindStringSubmatch(line)
			n, _ := strconv.Atoi(m[2])
			st = xboxStatus{State: "signedIn", Gamertag: m[1], Friends: n}
		case xboxLive.MatchString(line) && st.Gamertag != "":
			st.State = "live"
		case xboxFriendAdded.MatchString(line):
			st.Friends++
		case xboxFriendGone.MatchString(line) && st.Friends > 0:
			st.Friends--
		}
	}
	return st
}

func (a *agent) xboxGet(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	info, err := a.docker.InspectContainer(ctx, xboxName(id))
	if errors.Is(err, errNotFound) {
		writeJSON(w, http.StatusOK, xboxStatus{State: "off"})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var lines []string
	opts := LogOptions{Tail: 2000}
	if t, err := time.Parse(time.RFC3339Nano, info.State.StartedAt); err == nil && t.Unix() > 0 {
		opts.Since = t.Unix()
	}
	_ = a.docker.Logs(ctx, xboxName(id), opts, func(line string) error {
		lines = append(lines, line)
		return nil
	})
	st := parseXboxLog(lines)
	if info.State.Status != "running" && (info.RestartCount > 2 || info.State.Status == "exited" || info.State.Status == "dead") {
		st = xboxStatus{State: "error"}
		if len(lines) > 0 {
			st.Message = strings.TrimSpace(lines[len(lines)-1])
		}
	}
	writeJSON(w, http.StatusOK, st)
}

// xboxPut turns the broadcaster on for a server already made here.
func (a *agent) xboxPut(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	info, err := a.docker.InspectContainer(r.Context(), containerName(id))
	if errors.Is(err, errNotFound) {
		writeError(w, http.StatusNotFound, "server not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	port := info.udpPort()
	if port == 0 {
		writeError(w, http.StatusBadRequest, "only Bedrock and crossplay servers take Bedrock players")
		return
	}
	name := info.Config.Labels["mchost.name"]
	if name == "" {
		name = "mchosting.pl"
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 10*time.Minute)
	defer cancel()
	if err := a.syncXbox(ctx, id, name, port, true); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// xboxDelete turns it off and forgets the account.
func (a *agent) xboxDelete(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	if err := a.removeXbox(r.Context(), id, true); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	log.Printf("xbox: stopped broadcasting %s", id)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
