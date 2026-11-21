package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// A plugin taken off while the server ran must not come back when a player
// wakes it: the waiting spec builds a new container before it starts.
func TestWakeBuildsTheContainerWaitingForTheNextStart(t *testing.T) {
	tmp := t.TempDir()
	sock := filepath.Join(tmp, "docker.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var created []string
	starts := 0
	fake := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/containers/create"):
			var spec struct{ Env []string }
			json.NewDecoder(r.Body).Decode(&spec)
			created = append(created, strings.Join(spec.Env, "\n")+"\n")
			writeJSON(w, 201, map[string]string{"Id": "x"})
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/start"):
			starts++
			w.WriteHeader(204)
		case r.Method == http.MethodPost || r.Method == http.MethodDelete:
			w.WriteHeader(204)
		default:
			writeJSON(w, 200, map[string]any{})
		}
	})}
	go fake.Serve(ln)
	t.Cleanup(func() { fake.Close() })
	a := &agent{docker: NewDocker(sock), token: "t", stateDir: tmp, volumesDir: filepath.Join(tmp, "volumes")}
	h := a.routes()

	// The owner took LobbyCore off: the list is empty now.
	spec := `{"edition":"JAVA","kind":"vanilla","hostname":"test.mchosting.pl","memoryMb":2048,"cpus":1,"port":30001,"plugins":[]}`
	if rec := call(t, h, "PUT", "/servers/abc12345/next", strings.NewReader(spec)); rec.Code != 200 {
		t.Fatalf("next: %d %s", rec.Code, rec.Body)
	}
	if len(created) != 0 {
		t.Fatal("the running server was rebuilt right away")
	}
	if err := a.wake(context.Background(), "abc12345"); err != nil {
		t.Fatal(err)
	}
	if len(created) != 1 || starts != 1 || !strings.Contains(created[0], "MODRINTH_PROJECTS=\n") {
		t.Fatalf("wake: %d containers made, %d starts, env %q", len(created), starts, created)
	}
	if _, err := os.Stat(a.nextSpecPath("abc12345")); err == nil {
		t.Fatal("the waiting spec is still there after being used")
	}
	// The next wake just starts the container it now has.
	if err := a.wake(context.Background(), "abc12345"); err != nil {
		t.Fatal(err)
	}
	if len(created) != 1 || starts != 2 {
		t.Fatalf("second wake: %d containers made, %d starts", len(created), starts)
	}
	if rec := call(t, h, "PUT", "/servers/abc12345/next", strings.NewReader(`{"edition":"NOPE"}`)); rec.Code != 400 {
		t.Fatalf("bad spec kept: %d", rec.Code)
	}
}
