package main

import "testing"

func TestIsAutostopLine(t *testing.T) {
	if !isAutostopLine("[2026-10-29T17:03:36+00:00] [Autostop] Stopping Java process") {
		t.Error("autostop's stop line not recognised")
	}
	for _, l := range []string{
		"2026-10-29T17:04:36.339Z\tERROR\tmc-server-runner\tTook too long, so killing server process",
		"[Autostop loop] MC Server listening for connections - stopping in 300 seconds",
		"java.lang.OutOfMemoryError: Java heap space",
	} {
		if isAutostopLine(l) {
			t.Errorf("%q taken for autostop", l)
		}
	}
}
