package main

import "regexp"

// The server logs every command a player types, so on a non-premium server
// the console showed players' passwords ("Ksenami issued server command:
// /login ksenami90", 2026-11-20). The console the panel shows (and "Kopiuj dla
// Claude") gets the login plugins' commands without what follows them.
var passwordCommand = regexp.MustCompile(`(?i)(issued server command: /(?:[a-z0-9_]+:)?(?:login|log|l|register|reg|changepassword|changepass|changepw|cp|unregister|unreg|premium|setpassword|setpass))\s.*$`)

func hidePasswords(line string) string {
	return passwordCommand.ReplaceAllString(line, "$1 ***")
}
