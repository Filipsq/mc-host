package main

import (
	"context"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCrashCauseFrom(t *testing.T) {
	fabric := []string{"TYPE=FABRIC", "VERSION=1.21.1", betaMods}
	paper := []string{"TYPE=PAPER", "VERSION=1.21.4"}
	for _, tc := range []struct {
		name string
		log  string
		env  []string
		want string
	}{
		{"no DNS", "[mc-image-helper] ERROR : java.net.UnknownHostException: fill.papermc.io: Temporary failure in name resolution", paper, causeNetwork},
		{"missing mod", "\t - Mod 'Immersive Aircraft' (immersive_aircraft) 1.2.2 requires any version of 'Balm' (balm), which is missing!", fabric, "missing mods balm"},
		{"missing mod on Paper", "requires any version of balm, which is missing!", paper, causeNone},
		{"alpha only", "NoApplicableVersionsException(projectRef=wJ32u9Oq, versions=[Version(versionType=alpha)], versionType=VersionTypePref(versionType=beta))", fabric, "alpha builds"},
		{"broken mod", lifestealCrash, fabric, "broken mods"},
		{"mixins for Java 25", "Error encountered reading mixin config easyauth.mixins.json: java.lang.IllegalArgumentException: The requested compatibility level JAVA_25 could not be set.", fabric, "broken mods"},
		{"newer world", "java.lang.IllegalStateException: Server attempted to load chunk saved with newer version of minecraft! 4671 > 4440", paper, causeNone},
		{"unknown", "java.lang.OutOfMemoryError: Java heap space", paper, causeNone},
		{"crash after a good start", "[mc-image-helper] UnknownHostException: api.modrinth.com\n[12:00:00 INFO]: Done (3.2s)!", paper, causeNone},
	} {
		if got := crashCauseFrom(splitLines(tc.log), tc.env); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}

func splitLines(s string) []string {
	var out []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	if start < len(s) {
		out = append(out, s[start:])
	}
	return out
}

// crashAgent is an agent whose one server last exited with code 1 at finished, its log saying logLines.
type crashAgent struct {
	*agent
	mu       sync.Mutex
	finished time.Time
	starts   int
}

func newCrashAgent(t *testing.T, logLines string, finished time.Time) *crashAgent {
	t.Helper()
	tmp := t.TempDir()
	sock := filepath.Join(tmp, "docker.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	c := &crashAgent{finished: finished}
	fake := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/containers/mc-abc12345/json":
			c.mu.Lock()
			f := c.finished
			c.mu.Unlock()
			writeJSON(w, 200, map[string]any{
				"State":  map[string]any{"Status": "exited", "ExitCode": 1, "StartedAt": f.Add(-time.Minute).Format(time.RFC3339Nano), "FinishedAt": f.Format(time.RFC3339Nano)},
				"Config": map[string]any{"Tty": true, "Labels": map[string]string{"mchost.server": "abc12345"}, "Env": []string{"TYPE=FABRIC", "VERSION=1.21.1"}},
			})
		case "/containers/mc-abc12345/logs":
			w.Write([]byte(logLines))
		default:
			writeError(w, 404, "not found")
		}
	})}
	go fake.Serve(ln)
	t.Cleanup(func() { fake.Close() })
	c.agent = &agent{docker: NewDocker(sock), stateDir: tmp}
	c.repairStart = func(context.Context, string) error {
		c.mu.Lock()
		c.starts++
		c.mu.Unlock()
		return nil
	}
	return c
}

func (c *crashAgent) crashAgain(at time.Time) {
	c.mu.Lock()
	c.finished = at
	c.mu.Unlock()
}

func (c *crashAgent) startCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.starts
}

func (c *crashAgent) reason(t *testing.T) string {
	info, err := c.docker.InspectContainer(context.Background(), containerName("abc12345"))
	if err != nil {
		t.Fatal(err)
	}
	return c.stopReason("abc12345", info)
}

func TestAutoRepairStartsAFixableCrashOnce(t *testing.T) {
	now := time.Now()
	c := newCrashAgent(t, lifestealCrash, now.Add(-10*time.Second))
	ctx := context.Background()
	c.repairServer(ctx, "abc12345", now)
	if c.startCount() != 1 {
		t.Fatalf("started %d times, want 1", c.startCount())
	}
	// The same crash seen again: nothing more.
	c.repairServer(ctx, "abc12345", now.Add(repairEvery))
	if c.startCount() != 1 {
		t.Fatalf("started %d times for one crash", c.startCount())
	}
	// The fix didn't help: the same cause again stays for the owner.
	c.crashAgain(now.Add(2 * time.Minute))
	c.repairServer(ctx, "abc12345", now.Add(2*time.Minute+time.Second))
	if c.startCount() != 1 {
		t.Fatalf("started again on a cause it already tried to fix")
	}
	if r := c.reason(t); r != "crashed" {
		t.Fatalf("stop reason %q, want crashed", r)
	}
}

