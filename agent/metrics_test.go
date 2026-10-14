package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"path/filepath"
	"slices"
	"sync/atomic"
	"testing"
	"time"
)

func TestParsePlayerList(t *testing.T) {
	for _, tc := range []struct {
		out   string
		names []string
		max   int
		ok    bool
	}{
		{"There are 2 of a max of 20 players online: Steve, Alex", []string{"Steve", "Alex"}, 20, true},
		{"There are 0 of a max of 10 players online: ", nil, 10, true},
		{"§6There are §c1§6 out of maximum §c20§6 players online.", nil, 0, false}, // Essentials' own /list
		{"There are 1/8 players online:\nNotch", []string{"Notch"}, 8, true},
		{"There are 1 of a max 5 players online: §aBob", []string{"Bob"}, 5, true},
	} {
		names, max, ok := parsePlayerList(tc.out)
		if !slices.Equal(names, tc.names) || max != tc.max || ok != tc.ok {
			t.Errorf("%q: got %q/%d/%v, want %q/%d/%v", tc.out, names, max, ok, tc.names, tc.max, tc.ok)
		}
	}
}

func TestParseTPS(t *testing.T) {
	for _, tc := range []struct {
		out  string
		want float64
		ok   bool
	}{
		{"§6TPS from last 1m, 5m, 15m: §a*20.0, §a19.98, §a19.5", 20, true},
		{"TPS from last 1m, 5m, 15m: 14.27, 18.1, 19.9", 14.3, true},
		{"The game is running normally\nTarget tick rate: 20.0 per second.\nAverage time per tick: 3.2ms (Target: 50.0ms)", 20, true},
		{"Target tick rate: 20.0 per second.\nAverage time per tick: 80.0ms (Target: 50.0ms)", 12.5, true},
		{"Dim minecraft:overworld (minecraft:overworld): Mean tick time: 2.1 ms. Mean TPS: 20.000\nOverall: Mean tick time: 2.345 ms. Mean TPS: 19.871", 19.9, true},
		{"minecraft:overworld: 20.000 TPS (1.000 ms/tick)\nOverall: 17.250 TPS (57.97 ms/tick)", 17.3, true},
		{"Unknown or incomplete command, see below for error\ntps<--[HERE]", 0, false},
	} {
		got, ok := parseTPS(tc.out)
		if got != tc.want || ok != tc.ok {
			t.Errorf("%q: got %v/%v, want %v/%v", tc.out, got, ok, tc.want, tc.ok)
		}
	}
}

func TestApplyBedrockJoins(t *testing.T) {
	online := map[string]bool{}
	applyBedrockJoins(online, []string{
		"[2026-10-14 12:00:00:000 INFO] Player connected: Steve, xuid: 1",
		"[2026-10-14 12:00:01:000 INFO] Player connected: Alex Two, xuid: 2",
		"[2026-10-14 12:00:02:000 INFO] Player disconnected: Steve, xuid: 1, pfid: x",
	})
	if len(online) != 1 || !online["Alex Two"] {
		t.Fatalf("online = %v", online)
	}
}

func TestBucketSamples(t *testing.T) {
	f := func(v float64) *float64 { return &v }
	in := []metricSample{
		{T: 600, MemMb: 1000, CPU: f(10), TPS: f(20), Players: 1},
		{T: 630, MemMb: 2000, CPU: f(30), Players: 3},
		{T: 660, MemMb: 1500, Players: 2},
		{T: 900, MemMb: 500, Players: 0},
	}
	out := bucketSamples(in, 5*time.Minute)
	if len(out) != 2 {
		t.Fatalf("got %d buckets", len(out))
	}
	b := out[0]
	if b.T != 600 || b.MemMb != 1500 || *b.CPU != 20 || *b.TPS != 20 || b.Players != 3 {
		t.Errorf("first bucket = %+v", b)
	}
	if b := out[1]; b.T != 900 || b.MemMb != 500 || b.CPU != nil || b.TPS != nil {
		t.Errorf("second bucket = %+v", b)
	}
}

func TestRCONSettings(t *testing.T) {
	port, pass := rconSettings("motd=Hi\nrcon.port=25599\nrcon.password=ab\\:cd\\\\e\nenable-rcon=true\n")
	if port != "25599" || pass != `ab:cd\e` {
		t.Fatalf("port=%q password=%q", port, pass)
	}
	if port, pass := rconSettings("motd=Hi\n"); port != "25575" || pass != "" {
		t.Fatalf("defaults: port=%q password=%q", port, pass)
	}
}

