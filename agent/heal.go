package main

import (
	"context"
	"log"
	"net/http"
	"strings"
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
