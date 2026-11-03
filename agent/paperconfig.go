package main

import (
	"context"
	"errors"
	"io/fs"
	"log"
	"strings"
	"time"
)

// fixPaperConfig sets aside a Paper config file the server's Paper can't read,
// so Paper writes a fresh one on this start. A newer Paper writes "default"
// for many values, and an older one (after the owner picked an older version)
// stops on it: `NumberFormatException: For input string: "default"` while
// loading paper-world-defaults.yml ("team-wielki-mc", 1.20.1, 2026-11-03).
// It acts only when the last start ended that way; the old file stays next to
// the new one as <name>.old.
func (a *agent) fixPaperConfig(ctx context.Context, id string) {
	if a.volumesDir == "" || a.docker == nil {
		return
	}
	logCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var bad, global, defaults bool
	_ = a.docker.Logs(logCtx, containerName(id), LogOptions{Tail: 300}, func(line string) error {
		bad = bad || isUnreadablePaperConfig(line)
		global = global || strings.Contains(line, "initializeGlobalConfiguration")
		defaults = defaults || strings.Contains(line, "initializeWorldDefaultsConfiguration")
		return nil
	})
	if !bad {
		return
	}
	files := []string{}
	if defaults || !global {
		files = append(files, "config/paper-world-defaults.yml")
	}
	if global {
		files = append(files, "config/paper-global.yml")
	}
	s, err := a.openFiles(ctx, id)
	if err != nil {
		return
	}
	defer s.Close()
	for _, f := range files {
		if err := s.root.Rename(f, f+".old"); err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				log.Printf("paper config %s: %v", id, err)
			}
			continue
		}
		log.Printf("paper config %s: set aside %s (written by a newer Paper)", id, f)
	}
}

func isUnreadablePaperConfig(line string) bool {
	return strings.Contains(line, `For input string: "default"`) ||
		(strings.Contains(line, "[MapSerializer] Could not deserialize value") && strings.Contains(line, "=default"))
}
