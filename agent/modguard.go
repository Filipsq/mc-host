package main

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"path"
	"regexp"
	"strings"
	"time"
)

// fixBrokenMods sets aside the mod jars that stopped the last start, so the
// server starts without them instead of crashing on every Uruchom. Owners
// upload mods made for another Minecraft version, which a mod loader often
// can't tell before the game calls into them: Lifesteal for 1.21.9 on a
// 1.21.11 Fabric server ("Sansgranie", 2026-11-11) stopped the start with
// `NoSuchMethodError: ... class_2170.method_71774(int)` from its /revive
// command and "Failed to load datapacks, can't proceed with server load".
//
// Two kinds of crash name the jar:
//   - a NoSuchMethodError, NoSuchFieldError, NoClassDefFoundError,
//     AbstractMethodError or IncompatibleClassChangeError whose stack runs
//     through the mod's own classes (the jar is the one holding the first
//     class that isn't the game's, the loader's or Java's);
//   - Fabric's "Incompatible mods found" with a mod that "requires version ...
//     of 'Minecraft'".
//
// It acts only when that start never got to "Done (", and only on jars the
// owner put in mods/ themselves: the image puts back the ones it downloads
// (Mody, mod packs) on every start, and the console tells the owner about
// those. The jars go to mods-disabled/ with a note saying why, so the owner
// can bring back a build made for the server's version.
func (a *agent) fixBrokenMods(ctx context.Context, id string) {
	if a.volumesDir == "" || a.docker == nil {
		return
	}
	logCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var lines []string
	_ = a.docker.Logs(logCtx, containerName(id), LogOptions{Tail: 400}, func(line string) error {
		lines = append(lines, line)
		return nil
	})
	crash := findModCrash(lines)
	if crash.empty() {
		return
	}
	s, err := a.openFiles(ctx, id)
	if err != nil {
		return
	}
	defer s.Close()
	jars := s.modJars()
	if len(jars) == 0 {
		return
	}
	managed := s.managedFiles()
	var moved []string
	for _, jar := range culpritJars(s, jars, crash) {
		if managed[jar] {
			log.Printf("mod guard %s: mods/%s stopped the start but the image puts it back; left for the owner", id, jar)
			continue
		}
		if err := s.mkdirAll("mods-disabled"); err != nil {
			log.Printf("mod guard %s: %v", id, err)
			return
		}
		if err := s.root.Rename("mods/"+jar, "mods-disabled/"+jar); err != nil {
			if !errors.Is(err, fs.ErrNotExist) {
				log.Printf("mod guard %s: %v", id, err)
			}
			continue
		}
		moved = append(moved, jar)
		log.Printf("mod guard %s: moved mods/%s to mods-disabled/ (%s)", id, jar, crash.reason)
	}
	if len(moved) > 0 {
		s.noteDisabledMods(moved, crash.reason)
	}
}

// modCrash is what the log says stopped a start.
type modCrash struct {
	jarNames []string // jar file names log4j printed next to stack frames
	classes  []string // classes in the stack that aren't the game's or the loader's
	modIDs   []string // Fabric mod IDs that need another Minecraft version
	reason   string
}

func (c modCrash) empty() bool {
	return len(c.jarNames) == 0 && len(c.classes) == 0 && len(c.modIDs) == 0
}

var (
	linkageError = regexp.MustCompile(`java\.lang\.(NoSuchMethodError|NoSuchFieldError|NoClassDefFoundError|AbstractMethodError|IncompatibleClassChangeError)\b`)
	// "\tat knot//nightfallmods.lifesteal.command.Revive.lambda$register$0(Revive.java:20) ~[lifesteal-1.0.jar:?]"
	// "\tat TRANSFORMER/create@0.5.1/com.simibubi.create.Create.init(Create.java:1)"
	stackFrame = regexp.MustCompile(`^\s*at\s+(?:\S*/)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\.[\w$<>]+\([^)]*\)(?:\s*~?\[([^\]:]+\.jar)[^\]]*\])?`)
	// " - Mod 'Lifesteal' (lifesteal) 1.0.0 requires version 1.21.9 of 'Minecraft' (minecraft), but only the wrong version is present: 1.21.11!"
	fabricWrongGame = regexp.MustCompile(`Mod '[^']*' \(([a-z][a-z0-9_-]{1,63})\) \S+ requires .*\(minecraft\)`)
)

