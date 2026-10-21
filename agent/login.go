package main

import (
	"context"
	"io"
	"log"
	"slices"
	"strings"
)

// Login mods for non-premium mod loader servers, on Modrinth, by loader and
// the Minecraft versions each is made for; the panel keeps the same list
// (src/lib/plugins.ts LOGIN_MODS). EasyAuth (Fabric, needs Fabric API, which
// the image fetches as a dependency) and EasyLogin (Forge and NeoForge) run
// on the server only, so players install nothing.
const (
	easyAuth  = "aZj58GfX"
	easyLogin = "VYmP7iH5"
)

var loginMods = map[string]struct {
	project  string
	versions []string
}{
	"fabric":   {easyAuth, []string{"1.21.11", "1.21.8", "1.21.4", "1.21.1", "1.20.6", "1.20.4", "1.20.1", "1.19.4"}},
	"forge":    {easyLogin, []string{"1.21.1"}},
	"neoforge": {easyLogin, []string{"1.21.11", "1.21.1"}},
}

// loginAddon is the Modrinth project that makes players log in with a
// password on a non-premium server of this kind and version, or "" if it
// can't run non-premium.
func loginAddon(kind, version string) string {
	if paperKinds[kind] {
		return authMe
	}
	if m, ok := loginMods[kind]; ok && slices.Contains(m.versions, version) {
		return m.project
	}
	return ""
}

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

// easyAuthConfig starts EasyAuth's main settings; it fills in the rest. Its
// messages follow each player's game language, Polish included. A session
// would log anyone in under the last player's nick from the same address,
// and behind our router that's everyone, so sessions are off
// (easyAuthOverrides keeps them off).
const easyAuthConfig = `# Started by mchosting: sessions stay off, because every player comes from the same address.
session-timeout=-1
`

var easyAuthOverrides = map[string]string{"session-timeout": "-1"}

const easyAuthConfigPath = "config/EasyAuth/main.conf"

// easyLoginConfig starts EasyLogin's settings, with its messages in Polish.
// It locks out an address after a few wrong passwords; behind our router
// one player's mistakes would lock everyone out, so the limit is high and
// short (easyLoginOverrides keeps it so).
const easyLoginConfig = `# Started by mchosting. EasyLogin fills in the rest when it starts.
[security]
maxAttempts = 1000
attemptWindow = 1
lockoutDuration = 1

[messages]
welcome = "&aWitaj, {player}! &7Zaloguj się: &e/login <hasło>"
welcomeFirstTime = "&aWitaj, {player}! &7Pierwszy raz? Ustaw hasło: &e/register <hasło> <hasło>"
loginSuccess = "&aZalogowano! Miłej gry, {player}!"
registerSuccess = "&aKonto założone, jesteś zalogowany."
wrongPassword = "&cZłe hasło."
alreadyLoggedIn = "&7Już jesteś zalogowany."
notRegistered = "&cNie masz jeszcze konta. Wpisz &e/register <hasło> <hasło>"
alreadyRegistered = "&cMasz już konto. Wpisz &e/login <hasło>"
kicked = "&cZa długo trwało logowanie. Wejdź jeszcze raz."
rateLimited = "&cZa dużo prób. Spróbuj za {minutes} min."
passwordChanged = "&aHasło zmienione."
passwordMismatch = "&cHasła się różnią. Spróbuj jeszcze raz."
wrongOldPassword = "&cStare hasło jest złe."
logoutSuccess = "&7Wylogowano."
logoutCooldown = "&cPoczekaj {seconds} s, zanim się wylogujesz."
actionBarReminder = "&eZaloguj się: /login <hasło>"
actionBarReminderNew = "&eUstaw hasło: /register <hasło> <hasło>"
blocked = "&cNajpierw się zaloguj!"
loginUsage = "&7Wpisz: &e/login <hasło>"
registerUsage = "&7Wpisz: &e/register <hasło> <hasło>"
changePasswordUsage = "&7Wpisz: &e/changepassword <stare> <nowe> <nowe>"
minPasswordLength = "&cHasło musi mieć co najmniej {min} znaki."
`

var easyLoginOverrides = map[string]string{"maxAttempts": "1000", "attemptWindow": "1", "lockoutDuration": "1"}

const easyLoginConfigPath = "config/easylogin/config.toml"

// loginConfigs is where each login addon keeps its settings, and what it starts with.
var loginConfigs = map[string]struct{ path, text string }{
	authMe:    {authMeConfigPath, authMeConfig},
	easyAuth:  {easyAuthConfigPath, easyAuthConfig},
	easyLogin: {easyLoginConfigPath, easyLoginConfig},
}

// prepareLogin writes the login addon's settings (see loginAddon) if the server has none yet.
func (a *agent) prepareLogin(ctx context.Context, id, addon string) {
	if a.volumesDir == "" {
		return
	}
	s, err := a.openFiles(ctx, id)
	if err != nil {
		log.Printf("login settings %s: %v", id, err)
		return
	}
	defer s.Close()
	c, ok := loginConfigs[addon]
	if !ok {
		return
	}
	if _, err := s.root.Lstat(c.path); err == nil {
		s.fixLogin()
		return
	}
	if _, err := s.writeFile(c.path, strings.NewReader(c.text)); err != nil {
		log.Printf("login settings %s: %v", id, err)
	}
}

// fixLogin applies the overrides to a server's login addon settings, if it has any.
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
	s.fixConfig(authMeConfigPath, func(text string) string {
		if text == oldAuthMeConfig {
			return authMeConfig
		}
		return setYAMLValues(text, loginOverrides)
	})
	s.fixConfig(easyAuthConfigPath, func(text string) string { return setFlatValues(text, easyAuthOverrides) })
	s.fixConfig(easyLoginConfigPath, func(text string) string { return setFlatValues(text, easyLoginOverrides) })
}

// fixConfig rewrites a settings file through fix, if the server has it.
func (s *serverFiles) fixConfig(path string, fix func(string) string) {
	f, err := s.root.Open(path)
	if err != nil {
		return
	}
	b, err := io.ReadAll(io.LimitReader(f, 1<<20))
	f.Close()
	if err != nil {
		return
	}
	text := string(b)
	fixed := fix(text)
	if fixed == text {
		return
	}
	if _, err := s.writeFile(path, strings.NewReader(fixed)); err != nil {
		log.Printf("login settings %s: %v", s.id, err)
	}
}

// setFlatValues sets the values of the given keys in a key=value file (the
// HOCON EasyAuth writes, or EasyLogin's TOML) wherever a line sets them,
// leaving every other line as it is. The keys are unique in their files, so
// sections don't matter.
func setFlatValues(text string, values map[string]string) string {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		trimmed := strings.TrimLeft(line, " \t")
		end := strings.IndexAny(trimmed, "=:")
		if end <= 0 || strings.HasPrefix(trimmed, "#") {
			continue
		}
		key := strings.Trim(strings.TrimSpace(trimmed[:end]), `"`)
		want, ok := values[key]
		if !ok || strings.TrimSpace(trimmed[end+1:]) == want {
			continue
		}
		lines[i] = line[:len(line)-len(trimmed)] + trimmed[:end+1] + " " + want
	}
	return strings.Join(lines, "\n")
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
