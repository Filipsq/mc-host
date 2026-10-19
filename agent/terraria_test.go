package main

import (
	"runtime"
	"strings"
	"testing"
	"time"
)

func terrariaRequest() createRequest {
	return createRequest{ID: "abc12345", Name: "Ekipa", Edition: "TERRARIA", MemoryMb: 1024, CPUs: 1, Port: 30001}
}

func TestValidateTerraria(t *testing.T) {
	req := terrariaRequest()
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	if req.Kind != "vanilla" || req.Difficulty != "classic" || req.LevelType != "medium" || req.Version != "LATEST" {
		t.Fatalf("defaults: %+v", req)
	}
	on := true
	for name, change := range map[string]func(*createRequest){
		"kind":       func(r *createRequest) { r.Kind = "paper" },
		"difficulty": func(r *createRequest) { r.Difficulty = "hard" },
		"size":       func(r *createRequest) { r.LevelType = "flat" },
		"password":   func(r *createRequest) { r.Password = "with space" },
		"long":       func(r *createRequest) { r.Password = strings.Repeat("a", 33) },
		"motd":       func(r *createRequest) { r.Motd = "two\nlines" },
		"whitelist":  func(r *createRequest) { r.Whitelist = true },
		"plugins":    func(r *createRequest) { r.Plugins = []string{"essentialsx"} },
		"modpack":    func(r *createRequest) { r.Modpack = "rlcraft" },
		"hostname":   func(r *createRequest) { r.Hostname = "ekipa.mchost.pl" },
		"memory":     func(r *createRequest) { r.MemoryMb = 256 },
	} {
		r := terrariaRequest()
		change(&r)
		if r.validate() == nil {
			t.Errorf("%s: accepted %+v", name, r)
		}
	}
	// The panel always sends onlineMode; on is fine.
	req = terrariaRequest()
	req.OnlineMode, req.Kind, req.Difficulty, req.LevelType, req.Password, req.Seed = &on, "tshock", "master", "large", "tajne!123", "not the bees"
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
}

func TestTerrariaConfig(t *testing.T) {
	req := terrariaRequest()
	req.Kind, req.Difficulty, req.LevelType, req.Seed, req.Password, req.MaxPlayers = "tshock", "expert", "large", "for the worthy", "tajne", 10
	cfg := "\n" + terrariaConfig(req) + "\n"
	for _, want := range []string{
		"world=/data/Worlds/world.wld", "autocreate=3", "worldname=Ekipa", "difficulty=1", "maxplayers=10",
		"port=7777", "motd=Ekipa", "language=en-US", "seed=for the worthy", "password=tajne",
	} {
		if !strings.Contains(cfg, "\n"+want+"\n") {
			t.Errorf("missing %q in:%s", want, cfg)
		}
	}
	req = terrariaRequest()
	req.validate()
	cfg = terrariaConfig(req)
	if strings.Contains(cfg, "password=") || strings.Contains(cfg, "seed=") {
		t.Errorf("no password or seed given, none should be set:\n%s", cfg)
	}
	if !strings.Contains(cfg, "maxplayers=255") || !strings.Contains(cfg, "autocreate=2") || !strings.Contains(cfg, "difficulty=0") {
		t.Errorf("an unlimited plan gets Terraria's most players, a medium classic world:\n%s", cfg)
	}
	req.Name = "a\nb"
	if strings.Contains(terrariaConfig(req), "worldname=a\nb") {
		t.Error("a line break in the name must not start a new setting")
	}
}

func TestContainerSpecTerraria(t *testing.T) {
	req := terrariaRequest()
	req.Kind, req.MaxPlayers, req.Autostop = "tshock", 8, true
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	spec := (&agent{idle: 5 * time.Minute}).containerSpec(req, imageFor(req.Edition, req.Version, req.Kind))
	if spec["Image"] != "ryshe/terraria:tshock-latest" {
		t.Fatalf("image = %v", spec["Image"])
	}
	host := spec["HostConfig"].(map[string]any)
	bindings := host["PortBindings"].(map[string]any)["7777/tcp"].([]map[string]string)
	if bindings[0]["HostPort"] != "30001" || bindings[0]["HostIp"] != "" {
		t.Fatalf("terraria players connect straight to the server's port: %v", bindings)
	}
	if ep := spec["Entrypoint"].([]string); len(ep) != 3 || ep[2] != terrariaScript {
		t.Fatalf("entrypoint = %v", ep)
	}
	labels := spec["Labels"].(map[string]string)
	if labels["mchost.maxplayers"] != "8" || labels["mchost.autostop"] != "true" || labels["mchost.edition"] != "TERRARIA" {
		t.Fatalf("labels = %v", labels)
	}
	env := strings.Join(spec["Env"].([]string), "\n")
	if !strings.Contains(env, "MCHOST_KIND=tshock") || !strings.Contains(env, "MCHOST_MAX_PLAYERS=8") || !strings.Contains(env, "maxplayers=8") {
		t.Fatalf("env = %s", env)
	}
	if spec["Healthcheck"] == nil {
		t.Fatal("the panel shows the server online once its healthcheck passes")
	}
}

