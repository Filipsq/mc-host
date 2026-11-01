package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestNonPremiumAndWorldEnv(t *testing.T) {
	a := &agent{idle: 5 * time.Minute}
	off := false
	envOf := func(req createRequest) (string, map[string]string) {
		t.Helper()
		if err := req.validate(); err != nil {
			t.Fatalf("%+v: %v", req, err)
		}
		spec := a.containerSpec(req, imageFor(req.Edition, req.Version, req.Kind))
		return strings.Join(spec["Env"].([]string), "\n") + "\n", spec["Labels"].(map[string]string)
	}
	java := createRequest{ID: "abc12345", Name: "Ekipa", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 25570, Hostname: "ekipa.mchost.pl",
		OnlineMode: &off, Whitelist: true, Players: []string{"Steve", "Alex_2"}, Plugins: []string{"Vebnzrzj"},
		Level: "Nowy świat", Seed: "-123456789", LevelType: "flat"}
	env, labels := envOf(java)
	for _, want := range []string{
		"ONLINE_MODE=false\n",
		"MODRINTH_PROJECTS=" + authMe + ",Vebnzrzj?\n", // the login plugin is required, the owner's optional
		"WHITELIST=Steve:offline,Alex_2:offline\n",
		"LEVEL=Nowy świat\n", "SEED=-123456789\n", "LEVEL_TYPE=flat\n",
	} {
		if !strings.Contains(env, want) {
			t.Errorf("env missing %q:\n%s", want, env)
		}
	}
	if labels["mchost.level"] != "Nowy świat" {
		t.Errorf("level label = %q", labels["mchost.level"])
	}

	sky := java
	sky.Kind, sky.Plugins, sky.Whitelist, sky.Level, sky.Seed, sky.LevelType = "skyblock", nil, false, "", "", "large_biomes"
	env, labels = envOf(sky)
	if !strings.Contains(env, "MODRINTH_PROJECTS=bentobox,bskyblock,"+authMe+"\n") || !strings.Contains(env, "LEVEL_TYPE=largebiomes\n") {
		t.Errorf("skyblock non-premium env:\n%s", env)
	}
	if strings.Contains(env, "\nLEVEL=") || strings.Contains(env, "\nSEED=") || labels["mchost.level"] != "world" {
		t.Errorf("no level set means the image's default world:\n%s %v", env, labels)
	}

	premium := java
	premium.OnlineMode = nil
	env, _ = envOf(premium)
	if !strings.Contains(env, "ONLINE_MODE=true\n") || strings.Contains(env, authMe) || strings.Contains(env, ":offline") {
		t.Errorf("premium servers stay online without the login plugin:\n%s", env)
	}

	// A mod pack gets its login mod from loginScript, by the pack's loader and version.
	pack := createRequest{ID: "abc12345", Name: "Paczka", Edition: "JAVA", MemoryMb: 6144, CPUs: 2, Port: 25570, Hostname: "paczka.mchost.pl",
		OnlineMode: &off, Kind: "modpack", Modpack: "better-mc-fabric-bmc2", ModpackVersion: "BpTjgzL8", ModpackLoader: "fabric", Version: "1.20.1"}
	env, _ = envOf(pack)
	for _, want := range []string{"ONLINE_MODE=false\n", "MCHOST_LOGIN=" + easyAuth + "\n", "MCHOST_LOGIN_LOADER=fabric\n", "MCHOST_LOGIN_VERSION=1.20.1\n", "PRE_START_SCRIPT=" + packScriptPath + "\n"} {
		if !strings.Contains(env, want) {
			t.Errorf("non-premium pack env missing %q:\n%s", want, env)
		}
	}
	cfPack := pack
	cfPack.ModpackSource, cfPack.Modpack, cfPack.ModpackVersion, cfPack.ModpackLoader, cfPack.Version = "curseforge", "some-pack", "1234567", "neoforge", "1.21.1"
	env, _ = envOf(cfPack)
	if !strings.Contains(env, "MCHOST_LOGIN="+easyLogin+"\n") || !strings.Contains(env, "PRE_START_SCRIPT="+loginScriptPath+"\n") {
		t.Errorf("non-premium CurseForge pack env:\n%s", env)
	}
	pack.OnlineMode = nil
	if env, _ = envOf(pack); strings.Contains(env, "MCHOST_LOGIN") || !strings.Contains(env, "ONLINE_MODE=true\n") {
		t.Errorf("a premium pack has no login mod:\n%s", env)
	}

	bedrock := createRequest{ID: "abc12345", Name: "Wyspa", Edition: "BEDROCK", MemoryMb: 2048, CPUs: 1, Port: 25570, Level: "Moja wyspa", Seed: "42", LevelType: "flat"}
	env, labels = envOf(bedrock)
	for _, want := range []string{"LEVEL_NAME=Moja wyspa\n", "LEVEL_SEED=42\n", "LEVEL_TYPE=FLAT\n"} {
		if !strings.Contains(env, want) {
			t.Errorf("bedrock env missing %q:\n%s", want, env)
		}
	}
	if labels["mchost.level"] != "Moja wyspa" {
		t.Errorf("bedrock level label = %q", labels["mchost.level"])
	}
	bedrock.Level = ""
	if _, labels = envOf(bedrock); labels["mchost.level"] != "Bedrock level" {
		t.Errorf("bedrock default level label = %q", labels["mchost.level"])
	}

	for _, bad := range []createRequest{
		{Kind: "fabric", Version: "LATEST", OnlineMode: &off}, // no login mod made for it yet
		{Kind: "forge", Version: "1.20.1", OnlineMode: &off},
		{Kind: "modpack", OnlineMode: &off},                                            // a pack without its loader
		{Kind: "modpack", ModpackLoader: "forge", Version: "1.20.1", OnlineMode: &off}, // nor on a version without a login mod
		{Kind: "modpack", ModpackLoader: "quilt", Version: "1.20.1", OnlineMode: &off},
		{Kind: "fabric", Version: "1.20.1", ModpackLoader: "fabric"}, // only for packs
		{Level: "../plugins"},
		{Level: ".hidden"},
		{Level: "a/b"},
		{Seed: "1\nonline-mode=false"},
		{LevelType: "debug"},
	} {
		bad.ID, bad.Name, bad.Edition, bad.MemoryMb, bad.CPUs, bad.Port, bad.Hostname = "abc12345", "X", "JAVA", 2048, 1, 25570, "x.mchost.pl"
		if bad.Kind == "modpack" {
			bad.Modpack, bad.ModpackVersion = "pack", "BpTjgzL8"
		}
		if bad.validate() == nil {
			t.Errorf("should be rejected: %+v", bad)
		}
	}
	bedrockOffline := createRequest{ID: "abc12345", Name: "X", Edition: "BEDROCK", MemoryMb: 2048, CPUs: 1, Port: 25570, OnlineMode: &off}
	if bedrockOffline.validate() == nil {
		t.Error("bedrock can't be non-premium")
	}
	bedrockAmplified := createRequest{ID: "abc12345", Name: "X", Edition: "BEDROCK", MemoryMb: 2048, CPUs: 1, Port: 25570, LevelType: "amplified"}
	if bedrockAmplified.validate() == nil {
		t.Error("bedrock has no amplified worlds")
	}
}

