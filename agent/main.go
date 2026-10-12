// Command agent runs on each game host. It creates and controls one Docker
// container per Minecraft server on behalf of the web panel, and routes Java
// players to the right server by the address they typed.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var images = map[string]string{
	"JAVA":    "itzg/minecraft-server:java21",
	"BEDROCK": "itzg/minecraft-bedrock-server:latest",
}

// Server IDs come from the panel (cuid); restrict them so they're safe in container names.
var validID = regexp.MustCompile(`^[a-z0-9]{8,40}$`)

type agent struct {
	docker      *Docker
	token       string
	stateDir    string        // marker files recording why a server was stopped
	idle        time.Duration // free servers sleep after this long with no players
	memoryLimit int           // MB of plan memory servers may hold in total; 0 means no limit
	startMu     sync.Mutex
	backupDir   string   // where the agent keeps backups
	backupMount string   // the same place as helper containers mount it: a volume name or host path
	serverLocks sync.Map // server id -> *sync.Mutex, held during backups and restores
}

func main() {
	token := os.Getenv("AGENT_TOKEN")
	if token == "" {
		log.Fatal("AGENT_TOKEN is required")
	}
	idleMin, err := strconv.Atoi(envOr("IDLE_MINUTES", "5"))
	if err != nil || idleMin < 1 {
		log.Fatal("IDLE_MINUTES must be a positive number")
	}
	memoryLimit, err := strconv.Atoi(envOr("MEMORY_LIMIT_MB", "0"))
	if err != nil || memoryLimit < 0 {
		log.Fatal("MEMORY_LIMIT_MB must be a number of megabytes (0 for no limit)")
	}
	backupDir, err := filepath.Abs(envOr("BACKUP_DIR", "./backups"))
	if err != nil {
		log.Fatal(err)
	}
	a := &agent{
		docker:      NewDocker(envOr("DOCKER_SOCKET", "/var/run/docker.sock")),
		token:       token,
		stateDir:    envOr("STATE_DIR", "./state"),
		idle:        time.Duration(idleMin) * time.Minute,
		memoryLimit: memoryLimit,
		backupDir:   backupDir,
		backupMount: envOr("BACKUP_MOUNT", backupDir),
	}
	for _, dir := range []string{a.stateDir, a.backupDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			log.Fatal(err)
		}
	}

	// Pull images up front so the first server creation isn't slow.
	go func() {
		for _, img := range append([]string{backupImage}, images["JAVA"], images["BEDROCK"]) {
			if err := a.ensureImage(context.Background(), img); err != nil {
				log.Printf("prefetch %s: %v", img, err)
			}
		}
	}()
	go a.watchIdleBedrock(context.Background())
	go a.watchBackups(context.Background())

	gameAddr := envOr("GAME_ADDR", ":25565")
	ln, err := net.Listen("tcp", gameAddr)
	if err != nil {
		log.Fatalf("game listener: %v", err)
	}
	rt := &router{lookup: a.lookupByHost, wake: a.wake, dial: dialTCP}
	go func() { log.Fatal(rt.serve(ln)) }()
	log.Printf("routing Java players on %s", gameAddr)

	addr := envOr("AGENT_ADDR", ":8081")
	log.Printf("agent API listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, a.routes()))
}

func (a *agent) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]bool{"ok": true}) })
	mux.HandleFunc("POST /servers", a.create)
	mux.HandleFunc("PUT /servers/{id}", a.recreate)
	mux.HandleFunc("GET /servers/{id}", a.status)
	mux.HandleFunc("POST /servers/{id}/start", a.start)
	mux.HandleFunc("POST /servers/{id}/stop", a.stop)
	mux.HandleFunc("DELETE /servers/{id}", a.remove)
	mux.HandleFunc("GET /servers/{id}/logs", a.logs)
	mux.HandleFunc("POST /servers/{id}/command", a.command)
	mux.HandleFunc("GET /servers/{id}/backups", a.backupsList)
	mux.HandleFunc("POST /servers/{id}/backups", a.backupsCreate)
	mux.HandleFunc("GET /servers/{id}/backups/{file}", a.backupDownload)
	mux.HandleFunc("POST /servers/{id}/backups/{file}/restore", a.backupRestore)
	return a.auth(mux)
}

func (a *agent) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if r.URL.Path != "/health" && subtle.ConstantTimeCompare([]byte(got), []byte(a.token)) != 1 {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type createRequest struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Edition    string  `json:"edition"`
	MemoryMb   int     `json:"memoryMb"`
	CPUs       float64 `json:"cpus"`
	Port       int     `json:"port"`
	MaxPlayers int     `json:"maxPlayers"`
	Version    string  `json:"version"`
	Hostname   string  `json:"hostname"`    // Java only: the address players type, e.g. ekipa.mchost.pl
	Autostop   bool    `json:"autostop"`    // sleep when nobody is playing (free plan)
	Backups    int     `json:"backupsKept"` // daily backups to keep; 0 for none
}