// platformPackages are code that isn't a mod's own: when they're in a crash
// the mod that called them is to blame, not them.
var platformPackages = []string{
	"java.", "javax.", "jdk.", "sun.", "com.sun.",
	"net.minecraft.", "com.mojang.", "net.fabricmc.", "org.quiltmc.",
	"net.minecraftforge.", "net.neoforged.", "cpw.mods.", "org.spongepowered.",
	"com.google.", "it.unimi.", "io.netty.", "org.slf4j.", "org.apache.", "org.objectweb.",
	"com.llamalad7.", "joptsimple.", "oshi.", "org.jline.", "net.minecrell.",
}

func isPlatformClass(class string) bool {
	for _, p := range platformPackages {
		if strings.HasPrefix(class, p) {
			return true
		}
	}
	return false
}

// findModCrash reads a server's log for a start a mod stopped. Only the last
// start counts: one that got to "Done (" later in the log was fine.
func findModCrash(lines []string) modCrash {
	var c modCrash
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		if strings.Contains(line, "Done (") {
			c = modCrash{}
			continue
		}
		if m := fabricWrongGame.FindStringSubmatch(line); m != nil {
			c.modIDs = appendNew(c.modIDs, m[1])
			c.reason = "made for another Minecraft version"
			continue
		}
		if !linkageError.MatchString(line) {
			continue
		}
		if c.reason == "" {
			c.reason = "made for another Minecraft version: " + strings.TrimSpace(linkageError.FindString(line))
		}
		// The first frame of the trace that isn't the game's names the mod.
		for j := i + 1; j < len(lines) && j <= i+60; j++ {
			m := stackFrame.FindStringSubmatch(lines[j])
			if m == nil {
				if strings.Contains(lines[j], "Caused by:") || strings.Contains(lines[j], "... ") {
					continue
				}
				break
			}
			if isPlatformClass(m[1]) {
				continue
			}
			if m[2] != "" {
				c.jarNames = appendNew(c.jarNames, path.Base(m[2]))
			}
			c.classes = appendNew(c.classes, m[1])
			break
		}
	}
	return c
}

func appendNew(list []string, s string) []string {
	for _, v := range list {
		if v == s {
			return list
		}
	}
	return append(list, s)
}

// culpritJars matches what the crash names to the jars in mods/.
func culpritJars(s *serverFiles, jars []string, c modCrash) []string {
	var out []string
	has := map[string]bool{}
	for _, j := range jars {
		has[j] = true
	}
	for _, j := range c.jarNames {
		if has[j] {
			out = appendNew(out, j)
		}
	}
	if len(c.classes) == 0 && len(c.modIDs) == 0 {
		return out
	}
	for _, jar := range jars {
		if contains(out, jar) {
			continue
		}
		f, err := s.root.Open("mods/" + jar)
		if err != nil {
			continue
		}
		fi, err := f.Stat()
		if err != nil || fi.Size() > 512<<20 {
			f.Close()
			continue
		}
		z, err := zip.NewReader(f, fi.Size())
		if err != nil {
			f.Close()
			continue
		}
		if jarHasClass(z, c.classes) || contains(c.modIDs, fabricModID(z)) {
			out = append(out, jar)
		}
		f.Close()
	}
	return out
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s && s != "" {
			return true
		}
	}
	return false
}

