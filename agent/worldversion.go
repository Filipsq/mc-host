package main

import (
	"context"
	"io"
	"log"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// worldVersionFile, in a Java world's folder, holds the newest Minecraft
// version that has run the world. Minecraft can't open a world a newer
// version saved: a Paper 26.1.2 server stopped (exit 1) on a world 26.3 had
// saved, "Server attempted to load chunk saved with newer version of
// minecraft! 5023 > 4790" (2026-11-17). The panel reads it (worldInfo.SavedBy)
// and won't set an older version for that world.
const worldVersionFile = ".mchost-version"

// "[12:58:28 INFO]: Starting minecraft server version 26.1.2"
var startingVersion = regexp.MustCompile(`Starting minecraft server version (\d+\.\d+(?:\.\d+)?)\b`)

var releaseNumber = regexp.MustCompile(`^\d+\.\d+(\.\d+)?$`)

// noteWorldVersion records, once per start, the version this start runs in its
// world's worldVersionFile, unless a newer one is there already.
func (a *agent) noteWorldVersion(ctx context.Context, id, level string, m *serverMetrics) {
	m.mu.Lock()
	done, since := m.worldVersion, m.startedAt
	m.mu.Unlock()
	if done || a.volumesDir == "" {
		return
	}
	started, err := time.Parse(time.RFC3339Nano, since)
	if err != nil {
		return
	}
	logCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	version := ""
	if err := a.docker.Logs(logCtx, containerName(id), LogOptions{Since: started.Unix()}, func(line string) error {
		if v := startingVersion.FindStringSubmatch(line); v != nil {
			version = v[1]
		}
		return nil
	}); err != nil || version == "" {
		return
	}
	m.mu.Lock()
	m.worldVersion = true
	m.mu.Unlock()
	if level == "" {
		level = "world"
	}
	if !validWorldName.MatchString(level) {
		return
	}
	s, err := a.openFiles(ctx, id)
	if err != nil {
		return
	}
	defer s.Close()
	if old := s.worldVersion(level); old != "" && compareVersions(old, version) >= 0 {
		return
	}
	if _, err := s.writeFile(level+"/"+worldVersionFile, strings.NewReader(version+"\n")); err != nil {
		log.Printf("world version %s: %v", id, err)
	}
}

// worldVersion is the newest version that ran the world, or "" if none is recorded.
func (s *serverFiles) worldVersion(level string) string {
	f, err := s.root.Open(level + "/" + worldVersionFile)
	if err != nil {
		return ""
	}
	defer f.Close()
	b, _ := io.ReadAll(io.LimitReader(f, 64))
	v := strings.TrimSpace(string(b))
	if !releaseNumber.MatchString(v) {
		return ""
	}
	return v
}

// compareVersions orders Minecraft release numbers: 1.21.11 < 26.1 < 26.1.2 < 26.3.
func compareVersions(a, b string) int {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < 3; i++ {
		x, y := 0, 0
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			return x - y
		}
	}
	return 0
}
