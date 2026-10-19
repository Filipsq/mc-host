package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImportNeedsSizeAndNoServerHere(t *testing.T) {
	h, a, _ := filesAgent(t)
	a.backupDir = t.TempDir()
	// Streamed without a size, it can't check the disk has room.
	req := strings.NewReader("x")
	rec := call(t, h, http.MethodPut, "/servers/abc12345/import", struct{ *strings.Reader }{req})
	if rec.Code != http.StatusInsufficientStorage {
		t.Fatalf("import without a size: %d %s", rec.Code, rec.Body)
	}
	// Exporting a server this machine doesn't have.
	if rec := call(t, h, http.MethodGet, "/servers/abc12345/export", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("export of a missing server: %d %s", rec.Code, rec.Body)
	}
}

func TestBackupUpload(t *testing.T) {
	h, a, _ := filesAgent(t)
	a.backupDir = t.TempDir()
	rec := call(t, h, http.MethodPut, "/servers/abc12345/backups/20261019-120000.tar.gz", strings.NewReader("backup"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: %d %s", rec.Code, rec.Body)
	}
	got, err := os.ReadFile(filepath.Join(a.backupDir, "abc12345", "20261019-120000.tar.gz"))
	if err != nil || string(got) != "backup" {
		t.Fatalf("saved %q, %v", got, err)
	}
	if rec := call(t, h, http.MethodPut, "/servers/abc12345/backups/..%2Fx.tar.gz", strings.NewReader("x")); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad name: %d", rec.Code)
	}
}
