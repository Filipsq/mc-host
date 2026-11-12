package main

import (
	"slices"
	"testing"
)

func TestSyncDifficulty(t *testing.T) {
	cases := []struct {
		name    string
		env     []string
		answer  string
		wantRun []string
	}{
		{"differs", []string{"DIFFICULTY=hard"}, "The difficulty is Easy", []string{"minecraft:difficulty", "minecraft:difficulty hard"}},
		{"same", []string{"DIFFICULTY=easy"}, "The difficulty is Easy", []string{"minecraft:difficulty"}},
		{"hardcore", []string{"DIFFICULTY=easy", "HARDCORE=true"}, "The difficulty is Hard", nil},
		{"unset", nil, "", nil},
	}
	for _, c := range cases {
		m := &serverMetrics{}
		var ran []string
		run := func(cmd string) (string, error) { ran = append(ran, cmd); return c.answer, nil }
		syncDifficulty(c.env, m, run)
		syncDifficulty(c.env, m, run) // once per start
		if !slices.Equal(ran, c.wantRun) || !m.difficulty {
			t.Errorf("%s: ran %q, done %v", c.name, ran, m.difficulty)
		}
	}
}
