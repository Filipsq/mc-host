package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
)

// badVersionType is what the agent set on every server built from 2.11.2026
// until 3.11.2026: the image's version lookup refuses it, so a server that
// takes its Minecraft version from its plugins (Skyblock, OneBlock…) stopped
// on every start ("Invalid value for option '--allowed-version-type'").
const badVersionType = "MODRINTH_PROJECTS_DEFAULT_VERSION_TYPE=alpha+"

// betaMods is what a mod loader gets (pluginEnv); alphaMods lets the image take
// alpha builds too, for a server whose last start stopped because a mod needs
// one that only ever came out as alphas: "FNaF Mod Showbiz Demo" needs Showbiz
// (wJ32u9Oq), all alphas, and the image stopped every start with
// NoApplicableVersionsException (2026-11-16). Only that server: with alpha
// allowed the image takes a mod's newest alpha even when a release exists.
const (
	betaMods  = "MODRINTH_PROJECTS_DEFAULT_VERSION_TYPE=beta"
	alphaMods = "MODRINTH_PROJECTS_DEFAULT_VERSION_TYPE=alpha"
)

// lastStartNeededAlpha tells whether the last start stopped on a mod with only alpha builds.
func (a *agent) lastStartNeededAlpha(ctx context.Context, id string) bool {
	if a.docker == nil {
		return false
	}
	logCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	found := false
	_ = a.docker.Logs(logCtx, containerName(id), LogOptions{Tail: 300}, func(line string) error {
		found = found || needsAlpha(line)
		return nil
	})
	return found
}

// needsAlpha tells whether a log line is the image refusing a mod (or a mod's
// dependency) whose every build is an alpha, while it looked for betas or better.
func needsAlpha(line string) bool {
	if !strings.Contains(line, "NoApplicableVersionsException(") {
		return false
	}
	list, pref, ok := strings.Cut(line, "], versionType=VersionTypePref(versionType=")
	if !ok || strings.HasPrefix(pref, "alpha") {
		return false
	}
	_, list, ok = strings.Cut(list, "versions=[")
	if !ok {
		return false
	}
	types := versionTypeField.FindAllStringSubmatch(list, -1)
	if len(types) == 0 {
		return false
	}
	for _, t := range types {
		if t[1] != "alpha" {
			return false
		}
	}
	return true
}

var versionTypeField = regexp.MustCompile(`versionType=(\w+)\)`)

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
	// Free servers built when the sleep time was different get the current one.
	for i, e := range fixed {
		want := ""
		switch {
		case strings.HasPrefix(e, "AUTOSTOP_TIMEOUT_EST="):
			want = a.autostopEst()
		case strings.HasPrefix(e, "AUTOSTOP_TIMEOUT_INIT="):
			want = a.autostopInit()
		}
		if want != "" && e != want {
			fixed[i] = want
			if !strings.Contains(why, "sleep time") {
				if why != "" {
					why += ", "
				}
				why += "sleep time " + strings.TrimPrefix(a.autostopEst(), "AUTOSTOP_TIMEOUT_EST=") + "s"
			}
		}
	}
	if missing := a.missingFabricMods(ctx, id, fixed); len(missing) > 0 {
		fixed = addProjects(fixed, missing)
		if why != "" {
			why += ", "
		}
		why += "with " + strings.Join(missing, ", ") + " a mod needs"
	}
	if i := slices.Index(fixed, betaMods); i >= 0 && a.lastStartNeededAlpha(ctx, id) {
		fixed[i] = alphaMods
		if why != "" {
			why += ", "
		}
		why += "with alpha builds, a mod needs one"
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
	if java(env) && !hasPrefix(env, "MAX_TICK_TIME=") {
		fixed = append(fixed, noWatchdog)
		why = append(why, "without the watchdog")
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

// noWatchdog turns off Minecraft's watchdog (max-tick-time), which kills the
// server when one tick takes over a minute. On our shared machines that
// happens with nobody playing: an empty Fabric 1.21.11 server on n5, its main
// thread idle and no chunk loaded, was killed with exit 1 and showed Awaria
// (2026-11-15), most likely because the machine stalled for a minute. The
// trade-off: a mod server that really hangs stays up until someone restarts
// it. Paper keeps its own watchdog (spigot.yml timeout-time).
const noWatchdog = "MAX_TICK_TIME=-1"

// java tells whether an env is a Java server's (only those get Aikar's flags).
func java(env []string) bool { return slices.Contains(env, "USE_AIKAR_FLAGS=true") }

func hasPrefix(env []string, prefix string) bool {
	for _, e := range env {
		if strings.HasPrefix(e, prefix) {
			return true
		}
	}
	return false
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
