package main

import (
	"fmt"
	"slices"
)

// Simple Voice Chat (plugin on Paper, mod on Fabric, Forge and NeoForge) talks
// over UDP on a port of its own, which players' games connect to directly. The
// Java port is behind the main machine's router (TCP only), so every Java
// server gets a second port, the server's own port plus voicePortOffset
// (31000-31999 for the usual pool), open to everyone over UDP on the machine
// it runs on. Nothing listens there until the plugin or mod is installed.
//
// The voice chat listens on that same number inside the container, and its
// config tells players' games which machine to connect to (voice_host): without
// it they would try the address they joined, which is the main machine for
// servers on the others.
const voicePortOffset = 1000

// Simple Voice Chat's Modrinth project, as the panel stores it, and its slug.
var voiceChatProjects = []string{"9eGKb6K1", "simple-voice-chat"}

func (req *createRequest) voicePort() int { return req.Port + voicePortOffset }

// voiceScript writes the port and the machine's address into Simple Voice
// Chat's config before every start, so they stay right after a move to another
// machine. On Paper it only does so where the plugin is (added in the panel,
// uploaded, or there before), so servers without it get no extra folder; on
// mod servers the config folder is there anyway, and a mod pack may bring the
// mod in on its first start. The plugin keeps the values and fills in the rest.
func voiceScript(req createRequest) string {
	dir := "config/voicechat"
	check := "true"
	if paperKinds[req.Kind] {
		dir = "plugins/voicechat"
		if !slices.ContainsFunc(req.Plugins, func(p string) bool { return slices.Contains(voiceChatProjects, p) }) {
			check = `[ -d plugins/voicechat ] || ls plugins 2>/dev/null | grep -qi '^voicechat'`
		}
	}
	return fmt.Sprintf(`(
  cd /data 2>/dev/null || exit 0
  if %s; then
    f=%s/voicechat-server.properties
    mkdir -p %s && touch $f || exit 0
    for kv in port=%d voice_host=%s; do
      if grep -q "^${kv%%%%=*}=" $f; then sed -i "s|^${kv%%%%=*}=.*|$kv|" $f; else echo "$kv" >>$f; fi
    done
    # This runs as root, before the image switches to the server's user: what
    # it made goes to that user (the owner of /data), or a mod server that had
    # no config folder yet can't write its own there (Forge stops on fml.toml).
    chown "$(stat -c %%u:%%g .)" ${f%%%%/*} ${f%%/*} $f 2>/dev/null
    echo "[mchost] Simple Voice Chat: players connect to %s:%d over UDP"
  fi
)
`, check, dir, dir, req.voicePort(), req.VoiceHost, req.VoiceHost, req.voicePort())
}

// withVoiceChat opens the voice port and runs voiceScript first in a Java entrypoint.
func withVoiceChat(req createRequest, bindings map[string]any, entrypoint []string) []string {
	if req.VoiceHost == "" {
		return entrypoint
	}
	port := fmt.Sprintf("%d/udp", req.voicePort())
	bindings[port] = []map[string]string{{"HostIp": "", "HostPort": fmt.Sprint(req.voicePort())}}
	return []string{entrypoint[0], entrypoint[1], voiceScript(req) + entrypoint[2]}
}
