package main

import (
	"context"
	"errors"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Live numbers for the panel's Statistics card: who is online, memory, CPU and
// ticks per second of each running server, sampled every 30 seconds and kept
// for a day. They live in memory only, so they start over when the agent restarts.

const (
	metricsEvery = 30 * time.Second
	metricsKeep  = 24 * time.Hour
	// A day's samples are averaged into buckets this long, so the chart gets ~288 points.
	metricsDayBucket = 5 * time.Minute
)

type metricSample struct {
	T       int64    `json:"t"`             // unix seconds
	CPU     *float64 `json:"cpu,omitempty"` // % of the cores the server may use (needs two samples)
	MemMb   int      `json:"memMb"`
	TPS     *float64 `json:"tps,omitempty"` // Java only, once the server answers
	Players int      `json:"players"`
}

type serverMetrics struct {
	mu         sync.Mutex
	samples    []metricSample // oldest first
	players    []string       // who was online at the last sample
	count      int            // how many, when their names aren't all known (Terraria)
	maxPlayers int            // from Java's list command, or the label of a Terraria server
	startedAt  string         // the container start the counters below belong to
	cpuTotal   uint64
	cpuSystem  uint64
	tpsCmd     int       // index into tpsCommands that worked; -1 while unknown
	tpsTried   time.Time // when none of them worked, the last try
	logsSince  int64     // Bedrock and Terraria: how far the join/leave lines were read
	online     map[string]bool
	rcon       *rconConn // Java: kept open between samples; only the sampler uses it
	// Java: /list was taken over by a plugin, so the sampler asks minecraft:list.
	namespacedList bool
	pregen         string // mod packs: "running" or "paused" as last told to Chunky, "" since the start
}

func (m *serverMetrics) listCmd() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.namespacedList {
		return "minecraft:list"
	}
	return "list"
}

// Ways to ask a Java server for its TPS: Paper, vanilla 1.20.3+ (Fabric too),
// NeoForge, Forge. The first one whose answer parses is kept for that server.
var tpsCommands = []string{"tps", "tick query", "neoforge tps", "forge tps"}

func (a *agent) metricsFor(id string) *serverMetrics {
	m, _ := a.metrics.LoadOrStore(id, &serverMetrics{tpsCmd: -1})
	return m.(*serverMetrics)
}

func (a *agent) watchMetrics(ctx context.Context) {
	tick := time.NewTicker(metricsEvery)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if err := a.sampleAll(ctx); err != nil {
				log.Printf("metrics: %v", err)
			}
		}
	}
}

func (a *agent) sampleAll(ctx context.Context) error {
	var list []containerSummary
	query := url.Values{"all": {"1"}, "filters": {`{"label":["mchost.server"]}`}}
	if err := a.docker.call(ctx, http.MethodGet, "/containers/json", query, nil, &list); err != nil {
		return err
	}
	exists := map[string]bool{}
	var wg sync.WaitGroup
	slots := make(chan struct{}, 8)
	for _, c := range list {
		id := c.Labels["mchost.server"]
		exists[id] = true
		if c.State != "running" {
			if v, ok := a.metrics.Load(id); ok {
				v.(*serverMetrics).closeRCON()
			}
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			sctx, cancel := context.WithTimeout(ctx, 20*time.Second)
			defer cancel()
			a.sampleServer(sctx, id)
		}()
	}
	wg.Wait()
	// Forget deleted servers, and the history of stopped ones once it's a day old.
	cutoff := time.Now().Add(-metricsKeep).Unix()
	a.metrics.Range(func(k, v any) bool {
		m := v.(*serverMetrics)
		m.mu.Lock()
		m.samples = dropBefore(m.samples, cutoff)
		empty := len(m.samples) == 0
		m.mu.Unlock()
		if !exists[k.(string)] || empty {
			m.closeRCON()
			a.metrics.Delete(k)
		}
		return true
	})
	return nil
}

func (m *serverMetrics) closeRCON() {
	if m.rcon != nil {
		m.rcon.Close()
		m.rcon = nil
	}
}

