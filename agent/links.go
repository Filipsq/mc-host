package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"path"
	"regexp"
	"strings"
)

// Linked servers: an owner's Java servers whose players move between them in
// the game, without a proxy. Minecraft 1.20.5 and newer can send a player's
// game to another address with the transfer command, and a server lets such
// players in when accepts-transfers is on. Each linked server gets a small
// data pack of ours: anyone types /trigger <name> (or clicks the name the
// server shows in chat when they join) and lands on that server, through the
// main router like a player who typed its address. Transfer needs permission
// level 3, so functions run at 3 on a linked server (only the owner adds data
// packs). Each server keeps its own world, inventory and plugins.

type serverLink struct {
	Name string `json:"name"` // what players type after /trigger: the address's first part
	Host string `json:"host"` // the Java address players are sent to
}

const linksMax = 10

var validLinkName = regexp.MustCompile(`^[a-z0-9_-]{1,32}$`)

// The data pack's folder in the world; written over on every new container, taken away when there are no links.
const linksPackDir = "datapacks/mchost-polaczone"

func validLinks(links []serverLink, self string) error {
	if len(links) > linksMax {
		return fmt.Errorf("at most %d links", linksMax)
	}
	for _, l := range links {
		if !validLinkName.MatchString(l.Name) || !validHost.MatchString(l.Host) || l.Host == self {
			return fmt.Errorf("invalid link %q", l.Name)
		}
	}
	return nil
}

// linksEnv lets transferred players in and lets the data pack's functions use transfer.
func linksEnv(links []serverLink) []string {
	if len(links) == 0 {
		return []string{"ACCEPTS_TRANSFERS=false", "FUNCTION_PERMISSION_LEVEL=2"}
	}
	return []string{"ACCEPTS_TRANSFERS=true", "FUNCTION_PERMISSION_LEVEL=3"}
}

// clickable is a chat part that runs a command when clicked. Minecraft 1.21.5
// renamed the fields; each version reads its own and skips the other.
func clickable(text, command, hover string) map[string]any {
	return map[string]any{
		"text": text, "color": "green", "bold": true,
		"click_event": map[string]any{"action": "run_command", "command": command},
		"clickEvent":  map[string]any{"action": "run_command", "value": command},
		"hover_event": map[string]any{"action": "show_text", "value": hover},
		"hoverEvent":  map[string]any{"action": "show_text", "contents": hover},
	}
}

func tellraw(parts ...any) string {
	b, _ := json.Marshal(parts)
	return "tellraw @s " + string(b)
}

// linksPack is the data pack's files for these links, by path in the pack.
func linksPack(links []serverLink) map[string]string {
	files := map[string]string{
		"pack.mcmeta": `{"pack":{"description":"MCHosting: połączone serwery","pack_format":41,"supported_formats":[41,999],"min_format":41,"max_format":999}}`,
	}
	load := []string{"scoreboard objectives add mchost_left minecraft.custom:minecraft.leave_game"}
	tick := []string{}
	hello := []string{"scoreboard players set @s mchost_left 0", "tag @s add mchost_link_hi"}
	parts := []any{map[string]any{"text": "Połączone serwery: ", "color": "gold"}}
	funcs := map[string]string{}
	for i, l := range links {
		load = append(load, fmt.Sprintf("scoreboard objectives add %s trigger", l.Name))
		tick = append(tick,
			fmt.Sprintf("scoreboard players enable @a %s", l.Name),
			fmt.Sprintf("execute as @a[scores={%s=1..}] run function mchost_link:go_%s", l.Name, l.Name))
		if i > 0 {
			parts = append(parts, map[string]any{"text": " ", "color": "gray"})
		}
		parts = append(parts, clickable("["+l.Name+"]", "/trigger "+l.Name, "Przejdź na "+l.Host))
		funcs["go_"+l.Name] = strings.Join([]string{
			fmt.Sprintf("scoreboard players set @s %s 0", l.Name),
			tellraw(map[string]any{"text": "Przenoszę cię na " + l.Host + "...", "color": "yellow"}),
			fmt.Sprintf("transfer %s 25565 @s", l.Host),
		}, "\n") + "\n"
	}
	parts = append(parts, map[string]any{"text": " (kliknij albo wpisz /trigger nazwa)", "color": "gray"})
	hello = append(hello, tellraw(parts...))
	// Greets each player as they join: the first time, and again after each time they left.
	tick = append(tick,
		"execute as @a[tag=!mchost_link_hi] run function mchost_link:hello",
		"execute as @a[scores={mchost_left=1..}] run function mchost_link:hello")
	funcs["load"] = strings.Join(load, "\n") + "\n"
	funcs["tick"] = strings.Join(tick, "\n") + "\n"
	funcs["hello"] = strings.Join(hello, "\n") + "\n"
	// 1.21 renamed the folders to the singular; 1.20.5 and 1.20.6 read the plural.
	for _, dir := range []string{"function", "functions"} {
		for name, body := range funcs {
			files["data/mchost_link/"+dir+"/"+name+".mcfunction"] = body
		}
		files["data/minecraft/tags/"+dir+"/load.json"] = `{"values":["mchost_link:load"]}`
		files["data/minecraft/tags/"+dir+"/tick.json"] = `{"values":["mchost_link:tick"]}`
	}
	return files
}

// prepareLinks puts the data pack for the server's links in its world's folder, or takes it away.
func (a *agent) prepareLinks(ctx context.Context, id, level string, links []serverLink) {
	if a.volumesDir == "" {
		return
	}
	s, err := a.openFiles(ctx, id)
	if err != nil {
		log.Printf("links %s: %v", id, err)
		return
	}
	defer s.Close()
	dir := path.Join(level, linksPackDir)
	if err := s.root.RemoveAll(dir); err != nil {
		log.Printf("links %s: %v", id, err)
		return
	}
	if len(links) == 0 {
		return
	}
	for name, body := range linksPack(links) {
		if _, err := s.writeFile(path.Join(dir, name), strings.NewReader(body)); err != nil {
			log.Printf("links %s: %v", id, err)
			return
		}
	}
}
