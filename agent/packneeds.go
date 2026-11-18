package main

import (
	"context"
	"regexp"
	"slices"
	"strings"
	"time"
)

// packNeedsFile tells a Modrinth pack's pre-start script (packScript) which
// mods Fabric last refused to start without, and the version it wanted, one
// "id [min version]" a line. The script can't read the console itself, so
// the agent writes it before each start from the last start's log, and
// removes it once nothing is missing.
const packNeedsFile = ".mchost-need"

// "HARD_DEP_NO_CANDIDATE chipped 3.0.7 {depends athena @ [>=3.1.1]}" (missing)
// "HARD_DEP chipped 3.0.7 {depends athena @ [>=3.1.1]}" (there, but too old)
var fabricDependsOn = regexp.MustCompile(`HARD_DEP(?:_NO_CANDIDATE)? \S+ \S+ \{depends ([a-z0-9_.-]+) @ \[([^\]]*)\]\}`)

// packNeeds reads the mods (and minimum versions) the last start lacked.
func packNeeds(lines []string) []string {
	var out []string
	for _, line := range lines {
		if strings.Contains(line, "Done (") {
			out = nil
			continue
		}
		if m := fabricDependsOn.FindStringSubmatch(line); m != nil {
			switch m[1] {
			case "minecraft", "java", "fabricloader", "fabric", "quilt_loader":
				continue
			}
			need := m[1]
			if f := strings.Fields(m[2]); len(f) > 0 {
				if v, ok := strings.CutPrefix(f[0], ">="); ok && v != "" {
					need += " " + v
				}
			}
			if !slices.Contains(out, need) {
				out = append(out, need)
			}
			continue
		}
		for _, id := range missingModIDs([]string{line}) {
			if !slices.ContainsFunc(out, func(n string) bool { return n == id || strings.HasPrefix(n, id+" ") }) {
				out = append(out, id)
			}
		}
	}
	return out
}

// notePackNeeds writes packNeedsFile for a Modrinth pack server about to start.
func (a *agent) notePackNeeds(ctx context.Context, id string) {
	if a.docker == nil || a.volumesDir == "" {
		return
	}
	info, err := a.docker.InspectContainer(ctx, containerName(id))
	if err != nil || !slices.Contains(info.Config.Env, "TYPE=MODRINTH") {
		return
	}
	logCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	var lines []string
	_ = a.docker.Logs(logCtx, containerName(id), LogOptions{Tail: 400}, func(line string) error {
		lines = append(lines, line)
		return nil
	})
	cancel()
	s, err := a.openFiles(ctx, id)
	if err != nil {
		return
	}
	defer s.Close()
	needs := packNeeds(lines)
	if len(needs) == 0 {
		_ = s.root.Remove(packNeedsFile)
		return
	}
	_, _ = s.writeFile(packNeedsFile, strings.NewReader(strings.Join(needs, "\n")+"\n"))
}
