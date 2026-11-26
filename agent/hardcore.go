package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"io/fs"
	"log"
	"path"
	"strings"
)

// A Java world keeps "hardcore" in its level.dat, and once the world exists
// the server goes by that, not by server.properties: unticking Hardcore in the
// panel's Settings changed the file but the world stayed hardcore (players who
// died still became spectators). Unlike difficulty there's no command for it,
// so before each start, while the server is stopped, the agent sets the flag
// in level.dat to the one from the settings. When it turns hardcore off, the
// players who died in it (left in spectator mode, which each player's own file
// keeps) are put back in survival.
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
	level = path.Clean(level)
	changed, err := s.setWorldHardcore(level+"/level.dat", want)
	if err != nil {
		log.Printf("hardcore %s: %v", id, err)
		return
	}
	if !changed {
		return
	}
	log.Printf("hardcore %s: set hardcore=%v in %s/level.dat", id, want, level)
	if !want {
		if n := s.reviveSpectators(level); n > 0 {
			log.Printf("hardcore %s: put %d players in spectator mode back in survival", id, n)
		}
	}
}

// setWorldHardcore sets the hardcore flag in a gzipped level.dat, reporting
// whether it had to change. A world not made yet (no level.dat) is left to the
// server, which makes it from server.properties.
func (s *serverFiles) setWorldHardcore(name string, want bool) (bool, error) {
	data, err := s.readNBT(name)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	at, err := findHardcore(data)
	if err != nil {
		return false, err
	}
	if (data[at] != 0) == want {
		return false, nil
	}
	data[at] = 0
	if want {
		data[at] = 1
	}
	return true, s.writeNBT(name, data)
}

// reviveSpectators puts every player of the world in spectator mode back in
// survival, returning how many. 26.1+ keeps players in players/data, older
// versions in playerdata.
func (s *serverFiles) reviveSpectators(level string) int {
	n := 0
	for _, dir := range []string{level + "/players/data", level + "/playerdata"} {
		f, err := s.root.Open(dir)
		if err != nil {
			continue
		}
		names, _ := f.Readdirnames(-1)
		f.Close()
		for _, name := range names {
			if !strings.HasSuffix(name, ".dat") {
				continue
			}
			p := dir + "/" + name
			data, err := s.readNBT(p)
			if err != nil {
				continue
			}
			at, err := findRootTag(data, "playerGameType", nbtIntTag)
			if err != nil || binary.BigEndian.Uint32(data[at:]) != 3 { // 3 = spectator
				continue
			}
			binary.BigEndian.PutUint32(data[at:], 0) // survival
			if err := s.writeNBT(p, data); err != nil {
				log.Printf("hardcore %s %s: %v", s.id, p, err)
				continue
			}
			n++
		}
	}
	return n
}

// readNBT reads a gzipped NBT file (level.dat, a player's .dat).
func (s *serverFiles) readNBT(name string) ([]byte, error) {
	f, err := s.root.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	zr, err := gzip.NewReader(io.LimitReader(f, 64<<20))
	if err != nil {
		return nil, err
	}
	return io.ReadAll(io.LimitReader(zr, 64<<20))
}

// writeNBT writes data gzipped over name, in place of the file.
func (s *serverFiles) writeNBT(name string, data []byte) error {
	var out bytes.Buffer
	zw := gzip.NewWriter(&out)
	if _, err := zw.Write(data); err != nil {
		return err
	}
	if err := zw.Close(); err != nil {
		return err
	}
	_, err := s.writeFile(name, &out)
	return err
}

var errNoHardcore = errors.New("level.dat has no hardcore flag")

// findHardcore is where the value of the world's hardcore byte is in an
// uncompressed level.dat (NBT: a root compound holding the compound Data).
// Up to 1.21.11 it is Data.hardcore; 26.1 moved it to
// Data.difficulty_settings.hardcore, next to the difficulty.
func findHardcore(b []byte) (int, error) {
	r := &nbtReader{b: b}
	if err := r.enterRoot(); err != nil {
		return 0, err
	}
	if err := r.findInCompound("Data", nbtCompound); err != nil {
		return 0, err
	}
	for {
		t, name, err := r.next()
		if err != nil {
			return 0, err
		}
		switch {
		case t == nbtByte && name == "hardcore":
			return r.p, nil
		case t == nbtCompound && name == "difficulty_settings":
			if err := r.findInCompound("hardcore", nbtByte); err != nil {
				return 0, err
			}
			return r.p, nil
		}
		if err := r.skip(t, 0); err != nil {
			return 0, err
		}
	}
}

// findRootTag is where the value of the root compound's tag name is.
func findRootTag(b []byte, name string, tag byte) (int, error) {
	r := &nbtReader{b: b}
	if err := r.enterRoot(); err != nil {
		return 0, err
	}
	if err := r.findInCompound(name, tag); err != nil {
		return 0, err
	}
	if _, err := r.take(map[byte]int{nbtByte: 1, nbtIntTag: 4}[tag]); err != nil {
		return 0, err
	}
	return r.p - map[byte]int{nbtByte: 1, nbtIntTag: 4}[tag], nil
}

const (
	nbtEnd      = 0
	nbtByte     = 1
	nbtIntTag   = 3
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

// enterRoot reads the root compound's type and name, leaving r at its first tag.
func (r *nbtReader) enterRoot() error {
	t, err := r.u8()
	if err != nil || t != nbtCompound {
		return errBadNBT
	}
	_, err = r.str()
	return err
}

// next reads the type and name of the next tag of the compound r is in;
// errNoHardcore at its end.
func (r *nbtReader) next() (byte, string, error) {
	t, err := r.u8()
	if err != nil {
		return 0, "", err
	}
	if t == nbtEnd {
		return 0, "", errNoHardcore
	}
	n, err := r.str()
	return t, n, err
}

// findInCompound reads the tags of the compound it's in until the one named
// name with type tag, leaving r at that tag's value.
func (r *nbtReader) findInCompound(name string, tag byte) error {
	for {
		t, n, err := r.next()
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
