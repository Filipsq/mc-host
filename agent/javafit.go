package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// The image picks a plugin's or mod's newest build for the server's Minecraft
// version, but Modrinth doesn't say which Java a build needs. Some authors list
// old Minecraft versions on builds made for Java 25 (WorldEdit 7.4 lists
// 1.21.4), so a 1.21.x server, which runs on Java 21, got a jar it can't load
// ("class file version 69.0", Tymbarki 2026-11-08), and WorldGuard, which
// needs WorldEdit, broke with it. Before the container is made the agent looks
// inside each build the image would pick, and when its classes are too new for
// the image's Java, pins the newest build that loads ("<id>?:<version id>").
// A required dependency whose newest build is too new is added the same way:
// the image lets a listed project win over a dependency.

var (
	modrinthAPI   = "https://api.modrinth.com"
	javaFitClient = &http.Client{Timeout: 60 * time.Second}
	// Class file version a jar was built for, by its sha1 (or URL), so a build
	// is downloaded to look at only once.
	classVersions sync.Map
)

const (
	javaFitBudget     = 45 * time.Second
	javaFitCandidates = 10       // older builds tried per project
	javaFitJarMax     = 96 << 20 // bigger jars are left alone
	javaFitClasses    = 400      // class files read per jar
)

// maxClassVersion is the newest class file version the image's Java runs
// (Java N reads up to N+44), or 0 when there's nothing to check.
func maxClassVersion(image string) int {
	switch image {
	case "itzg/minecraft-server:java8":
		return 52
	case "itzg/minecraft-server:java17":
		return 61
	case "itzg/minecraft-server:java21":
		return 65
	}
	return 0
}

type mrFile struct {
	URL     string            `json:"url"`
	Primary bool              `json:"primary"`
	Size    int64             `json:"size"`
	Hashes  map[string]string `json:"hashes"`
}

type mrVersion struct {
	ID           string   `json:"id"`
	Number       string   `json:"version_number"`
	VersionType  string   `json:"version_type"`
	Files        []mrFile `json:"files"`
	Dependencies []struct {
		ProjectID      string `json:"project_id"`
		VersionID      string `json:"version_id"`
		DependencyType string `json:"dependency_type"`
	} `json:"dependencies"`
}

// file is the one the image downloads: the only file, or the primary one, or the first.
func (v mrVersion) file() (mrFile, bool) {
	if len(v.Files) == 0 {
		return mrFile{}, false
	}
	for _, f := range v.Files {
		if len(v.Files) > 1 && f.Primary {
			return f, true
		}
	}
	return v.Files[0], true
}

type javaFitter struct {
	ctx      context.Context
	server   string
	loaders  string // JSON list, as Modrinth takes it
	version  string // JSON list
	types    map[string]bool
	maxClass int
}

// fitPluginEnv pins, in pluginEnv's MODRINTH_PROJECTS, builds that load on the
// server's Java. It changes nothing when there's nothing to check or Modrinth
// doesn't answer in time.
func fitPluginEnv(req *createRequest, image string, env []string) []string {
	maxClass := maxClassVersion(image)
	if modrinthAPI == "" {
		return env
	}
	if maxClass == 0 || !javaRelease.MatchString(req.Version) {
		return env
	}
	loaders, types := []string{"paper", "spigot"}, map[string]bool{"release": true}
	if loaderTypes[req.Kind] != "" {
		// Mod loaders take betas too (pluginEnv).
		loaders, types = []string{req.Kind}, map[string]bool{"release": true, "beta": true}
		if req.Kind == "neoforge" {
			loaders = append(loaders, "forge")
		}
	} else if !paperKinds[req.Kind] {
		return env
	}
	ctx, cancel := context.WithTimeout(context.Background(), javaFitBudget)
	defer cancel()
	l, _ := json.Marshal(loaders)
	v, _ := json.Marshal([]string{req.Version})
	f := &javaFitter{ctx: ctx, server: req.ID, loaders: string(l), version: string(v), types: types, maxClass: maxClass}
	out := make([]string, len(env))
	for i, e := range env {
		if list, ok := strings.CutPrefix(e, "MODRINTH_PROJECTS="); ok && list != "" {
			e = "MODRINTH_PROJECTS=" + strings.Join(f.fit(strings.Split(list, ",")), ",")
		}
		out[i] = e
	}
	return out
}

// fit returns the projects with pins where the build the image would take needs a newer Java.
func (f *javaFitter) fit(projects []string) []string {
	out := append([]string(nil), projects...)
	listed := map[string]bool{}
	for _, p := range projects {
		listed[strings.TrimSuffix(strings.SplitN(p, ":", 2)[0], "?")] = true
	}
	var deps []string
	for i, p := range projects {
		if strings.Contains(p, ":") {
			continue // already pinned
		}
		id, optional := strings.CutSuffix(p, "?")
		chosen, pin := f.pick(id)
		if chosen == nil {
			continue
		}
		if pin {
			mark := ""
			if optional {
				mark = "?"
			}
			out[i] = id + mark + ":" + chosen.ID
		}
		deps = append(deps, f.requiredDeps(chosen, listed)...)
	}
	// Required dependencies the image would add itself, a few levels deep.
	for depth := 0; depth < 3 && len(deps) > 0; depth++ {
		var next []string
		for _, id := range deps {
			if listed[id] {
				continue
			}
			listed[id] = true
			chosen, pin := f.pick(id)
			if chosen == nil {
				continue
			}
			if pin {
				out = append(out, id+"?:"+chosen.ID)
			}
			next = append(next, f.requiredDeps(chosen, listed)...)
		}
		deps = next
	}
	return out
}