// writeFiles makes files (with their folders) under dir.
func writeFiles(t *testing.T, dir string, files map[string]string) {
	t.Helper()
	for name, body := range files {
		p := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func zipNames(t *testing.T, body []byte) []string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	sort.Strings(names)
	return names
}

func TestWorldsJava(t *testing.T) {
	h, _, data := filesAgent(t)
	writeFiles(t, data, map[string]string{
		"world/level.dat":                        "a",
		"world/region/r.0.0.mca":                 "region",
		"world/session.lock":                     "lock",
		"world_nether/level.dat":                 "n",
		"world_nether/DIM-1/region/r.0.0.mca":    "nether",
		"world_the_end/level.dat":                "e",
		"world_the_end/DIM1/region/r.0.0.mca":    "end",
		"Stary świat/level.dat":                  "old",
		"Stary świat/DIM-1/region/r.0.0.mca":     "old nether",
		"plugins/Essentials/config.yml":          "not a world",
		"logs/latest.log":                        "log",
		"bskyblock_world/level.dat":              "island",
		"bskyblock_world_nether/level.dat":       "island nether",
		"bskyblock_world_nether/DIM-1/r.0.0.mca": "x",
		// Saved by Minecraft 26.1+: the seed and dimensions are no longer in level.dat.
		"bskyblock_world/data/minecraft/world_gen_settings.dat": "gen",
		// 26.1+ players with no level.dat left still stop 1.21.11.
		"world_26/players/data/x.dat": "p",
	})

	rec := call(t, h, "GET", "/servers/abc12345/worlds", nil)
	if rec.Code != 200 {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	var list struct {
		Worlds []worldInfo `json:"worlds"`
		Active string      `json:"active"`
	}
	json.Unmarshal(rec.Body.Bytes(), &list)
	var names []string
	for _, w := range list.Worlds {
		names = append(names, w.Name)
	}
	if got := strings.Join(names, ","); got != "bskyblock_world,Stary świat,world,world_26" {
		t.Fatalf("worlds = %q (Paper's nether and end belong to their world)", got)
	}
	if list.Active != "world" {
		t.Errorf("active = %q", list.Active)
	}
	if !list.Worlds[0].NewGame || list.Worlds[1].NewGame || list.Worlds[2].NewGame || !list.Worlds[3].NewGame {
		t.Errorf("only bskyblock_world and world_26 were saved by Minecraft 26+: %+v", list.Worlds)
	}
	if w := list.Worlds[2]; w.Size != int64(len("a")+len("region")+len("lock")+len("n")+len("nether")+len("e")+len("end")) {
		t.Errorf("world size = %d", w.Size)
	}

	// The download is one folder a single-player game opens, nether and end inside.
	rec = call(t, h, "GET", "/servers/abc12345/worlds/world/download", nil)
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/zip" {
		t.Fatalf("download: %d %s", rec.Code, rec.Header())
	}
	if got := strings.Join(zipNames(t, rec.Body.Bytes()), " "); got != "world/DIM-1/region/r.0.0.mca world/DIM1/region/r.0.0.mca world/level.dat world/region/r.0.0.mca" {
		t.Fatalf("zip = %q", got)
	}
	rec = call(t, h, "GET", "/servers/abc12345/worlds/"+url.PathEscape("Stary świat")+"/download", nil)
	if got := strings.Join(zipNames(t, rec.Body.Bytes()), " "); got != "Stary świat/DIM-1/region/r.0.0.mca Stary świat/level.dat" {
		t.Fatalf("vanilla-layout zip = %q", got)
	}
	for _, bad := range []string{"plugins", "nothing", url.PathEscape("../world"), ".hidden"} {
		if rec := call(t, h, "GET", "/servers/abc12345/worlds/"+bad+"/download", nil); rec.Code == 200 {
			t.Errorf("download %s: %d", bad, rec.Code)
		}
	}

	// The server's own world can't be deleted; another one goes with its nether and end.
	if rec := call(t, h, "DELETE", "/servers/abc12345/worlds/world", nil); rec.Code != 409 || !strings.Contains(rec.Body.String(), "active") {
		t.Fatalf("delete active: %d %s", rec.Code, rec.Body)
	}
	if rec := call(t, h, "DELETE", "/servers/abc12345/worlds/bskyblock_world", nil); rec.Code != 200 {
		t.Fatalf("delete: %d %s", rec.Code, rec.Body)
	}
	for _, gone := range []string{"bskyblock_world", "bskyblock_world_nether"} {
		if _, err := os.Stat(filepath.Join(data, gone)); !os.IsNotExist(err) {
			t.Errorf("%s still there", gone)
		}
	}
	if rec := call(t, h, "DELETE", "/servers/abc12345/worlds/plugins", nil); rec.Code != 404 {
		t.Errorf("plugins isn't a world: %d", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(data, "plugins")); err != nil {
		t.Error("plugins must survive")
	}
}

func zipOf(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		io.WriteString(w, body)
	}
	zw.Close()
	return buf.Bytes()
}

func TestWorldImport(t *testing.T) {
	h, _, data := filesAgent(t)
	writeFiles(t, data, map[string]string{"world/level.dat": "a"})
	upload := func(body []byte) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(data, "upload.zip"), body, 0o644); err != nil {
			t.Fatal(err)
		}
	}

	// A single-player save zipped with its folder, and macOS's extras.
	upload(zipOf(t, map[string]string{
		"Moja Mapa/level.dat":              "map",
		"Moja Mapa/region/r.0.0.mca":       "r",
		"Moja Mapa/DIM-1/region/r.0.0.mca": "n",
		"__MACOSX/Moja Mapa/._level.dat":   "junk",
	}))
	rec := call(t, h, "POST", "/servers/abc12345/worlds/import?path=upload.zip&name="+q("Moja Mapa"), nil)
	if rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body)
	}
	if b, _ := os.ReadFile(filepath.Join(data, "Moja Mapa", "DIM-1", "region", "r.0.0.mca")); string(b) != "n" {
		t.Fatal("world not unpacked in place")
	}
	if _, err := os.Stat(filepath.Join(data, "upload.zip")); !os.IsNotExist(err) {
		t.Error("the upload should be deleted")
	}
	if _, err := os.Stat(filepath.Join(data, "__MACOSX")); !os.IsNotExist(err) {
		t.Error("macOS extras unpacked")
	}

	// Never over an existing world or its nether.
	upload(zipOf(t, map[string]string{"level.dat": "x"}))
	if rec := call(t, h, "POST", "/servers/abc12345/worlds/import?path=upload.zip&name=world", nil); rec.Code != 409 {
		t.Fatalf("import over world: %d %s", rec.Code, rec.Body)
	}
	if b, _ := os.ReadFile(filepath.Join(data, "world", "level.dat")); string(b) != "a" {
		t.Fatal("existing world changed")
	}

	// A zip with no world in it.
	upload(zipOf(t, map[string]string{"readme.txt": "hi"}))
	if rec := call(t, h, "POST", "/servers/abc12345/worlds/import?path=upload.zip&name=nowy", nil); rec.Code != 400 || !strings.Contains(rec.Body.String(), "noWorld") {
		t.Fatalf("import without level.dat: %d %s", rec.Code, rec.Body)
	}
	if entries, _ := filepath.Glob(filepath.Join(data, ".import-*")); len(entries) != 0 {
		t.Errorf("leftovers: %v", entries)
	}

	// A world the server can't open is refused with the reason.
	for _, tc := range []struct {
		files   map[string]string
		edition string
		want    string
	}{
		{map[string]string{"Mapa/level.dat": "x", "Mapa/db/000001.ldb": "db"}, "", "bedrockMap"},
		{map[string]string{"level.dat": "x", "region/r.0.0.mcr": "old"}, "", "oldMap"},
		{map[string]string{"level.dat": "x", "region/r.0.0.mca": "java"}, "BEDROCK", "javaMap"},
	} {
		upload(zipOf(t, tc.files))
		rec := call(t, h, "POST", "/servers/abc12345/worlds/import?edition="+tc.edition+"&path=upload.zip&name=zla", nil)
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), tc.want) {
			t.Errorf("%s: %d %s", tc.want, rec.Code, rec.Body)
		}
	}

	// A Bedrock .mcworld: the world at the zip's top, into worlds/.
	upload(zipOf(t, map[string]string{"level.dat": "bedrock", "db/000001.ldb": "db", "levelname.txt": "Wyspa"}))
	rec = call(t, h, "POST", "/servers/abc12345/worlds/import?edition=BEDROCK&path=upload.zip&name=Wyspa", nil)
	if rec.Code != 200 {
		t.Fatalf("bedrock import: %d %s", rec.Code, rec.Body)
	}
	if b, _ := os.ReadFile(filepath.Join(data, "worlds", "Wyspa", "db", "000001.ldb")); string(b) != "db" {
		t.Fatal("bedrock world not in worlds/")
	}
	rec = call(t, h, "GET", "/servers/abc12345/worlds?edition=BEDROCK", nil)
	if !strings.Contains(rec.Body.String(), `"name":"Wyspa"`) || !strings.Contains(rec.Body.String(), `"active":"Bedrock level"`) {
		t.Fatalf("bedrock list: %s", rec.Body)
	}
	rec = call(t, h, "GET", "/servers/abc12345/worlds/Wyspa/download?edition=BEDROCK", nil)
	if got := strings.Join(zipNames(t, rec.Body.Bytes()), " "); got != "db/000001.ldb level.dat levelname.txt" {
		t.Fatalf("mcworld zip = %q", got)
	}
}

