package main

import (
	"bytes"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
	if got := host["Memory"].(int64); got != (2048+512)*1024*1024 {
		t.Fatalf("memory limit = %d", got)
	}
	bindings := host["PortBindings"].(map[string]any)["25565/tcp"].([]map[string]string)
	if bindings[0]["HostPort"] != "25570" || bindings[0]["HostIp"] != "127.0.0.1" {
		t.Fatalf("java should bind only to localhost (behind the router): %v", bindings)
	}
	if spec["Labels"].(map[string]string)["mchost.host"] != "ekipa.mchost.pl" {
		t.Fatal("missing hostname label")
	}
	env := strings.Join(spec["Env"].([]string), " ")
	if !strings.Contains(env, "ENABLE_AUTOSTOP=TRUE") || !strings.Contains(env, "AUTOSTOP_TIMEOUT_EST=300") {
		t.Fatalf("autostop env missing: %s", env)
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
