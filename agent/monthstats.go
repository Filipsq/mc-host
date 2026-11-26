package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"sync"
	"time"
	_ "time/tzdata" // the month and the day are Polish ones, whatever the machine's clock says
)

// The panel's "Podsumowanie miesiąca": who played on a server this month and for
// how long, from the same 30-second samples as the Statistics card. Unlike those,
// a month's numbers are kept on disk (stateDir/<id>.month-2026-11.json), written
// at most every few minutes, so an agent restart loses only the last minutes.

const monthFlushEvery = 5 * time.Minute

var (
	warsaw     = mustLocation("Europe/Warsaw")
	monthParam = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)
)

func mustLocation(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return loc
}

type monthStats struct {
	Month string `json:"month"` // "2026-11"
	// Minutes each named player was online.
	Minutes map[string]float64 `json:"minutes"`
	// Minutes with anyone online, and player-minutes per day of the month ("01".."31").
	ActiveMinutes float64            `json:"activeMinutes"`
	Days          map[string]float64 `json:"days"`
	Peak          int                `json:"peak"`
	PeakAt        int64              `json:"peakAt"` // unix seconds
}

type monthEntry struct {
	mu      sync.Mutex
	stats   *monthStats
	flushed time.Time
}

func newMonthStats(month string) *monthStats {
	return &monthStats{Month: month, Minutes: map[string]float64{}, Days: map[string]float64{}}
}

func (a *agent) monthPath(id, month string) string {
	return filepath.Join(a.stateDir, id+".month-"+month+".json")
}

func (a *agent) loadMonth(id, month string) *monthStats {
	b, err := os.ReadFile(a.monthPath(id, month))
	if err != nil {
		return nil
	}
	var s monthStats
	if json.Unmarshal(b, &s) != nil || s.Month != month {
		return nil
	}
	if s.Minutes == nil {
		s.Minutes = map[string]float64{}
	}
	if s.Days == nil {
		s.Days = map[string]float64{}
	}
	return &s
}

func (a *agent) saveMonth(id string, s *monthStats) {
	b, err := json.Marshal(s)
	if err != nil {
		return
	}
	path := a.monthPath(id, s.Month)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		log.Printf("month stats %s: %v", id, err)
		return
	}
	if err := os.Rename(tmp, path); err != nil {
		log.Printf("month stats %s: %v", id, err)
	}
}

// noteMonth adds one sample: everyone online gets the time since the last sample.
func (a *agent) noteMonth(id string, now time.Time, players []string, count int) {
	local := now.In(warsaw)
	month := local.Format("2006-01")
	v, _ := a.months.LoadOrStore(id, &monthEntry{})
	e := v.(*monthEntry)
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.stats == nil || e.stats.Month != month {
		if e.stats != nil {
			a.saveMonth(id, e.stats) // the month just ended keeps its last minutes
		}
		if e.stats = a.loadMonth(id, month); e.stats == nil {
			e.stats = newMonthStats(month)
		}
		e.flushed = now
	}
	s := e.stats
	step := metricsEvery.Minutes()
	if count > 0 {
		s.ActiveMinutes += step
		s.Days[local.Format("02")] += step * float64(count)
	}
	for _, p := range players {
		s.Minutes[p] += step
	}
	if count > s.Peak {
		s.Peak, s.PeakAt = count, now.Unix()
	}
	if now.Sub(e.flushed) >= monthFlushEvery {
		a.saveMonth(id, s)
		e.flushed = now
	}
}

// The month's numbers as the panel shows them.
type monthSummary struct {
	Month         string         `json:"month"`
	Players       int            `json:"players"`       // different players
	PlayerMinutes float64        `json:"playerMinutes"` // all of them together
	ActiveMinutes float64        `json:"activeMinutes"`
	Peak          int            `json:"peak"`
	PeakAt        int64          `json:"peakAt,omitempty"`
	BusiestDay    string         `json:"busiestDay,omitempty"` // "2026-11-14"
	Top           []playerMinute `json:"top"`
}

type playerMinute struct {
	Name    string  `json:"name"`
	Minutes float64 `json:"minutes"`
}

func summarize(s *monthStats) monthSummary {
	out := monthSummary{Month: s.Month, ActiveMinutes: s.ActiveMinutes, Peak: s.Peak, PeakAt: s.PeakAt, Top: []playerMinute{}}
	for name, m := range s.Minutes {
		out.Players++
		out.Top = append(out.Top, playerMinute{name, m})
	}
	for _, m := range s.Days {
		out.PlayerMinutes += m
	}
	sort.Slice(out.Top, func(i, j int) bool {
		if out.Top[i].Minutes != out.Top[j].Minutes {
			return out.Top[i].Minutes > out.Top[j].Minutes
		}
		return out.Top[i].Name < out.Top[j].Name
	})
	if len(out.Top) > 5 {
		out.Top = out.Top[:5]
	}
	best := 0.0
	days := make([]string, 0, len(s.Days))
	for d := range s.Days {
		days = append(days, d)
	}
	sort.Strings(days)
	for _, d := range days {
		if s.Days[d] > best {
			best, out.BusiestDay = s.Days[d], s.Month+"-"+d
		}
	}
	return out
}

// GET /servers/{id}/summary?month=2026-11 (default: this month).
func (a *agent) monthSummaryHandler(w http.ResponseWriter, r *http.Request) {
	id, ok := a.idFrom(w, r)
	if !ok {
		return
	}
	month := r.URL.Query().Get("month")
	if month == "" {
		month = time.Now().In(warsaw).Format("2006-01")
	}
	if !monthParam.MatchString(month) {
		writeError(w, http.StatusBadRequest, "month must look like 2026-11")
		return
	}
	var s *monthStats
	if v, ok := a.months.Load(id); ok {
		e := v.(*monthEntry)
		e.mu.Lock()
		if e.stats != nil && e.stats.Month == month {
			copied := summarize(e.stats)
			e.mu.Unlock()
			writeJSON(w, http.StatusOK, copied)
			return
		}
		e.mu.Unlock()
	}
	if s = a.loadMonth(id, month); s == nil {
		s = newMonthStats(month)
	}
	writeJSON(w, http.StatusOK, summarize(s))
}

// dropMonths forgets a deleted server's months.
func (a *agent) dropMonths(id string) {
	a.months.Delete(id)
	files, _ := filepath.Glob(filepath.Join(a.stateDir, id+".month-*.json"))
	for _, f := range files {
		os.Remove(f)
	}
}