func (f *javaFitter) requiredDeps(v *mrVersion, listed map[string]bool) []string {
	var ids []string
	for _, d := range v.Dependencies {
		// One the dependent pins to a version is left to it.
		if d.DependencyType == "required" && d.ProjectID != "" && d.VersionID == "" && !listed[d.ProjectID] {
			ids = append(ids, d.ProjectID)
		}
	}
	return ids
}

// pick is the build to install: the one the image would take (pin false) when it
// loads on the server's Java, else the newest older one that does (pin true).
// Nil when Modrinth doesn't answer or the project has no build for the version.
func (f *javaFitter) pick(project string) (*mrVersion, bool) {
	versions, err := f.versions(project)
	if err != nil {
		if f.ctx.Err() == nil {
			log.Printf("javafit %s: %s: %v", f.server, project, err)
		}
		return nil, false
	}
	var candidates []mrVersion
	for _, v := range versions {
		if f.types[v.VersionType] {
			candidates = append(candidates, v)
		}
	}
	if len(candidates) == 0 {
		return nil, false
	}
	newest := &candidates[0]
	if c := f.classVersion(*newest); c == 0 || c <= f.maxClass {
		return newest, false
	}
	for i := 1; i < len(candidates) && i <= javaFitCandidates; i++ {
		c := f.classVersion(candidates[i])
		if c > 0 && c <= f.maxClass {
			log.Printf("javafit %s: %s %s needs Java %d, pinned %s", f.server, project, newest.Number, f.classVersion(*newest)-44, candidates[i].Number)
			return &candidates[i], true
		}
		if f.ctx.Err() != nil {
			break
		}
	}
	log.Printf("javafit %s: %s has no build for Java %d", f.server, project, f.maxClass-44)
	return newest, false
}

func (f *javaFitter) versions(project string) ([]mrVersion, error) {
	q := url.Values{"loaders": {f.loaders}, "game_versions": {f.version}, "include_changelog": {"false"}}
	req, err := http.NewRequestWithContext(f.ctx, http.MethodGet, modrinthAPI+"/v2/project/"+url.PathEscape(project)+"/version?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Filipsq/mc-host (mchosting.pl)")
	res, err := javaFitClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("modrinth answered %d", res.StatusCode)
	}
	var versions []mrVersion
	err = json.NewDecoder(io.LimitReader(res.Body, 16<<20)).Decode(&versions)
	return versions, err
}

// classVersion is the newest class file version in the build's jar, 0 if unknown.
func (f *javaFitter) classVersion(v mrVersion) int {
	file, ok := v.file()
	if !ok || file.URL == "" || file.Size > javaFitJarMax {
		return 0
	}
	key := file.Hashes["sha1"]
	if key == "" {
		key = file.URL
	}
	if c, ok := classVersions.Load(key); ok {
		return c.(int)
	}
	c, err := f.readClassVersion(file.URL)
	if err != nil {
		if f.ctx.Err() == nil {
			log.Printf("javafit %s: %s: %v", f.server, file.URL, err)
		}
		return 0
	}
	classVersions.Store(key, c)
	return c
}

func (f *javaFitter) readClassVersion(u string) (int, error) {
	req, err := http.NewRequestWithContext(f.ctx, http.MethodGet, u, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", "Filipsq/mc-host (mchosting.pl)")
	res, err := javaFitClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("download answered %d", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, javaFitJarMax+1))
	if err != nil {
		return 0, err
	}
	if len(data) > javaFitJarMax {
		return 0, nil
	}
	return jarClassVersion(data)
}

// jarClassVersion reads the class file version of the jar's classes and returns
// the newest. Multi-release copies under META-INF are skipped: the server's
// Java only loads the ones it can.
func jarClassVersion(data []byte) (int, error) {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return 0, err
	}
	newest, read := 0, 0
	for _, file := range r.File {
		if !strings.HasSuffix(file.Name, ".class") || strings.HasPrefix(file.Name, "META-INF/") {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			continue
		}
		head := make([]byte, 8)
		_, err = io.ReadFull(rc, head)
		rc.Close()
		if err != nil || !bytes.Equal(head[:4], []byte{0xCA, 0xFE, 0xBA, 0xBE}) {
			continue
		}
		if c := int(head[6])<<8 | int(head[7]); c > newest {
			newest = c
		}
		if read++; read >= javaFitClasses {
			break
		}
	}
	return newest, nil
}
