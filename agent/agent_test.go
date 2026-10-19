package main

import (
	"bytes"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func frame(stream byte, payload string) []byte {
	h := make([]byte, 8)
	h[0] = stream
	binary.BigEndian.PutUint32(h[4:], uint32(len(payload)))
	return append(h, payload...)
}

func TestDemux(t *testing.T) {
	in := append(frame(1, "hello "), frame(2, "world\n")...)
	var out bytes.Buffer
	if err := demux(bytes.NewReader(in), &out); err != nil {
		t.Fatal(err)
	}
	if out.String() != "hello world\n" {
		t.Fatalf("got %q", out.String())
	}
}

func TestContainerSpecJava(t *testing.T) {
	a := &agent{idle: 5 * time.Minute}
	spec := a.containerSpec(createRequest{ID: "abc12345", Name: "Test", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 25570, MaxPlayers: 10, Hostname: "ekipa.mchost.pl", Autostop: true}, images["JAVA"])
	host := spec["HostConfig"].(map[string]any)
	if got := host["Memory"].(int64); got != (2048+1024)*1024*1024 {
		t.Fatalf("memory limit = %d", got)
	}
	if opts := host["SecurityOpt"].([]string); len(opts) != 1 || opts[0] != "no-new-privileges:true" {
		t.Fatalf("security options = %v", opts)
	}
	if caps := host["CapDrop"].([]string); len(caps) != 1 || caps[0] != "NET_RAW" {
		t.Fatalf("dropped capabilities = %v", caps)
	}
	bindings := host["PortBindings"].(map[string]any)["25565/tcp"].([]map[string]string)
	if bindings[0]["HostPort"] != "25570" || bindings[0]["HostIp"] != "127.0.0.1" {
		t.Fatalf("java should bind only to localhost (behind the router): %v", bindings)
	}
	if logs := host["LogConfig"].(map[string]any)["Config"].(map[string]string); logs["max-size"] == "" {
		t.Fatal("container logs should be capped")
	}
	if spec["Labels"].(map[string]string)["mchost.host"] != "ekipa.mchost.pl" {
		t.Fatal("missing hostname label")
	}
	env := strings.Join(spec["Env"].([]string), " ")
	if !strings.Contains(env, "ENABLE_AUTOSTOP=TRUE") || !strings.Contains(env, "AUTOSTOP_TIMEOUT_EST=300") {
		t.Fatalf("autostop env missing: %s", env)
	}
	for _, want := range []string{"USE_AIKAR_FLAGS=true", "VIEW_DISTANCE=8", "SIMULATION_DISTANCE=6", "INIT_MEMORY=1024M", "MAX_MEMORY=2048M", "G1PeriodicGCInterval"} {
		if !strings.Contains(env, want) {
			t.Fatalf("missing %s: %s", want, env)
		}
	}
	if shares := host["CpuShares"].(int64); shares != 1024 {
		t.Fatalf("cpu shares = %d", shares)
	}
	if cpus := host["NanoCpus"].(int64); cpus != int64(burstCPUs(1)*1e9) || (runtime.NumCPU() > 1 && cpus != 2e9) {
		t.Fatalf("a 1-core server should be able to borrow a second core: %d", cpus)
	}
	if spec["Tty"].(bool) {
		t.Fatal("java containers should not use a TTY")
	}
}

func TestContainerSpecBedrock(t *testing.T) {
	spec := (&agent{idle: 5 * time.Minute}).containerSpec(createRequest{ID: "abc12345", Name: "Test", Edition: "BEDROCK", MemoryMb: 2048, CPUs: 1, Port: 25570}, images["BEDROCK"])
	host := spec["HostConfig"].(map[string]any)
	if _, ok := host["PortBindings"].(map[string]any)["19132/udp"]; !ok {
		t.Fatal("bedrock should bind 19132/udp")
	}
	if !spec["Tty"].(bool) || !spec["OpenStdin"].(bool) {
		t.Fatal("bedrock needs TTY and stdin for send-command")
	}
	if !strings.Contains(strings.Join(spec["Env"].([]string), " "), "ALLOW_LIST=false") {
		t.Fatal("bedrock must turn its allow list off, or nobody can join")
	}
}

func TestAuth(t *testing.T) {
	h := (&agent{token: "secret"}).routes()
	for _, tc := range []struct {
		path, token string
		want        int
	}{
		{"/health", "", 200},
		{"/servers/abc12345", "", 401},
		{"/servers/abc12345", "wrong", 401},
		{"/servers/BAD!", "secret", 400},
	} {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		if tc.token != "" {
			req.Header.Set("Authorization", "Bearer "+tc.token)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Errorf("%s with token %q: got %d, want %d", tc.path, tc.token, rec.Code, tc.want)
		}
	}
}

func TestCountBedrockPlayers(t *testing.T) {
	start := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	lines := []string{
		"2026-10-11T12:00:05.000000000Z [INFO] Server started.",
		"2026-10-11T12:01:00.000000000Z [INFO] Player connected: Steve, xuid: 1",
		"2026-10-11T12:02:00.000000000Z [INFO] Player connected: Alex, xuid: 2",
		"2026-10-11T12:03:00.000000000Z [INFO] Player disconnected: Steve, xuid: 1",
	}
	online, last := countBedrockPlayers(lines, start)
	if online != 1 || !last.Equal(start.Add(3*time.Minute)) {
		t.Fatalf("online=%d last=%v", online, last)
	}
	lines = append(lines, "2026-10-11T12:04:00.000000000Z [INFO] Player disconnected: Alex, xuid: 2")
	if online, _ := countBedrockPlayers(lines, start); online != 0 {
		t.Fatalf("online=%d after everyone left", online)
	}
}

func TestStopReason(t *testing.T) {
	a := &agent{stateDir: t.TempDir()}
	info := func(autostop string, code int) *ContainerInfo {
		var i ContainerInfo
		i.Config.Labels = map[string]string{"mchost.autostop": autostop}
		i.State.ExitCode = code
		return &i
	}
	if got := a.stopReason("s1", info("true", 0)); got != "sleeping" {
		t.Errorf("free server that exited cleanly: %s", got)
	}
	if got := a.stopReason("s1", info("true", 1)); got != "crashed" {
		t.Errorf("non-zero exit: %s", got)
	}
	if got := a.stopReason("s1", info("false", 0)); got != "stopped" {
		t.Errorf("paid server exited cleanly: %s", got)
	}
	a.setMarker("s1", "stopped")
	if got := a.stopReason("s1", info("true", 143)); got != "stopped" {
		t.Errorf("owner stop should win: %s", got)
	}
	a.clearMarkers("s1")
	a.setMarker("s1", "sleeping")
	if got := a.stopReason("s1", info("true", 143)); got != "sleeping" {
		t.Errorf("bedrock idle stop: %s", got)
	}
}

func TestMemoryInUse(t *testing.T) {
	a := &agent{stateDir: t.TempDir()}
	c := func(id, state, autostop, mb string) containerSummary {
		return containerSummary{State: state, Labels: map[string]string{"mchost.server": id, "mchost.autostop": autostop, "mchost.memory": mb}}
	}
	list := []containerSummary{
		c("paidup", "running", "false", "3072"),
		c("paiddown", "exited", "false", "6144"), // stopped by its owner: still reserved
		c("unpaid", "exited", "false", "10240"),  // suspended below: gives its memory back
		c("freeup", "running", "true", "2048"),
		c("freedown", "exited", "true", "2048"), // asleep: free servers only count while awake
	}
	a.setMarker("unpaid", "suspended")
	if got := a.memoryInUse(list, ""); got != 3072+6144+2048 {
		t.Fatalf("in use = %d", got)
	}
	if got := a.memoryInUse(list, "freeup"); got != 3072+6144 {
		t.Fatalf("a server must not count against itself: %d", got)
	}
	// Overbooked, a stopped server's memory has been sold again: only running ones count.
	a.overbook = 1.5
	if got := a.memoryInUse(list, ""); got != 3072+2048 {
		t.Fatalf("overbooked in use = %d", got)
	}
}

func TestBackupsListAndPrune(t *testing.T) {
	a := &agent{backupDir: t.TempDir()}
	id := "abc12345"
	if list, err := a.listBackups(id); err != nil || len(list) != 0 {
		t.Fatalf("no backups yet: %v %v", list, err)
	}
	os.MkdirAll(a.backupPath(id), 0o755)
	for _, f := range []string{"20261010-030000.tar.gz", "20261012-030000.tar.gz", "20261011-030000.tar.gz", "20261012-040000.tar.gz.partial", "notes.txt"} {
		os.WriteFile(a.backupPath(id, f), []byte("x"), 0o644)
	}
	list, err := a.listBackups(id)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, b := range list {
		names = append(names, b.Name)
	}
	if strings.Join(names, " ") != "20261012-030000.tar.gz 20261011-030000.tar.gz 20261010-030000.tar.gz" {
		t.Fatalf("want newest first, finished backups only: %v", names)
	}
	if !list[0].CreatedAt.Equal(time.Date(2026, 10, 12, 3, 0, 0, 0, time.UTC)) {
		t.Fatalf("created at %v", list[0].CreatedAt)
	}

	a.pruneBackups(id, 2)
	left, _ := filepath.Glob(a.backupPath(id, "*"))
	for i := range left {
		left[i] = filepath.Base(left[i])
	}
	if strings.Join(left, " ") != "20261011-030000.tar.gz 20261012-030000.tar.gz notes.txt" {
		t.Fatalf("prune should keep the 2 newest and drop half-written ones: %v", left)
	}
}

func TestBackupNames(t *testing.T) {
	for name, ok := range map[string]bool{
		"20261012-030000.tar.gz":         true,
		"../20261012-030000.tar.gz":      false,
		"20261012-030000.tar.gz.partial": false,
		"x.tar.gz":                       false,
	} {
		if backupFile.MatchString(name) != ok {
			t.Errorf("%q: want %v", name, ok)
		}
	}
}

func TestImageFor(t *testing.T) {
	for version, want := range map[string]string{
		"LATEST":  "itzg/minecraft-server:java25",
		"26.1":    "itzg/minecraft-server:java25",
		"26.3.1":  "itzg/minecraft-server:java25",
		"1.21.11": "itzg/minecraft-server:java21",
		"1.20.1":  "itzg/minecraft-server:java21",
		"1.19.4":  "itzg/minecraft-server:java17",
		"1.17.1":  "itzg/minecraft-server:java17",
	} {
		if got := imageFor("JAVA", version, "vanilla"); got != want {
			t.Errorf("%s: got %s, want %s", version, got, want)
		}
	}
	for version, want := range map[string]string{
		"1.12.2": "itzg/minecraft-server:java8", // RLCraft
		"1.16.5": "itzg/minecraft-server:java8",
		"1.18.2": "itzg/minecraft-server:java17",
		"1.20.1": "itzg/minecraft-server:java17", // Forge 1.20.1 packs
		"1.20.4": "itzg/minecraft-server:java17",
		"1.20.6": "itzg/minecraft-server:java21",
		"1.21.1": "itzg/minecraft-server:java21",
		"26.3":   "itzg/minecraft-server:java25",
	} {
		if got := imageFor("JAVA", version, "modpack"); got != want {
			t.Errorf("modpack %s: got %s, want %s", version, got, want)
		}
	}
	for kind, want := range map[string]string{"forge": "itzg/minecraft-server:java17", "neoforge": "itzg/minecraft-server:java17", "fabric": "itzg/minecraft-server:java21"} {
		if got := imageFor("JAVA", "1.20.4", kind); got != want {
			t.Errorf("%s 1.20.4: got %s, want %s", kind, got, want)
		}
	}
	if imageFor("JAVA", "1.20.1", "skyblock") != images["JAVA"] {
		t.Error("skyblock follows its plugins to the newest version")
	}
	if imageFor("BEDROCK", "LATEST", "vanilla") != images["BEDROCK"] {
		t.Error("bedrock always uses its own image")
	}
}

func TestKindEnv(t *testing.T) {
	a := &agent{idle: 5 * time.Minute}
	envOf := func(req createRequest) string {
		t.Helper()
		if err := req.validate(); err != nil {
			t.Fatalf("%+v: %v", req, err)
		}
		return strings.Join(a.containerSpec(req, imageFor(req.Edition, req.Version, req.Kind))["Env"].([]string), "\n") + "\n"
	}
	base := createRequest{ID: "abc12345", Name: "Wyspa", Edition: "JAVA", MemoryMb: 3072, CPUs: 2, Port: 30001, Hostname: "wyspa.mchost.pl"}

	vanilla := envOf(base)
	for _, want := range []string{"TYPE=PAPER\n", "VERSION=LATEST\n"} {
		if !strings.Contains(vanilla, want) {
			t.Errorf("vanilla env missing %q:\n%s", want, vanilla)
		}
	}

	sky := base
	sky.Kind = "skyblock"
	env := envOf(sky)
	for _, want := range []string{"TYPE=PAPER\n", "MODRINTH_PROJECTS=bentobox,bskyblock\n", "VERSION_FROM_MODRINTH_PROJECTS=TRUE\n"} {
		if !strings.Contains(env, want) {
			t.Errorf("skyblock env missing %q:\n%s", want, env)
		}
	}
	if strings.Contains(env, "VERSION=") && !strings.Contains(env, "VERSION_FROM") {
		t.Errorf("skyblock must not pin VERSION:\n%s", env)
	}
	one := base
	one.Kind = "oneblock"
	if env := envOf(one); !strings.Contains(env, "MODRINTH_PROJECTS=bentobox,aoneblock\n") {
		t.Errorf("oneblock env:\n%s", env)
	}

	pack := base
	pack.Kind, pack.Modpack, pack.ModpackVersion, pack.Version = "modpack", "cobblemon-fabric", "BpTjgzL8", "1.21.1"
	env = envOf(pack)
	for _, want := range []string{"TYPE=MODRINTH\n", "MODRINTH_MODPACK=cobblemon-fabric\n", "MODRINTH_VERSION=BpTjgzL8\n", "VERSION=1.21.1\n", "MODRINTH_EXCLUDE_FILES=missingmodschecker,ftbquestsfreezefix\n", "MODRINTH_FORCE_INCLUDE_FILES=terrablender,balm,ftb-library\n", "PRE_START_SCRIPT=/tmp/mchost-pack\n", "INIT_MEMORY=1024M\n", "MAX_MEMORY=3072M\n"} {
		if !strings.Contains(env, want) {
			t.Errorf("modpack env missing %q:\n%s", want, env)
		}
	}
	if strings.Contains(env, "TYPE=PAPER") {
		t.Errorf("modpack must not run Paper:\n%s", env)
	}

	cf := base
	cf.Kind, cf.ModpackSource, cf.Modpack, cf.ModpackVersion, cf.Version = "modpack", "curseforge", "rlcraft", "4612979", "1.12.2"
	keyed := &agent{idle: 5 * time.Minute, cfKey: "$2a$10$key"}
	if err := cf.validate(); err != nil {
		t.Fatal(err)
	}
	env = strings.Join(keyed.containerSpec(cf, imageFor(cf.Edition, cf.Version, cf.Kind))["Env"].([]string), "\n") + "\n"
	for _, want := range []string{"TYPE=AUTO_CURSEFORGE\n", "CF_SLUG=rlcraft\n", "CF_FILE_ID=4612979\n", "CF_API_KEY=$2a$10$key\n"} {
		if !strings.Contains(env, want) {
			t.Errorf("curseforge env missing %q:\n%s", want, env)
		}
	}
	if strings.Contains(env, "MODRINTH_") || strings.Contains(env, "\nVERSION=") {
		t.Errorf("curseforge pack takes its version from the pack:\n%s", env)
	}
	if env := envOf(cf); strings.Contains(env, "CF_API_KEY") {
		t.Errorf("no key, no CF_API_KEY:\n%s", env)
	}

	for kind, typ := range map[string]string{"fabric": "FABRIC", "forge": "FORGE", "neoforge": "NEOFORGE"} {
		mods := base
		mods.Kind, mods.Version, mods.Plugins = kind, "1.21.1", []string{"gvQqBUqZ", "uXXizFIs"}
		env = envOf(mods)
		for _, want := range []string{"TYPE=" + typ + "\n", "VERSION=1.21.1\n", "MODRINTH_PROJECTS=gvQqBUqZ?,uXXizFIs?\n", "MODRINTH_DOWNLOAD_DEPENDENCIES=required\n"} {
			if !strings.Contains(env, want) {
				t.Errorf("%s env missing %q:\n%s", kind, want, env)
			}
		}
		if strings.Contains(env, "TYPE=PAPER") {
			t.Errorf("%s must not run Paper:\n%s", kind, env)
		}
	}

	for _, bad := range []createRequest{
		{Kind: "hardcore"},
		{Kind: "modpack"}, // no pack
		{Kind: "modpack", Modpack: "cobblemon-fabric"},                                                 // no version
		{Kind: "modpack", Modpack: "a b", ModpackVersion: "BpTjgzL8"},                                  // bad slug
		{Kind: "modpack", Modpack: "pack", ModpackVersion: "x;rm -rf /"},                               // bad version
		{Kind: "modpack", ModpackSource: "curseforge", Modpack: "rlcraft", ModpackVersion: "BpTjgzL8"}, // not a file ID
		{Kind: "modpack", ModpackSource: "modrinth", Modpack: "rlcraft", ModpackVersion: "4612979"},    // not a version ID
		{Kind: "modpack", ModpackSource: "ftb", Modpack: "rlcraft", ModpackVersion: "4612979"},
		{Kind: "vanilla", ModpackSource: "curseforge"},
	} {
		bad.ID, bad.Name, bad.Edition, bad.MemoryMb, bad.CPUs, bad.Port, bad.Hostname = "abc12345", "X", "JAVA", 2048, 1, 25570, "x.mchost.pl"
		if bad.validate() == nil {
			t.Errorf("should be rejected: %+v", bad)
		}
	}
	bedrockSky := createRequest{ID: "abc12345", Name: "X", Edition: "BEDROCK", MemoryMb: 2048, CPUs: 1, Port: 25570, Kind: "skyblock"}
	if bedrockSky.validate() == nil {
		t.Error("bedrock can't be skyblock")
	}
}

func TestSettingsEnv(t *testing.T) {
	a := &agent{idle: 5 * time.Minute}
	off := false
	java := createRequest{ID: "abc12345", Name: "Ekipa", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 25570, Hostname: "ekipa.mchost.pl",
		Version: "1.20.1", GameMode: "creative", Difficulty: "hard", Motd: "Witaj!", PVP: &off, Whitelist: true, Players: []string{"Steve", "Alex_2"}}
	if err := java.validate(); err != nil {
		t.Fatal(err)
	}
	env := strings.Join(a.containerSpec(java, imageFor("JAVA", java.Version, java.Kind))["Env"].([]string), "\n")
	for _, want := range []string{"VERSION=1.20.1", "MODE=creative", "DIFFICULTY=hard", "MOTD=Witaj!", "PVP=false", "ENABLE_WHITELIST=true", "WHITELIST=Steve,Alex_2", "EXISTING_WHITELIST_FILE=SYNCHRONIZE"} {
		if !strings.Contains(env, want+"\n") && !strings.HasSuffix(env, want) {
			t.Errorf("java env missing %s:\n%s", want, env)
		}
	}

	bedrock := createRequest{ID: "abc12345", Name: "Wyspa", Edition: "BEDROCK", MemoryMb: 2048, CPUs: 1, Port: 25570, Whitelist: true, Players: []string{"Gracz 123"}}
	if err := bedrock.validate(); err != nil {
		t.Fatal(err)
	}
	env = strings.Join(a.containerSpec(bedrock, images["BEDROCK"])["Env"].([]string), "\n")
	for _, want := range []string{"SERVER_NAME=Wyspa", "GAMEMODE=survival", "DIFFICULTY=easy", "ALLOW_LIST=true", "ALLOW_LIST_USERS=Gracz 123"} {
		if !strings.Contains(env, want) {
			t.Errorf("bedrock env missing %s:\n%s", want, env)
		}
	}

	for _, bad := range []createRequest{
		{GameMode: "hardcore"},
		{Version: "latest; rm -rf /"},
		{Motd: "two\nlines"},
		{Players: []string{"a,b"}},
		{Players: []string{"name:123"}},
	} {
		bad.ID, bad.Name, bad.Edition, bad.MemoryMb, bad.CPUs, bad.Port = "abc12345", "X", "BEDROCK", 2048, 1, 25570
		if bad.validate() == nil {
			t.Errorf("should be rejected: %+v", bad)
		}
	}
}

func TestCrossplay(t *testing.T) {
	a := &agent{idle: 5 * time.Minute}
	base := createRequest{ID: "abc12345", Name: "Test", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 30007, Hostname: "ekipa.mchost.pl", Version: "1.20.1", Kind: "vanilla"}

	on := base
	on.Crossplay = true
	on.Plugins = []string{"gvQqBUqZ"}
	if err := on.validate(); err != nil {
		t.Fatal(err)
	}
	spec := a.containerSpec(on, images["JAVA"])
	env := specEnv(spec)
	for _, want := range []string{
		"MODRINTH_PROJECTS=viaversion?,gvQqBUqZ?\n",
		"PLUGINS=" + crossplayPlugins[0] + "," + crossplayPlugins[1] + "\n",
	} {
		if !strings.Contains(env, want) {
			t.Fatalf("missing %q in\n%s", want, env)
		}
	}
	host := spec["HostConfig"].(map[string]any)
	ports := host["PortBindings"].(map[string]any)
	if b := ports["25565/tcp"].([]map[string]string); b[0]["HostIp"] != "127.0.0.1" || b[0]["HostPort"] != "30007" {
		t.Fatalf("java side should stay behind the router: %v", b)
	}
	if b := ports["19132/udp"].([]map[string]string); b[0]["HostIp"] != "" || b[0]["HostPort"] != "30007" {
		t.Fatalf("geyser should be open on the server's port over UDP: %v", b)
	}
	if _, ok := spec["ExposedPorts"].(map[string]any)["19132/udp"]; !ok {
		t.Fatal("geyser's port should be exposed")
	}

	// Off: the plugin list is still set, empty, so the image removes Geyser and Floodgate.
	off := a.containerSpec(base, images["JAVA"])
	if env := specEnv(off); !strings.Contains(env, "PLUGINS=\n") || strings.Contains(env, "viaversion") {
		t.Fatalf("crossplay off should clear the plugins:\n%s", env)
	}
	if _, ok := off["HostConfig"].(map[string]any)["PortBindings"].(map[string]any)["19132/udp"]; ok {
		t.Fatal("no UDP port without crossplay")
	}

	// Game modes keep their own plugins; mod servers and Bedrock can't have it.
	sky := on
	sky.Kind, sky.Plugins = "skyblock", nil
	if env := specEnv(a.containerSpec(sky, images["JAVA"])); !strings.Contains(env, "MODRINTH_PROJECTS=bentobox,bskyblock,viaversion?\n") {
		t.Fatalf("skyblock crossplay:\n%s", env)
	}
	fabric := base
	fabric.Kind = "fabric"
	if env := specEnv(a.containerSpec(fabric, images["JAVA"])); strings.Contains(env, "PLUGINS=") {
		t.Fatalf("mod servers don't take Paper plugins:\n%s", env)
	}
	for _, bad := range []createRequest{
		{ID: "abc12345", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 30007, Hostname: "ekipa.mchost.pl", Kind: "fabric", Crossplay: true},
		{ID: "abc12345", Edition: "BEDROCK", MemoryMb: 2048, CPUs: 1, Port: 30007, Crossplay: true},
	} {
		if err := bad.validate(); err == nil {
			t.Errorf("%s/%s with crossplay should be refused", bad.Edition, bad.Kind)
		}
	}
}

// specEnv is a container spec's environment, one variable per line.
func specEnv(spec map[string]any) string {
	return strings.Join(spec["Env"].([]string), "\n") + "\n"
}
