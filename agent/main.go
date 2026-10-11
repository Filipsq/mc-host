// Command agent runs on each game host. It creates and controls one Docker
// container per Minecraft server on behalf of the web panel.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

var images = map[string]string{
	"JAVA":    "itzg/minecraft-server:java21",
	"BEDROCK": "itzg/minecraft-bedrock-server:latest",
}

// Server IDs come from the panel (cuid); restrict them so they're safe in container names.
var validID = regexp.MustCompile(`^[a-z0-9]{8,40}$`)

type agent struct {
	docker *Docker
	token  string
}

func main() {
	token := os.Getenv("AGENT_TOKEN")
	if token == "" {
		log.Fatal("AGENT_TOKEN is required")
	}
	addr := envOr("AGENT_ADDR", ":8081")
	a := &agent{docker: NewDocker(envOr("DOCKER_SOCKET", "/var/run/docker.sock")), token: token}

	// Pull images up front so the first server creation isn't slow.
	go func() {
		for _, img := range images {
			if err := a.ensureImage(context.Background(), img); err != nil {
				log.Printf("prefetch %s: %v", img, err)
			}
		}
	}()

	log.Printf("agent listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, a.routes()))
}

func (a *agent) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, 200, map[string]bool{"ok": true}) })
	mux.HandleFunc("POST /servers", a.create)
	mux.HandleFunc("GET /servers/{id}", a.status)
	mux.HandleFunc("POST /servers/{id}/start", a.start)
	mux.HandleFunc("POST /servers/{id}/stop", a.stop)
	mux.HandleFunc("DELETE /servers/{id}", a.remove)
	mux.HandleFunc("GET /servers/{id}/logs", a.logs)
	mux.HandleFunc("POST /servers/{id}/command", a.command)
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
}

func (a *agent) create(w http.ResponseWriter, r *http.Request) {
	var req createRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	image, ok := images[req.Edition]
	switch {
	case !validID.MatchString(req.ID):
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	case !ok:
		writeError(w, http.StatusBadRequest, "edition must be JAVA or BEDROCK")
		return
	case req.MemoryMb < 512 || req.Port < 1024 || req.Port > 65535 || req.CPUs <= 0:
		writeError(w, http.StatusBadRequest, "invalid memoryMb, cpus or port")
		return
	}
	if req.Version == "" {
		req.Version = "LATEST"
	}

	ctx := r.Context()
	if err := a.ensureImage(ctx, image); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	name := containerName(req.ID)
	if err := a.docker.CreateContainer(ctx, name, containerSpec(req, image)); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := a.docker.StartContainer(ctx, name); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	log.Printf("created %s (%s, %d MB, port %d)", name, req.Edition, req.MemoryMb, req.Port)
	writeJSON(w, http.StatusCreated, map[string]string{"container": name})
}

func containerSpec(req createRequest, image string) map[string]any {
	maxPlayers := fmt.Sprint(req.MaxPlayers)
	if req.MaxPlayers <= 0 {
		maxPlayers = "1000"
	}
	env := []string{"EULA=TRUE", "VERSION=" + req.Version, "MAX_PLAYERS=" + maxPlayers}
	var containerPort string
	tty := false
	// Leave headroom above the JVM heap for the JVM itself, or the kernel OOM-kills it.
	limitMb := req.MemoryMb
	if req.Edition == "JAVA" {
		env = append(env, "TYPE=PAPER", fmt.Sprintf("MEMORY=%dM", req.MemoryMb), "MOTD="+req.Name, "ENABLE_RCON=true")
		containerPort = "25565/tcp"
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
		"Labels":       map[string]string{"mchost.server": req.ID, "mchost.edition": req.Edition},
		"HostConfig": map[string]any{
			"Memory":        int64(limitMb) * 1024 * 1024,
			"MemorySwap":    int64(limitMb) * 1024 * 1024, // no swap
			"NanoCpus":      int64(req.CPUs * 1e9),
			"PidsLimit":     512,
			"RestartPolicy": map[string]any{"Name": "on-failure", "MaximumRetryCount": 3},
			"PortBindings": map[string]any{
				containerPort: []map[string]string{{"HostPort": fmt.Sprint(req.Port)}},
			},
			"Mounts": []map[string]any{{"Type": "volume", "Source": containerName(req.ID), "Target": "/data"}},
		},
	}
}

func (a *agent) status(w http.ResponseWriter, r *http.Request) {
	name, ok := a.containerFor(w, r)
	if !ok {
		return
	}
	info, err := a.docker.InspectContainer(r.Context(), name)
	if a.handleDockerErr(w, err) {
		return
	}
	resp := map[string]any{
		"state":        info.State.Status, // created, running, restarting, exited, ...
		"startedAt":    info.State.StartedAt,
		"exitCode":     info.State.ExitCode,
		"restartCount": info.RestartCount,
	}
	if info.State.Health != nil {
		resp["health"] = info.State.Health.Status // starting, healthy, unhealthy
	}
	writeJSON(w, http.StatusOK, resp)
}

func (a *agent) start(w http.ResponseWriter, r *http.Request) {
	name, ok := a.containerFor(w, r)
	if !ok {
		return
	}
	if a.handleDockerErr(w, a.docker.StartContainer(r.Context(), name)) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *agent) stop(w http.ResponseWriter, r *http.Request) {
	name, ok := a.containerFor(w, r)
	if !ok {
		return
	}
	if a.handleDockerErr(w, a.docker.StopContainer(r.Context(), name, 60)) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *agent) remove(w http.ResponseWriter, r *http.Request) {
	name, ok := a.containerFor(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	if err := a.docker.RemoveContainer(ctx, name); err != nil && !errors.Is(err, errNotFound) {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// The world lives in the volume; deleting the server deletes it too.
	if err := a.docker.RemoveVolume(ctx, name); err != nil && !errors.Is(err, errNotFound) {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	log.Printf("removed %s", name)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// logs streams the console as Server-Sent Events: recent lines first, then live output.
func (a *agent) logs(w http.ResponseWriter, r *http.Request) {
	name, ok := a.containerFor(w, r)
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
	err := a.docker.Logs(r.Context(), name, 200, r.URL.Query().Get("follow") != "0", func(line string) error {
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
	name, ok := a.containerFor(w, r)
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

func (a *agent) containerFor(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if !validID.MatchString(id) {
		writeError(w, http.StatusBadRequest, "invalid id")
		return "", false
	}
	return containerName(id), true
}

// handleDockerErr writes an error response and reports whether there was one.
func (a *agent) handleDockerErr(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, errNotFound):
		writeError(w, http.StatusNotFound, "server not found")
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