func dropBefore(s []metricSample, cutoff int64) []metricSample {
	i := 0
	for i < len(s) && s[i].T < cutoff {
		i++
	}
	return s[i:]
}

func (a *agent) sampleServer(ctx context.Context, id string) {
	name := containerName(id)
	info, err := a.docker.InspectContainer(ctx, name)
	if err != nil || info.State.Status != "running" {
		return
	}
	m := a.metricsFor(id)
	m.mu.Lock()
	if m.startedAt != info.State.StartedAt {
		// Started again: its CPU counters, TPS command and players start over.
		started, _ := time.Parse(time.RFC3339Nano, info.State.StartedAt)
		m.startedAt, m.cpuTotal, m.cpuSystem, m.tpsCmd, m.tpsTried = info.State.StartedAt, 0, 0, -1, time.Time{}
		m.logsSince, m.online, m.players, m.count, m.maxPlayers, m.pregen = started.Unix(), map[string]bool{}, nil, 0, 0, ""
		m.closeRCON()
	}
	m.mu.Unlock()

	now := time.Now()
	s := metricSample{T: now.Unix()}
	var st struct {
		CPU struct {
			Usage struct {
				Total uint64 `json:"total_usage"`
			} `json:"cpu_usage"`
			System uint64 `json:"system_cpu_usage"`
			Online int    `json:"online_cpus"`
		} `json:"cpu_stats"`
		Memory struct {
			Usage int64            `json:"usage"`
			Stats map[string]int64 `json:"stats"`
		} `json:"memory_stats"`
	}
	statsQuery := url.Values{"stream": {"false"}, "one-shot": {"true"}}
	if err := a.docker.call(ctx, http.MethodGet, "/containers/"+name+"/stats", statsQuery, nil, &st); err != nil {
		return
	}
	s.MemMb = int(memoryUsed(st.Memory.Usage, st.Memory.Stats) >> 20)

	edition := info.Config.Labels["mchost.edition"]
	var players []string
	count, maxPlayers := -1, 0 // count: -1 when it's len(players)
	var tps *float64
	switch edition {
	case "TERRARIA":
		var err error
		if count, players, err = a.terrariaPlayers(ctx, name, m); err != nil {
			return
		}
		maxPlayers, _ = strconv.Atoi(info.Config.Labels["mchost.maxplayers"])
	case "BEDROCK":
		players = a.bedrockPlayers(ctx, name, m)
	default:
		ip := info.IP()
		run := func(cmd string) (string, error) { return a.rconRun(ctx, name, ip, m, cmd) }
		if out, err := run(m.listCmd()); err == nil {
			var ok bool
			if players, maxPlayers, ok = parsePlayerList(out); !ok && m.listCmd() == "list" {
				// A plugin such as Essentials replaced /list with its own wording; Paper keeps the original under this name.
				if out, err := run("minecraft:list"); err == nil {
					if players, maxPlayers, ok = parsePlayerList(out); ok {
						m.mu.Lock()
						m.namespacedList = true
						m.mu.Unlock()
					}
				}
			}
			tps = javaTPS(run, m)
			if ok && info.Config.Labels["mchost.pregen"] == "true" {
				a.pregen(ctx, name, m, run, len(players))
			}
		}
	}
	if count < 0 {
		count = len(players)
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cpuSystem > 0 && st.CPU.System > m.cpuSystem && st.CPU.Usage.Total >= m.cpuTotal {
		cores := float64(st.CPU.Usage.Total-m.cpuTotal) / float64(st.CPU.System-m.cpuSystem) * float64(max(st.CPU.Online, 1))
		limit := float64(info.HostConfig.NanoCpus) / 1e9
		if limit <= 0 {
			limit = float64(max(st.CPU.Online, 1))
		}
		pct := math.Round(min(100, cores/limit*100)*10) / 10
		s.CPU = &pct
	}
	m.cpuTotal, m.cpuSystem = st.CPU.Usage.Total, st.CPU.System
	s.TPS = tps
	s.Players = count
	m.players, m.count, m.maxPlayers = players, count, maxPlayers
	m.samples = append(dropBefore(m.samples, now.Add(-metricsKeep).Unix()), s)
}

var (
	colorCodes = regexp.MustCompile(`§.`)
	// "There are 2 of a max of 20 players online: Steve, Alex" (older versions: "There are 2/20 players online:").
	listLine = regexp.MustCompile(`There are (\d+)(?: of a max(?: of)? |/)(\d+) players online:?\s*([\s\S]*)`)
	numbers  = regexp.MustCompile(`\d+(?:\.\d+)?`)
)

// rconRun runs a command over the server's kept RCON connection, connecting
// first with the password the image wrote to server.properties.
func (a *agent) rconRun(ctx context.Context, name, ip string, m *serverMetrics, cmd string) (string, error) {
	if m.rcon == nil {
		if ip == "" {
			return "", errors.New("rcon: container has no address")
		}
		props, err := a.docker.Exec(ctx, name, []string{"cat", "/data/server.properties"})
		if err != nil {
			return "", err
		}
		port, password := rconSettings(props)
		if password == "" {
			return "", errors.New("rcon: no password yet")
		}
		c, err := dialRCON(ctx, net.JoinHostPort(ip, port), password)
		if err != nil {
			return "", err // still starting
		}
		m.rcon = c
	}
	out, err := m.rcon.Run(ctx, cmd)
	if err != nil {
		m.closeRCON()
	}
	return out, err
}

func parsePlayerList(out string) ([]string, int, bool) {
	m := listLine.FindStringSubmatch(colorCodes.ReplaceAllString(out, ""))
	if m == nil {
		return nil, 0, false
	}
	maxPlayers, _ := strconv.Atoi(m[2])
	var names []string
	for _, n := range strings.FieldsFunc(m[3], func(r rune) bool { return r == ',' || r == '\n' }) {
		if n = strings.TrimSpace(n); n != "" {
			names = append(names, n)
		}
	}
	return names, maxPlayers, true
}

// javaTPS asks the server how many ticks a second it manages (20 is full speed).
func javaTPS(run func(string) (string, error), m *serverMetrics) *float64 {
	m.mu.Lock()
	cmd, tried := m.tpsCmd, m.tpsTried
	m.mu.Unlock()
	if cmd >= 0 {
		out, err := run(tpsCommands[cmd])
		if err != nil {
			return nil
		}
		if tps, ok := parseTPS(out); ok {
			return &tps
		}
	}
	// None worked lately (e.g. a version without any): try again now and then.
	if cmd < 0 && time.Since(tried) < 5*time.Minute {
		return nil
	}
	for i, c := range tpsCommands {
		out, err := run(c)
		if err != nil {
			return nil
		}
		if tps, ok := parseTPS(out); ok {
			m.mu.Lock()
			m.tpsCmd = i
			m.mu.Unlock()
			return &tps
		}
	}
	m.mu.Lock()
	m.tpsCmd, m.tpsTried = -1, time.Now()
	m.mu.Unlock()
	return nil
}

// parseTPS reads the answer of any of tpsCommands.
func parseTPS(out string) (float64, bool) {
	out = colorCodes.ReplaceAllString(out, "")
	num := func(s string) (float64, bool) {
		v, err := strconv.ParseFloat(numbers.FindString(s), 64)
		return v, err == nil
	}
	round := func(v float64) float64 { return math.Round(min(v, 20)*10) / 10 }
	switch {
	case strings.Contains(out, "TPS from last"):
		// Paper: "TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0" (over 20 shows as *20.0).
		_, after, _ := strings.Cut(out, ":")
		if v, ok := num(after); ok {
			return round(v), true
		}
	case strings.Contains(out, "Average time per tick:"):
		// Vanilla: "Target tick rate: 20.0 per second. Average time per tick: 3.2ms (Target: 50.0ms)".
		target := 20.0
		if _, after, ok := strings.Cut(out, "Target tick rate:"); ok {
			if v, ok := num(after); ok && v > 0 {
				target = v
			}
		}
		_, after, _ := strings.Cut(out, "Average time per tick:")
		if ms, ok := num(after); ok && ms > 0 {
			return round(min(target, 1000/ms)), true
		}
	case strings.Contains(out, "Overall"):
		// Forge: "Overall: Mean tick time: 2.345 ms. Mean TPS: 20.000"; NeoForge: "Overall: 20.000 TPS (2.345 ms/tick)".
		_, overall, _ := strings.Cut(out, "Overall")
		overall, _, _ = strings.Cut(overall, "\n")
		if _, after, ok := strings.Cut(overall, "Mean TPS:"); ok {
			if v, ok := num(after); ok {
				return round(v), true
			}
		}
		if before, _, ok := strings.Cut(overall, "TPS"); ok {
			if all := numbers.FindAllString(before, -1); len(all) > 0 {
				if v, err := strconv.ParseFloat(all[len(all)-1], 64); err == nil {
					return round(v), true
				}
			}
		}
	}
	return 0, false
}

// bedrockPlayers keeps who is online from the server's join and leave lines,
// reading only what was logged since the last sample.
func (a *agent) bedrockPlayers(ctx context.Context, name string, m *serverMetrics) []string {
	m.mu.Lock()
	since := m.logsSince
	m.mu.Unlock()
	var lines []string
	now := time.Now().Unix()
	err := a.docker.Logs(ctx, name, LogOptions{Since: since}, func(line string) error {
		lines = append(lines, line)
		return nil
	})
	m.mu.Lock()
	defer m.mu.Unlock()
	if err == nil {
		applyBedrockJoins(m.online, lines)
		// Docker's "since" is in whole seconds, so the boundary second is read again; joins and leaves replay the same.
		m.logsSince = now
	}
	names := make([]string, 0, len(m.online))
	for n := range m.online {
		names = append(names, n)
	}
	slices.Sort(names)
	return names
}

var bedrockJoin = regexp.MustCompile(`Player (connected|disconnected): ([^,]+),`)

func applyBedrockJoins(online map[string]bool, lines []string) {
	for _, line := range lines {
		if m := bedrockJoin.FindStringSubmatch(line); m != nil {
			if m[1] == "connected" {
				online[m[2]] = true
			} else {
				delete(online, m[2])
			}
		}
	}
}

// GET /servers/{id}/metrics?range=hour|day: who is online now and the samples for the charts.
func (a *agent) metricsHandler(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	resp := map[string]any{"players": []string{}, "samples": []metricSample{}}
	v, found := a.metrics.Load(id)
	if !found {
		writeJSON(w, http.StatusOK, resp)
		return
	}
	m := v.(*serverMetrics)
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.players != nil {
		resp["players"] = m.players
	}
	if m.count != len(m.players) {
		resp["online"] = m.count // more players than known names
	}
	if m.maxPlayers > 0 {
		resp["maxPlayers"] = m.maxPlayers
	}
	if r.URL.Query().Get("range") == "day" {
		resp["samples"] = bucketSamples(m.samples, metricsDayBucket)
	} else {
		resp["samples"] = dropBefore(m.samples, time.Now().Add(-time.Hour).Unix())
	}
	writeJSON(w, http.StatusOK, resp)
}

// bucketSamples averages samples over fixed time buckets (players: the most in the bucket).
func bucketSamples(samples []metricSample, size time.Duration) []metricSample {
	step := int64(size.Seconds())
	var out []metricSample
	for i := 0; i < len(samples); {
		start := samples[i].T / step * step
		var mem, cpu, tps float64
		var n, nCPU, nTPS, players int
		for ; i < len(samples) && samples[i].T < start+step; i++ {
			s := samples[i]
			mem += float64(s.MemMb)
			n++
			players = max(players, s.Players)
			if s.CPU != nil {
				cpu += *s.CPU
				nCPU++
			}
			if s.TPS != nil {
				tps += *s.TPS
				nTPS++
			}
		}
		b := metricSample{T: start, MemMb: int(math.Round(mem / float64(n))), Players: players}
		if nCPU > 0 {
			v := math.Round(cpu/float64(nCPU)*10) / 10
			b.CPU = &v
		}
		if nTPS > 0 {
			v := math.Round(tps/float64(nTPS)*10) / 10
			b.TPS = &v
		}
		out = append(out, b)
	}
	return out
}
