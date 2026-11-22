package main

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestFilesZip(t *testing.T) {
	h, _, data := filesAgent(t)
	write := func(name, body string) {
		t.Helper()
		p := filepath.Join(data, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("plugins/Essentials/config.yml", "a: 1\n")
	write("plugins/Essentials/lang/pl.yml", "hej\n")
	write("plugins/EssentialsX.jar", "jar")
	write("plugins/other.yml", "x\n")
	write("world/level.dat", "lvl")
	write("world/session.lock", "lock")
	os.MkdirAll(filepath.Join(data, "plugins/Empty"), 0o755)
	os.Symlink("/etc/passwd", filepath.Join(data, "plugins/link"))

	unzip := func(body []byte) map[string]string {
		t.Helper()
		zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
		if err != nil {
			t.Fatalf("not a zip: %v", err)
		}
		got := map[string]string{}
		for _, f := range zr.File {
			rc, err := f.Open()
			if err != nil {
				t.Fatal(err)
			}
			b, _ := io.ReadAll(rc)
			rc.Close()
			got[f.Name] = string(b)
		}
		return got
	}
	names := func(m map[string]string) string {
		var n []string
		for k := range m {
			n = append(n, k)
		}
		sort.Strings(n)
		return strings.Join(n, " ")
	}

	// Ticked in one folder: under their own names, a folder with all inside it.
	rec := call(t, h, "POST", "/servers/abc12345/files/zip", strings.NewReader(`{"paths":["plugins/Essentials","/plugins/EssentialsX.jar","plugins/Empty","plugins/link","plugins/gone.yml","plugins/Essentials"]}`))
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/zip" {
		t.Fatalf("zip: %d %s", rec.Code, rec.Body)
	}
	got := unzip(rec.Body.Bytes())
	if n := names(got); n != "Empty/ Essentials/ Essentials/config.yml Essentials/lang/ Essentials/lang/pl.yml EssentialsX.jar" {
		t.Fatalf("entries = %q", n)
	}
	if got["Essentials/lang/pl.yml"] != "hej\n" || got["EssentialsX.jar"] != "jar" {
		t.Fatalf("contents = %q", got)
	}

	// From the top folder, the running server's session.lock stays out.
	rec = call(t, h, "POST", "/servers/abc12345/files/zip", strings.NewReader(`{"paths":["world","plugins/other.yml"]}`))
	if rec.Code != 200 {
		t.Fatalf("zip: %d %s", rec.Code, rec.Body)
	}
	if n := names(unzip(rec.Body.Bytes())); n != "plugins/other.yml world/ world/level.dat" {
		t.Fatalf("entries from two folders = %q", n)
	}

	for _, bad := range []string{`{"paths":[]}`, `{"paths":["/"]}`, `{"paths":["../etc"]}`, `nope`} {
		rec := call(t, h, "POST", "/servers/abc12345/files/zip", strings.NewReader(bad))
		if bad == `{"paths":["../etc"]}` {
			// cleanPath keeps it inside the server's files, where there's no etc.
			if rec.Code != 404 {
				t.Errorf("%s: %d %s", bad, rec.Code, rec.Body)
			}
			continue
		}
		if rec.Code != 400 {
			t.Errorf("%s: %d %s", bad, rec.Code, rec.Body)
		}
	}
	if rec := call(t, h, "POST", "/servers/abc12345/files/zip", strings.NewReader(`{"paths":["gone"]}`)); rec.Code != 404 {
		t.Errorf("nothing left to zip: %d %s", rec.Code, rec.Body)
	}
}
