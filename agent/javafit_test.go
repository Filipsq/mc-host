package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestMain(m *testing.M) {
	// Tests never ask the real Modrinth; the ones about it point modrinthAPI at a stand-in.
	modrinthAPI = ""
	os.Exit(m.Run())
}

// jarWith makes a jar whose one class says it's built for that class file version.
func jarWith(t *testing.T, major int) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, v := range map[string]int{"com/x/Main.class": major, "META-INF/versions/25/com/x/Main.class": 69} {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		f.Write([]byte{0xCA, 0xFE, 0xBA, 0xBE, 0, 0, byte(v >> 8), byte(v)})
	}
	f, _ := w.Create("plugin.yml")
	f.Write([]byte("name: X\n"))
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestFitPluginEnvPinsBuildsForTheServersJava(t *testing.T) {
	jars := map[string]int{"we746": 69, "we736": 65, "wg7013": 65, "ok1": 65}
	type dep struct {
		ProjectID      string `json:"project_id"`
		VersionID      string `json:"version_id,omitempty"`
		DependencyType string `json:"dependency_type"`
	}
	type ver struct {
		ID           string           `json:"id"`
		Number       string           `json:"version_number"`
		VersionType  string           `json:"version_type"`
		Files        []map[string]any `json:"files"`
		Dependencies []dep            `json:"dependencies"`
	}
	var srv *httptest.Server
	file := func(id string) []map[string]any {
		return []map[string]any{{"url": srv.URL + "/jar/" + id, "primary": true, "size": 100, "hashes": map[string]string{"sha1": "test-" + id}}}
	}
	asked := map[string]string{}
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id, ok := strings.CutPrefix(r.URL.Path, "/jar/"); ok {
			w.Write(jarWith(t, jars[id]))
			return
		}
		project := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v2/project/"), "/version")
		asked[project] = r.URL.Query().Get("loaders") + " " + r.URL.Query().Get("game_versions")
		var list []ver
		switch project {
		case "worldedit":
			list = []ver{{ID: "WE746aaa", Number: "7.4.6", VersionType: "release", Files: file("we746")}, {ID: "WE736aaa", Number: "7.3.6", VersionType: "release", Files: file("we736")}}
		case "worldguard":
			list = []ver{{ID: "WG7013aa", Number: "7.0.13", VersionType: "release", Files: file("wg7013"), Dependencies: []dep{{ProjectID: "worldedit", DependencyType: "required"}}}}
		case "okplugin":
			list = []ver{{ID: "OK1aaaaa", Number: "1", VersionType: "release", Files: file("ok1")}}
		default:
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(list)
	}))
	defer srv.Close()
	modrinthAPI = srv.URL
	defer func() { modrinthAPI = "" }()

	envFor := func(req createRequest, image string) string {
		return strings.Join(fitPluginEnv(&req, image, pluginEnv(req.Kind, req.Version, req.Plugins, false, false)), "\n")
	}
	req := createRequest{ID: "tymbarki", Edition: "JAVA", Kind: "vanilla", Version: "1.21.4", Plugins: []string{"worldguard", "okplugin"}}

	// WorldGuard is fine, but the WorldEdit it needs is made for Java 25: the 7.3 build is listed for it.
	env := envFor(req, "itzg/minecraft-server:java21")
	if !strings.Contains(env, "MODRINTH_PROJECTS=worldguard?,okplugin?,worldedit?:WE736aaa\n") {
		t.Errorf("WorldEdit not pinned to a Java 21 build:\n%s", env)
	}
	if asked["worldguard"] != `["paper","spigot"] ["1.21.4"]` {
		t.Errorf("asked Modrinth for %q", asked["worldguard"])
	}

	// Listed by the owner: pinned in its place.
	req.Plugins = []string{"worldedit"}
	if env := envFor(req, "itzg/minecraft-server:java21"); !strings.Contains(env, "MODRINTH_PROJECTS=worldedit?:WE736aaa\n") {
		t.Errorf("listed WorldEdit not pinned:\n%s", env)
	}

	// Java 25 runs the newest build; the newest Minecraft isn't checked at all.
	if env := envFor(req, "itzg/minecraft-server:java25"); !strings.Contains(env, "MODRINTH_PROJECTS=worldedit?\n") {
		t.Errorf("pinned on Java 25:\n%s", env)
	}
	req.Version = "LATEST"
	if env := envFor(req, "itzg/minecraft-server:java21"); !strings.Contains(env, "MODRINTH_PROJECTS=worldedit?\n") {
		t.Errorf("pinned on LATEST:\n%s", env)
	}
}

func TestJarClassVersionSkipsMultiReleaseCopies(t *testing.T) {
	if c, err := jarClassVersion(jarWith(t, 65)); err != nil || c != 65 {
		t.Errorf("got %d, %v; want 65", c, err)
	}
	if _, err := jarClassVersion([]byte("not a jar")); err == nil {
		t.Error("no error for a broken jar")
	}
}
