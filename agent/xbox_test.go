package main

import (
	"strings"
	"testing"
)

func TestParseXboxLog(t *testing.T) {
	code := []string{
		"[12:00:01 INFO] Starting MCXboxBroadcast Standalone 1.0 for Bedrock 26.60",
		"[12:00:03 INFO] To sign in, use a web browser to open the page https://www.microsoft.com/link and enter the code AB12CD34 to authenticate.",
	}
	if st := parseXboxLog(code); st.State != "code" || st.Code != "AB12CD34" || st.URL != "https://www.microsoft.com/link" {
		t.Fatalf("code: %+v", st)
	}
	live := append(code,
		"[12:01:10 INFO] Successfully authenticated as Ekipa Serwer (2535412345678901) with 3/1000 friends",
		"[12:01:11 INFO] Creating Xbox LIVE session...",
		"[12:01:12 INFO] Creation of Xbox LIVE session was successful!",
		"[12:05:00 INFO] [FriendManager] Added Steve123 (2535400000000001) as a friend",
	)
	if st := parseXboxLog(live); st.State != "live" || st.Gamertag != "Ekipa Serwer" || st.Friends != 4 || st.Code != "" {
		t.Fatalf("live: %+v", st)
	}
	if st := parseXboxLog(live[:3]); st.State != "signedIn" {
		t.Fatalf("signed in: %+v", st)
	}
	if st := parseXboxLog(nil); st.State != "starting" {
		t.Fatalf("empty: %+v", st)
	}
}

func TestXboxSpec(t *testing.T) {
	spec := xboxSpec("abc12345", `Ekipa "Kuby"`, "62.83.69.130", 30391)
	env := spec["Env"].([]string)[0]
	for _, want := range []string{`remote-address: "62.83.69.130"`, `remote-port: "30391"`, `host-name: "Ekipa \"Kuby\""`, "auto-friend: true", "config-version: 9"} {
		if !strings.Contains(env, want) {
			t.Errorf("config lacks %q:\n%s", want, env)
		}
	}
	hc := spec["HostConfig"].(map[string]any)
	if hc["NetworkMode"] != "host" || spec["Labels"].(map[string]string)["mchost.xbox.port"] != "30391" {
		t.Fatalf("spec: %+v", spec)
	}
	if _, ok := spec["Labels"].(map[string]string)["mchost.server"]; ok {
		t.Fatal("the broadcaster must not look like a game server (bedrock.go, heal.go and the leftover sweep list those)")
	}
}
