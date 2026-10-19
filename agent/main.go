// Command agent runs on each game host. It creates and controls one Docker
// container per game server (Minecraft Java or Bedrock, or Terraria) on behalf
// of the web panel, and routes Java players to the right server by the
// address they typed.
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
	"runtime"
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
// Mod packs, Forge and NeoForge for 1.20–1.20.4 get Java 17 too: Forge for those versions expects it.
// Mod packs for 1.16 and older (like RLCraft on 1.12.2) need Java 8.
// Skyblock and OneBlock follow their plugins' newest version, so they get the newest Java.
func imageFor(edition, version, kind string) string {
	switch edition {
	case "TERRARIA":
		return terrariaImages[kind]
	case "BEDROCK":
		return images[edition]
	}
	if kind == "skyblock" || kind == "oneblock" {
		return images["JAVA"]
	}
	if m := javaRelease.FindStringSubmatch(version); m != nil {
		minor, _ := strconv.Atoi(m[1])
		patch, _ := strconv.Atoi(m[2])
		forgeLike := kind == "modpack" || kind == "forge" || kind == "neoforge"
		if forgeLike && minor <= 16 {
			return "itzg/minecraft-server:java8"
		}
		if minor < 20 || (forgeLike && minor == 20 && patch < 5) {
			return "itzg/minecraft-server:java17"
		}
		return "itzg/minecraft-server:java21"
	}
	return images["JAVA"]
}

// What a Java server runs: plain Paper, a BentoBox game mode, a Modrinth mod
// pack, or a mod loader with the mods its owner picked.
var (
	kinds = map[string]bool{"vanilla": true, "skyblock": true, "oneblock": true, "modpack": true, "fabric": true, "forge": true, "neoforge": true}
	// The image's TYPE for each mod loader.
	loaderTypes = map[string]string{"fabric": "FABRIC", "forge": "FORGE", "neoforge": "NEOFORGE"}
	// The plugins (from Modrinth) each game mode needs on Paper.
	gameModePlugins = map[string]string{"skyblock": "bentobox,bskyblock", "oneblock": "bentobox,aoneblock"}
	// Kinds that run on Paper, so they take plugins; only these may run non-premium.
	paperKinds      = map[string]bool{"vanilla": true, "skyblock": true, "oneblock": true}
	validModpack    = regexp.MustCompile(`^[A-Za-z0-9_-]{2,64}$`) // Modrinth slug or project ID
	validModrinthID = regexp.MustCompile(`^[A-Za-z0-9]{8}$`)      // Modrinth version ID
	validCurseFile  = regexp.MustCompile(`^[0-9]{1,12}$`)         // CurseForge file ID
)

// AuthMeReloaded on Modrinth: on a non-premium server, players register a
// password with /register and log in with /login, so nobody can play under
// someone else's name.
const authMe = "9js4IEHC"

// Crossplay: Geyser lets Bedrock players into a Java server, and Floodgate lets
// them in without a Java account (Geyser switches to it by itself when both run
// on the same server). Neither Paper build is on Modrinth, so they come from
// GeyserMC. Geyser speaks the newest Java version; ViaVersion (on Modrinth)
// lets it into a server running an older one.
var crossplayPlugins = []string{
	"https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/spigot",
	"https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/spigot",
}

const viaVersion = "viaversion"

// The port Geyser listens on inside the container (Bedrock's usual one).
const geyserPort = "19132/udp"

// pluginEnv has the image install a Paper server's plugins, or a mod loader's
// mods, from Modrinth: the game mode's own, the login plugin a non-premium
// server needs, then the owner's. The owner's are optional, so one without a
// build for the server's version is skipped (with a warning in the console)
// instead of keeping the server down, and doesn't hold back the version a game
// mode picks; the login plugin isn't, so a non-premium server never runs
// without it. Crossplay adds Geyser and Floodgate. The lists are always set,
// even empty, because the image removes the plugins and mods it installed
// that are no longer listed.
func pluginEnv(kind string, plugins []string, offline, crossplay bool) []string {
	var projects []string
	if base := gameModePlugins[kind]; base != "" {
		projects = strings.Split(base, ",")
	}
	if offline {
		projects = append(projects, authMe)
	}
	if crossplay {
		// Optional: a server already on the newest version doesn't need it.
		projects = append(projects, viaVersion+"?")
	}
	for _, p := range plugins {
		projects = append(projects, p+"?")
	}
	env := []string{"MODRINTH_PROJECTS=" + strings.Join(projects, ","), "MODRINTH_DOWNLOAD_DEPENDENCIES=required"}
	if paperKinds[kind] {
		// Always set on Paper, so turning crossplay off removes the two plugins (and only them).
		var urls []string
		if crossplay {
			urls = crossplayPlugins
		}
		env = append(env, "PLUGINS="+strings.Join(urls, ","))
	}
	return env
}

