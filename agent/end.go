package main

import (
	"context"
	"embed"
	"io"
	"io/fs"
	"log"
	"path"
	"regexp"
	"strings"
)

// Turning the End off (a checkbox in the panel's Settings). Minecraft's
// server.properties has allow-nether but nothing for the End, so:
//
//   - On Paper (paperKinds) it's Bukkit's own setting, allow-end in bukkit.yml:
//     the End world isn't loaded and portals do nothing, and turning it back on
//     brings everything back as it was.
//   - On Fabric, Forge, NeoForge and mod packs it's a data pack of ours
//     (endpacks/off), which works the same on every version and loader: every
//     2 ticks an End portal lit near a player in the Overworld becomes
//     structure void (looks like air, does nothing), and anyone found in the
//     End is sent back to the Overworld near 0 0. The End world is kept.
//     Turning the End back on swaps it for endpacks/on, which lights those
//     portals again as players come near (the frames already hold their eyes,
//     so the game would never light them by itself). It stays in the world:
//     a portal far from everyone gets lit only when someone comes by.
//
// Data packs are read from the world's folder as it loads, so the agent writes
// them when it makes the container, as Settings > Zapisz and every move do.

//go:embed endpacks
var endPacks embed.FS

// The data packs' folders in the world.
const (
	endOffPackDir = "datapacks/mchost-end-off"
	endOnPackDir  = "datapacks/mchost-end-on"
)

// allow-end in bukkit.yml, under settings.
var bukkitAllowEnd = regexp.MustCompile(`(?m)^(\s+allow-end:\s*)\S+`)

// prepareEnd turns the End on or off in a new or remade Java container's files.
func (a *agent) prepareEnd(ctx context.Context, req createRequest) {
	if req.AllowEnd == nil || a.volumesDir == "" {
		return // an older site: nothing changes
	}
	s, err := a.openFiles(ctx, req.ID)
	if err != nil {
		log.Printf("end %s: %v", req.ID, err)
		return
	}
	defer s.Close()
	if err := setEnd(s, req.Kind, req.level(), *req.AllowEnd); err != nil {
		log.Printf("end %s: %v", req.ID, err)
	}
}

func setEnd(s *serverFiles, kind, level string, on bool) error {
	paper := paperKinds[kind]
	if paper {
		if err := setBukkitAllowEnd(s, on); err != nil {
			return err
		}
	}
	off, back := path.Join(level, endOffPackDir), path.Join(level, endOnPackDir)
	if !on && !paper {
		if err := s.root.RemoveAll(back); err != nil {
			return err
		}
		return writeEndPack(s, "off", off)
	}
	// On, or Paper, which has its own setting: a world that had the End off
	// through the data pack gets its portals back.
	if _, err := s.root.Lstat(off); err != nil {
		return nil
	}
	if err := s.root.RemoveAll(off); err != nil {
		return err
	}
	return writeEndPack(s, "on", back)
}

// writeEndPack writes one of the data packs fresh, so an agent update brings the newer one.
func writeEndPack(s *serverFiles, name, dir string) error {
	if err := s.root.RemoveAll(dir); err != nil {
		return err
	}
	return fs.WalkDir(endPacks, "endpacks/"+name, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		f, err := endPacks.Open(p)
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = s.writeFile(path.Join(dir, strings.TrimPrefix(p, "endpacks/"+name+"/")), f)
		return err
	})
}

// setBukkitAllowEnd sets allow-end in bukkit.yml. A server that hasn't made the
// file yet gets just that setting (off only), and Bukkit fills in the rest on
// its first start.
func setBukkitAllowEnd(s *serverFiles, on bool) error {
	value := "false"
	if on {
		value = "true"
	}
	f, err := s.root.Open("bukkit.yml")
	if err != nil {
		if on {
			return nil // Bukkit's default
		}
		_, err = s.writeFile("bukkit.yml", strings.NewReader("settings:\n  allow-end: false\n"))
		return err
	}
	b, err := io.ReadAll(io.LimitReader(f, 1<<20))
	f.Close()
	if err != nil {
		return err
	}
	text := string(b)
	switch {
	case bukkitAllowEnd.MatchString(text):
		text = bukkitAllowEnd.ReplaceAllString(text, "${1}"+value)
	case regexp.MustCompile(`(?m)^settings:[ \t]*$`).MatchString(text):
		text = regexp.MustCompile(`(?m)^settings:[ \t]*$`).ReplaceAllString(text, "settings:\n  allow-end: "+value)
	default:
		text = strings.TrimRight(text, "\n") + "\nsettings:\n  allow-end: " + value + "\n"
	}
	if text == string(b) {
		return nil
	}
	_, err = s.writeFile("bukkit.yml", strings.NewReader(text))
	return err
}
