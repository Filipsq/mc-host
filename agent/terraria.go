package main

import (
	"context"
	"fmt"
	"regexp"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Terraria servers run the ryshe/terraria images: plain Terraria, or TShock
// (Terraria with admin commands, permissions and anti-cheat); or
// jacobsmile/tmodloader1.4 for tModLoader (Terraria with mods from the Steam
// Workshop). All keep everything in the server's volume at /data:
// serverconfig.txt (written on every start from the panel's settings), the
// world in Worlds/<level>.wld and, for TShock, its config and database in
// tshock/; for tModLoader its mod settings in tModLoader/ and the mods in
// steamMods/. Players connect straight to the server's port over TCP; there's
// no hostname to route by.

var terrariaImages = map[string]string{
	"vanilla":    "ryshe/terraria:vanilla-latest",
	"tshock":     "ryshe/terraria:tshock-latest",
	"tmodloader": tmodImage,
}

// tModLoader's image is built for x86 only, and tModLoader doesn't support
// Arm anyway (its Steam parts don't run there), so only x86 machines take it.
const tmodImage = "jacobsmile/tmodloader1.4:latest"

// tmodSupported reports whether this machine can run tModLoader servers.
func tmodSupported() bool { return runtime.GOARCH == "amd64" }

// A Steam Workshop item's ID, as in steamcommunity.com/sharedfiles/filedetails/?id=2824688072.
var validWorkshopID = regexp.MustCompile(`^[0-9]{1,12}$`)

const (
	terrariaPort         = "7777/tcp"
	terrariaMaxPlayers   = 255 // the most Terraria allows
	defaultTerrariaLevel = "world"
)

var (
	// serverconfig.txt numbers for each world size and difficulty (difficulty only counts for a new world).
	terrariaSizes         = map[string]string{"small": "1", "medium": "2", "large": "3"}
	terrariaDifficulties  = map[string]string{"classic": "0", "expert": "1", "master": "2", "journey": "3"}
	validTerrariaPassword = regexp.MustCompile(`^[\x21-\x7e]{0,32}$`) // printable, no spaces
)

// terrariaScript starts the server with its console on a named pipe, so the
// agent can type commands into it (terrariaCommand), and turns docker stop
// into the server's own "exit", which saves the world first. TShock gets its
// player limit from its own config, and doesn't keep world copies of its own:
// the plan's backups cover that.
const terrariaScript = `set -u
mkdir -p /data/Worlds
printf '%s\n' "$MCHOST_CONFIG" > /data/serverconfig.txt
rm -f /tmp/console && mkfifo /tmp/console
exec 3<>/tmp/console
if [ "$MCHOST_KIND" = tshock ]; then
  mkdir -p /data/tshock
  cfg=/data/tshock/config.json
  if [ -f "$cfg" ]; then
    jq --argjson n "$MCHOST_MAX_PLAYERS" '.Settings.MaxSlots = $n' "$cfg" > "$cfg.new" && mv "$cfg.new" "$cfg"
  else
    printf '{"Settings":{"MaxSlots":%s,"BackupInterval":0}}\n' "$MCHOST_MAX_PLAYERS" > "$cfg"
  fi
  cd /tshock
  [ -n "$(ls -A ServerPlugins)" ] || cp /plugins/* ServerPlugins/
  ./TShock.Server -configpath /data/tshock -logpath /data/tshock/logs -config /data/serverconfig.txt <&3 &
else
  cd /terraria-server
  exe=./TerrariaServer
  case "${TARGETARCH:-}" in arm*) exe="mono ./TerrariaServer.exe" ;; esac
  $exe -config /data/serverconfig.txt -logpath /data/logs <&3 &
fi
pid=$!
trap 'echo exit >&3' TERM INT
code=0
while kill -0 "$pid" 2>/dev/null; do wait "$pid"; code=$?; done
exit "$code"
`

// tmodScript starts a tModLoader server the same way. Before that it fetches
// the owner's Workshop mods (MCHOST_MODS, comma-separated IDs) with the
// image's steamcmd, which also brings them up to date, removes the ones taken
// off the list, and enables the listed ones plus any .tmod uploaded to
// tModLoader/Mods. If Steam doesn't answer, the server starts with the mods it
// downloaded before.
const tmodScript = `set -u
mkdir -p /data/Worlds /data/tModLoader/Mods /data/steamMods
printf '%s\n' "$MCHOST_CONFIG" > /data/serverconfig.txt
content=/data/steamMods/steamapps/workshop/content/1281930
ids=$(printf '%s' "$MCHOST_MODS" | tr ',' ' ')
if [ -n "$ids" ]; then
  set --
  for id in $ids; do set -- "$@" +workshop_download_item 1281930 "$id"; done
  echo "[mchost] Downloading mods from the Steam Workshop: $ids"
  steamcmd +force_install_dir /data/steamMods +login anonymous "$@" +quit ||
    echo "[mchost] Steam didn't answer; starting with the mods downloaded before"
fi
for dir in "$content"/*/; do
  [ -d "$dir" ] || continue
  case " $ids " in *" $(basename "$dir") "*) ;; *) rm -rf "$dir" ;; esac
done
names=""
for id in $ids; do
  # Mods keep a folder per tModLoader version they were built for; the newest is the one to run.
  dir=$(ls -d "$content/$id"/*/ 2>/dev/null | sort -V | tail -n 1)
  f=$(ls "${dir:-$content/$id/}"*.tmod 2>/dev/null | head -n 1)
  if [ -n "$f" ]; then names="$names $(basename "$f" .tmod)"; else echo "[mchost] Mod $id isn't downloaded, skipping it"; fi
done
for f in /data/tModLoader/Mods/*.tmod; do [ -f "$f" ] && names="$names $(basename "$f" .tmod)"; done
sep=""
{ printf '['; for n in $names; do printf '%s"%s"' "$sep" "$n"; sep=","; done; printf ']\n'; } > /data/tModLoader/Mods/enabled.json
echo "[mchost] Enabled mods:${names:- none}"
rm -f /tmp/console && mkfifo /tmp/console
exec 3<>/tmp/console
cd /terraria-server
./LaunchUtils/ScriptCaller.sh -server -tmlsavedirectory /data/tModLoader -steamworkshopfolder /data/steamMods/steamapps/workshop -config /data/serverconfig.txt <&3 &
pid=$!
trap 'echo exit >&3' TERM INT
code=0
while kill -0 "$pid" 2>/dev/null; do wait "$pid"; code=$?; done
exit "$code"
`

// terrariaSlots is how many players may join at once (no limit is Terraria's most).
func (req *createRequest) terrariaSlots() int {
	if req.MaxPlayers <= 0 || req.MaxPlayers > terrariaMaxPlayers {
		return terrariaMaxPlayers
	}
	return req.MaxPlayers
}

// terrariaConfig is the server's serverconfig.txt.
func terrariaConfig(req createRequest) string {
	motd := req.Motd
	if motd == "" {
		motd = req.Name
	}
	worldName := strings.Map(func(r rune) rune {
		if r < ' ' {
			return -1
		}
		return r
	}, req.Name)
	if worldName == "" {
		worldName = req.level()
	}
	size := terrariaSizes[req.LevelType]
	if size == "" {
		size = terrariaSizes["medium"]
	}
	lines := []string{
		"world=/data/Worlds/" + req.level() + ".wld",
		"autocreate=" + size, // only when the world file doesn't exist yet
		"worldname=" + worldName,
		"difficulty=" + terrariaDifficulties[req.Difficulty],
		"maxplayers=" + strconv.Itoa(req.terrariaSlots()),
		"port=7777",
		"motd=" + motd,
		"secure=1",
		"language=en-US", // the agent reads the English join and leave lines
		"upnp=0",
		"priority=1",
	}
	if req.Seed != "" {
		lines = append(lines, "seed="+req.Seed)
	}
	if req.Password != "" {
		lines = append(lines, "password="+req.Password)
	}
	return strings.Join(lines, "\n")
}

// terrariaSpec fills in a Terraria server's part of its container: the
// environment, the command and the port players connect to.
func terrariaSpec(req createRequest) (env []string, entrypoint []string) {
	env = []string{
		"MCHOST_KIND=" + req.Kind,
		"MCHOST_CONFIG=" + terrariaConfig(req),
		fmt.Sprintf("MCHOST_MAX_PLAYERS=%d", req.terrariaSlots()),
	}
	if req.Kind == "tmodloader" {
		env = append(env, "MCHOST_MODS="+strings.Join(req.Plugins, ","))
		return env, []string{"/bin/bash", "-c", tmodScript}
	}
	return env, []string{"/bin/sh", "-c", terrariaScript}
}

// The panel shows a server as online once Docker calls it healthy: for
// Terraria, once it listens on its port, which is after the world has loaded
// (making a new one takes a while, hence the long start period).
// tModLoader first downloads and loads its mods, which takes longer still.
func terrariaHealthcheck(kind string) map[string]any {
	start := 15 * time.Minute
	if kind == "tmodloader" {
		start = 30 * time.Minute
	}
	return map[string]any{
		"Test":        []string{"CMD-SHELL", "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null | grep -q ':1E61 [0-9A-F]*:0000 0A'"},
		"Interval":    int64(10 * time.Second),
		"Timeout":     int64(5 * time.Second),
		"StartPeriod": int64(start),
		"Retries":     3,
	}
}

// terrariaCommand types a command into the server's console. Its answer shows up in the logs.
func terrariaCommand(cmd string) []string {
	cmd = strings.NewReplacer("\r", " ", "\n", " ").Replace(cmd)
	return []string{"sh", "-c", `printf '%s\n' "$1" > /tmp/console`, "sh", cmd}
}

// terrariaConnections counts the players connected to the server: the open
// TCP connections to its port, as the container's kernel lists them. Unlike
// the console's join lines, this can't be fooled by chat or missed lines.
func (a *agent) terrariaConnections(ctx context.Context, name string) (int, error) {
	out, err := a.docker.Exec(ctx, name, []string{"cat", "/proc/net/tcp"})
	if err != nil {
		return 0, err
	}
	// IPv6 connections are listed separately; the file is missing when IPv6 is off.
	if out6, err := a.docker.Exec(ctx, name, []string{"sh", "-c", "cat /proc/net/tcp6 2>/dev/null || true"}); err == nil {
		out += "\n" + out6
	}
	return countConnections(out, 7777), nil
}

// countConnections counts established connections to a local port in /proc/net/tcp format.
func countConnections(table string, port int) int {
	want := fmt.Sprintf(":%04X", port)
	n := 0
	for _, line := range strings.Split(table, "\n") {
		f := strings.Fields(line)
		// sl local_address rem_address st ...; 01 is ESTABLISHED.
		if len(f) > 3 && strings.HasSuffix(f[1], want) && f[3] == "01" {
			n++
		}
	}
	return n
}

var (
	// "Steve has joined." (TShock with GeoIP: "Steve (Poland) has joined."), "Steve has left."
	// The console prompt sometimes comes first as ": ". Chat lines start with "<name>".
	terrariaJoin  = regexp.MustCompile(`^(?:: )?([^<].*?)(?: \([^()]*\))? has joined\.$`)
	terrariaLeave = regexp.MustCompile(`^(?:: )?([^<].*?) has left\.$`)
)

func applyTerrariaJoins(online map[string]bool, lines []string) {
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if m := terrariaJoin.FindStringSubmatch(line); m != nil {
			online[m[1]] = true
		} else if m := terrariaLeave.FindStringSubmatch(line); m != nil {
			delete(online, m[1])
		}
	}
}

// terrariaPlayers returns how many players are connected and, when the
// console's join lines agree with that, their names.
func (a *agent) terrariaPlayers(ctx context.Context, name string, m *serverMetrics) (int, []string, error) {
	count, err := a.terrariaConnections(ctx, name)
	if err != nil {
		return 0, nil, err
	}
	m.mu.Lock()
	since := m.logsSince
	m.mu.Unlock()
	var lines []string
	now := time.Now().Unix()
	logErr := a.docker.Logs(ctx, name, LogOptions{Since: since}, func(line string) error {
		lines = append(lines, line)
		return nil
	})
	m.mu.Lock()
	defer m.mu.Unlock()
	if logErr == nil {
		applyTerrariaJoins(m.online, lines)
		m.logsSince = now
	}
	if count == 0 {
		clear(m.online) // whoever we missed leaving is gone
	}
	if len(m.online) != count {
		return count, nil, nil
	}
	names := make([]string, 0, len(m.online))
	for n := range m.online {
		names = append(names, n)
	}
	slices.Sort(names)
	return count, names, nil
}