// Server IDs come from the panel (cuid); restrict them so they're safe in container names.
var validID = regexp.MustCompile(`^[a-z0-9]{8,40}$`)

type agent struct {
	docker      *Docker
	token       string
	stateDir    string        // marker files recording why a server was stopped
	idle        time.Duration // free servers sleep after this long with no players
	memoryLimit int           // MB of plan memory servers may hold in total; 0 means no limit
	overbook    float64       // how many times memoryLimit the panel sells to paid plans (see capacity.go)
	freeMemory  int           // MB a free server gets at most on this machine; 0: its plan's (see capacity.go)
	startMu     sync.Mutex
	netMu       sync.Mutex
	netOn       bool     // GAME_NETWORK=on: servers join the game network (see ensureGameNetwork)
	netReady    bool     // the game network exists
	backupDir   string   // where the agent keeps backups
	backupMount string   // the same place as helper containers mount it: a volume name or host path
	serverLocks sync.Map // server id -> *sync.Mutex, held during backups, restores and file changes
	volumesDir  string   // Docker's volume directory, mounted at the same path; "" turns the file manager off
	diskReserve int64    // bytes of disk the file manager leaves free
	uploadMax   int64    // the biggest file the file manager takes
	unzipMax    int64    // the most an archive may unpack to
	cfKey       string   // CurseForge API key, for servers that install a CurseForge mod pack

	diskMu        sync.Mutex
	diskLimits    map[string]int64 // server id -> MB its files may take (see disk.go)
	diskUsage     sync.Map         // server id -> diskUse, the last measurement
	diskMeasuring sync.Map         // server id -> true while a measurement runs in the background

	peerMu     sync.RWMutex
	peerRoutes map[string]string // Java address -> router of the machine it's on (see peers.go)

	metrics    sync.Map // server id -> *serverMetrics, the Statistics card's history (see metrics.go)
	lastPlayed sync.Map // Terraria server id -> time.Time someone was last connected (see idle.go)
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
	overbook, err := strconv.ParseFloat(envOr("MEMORY_OVERBOOK", "1"), 64)
	if err != nil || overbook < 1 || overbook > 4 {
		log.Fatal("MEMORY_OVERBOOK must be a number from 1 (no overbooking) to 4")
	}
	freeMemory, err := strconv.Atoi(envOr("FREE_SERVER_MEMORY_MB", "0"))
	if err != nil || (freeMemory != 0 && freeMemory < 512) {
		log.Fatal("FREE_SERVER_MEMORY_MB must be a number of megabytes, at least 512 (0 for the plan's)")
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
		overbook:    overbook,
		freeMemory:  freeMemory,
		backupDir:   backupDir,
		backupMount: envOr("BACKUP_MOUNT", backupDir),
		volumesDir:  filepath.Clean(envOr("VOLUMES_DIR", "/var/lib/docker/volumes")),
		diskReserve: reserveMb << 20,
		uploadMax:   uploadMb << 20,
		unzipMax:    4 * uploadMb << 20,
		cfKey:       os.Getenv("CF_API_KEY"),
		netOn:       os.Getenv("GAME_NETWORK") == "on",
	}
	for _, dir := range []string{a.stateDir, a.backupDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			log.Fatal(err)
		}
	}
	a.loadDiskLimits()
	a.loadPeerRoutes()

	// Pull images up front so the first server creation isn't slow.
	go func() {
		prefetch := []string{backupImage, images["JAVA"], images["BEDROCK"], terrariaImages["vanilla"], terrariaImages["tshock"]}
		if tmodSupported() {
			prefetch = append(prefetch, tmodImage)
		}
		for _, img := range prefetch {
			if err := a.ensureImage(context.Background(), img); err != nil {
				log.Printf("prefetch %s: %v", img, err)
			}
		}
	}()
	go a.watchIdle(context.Background())
	go a.watchBackups(context.Background())
	go a.watchDisk(context.Background())
	go a.watchMetrics(context.Background())

	gameAddr := envOr("GAME_ADDR", ":25565")
	ln, err := net.Listen("tcp", gameAddr)
	if err != nil {
		log.Fatalf("game listener: %v", err)
	}
	rt := &router{lookup: a.lookupRoute, wake: a.wake, dial: dialTCP}
	go func() { log.Fatal(rt.serve(ln)) }()
	log.Printf("routing Java players on %s", gameAddr)

	addr := envOr("AGENT_ADDR", ":8081")
	log.Printf("agent API listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, a.routes()))
}

