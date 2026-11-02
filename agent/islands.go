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
// Same for a player-only mod the pack marks for servers, which Forge stops on
// with "invalid dist DEDICATED_SERVER" (Create+ 1.19.2: Barista).
// The names come from Forge's own crash report, so only mods that really
// can't load go. The image puts them back on every start, so the list in
// .mchost-pack-removed is kept until the pack's version changes.
//
// It then gives the server the FTB mods (Quests, Teams...) the pack lists for
// players only, in the players' exact builds, and adds Chunky, which the agent uses to generate the map ahead
// (pregen.go): big packs build new chunks slowly while people play.
//
// Last, loginScript adds the password login mod on a non-premium pack.
var packScript = `#!/bin/bash
shopt -s nocaseglob # jars are named any which way (Barsita-1.19.2-1.1.2.jar)
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
    /^-- / { f = "" }
    /Mod File:/ { f = $0; sub(/.*Mod File:[ \t]*/, "", f); sub(/#.*/, "", f); sub(/.*\//, "", f) }
    /Failure message:.* requires / { getline n; if (n ~ /is not installed/ && f != "") print f }
    /invalid dist DEDICATED_SERVER/ { if (f != "") print f }' {} +)
  [ -n "$found" ] && sort -u <(tail -n +2 $list) <(echo "$found") | { read -r v <$list; echo "$v"; cat; } >$list.new && mv $list.new $list
fi
tail -n +2 $list | while read -r jar; do
  [ -f "mods/$jar" ] && rm -f "mods/$jar" && echo "[mchost] removed mods/$jar (it stopped the server from starting)"
done
if [ -d libraries/net/neoforged ]; then loader=neoforge; elif [ -d libraries/net/minecraftforge ]; then loader=forge; else loader=fabric; fi
if [ -d mods ] && ! ls mods | grep -qi '^chunky' && command -v jq >/dev/null && command -v curl >/dev/null; then
  read -r url file < <(curl -fsS "https://api.modrinth.com/v2/project/chunky/version?loaders=%5B%22$loader%22%5D&game_versions=%5B%22$VERSION%22%5D" |
    jq -r '[.[0].files[] | select(.primary)][0] | .url + " " + .filename' 2>/dev/null)
  if [ -n "$url" ] && curl -fsSL -o "mods/$file" "$url"; then
    echo "[mchost] added mods/$file (generates the map ahead while nobody plays)"
  else
    [ -n "$file" ] && rm -f "mods/$file"
  fi
fi
# FTB's mods aren't on Modrinth, so a pack lists them for players only and the
# server goes without them (Better MC: FTB Quests, Teams, XMod Compat, Filter
# System and Item Filters; the quest book stays empty or locked). The pack's
# own index says which builds players have, and the server gets the same
# files, replacing other builds of them. The list is read once per pack version.
if [ -d mods ] && [ -n "$MODRINTH_VERSION" ] && command -v unzip >/dev/null && command -v jq >/dev/null && command -v curl >/dev/null; then
  idx=.mchost-pack-ftb
  if [ ! -f $idx ] || [ "$(head -1 $idx)" != "version $MODRINTH_VERSION" ]; then
    tmp=$(mktemp)
    mrpack=$(curl -fsS "https://api.modrinth.com/v2/version/$MODRINTH_VERSION" | jq -r '([.files[] | select(.primary)] + .files)[0].url' 2>/dev/null)
    if [ -n "$mrpack" ] && [ "$mrpack" != null ] && curl -fsSL -o "$tmp" "$mrpack" &&
      list=$(unzip -p "$tmp" modrinth.index.json | jq -r '.files[] | select(.path | test("^mods/(ftb-|item-filters)[^/]*\\.jar$")) | (.path | ltrimstr("mods/")) + " " + .downloads[0]'); then
      printf 'version %s\n%s\n' "$MODRINTH_VERSION" "$list" >$idx
    fi
    rm -f "$tmp"
  fi
  [ -f $idx ] && tail -n +2 $idx | while read -r file url; do
    case "$file" in */*|"") continue ;; esac
    [ -f "mods/$file" ] && continue
    if [ -n "$url" ] && curl -fsSL -o "mods/$file.part" "$url" && mv "mods/$file.part" "mods/$file"; then
      echo "[mchost] added mods/$file (players have it from the pack; the server needs it too)"
      base=${file%%-[0-9]*}
      for old in mods/"$base"-[0-9]*.jar; do
        [ "$old" != "mods/$file" ] && [ -f "$old" ] && rm -f "$old" && echo "[mchost] removed $old (players have mods/$file)"
      done
    else
      rm -f "mods/$file.part"
      echo "[mchost] could not download $file"
    fi
  done
fi
if [ -d mods ] && [ ! -d libraries/net/minecraftforge ] && [ ! -d libraries/net/neoforged ] && command -v unzip >/dev/null && command -v jq >/dev/null && command -v curl >/dev/null; then
  have=" " need=" "
  for jar in mods/*.jar; do
    meta=$(unzip -p "$jar" fabric.mod.json 2>/dev/null) || continue
    have+="$(jq -r '([.id] + (.provides // [])) | join(" ")' <<<"$meta" 2>/dev/null) "
    need+="$(jq -r '(.depends // {}) | keys | join(" ")' <<<"$meta" 2>/dev/null) "
  done
  # FTB's own jars have fabric.mod.json files jq can't read, so they're known by name too.
  for jar in mods/*.jar; do
    case "${jar,,}" in
      mods/ftb-library*|mods/ftblibrary*) have+="ftblibrary " ;;
      mods/ftb-quests*|mods/ftbquests*) have+="ftbquests " ;;
      mods/ftb-teams*|mods/ftbteams*) have+="ftbteams " ;;
    esac
  done
  # FTB Quests runs on FTB Teams, and FTB's mods need FTB Library, but their
  # unreadable fabric.mod.json hides that (Better MC: certain_questing_additions
  # only names ftbquests). Better MC from Modrinth leaves FTB Quests and Teams
  # off the server, so the quest book stays empty ("no quest book data
  # received from server").
  [[ "$have$need" =~ " "ftbquests" " ]] && need+="ftbquests ftbteams "
  [[ "$have$need" =~ " "ftb(quests|teams|chunks|essentials)" " ]] && need+="ftblibrary "
  for lib in ` + strings.Join(packLibs, " ") + `; do
    [[ "$need" == *" $lib "* && "$have" != *" $lib "* ]] || continue
    case $lib in
      ftblibrary|ftbquests|ftbteams)
        # Not on Modrinth; from FTB's own Maven, which numbers versions after Minecraft's: 2001.x is for 1.20.1.
        a=ftb-${lib#ftb}-fabric
        p=$(awk -F. '{printf "%d%02d", $2, $3}' <<<"$VERSION")
        v=$(curl -fsS https://maven.ftb.dev/releases/dev/ftb/mods/$a/maven-metadata.xml | grep -o "<version>$p\.[^<]*" | sed 's/<version>//' | sort -V | tail -1)
        url= file=
        [ -n "$v" ] && url=https://maven.ftb.dev/releases/dev/ftb/mods/$a/$v/$a-$v.jar file=$a-$v.jar ;;
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
` + loginScript + `exit 0
`

