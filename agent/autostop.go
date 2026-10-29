package main

import (
	"context"
	"errors"
	"strings"
	"time"
)

// autostopExit remembers, for one exit of a container, whether autostop caused it.
type autostopExit struct {
	finishedAt string
	slept      bool
}

var errFoundAutostop = errors.New("found")

// sleptOnExit tells whether a server that exited with an error was really
// going to sleep: the image's autostop stopped it with nobody on, the world
// was saved, but a mod's thread kept Java alive, so the runner killed it
// ("Took too long, so killing server process") and the exit code isn't 0.
// Read from the end of its log once per exit.
func (a *agent) sleptOnExit(id string, info *ContainerInfo) bool {
	if info.State.ExitCode == 0 || a.docker == nil {
		return false
	}
	if v, ok := a.autostops.Load(id); ok && v.(autostopExit).finishedAt == info.State.FinishedAt {
		return v.(autostopExit).slept
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	slept := false
	err := a.docker.Logs(ctx, containerName(id), LogOptions{Tail: 80}, func(line string) error {
		if isAutostopLine(line) {
			slept = true
			return errFoundAutostop
		}
		return nil
	})
	if err != nil && !errors.Is(err, errFoundAutostop) {
		return false // unknown: try again next time
	}
	a.autostops.Store(id, autostopExit{finishedAt: info.State.FinishedAt, slept: slept})
	return slept
}

// isAutostopLine matches what itzg/minecraft-server prints when autostop stops the server.
func isAutostopLine(line string) bool {
	return strings.Contains(line, "[Autostop] Stopping Java process")
}