func (a *agent) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]bool{"ok": true}) })
	mux.HandleFunc("GET /stats", a.stats)
	mux.HandleFunc("PUT /disk-limits", a.putDiskLimits)
	mux.HandleFunc("PUT /peer-routes", a.putPeerRoutes)
	mux.HandleFunc("POST /servers", a.create)
	mux.HandleFunc("PUT /servers/{id}", a.recreate)
	mux.HandleFunc("GET /servers/{id}", a.status)
	mux.HandleFunc("POST /servers/{id}/start", a.start)
	mux.HandleFunc("POST /servers/{id}/stop", a.stop)
	mux.HandleFunc("DELETE /servers/{id}", a.remove)
	mux.HandleFunc("GET /servers/{id}/logs", a.logs)
	mux.HandleFunc("POST /servers/{id}/command", a.command)
	mux.HandleFunc("GET /servers/{id}/metrics", a.metricsHandler)
	mux.HandleFunc("GET /servers/{id}/backups", a.backupsList)
	mux.HandleFunc("POST /servers/{id}/backups", a.backupsCreate)
	mux.HandleFunc("GET /servers/{id}/backups/{file}", a.backupDownload)
	mux.HandleFunc("POST /servers/{id}/backups/{file}/restore", a.backupRestore)
	mux.HandleFunc("PUT /servers/{id}/backups/{file}", a.backupUpload)
	mux.HandleFunc("GET /servers/{id}/export", a.exportFiles)
	mux.HandleFunc("PUT /servers/{id}/import", a.importFiles)
	mux.HandleFunc("GET /servers/{id}/files", a.filesList)
	mux.HandleFunc("DELETE /servers/{id}/files", a.filesDelete)
	mux.HandleFunc("GET /servers/{id}/files/content", a.filesRead)
	mux.HandleFunc("PUT /servers/{id}/files/content", a.filesWrite)
	mux.HandleFunc("POST /servers/{id}/files/mkdir", a.filesMkdir)
	mux.HandleFunc("POST /servers/{id}/files/rename", a.filesRename)
	mux.HandleFunc("POST /servers/{id}/files/unzip", a.filesUnzip)
	mux.HandleFunc("GET /servers/{id}/worlds", a.worldsList)
	mux.HandleFunc("GET /servers/{id}/worlds/{name}/download", a.worldDownload)
	mux.HandleFunc("POST /servers/{id}/worlds/import", a.worldImport)
	mux.HandleFunc("DELETE /servers/{id}/worlds/{name}", a.worldDelete)
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
	Password   string  `json:"password"`    // Terraria only: what players type to join; none if empty
	Autostop   bool    `json:"autostop"`    // sleep when nobody is playing (free plan)
	Backups    int     `json:"backupsKept"` // daily backups to keep; 0 for none
	DiskMb     int64   `json:"diskMb"`      // disk space the server's files may take; 0 for no limit

	// Game settings the owner picks in the panel.
	GameMode   string   `json:"gameMode"`         // survival, creative or adventure (Minecraft)
	Difficulty string   `json:"difficulty"`       // peaceful, easy, normal or hard; Terraria: classic, expert, master or journey
	Motd       string   `json:"motd"`             // shown in the server list; the name if empty
	PVP        *bool    `json:"pvp"`              // Java only; on if missing
	Whitelist  bool     `json:"whitelist"`        // only listed players may join
	Players    []string `json:"whitelistPlayers"` // Java profile names or Bedrock gamertags
	// Java on Paper only: false lets in players without a bought Minecraft
	// ("non-premium"); they log in with a password instead. On if missing.
	OnlineMode *bool `json:"onlineMode"`
	// Java on Paper only: Bedrock players (phones, consoles, Windows) join too,
	// through the Geyser plugin on the server's port over UDP.
	Crossplay bool `json:"crossplay"`

	// The world the server runs (a folder in its files; see worlds.go) and,
	// for one it hasn't made yet, its seed and type. The image's default
	// world if empty.
	Level     string `json:"level"`
	Seed      string `json:"seed"`
	LevelType string `json:"levelType"` // normal, flat, large_biomes or amplified (Java); small, medium or large (Terraria)

	// What the server runs: on Java one of kinds; on Terraria vanilla, tshock or tmodloader. For a mod pack, where it comes
	// from (modrinth, the default, or curseforge), the project's slug and the exact
	// pack version (a Modrinth version ID or a CurseForge file ID), so players can
	// install the same one.
	Kind           string `json:"kind"`
	ModpackSource  string `json:"modpackSource"`
	Modpack        string `json:"modpack"`
	ModpackVersion string `json:"modpackVersion"`
	// Java on Paper only (not mod packs): Modrinth plugins (slugs or project IDs) the owner added.
	// On tModLoader: the Steam Workshop IDs of the owner's mods.
	Plugins []string `json:"plugins"`
}

