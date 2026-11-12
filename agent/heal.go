package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// badVersionType is what the agent set on every server built from 2.11.2026
// until 3.11.2026: the image's version lookup refuses it, so a server that
// takes its Minecraft version from its plugins (Skyblock, OneBlock…) stopped
// on every start ("Invalid value for option '--allowed-version-type'").
const badVersionType = "MODRINTH_PROJECTS_DEFAULT_VERSION_TYPE=alpha+"

// healEnv rebuilds a stopped server's container whose env healedEnv puts
// right, with the same settings otherwise. Its world is in a named volume,
// which stays.
func (a *agent) healEnv(ctx context.Context, id string) {
	name := containerName(id)
	var c struct {
		Config          map[string]any
		HostConfig      map[string]any
		NetworkSettings struct{ Networks map[string]any }
		State           struct{ Running bool }
	}
	if err := a.docker.call(ctx, http.MethodGet, "/containers/"+name+"/json", nil, nil, &c); err != nil || c.State.Running || c.Config == nil {
		return
	}
	env, _ := c.Config["Env"].([]any)
	var old []string
	for _, e := range env {
		if s, ok := e.(string); ok {
			old = append(old, s)
		}
	}
	fixed, why := healedEnv(old)
	if missing := a.missingFabricMods(ctx, id, fixed); len(missing) > 0 {
		fixed = addProjects(fixed, missing)
		if why != "" {
			why += ", "
		}
		why += "with " + strings.Join(missing, ", ") + " a mod needs"
	}
	if why == "" {
		return
	}
	spec := map[string]any{}
	for k, v := range c.Config {
		if k != "Hostname" { // the old container's ID; Docker gives the new one its own
			spec[k] = v
		}
	}
	spec["Env"] = fixed
	spec["HostConfig"] = c.HostConfig
	if len(c.NetworkSettings.Networks) > 0 {
		endpoints := map[string]any{}
		for net, ep := range c.NetworkSettings.Networks {
			m, _ := ep.(map[string]any)
			keep := map[string]any{}
			for _, k := range []string{"Aliases", "IPAMConfig", "Links", "DriverOpts"} {
				if m[k] != nil {
					keep[k] = m[k]
				}
			}
			endpoints[net] = keep
		}
		spec["NetworkingConfig"] = map[string]any{"EndpointsConfig": endpoints}
	}
	if err := a.docker.RemoveContainer(ctx, name); err != nil {
		log.Printf("heal %s: %v", id, err)
		return
	}
	if err := a.docker.CreateContainer(ctx, name, spec); err != nil {
		log.Printf("heal %s: rebuilding the container failed: %v", id, err)
		return
	}
	log.Printf("heal %s: rebuilt (%s)", id, why)
}

// healedEnv is a container's env with what older agents set wrong put right,
// and why ("" when nothing needed changing):
//   - badVersionType goes: nothing on Paper, "beta" on a mod loader;
//   - a Fabric server gets Fabric API (pluginEnv). Containers built before
//     the agent added it to every Fabric server didn't have it, so a mod
//     uploaded in Files that needs it stopped every start ("requires any
//     version of fabric-api, which is missing": Disabilities, 2026-11-12).
func healedEnv(env []string) ([]string, string) {
	var why []string
	paper, fabric := false, false
	for _, s := range env {
		paper = paper || s == "TYPE=PAPER"
		fabric = fabric || s == "TYPE=FABRIC"
	}
	var fixed []string
	hasProjects, hasDeps := false, false
	for _, s := range env {
		switch {
		case s == badVersionType:
			why = append(why, "without alpha+")
			if !paper {
				fixed = append(fixed, "MODRINTH_PROJECTS_DEFAULT_VERSION_TYPE=beta")
			}
			continue
		case strings.HasPrefix(s, "MODRINTH_DOWNLOAD_DEPENDENCIES="):
			hasDeps = true
		case strings.HasPrefix(s, "MODRINTH_PROJECTS="):
			hasProjects = true
			if fabric && !hasFabricAPI(strings.TrimPrefix(s, "MODRINTH_PROJECTS=")) {
				if s == "MODRINTH_PROJECTS=" {
					s += fabricAPI + "?"
				} else {
					s += "," + fabricAPI + "?"
				}
				why = append(why, "with Fabric API")
			}
		}
		fixed = append(fixed, s)
	}
	if fabric && !hasProjects {
		fixed = append(fixed, "MODRINTH_PROJECTS="+fabricAPI+"?")
		why = append(why, "with Fabric API")
	}
	if fabric && !hasDeps && len(why) > 0 {
		fixed = append(fixed, "MODRINTH_DOWNLOAD_DEPENDENCIES=required")
	}
	return fixed, strings.Join(why, ", ")
}

