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
	"unicode"
)

// Images for the newest version of each edition; see imageFor for older Java versions.
var images = map[string]string{
	"JAVA":    "itzg/minecraft-server:java25",
	"BEDROCK": "itzg/minecraft-bedrock-server:latest",
}

var javaRelease = regexp.MustCompile(`^1\.(\d+)(?:\.(\d+))?$`)

// imageFor picks the image with the Java that Paper needs for the version:
// 1.17–1.19 need Java 17, 1.20–1.21.11 Java 21, and 26.1 onwards (and LATEST) Java 25.
// Mod packs for 1.20–1.20.4 get Java 17 too: Forge for those versions expects it.
// Skyblock and OneBlock follow their plugins' newest version, so they get the newest Java.
func imageFor(edition, version, kind string) string {
	if edition != "JAVA" {
		return images[edition]
	}
	if kind == "skyblock" || kind == "oneblock" {
		return images["JAVA"]
	}
	if m := javaRelease.FindStringSubmatch(version); m != nil {
		minor, _ := strconv.Atoi(m[1])
		patch, _ := strconv.Atoi(m[2])
		if minor < 20 || (kind == "modpack" && minor == 20 && patch < 5) {
			return "itzg/minecraft-server:java17"
		}
		return "itzg/minecraft-server:java21"
	}
	return images["JAVA"]
}

// What a Java server runs: plain Paper, a BentoBox game mode, or a Modrinth mod pack.
var (
	kinds = map[string]bool{"vanilla": true, "skyblock": true, "oneblock": true, "modpack": true}
	// The plugins (from Modrinth) each game mode needs on Paper.
	gameModePlugins = map[string]string{"skyblock": "bentobox,bskyblock", "oneblock": "bentobox,aoneblock"}
	validModpack    = regexp.MustCompile(`^[A-Za-z0-9_-]{2,64}$`) // Modrinth slug or project ID
	validModrinthID = regexp.MustCompile(`^[A-Za-z0-9]{8}$`)      // Modrinth version ID
)

