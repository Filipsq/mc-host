package main

import (
	"context"
	"log"
	"strings"
)

// authMeConfig starts AuthMe's settings on a new non-premium server, so its
// messages to players are in Polish; AuthMe adds the rest of its settings
// when it first starts.
const authMeConfig = "settings:\n  messagesLanguage: pl\n"

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
	const name = "plugins/AuthMe/config.yml"
	if _, err := s.root.Lstat(name); err == nil {
		return
	}
	if _, err := s.writeFile(name, strings.NewReader(authMeConfig)); err != nil {
		log.Printf("login settings %s: %v", id, err)
	}
}
