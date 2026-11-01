package main

import (
	"strings"
	"testing"
)

func TestLinksPack(t *testing.T) {
	files := linksPack([]serverLink{{Name: "skyblock", Host: "skyblock.mchosting.pl"}, {Name: "lobby_2", Host: "lobby-2.mchosting.pl"}})
	for _, dir := range []string{"function", "functions"} {
		tick := files["data/mchost_link/"+dir+"/tick.mcfunction"]
		for _, want := range []string{"scoreboard players enable @a skyblock\n", "execute as @a[scores={lobby_2=1..}] run function mchost_link:go_lobby_2\n"} {
			if !strings.Contains(tick, want) {
				t.Errorf("%s tick lacks %q:\n%s", dir, want, tick)
			}
		}
		if go_ := files["data/mchost_link/"+dir+"/go_skyblock.mcfunction"]; !strings.Contains(go_, "transfer skyblock.mchosting.pl 25565 @s\n") {
			t.Errorf("go_skyblock: %s", go_)
		}
		if !strings.Contains(files["data/mchost_link/"+dir+"/load.mcfunction"], "scoreboard objectives add lobby_2 trigger\n") {
			t.Error("load lacks the trigger")
		}
		if files["data/minecraft/tags/"+dir+"/tick.json"] == "" {
			t.Error("no tick tag")
		}
	}
	if hello := files["data/mchost_link/function/hello.mcfunction"]; !strings.Contains(hello, `"command":"/trigger skyblock"`) {
		t.Errorf("hello: %s", hello)
	}
}

func TestLinksValidateAndEnv(t *testing.T) {
	if err := validLinks([]serverLink{{Name: "a b", Host: "x.mchosting.pl"}}, "me.mchosting.pl"); err == nil {
		t.Error("a name with a space passed")
	}
	if err := validLinks([]serverLink{{Name: "me", Host: "me.mchosting.pl"}}, "me.mchosting.pl"); err == nil {
		t.Error("a link to itself passed")
	}
	if err := validLinks([]serverLink{{Name: "x", Host: "x.mchosting.pl"}}, "me.mchosting.pl"); err != nil {
		t.Error(err)
	}
	if env := strings.Join(linksEnv([]serverLink{{Name: "x", Host: "x.mchosting.pl"}}), " "); env != "ACCEPTS_TRANSFERS=true FUNCTION_PERMISSION_LEVEL=3" {
		t.Error(env)
	}
	if env := strings.Join(linksEnv(nil), " "); env != "ACCEPTS_TRANSFERS=false FUNCTION_PERMISSION_LEVEL=2" {
		t.Error(env)
	}
}
