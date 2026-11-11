package main

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeJar(t *testing.T, file string, entries map[string]string) {
	t.Helper()
	f, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	z := zip.NewWriter(f)
	for name, body := range entries {
		w, _ := z.Create(name)
		w.Write([]byte(body))
	}
	z.Close()
	f.Close()
}

// The Sansgranie log (Fabric 1.21.11, Lifesteal for 1.21.9), shortened.
const lifestealCrash = `[12:01:02] [Server thread/ERROR]: Failed to load datapacks, can't proceed with server load
java.util.concurrent.CompletionException: java.lang.NoSuchMethodError: 'net.minecraft.class_11413 net.minecraft.class_2170.method_71774(int)'
	at java.base/java.util.concurrent.CompletableFuture.encodeThrowable(CompletableFuture.java:315)
	at knot//net.minecraft.class_5350.method_29466(class_5350.java:98)
Caused by: java.lang.NoSuchMethodError: 'net.minecraft.class_11413 net.minecraft.class_2170.method_71774(int)'
	at knot//nightfallmods.lifesteal.command.Revive.lambda$register$0(Revive.java:20)
	at knot//net.fabricmc.fabric.api.event.Event.invoker(Event.java:1)
	... 12 more
`

func modGuardAgent(t *testing.T, logLines string) (*agent, string) {
	a, data := paperConfigAgent(t, logLines)
	os.MkdirAll(filepath.Join(data, "mods"), 0o755)
	writeJar(t, filepath.Join(data, "mods", "lifesteal-1.0.jar"), map[string]string{
		"fabric.mod.json": `{"id":"lifesteal"}`,
		"nightfallmods/lifesteal/command/Revive.class": "x",
	})
	writeJar(t, filepath.Join(data, "mods", "jei.jar"), map[string]string{
		"fabric.mod.json": `{"id":"jei"}`,
		"mezz/jei/Jei.class": "x",
	})
	return a, data
}

func TestFixBrokenModsSetsAsideTheModThatStoppedTheStart(t *testing.T) {
	a, data := modGuardAgent(t, lifestealCrash)
	a.fixBrokenMods(context.Background(), "abc12345")
	if _, err := os.Stat(filepath.Join(data, "mods-disabled", "lifesteal-1.0.jar")); err != nil {
		t.Fatal("not set aside:", err)
	}
	if _, err := os.Stat(filepath.Join(data, "mods", "jei.jar")); err != nil {
		t.Fatal("another mod went too:", err)
	}
	note, _ := os.ReadFile(filepath.Join(data, "mods-disabled", "PRZECZYTAJ.txt"))
	if !strings.Contains(string(note), "lifesteal-1.0.jar") {
		t.Fatalf("note: %q", note)
	}
}

func TestFixBrokenModsLeavesAServerThatStartedLater(t *testing.T) {
	a, data := modGuardAgent(t, lifestealCrash+"[12:05:00] [Server thread/INFO]: Done (8.1s)! For help, type \"help\"\n")
	a.fixBrokenMods(context.Background(), "abc12345")
	if _, err := os.Stat(filepath.Join(data, "mods", "lifesteal-1.0.jar")); err != nil {
		t.Fatal("moved without a reason:", err)
	}
}

func TestFixBrokenModsLeavesModsTheImageDownloads(t *testing.T) {
	a, data := modGuardAgent(t, lifestealCrash)
	os.WriteFile(filepath.Join(data, ".modrinth-manifest.json"), []byte(`{"files":["mods/lifesteal-1.0.jar"]}`), 0o644)
	a.fixBrokenMods(context.Background(), "abc12345")
	if _, err := os.Stat(filepath.Join(data, "mods", "lifesteal-1.0.jar")); err != nil {
		t.Fatal("moved a jar the image puts back:", err)
	}
}

func TestFixBrokenModsReadsFabricsWrongMinecraftMessage(t *testing.T) {
	a, data := modGuardAgent(t, "[main/ERROR]: Incompatible mods found!\n"+
		"\t - Mod 'Lifesteal' (lifesteal) 1.0.0 requires version 1.21.9 of 'Minecraft' (minecraft), but only the wrong version is present: 1.21.11!\n")
	a.fixBrokenMods(context.Background(), "abc12345")
	if _, err := os.Stat(filepath.Join(data, "mods-disabled", "lifesteal-1.0.jar")); err != nil {
		t.Fatal("not set aside:", err)
	}
}

func TestFindModCrashUsesTheJarLog4jNames(t *testing.T) {
	c := findModCrash([]string{
		"java.lang.NoClassDefFoundError: net/minecraft/class_1234",
		"\tat com.example.cool.Mod.init(Mod.java:5) ~[cool-mod-2.jar:?]",
	})
	if len(c.jarNames) != 1 || c.jarNames[0] != "cool-mod-2.jar" || c.classes[0] != "com.example.cool.Mod" {
		t.Fatalf("%+v", c)
	}
}
