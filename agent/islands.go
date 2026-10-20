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
//
// It then downloads the packLibs a Fabric mod in the pack requires but no jar
// provides. Some packs don't list them for servers at all, so
// MODRINTH_FORCE_INCLUDE_FILES can't bring them in (Better MC: TerraBlender,
// Balm and FTB Library, the last of which isn't on Modrinth).
//
// On Forge it also takes out the mods Forge last refused to load because a mod
// they require isn't installed: a pack can leave the required mod out
// altogether (Better MC Forge has Twilight Cave Fix but no Twilight Forest).
// The names come from Forge's own crash report, so only mods that really
// can't load go. The image puts them back on every start, so the list in
// .mchost-pack-removed is kept until the pack's version changes.
var packScript = `#!/bin/bash
for jar in mods/{` + strings.Join(packExcludes, ",") + `}*.jar; do
  [ -f "$jar" ] && rm -f "$jar" && echo "[mchost] removed $jar (a player-side mod that stops servers)"
done
list=.mchost-pack-removed
if [ ! -f $list ]; then
  echo "version $MODRINTH_VERSION" >$list && touch -d @0 $list # crash reports from before count too
elif [ "$(head -1 $list)" != "version $MODRINTH_VERSION" ]; then
  echo "version $MODRINTH_VERSION" >$list
fi
if [ -d crash-reports ]; then
  found=$(find crash-reports -name 'crash-*-fml.txt' -newer $list -exec awk '
    /Mod File:/ { f = $0; sub(/.*Mod File:[ \t]*/, "", f); sub(/#.*/, "", f); sub(/.*\//, "", f) }
    /Failure message:.* requires / { getline n; if (n ~ /is not installed/ && f != "") print f }' {} +)
  [ -n "$found" ] && sort -u <(tail -n +2 $list) <(echo "$found") | { read -r v <$list; echo "$v"; cat; } >$list.new && mv $list.new $list
fi
tail -n +2 $list | while read -r jar; do
  [ -f "mods/$jar" ] && rm -f "mods/$jar" && echo "[mchost] removed mods/$jar (it needs a mod the pack doesn't have)"
done
if [ -d mods ] && [ ! -d libraries/net/minecraftforge ] && [ ! -d libraries/net/neoforged ] && command -v unzip >/dev/null && command -v jq >/dev/null && command -v curl >/dev/null; then
  have=" " need=" "
  for jar in mods/*.jar; do
    meta=$(unzip -p "$jar" fabric.mod.json 2>/dev/null) || continue
    have+="$(jq -r '([.id] + (.provides // [])) | join(" ")' <<<"$meta" 2>/dev/null) "
    need+="$(jq -r '(.depends // {}) | keys | join(" ")' <<<"$meta" 2>/dev/null) "
  done
  # FTB's mods need FTB Library, but a jar whose fabric.mod.json jq can't read
  # hides that (Better MC: certain_questing_additions only names ftbquests).
  [[ "$have$need" =~ " "ftb(quests|teams|chunks|essentials)" " ]] && need+="ftblibrary "
  for lib in ` + strings.Join(packLibs, " ") + `; do
    [[ "$need" == *" $lib "* && "$have" != *" $lib "* ]] || continue
    case $lib in
      ftblibrary)
        # FTB numbers its versions after Minecraft's: 2001.x is for 1.20.1.
        p=$(awk -F. '{printf "%d%02d", $2, $3}' <<<"$VERSION")
        v=$(curl -fsS https://maven.ftb.dev/releases/dev/ftb/mods/ftb-library-fabric/maven-metadata.xml | grep -o "<version>$p\.[^<]*" | sed 's/<version>//' | sort -V | tail -1)
        url= file=
        [ -n "$v" ] && url=https://maven.ftb.dev/releases/dev/ftb/mods/ftb-library-fabric/$v/ftb-library-fabric-$v.jar file=ftb-library-fabric-$v.jar ;;
      *)
        read -r url file < <(curl -fsS "https://api.modrinth.com/v2/project/${lib%-fabric}/version?loaders=%5B%22fabric%22%5D&game_versions=%5B%22$VERSION%22%5D" |
          jq -r '[.[0].files[] | select(.primary)][0] | .url + " " + .filename' 2>/dev/null) ;;
    esac
    if [ -n "$url" ] && curl -fsSL -o "mods/$file" "$url"; then
      echo "[mchost] added mods/$file (needed by the pack's mods)"
      have+="$lib ${lib%-fabric} $lib-fabric "
    else
      [ -n "$file" ] && rm -f "mods/$file"
      echo "[mchost] could not download $lib for $VERSION"
    fi
  done
fi
exit 0
`

const packScriptPath = "/tmp/mchost-pack"

// packEntrypoint puts packScript where PRE_START_SCRIPT points, then starts the image as usual.
var packEntrypoint = []string{"/bin/bash", "-c", "cat >" + packScriptPath + " <<'MCHOST'\n" + packScript +
	"MCHOST\nchmod 755 " + packScriptPath + "\nexec /image/scripts/start\n"}
