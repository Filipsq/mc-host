package main

import (
	"context"
	"errors"
	"io/fs"
	"log"
	"syscall"
)

// ownerFixMax bounds the walk, so a huge world can't hold up its start.
const ownerFixMax = 300_000

var errOwnerWalkDone = errors.New("walked enough")

// fixOwners hands files root owns to the owner of the server's folder before
// it starts. The images run the game as that owner, so a root file left by
// an earlier run as root (Bedrock's own files after its folder was given to
// uid 1000) or by a root script can't be replaced, and the server stops at
// start with "Permission denied". A folder root owns itself is left alone:
// its game runs as root.
func (a *agent) fixOwners(ctx context.Context, id string) {
	if a.volumesDir == "" {
		return
	}
	s, err := a.openFiles(ctx, id)
	if err != nil {
		return
	}
	defer s.Close()
	if s.uid == 0 {
		return
	}
	fixed, seen := 0, 0
	err = fs.WalkDir(s.root.FS(), ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // unreadable: skip it, keep going
		}
		if seen++; seen > ownerFixMax {
			return errOwnerWalkDone
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if st, ok := info.Sys().(*syscall.Stat_t); ok && st.Uid == 0 {
			if err := s.root.Lchown(p, s.uid, s.gid); err == nil {
				fixed++
			}
		}
		return nil
	})
	if err != nil && !errors.Is(err, errOwnerWalkDone) {
		log.Printf("owners %s: %v", id, err)
	}
	if fixed > 0 {
		log.Printf("owners %s: gave %d root files to %d:%d", id, fixed, s.uid, s.gid)
	}
}
