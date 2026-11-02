package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// The agent brings Geyser and Floodgate to crossplay servers itself instead of
// listing their URLs for the image: download.geysermc.org moved to a Let's
// Encrypt chain (Root YE) that the images' Java doesn't trust yet, so the image
// stopped every crossplay server on start ("PKIX path building failed",
// 2026-11-02). The agent's own TLS uses the machine's certificates
// (deploy/*docker-compose.yml mounts them), which do.

type crossplayJar struct {
	url  string
	file string // its name in the agent's cache and in the server's plugins folder
}

var crossplayJars = []crossplayJar{
	{"https://download.geysermc.org/v2/projects/geyser/versions/latest/builds/latest/downloads/spigot", "mchost-geyser.jar"},
	{"https://download.geysermc.org/v2/projects/floodgate/versions/latest/builds/latest/downloads/spigot", "mchost-floodgate.jar"},
}

// Geyser follows each new Bedrock release, so a copy older than this is
// fetched again (in the background; the old one serves meanwhile).
const crossplayRefresh = 6 * time.Hour

const crossplayMaxBytes = 100 << 20

// crossplayDownload is the HTTP client for GeyserMC.
var crossplayDownload = &http.Client{Timeout: 2 * time.Minute}

func (a *agent) crossplayCacheDir() string { return filepath.Join(a.stateDir, "crossplay") }

// crossplayWait is the longest a start waits for a first download. The panel
// gives up on a start after 15s, and a start the panel gave up on never ran
// ("bakus" stayed off, 2026-11-02); without the jars the server starts anyway.
var crossplayWait = 8 * time.Second

var (
	crossplayMu   sync.Mutex
	crossplayDone chan struct{} // closed when the download running now ends; nil when none runs
)

// crossplayFetchAsync starts downloading the jars unless that's already
// running, apart from any request (so a start that ends doesn't cut it off),
// and returns a channel closed when it ends.
func (a *agent) crossplayFetchAsync() <-chan struct{} {
	crossplayMu.Lock()
	defer crossplayMu.Unlock()
	if crossplayDone != nil {
		return crossplayDone
	}
	done := make(chan struct{})
	crossplayDone = done
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		if err := a.fetchCrossplay(ctx); err != nil {
			log.Printf("crossplay: downloading Geyser and Floodgate: %v", err)
		}
		crossplayMu.Lock()
		crossplayDone = nil
		crossplayMu.Unlock()
		close(done)
	}()
	return done
}

// warmCrossplay fills the cache when the agent starts, so starts find it ready.
func (a *agent) warmCrossplay() {
	if len(a.crossplayPaths()) == 0 {
		a.crossplayFetchAsync()
	}
}

// crossplayPaths returns the cached jars' paths, all or none, and starts a
// download in the background when they're old.
func (a *agent) crossplayPaths() []string {
	var paths []string
	oldest := time.Now()
	for _, j := range crossplayJars {
		p := filepath.Join(a.crossplayCacheDir(), j.file)
		fi, err := os.Stat(p)
		if err != nil {
			return nil
		}
		paths = append(paths, p)
		if fi.ModTime().Before(oldest) {
			oldest = fi.ModTime()
		}
	}
	if time.Since(oldest) > crossplayRefresh {
		a.crossplayFetchAsync() // the old copies serve meanwhile
	}
	return paths
}

// crossplayCache returns the cached jars' paths, waiting up to crossplayWait
// for a download when there are none yet. Nil if they can't be had now.
func (a *agent) crossplayCache(ctx context.Context) []string {
	if paths := a.crossplayPaths(); paths != nil {
		return paths
	}
	select {
	case <-a.crossplayFetchAsync():
	case <-time.After(crossplayWait):
		log.Printf("crossplay: Geyser and Floodgate are still downloading; this start goes on without them")
	case <-ctx.Done():
	}
	return a.crossplayPaths()
}

// fetchCrossplay downloads every jar into the cache, each replacing its old copy only once complete.
func (a *agent) fetchCrossplay(ctx context.Context) error {
	dir := a.crossplayCacheDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, j := range crossplayJars {
		if err := fetchFile(ctx, j.url, filepath.Join(dir, j.file)); err != nil {
			return fmt.Errorf("%s: %w", j.file, err)
		}
	}
	return nil
}

func fetchFile(ctx context.Context, url, dest string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Filipsq/mc-host (mchosting.pl)")
	res, err := crossplayDownload.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", res.StatusCode)
	}
	tmp := dest + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	n, err := io.Copy(f, io.LimitReader(res.Body, crossplayMaxBytes+1))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil && (n == 0 || n > crossplayMaxBytes) {
		err = fmt.Errorf("unexpected size %d", n)
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dest)
}

// fixCrossplay puts Geyser and Floodgate in a crossplay server's plugins
// folder before it starts, and takes them out of one that has crossplay off.
// If they can't be had, the server starts anyway (Java players still get in).
func (a *agent) fixCrossplay(ctx context.Context, id string) {
	if a.volumesDir == "" {
		return
	}
	info, err := a.docker.InspectContainer(ctx, containerName(id))
	if err != nil {
		return
	}
	on := info.Config.Labels["mchost.crossplay"] == "true"
	s, err := a.openFiles(ctx, id)
	if err != nil {
		return
	}
	defer s.Close()
	if !on {
		for _, j := range crossplayJars {
			if err := s.root.Remove("plugins/" + j.file); err != nil && !errors.Is(err, fs.ErrNotExist) {
				log.Printf("crossplay %s: %v", id, err)
			}
		}
		return
	}
	for _, p := range a.crossplayCache(ctx) {
		f, err := os.Open(p)
		if err != nil {
			log.Printf("crossplay %s: %v", id, err)
			continue
		}
		_, err = s.writeFile("plugins/"+filepath.Base(p), f)
		f.Close()
		if err != nil {
			log.Printf("crossplay %s: %v", id, err)
		}
	}
}
