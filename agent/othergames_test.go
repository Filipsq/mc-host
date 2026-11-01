package main

import (
	"context"
	"net"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestValheimValidate(t *testing.T) {
	if !valheimSupported() {
		t.Skip("Valheim runs on x86 only")
	}
	ok := createRequest{ID: "abc12345", Name: "Wikingowie", Edition: "VALHEIM", MemoryMb: 3072, CPUs: 2, Port: 30010, Password: "topor123"}
	if err := ok.validate(); err != nil {
		t.Fatal(err)
	}
	if ok.Difficulty != "normal" || ok.level() != defaultValheimWorld {
		t.Fatalf("defaults: %q %q", ok.Difficulty, ok.level())
	}
	for name, mut := range map[string]func(*createRequest){
		"short password":   func(r *createRequest) { r.Password = "abc" },
		"password in name": func(r *createRequest) { r.Name = "Topor123 serwer" },
		"bad preset":       func(r *createRequest) { r.Difficulty = "peaceful" },
		"plugins":          func(r *createRequest) { r.Plugins = []string{"x"} },
		"hytale sign-in":   func(r *createRequest) { r.Hytale = &hytaleAuth{} },
	} {
		r := createRequest{ID: "abc12345", Name: "Wikingowie", Edition: "VALHEIM", MemoryMb: 3072, CPUs: 2, Port: 30010, Password: "topor123"}
		mut(&r)
		if r.validate() == nil && name != "hytale sign-in" {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestValheimSpec(t *testing.T) {
	req := createRequest{ID: "abc12345", Name: "Wikingowie", Edition: "VALHEIM", MemoryMb: 3072, CPUs: 2, Port: 30010, Password: "topor123", Difficulty: "hard"}
	spec := (&agent{}).gameSpec(req, valheimImage)
	hc := spec["HostConfig"].(map[string]any)
	if b := hc["PortBindings"].(map[string]any); len(b) != 1 || b["2456/udp"] == nil {
		t.Fatalf("bindings %v", b)
	}
	mounts := hc["Mounts"].([]map[string]any)
	if len(mounts) != 3 || mounts[1]["Target"] != "/config" || mounts[2]["Source"] != containerName("abc12345") {
		t.Fatalf("mounts %v", mounts)
	}
	env := strings.Join(spec["Env"].([]string), "\n")
	for _, want := range []string{"SERVER_PASS=topor123", "SERVER_ARGS=-preset hard", "WORLD_NAME=Dedicated", "BACKUPS=false"} {
		if !strings.Contains(env, want) {
			t.Errorf("env lacks %s", want)
		}
	}
}

func TestHytaleSpec(t *testing.T) {
	if !hytaleSupported() {
		t.Skip("Hytale runs on x86 only")
	}
	req := createRequest{ID: "abc12345", Name: "Kraina", Edition: "HYTALE", MemoryMb: 6144, CPUs: 3, Port: 30011,
		Hytale: &hytaleAuth{SessionToken: "a.b.c", IdentityToken: "d.e.f", OwnerUUID: "123e4567-e89b-12d3-a456-426614174000", DownloaderAccess: "tok", DownloaderExpires: 1}}
	if err := req.validate(); err != nil {
		t.Fatal(err)
	}
	spec := (&agent{}).gameSpec(req, hytaleImage)
	hc := spec["HostConfig"].(map[string]any)
	if b := hc["PortBindings"].(map[string]any); b["5520/udp"] == nil {
		t.Fatalf("bindings %v", b)
	}
	if mem := hc["Memory"].(int64); mem != int64(6144+javaHeadroomMb(6144))<<20 {
		t.Fatalf("memory %d", mem)
	}
	env := strings.Join(spec["Env"].([]string), "\n")
	for _, want := range []string{"HYTALE_SERVER_SESSION_TOKEN=a.b.c", "MCHOST_HEAP_MB=6144", "MCHOST_OWNER_UUID=123e4567"} {
		if !strings.Contains(env, want) {
			t.Errorf("env lacks %s", want)
		}
	}
	bad := req
	bad.Hytale = &hytaleAuth{SessionToken: "a b"}
	if bad.validate() == nil {
		t.Error("a token with a space was accepted")
	}
}

func TestHytaleScriptParses(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("no bash")
	}
	if out, err := exec.Command("bash", "-n", "-c", hytaleScript).CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
}

// A fake Steam server: asks for a challenge first, then answers A2S_INFO with 3 of 10 players.
func TestA2SInfo(t *testing.T) {
	pc, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer pc.Close()
	go func() {
		buf := make([]byte, 1500)
		for {
			n, addr, err := pc.ReadFrom(buf)
			if err != nil {
				return
			}
			if n == 25 { // no challenge yet
				pc.WriteTo([]byte{0xFF, 0xFF, 0xFF, 0xFF, 'A', 1, 2, 3, 4}, addr)
				continue
			}
			if n != 29 || string(buf[25:29]) != "\x01\x02\x03\x04" {
				return
			}
			resp := []byte{0xFF, 0xFF, 0xFF, 0xFF, 'I', 17}
			for _, s := range []string{"Wikingowie", "Dedicated", "valheim", "Valheim"} {
				resp = append(append(resp, s...), 0)
			}
			resp = append(resp, 0, 0, 3, 10, 0)
			pc.WriteTo(resp, addr)
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	players, max, err := a2sInfo(ctx, pc.LocalAddr().String())
	if err != nil || players != 3 || max != 10 {
		t.Fatalf("got %d/%d, %v", players, max, err)
	}
}
