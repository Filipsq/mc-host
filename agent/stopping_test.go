package main

import (
	"context"
	"testing"
)

func TestJavaStoppingReadsTheStopLine(t *testing.T) {
	for _, tc := range []struct {
		log  string
		want bool
	}{
		{"[16:29:40 INFO]: Done (12.0s)!\n", false},
		{"[Autostop] Stopping Java process\n[16:29:41 INFO]: Stopping server\n", true},
		{"[16:29:41 INFO]: Stopping the server\n", true},
		{"<Steve> Stopping server soon lol\n", false},
	} {
		a, _ := paperConfigAgent(t, tc.log)
		m := &serverMetrics{}
		if got := a.javaStopping(context.Background(), "mc-abc12345", m); got != tc.want {
			t.Errorf("%q: got %v", tc.log, got)
		}
	}
}
