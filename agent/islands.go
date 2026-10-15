package main

import (
	"context"
	"io"
	"log"
	"regexp"
	"strings"
)

// Skyblock and OneBlock run on BentoBox, whose islands live in a world of
// their own: a player who joins lands in the server's ordinary world and gets
// an island only by typing /island or /ob. BentoBox can make every new
// player's island as they first join and take them there; prepareIslands turns
// that on. On a new server it writes just that part of the game mode's
// settings, which BentoBox fills in with the rest on its first start; on one
// that already has its settings, it switches the setting on once, so an owner
// who turns it off again keeps it off.

var islandAddons = map[string]string{"skyblock": "BSkyBlock", "oneblock": "AOneBlock"}

const islandsConfig = `island:
  create-island-on-first-login:
    enable: true
    delay: 2
    abort-on-logout: true
`

// The setting in a file BentoBox wrote: "enable: false" under create-island-on-first-login.
var firstLoginOff = regexp.MustCompile(`(?m)^(\s*create-island-on-first-login:\s*\n(?:\s*#.*\n)*\s+enable:\s*)false\b`)

func (a *agent) prepareIslands(ctx context.Context, id, kind string) {
	addon := islandAddons[kind]
	if addon == "" || a.volumesDir == "" {
		return
	}
	s, err := a.openFiles(ctx, id)
	if err != nil {
		log.Printf("island settings %s: %v", id, err)
		return
	}
	defer s.Close()
	dir := "plugins/BentoBox/addons/" + addon
	name, marker := dir+"/config.yml", dir+"/.mchost-first-login"
	if _, err := s.root.Lstat(marker); err == nil {
		return // done before; the owner's choice since then stands
	}
	text := islandsConfig
	if f, err := s.root.Open(name); err == nil {
		b, err := io.ReadAll(io.LimitReader(f, 1<<20))
		f.Close()
		if err != nil {
			log.Printf("island settings %s: %v", id, err)
			return
		}
		text = firstLoginOff.ReplaceAllString(string(b), "${1}true")
	}
	if _, err := s.writeFile(name, strings.NewReader(text)); err != nil {
		log.Printf("island settings %s: %v", id, err)
		return
	}
	if _, err := s.writeFile(marker, strings.NewReader("")); err != nil {
		log.Printf("island settings %s: %v", id, err)
	}
}
