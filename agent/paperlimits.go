package main

import (
	"context"
	"sort"
	"strconv"
	"strings"
)

// paperEntityLimits are how many of each of these entities Paper saves in one
// chunk (chunks.entity-per-chunk-save-limit in paper-world-defaults.yml); the
// rest are gone the next time the chunk is saved. Paper leaves them unlimited
// (-1), so a farm dropping items nobody picks up, or a pile of XP orbs, grows
// until loading the chunk stalls the server: a Paper 26.3 server froze for 10
// to 22 s each time kakal1991 came near his base, the watchdog stuck in
// EntityLookup / Entity.load (2026-11-15). Mobs aren't limited: they're pets,
// villagers and farm animals.
var paperEntityLimits = map[string]int{
	"item":           256,
	"tnt":            64, // primed TNT: a pile of it ran a free 2 GB server out of memory (2026-11-15)
	"experience_orb": 16,
	"arrow":          16,
	"snowball":       8,
	"ender_pearl":    8,
	"fireball":       8,
	"small_fireball": 8,
}

// limitPaperEntities writes paperEntityLimits into a Paper (or Purpur) server's
// paper-world-defaults.yml, where an entity is still unlimited: a limit the
// owner set stays. Paper writes the file on its first start, so a new server
// gets the limits from its second start on.
func (a *agent) limitPaperEntities(ctx context.Context, id string) {
	if a.volumesDir == "" {
		return
	}
	s, err := a.openFiles(ctx, id)
	if err != nil {
		return
	}
	defer s.Close()
	s.fixConfig("config/paper-world-defaults.yml", func(text string) string {
		return setEntitySaveLimits(text, paperEntityLimits)
	})
}

// setEntitySaveLimits sets limits under chunks.entity-per-chunk-save-limit
// where the value is -1 or missing, leaving every other line as it is.
func setEntitySaveLimits(text string, limits map[string]int) string {
	lines := strings.Split(text, "\n")
	chunksIndent := -1
	for i := 0; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimLeft(line, " ")
		indent := len(line) - len(trimmed)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		if indent == 0 {
			chunksIndent = -1
			if strings.TrimSpace(trimmed) == "chunks:" {
				chunksIndent = 0
			}
			continue
		}
		if chunksIndent < 0 {
			continue
		}
		key, value, ok := strings.Cut(trimmed, ":")
		if !ok || strings.TrimSpace(key) != "entity-per-chunk-save-limit" {
			continue
		}
		value = strings.TrimSpace(value)
		if value != "" && value != "{}" {
			return text // a flow mapping or something else we don't read
		}
		// The section's own entries.
		childIndent := -1
		seen := map[string]bool{}
		end := i + 1
		if value == "" {
			for ; end < len(lines); end++ {
				l := lines[end]
				t := strings.TrimLeft(l, " ")
				if t == "" || strings.HasPrefix(t, "#") {
					continue
				}
				in := len(l) - len(t)
				if in <= indent {
					break
				}
				if childIndent < 0 {
					childIndent = in
				}
				if in != childIndent {
					continue
				}
				k, v, ok := strings.Cut(t, ":")
				if !ok {
					continue
				}
				k = strings.Trim(strings.TrimSpace(k), `"'`)
				k = strings.TrimPrefix(k, "minecraft:")
				seen[k] = true
				if want, ok := limits[k]; ok && strings.TrimSpace(v) == "-1" {
					lines[end] = l[:in] + t[:strings.Index(t, ":")] + ": " + strconv.Itoa(want)
				}
			}
			// Leave the blank lines and comments after the section where they are.
			for end > i+1 && strings.TrimSpace(lines[end-1]) == "" {
				end--
			}
		} else {
			lines[i] = line[:indent] + "entity-per-chunk-save-limit:"
		}
		if childIndent < 0 {
			childIndent = indent + 2
		}
		var add []string
		for _, k := range sortedKeys(limits) {
			if !seen[k] {
				add = append(add, strings.Repeat(" ", childIndent)+k+": "+strconv.Itoa(limits[k]))
			}
		}
		if len(add) > 0 {
			lines = append(lines[:end], append(add, lines[end:]...)...)
		}
		return strings.Join(lines, "\n")
	}
	return text
}

func sortedKeys(m map[string]int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
