package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestHealEnvRebuildsAContainerWithTheBadVersionType(t *testing.T) {
	for _, tc := range []struct {
		typ, want string
	}{{"TYPE=PAPER", ""}, {"TYPE=FORGE", "MODRINTH_PROJECTS_DEFAULT_VERSION_TYPE=beta"}} {
		sock := filepath.Join(t.TempDir(), "docker.sock")
		ln, err := net.Listen("unix", sock)
		if err != nil {
			t.Fatal(err)
		}
		var removed bool
		var created map[string]any
		fake := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case r.Method == http.MethodGet && r.URL.Path == "/containers/mc-abc12345/json":
				writeJSON(w, 200, map[string]any{
					"Config":          map[string]any{"Hostname": "old", "Image": "itzg/minecraft-server", "Env": []string{tc.typ, badVersionType, "EULA=TRUE"}},
					"HostConfig":      map[string]any{"Memory": 1},
					"NetworkSettings": map[string]any{"Networks": map[string]any{"bridge": map[string]any{"IPAddress": "172.17.0.2"}}},
					"State":           map[string]any{"Running": false},
				})
			case r.Method == http.MethodDelete:
				removed = true
				w.WriteHeader(204)
			case r.Method == http.MethodPost && r.URL.Path == "/containers/create":
				json.NewDecoder(r.Body).Decode(&created)
				writeJSON(w, 201, map[string]string{"Id": "new"})
			default:
				writeError(w, 404, "not found")
			}
		})}
		go fake.Serve(ln)
		a := &agent{docker: NewDocker(sock)}
		a.healEnv(context.Background(), "abc12345")
		fake.Close()
		if !removed || created == nil {
			t.Fatalf("%s: removed=%v created=%v", tc.typ, removed, created)
		}
		env, _ := json.Marshal(created["Env"])
		want := `["` + tc.typ + `","EULA=TRUE"]`
		if tc.want != "" {
			want = `["` + tc.typ + `","` + tc.want + `","EULA=TRUE"]`
		}
		if string(env) != want || created["Hostname"] != nil || created["HostConfig"] == nil || created["NetworkingConfig"] == nil {
			t.Fatalf("%s: created %v", tc.typ, created)
		}
	}
}

func TestHealedEnvGivesFabricServersFabricAPI(t *testing.T) {
	for _, tc := range []struct {
		env  []string
		want string
	}{
		// Built before every Fabric server got it, with mods only in Files.
		{[]string{"TYPE=FABRIC", "MODRINTH_PROJECTS=", "MODRINTH_DOWNLOAD_DEPENDENCIES=required"}, "TYPE=FABRIC MODRINTH_PROJECTS=P7dR8mSH? MODRINTH_DOWNLOAD_DEPENDENCIES=required"},
		{[]string{"TYPE=FABRIC", "MODRINTH_PROJECTS=AANobbMI?"}, "TYPE=FABRIC MODRINTH_PROJECTS=AANobbMI?,P7dR8mSH? MODRINTH_DOWNLOAD_DEPENDENCIES=required"},
		{[]string{"TYPE=FABRIC"}, "TYPE=FABRIC MODRINTH_PROJECTS=P7dR8mSH? MODRINTH_DOWNLOAD_DEPENDENCIES=required"},
		// Already there (pinned by javafit too): left alone.
		{[]string{"TYPE=FABRIC", "MODRINTH_PROJECTS=P7dR8mSH:abc?"}, ""},
		{[]string{"TYPE=FABRIC", "MODRINTH_PROJECTS=AANobbMI?,P7dR8mSH?"}, ""},
		// Not Fabric: left alone.
		{[]string{"TYPE=FORGE", "MODRINTH_PROJECTS="}, ""},
		{[]string{"TYPE=MODRINTH", "MODRINTH_MODPACK=x"}, ""},
	} {
		got, why := healedEnv(tc.env)
		if tc.want == "" {
			if why != "" {
				t.Errorf("%v: changed to %v (%s)", tc.env, got, why)
			}
			continue
		}
		if strings.Join(got, " ") != tc.want || why == "" {
			t.Errorf("%v: got %v (%q), want %s", tc.env, got, why, tc.want)
		}
	}
}

func TestMissingModIDsReadsFabricsMissingMods(t *testing.T) {
	lines := []string{
		"[17:27:11] ain/INFO]: Immediate reason: [HARD_DEP_NO_CANDIDATE viaversion 5.12.3-SNAPSHOT {depends viafabric @ [>=0.4.14]}, ROOT_FORCELOAD_SINGLE viaversion 5.12.3-SNAPSHOT]",
		"\t - Mod 'ViaVersion' (viaversion) 5.12.3-SNAPSHOT requires version 0.4.14 or later of viafabric, which is missing!",
		"\t - Mod 'X' (x) 1.0 requires any version of 'Cloth Config API' (cloth-config), which is missing!",
		"\t - Mod 'Y' (y) 1.0 requires version 1.21.9 of 'Minecraft' (minecraft), but only the wrong version is present: 1.21.11!",
	}
	if got := strings.Join(missingModIDs(lines), ","); got != "viafabric,cloth-config" {
		t.Fatalf("got %q", got)
	}
	if got := missingModIDs(append(lines, "[17:30:00] [Server thread/INFO]: Done (5.0s)!")); len(got) != 0 {
		t.Fatalf("a later start was fine, got %v", got)
	}
}

func TestMissingFabricModsAddsWhatModrinthHas(t *testing.T) {
	mr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v2/project/viafabric/version" && strings.Contains(r.URL.Query().Get("game_versions"), "1.21.4") {
			w.Write([]byte(`[{"id":"a","files":[]}]`))
			return
		}
		w.WriteHeader(404)
	}))
	defer mr.Close()
	old := modrinthAPI
	modrinthAPI = mr.URL
	defer func() { modrinthAPI = old }()
	a, _ := paperConfigAgent(t, "[HARD_DEP_NO_CANDIDATE viaversion 5.12.3-SNAPSHOT {depends viafabric @ [>=0.4.14]}]\n"+
		"\t - Mod 'X' (x) 1.0 requires any version of nosuchmod, which is missing!\n")
	got := a.missingFabricMods(context.Background(), "abc12345", []string{"TYPE=FABRIC", "VERSION=1.21.4", "MODRINTH_PROJECTS=P7dR8mSH?"})
	if strings.Join(got, ",") != "viafabric" {
		t.Fatalf("got %v", got)
	}
	env := addProjects([]string{"TYPE=FABRIC", "MODRINTH_PROJECTS=P7dR8mSH?"}, got)
	if env[1] != "MODRINTH_PROJECTS=P7dR8mSH?,viafabric?" {
		t.Fatalf("env %v", env)
	}
	if got := a.missingFabricMods(context.Background(), "abc12345", []string{"TYPE=FABRIC", "VERSION=1.21.4", "MODRINTH_PROJECTS=viafabric?"}); len(got) != 0 {
		t.Fatalf("already listed, got %v", got)
	}
}