func jarHasClass(z *zip.Reader, classes []string) bool {
	for _, class := range classes {
		name := strings.ReplaceAll(class, ".", "/") + ".class"
		for _, f := range z.File {
			if f.Name == name {
				return true
			}
		}
	}
	return false
}

// fabricModID is the "id" in a Fabric (or Quilt-compatible) jar's fabric.mod.json.
func fabricModID(z *zip.Reader) string {
	for _, f := range z.File {
		if f.Name != "fabric.mod.json" {
			continue
		}
		r, err := f.Open()
		if err != nil {
			return ""
		}
		defer r.Close()
		var meta struct {
			ID string `json:"id"`
		}
		if err := json.NewDecoder(io.LimitReader(r, 1<<20)).Decode(&meta); err != nil {
			return ""
		}
		return meta.ID
	}
	return ""
}

// modJars are the jar files right in mods/.
func (s *serverFiles) modJars() []string {
	d, err := s.root.Open("mods")
	if err != nil {
		return nil
	}
	defer d.Close()
	entries, err := d.ReadDir(-1)
	if err != nil {
		return nil
	}
	var jars []string
	for _, e := range entries {
		if e.Type().IsRegular() && strings.HasSuffix(strings.ToLower(e.Name()), ".jar") {
			jars = append(jars, e.Name())
		}
	}
	return jars
}

// managedFiles are the jars in mods/ the image downloaded and keeps track of
// (in its .*manifest*.json files): it puts them back on every start.
func (s *serverFiles) managedFiles() map[string]bool {
	out := map[string]bool{}
	for _, dir := range []string{".", "mods"} {
		d, err := s.root.Open(dir)
		if err != nil {
			continue
		}
		entries, _ := d.ReadDir(-1)
		d.Close()
		for _, e := range entries {
			n := e.Name()
			if !e.Type().IsRegular() || !strings.HasPrefix(n, ".") || !strings.Contains(n, "manifest") || !strings.HasSuffix(n, ".json") {
				continue
			}
			f, err := s.root.Open(path.Join(dir, n))
			if err != nil {
				continue
			}
			var any interface{}
			err = json.NewDecoder(io.LimitReader(f, 16<<20)).Decode(&any)
			f.Close()
			if err == nil {
				collectJarNames(any, out)
			}
		}
	}
	return out
}

func collectJarNames(v interface{}, out map[string]bool) {
	switch v := v.(type) {
	case string:
		if strings.HasSuffix(strings.ToLower(v), ".jar") {
			out[path.Base(strings.ReplaceAll(v, `\`, "/"))] = true
		}
	case []interface{}:
		for _, x := range v {
			collectJarNames(x, out)
		}
	case map[string]interface{}:
		for _, x := range v {
			collectJarNames(x, out)
		}
	}
}

const disabledModsNote = "mods-disabled/PRZECZYTAJ.txt"

// noteDisabledMods tells the owner, in Files, why mods left mods/.
func (s *serverFiles) noteDisabledMods(jars []string, reason string) {
	var b strings.Builder
	if f, err := s.root.Open(disabledModsNote); err == nil {
		_, _ = io.Copy(&b, io.LimitReader(f, 64<<10))
		f.Close()
	}
	b.WriteString(time.Now().UTC().Format("2006-01-02 15:04") + " UTC\n")
	for _, j := range jars {
		b.WriteString("  " + j + "\n")
	}
	b.WriteString("PL: Te mody zatrzymywały start serwera (są zrobione na inną wersję Minecrafta albo brakuje im innego moda), więc przenieśliśmy je tutaj i serwer startuje bez nich. Wgraj ich wersję dla wersji Twojego serwera do folderu mods (albo dodaj brakujący mod).\n")
	b.WriteString("EN: These mods stopped the server from starting (" + reason + "), so they were moved here and the server starts without them. Put a build made for your server's version into mods.\n\n")
	_, _ = s.writeFile(disabledModsNote, strings.NewReader(b.String()))
}