func TestAutoRepairLeavesWhatItCantFix(t *testing.T) {
	now := time.Now()
	c := newCrashAgent(t, "java.lang.IllegalStateException: Server attempted to load chunk saved with newer version of minecraft! 4671 > 4440\n", now.Add(-10*time.Second))
	c.repairServer(context.Background(), "abc12345", now)
	if c.startCount() != 0 {
		t.Fatal("started a world from a newer Minecraft")
	}
}

func TestAutoRepairLeavesAStoppedOrOldCrash(t *testing.T) {
	now := time.Now()
	c := newCrashAgent(t, lifestealCrash, now.Add(-time.Hour))
	c.repairServer(context.Background(), "abc12345", now)
	if c.startCount() != 0 {
		t.Fatal("started a crash from an hour ago")
	}
	c = newCrashAgent(t, lifestealCrash, now.Add(-10*time.Second))
	c.setMarker("abc12345", "stopped")
	c.repairServer(context.Background(), "abc12345", now)
	if c.startCount() != 0 {
		t.Fatal("started a server its owner stopped")
	}
}

func TestAutoRepairWaitsForTheNetwork(t *testing.T) {
	up := false
	old := networkUp
	networkUp = func(context.Context) bool { return up }
	t.Cleanup(func() { networkUp = old })

	now := time.Now()
	finished := now.Add(-10 * time.Second)
	c := newCrashAgent(t, "[mc-image-helper] java.net.UnknownHostException: api.modrinth.com\n", finished)
	ctx := context.Background()
	c.repairServer(ctx, "abc12345", now)
	if c.startCount() != 0 {
		t.Fatal("started before the first wait")
	}
	if r := c.reason(t); r != "repairing" {
		t.Fatalf("stop reason %q while waiting, want repairing", r)
	}
	c.repairServer(ctx, "abc12345", finished.Add(2*time.Minute))
	if c.startCount() != 0 {
		t.Fatal("started with no network")
	}
	up = true
	c.repairServer(ctx, "abc12345", finished.Add(2*time.Minute+repairEvery))
	if c.startCount() != 1 {
		t.Fatalf("started %d times once the network was back, want 1", c.startCount())
	}
	// Network crashes come back up to repairMax times an hour, waiting longer each time.
	for i := 1; i <= repairMax; i++ {
		at := finished.Add(time.Duration(i) * 15 * time.Minute)
		c.crashAgain(at)
		c.repairServer(ctx, "abc12345", at.Add(time.Second))
		c.repairServer(ctx, "abc12345", at.Add(11*time.Minute))
	}
	if c.startCount() != repairMax {
		t.Fatalf("started %d times in the hour, want %d", c.startCount(), repairMax)
	}
}

func TestPackNeeds(t *testing.T) {
	log := splitLines(`[15:56:37] [main/INFO]: Immediate reason: [HARD_DEP_NO_CANDIDATE chipped 3.0.7 {depends athena @ [>=3.1.1]}, ROOT_FORCELOAD_SINGLE chipped 3.0.7]
[15:56:37] [main/INFO]: Reason: [HARD_DEP chipped 3.0.7 {depends athena @ [>=3.1.1]}]
	 - Mod 'Chipped' (chipped) 3.0.7 requires version 3.1.1 or later of athena, which is missing!
	 - Mod 'Immersive Aircraft' (immersive_aircraft) 1.2.2 requires any version of 'Balm' (balm), which is missing!
[x] HARD_DEP_NO_CANDIDATE a 1 {depends minecraft @ [1.20.1]}
[x] HARD_DEP_NO_CANDIDATE b 1 {depends yet_another_config_lib_v3 @ []}`)
	got := strings.Join(packNeeds(log), "|")
	if want := "athena 3.1.1|balm|yet_another_config_lib_v3"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
	if got := packNeeds(append(log, "[16:00:00] [Server thread/INFO]: Done (40.1s)!")); len(got) != 0 {
		t.Errorf("after a good start: %q", got)
	}
	if got := crashCauseFrom(log, []string{"TYPE=MODRINTH"}); !strings.HasPrefix(got, "pack needs athena 3.1.1") {
		t.Errorf("cause %q", got)
	}
}