// hasFabricAPI tells whether an image project list has Fabric API, pinned or not.
func hasFabricAPI(list string) bool {
	for _, p := range strings.Split(list, ",") {
		p = strings.TrimSuffix(p, "?")
		if p == fabricAPI || strings.HasPrefix(p, fabricAPI+":") || p == "fabric-api" || strings.HasPrefix(p, "fabric-api:") {
			return true
		}
	}
	return false
}

// missingFabricMods are the mods Fabric last refused to start without
// ("Mod 'ViaVersion' (viaversion) ... requires version 0.4.14 or later of
// viafabric, which is missing!", Zebatmcpl 2026-11-12: ViaVersion uploaded in
// Files without ViaFabric) that Modrinth has for this server's loader and
// version, so the image downloads them. Fabric names them by mod ID, which
// for nearly every mod is its Modrinth slug; one Modrinth doesn't have, or
// has under another name, is left out.
func (a *agent) missingFabricMods(ctx context.Context, id string, env []string) []string {
	if modrinthAPI == "" || a.docker == nil {
		return nil
	}
	fabric, version, listed := false, "", ""
	for _, e := range env {
		switch {
		case e == "TYPE=FABRIC":
			fabric = true
		case strings.HasPrefix(e, "VERSION="):
			version = strings.TrimPrefix(e, "VERSION=")
		case strings.HasPrefix(e, "MODRINTH_PROJECTS="):
			listed = strings.TrimPrefix(e, "MODRINTH_PROJECTS=")
		}
	}
	if !fabric {
		return nil
	}
	logCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	var lines []string
	_ = a.docker.Logs(logCtx, containerName(id), LogOptions{Tail: 300}, func(line string) error {
		lines = append(lines, line)
		return nil
	})
	cancel()
	ids := missingModIDs(lines)
	if len(ids) == 0 {
		return nil
	}
	have := map[string]bool{}
	for _, p := range strings.Split(listed, ",") {
		p, _, _ = strings.Cut(strings.TrimSuffix(p, "?"), ":")
		have[strings.TrimSuffix(p, "?")] = true
	}
	lookCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	l, _ := json.Marshal([]string{"fabric"})
	f := &javaFitter{ctx: lookCtx, server: id, loaders: string(l)}
	if javaRelease.MatchString(version) {
		v, _ := json.Marshal([]string{version})
		f.version = string(v)
	}
	var out []string
	for _, mod := range ids {
		if have[mod] || len(out) >= 5 {
			continue
		}
		if vs, err := f.versions(mod); err == nil && len(vs) > 0 {
			out = append(out, mod)
		} else {
			log.Printf("heal %s: %s is missing but Modrinth has no build of it here (%v)", id, mod, err)
		}
	}
	return out
}

var (
	// "[HARD_DEP_NO_CANDIDATE viaversion 5.12.3-SNAPSHOT {depends viafabric @ [>=0.4.14]}"
	fabricNoCandidate = regexp.MustCompile(`HARD_DEP_NO_CANDIDATE \S+ \S+ \{depends ([a-z0-9_.-]+) @`)
	// "requires version 0.4.14 or later of viafabric, which is missing!"
	// "requires any version of 'Fabric API' (fabric-api), which is missing!"
	fabricMissing = regexp.MustCompile(`requires .* of (?:'[^']*' \()?([a-z0-9_.-]+)\)?, which is missing`)
)

// missingModIDs reads the mods the last start lacked; one that got to
// "Done (" later lacked nothing.
func missingModIDs(lines []string) []string {
	var ids []string
	for _, line := range lines {
		if strings.Contains(line, "Done (") {
			ids = nil
			continue
		}
		for _, re := range []*regexp.Regexp{fabricNoCandidate, fabricMissing} {
			if m := re.FindStringSubmatch(line); m != nil {
				switch m[1] {
				case "minecraft", "java", "fabricloader", "fabric", "quilt_loader":
				default:
					ids = appendNew(ids, m[1])
				}
			}
		}
	}
	return ids
}

// addProjects lists more optional projects for the image to download.
func addProjects(env []string, projects []string) []string {
	out := make([]string, 0, len(env)+1)
	done := false
	for _, e := range env {
		if list, ok := strings.CutPrefix(e, "MODRINTH_PROJECTS="); ok && !done {
			for _, p := range projects {
				if list != "" {
					list += ","
				}
				list += p + "?"
			}
			e, done = "MODRINTH_PROJECTS="+list, true
		}
		out = append(out, e)
	}
	if !done {
		out = append(out, "MODRINTH_PROJECTS="+strings.Join(projects, "?,")+"?")
	}
	return out
}
