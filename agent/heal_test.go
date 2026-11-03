package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"path/filepath"
	"testing"
)

func TestHealEnvRebuildsAContainerWithTheBadVersionType(t *testing.T) {
	for _, tc := range []struct {
		typ, want string
	}{{"TYPE=PAPER", ""}, {"TYPE=FABRIC", "MODRINTH_PROJECTS_DEFAULT_VERSION_TYPE=beta"}} {
		sock := filepath.Join(t.TempDir(), "docker.sock")
		ln, err := net.Listen("unix", sock)
		if err != nil {
			t.Fatal(err)
		}
		var removed bool
		var created map[string]any
		fake := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case r.Method == http.MethodGet && r.URL.Path == "/containers/mc-abc12345/json":
				writeJSON(w, 200, map[string]any{
					"Config":          map[string]any{"Hostname": "old", "Image": "itzg/minecraft-server", "Env": []string{tc.typ, badVersionType, "EULA=TRUE"}},
					"HostConfig":      map[string]any{"Memory": 1},
					"NetworkSettings": map[string]any{"Networks": map[string]any{"bridge": map[string]any{"IPAddress": "172.17.0.2"}}},
					"State":           map[string]any{"Running": false},
				})
			case r.Method == http.MethodDelete:
				removed = true
				w.WriteHeader(204)
			case r.Method == http.MethodPost && r.URL.Path == "/containers/create":
				json.NewDecoder(r.Body).Decode(&created)
				writeJSON(w, 201, map[string]string{"Id": "new"})
			default:
				writeError(w, 404, "not found")
			}
		})}
		go fake.Serve(ln)
		a := &agent{docker: NewDocker(sock)}
		a.healEnv(context.Background(), "abc12345")
		fake.Close()
		if !removed || created == nil {
			t.Fatalf("%s: removed=%v created=%v", tc.typ, removed, created)
		}
		env, _ := json.Marshal(created["Env"])
		want := `["` + tc.typ + `","EULA=TRUE"]`
		if tc.want != "" {
			want = `["` + tc.typ + `","` + tc.want + `","EULA=TRUE"]`
		}
		if string(env) != want || created["Hostname"] != nil || created["HostConfig"] == nil || created["NetworkingConfig"] == nil {
			t.Fatalf("%s: created %v", tc.typ, created)
		}
	}
}