func TestTerrariaCommand(t *testing.T) {
	cmd := terrariaCommand("say hi\nexit")
	if cmd[len(cmd)-1] != "say hi exit" {
		t.Fatalf("a command must stay one line: %q", cmd)
	}
}

func TestCountConnections(t *testing.T) {
	table := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:1E61 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 1 1 0000000000000000 100 0 0 10 0
   1: 0200A8C0:1E61 0100A8C0:D2F0 01 00000000:00000000 00:00000000 00000000     0        0 2 1 0000000000000000 20 4 30 10 -1
   2: 0200A8C0:1E61 0100A8C0:D2F2 06 00000000:00000000 00:00000000 00000000     0        0 0 3 0000000000000000
   3: 0200A8C0:9C40 0100A8C0:1E61 01 00000000:00000000 00:00000000 00000000     0        0 3 1 0000000000000000 20 4 30 10 -1
  sl  local_address                         remote_address                        st
   0: 0000000000000000FFFF00000200A8C0:1E61 0000000000000000FFFF00000100A8C0:D2F4 01 00000000:00000000`
	// One established IPv4 player, one IPv6 one; the listening socket, a closing
	// connection and a connection from port 7777 elsewhere don't count.
	if n := countConnections(table, 7777); n != 2 {
		t.Fatalf("got %d connections", n)
	}
}

func TestApplyTerrariaJoins(t *testing.T) {
	online := map[string]bool{}
	applyTerrariaJoins(online, []string{
		"Steve has joined.",
		": Alex (Poland) has joined.",
		"<Steve> Herobrine has joined.", // chat
		"Jan Kowalski has joined.",
		"Steve has left.",
	})
	if len(online) != 2 || !online["Alex"] || !online["Jan Kowalski"] {
		t.Fatalf("online = %v", online)
	}
}

func TestValidateTmodloader(t *testing.T) {
	req := terrariaRequest()
	req.Kind, req.Plugins = "tmodloader", []string{"2824688072", "2563309347"}
	err := req.validate()
	if tmodSupported() != (err == nil) {
		t.Fatalf("on %s: %v", runtime.GOARCH, err)
	}
	if !tmodSupported() {
		return
	}
	for name, mods := range map[string][]string{
		"slug":      {"calamity"},
		"injection": {"1 +quit"},
		"too long":  {"1234567890123"},
	} {
		r := terrariaRequest()
		r.Kind, r.Plugins = "tmodloader", mods
		if r.validate() == nil {
			t.Errorf("%s: accepted %v", name, mods)
		}
	}
	r := terrariaRequest()
	r.Kind, r.Plugins = "vanilla", []string{"2824688072"}
	if r.validate() == nil {
		t.Error("plain Terraria has no mods")
	}
}

func TestContainerSpecTmodloader(t *testing.T) {
	req := terrariaRequest()
	req.Kind, req.Plugins, req.Version = "tmodloader", []string{"2824688072", "2824688266"}, "LATEST"
	spec := (&agent{idle: 5 * time.Minute}).containerSpec(req, imageFor(req.Edition, req.Version, req.Kind))
	if spec["Image"] != tmodImage {
		t.Fatalf("image = %v", spec["Image"])
	}
	if ep := spec["Entrypoint"].([]string); ep[0] != "/bin/bash" || ep[2] != tmodScript {
		t.Fatalf("entrypoint = %v", ep)
	}
	env := strings.Join(spec["Env"].([]string), "\n")
	if !strings.Contains(env, "MCHOST_MODS=2824688072,2824688266") || !strings.Contains(env, "MCHOST_KIND=tmodloader") {
		t.Fatalf("env = %s", env)
	}
	if spec["Healthcheck"].(map[string]any)["StartPeriod"] != int64(30*time.Minute) {
		t.Fatal("tModLoader gets longer to download and load its mods")
	}
}
