package main

import (
	"fmt"
	"slices"
)

// BlueMap (plugin on Paper, mod on Fabric, Forge and NeoForge) draws the world
// as a 3D map that players open in a web browser. Its own small web server
// listens on 8100 over TCP inside the container. The Java port sits behind the
// main machine's router, so every Java server gets one more port, the server's
// own port plus webMapPortOffset (32000-32999 for the usual pool), open to
// everyone over TCP on the machine it runs on and passed to 8100 inside.
// Nothing answers there until BlueMap is installed.
const (
	webMapPortOffset = 2000
	blueMapPort      = "8100/tcp"
)

// BlueMap's Modrinth project, as the panel stores it, and its slug.
var blueMapProjects = []string{"swbUV1cr", "bluemap"}

func (req *createRequest) webMapPort() int { return req.Port + webMapPortOffset }

// blueMapScript accepts BlueMap's download of the game's textures before every
// start: BlueMap does nothing until accept-download is true in core.conf, and
// the owner already accepted Minecraft's EULA when making the server. It runs
// only where BlueMap is (added in the panel, uploaded, or its folder already
// there), so other servers get no extra folder; the owner's other settings stay.
func blueMapScript(req createRequest) string {
	dir, jars := "config/bluemap", "mods"
	if paperKinds[req.Kind] {
		dir, jars = "plugins/BlueMap", "plugins"
	}
	check := fmt.Sprintf(`[ -d %s ] || ls %s 2>/dev/null | grep -qi bluemap`, dir, jars)
	if slices.ContainsFunc(req.Plugins, func(p string) bool { return slices.Contains(blueMapProjects, p) }) {
		check = "true"
	}
	return fmt.Sprintf(`(
  cd /data 2>/dev/null || exit 0
  if %s; then
    f=%s/core.conf
    if [ -f $f ]; then
      sed -i 's|^accept-download:.*|accept-download: true|' $f
    else
      mkdir -p %s && echo "accept-download: true" >$f || exit 0
      # Made as root, before the image switches to the server's user: hand it over.
      chown "$(stat -c %%u:%%g .)" ${f%%%%/*} ${f%%/*} $f 2>/dev/null
    fi
    echo "[mchost] BlueMap: the map opens at http://%s:%d"
  fi
)
`, check, dir, dir, req.VoiceHost, req.webMapPort())
}

// withWebMap opens the map port and runs blueMapScript first in a Java
// entrypoint. The site sends VoiceHost, this machine's address, for every Java
// server, so the map port comes with it.
func withWebMap(req createRequest, bindings map[string]any, entrypoint []string) []string {
	if req.VoiceHost == "" {
		return entrypoint
	}
	bindings[blueMapPort] = []map[string]string{{"HostIp": "", "HostPort": fmt.Sprint(req.webMapPort())}}
	return []string{entrypoint[0], entrypoint[1], blueMapScript(req) + entrypoint[2]}
}
