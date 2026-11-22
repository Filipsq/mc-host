package main

import (
	"context"
	"encoding/json"
	"log"
	"regexp"
	"slices"
	"strings"
	"time"
)

// A mod can list on Modrinth a required library that has no build for the
// server's loader and version: Spawn Animations for Fabric 1.21.8 requires
// Quilted Fabric API, which exists only for Quilt (2026-11-22, n8). The image
// then stops every start ("No matching files for VersionDependency(...,
// projectId=qvIfYCYJ, ...) of project 'Spawn Animations'"), though on Fabric
// the mod runs on Fabric API. Such a mod comes out of MODRINTH_PROJECTS (which
// resolves dependencies) and its jar goes in MODS (a plain download), so the
// server starts with it; if it really needs the library, Fabric's own check
// says so in the console.

var noDepFiles = regexp.MustCompile(`No matching files for VersionDependency\([^)]*projectId=([A-Za-z0-9]+)[^)]*\) of project '([^']*)'`)

// unavailableDeps lists the projects the last start couldn't find a build of.
func unavailableDeps(lines []string) []string {
	var ids []string
	for _, line := range lines {
		if m := noDepFiles.FindStringSubmatch(line); m != nil {
			ids = appendNew(ids, m[1])
		}
	}
	return ids
}

// modsWithoutDeps moves the mods whose build needs one of deps from
// MODRINTH_PROJECTS to MODS, by their jar's URL. It returns the env unchanged
// when it can't tell (Modrinth unreachable, no concrete version).
func (a *agent) modsWithoutDeps(ctx context.Context, id string, env, deps []string) ([]string, []string) {
	if modrinthAPI == "" || len(deps) == 0 {
		return env, nil
	}
	loader, version, listed, beta := "", "", "", false
	for _, e := range env {
		switch {
		case strings.HasPrefix(e, "TYPE="):
			loader = strings.ToLower(strings.TrimPrefix(e, "TYPE="))
		case strings.HasPrefix(e, "VERSION="):
			version = strings.TrimPrefix(e, "VERSION=")
		case strings.HasPrefix(e, "MODRINTH_PROJECTS="):
			listed = strings.TrimPrefix(e, "MODRINTH_PROJECTS=")
		case e == betaMods || e == alphaMods:
			beta = true
		}
	}
	if _, ok := loaderTypes[loader]; !ok || !javaRelease.MatchString(version) || listed == "" {
		return env, nil
	}
	lookCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	l, _ := json.Marshal([]string{loader})
	v, _ := json.Marshal([]string{version})
	f := &javaFitter{ctx: lookCtx, server: id, loaders: string(l), version: string(v)}
	var keep, urls, moved []string
	for _, entry := range strings.Split(listed, ",") {
		project, pin, _ := strings.Cut(entry, ":")
		project = strings.TrimSuffix(project, "?")
		if project == fabricAPI || project == "" {
			keep = append(keep, entry)
			continue
		}
		build, ok := pickBuild(f, project, pin, beta)
		file, hasFile := build.file()
		if !ok || !hasFile || !strings.HasPrefix(file.URL, "https://") || !needsAny(build, deps) {
			keep = append(keep, entry)
			continue
		}
		urls = append(urls, file.URL)
		moved = append(moved, project)
	}
	if len(moved) == 0 {
		return env, nil
	}
	out := make([]string, 0, len(env)+1)
	hasMods := false
	for _, e := range env {
		switch {
		case strings.HasPrefix(e, "MODRINTH_PROJECTS="):
			e = "MODRINTH_PROJECTS=" + strings.Join(keep, ",")
		case strings.HasPrefix(e, "MODS="):
			hasMods = true
			for _, u := range urls {
				if !slices.Contains(strings.Split(strings.TrimPrefix(e, "MODS="), ","), u) {
					if e == "MODS=" {
						e += u
					} else {
						e += "," + u
					}
				}
			}
		}
		out = append(out, e)
	}
	if !hasMods {
		out = append(out, "MODS="+strings.Join(urls, ","))
	}
	log.Printf("heal %s: %s installed without Modrinth's dependency check (%s has no build here)", id, strings.Join(moved, ", "), strings.Join(deps, ", "))
	return out, moved
}

// pickBuild is the build the image would take: the pinned one, or the newest release (or beta).
func pickBuild(f *javaFitter, project, pin string, beta bool) (mrVersion, bool) {
	builds, err := f.versions(project)
	if err != nil {
		return mrVersion{}, false
	}
	for _, b := range builds {
		if pin != "" {
			if b.ID == pin || b.Number == pin {
				return b, true
			}
			continue
		}
		if b.VersionType == "release" || (beta && b.VersionType == "beta") {
			return b, true
		}
	}
	return mrVersion{}, false
}

func needsAny(b mrVersion, deps []string) bool {
	for _, d := range b.Dependencies {
		if d.DependencyType == "required" && slices.Contains(deps, d.ProjectID) {
			return true
		}
	}
	return false
}