// fakeRCON answers like a Paper server and counts how many times it was dialled.
func fakeRCON(t *testing.T, password string, players *atomic.Value) (string, *atomic.Int32) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	var dials atomic.Int32
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			dials.Add(1)
			go func() {
				defer conn.Close()
				r := bufio.NewReader(conn)
				send := func(id, typ int32, body string) {
					buf := make([]byte, 12, 14+len(body))
					binary.LittleEndian.PutUint32(buf[0:], uint32(10+len(body)))
					binary.LittleEndian.PutUint32(buf[4:], uint32(id))
					binary.LittleEndian.PutUint32(buf[8:], uint32(typ))
					conn.Write(append(append(buf, body...), 0, 0))
				}
				for {
					var head [12]byte
					if _, err := io.ReadFull(r, head[:]); err != nil {
						return
					}
					size := binary.LittleEndian.Uint32(head[0:])
					id := int32(binary.LittleEndian.Uint32(head[4:]))
					typ := binary.LittleEndian.Uint32(head[8:])
					body := make([]byte, size-8)
					io.ReadFull(r, body)
					cmd := string(body[:len(body)-2])
					switch {
					case typ == rconAuth && cmd != password:
						send(-1, 2, "")
					case typ == rconAuth:
						send(id, 2, "")
					case cmd == "list":
						send(id, rconResponse, players.Load().(string))
					case cmd == "tps":
						send(id, rconResponse, "§6TPS from last 1m, 5m, 15m: §a19.5, §a20.0, §a20.0")
					default:
						send(id, rconResponse, "Unknown or incomplete command")
					}
				}
			}()
		}
	}()
	return ln.Addr().String(), &dials
}

func TestSampleJavaServer(t *testing.T) {
	var players atomic.Value
	players.Store("There are 1 of a max of 20 players online: Steve")
	rconAddr, dials := fakeRCON(t, "s3cret", &players)
	host, port, _ := net.SplitHostPort(rconAddr)

	tmp := t.TempDir()
	sock := filepath.Join(tmp, "docker.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	var cpuTotal atomic.Uint64
	cpuTotal.Store(1_000_000_000)
	labels := map[string]string{"mchost.server": "java1234", "mchost.edition": "JAVA"}
	fake := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/containers/json":
			writeJSON(w, 200, []map[string]any{{"State": "running", "Labels": labels}})
		case "/containers/mc-java1234/json":
			writeJSON(w, 200, map[string]any{
				"State":           map[string]any{"Status": "running", "StartedAt": "2026-10-14T10:00:00Z"},
				"Config":          map[string]any{"Labels": labels},
				"HostConfig":      map[string]any{"NanoCpus": 2_000_000_000},
				"NetworkSettings": map[string]any{"Networks": map[string]any{"bridge": map[string]string{"IPAddress": host}}},
			})
		case "/containers/mc-java1234/stats":
			// Between two samples the server used 1 of the machine's 4 cores: half of its 2-core limit.
			total := cpuTotal.Add(1_000_000_000)
			writeJSON(w, 200, map[string]any{
				"cpu_stats":    map[string]any{"cpu_usage": map[string]any{"total_usage": total}, "system_cpu_usage": total * 4, "online_cpus": 4},
				"memory_stats": map[string]any{"usage": 1200 << 20, "stats": map[string]int64{"inactive_file": 200 << 20}},
			})
		case "/containers/mc-java1234/exec":
			writeJSON(w, 201, map[string]string{"Id": "e1"})
		case "/exec/e1/start":
			w.Write(frame(1, "motd=x\nrcon.port="+port+"\nrcon.password=s3cret\n"))
		default:
			writeError(w, 404, "no such container")
		}
	})}
	go fake.Serve(ln)
	t.Cleanup(func() { fake.Close() })

	a := &agent{docker: NewDocker(sock), token: "t"}
	ctx := context.Background()
	if err := a.sampleAll(ctx); err != nil {
		t.Fatal(err)
	}
	players.Store("There are 2 of a max of 20 players online: Steve, Alex")
	if err := a.sampleAll(ctx); err != nil {
		t.Fatal(err)
	}
	if n := dials.Load(); n != 1 {
		t.Errorf("RCON dialled %d times, want 1 kept connection", n)
	}

	rec := call(t, a.routes(), "GET", "/servers/java1234/metrics?range=hour", nil)
	var got struct {
		Players    []string       `json:"players"`
		MaxPlayers int            `json:"maxPlayers"`
		Samples    []metricSample `json:"samples"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || rec.Code != 200 {
		t.Fatalf("metrics: %d %s", rec.Code, rec.Body)
	}
	if !slices.Equal(got.Players, []string{"Steve", "Alex"}) || got.MaxPlayers != 20 || len(got.Samples) != 2 {
		t.Fatalf("metrics = %+v", got)
	}
	first, last := got.Samples[0], got.Samples[1]
	if first.CPU != nil || first.MemMb != 1000 || first.Players != 1 || first.TPS == nil || *first.TPS != 19.5 {
		t.Errorf("first sample = %+v", first)
	}
	if last.CPU == nil || *last.CPU != 50 || last.Players != 2 {
		t.Errorf("second sample = %+v (cpu %v)", last, last.CPU)
	}

	// A server the agent never sampled answers with empty lists, not an error.
	rec = call(t, a.routes(), "GET", "/servers/other123/metrics", nil)
	if rec.Code != 200 || rec.Body.String() != "{\"players\":[],\"samples\":[]}\n" {
		t.Errorf("unknown server: %d %s", rec.Code, rec.Body)
	}
}