func TestPrepareLogin(t *testing.T) {
	_, a, data := filesAgent(t)
	a.prepareLogin(context.Background(), "abc12345", authMe)
	if b, _ := os.ReadFile(filepath.Join(data, "plugins", "AuthMe", "config.yml")); string(b) != authMeConfig {
		t.Fatalf("config = %q", b)
	}
	// The owner's own settings stay.
	os.WriteFile(filepath.Join(data, "plugins", "AuthMe", "config.yml"), []byte("mine"), 0o644)
	a.prepareLogin(context.Background(), "abc12345", authMe)
	if b, _ := os.ReadFile(filepath.Join(data, "plugins", "AuthMe", "config.yml")); string(b) != "mine" {
		t.Fatalf("config overwritten: %q", b)
	}
	// Servers made before the address settings get the new config.
	os.WriteFile(filepath.Join(data, "plugins", "AuthMe", "config.yml"), []byte(oldAuthMeConfig), 0o644)
	a.fixLogin(context.Background(), "abc12345")
	if b, _ := os.ReadFile(filepath.Join(data, "plugins", "AuthMe", "config.yml")); string(b) != authMeConfig {
		t.Fatalf("old config not replaced: %q", b)
	}
	// A config AuthMe filled in has its per-address limits turned off, nothing else.
	full := "# AuthMe\nsettings:\n  sessions:\n    # Do you want to enable sessions?\n    enabled: true\n    timeout: 10\n  restrictions:\n    allowedNicknameCharacters: '[a-zA-Z0-9_]*'\n    maxRegPerIp: 1\n    maxLoginPerIp: 0\n    unrestrictions:\n      enabled: true\n    maxJoinPerIp: 2\nSecurity:\n  tempban:\n    enableTempban: true\n    maxLoginTries: 10\n"
	want := "# AuthMe\nsettings:\n  sessions:\n    # Do you want to enable sessions?\n    enabled: false\n    timeout: 10\n  restrictions:\n    allowedNicknameCharacters: '[a-zA-Z0-9_]*'\n    maxRegPerIp: 0\n    maxLoginPerIp: 0\n    unrestrictions:\n      enabled: true\n    maxJoinPerIp: 0\nSecurity:\n  tempban:\n    enableTempban: false\n    maxLoginTries: 10\n"
	os.WriteFile(filepath.Join(data, "plugins", "AuthMe", "config.yml"), []byte(full), 0o644)
	a.fixLogin(context.Background(), "abc12345")
	if b, _ := os.ReadFile(filepath.Join(data, "plugins", "AuthMe", "config.yml")); string(b) != want {
		t.Fatalf("fixed config = %q", b)
	}
}

