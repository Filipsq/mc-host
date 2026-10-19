package main

import (
	"context"
	"io"
	"log"
	"strings"
)

// authMeConfig starts AuthMe's settings on a new non-premium server, so its
// messages to players are in Polish; AuthMe adds the rest of its settings
// when it first starts. The rest is loginOverrides.
const authMeConfig = `settings:
  messagesLanguage: pl
  sessions:
    enabled: false
  restrictions:
    maxRegPerIp: 0
    maxLoginPerIp: 0
    maxJoinPerIp: 0
Security:
  tempban:
    enableTempban: false
`

// oldAuthMeConfig is what new servers got before loginOverrides existed.
const oldAuthMeConfig = "settings:\n  messagesLanguage: pl\n"

// loginOverrides are AuthMe settings that go by a player's address. Java
// players reach a server through our router, so to AuthMe they all come
// from the same address: a limit of accounts per address would let only
// the first player register, a session would log anyone in under the last
// player's nick, and a temporary ban would lock everyone out. They're kept
// off before every start, even if the owner turned them on.
var loginOverrides = map[string]string{
	"settings.restrictions.maxRegPerIp":   "0",
	"settings.restrictions.maxLoginPerIp": "0",
	"settings.restrictions.maxJoinPerIp":  "0",
	"settings.sessions.enabled":           "false",
	"Security.tempban.enableTempban":      "false",
}

const authMeConfigPath = "plugins/AuthMe/config.yml"

// prepareLogin writes AuthMe's settings if the server has none yet.
func (a *agent) prepareLogin(ctx context.Context, id string) {
	if a.volumesDir == "" {
		return
	}
	s, err := a.openFiles(ctx, id)
	if err != nil {
		log.Printf("login settings %s: %v", id, err)
		return
	}
	defer s.Close()
	if _, err := s.root.Lstat(authMeConfigPath); err == nil {
		s.fixLogin()
		return
	}
	if _, err := s.writeFile(authMeConfigPath, strings.NewReader(authMeConfig)); err != nil {
		log.Printf("login settings %s: %v", id, err)
	}
}

// fixLogin applies loginOverrides to a server's AuthMe settings, if it has any.
func (a *agent) fixLogin(ctx context.Context, id string) {
	if a.volumesDir == "" {
		return
	}
	s, err := a.openFiles(ctx, id)
	if err != nil {
		return // no files to fix; starting goes on as before
	}
	defer s.Close()
	s.fixLogin()
}

func (s *serverFiles) fixLogin() {
	f, err := s.root.Open(authMeConfigPath)
	if err != nil {
		return
	}
	b, err := io.ReadAll(io.LimitReader(f, 1<<20))
	f.Close()
	if err != nil {
		return
	}
	text := string(b)
	fixed := authMeConfig
	if text != oldAuthMeConfig {
		fixed = setYAMLValues(text, loginOverrides)
	}
	if fixed == text {
		return
	}
	if _, err := s.writeFile(authMeConfigPath, strings.NewReader(fixed)); err != nil {
		log.Printf("login settings %s: %v", s.id, err)
	}
}

// setYAMLValues sets the plain values of the given dotted keys where text
// already has them, leaving every other line (comments included) as it is.
// It reads only the block-style mappings AuthMe writes, not all of YAML.
func setYAMLValues(text string, values map[string]string) string {
	type level struct {
		indent int
		key    string
	}
	var stack []level
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		trimmed := strings.TrimLeft(line, " ")
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "-") {
			continue
		}
		key, value, ok := strings.Cut(trimmed, ":")
		if !ok {
			continue
		}
		key = strings.Trim(strings.TrimSpace(key), `"'`)
		indent := len(line) - len(trimmed)
		for len(stack) > 0 && stack[len(stack)-1].indent >= indent {
			stack = stack[:len(stack)-1]
		}
		path := key
		if len(stack) > 0 {
			path = stack[len(stack)-1].key + "." + key
		}
		value = strings.TrimSpace(value)
		if value == "" {
			stack = append(stack, level{indent, path})
			continue
		}
		if want, ok := values[path]; ok && value != want {
			lines[i] = line[:indent] + key + ": " + want
		}
	}
	return strings.Join(lines, "\n")
}
