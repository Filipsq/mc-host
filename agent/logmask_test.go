package main

import "testing"

func TestHidePasswords(t *testing.T) {
	for in, want := range map[string]string{
		"[20:24:14 INFO]: Ksenami issued server command: /login ksenami90":            "[20:24:14 INFO]: Ksenami issued server command: /login ***",
		"[20:24:14 INFO]: a issued server command: /register abc abc":                 "[20:24:14 INFO]: a issued server command: /register ***",
		"[20:24:14 INFO]: a issued server command: /authme:L abc":                     "[20:24:14 INFO]: a issued server command: /authme:L ***",
		"[20:24:14 INFO]: a issued server command: /tp -1449 81 522":                  "[20:24:14 INFO]: a issued server command: /tp -1449 81 522",
		"[20:24:14 INFO]: a issued server command: /logout":                           "[20:24:14 INFO]: a issued server command: /logout",
		"[20:24:14 INFO]: [RegisterAndLoginPlugin-1.21] Player Ksenami login success": "[20:24:14 INFO]: [RegisterAndLoginPlugin-1.21] Player Ksenami login success",
	} {
		if got := hidePasswords(in); got != want {
			t.Errorf("%q: got %q", in, got)
		}
	}
}
