package main

import (
	"testing"
	"time"
)

func TestMonthStats(t *testing.T) {
	a := &agent{stateDir: t.TempDir()}
	start := time.Date(2026, 11, 14, 18, 0, 0, 0, warsaw)
	for i := 0; i < 20; i++ { // 10 minutes
		players := []string{"Steve"}
		if i >= 10 {
			players = append(players, "Alex")
		}
		a.noteMonth("s1", start.Add(time.Duration(i)*metricsEvery), players, len(players))
	}
	a.noteMonth("s1", start.Add(11*time.Minute), nil, 0)
	got := summarize(a.loadMonth("s1", "2026-11"))
	if got.Players != 2 || got.Peak != 2 || got.ActiveMinutes != 10 || got.PlayerMinutes != 15 || got.BusiestDay != "2026-11-14" {
		t.Fatalf("summary %+v", got)
	}
	if got.Top[0].Name != "Steve" || got.Top[0].Minutes != 10 || got.Top[1].Minutes != 5 {
		t.Fatalf("top %+v", got.Top)
	}
	// A new month starts from zero and the old one stays on disk.
	a.noteMonth("s1", time.Date(2026, 12, 1, 0, 0, 30, 0, warsaw), []string{"Alex"}, 1)
	if old := a.loadMonth("s1", "2026-11"); old == nil || old.Minutes["Steve"] != 10 {
		t.Fatalf("November lost: %+v", old)
	}
	a.dropMonths("s1")
	if a.loadMonth("s1", "2026-11") != nil {
		t.Fatal("months kept after delete")
	}
}
