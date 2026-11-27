package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Połączenie z hubem: the mchosting-link plugin (Filipsq/mc-server, module link) on a Paper
// server. /hub sends a player to the mchosting.pl network's hub with Minecraft's transfer and a
// return ticket signed with this server's key; in the hub /wroc transfers them back, so the
// server must let transferred players in. The panel makes the key (src/lib/hubLink.ts); the
// agent writes it into the plugin's config on every new container and puts the jar in before
// each start, the way crossplay.go brings Geyser.

type hubLink struct {
	ServerID   string `json:"serverId"`
	PrivateKey string `json:"privateKey"` // base64 PKCS#8 Ed25519
	HubHost    string `json:"hubHost"`
	HubPort    int    `json:"hubPort"`
}

var validHubServerID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

const (
	hubLinkJar       = "mchost-link.jar" // its name in the cache and in plugins/
	hubLinkConfig    = "plugins/MchostingLink/config.yml"
	hubLinkRefresh   = 6 * time.Hour   // a newer build is fetched after this (old one serves meanwhile)
	hubLinkWait      = 8 * time.Second // the longest a start waits for a first download (see crossplayWait)
	hubLinkLabel     = "mchost.hub-link"
	defaultHubJarURL = "https://github.com/Filipsq/mc-server/releases/latest/download/mchosting-link.jar"
)

func (l *hubLink) valid() error {
	if l == nil {
		return nil
	}
	key, err := base64.StdEncoding.DecodeString(l.PrivateKey)
	switch {
	case !validHubServerID.MatchString(l.ServerID):
		return errors.New("hubLink: invalid serverId")
	case err != nil || len(key) < 32 || len(key) > 128:
		return errors.New("hubLink: invalid privateKey")
	case !validHost.MatchString(l.HubHost):
		return errors.New("hubLink: invalid hubHost")
	case l.HubPort < 1 || l.HubPort > 65535:
		return errors.New("hubLink: invalid hubPort")
	}
	return nil
}

// hubLinkYAML is the plugin's config.yml. Every value was checked by valid, so none needs quoting rules beyond single quotes.
func hubLinkYAML(l *hubLink) string {
	return strings.Join([]string{
		"# Ustawia panel mchosting.pl przy każdym starcie serwera; zmiany wpisane tutaj znikną.",
		"# Połączenie z hubem włączasz i wyłączasz w panelu: Ustawienia serwera.",
		"hub:",
		fmt.Sprintf("  host: '%s'", l.HubHost),
		fmt.Sprintf("  port: %d", l.HubPort),
		fmt.Sprintf("server-id: '%s'", l.ServerID),
		fmt.Sprintf("private-key: '%s'", l.PrivateKey),
		"cooldown-seconds: 3",
		"",
	}, "\n")
}

// prepareHubLink writes the plugin's config for a server with the link, or takes the plugin
// and its config away from one without it.
func (a *agent) prepareHubLink(ctx context.Context, id string, l *hubLink) {
	if a.volumesDir == "" {
		return
	}
	s, err := a.openFiles(ctx, id)
	if err != nil {
		log.Printf("hub link %s: %v", id, err)
		return
	}
	defer s.Close()
	if l == nil {
		for _, name := range []string{"plugins/" + hubLinkJar, hubLinkConfig} {
			if err := s.root.Remove(name); err != nil && !errors.Is(err, fs.ErrNotExist) {
				log.Printf("hub link %s: %v", id, err)
			}
		}
		return
	}
	if _, err := s.writeFile(hubLinkConfig, strings.NewReader(hubLinkYAML(l))); err != nil {
		log.Printf("hub link %s: %v", id, err)
	}
}

func hubLinkJarURL() string {
	if u := os.Getenv("HUB_LINK_JAR_URL"); u != "" {
		return u
	}
	return defaultHubJarURL
}

func (a *agent) hubLinkCachePath() string { return filepath.Join(a.stateDir, "hublink", hubLinkJar) }

var (
	hubLinkMu   sync.Mutex
	hubLinkDone chan struct{} // closed when the download running now ends; nil when none runs
)

func (a *agent) hubLinkFetchAsync() <-chan struct{} {
	hubLinkMu.Lock()
	defer hubLinkMu.Unlock()
	if hubLinkDone != nil {
		return hubLinkDone
	}
	done := make(chan struct{})
	hubLinkDone = done
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		p := a.hubLinkCachePath()
		err := os.MkdirAll(filepath.Dir(p), 0o755)
		if err == nil {
			err = fetchFile(ctx, hubLinkJarURL(), p)
		}
		if err != nil {
			log.Printf("hub link: downloading the plugin: %v", err)
		}
		hubLinkMu.Lock()
		hubLinkDone = nil
		hubLinkMu.Unlock()
		close(done)
	}()
	return done
}

// hubLinkJarPath is the cached jar, waiting up to hubLinkWait for a first download; "" if there is none.
func (a *agent) hubLinkJarPath(ctx context.Context) string {
	p := a.hubLinkCachePath()
	if fi, err := os.Stat(p); err == nil {
		if time.Since(fi.ModTime()) > hubLinkRefresh {
			a.hubLinkFetchAsync()
		}
		return p
	}
	select {
	case <-a.hubLinkFetchAsync():
	case <-time.After(hubLinkWait):
		log.Printf("hub link: the plugin is still downloading; this start goes on without it")
	case <-ctx.Done():
	}
	if _, err := os.Stat(p); err == nil {
		return p
	}
	return ""
}

// fixHubLink puts the plugin in a server with the link before it starts. Without it the server
// starts anyway; /hub just isn't there until the next start.
func (a *agent) fixHubLink(ctx context.Context, id string) {
	if a.volumesDir == "" {
		return
	}
	info, err := a.docker.InspectContainer(ctx, containerName(id))
	if err != nil || info.Config.Labels[hubLinkLabel] != "true" {
		return
	}
	p := a.hubLinkJarPath(ctx)
	if p == "" {
		return
	}
	s, err := a.openFiles(ctx, id)
	if err != nil {
		return
	}
	defer s.Close()
	f, err := os.Open(p)
	if err != nil {
		log.Printf("hub link %s: %v", id, err)
		return
	}
	defer f.Close()
	if _, err := s.writeFile("plugins/"+hubLinkJar, f); err != nil {
		log.Printf("hub link %s: %v", id, err)
	}
}
