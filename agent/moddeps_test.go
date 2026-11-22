package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

func TestModsWithoutDeps(t *testing.T) {
	log := []string{"[mc-image-helper] 13:18:45.211 ERROR : Invalid parameter provided for 'modrinth' command: No matching files for VersionDependency(versionId=null, projectId=qvIfYCYJ, dependencyType=required) of project 'Spawn Animations': No files are available for the project 'Quilted Fabric API (QFAPI) / Quilt Standard Libraries (QSL)' for loader fabric and Minecraft version 1.21.8"}
	deps := unavailableDeps(log)
	if !slices.Equal(deps, []string{"qvIfYCYJ"}) {
		t.Fatalf("deps %v", deps)
	}
	if got := crashCauseFrom(log, []string{"TYPE=FABRIC"}); got != "mod needs qvIfYCYJ" {
		t.Errorf("cause %q", got)
	}
	mr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.RawQuery, "1.21.8") {
			t.Errorf("query %s", r.URL.RawQuery)
		}
		switch r.URL.Path {
		case "/v2/project/spawnanim/version":
			w.Write([]byte(`[{"id":"a2","version_type":"alpha","files":[{"url":"https://cdn/a2.jar"}]},
				{"id":"v1","version_type":"release","files":[{"url":"https://cdn/spawn.jar"}],"dependencies":[{"project_id":"qvIfYCYJ","dependency_type":"required"}]}]`))
		case "/v2/project/other/version":
			w.Write([]byte(`[{"id":"o1","version_type":"release","files":[{"url":"https://cdn/other.jar"}],"dependencies":[{"project_id":"P7dR8mSH","dependency_type":"required"}]}]`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer mr.Close()
	old := modrinthAPI
	modrinthAPI = mr.URL
	defer func() { modrinthAPI = old }()
	a := &agent{}
	env := []string{"TYPE=FABRIC", "VERSION=1.21.8", "MODRINTH_PROJECTS=spawnanim?,other?,P7dR8mSH?", betaMods}
	got, moved := a.modsWithoutDeps(context.Background(), "abc12345", env, deps)
	if !slices.Equal(moved, []string{"spawnanim"}) {
		t.Fatalf("moved %v", moved)
	}
	if got[2] != "MODRINTH_PROJECTS=other?,P7dR8mSH?" || got[4] != "MODS=https://cdn/spawn.jar" {
		t.Errorf("env %q", got)
	}
	// Run again on the healed env: nothing more to move.
	if _, moved := a.modsWithoutDeps(context.Background(), "abc12345", got, deps); len(moved) != 0 {
		t.Errorf("moved again %v", moved)
	}
}
