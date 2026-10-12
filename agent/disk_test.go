package main

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDiskQuota(t *testing.T) {
	h, a, data := filesAgent(t)
	a.stateDir = t.TempDir()
	if err := a.setDiskLimits(map[string]int64{"abc12345": 1}, true); err != nil { // 1 MB
		t.Fatal(err)
	}
	put := func(name string, size int) int {
		return call(t, h, "PUT", "/servers/abc12345/files/content?path="+name, bytes.NewReader(make([]byte, size))).Code
	}
	if code := put("a.bin", 600_000); code != 200 {
		t.Fatalf("first upload: %d", code)
	}
	rec := call(t, h, "PUT", "/servers/abc12345/files/content?path=b.bin", bytes.NewReader(make([]byte, 600_000)))
	if rec.Code != 507 || !strings.Contains(rec.Body.String(), "quota") {
		t.Fatalf("upload over the limit: %d %s", rec.Code, rec.Body)
	}
	if _, err := os.Stat(filepath.Join(data, "b.bin")); err == nil {
		t.Fatal("a refused upload must not leave a file")
	}
	// Replacing a file with a smaller one is fine, even near the limit.
	if code := put("a.bin", 500_000); code != 200 {
		t.Fatalf("replacing with a smaller file: %d", code)
	}

	// An archive that would unpack past the limit is refused before unpacking.
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	f, _ := zw.Create("world/region.mca")
	f.Write(make([]byte, 900_000)) // zeros: a tiny archive, a big file
	zw.Close()
	if rec := call(t, h, "PUT", "/servers/abc12345/files/content?path=w.zip", bytes.NewReader(buf.Bytes())); rec.Code != 200 {
		t.Fatalf("zip upload: %d %s", rec.Code, rec.Body)
	}
	if rec := call(t, h, "POST", "/servers/abc12345/files/unzip?path=w.zip", nil); rec.Code != 507 {
		t.Fatalf("unzip over the limit: %d %s", rec.Code, rec.Body)
	}

	// Without a limit, anything the disk has room for goes.
	a.setDiskLimits(nil, true)
	if code := put("b.bin", 600_000); code != 200 {
		t.Fatalf("upload with no limit: %d", code)
	}
}

func TestDiskFullServerStaysDown(t *testing.T) {
	_, a, data := filesAgent(t)
	a.stateDir = t.TempDir()
	a.setDiskLimits(map[string]int64{"abc12345": 1}, true)
	os.WriteFile(filepath.Join(data, "big.bin"), bytes.Repeat([]byte{1}, 1_200_000), 0o644) // over 1.1 MB
	ctx := context.Background()

	if err := a.startServer(ctx, "abc12345"); !errors.Is(err, errDiskFull) {
		t.Fatalf("start = %v, want errDiskFull", err)
	}
	if !a.hasMarker("abc12345", "disk") {
		t.Fatal("a server refused for disk space should say so")
	}
	if got := a.stopReason("abc12345", &ContainerInfo{}); got != "disk" {
		t.Fatalf("stop reason = %q", got)
	}

	// The owner makes room: the next check lifts the mark, so players can wake it again.
	os.Remove(filepath.Join(data, "big.bin"))
	used, err := a.measureDisk(ctx, "abc12345")
	if err != nil {
		t.Fatal(err)
	}
	a.checkDisk(ctx, "abc12345", used, false)
	if a.hasMarker("abc12345", "disk") {
		t.Fatal("mark should go once under the limit")
	}
	if a.overDisk(ctx, "abc12345") {
		t.Fatal("an emptied server is not over its limit")
	}
}

func TestDiskLimitsPersist(t *testing.T) {
	_, a, _ := filesAgent(t)
	a.stateDir = t.TempDir()
	h := a.routes()
	if rec := call(t, h, "PUT", "/disk-limits", strings.NewReader(`{"limits":{"abc12345":2048,"def12345":10240}}`)); rec.Code != 200 {
		t.Fatalf("put: %d %s", rec.Code, rec.Body)
	}
	if rec := call(t, h, "PUT", "/disk-limits", strings.NewReader(`{"limits":{"../etc":1}}`)); rec.Code != 400 {
		t.Fatalf("bad id: %d", rec.Code)
	}
	b := &agent{stateDir: a.stateDir}
	b.loadDiskLimits()
	if b.diskLimit("abc12345") != 2048<<20 || b.diskLimit("def12345") != 10240<<20 || b.diskLimit("zzz12345") != 0 {
		t.Fatalf("loaded %v", b.diskLimits)
	}
	// A new list replaces the old one.
	call(t, h, "PUT", "/disk-limits", strings.NewReader(`{"limits":{"def12345":20480}}`))
	if a.diskLimit("abc12345") != 0 || a.diskLimit("def12345") != 20480<<20 {
		t.Fatalf("replaced %v", a.diskLimits)
	}
}