const packScriptPath = "/tmp/mchost-pack"

// unfinishedWorldScript runs before every Java start. Minecraft 26.1+ writes a
// new world's dimensions/ before its level.dat, so a first start cut short (a
// plugin added or a setting saved while the world is being made) leaves a
// folder Paper then always stops on ("Unable to read or access the world gen
// settings file"). Nobody has played in it, so it's moved aside and the server
// makes the world again; a folder with players in it is left alone.
const unfinishedWorldScript = `(
  cd /data 2>/dev/null || exit 0
  w=${LEVEL:-world}
  if [ -d "$w/dimensions" ] && [ ! -e "$w/level.dat" ] && [ ! -e "$w/players" ] && [ ! -e "$w/playerdata" ]; then
    to="$w-przerwany-$(date +%Y%m%d-%H%M%S)"
    mv "$w" "$to" && echo "[mchost] $w was never finished; moved it to $to so a new one is made"
  fi
  # Paper keeps a world's world-wide files in each dimension's folder; vanilla,
  # Fabric, Forge and NeoForge read them from data/minecraft and stop without
  # them ("Overworld settings missing"). A world made on Paper gets a copy.
  o="$w/dimensions/minecraft/overworld/data"
  if [ "$TYPE" != PAPER ] && [ -d "$o/paper" ] && [ -e "$o/minecraft/world_gen_settings.dat" ] && [ ! -e "$w/data/minecraft/world_gen_settings.dat" ]; then
    mkdir -p "$w/data/minecraft" && chown "$(stat -c %u:%g .)" "$w/data" "$w/data/minecraft"
    for f in world_gen_settings game_rules weather wandering_trader scheduled_events; do
      [ -e "$o/minecraft/$f.dat" ] && [ ! -e "$w/data/minecraft/$f.dat" ] && cp -p "$o/minecraft/$f.dat" "$w/data/minecraft/"
    done
    echo "[mchost] $w was made on Paper; copied its world settings to $w/data/minecraft"
  fi
  # Java players come in through our router, so the server sees one private
  # address for all of them, and an IP ban on it (ban-ip) shuts everyone out.
  # Such bans are lifted at every start; bans by name stay.
  f=banned-ips.json
  if [ -s "$f" ] && command -v jq >/dev/null; then
    keep='[.[] | select((.ip // "") | test("^(10\\.|127\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.|192\\.168\\.)") | not)]'
    if jq -e "length != ($keep | length)" "$f" >/dev/null 2>&1 && jq "$keep" "$f" >"$f.tmp" 2>/dev/null; then
      cat "$f.tmp" >"$f" && echo "[mchost] lifted IP bans on our router's address (every player shares it); ban players by name instead"
    fi
    rm -f "$f.tmp"
  fi
)
`

// withUnfinishedWorldCheck runs unfinishedWorldScript first in a Java entrypoint (the image's own if none).
func withUnfinishedWorldCheck(entrypoint []string) []string {
	if entrypoint == nil {
		return []string{"/bin/bash", "-c", unfinishedWorldScript + "exec /image/scripts/start\n"}
	}
	return []string{entrypoint[0], entrypoint[1], unfinishedWorldScript + entrypoint[2]}
}

// packEntrypoint puts packScript where PRE_START_SCRIPT points, then starts the image as usual.
var packEntrypoint = []string{"/bin/bash", "-c", "cat >" + packScriptPath + " <<'MCHOST'\n" + packScript +
	"MCHOST\nchmod 755 " + packScriptPath + "\nexec /image/scripts/start\n"}
