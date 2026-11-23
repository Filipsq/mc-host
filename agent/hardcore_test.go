package main

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"io"
	"os"
	"path/filepath"
	"testing"
)

// nbtName is a tag's type and name as NBT writes them.
func nbtName(t byte, name string) []byte {
	b := []byte{t, 0, 0}
	binary.BigEndian.PutUint16(b[1:], uint16(len(name)))
	return append(b, name...)
}

// testLevelDat is a level.dat like a server writes: other tags of every kind
// before Data.hardcore, so finding it has to step over them.
func testLevelDat(hardcore byte) []byte {
	var b []byte
	b = append(b, nbtName(10, "")...)
	b = append(b, nbtName(10, "Data")...)
	b = append(b, nbtName(8, "LevelName")...)
	b = append(b, 0, 5, 'w', 'o', 'r', 'l', 'd')
	b = append(b, nbtName(4, "Time")...)
	b = append(b, 0, 0, 0, 0, 0, 0, 1, 0)
	b = append(b, nbtName(11, "spawn")...)
	b = append(b, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 2)
	b = append(b, nbtName(9, "ServerBrands")...)
	b = append(b, 8, 0, 0, 0, 1, 0, 5, 'p', 'a', 'p', 'e', 'r')
	b = append(b, nbtName(10, "Player")...)
	b = append(b, nbtName(1, "hardcore")...) // not the world's: inside Player
	b = append(b, 1)
	b = append(b, nbtName(9, "Inventory")...)
	b = append(b, 10, 0, 0, 0, 1)
	b = append(b, nbtName(1, "Slot")...)
	b = append(b, 3, 0)
	b = append(b, 0) // end Player
	b = append(b, nbtName(3, "Difficulty")...)
	b = append(b, 0, 0, 0, 3)
	b = append(b, nbtName(1, "hardcore")...)
	b = append(b, hardcore)
	b = append(b, nbtName(1, "allowCommands")...)
	b = append(b, 0)
	b = append(b, 0, 0) // end Data, end root
	return b
}

func gz(t *testing.T, b []byte) []byte {
	var out bytes.Buffer
	w := gzip.NewWriter(&out)
	w.Write(b)
	w.Close()
	return out.Bytes()
}

func TestSetWorldHardcore(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "world"), 0o755)
	os.WriteFile(filepath.Join(dir, "world/level.dat"), gz(t, testLevelDat(1)), 0o644)
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	s := &serverFiles{id: "abc12345", root: root, dir: dir, uid: os.Getuid(), gid: os.Getgid()}
	defer s.Close()

	read := func() []byte {
		f, _ := os.Open(filepath.Join(dir, "world/level.dat"))
		defer f.Close()
		zr, err := gzip.NewReader(f)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(zr)
		return b
	}

	if changed, err := s.setWorldHardcore("world/level.dat", true); err != nil || changed {
		t.Fatalf("already hardcore: changed=%v err=%v", changed, err)
	}
	if changed, err := s.setWorldHardcore("world/level.dat", false); err != nil || !changed {
		t.Fatalf("turning off: changed=%v err=%v", changed, err)
	}
	if got := read(); !bytes.Equal(got, testLevelDat(0)) {
		t.Fatalf("level.dat after turning off:\n%v\nwant\n%v", got, testLevelDat(0))
	}
	if changed, err := s.setWorldHardcore("world/level.dat", false); err != nil || changed {
		t.Fatalf("already off: changed=%v err=%v", changed, err)
	}
	if changed, err := s.setWorldHardcore("world/level.dat", true); err != nil || !changed || !bytes.Equal(read(), testLevelDat(1)) {
		t.Fatalf("turning on: changed=%v err=%v", changed, err)
	}

	// No world yet: the server makes it from server.properties.
	if changed, err := s.setWorldHardcore("other/level.dat", false); err != nil || changed {
		t.Errorf("no world: changed=%v err=%v", changed, err)
	}
}

func TestFindHardcoreBadNBT(t *testing.T) {
	good := testLevelDat(1)
	for i := range len(good) - 1 {
		findHardcore(good[:i]) // cut short anywhere: an error, never a panic
	}
	for _, b := range [][]byte{
		nil,
		{8, 0, 0},
		append(nbtName(10, ""), append(nbtName(9, "x"), 1, 0x7f, 0xff, 0xff, 0xff)...),
		append(nbtName(10, ""), append(nbtName(7, "x"), 0x80, 0, 0, 0)...),
		append(nbtName(10, ""), append(nbtName(10, "Data"), 0, 0)...),
	} {
		if _, err := findHardcore(b); err == nil {
			t.Errorf("%v: no error", b)
		}
	}
}