func (req *createRequest) validate() error {
	if _, ok := images[req.Edition]; !ok {
		return errors.New("edition must be JAVA or BEDROCK")
	}
	switch {
	case !validID.MatchString(req.ID):
		return errors.New("invalid id")
	case req.MemoryMb < 512 || req.Port < 1024 || req.Port > 65535 || req.CPUs <= 0:
		return errors.New("invalid memoryMb, cpus or port")
	case req.Edition == "JAVA" && !validHost.MatchString(req.Hostname):
		return errors.New("java servers need a valid hostname")
	}
	if req.Version == "" {
		req.Version = "LATEST"
	}
	return nil
}

func (a *agent) create(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if err := req.validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if a.handleDockerErr(w, a.run(r.Context(), req)) {
		return
	}
	log.Printf("created %s (%s, %d MB, port %d, autostop %v)", containerName(req.ID), req.Edition, req.MemoryMb, req.Port, req.Autostop)
	writeJSON(w, http.StatusCreated, map[string]string{"container": containerName(req.ID)})
}

// recreate replaces the container with a new spec (e.g. after a plan change),
// keeping the world volume, and starts it.
func (a *agent) recreate(w http.ResponseWriter, r *http.Request) {
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
	defer a.lockServer(req.ID)() // not mid-backup or mid-restore
	name := containerName(req.ID)
	if err := a.docker.StopContainer(r.Context(), name, 60); err != nil && !errors.Is(err, errNotFound) {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := a.docker.RemoveContainer(r.Context(), name); err != nil && !errors.Is(err, errNotFound) {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if a.handleDockerErr(w, a.run(r.Context(), req)) {
		return
	}
	a.pruneBackups(req.ID, req.Backups) // a smaller plan keeps fewer
	log.Printf("recreated %s (%d MB, autostop %v, %d backups)", name, req.MemoryMb, req.Autostop, req.Backups)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *agent) run(ctx context.Context, req createRequest) error {
	image := images[req.Edition]
	if err := a.ensureImage(ctx, image); err != nil {
		return err
	}
	name := containerName(req.ID)
	if err := a.docker.CreateContainer(ctx, name, a.containerSpec(req, image)); err != nil {
		return err
	}
	return a.startServer(ctx, req.ID)
}

func (a *agent) containerSpec(req createRequest, image string) map[string]any {
	maxPlayers := fmt.Sprint(req.MaxPlayers)
	if req.MaxPlayers <= 0 {
		maxPlayers = "1000"
	}
	env := []string{"EULA=TRUE", "VERSION=" + req.Version, "MAX_PLAYERS=" + maxPlayers}
	labels := map[string]string{
		"mchost.server":   req.ID,
		"mchost.edition":  req.Edition,
		"mchost.port":     fmt.Sprint(req.Port),
		"mchost.autostop": fmt.Sprint(req.Autostop),
		"mchost.memory":   fmt.Sprint(req.MemoryMb),
		"mchost.backups":  fmt.Sprint(req.Backups),
	}
	var containerPort, hostIP string
	tty := false
	// Leave headroom above the JVM heap for the JVM itself, or the kernel OOM-kills it.
	limitMb := req.MemoryMb
	if req.Edition == "JAVA" {
		env = append(env, "TYPE=PAPER", fmt.Sprintf("MEMORY=%dM", req.MemoryMb), "MOTD="+req.Name, "ENABLE_RCON=true")
		if req.Autostop {
			// The image stops the server by itself once nobody has played for this long.
			secs := fmt.Sprint(int(a.idle.Seconds()))
			env = append(env, "ENABLE_AUTOSTOP=TRUE", "AUTOSTOP_TIMEOUT_EST="+secs, "AUTOSTOP_TIMEOUT_INIT="+secs)
		}
		labels["mchost.host"] = req.Hostname
		containerPort = "25565/tcp"
		hostIP = "127.0.0.1" // players come in through the router, not directly
		limitMb = req.MemoryMb + 512
	} else {
		env = append(env, "SERVER_NAME="+req.Name)
		containerPort = "19132/udp"
		tty = true // send-command writes to the server's stdin
	}
	return map[string]any{
		"Image":        image,
		"Env":          env,
		"Tty":          tty,
		"OpenStdin":    tty,
		"ExposedPorts": map[string]any{containerPort: map[string]any{}},
		"Labels":       labels,
		"HostConfig": map[string]any{
			"Memory":     int64(limitMb) * 1024 * 1024,
			"MemorySwap": int64(limitMb) * 1024 * 1024, // no swap
			"NanoCpus":   int64(req.CPUs * 1e9),
			"PidsLimit":  512,
			// Restarts after a crash only; a clean exit (e.g. going to sleep) stays down.
			"RestartPolicy": map[string]any{"Name": "on-failure", "MaximumRetryCount": 3},
			"PortBindings": map[string]any{
				containerPort: []map[string]string{{"HostIp": hostIP, "HostPort": fmt.Sprint(req.Port)}},
			},
			"Mounts": []map[string]any{{"Type": "volume", "Source": containerName(req.ID), "Target": "/data"}},
		},
	}
}

func (a *agent) status(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	info, err := a.docker.InspectContainer(r.Context(), containerName(id))
	if a.handleDockerErr(w, err) {
		return
	}
	resp := map[string]any{
		"state":        info.State.Status, // created, running, restarting, exited, ...
		"startedAt":    info.State.StartedAt,
		"exitCode":     info.State.ExitCode,
		"restartCount": info.RestartCount,
	}
	if info.State.Status != "running" && info.State.Status != "restarting" {
		resp["stopReason"] = a.stopReason(id, info)
	}
	if info.State.Health != nil {
		resp["health"] = info.State.Health.Status // starting, healthy, unhealthy
	}
	writeJSON(w, http.StatusOK, resp)
}

// stopReason explains a stopped container: the owner stopped it, it fell
// asleep for lack of players, or it crashed.
func (a *agent) stopReason(id string, info *ContainerInfo) string {
	switch {
	case a.hasMarker(id, "stopped"):
		return "stopped"
	case a.hasMarker(id, "sleeping"):
		return "sleeping"
	case info.Config.Labels["mchost.autostop"] == "true" && info.State.ExitCode == 0:
		return "sleeping" // Java's built-in autostop exits cleanly
	case info.State.ExitCode != 0:
		return "crashed"
	default:
		return "stopped"
	}
}

func (a *agent) start(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	if a.handleDockerErr(w, a.startServer(r.Context(), id)) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *agent) wake(ctx context.Context, id string) error {
	return a.startServer(ctx, id)
}

func (a *agent) stop(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	// Mark first so the router won't wake a server its owner turned off.
	a.setMarker(id, "stopped")
	if r.URL.Query().Get("reason") == "suspended" {
		a.setMarker(id, "suspended") // unpaid: gives its memory back until renewed
	}
	if a.handleDockerErr(w, a.docker.StopContainer(r.Context(), containerName(id), 60)) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *agent) remove(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	defer a.lockServer(id)() // a backup in progress holds the volume
	ctx, name := r.Context(), containerName(id)
	if err := a.docker.RemoveContainer(ctx, name); err != nil && !errors.Is(err, errNotFound) {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// The world lives in the volume; deleting the server deletes it and its backups too.
	if err := a.docker.RemoveVolume(ctx, name); err != nil && !errors.Is(err, errNotFound) {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := os.RemoveAll(a.backupPath(id)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.clearMarkers(id)
	log.Printf("removed %s", name)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// logs streams the console as Server-Sent Events: recent lines first, then live output.
func (a *agent) logs(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	started := false
	opts := LogOptions{Tail: 200, Follow: r.URL.Query().Get("follow") != "0"}
	err := a.docker.Logs(r.Context(), containerName(id), opts, func(line string) error {
		started = true
		data, _ := json.Marshal(line)
		if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	})
	if err != nil && !started {
		a.handleDockerErr(w, err)
	}
}

func (a *agent) command(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	var req struct {
		Command string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Command) == "" || len(req.Command) > 500 {
		writeError(w, http.StatusBadRequest, "command is required (max 500 chars)")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	name := containerName(id)
	info, err := a.docker.InspectContainer(ctx, name)
	if a.handleDockerErr(w, err) {
		return
	}
	if info.State.Status != "running" {
		writeError(w, http.StatusConflict, "server is not running")
		return
	}
	// Java servers take commands over RCON; Bedrock has no RCON, so the image
	// writes them to the server's stdin instead (output shows up in the logs).
	cmd := []string{"rcon-cli", req.Command}
	if info.Config.Labels["mchost.edition"] == "BEDROCK" {
		cmd = []string{"send-command", req.Command}
	}
	out, err := a.docker.Exec(ctx, name, cmd)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"output": strings.TrimSpace(out)})
}

func (a *agent) ensureImage(ctx context.Context, image string) error {
	exists, err := a.docker.ImageExists(ctx, image)
	if err != nil || exists {
		return err
	}
	log.Printf("pulling %s", image)
	return a.docker.PullImage(ctx, image)
}

func (a *agent) markerPath(id, kind string) string {
	return filepath.Join(a.stateDir, id+"."+kind)
}

func (a *agent) setMarker(id, kind string) {
	if err := os.WriteFile(a.markerPath(id, kind), nil, 0o644); err != nil {
		log.Printf("marker %s %s: %v", id, kind, err)
	}
}

func (a *agent) hasMarker(id, kind string) bool {
	_, err := os.Stat(a.markerPath(id, kind))
	return err == nil
}

func (a *agent) clearMarkers(id string) {
	for _, kind := range []string{"stopped", "sleeping", "suspended"} {
		_ = os.Remove(a.markerPath(id, kind))
	}
}

func (a *agent) idFrom(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if !validID.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid id")
		return "", false
	}
	return id, true
}

// handleDockerErr writes an error response and reports whether there was one.
func (a *agent) handleDockerErr(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, errNotFound):
		writeError(w, http.StatusNotFound, "server not found")
	case errors.Is(err, errFull):
		writeError(w, http.StatusServiceUnavailable, "full")
	case errors.Is(err, errNoBackups):
		writeError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, errBackupNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
	return true
}

func containerName(id string) string { return "mc-" + id }

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