// pluginEnv has the image install a Paper server's plugins from Modrinth: the
// game mode's own, then the owner's. The owner's are optional, so one without a
// build for the server's version is skipped (with a warning in the console)
// instead of keeping the server down, and doesn't hold back the version a game
// mode picks. The list is always set, even empty, because the image removes
// the plugins it installed that are no longer listed.
func pluginEnv(kind string, plugins []string) []string {
	var projects []string
	if base := gameModePlugins[kind]; base != "" {
		projects = strings.Split(base, ",")
	}
	for _, p := range plugins {
		projects = append(projects, p+"?")
	}
	return []string{"MODRINTH_PROJECTS=" + strings.Join(projects, ","), "MODRINTH_DOWNLOAD_DEPENDENCIES=required"}
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
	serverLocks sync.Map // server id -> *sync.Mutex, held during backups, restores and file changes
	volumesDir  string   // Docker's volume directory, mounted at the same path; "" turns the file manager off
	diskReserve int64    // bytes of disk the file manager leaves free
	uploadMax   int64    // the biggest file the file manager takes
	unzipMax    int64    // the most an archive may unpack to
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
	reserveMb, err := strconv.ParseInt(envOr("MIN_FREE_DISK_MB", "4096"), 10, 64)
	if err != nil || reserveMb < 0 {
		log.Fatal("MIN_FREE_DISK_MB must be a number of megabytes")
	}
	uploadMb, err := strconv.ParseInt(envOr("UPLOAD_MAX_MB", "1024"), 10, 64)
	if err != nil || uploadMb < 1 {
		log.Fatal("UPLOAD_MAX_MB must be a positive number of megabytes")
	}
	a := &agent{
		docker:      NewDocker(envOr("DOCKER_SOCKET", "/var/run/docker.sock")),
		token:       token,
		stateDir:    envOr("STATE_DIR", "./state"),
		idle:        time.Duration(idleMin) * time.Minute,
		memoryLimit: memoryLimit,
		backupDir:   backupDir,
		backupMount: envOr("BACKUP_MOUNT", backupDir),
		volumesDir:  filepath.Clean(envOr("VOLUMES_DIR", "/var/lib/docker/volumes")),
		diskReserve: reserveMb << 20,
		uploadMax:   uploadMb << 20,
		unzipMax:    4 * uploadMb << 20,
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
	mux.HandleFunc("GET /servers/{id}/files", a.filesList)
	mux.HandleFunc("DELETE /servers/{id}/files", a.filesDelete)
	mux.HandleFunc("GET /servers/{id}/files/content", a.filesRead)
	mux.HandleFunc("PUT /servers/{id}/files/content", a.filesWrite)
	mux.HandleFunc("POST /servers/{id}/files/mkdir", a.filesMkdir)
	mux.HandleFunc("POST /servers/{id}/files/rename", a.filesRename)
	mux.HandleFunc("POST /servers/{id}/files/unzip", a.filesUnzip)
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

	// Game settings the owner picks in the panel.
	GameMode   string   `json:"gameMode"`         // survival, creative or adventure
	Difficulty string   `json:"difficulty"`       // peaceful, easy, normal or hard
	Motd       string   `json:"motd"`             // shown in the server list; the name if empty
	PVP        *bool    `json:"pvp"`              // Java only; on if missing
	Whitelist  bool     `json:"whitelist"`        // only listed players may join
	Players    []string `json:"whitelistPlayers"` // Java profile names or Bedrock gamertags

	// Java only: what the server runs (see kinds). For a mod pack, the Modrinth
	// project and the exact pack version, so players can install the same one.
	Kind           string `json:"kind"`
	Modpack        string `json:"modpack"`
	ModpackVersion string `json:"modpackVersion"`
	// Java on Paper only (not mod packs): Modrinth plugins (slugs or project IDs) the owner added.
	Plugins []string `json:"plugins"`
}

var (
	validVersion = regexp.MustCompile(`^(LATEST|\d+\.\d+(\.\d+)?)$`)
	validPlayer  = regexp.MustCompile(`^[\p{L}\p{N} _-]{1,32}$`)
	gameModes    = map[string]bool{"survival": true, "creative": true, "adventure": true}
	difficulties = map[string]bool{"peaceful": true, "easy": true, "normal": true, "hard": true}
)

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
	if req.GameMode == "" {
		req.GameMode = "survival"
	}
	if req.Difficulty == "" {
		req.Difficulty = "easy"
	}
	if req.Kind == "" {
		req.Kind = "vanilla"
	}
	switch {
	case !kinds[req.Kind] || (req.Kind != "vanilla" && req.Edition != "JAVA"):
		return errors.New("kind must be vanilla, skyblock, oneblock or modpack (Java only)")
	case req.Kind == "modpack" && (!validModpack.MatchString(req.Modpack) || !validModrinthID.MatchString(req.ModpackVersion)):
		return errors.New("a modpack server needs a Modrinth modpack and modpackVersion")
	case len(req.Plugins) > 0 && (req.Edition != "JAVA" || req.Kind == "modpack"):
		return errors.New("plugins need a Java server on Paper (not a mod pack)")
	case len(req.Plugins) > 100:
		return errors.New("at most 100 plugins")
	}
	for _, p := range req.Plugins {
		if !validModpack.MatchString(p) {
			return fmt.Errorf("invalid plugin %q", p)
		}
	}
	switch {
	case !validVersion.MatchString(req.Version):
		return errors.New("invalid version")
	case !gameModes[req.GameMode] || !difficulties[req.Difficulty]:
		return errors.New("invalid gameMode or difficulty")
	case len([]rune(req.Motd)) > 100 || strings.ContainsFunc(req.Motd, unicode.IsControl):
		return errors.New("motd must be one line of up to 100 characters")
	case len(req.Players) > 200:
		return errors.New("at most 200 whitelisted players")
	}
	for _, p := range req.Players {
		if !validPlayer.MatchString(p) {
			return fmt.Errorf("invalid player name %q", p)
		}
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
	if a.handleDockerErr(w, a.run(r.Context(), req, true)) {
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
	// ?start=if-running keeps a stopped or sleeping server off (new settings);
	// otherwise the server starts (a plan was just paid for).
	start := true
	if r.URL.Query().Get("start") == "if-running" {
		info, err := a.docker.InspectContainer(r.Context(), name)
		if err != nil && !errors.Is(err, errNotFound) {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		start = err == nil && (info.State.Status == "running" || info.State.Status == "restarting")
	}
	if err := a.docker.StopContainer(r.Context(), name, 60); err != nil && !errors.Is(err, errNotFound) {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := a.docker.RemoveContainer(r.Context(), name); err != nil && !errors.Is(err, errNotFound) {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if a.handleDockerErr(w, a.run(r.Context(), req, start)) {
		return
	}
	a.pruneBackups(req.ID, req.Backups) // a smaller plan keeps fewer
	log.Printf("recreated %s (%d MB, autostop %v, %d backups)", name, req.MemoryMb, req.Autostop, req.Backups)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// run creates the server's container and, if start is set, starts it.
func (a *agent) run(ctx context.Context, req createRequest, start bool) error {
	image := imageFor(req.Edition, req.Version, req.Kind)
	if err := a.ensureImage(ctx, image); err != nil {
		return err
	}
	name := containerName(req.ID)
	if err := a.docker.CreateContainer(ctx, name, a.containerSpec(req, image)); err != nil {
		return err
	}
	if !start {
		return nil
	}
	return a.startServer(ctx, req.ID)
}

func (a *agent) containerSpec(req createRequest, image string) map[string]any {
	maxPlayers := fmt.Sprint(req.MaxPlayers)
	if req.MaxPlayers <= 0 {
		maxPlayers = "1000"
	}
	motd := req.Motd
	if motd == "" {
		motd = req.Name
	}
	env := []string{"EULA=TRUE", "MAX_PLAYERS=" + maxPlayers, "DIFFICULTY=" + req.Difficulty}
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
		pvp := req.PVP == nil || *req.PVP
		switch req.Kind {
		case "skyblock", "oneblock":
			// The image picks the newest Minecraft version all the game mode's plugins support.
			env = append(env, "TYPE=PAPER", "VERSION_FROM_MODRINTH_PROJECTS=TRUE")
		case "modpack":
			// The image installs the pack's mod loader and server-side mods.
			env = append(env, "TYPE=MODRINTH", "MODRINTH_MODPACK="+req.Modpack, "MODRINTH_VERSION="+req.ModpackVersion, "VERSION="+req.Version)
		default:
			env = append(env, "TYPE=PAPER", "VERSION="+req.Version)
		}
		if req.Kind != "modpack" {
			env = append(env, pluginEnv(req.Kind, req.Plugins)...)
		}
		env = append(env, fmt.Sprintf("MEMORY=%dM", req.MemoryMb), "ENABLE_RCON=true",
			"MOTD="+motd, "MODE="+req.GameMode, fmt.Sprintf("PVP=%v", pvp), fmt.Sprintf("ENABLE_WHITELIST=%v", req.Whitelist))
		if req.Whitelist {
			// The panel's list replaces whatever the server had, so removing a player works.
			env = append(env, "WHITELIST="+strings.Join(req.Players, ","), "EXISTING_WHITELIST_FILE=SYNCHRONIZE", "ENFORCE_WHITELIST=TRUE")
		}
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
		env = append(env, "VERSION="+req.Version, "SERVER_NAME="+motd, "GAMEMODE="+req.GameMode)
		if req.Whitelist {
			env = append(env, "ALLOW_LIST=true", "ALLOW_LIST_USERS="+strings.Join(req.Players, ","))
		} else {
			// Recent Bedrock servers turn the allow list on by default, which keeps everyone out.
			env = append(env, "ALLOW_LIST=false")
		}
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
			// Keep only the newest console output: it holds players' IP addresses and would otherwise fill the disk.
			"LogConfig": map[string]any{"Type": "json-file", "Config": map[string]string{"max-size": "10m", "max-file": "3"}},
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
