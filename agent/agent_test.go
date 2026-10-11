package main

import (
	"bytes"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"testing"
)

func frame(stream byte, payload string) []byte {
	h := make([]byte, 8)
	h[0] = stream
	binary.BigEndian.PutUint32(h[4:], uint32(len(payload)))
	return append(h, payload...)
}

func TestDemux(t *testing.T) {
	in := append(frame(1, "hello "), frame(2, "world\n")...)
	var out bytes.Buffer
	if err := demux(bytes.NewReader(in), &out); err != nil {
		t.Fatal(err)
	}
	if out.String() != "hello world\n" {
		t.Fatalf("got %q", out.String())
	}
}

func TestContainerSpecJava(t *testing.T) {
	spec := containerSpec(createRequest{ID: "abc12345", Name: "Test", Edition: "JAVA", MemoryMb: 2048, CPUs: 1, Port: 25570, MaxPlayers: 10}, images["JAVA"])
	host := spec["HostConfig"].(map[string]any)
	if got := host["Memory"].(int64); got != (2048+512)*1024*1024 {
		t.Fatalf("memory limit = %d", got)
	}
	bindings := host["PortBindings"].(map[string]any)["25565/tcp"].([]map[string]string)
	if bindings[0]["HostPort"] != "25570" {
		t.Fatalf("port binding = %v", bindings)
	}
	if spec["Tty"].(bool) {
		t.Fatal("java containers should not use a TTY")
	}
}

func TestContainerSpecBedrock(t *testing.T) {
	spec := containerSpec(createRequest{ID: "abc12345", Name: "Test", Edition: "BEDROCK", MemoryMb: 2048, CPUs: 1, Port: 25570}, images["BEDROCK"])
	host := spec["HostConfig"].(map[string]any)
	if _, ok := host["PortBindings"].(map[string]any)["19132/udp"]; !ok {
		t.Fatal("bedrock should bind 19132/udp")
	}
	if !spec["Tty"].(bool) || !spec["OpenStdin"].(bool) {
		t.Fatal("bedrock needs TTY and stdin for send-command")
	}
}

func TestAuth(t *testing.T) {
	h := (&agent{token: "secret"}).routes()
	for _, tc := range []struct {
		path, token string
		want        int
	}{
		{"/health", "", 200},
		{"/servers/abc12345", "", 401},
		{"/servers/abc12345", "wrong", 401},
		{"/servers/BAD!", "secret", 400},
	} {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		if tc.token != "" {
			req.Header.Set("Authorization", "Bearer "+tc.token)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Errorf("%s with token %q: got %d, want %d", tc.path, tc.token, rec.Code, tc.want)
		}
	}
}
