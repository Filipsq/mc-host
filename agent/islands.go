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

// BentoBox loads its game modes (AOneBlock, BSkyBlock) and its other add-ons
// only from plugins/BentoBox/addons, but the image puts everything it gets
// from Modrinth in plugins/, where an add-on loads as an empty plugin: the game
// mode never starts, so there's no island world and no /ob or /island, and
// players stay in the ordinary world. The image runs a script of ours
// (PRE_START_SCRIPT) after its downloads and just before the server starts;
// addonsScript moves the add-ons to BentoBox's folder there. The image
// downloads them into plugins/ again on every start, so the script replaces
// the ones it moved the time before, which also brings in newer versions. It
// never keeps the server from starting.
const addonsScript = `#!/bin/bash
addons=plugins/BentoBox/addons
moved=$addons/.mchost-moved
mkdir -p "$addons" || exit 0
has() {
  if command -v unzip >/dev/null; then unzip -Z1 "$1" 2>/dev/null | grep -qxF "$2"; else grep -qaF "$2" "$1"; fi
}
new=()
for jar in plugins/*.jar; do
  [ -f "$jar" ] || continue
  # An add-on has an addon.yml; BentoBox itself, which loads them, stays put.
  if has "$jar" addon.yml && ! has "$jar" world/bentobox/bentobox/BentoBox.class; then
    name=${jar##*/}
    if mv -f "$jar" "$addons/$name"; then
      new+=("$name")
      echo "[mchost] $name moved to $addons, where BentoBox loads it"
    fi
  fi
done
if [ ${#new[@]} -gt 0 ]; then
  if [ -f "$moved" ]; then
    while IFS= read -r old; do
      [ -n "$old" ] || continue
      for n in "${new[@]}"; do [ "$n" = "$old" ] && continue 2; done
      rm -f "$addons/$old"
    done <"$moved"
  fi
  printf '%s\n' "${new[@]}" >"$moved"
fi
exit 0
`

const addonsScriptPath = "/tmp/mchost-addons"

// islandsEntrypoint puts addonsScript where PRE_START_SCRIPT points, then starts the image as usual.
var islandsEntrypoint = []string{"/bin/bash", "-c", "cat >" + addonsScriptPath + " <<'MCHOST'\n" + addonsScript +
	"MCHOST\nchmod 755 " + addonsScriptPath + "\nexec /image/scripts/start\n"}

// packScript takes packExcludes out of a Modrinth pack's mods just before the
// server starts. MODRINTH_EXCLUDE_FILES only covers the files the pack has the
// image download; a pack can also carry a mod inside its own zip ("overrides"),
// which the image copies in again on every start (Better MC does this with
// Missing Mods Checker).
var packScript = `#!/bin/bash
for jar in mods/{` + strings.Join(packExcludes, ",") + `}*.jar; do
  [ -f "$jar" ] && rm -f "$jar" && echo "[mchost] removed $jar (a player-side mod that stops servers)"
done
exit 0
`

const packScriptPath = "/tmp/mchost-pack"

// packEntrypoint puts packScript where PRE_START_SCRIPT points, then starts the image as usual.
var packEntrypoint = []string{"/bin/bash", "-c", "cat >" + packScriptPath + " <<'MCHOST'\n" + packScript +
	"MCHOST\nchmod 755 " + packScriptPath + "\nexec /image/scripts/start\n"}
