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

// healEnv rebuilds a stopped server's container that has badVersionType, with
// the same settings otherwise: nothing on Paper, "beta" on a mod loader (what
// the agent sets now). Its world is in a named volume, which stays.
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
	found, paper := false, false
	for _, e := range env {
		s, _ := e.(string)
		found = found || s == badVersionType
		paper = paper || s == "TYPE=PAPER"
	}
	if !found {
		return
	}
	var fixed []string
	for _, e := range env {
		s, _ := e.(string)
		if s != badVersionType {
			fixed = append(fixed, s)
		} else if !paper {
			fixed = append(fixed, "MODRINTH_PROJECTS_DEFAULT_VERSION_TYPE=beta")
		}
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
	log.Printf("heal %s: rebuilt without %s", id, strings.TrimPrefix(badVersionType, "MODRINTH_PROJECTS_DEFAULT_VERSION_TYPE="))
}