func TestPrepareLoginMods(t *testing.T) {
	_, a, data := filesAgent(t)
	easyAuthFile := filepath.Join(data, "config", "EasyAuth", "main.conf")
	a.prepareLogin(context.Background(), "abc12345", loginAddon("fabric", "1.21.1"))
	if b, _ := os.ReadFile(easyAuthFile); string(b) != easyAuthConfig {
		t.Fatalf("EasyAuth config = %q", b)
	}
	// EasyAuth's own full config gets its sessions turned off, nothing else.
	os.WriteFile(easyAuthFile, []byte("# How long to keep session\nsession-timeout=86400\nmax-login-tries=3\n"), 0o644)
	a.fixLogin(context.Background(), "abc12345")
	if b, _ := os.ReadFile(easyAuthFile); string(b) != "# How long to keep session\nsession-timeout= -1\nmax-login-tries=3\n" {
		t.Fatalf("fixed EasyAuth config = %q", b)
	}

	easyLoginFile := filepath.Join(data, "config", "easylogin", "config.toml")
	a.prepareLogin(context.Background(), "abc12345", loginAddon("forge", "1.21.1"))
	b, _ := os.ReadFile(easyLoginFile)
	if string(b) != easyLoginConfig {
		t.Fatalf("EasyLogin config = %q", b)
	}
	full := "[security]\nbcryptCost = 12\n# Max login attempts before lockout\nmaxAttempts = 5\nattemptWindow = 5\nlockoutDuration = 10\n"
	os.WriteFile(easyLoginFile, []byte(full), 0o644)
	a.fixLogin(context.Background(), "abc12345")
	want := "[security]\nbcryptCost = 12\n# Max login attempts before lockout\nmaxAttempts = 1000\nattemptWindow = 1\nlockoutDuration = 1\n"
	if b, _ := os.ReadFile(easyLoginFile); string(b) != want {
		t.Fatalf("fixed EasyLogin config = %q", b)
	}
	if loginAddon("forge", "1.20.1") != "" || loginAddon("modpack", "1.21.1") != "" || loginAddon("vanilla", "1.8") != authMe {
		t.Fatal("loginAddon picks the wrong addon")
	}
}
