package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// filesAgent is an agent whose Docker only knows server abc12345's volume, kept in a temp dir.
func filesAgent(t *testing.T) (http.Handler, *agent, string) {
	t.Helper()
	tmp := t.TempDir()
	volumes := filepath.Join(tmp, "volumes")
	data := filepath.Join(volumes, "mc-abc12345", "_data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		t.Fatal(err)
	}
	sock := filepath.Join(tmp, "docker.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	fake := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/volumes/mc-abc12345" {
			writeJSON(w, 200, map[string]string{"Mountpoint": data})
			return
		}
		writeError(w, 404, "no such volume")
	})}
	go fake.Serve(ln)
	t.Cleanup(func() { fake.Close() })
	a := &agent{docker: NewDocker(sock), token: "t", volumesDir: volumes, uploadMax: 1 << 20, unzipMax: 4 << 20}
	return a.routes(), a, data
}

func call(t *testing.T, h http.Handler, method, target string, body io.Reader) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, body)
	req.Header.Set("Authorization", "Bearer t")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func q(p string) string { return url.QueryEscape(p) }

func TestFilesListReadWrite(t *testing.T) {
	h, _, data := filesAgent(t)
	os.WriteFile(filepath.Join(data, "server.properties"), []byte("motd=hi\n"), 0o644)
	os.Mkdir(filepath.Join(data, "world"), 0o755)
	os.Mkdir(filepath.Join(data, "Plugins"), 0o755)

	rec := call(t, h, "GET", "/servers/abc12345/files?path=/", nil)
	if rec.Code != 200 {
		t.Fatalf("list: %d %s", rec.Code, rec.Body)
	}
	var list struct {
		Path    string      `json:"path"`
		Entries []fileEntry `json:"entries"`
	}
	json.Unmarshal(rec.Body.Bytes(), &list)
	var names []string
	for _, e := range list.Entries {
		names = append(names, e.Type+":"+e.Name)
	}
	if got := strings.Join(names, " "); list.Path != "." || got != "dir:Plugins dir:world file:server.properties" {
		t.Fatalf("list = %q %q", list.Path, got)
	}

	if rec := call(t, h, "PUT", "/servers/abc12345/files/content?path="+q("plugins/Essentials/config.yml"), strings.NewReader("a: 1\n")); rec.Code != 200 {
		t.Fatalf("write: %d %s", rec.Code, rec.Body)
	}
	if b, _ := os.ReadFile(filepath.Join(data, "plugins/Essentials/config.yml")); string(b) != "a: 1\n" {
		t.Fatalf("written %q", b)
	}
	rec = call(t, h, "GET", "/servers/abc12345/files/content?path="+q("/plugins/Essentials/config.yml"), nil)
	if rec.Code != 200 || rec.Body.String() != "a: 1\n" {
		t.Fatalf("read: %d %q", rec.Code, rec.Body)
	}
	if rec := call(t, h, "GET", "/servers/abc12345/files/content?max=3&path=server.properties", nil); rec.Code != 413 {
		t.Fatalf("read over max: %d", rec.Code)
	}
	if rec := call(t, h, "GET", "/servers/abc12345/files/content?path=world", nil); rec.Code != 400 {
		t.Fatalf("reading a folder: %d", rec.Code)
	}
	if rec := call(t, h, "GET", "/servers/abc12345/files?path=nope", nil); rec.Code != 404 {
		t.Fatalf("missing folder: %d", rec.Code)
	}
	if rec := call(t, h, "GET", "/servers/zzz12345/files", nil); rec.Code != 404 {
		t.Fatalf("server without a volume: %d", rec.Code)
	}
	// Uploads replace the file whole and leave no temp files behind.
	call(t, h, "PUT", "/servers/abc12345/files/content?path=server.properties", strings.NewReader("motd=new\n"))
	if b, _ := os.ReadFile(filepath.Join(data, "server.properties")); string(b) != "motd=new\n" {
		t.Fatalf("replaced %q", b)
	}
	if left, _ := filepath.Glob(filepath.Join(data, ".*upload*")); len(left) > 0 {
		t.Fatalf("temp files left: %v", left)
	}
	if rec := call(t, h, "PUT", "/servers/abc12345/files/content?path=big.jar", bytes.NewReader(make([]byte, 2<<20))); rec.Code != 413 {
		t.Fatalf("upload over the limit: %d", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(data, "big.jar")); err == nil {
		t.Fatal("a refused upload must not leave a file")
	}
	if rec := call(t, h, "PUT", "/servers/abc12345/files/content?path=/", strings.NewReader("x")); rec.Code != 400 {
		t.Fatalf("writing the top folder: %d", rec.Code)
	}
}

func TestFilesStayInsideTheServer(t *testing.T) {
	h, _, data := filesAgent(t)
	outside := filepath.Join(filepath.Dir(filepath.Dir(data)), "secret.txt") // next to the volume
	os.WriteFile(outside, []byte("other server's world"), 0o644)
	os.Symlink(filepath.Dir(outside), filepath.Join(data, "escape"))
	os.Symlink(outside, filepath.Join(data, "secret-link"))

	for _, p := range []string{"../secret.txt", "../../mc-abc12345/../secret.txt", "escape/secret.txt", "secret-link", "/../../secret.txt"} {
		if rec := call(t, h, "GET", "/servers/abc12345/files/content?path="+q(p), nil); rec.Code == 200 {
			t.Errorf("read %q outside the server: %s", p, rec.Body)
		}
		call(t, h, "PUT", "/servers/abc12345/files/content?path="+q(p), strings.NewReader("pwned"))
		call(t, h, "DELETE", "/servers/abc12345/files?path="+q(p), nil)
	}
	if rec := call(t, h, "GET", "/servers/abc12345/files?path="+q("escape"), nil); rec.Code == 200 {
		t.Errorf("listed a folder outside the server: %s", rec.Body)
	}
	if b, err := os.ReadFile(outside); err != nil || string(b) != "other server's world" {
		t.Fatalf("file outside the server changed: %q %v", b, err)
	}
	if rec := call(t, h, "DELETE", "/servers/abc12345/files?path=/", nil); rec.Code != 400 {
		t.Fatalf("deleting the top folder: %d", rec.Code)
	}
}

func TestFilesRenameDeleteMkdir(t *testing.T) {
	h, _, data := filesAgent(t)
	os.WriteFile(filepath.Join(data, "a.txt"), []byte("a"), 0o644)
	os.WriteFile(filepath.Join(data, "b.txt"), []byte("b"), 0o644)

	if rec := call(t, h, "POST", "/servers/abc12345/files/rename?path=a.txt&to=b.txt", nil); rec.Code != 409 {
		t.Fatalf("rename over a file: %d", rec.Code)
	}
	if rec := call(t, h, "POST", "/servers/abc12345/files/rename?path=a.txt&to="+q("old/a2.txt"), nil); rec.Code != 200 {
		t.Fatalf("move: %d %s", rec.Code, rec.Body)
	}
	if b, _ := os.ReadFile(filepath.Join(data, "old/a2.txt")); string(b) != "a" {
		t.Fatal("moved file missing")
	}
	if rec := call(t, h, "POST", "/servers/abc12345/files/mkdir?path=old", nil); rec.Code != 409 {
		t.Fatalf("mkdir existing: %d", rec.Code)
	}
	if rec := call(t, h, "POST", "/servers/abc12345/files/mkdir?path="+q("x/y/z"), nil); rec.Code != 200 {
		t.Fatalf("mkdir: %d", rec.Code)
	}
	if rec := call(t, h, "DELETE", "/servers/abc12345/files?path=old", nil); rec.Code != 200 {
		t.Fatalf("delete folder: %d", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(data, "old")); err == nil {
		t.Fatal("folder still there")
	}
	if rec := call(t, h, "DELETE", "/servers/abc12345/files?path=nope", nil); rec.Code != 404 {
		t.Fatalf("delete missing: %d", rec.Code)
	}
}

func TestFilesUnzip(t *testing.T) {
	h, _, data := filesAgent(t)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name, body string) {
		w, _ := zw.Create(name)
		w.Write([]byte(body))
	}
	add("MyWorld/level.dat", "level")
	add("MyWorld/region/r.0.0.mca", "region")
	add("../../../escape.txt", "escaped")
	add(`win\path.txt`, "backslashes")
	add("__MACOSX/._level.dat", "junk")
	link := &zip.FileHeader{Name: "MyWorld/link"}
	link.SetMode(os.ModeSymlink | 0o777)
	lw, _ := zw.CreateHeader(link)
	lw.Write([]byte("/etc/passwd"))
	zw.Close()
	os.WriteFile(filepath.Join(data, "upload.zip"), buf.Bytes(), 0o644)

	rec := call(t, h, "POST", "/servers/abc12345/files/unzip?path=upload.zip&to=imported", nil)
	if rec.Code != 200 {
		t.Fatalf("unzip: %d %s", rec.Code, rec.Body)
	}
	for p, want := range map[string]string{
		"imported/MyWorld/level.dat":        "level",
		"imported/MyWorld/region/r.0.0.mca": "region",
		"imported/escape.txt":               "escaped",
		"imported/win/path.txt":             "backslashes",
	} {
		if b, err := os.ReadFile(filepath.Join(data, p)); err != nil || string(b) != want {
			t.Errorf("%s = %q, %v", p, b, err)
		}
	}
	for _, p := range []string{"imported/MyWorld/link", "imported/__MACOSX", "../escape.txt", "../../escape.txt"} {
		if _, err := os.Lstat(filepath.Join(data, p)); err == nil {
			t.Errorf("%s should not exist", p)
		}
	}

	os.WriteFile(filepath.Join(data, "notzip.zip"), []byte("hello"), 0o644)
	if rec := call(t, h, "POST", "/servers/abc12345/files/unzip?path=notzip.zip", nil); rec.Code != 400 {
		t.Fatalf("not a zip: %d", rec.Code)
	}

	// A bomb: declares more than the limit.
	buf.Reset()
	zw = zip.NewWriter(&buf)
	w, _ := zw.Create("zeros")
	w.Write(make([]byte, 5<<20))
	zw.Close()
	os.WriteFile(filepath.Join(data, "bomb.zip"), buf.Bytes(), 0o644)
	if rec := call(t, h, "POST", "/servers/abc12345/files/unzip?path=bomb.zip", nil); rec.Code != 413 {
		t.Fatalf("over the unzip limit: %d", rec.Code)
	}
}

func TestFilesWaitForBackups(t *testing.T) {
	h, a, _ := filesAgent(t)
	unlock := a.lockServer("abc12345")
	rec := call(t, h, "PUT", "/servers/abc12345/files/content?path=x.txt", strings.NewReader("x"))
	unlock()
	if rec.Code != 409 || !strings.Contains(rec.Body.String(), "busy") {
		t.Fatalf("change during a backup: %d %s", rec.Code, rec.Body)
	}
	if rec := call(t, h, "GET", "/servers/abc12345/files", nil); rec.Code != 200 {
		t.Fatalf("listing after the backup: %d", rec.Code)
	}
}

func TestFilesOffWithoutVolumes(t *testing.T) {
	_, a, _ := filesAgent(t)
	a.volumesDir = filepath.Join(t.TempDir(), "elsewhere")
	if rec := call(t, a.routes(), "GET", "/servers/abc12345/files", nil); rec.Code != 503 {
		t.Fatalf("volume outside VOLUMES_DIR: %d", rec.Code)
	}
}

func TestPluginEnv(t *testing.T) {
	a := &agent{idle: 5 * time.Minute}
	envOf := func(req createRequest) string {
		t.Helper()
		req.ID, req.Name, req.MemoryMb, req.CPUs, req.Port, req.Hostname = "abc12345", "X", 2048, 1, 30001, "x.mchost.pl"
		if req.Edition == "" {
			req.Edition = "JAVA"
		}
		if err := req.validate(); err != nil {
			t.Fatalf("%+v: %v", req, err)
		}
		return strings.Join(a.containerSpec(req, imageFor(req.Edition, req.Version, req.Kind))["Env"].([]string), "\n") + "\n"
	}
	for _, tc := range []struct {
		req  createRequest
		want string
	}{
		{createRequest{}, "MODRINTH_PROJECTS=\n"}, // still set, so removed plugins are deleted
		{createRequest{Plugins: []string{"luckperms", "hXiIvTyT"}}, "MODRINTH_PROJECTS=luckperms?,hXiIvTyT?\n"},
		{createRequest{Kind: "skyblock", Plugins: []string{"luckperms"}}, "MODRINTH_PROJECTS=bentobox,bskyblock,luckperms?\n"},
	} {
		env := envOf(tc.req)
		if !strings.Contains(env, tc.want) || !strings.Contains(env, "MODRINTH_DOWNLOAD_DEPENDENCIES=required\n") {
			t.Errorf("%+v: want %q in\n%s", tc.req, tc.want, env)
		}
	}
	pack := createRequest{Kind: "modpack", Modpack: "cobblemon-fabric", ModpackVersion: "BpTjgzL8", Version: "1.21.1"}
	if env := envOf(pack); strings.Contains(env, "MODRINTH_PROJECTS") {
		t.Errorf("mod packs bring their own mods:\n%s", env)
	}
	for _, bad := range []createRequest{
		{Kind: "modpack", Modpack: "cobblemon-fabric", ModpackVersion: "BpTjgzL8", Plugins: []string{"luckperms"}},
		{Plugins: []string{"luck perms"}},
		{Plugins: []string{"x,y"}},
		{Plugins: []string{"x?"}},
		{Edition: "BEDROCK", Plugins: []string{"luckperms"}},
	} {
		bad.ID, bad.Name, bad.MemoryMb, bad.CPUs, bad.Port, bad.Hostname = "abc12345", "X", 2048, 1, 30001, "x.mchost.pl"
		if bad.Edition == "" {
			bad.Edition = "JAVA"
		}
		if bad.validate() == nil {
			t.Errorf("should be rejected: %+v", bad)
		}
	}
}
