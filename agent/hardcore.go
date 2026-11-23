package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"log"
	"path"
	"strings"
)

// A Java world keeps "hardcore" in its level.dat, and once the world exists
// the server goes by that, not by server.properties: unticking Hardcore in the
// panel's Settings changed the file but the world stayed hardcore (players who
// died still became spectators). Unlike difficulty there's no command for it,
// so before each start, while the server is stopped, the agent sets the flag
// in level.dat to the one from the settings.
func (a *agent) syncHardcore(ctx context.Context, id string) {
	if a.volumesDir == "" || a.docker == nil {
		return
	}
	info, err := a.docker.InspectContainer(ctx, containerName(id))
	if err != nil || info.State.Status == "running" {
		return // a running server would write its own level.dat over ours
	}
	var want bool
	switch strings.ToLower(envValue(info.Config.Env, "HARDCORE")) {
	case "true":
		want = true
	case "false":
	default:
		return // not a Java server
	}
	s, err := a.openFiles(ctx, id)
	if err != nil {
		return
	}
	defer s.Close()
	level := envValue(info.Config.Env, "LEVEL")
	if level == "" {
		level = "world"
	}
	changed, err := s.setWorldHardcore(path.Clean(level)+"/level.dat", want)
	if err != nil {
		log.Printf("hardcore %s: %v", id, err)
	} else if changed {
		log.Printf("hardcore %s: set hardcore=%v in %s/level.dat", id, want, level)
	}
}

// setWorldHardcore sets Data.hardcore in a gzipped level.dat, reporting
// whether it had to change. A world not made yet (no level.dat) is left to the
// server, which makes it from server.properties.
func (s *serverFiles) setWorldHardcore(name string, want bool) (bool, error) {
	if strings.HasPrefix(name, "../") || name == ".." {
		return false, errBadPath
	}
	f, err := s.root.Open(name)
	if err != nil {
		return false, nil
	}
	zr, err := gzip.NewReader(io.LimitReader(f, 64<<20))
	if err != nil {
		f.Close()
		return false, err
	}
	data, err := io.ReadAll(io.LimitReader(zr, 64<<20))
	f.Close()
	if err != nil {
		return false, err
	}
	at, err := findHardcore(data)
	if err != nil {
		return false, err
	}
	var v byte
	if want {
		v = 1
	}
	if (data[at] != 0) == want {
		return false, nil
	}
	data[at] = v
	var out bytes.Buffer
	zw := gzip.NewWriter(&out)
	if _, err := zw.Write(data); err != nil {
		return false, err
	}
	if err := zw.Close(); err != nil {
		return false, err
	}
	if _, err := s.writeFile(name, &out); err != nil {
		return false, err
	}
	return true, nil
}

var errNoHardcore = errors.New("level.dat has no Data.hardcore")

// findHardcore is where the value of the byte tag Data.hardcore is in an
// uncompressed level.dat (NBT: a root compound holding the compound Data).
func findHardcore(b []byte) (int, error) {
	r := &nbtReader{b: b}
	t, err := r.u8()
	if err != nil || t != nbtCompound {
		return 0, errNoHardcore
	}
	if _, err := r.str(); err != nil {
		return 0, err
	}
	for _, want := range []struct {
		name string
		tag  byte
	}{{"Data", nbtCompound}, {"hardcore", nbtByte}} {
		if err := r.findInCompound(want.name, want.tag); err != nil {
			return 0, err
		}
	}
	if r.p >= len(b) {
		return 0, errNoHardcore
	}
	return r.p, nil
}

const (
	nbtEnd      = 0
	nbtByte     = 1
	nbtList     = 9
	nbtCompound = 10
	nbtMaxDepth = 512
)

var errBadNBT = errors.New("level.dat is not valid NBT")

type nbtReader struct {
	b []byte
	p int
}

func (r *nbtReader) take(n int) ([]byte, error) {
	if n < 0 || r.p+n > len(r.b) {
		return nil, errBadNBT
	}
	out := r.b[r.p : r.p+n]
	r.p += n
	return out, nil
}

func (r *nbtReader) u8() (byte, error) {
	b, err := r.take(1)
	if err != nil {
		return 0, err
	}
	return b[0], nil
}

func (r *nbtReader) i32() (int, error) {
	b, err := r.take(4)
	if err != nil {
		return 0, err
	}
	return int(int32(binary.BigEndian.Uint32(b))), nil
}

func (r *nbtReader) str() (string, error) {
	b, err := r.take(2)
	if err != nil {
		return "", err
	}
	s, err := r.take(int(binary.BigEndian.Uint16(b)))
	return string(s), err
}

// findInCompound reads the tags of the compound it's in until the one named
// name with type tag, leaving r at that tag's value.
func (r *nbtReader) findInCompound(name string, tag byte) error {
	for {
		t, err := r.u8()
		if err != nil {
			return err
		}
		if t == nbtEnd {
			return errNoHardcore
		}
		n, err := r.str()
		if err != nil {
			return err
		}
		if n == name && t == tag {
			return nil
		}
		if err := r.skip(t, 0); err != nil {
			return err
		}
	}
}

// skip moves past the value of a tag of type t.
func (r *nbtReader) skip(t byte, depth int) error {
	if depth > nbtMaxDepth {
		return errBadNBT
	}
	var err error
	switch t {
	case 1:
		_, err = r.take(1)
	case 2:
		_, err = r.take(2)
	case 3, 5:
		_, err = r.take(4)
	case 4, 6:
		_, err = r.take(8)
	case 7, 11, 12: // byte, int and long arrays
		var n int
		if n, err = r.i32(); err == nil {
			_, err = r.take(n * map[byte]int{7: 1, 11: 4, 12: 8}[t])
		}
	case 8:
		_, err = r.str()
	case nbtList:
		var et byte
		var n int
		if et, err = r.u8(); err != nil {
			return err
		}
		if n, err = r.i32(); err != nil {
			return err
		}
		for i := 0; i < n && err == nil; i++ {
			err = r.skip(et, depth+1)
		}
	case nbtCompound:
		for {
			var ct byte
			if ct, err = r.u8(); err != nil || ct == nbtEnd {
				break
			}
			if _, err = r.str(); err != nil {
				break
			}
			if err = r.skip(ct, depth+1); err != nil {
				break
			}
		}
	default:
		err = errBadNBT
	}
	return err
}