var (
	validVersion = regexp.MustCompile(`^(LATEST|\d+\.\d+(\.\d+)?)$`)
	validPlayer  = regexp.MustCompile(`^[\p{L}\p{N} _-]{1,32}$`)
	validSeed    = regexp.MustCompile(`^[\p{L}\p{N} _-]{0,32}$`)
	// server.properties names for each world type, which every version since 1.16 understands.
	javaLevelTypes    = map[string]string{"normal": "default", "flat": "flat", "large_biomes": "largebiomes", "amplified": "amplified"}
	bedrockLevelTypes = map[string]string{"normal": "DEFAULT", "flat": "FLAT"}
	gameModes         = map[string]bool{"survival": true, "creative": true, "adventure": true}
	difficulties      = map[string]bool{"peaceful": true, "easy": true, "normal": true, "hard": true}
)

func (req *createRequest) validate() error {
	if req.Edition == "TERRARIA" {
		return req.validateTerraria()
	}
	if _, ok := images[req.Edition]; !ok {
		return errors.New("edition must be JAVA, BEDROCK or TERRARIA")
	}
	switch {
	case !validID.MatchString(req.ID):
		return errors.New("invalid id")
	case req.MemoryMb < 512 || req.Port < 1024 || req.Port > 65535 || req.CPUs <= 0 || req.DiskMb < 0:
		return errors.New("invalid memoryMb, cpus, port or diskMb")
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
		return errors.New("kind must be vanilla, skyblock, oneblock, modpack, fabric, forge or neoforge (Java only)")
	case req.Kind == "modpack" && req.ModpackSource == "curseforge" && (!validModpack.MatchString(req.Modpack) || !validCurseFile.MatchString(req.ModpackVersion)):
		return errors.New("a CurseForge modpack server needs the pack's slug and a file ID as modpackVersion")
	case req.Kind == "modpack" && req.ModpackSource != "curseforge" && (!validModpack.MatchString(req.Modpack) || !validModrinthID.MatchString(req.ModpackVersion)):
		return errors.New("a modpack server needs a Modrinth modpack and modpackVersion")
	case req.ModpackSource != "" && (req.Kind != "modpack" || (req.ModpackSource != "modrinth" && req.ModpackSource != "curseforge")):
		return errors.New("modpackSource must be modrinth or curseforge, for a modpack server")
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
	levelTypes := javaLevelTypes
	if req.Edition == "BEDROCK" {
		levelTypes = bedrockLevelTypes
	}
	switch {
	case req.OnlineMode != nil && !*req.OnlineMode && (req.Edition != "JAVA" || !paperKinds[req.Kind]):
		return errors.New("only Java servers on Paper can run non-premium")
	case req.Crossplay && (req.Edition != "JAVA" || !paperKinds[req.Kind]):
		return errors.New("only Java servers on Paper can run crossplay")
	case req.Level != "" && !validWorldName.MatchString(req.Level):
		return errors.New("invalid level")
	case !validSeed.MatchString(req.Seed):
		return errors.New("invalid seed")
	case req.LevelType != "" && levelTypes[req.LevelType] == "":
		return errors.New("invalid levelType")
	}
	return nil
}

func (req *createRequest) validateTerraria() error {
	if req.Kind == "" {
		req.Kind = "vanilla"
	}
	if req.Difficulty == "" {
		req.Difficulty = "classic"
	}
	if req.LevelType == "" {
		req.LevelType = "medium"
	}
	switch {
	case !validID.MatchString(req.ID):
		return errors.New("invalid id")
	case req.MemoryMb < 512 || req.Port < 1024 || req.Port > 65535 || req.CPUs <= 0 || req.DiskMb < 0:
		return errors.New("invalid memoryMb, cpus, port or diskMb")
	case terrariaImages[req.Kind] == "":
		return errors.New("a Terraria server's kind must be vanilla, tshock or tmodloader")
	case req.Kind == "tmodloader" && !tmodSupported():
		return errors.New("tModLoader servers need an x86 (amd64) machine")
	case terrariaDifficulties[req.Difficulty] == "":
		return errors.New("a Terraria world's difficulty must be classic, expert, master or journey")
	case terrariaSizes[req.LevelType] == "":
		return errors.New("a Terraria world's size (levelType) must be small, medium or large")
	case !validTerrariaPassword.MatchString(req.Password):
		return errors.New("the password must be up to 32 letters, digits or symbols, without spaces")
	case len([]rune(req.Motd)) > 100 || strings.ContainsFunc(req.Motd, unicode.IsControl):
		return errors.New("motd must be one line of up to 100 characters")
	case req.Level != "" && !validWorldName.MatchString(req.Level):
		return errors.New("invalid level")
	case !validSeed.MatchString(req.Seed):
		return errors.New("invalid seed")
	case len(req.Plugins) > 0 && req.Kind != "tmodloader":
		return errors.New("only tModLoader servers take mods")
	case len(req.Plugins) > 100:
		return errors.New("at most 100 mods")
	case req.Whitelist || req.Crossplay || req.offline() || req.Modpack != "" || req.Hostname != "":
		return errors.New("whitelist, crossplay, onlineMode, modpacks and hostnames are Minecraft only")
	}
	for _, id := range req.Plugins {
		if !validWorkshopID.MatchString(id) {
			return fmt.Errorf("invalid Steam Workshop ID %q", id)
		}
	}
	req.Version = "LATEST"
	return nil
}

// offline reports whether the server lets in players without a bought Minecraft.
func (req *createRequest) offline() bool { return req.OnlineMode != nil && !*req.OnlineMode }

// level is the world the server runs.
func (req *createRequest) level() string {
	switch {
	case req.Level != "":
		return req.Level
	case req.Edition == "BEDROCK":
		return defaultBedrockLevel
	case req.Edition == "TERRARIA":
		return defaultTerrariaLevel
	}
	return defaultJavaLevel
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
	if err := a.setDiskLimits(map[string]int64{req.ID: req.DiskMb}, false); err != nil {
		log.Printf("disk limit %s: %v", req.ID, err)
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
	if err := a.setDiskLimits(map[string]int64{req.ID: req.DiskMb}, false); err != nil {
		log.Printf("disk limit %s: %v", req.ID, err)
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
	if req.Edition == "TERRARIA" {
		// Minecraft images fetch the newest game when the server starts; Terraria's
		// images carry it, so a new container takes the newest image (players'
		// games update themselves and only join a server on the same version).
		pullCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
		if err := a.docker.PullImage(pullCtx, image); err != nil {
			log.Printf("pull %s: %v (using the one we have)", image, err)
		}
		cancel()
	}
	if err := a.ensureImage(ctx, image); err != nil {
		return err
	}
	name := containerName(req.ID)
	spec := a.containerSpec(req, image)
	hc := spec["HostConfig"].(map[string]any)
	hc["Dns"] = gameDNS
	if a.ensureGameNetwork(ctx) {
		hc["NetworkMode"] = gameNetwork
	}
	if err := a.docker.CreateContainer(ctx, name, spec); err != nil {
		return err
	}
	if req.offline() {
		a.prepareLogin(ctx, req.ID)
	}
	if req.Edition == "JAVA" {
		a.prepareIslands(ctx, req.ID, req.Kind)
	}
	if !start {
		return nil
	}
	if err := a.startServer(ctx, req.ID); !errors.Is(err, errDiskFull) {
		return err
	}
	// Made, but too full to start: its status says so, and its owner can make room.
	log.Printf("%s not started: over its disk limit", name)
	return nil
}

func (a *agent) containerSpec(req createRequest, image string) map[string]any {
	small := req.Autostop && a.freeMemory > 0 && req.MemoryMb > a.freeMemory
	if small {
		req.MemoryMb = a.freeMemory
	}
	spec := a.gameSpec(req, image)
	if small {
		// Too little memory for every free server's whole plan: may swap rather than be killed when they all grow.
		hc := spec["HostConfig"].(map[string]any)
		hc["MemorySwap"] = hc["Memory"].(int64) + int64(freeSwapMb)<<20
	}
	return spec
}

func (a *agent) gameSpec(req createRequest, image string) map[string]any {
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
		"mchost.level":    req.level(),
	}
	if req.Edition == "TERRARIA" {
		// Players connect straight to the server's port: no router, no hostname.
		env, entrypoint := terrariaSpec(req)
		labels["mchost.maxplayers"] = fmt.Sprint(req.terrariaSlots())
		bindings := map[string]any{terrariaPort: []map[string]string{{"HostIp": "", "HostPort": fmt.Sprint(req.Port)}}}
		spec := serverSpec(req, image, env, labels, bindings, false, req.MemoryMb, entrypoint)
		spec["Healthcheck"] = terrariaHealthcheck(req.Kind)
		return spec
	}
	var containerPort, hostIP string
	var entrypoint []string
	bindings := map[string]any{} // more ports than the main one, if any
	tty := false
	// Leave headroom above the JVM heap for the JVM itself, or the kernel OOM-kills it.
	limitMb := req.MemoryMb
	if req.Edition == "JAVA" {
		pvp := req.PVP == nil || *req.PVP
		switch req.Kind {
		case "skyblock", "oneblock":
			// The image picks the newest Minecraft version all the game mode's plugins support.
			env = append(env, "TYPE=PAPER", "VERSION_FROM_MODRINTH_PROJECTS=TRUE", "PRE_START_SCRIPT="+addonsScriptPath)
			entrypoint = islandsEntrypoint // puts the game mode where BentoBox loads it
		case "modpack":
			// The image installs the pack's mod loader and server-side mods.
			if req.ModpackSource == "curseforge" {
				// The pack's manifest says which Minecraft and loader it runs on.
				env = append(env, "TYPE=AUTO_CURSEFORGE", "CF_SLUG="+req.Modpack, "CF_FILE_ID="+req.ModpackVersion)
				if a.cfKey != "" {
					env = append(env, "CF_API_KEY="+a.cfKey)
				}
			} else {
				env = append(env, "TYPE=MODRINTH", "MODRINTH_MODPACK="+req.Modpack, "MODRINTH_VERSION="+req.ModpackVersion, "VERSION="+req.Version,
					"MODRINTH_EXCLUDE_FILES="+strings.Join(packExcludes, ","), "PRE_START_SCRIPT="+packScriptPath)
				entrypoint = packEntrypoint
			}
		case "fabric", "forge", "neoforge":
			// The image installs the loader for the version; pluginEnv adds the mods.
			env = append(env, "TYPE="+loaderTypes[req.Kind], "VERSION="+req.Version)
		default:
			env = append(env, "TYPE=PAPER", "VERSION="+req.Version)
		}
		if req.Kind != "modpack" {
			env = append(env, pluginEnv(req.Kind, req.Plugins, req.offline(), req.Crossplay)...)
		}
		// Always set: the image only writes the properties it's given, so going back
		// from non-premium has to say so.
		env = append(env, fmt.Sprintf("ONLINE_MODE=%v", !req.offline()))
		if req.Level != "" {
			env = append(env, "LEVEL="+req.Level)
		}
		if req.Seed != "" {
			env = append(env, "SEED="+req.Seed)
		}
		if req.LevelType != "" {
			env = append(env, "LEVEL_TYPE="+javaLevelTypes[req.LevelType])
		}
		// Java starts with a small heap and grows it only as far as the players
		// need, up to the plan; an idle one gives memory back to the machine.
		// Aikar's garbage collector flags avoid the pauses that stall chunk loading.
		env = append(env, fmt.Sprintf("INIT_MEMORY=%dM", min(req.MemoryMb, initialHeapMb)), fmt.Sprintf("MAX_MEMORY=%dM", req.MemoryMb),
			"JVM_XX_OPTS=-XX:G1PeriodicGCInterval=300000", "USE_AIKAR_FLAGS=true", "ENABLE_RCON=true",
			"MOTD="+motd, "MODE="+req.GameMode, fmt.Sprintf("PVP=%v", pvp), fmt.Sprintf("ENABLE_WHITELIST=%v", req.Whitelist))
		if req.Whitelist {
			players := req.Players
			if req.offline() {
				// Non-premium players have no Mojang account to look up; the image
				// gives them the IDs an offline server uses instead.
				players = make([]string, len(req.Players))
				for i, p := range req.Players {
					players[i] = p + ":offline"
				}
			}
			// The panel's list replaces whatever the server had, so removing a player works.
			env = append(env, "WHITELIST="+strings.Join(players, ","), "EXISTING_WHITELIST_FILE=SYNCHRONIZE", "ENFORCE_WHITELIST=TRUE")
		}
		// Fewer chunks around each player (Minecraft's default is 10) means new
		// ground appears faster when someone runs or flies; free servers share
		// less CPU, so they see a little less far.
		view := "10"
		if req.Autostop {
			view = "8"
		}
		env = append(env, "VIEW_DISTANCE="+view, "SIMULATION_DISTANCE=6")
		if req.Autostop {
			// The image stops the server by itself once nobody has played for this long.
			secs := fmt.Sprint(int(a.idle.Seconds()))
			env = append(env, "ENABLE_AUTOSTOP=TRUE", "AUTOSTOP_TIMEOUT_EST="+secs, "AUTOSTOP_TIMEOUT_INIT="+secs)
		}
		labels["mchost.host"] = req.Hostname
		containerPort = "25565/tcp"
		hostIP = "127.0.0.1" // players come in through the router, not directly
		limitMb = req.MemoryMb + 512
		if req.Crossplay {
			// Bedrock has no hostname to route by, so Geyser gets the server's own
			// port, open to everyone, over UDP (the Java side stays on TCP).
			bindings[geyserPort] = []map[string]string{{"HostIp": "", "HostPort": fmt.Sprint(req.Port)}}
		}
	} else {
		env = append(env, "VERSION="+req.Version, "SERVER_NAME="+motd, "GAMEMODE="+req.GameMode)
		if req.Level != "" {
			env = append(env, "LEVEL_NAME="+req.Level)
		}
		if req.Seed != "" {
			env = append(env, "LEVEL_SEED="+req.Seed)
		}
		if req.LevelType != "" {
			env = append(env, "LEVEL_TYPE="+bedrockLevelTypes[req.LevelType])
		}
		if req.Whitelist {
			env = append(env, "ALLOW_LIST=true", "ALLOW_LIST_USERS="+strings.Join(req.Players, ","))
		} else {
			// Recent Bedrock servers turn the allow list on by default, which keeps everyone out.
			env = append(env, "ALLOW_LIST=false")
		}
		containerPort = "19132/udp"
		tty = true // send-command writes to the server's stdin
	}
	bindings[containerPort] = []map[string]string{{"HostIp": hostIP, "HostPort": fmt.Sprint(req.Port)}}
	return serverSpec(req, image, env, labels, bindings, tty, limitMb, entrypoint)
}

// serverSpec is the container for a game server, whatever the game.
func serverSpec(req createRequest, image string, env []string, labels map[string]string, bindings map[string]any, tty bool, limitMb int, entrypoint []string) map[string]any {
	exposed := map[string]any{}
	for port := range bindings {
		exposed[port] = map[string]any{}
	}
	spec := map[string]any{
		"Image":        image,
		"Env":          env,
		"Tty":          tty,
		"OpenStdin":    tty,
		"ExposedPorts": exposed,
		"Labels":       labels,
		"HostConfig": map[string]any{
			"Memory":     int64(limitMb) * 1024 * 1024,
			"MemorySwap": int64(limitMb) * 1024 * 1024, // no swap
			// A server may borrow one more core while the machine has one idle
			// (chunk generation is what needs it); when cores are busy, Docker
			// shares them in proportion to each plan's cores.
			"NanoCpus":  int64(burstCPUs(req.CPUs) * 1e9),
			"CpuShares": int64(req.CPUs * 1024),
			"PidsLimit": 512,
			// Keep only the newest console output: it holds players' IP addresses and would otherwise fill the disk.
			"LogConfig": map[string]any{"Type": "json-file", "Config": map[string]string{"max-size": "10m", "max-file": "3"}},
			// Restarts after a crash only; a clean exit (e.g. going to sleep) stays down.
			"RestartPolicy": map[string]any{"Name": "on-failure", "MaximumRetryCount": 3},
			"PortBindings":  bindings,
			"Mounts":        []map[string]any{{"Type": "volume", "Source": containerName(req.ID), "Target": "/data"}},
			// Players' plugins and mods run inside: nothing in there may gain
			// more rights than it started with, or forge packets to its neighbours.
			"SecurityOpt": []string{"no-new-privileges:true"},
			"CapDrop":     []string{"NET_RAW"},
		},
	}
	if entrypoint != nil {
		spec["Entrypoint"] = entrypoint
		spec["Cmd"] = []string{}
	}
	return spec
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
	for k, v := range a.diskInfo(id) {
		resp[k] = v
	}
	writeJSON(w, http.StatusOK, resp)
}

// stopReason explains a stopped container: the owner stopped it, it fell
// asleep for lack of players, or it crashed.
func (a *agent) stopReason(id string, info *ContainerInfo) string {
	switch {
	case a.hasMarker(id, "disk"):
		return "disk"
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
	a.diskUsage.Delete(id)
	if err := a.setDiskLimits(map[string]int64{id: 0}, false); err != nil {
		log.Printf("disk limit %s: %v", id, err)
	}
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
	switch info.Config.Labels["mchost.edition"] {
	case "BEDROCK":
		cmd = []string{"send-command", req.Command}
	case "TERRARIA":
		cmd = terrariaCommand(req.Command)
	}
	out, err := a.docker.Exec(ctx, name, cmd)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"output": strings.TrimSpace(out)})
}

// gameNetwork is the Docker network game servers join. Servers on it can't
// reach each other (a player's plugin can't attack someone else's server);
// the router, on the host, still reaches each of them. Its bridge is named so
// the firewall set up by deploy/ can keep servers away from the cloud's
// metadata service and the tunnel between machines.
const gameNetwork = "mchost-games"

// packExcludes are client-side mods that some packs mark for servers too and
// that stop a server from starting. Missing Mods Checker opens a window when a
// player-only mod isn't there (always, on a server), which a server can't do
// (Better MC: java.awt.HeadlessException). FTB Quests Freeze Fix ships an empty
// en_us.json, which a server can't read (Better MC: "JsonObject.entrySet()
// because $$2 is null"); it only fixes the FTB Quests screen anyway.
var packExcludes = []string{"missingmodschecker", "ftbquestsfreezefix"}

// gameDNS answers servers' lookups (Paper, plugins, mod packs). Docker would otherwise pass them on to whatever the provider set up
// on the host, which may sit behind the firewall that keeps servers away from
// the provider's own addresses, or fail now and then (seen on a node as
// SERVFAIL for fill.papermc.io).
var gameDNS = []string{"1.1.1.1", "9.9.9.9", "8.8.8.8"}

var gameNetworkOptions = map[string]string{
	"com.docker.network.bridge.enable_icc": "false",
	"com.docker.network.bridge.name":       "mchost0",
}

// ensureGameNetwork makes the game network once. It's off unless GAME_NETWORK=on:
// on the live machines servers on it lost their internet now and then (DNS
// SERVFAIL and timeouts downloading Paper and Geyser), so they stay on
// Docker's default network until that's understood. If Docker refuses, servers
// fall back to Docker's default network rather than not starting at all.
func (a *agent) ensureGameNetwork(ctx context.Context) bool {
	a.netMu.Lock()
	defer a.netMu.Unlock()
	if !a.netOn {
		return false
	}
	if !a.netReady {
		if err := a.docker.EnsureNetwork(ctx, gameNetwork, gameNetworkOptions); err != nil {
			log.Printf("network %s: %v (using Docker's default network)", gameNetwork, err)
			return false
		}
		a.netReady = true
	}
	return true
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
	for _, kind := range []string{"stopped", "sleeping", "suspended", "disk"} {
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
	case errors.Is(err, errDiskFull):
		writeError(w, http.StatusInsufficientStorage, "diskFull")
	case errors.Is(err, errNoBackups):
		writeError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, errBackupNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, err.Error())
	}
	return true
}

// burstCPUs is the most cores a server may use: its plan's cores plus one,
// but never more than the machine has.
func burstCPUs(planCPUs float64) float64 {
	return min(planCPUs+1, float64(runtime.NumCPU()))
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
