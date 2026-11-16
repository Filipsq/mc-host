package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	bpUUID = "1a2b3c4d-0000-4000-8000-000000000001"
	rpUUID = "1a2b3c4d-0000-4000-8000-000000000002"
)

func TestBedrockPacks(t *testing.T) {
	h, _, data := filesAgent(t)
	writeFiles(t, data, map[string]string{
		"behavior_packs/vanilla/manifest.json":           `{"header":{"uuid":"ee649bcf-256c-4013-9068-6a802b89d756","version":[1,0,0]},"modules":[{"type":"data"}]}`,
		"worlds/Bedrock level/level.dat":                 "x",
		"worlds/Bedrock level/world_behavior_packs.json": `[{"pack_id":"ffffffff-0000-4000-8000-000000000009","version":[1,0,0]}]`,
	})
	upload := func(body []byte) {
		t.Helper()
		if err := os.MkdirAll(filepath.Join(data, ".addon-uploads"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(data, ".addon-uploads", "a.mcaddon"), body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// A .mcaddon with a behavior pack (manifest with comments and a trailing
	// comma, a beta script) and a resource pack inside its own folder.
	bp := zipOf(t, map[string]string{
		"manifest.json": `{
			// made by hand
			"header": {"name": "§aSmoki", "uuid": "` + strings.ToUpper(bpUUID) + `", "version": "2.1.0"},
			"modules": [{"type": "data"}, {"type": "script"},],
			"dependencies": [{"module_name": "@minecraft/server", "version": "1.12.0-beta"}]
		}`,
		"entities/dragon.json": "{}",
	})
	rp := zipOf(t, map[string]string{
		"Smoki RP/manifest.json":            `{"header":{"name":"pack.name","uuid":"` + rpUUID + `","version":[1,0,3]},"modules":[{"type":"resources"}]}`,
		"Smoki RP/textures/dragon.png":      "png",
		"__MACOSX/Smoki RP/._manifest.json": "junk",
	})
	upload(zipOf(t, map[string]string{"Smoki BP.mcpack": string(bp), "Smoki RP.mcpack": string(rp)}))
	rec := call(t, h, "POST", "/servers/abc12345/bedrock-packs/import?path=.addon-uploads/a.mcaddon&world="+q("Bedrock level"), nil)
	if rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body)
	}
	var got struct{ Packs []bedrockPack }
	json.Unmarshal(rec.Body.Bytes(), &got)
	if len(got.Packs) != 2 || got.Packs[0].Name != "Smoki" || !got.Packs[0].Beta || got.Packs[1].Name != "Smoki RP" || got.Packs[1].Type != "resource" {
		t.Fatalf("packs = %+v", got.Packs)
	}
	if b, _ := os.ReadFile(filepath.Join(data, "behavior_packs", "Smoki-1a2b3c4d", "entities", "dragon.json")); string(b) != "{}" {
		t.Fatal("behavior pack not unpacked")
	}
	if b, _ := os.ReadFile(filepath.Join(data, "resource_packs", "Smoki_RP-1a2b3c4d", "textures", "dragon.png")); string(b) != "png" {
		t.Fatal("resource pack not unpacked from its folder")
	}
	if _, err := os.Stat(filepath.Join(data, ".addon-uploads", "a.mcaddon")); !os.IsNotExist(err) {
		t.Error("the upload should be deleted")
	}
	b, _ := os.ReadFile(filepath.Join(data, "worlds", "Bedrock level", "world_behavior_packs.json"))
	var list []worldPackEntry
	json.Unmarshal(b, &list)
	if len(list) != 2 || list[0].PackID != bpUUID || list[1].PackID != "ffffffff-0000-4000-8000-000000000009" {
		t.Fatalf("world_behavior_packs.json = %s", b)
	}
	if !strings.Contains(string(b), "2,\n") {
		t.Errorf("a string version should be written as numbers: %s", b)
	}
	b, _ = os.ReadFile(filepath.Join(data, "worlds", "Bedrock level", "world_resource_packs.json"))
	if !strings.Contains(string(b), rpUUID) {
		t.Fatalf("world_resource_packs.json = %s", b)
	}

	// Again: replaced, not listed twice.
	upload(zipOf(t, map[string]string{"Smoki BP.mcpack": string(bp)}))
	if rec := call(t, h, "POST", "/servers/abc12345/bedrock-packs/import?path=.addon-uploads/a.mcaddon", nil); rec.Code != 200 {
		t.Fatalf("again: %d %s", rec.Code, rec.Body)
	}
	b, _ = os.ReadFile(filepath.Join(data, "worlds", "Bedrock level", "world_behavior_packs.json"))
	if strings.Count(string(b), bpUUID) != 1 {
		t.Fatalf("listed twice: %s", b)
	}

	rec = call(t, h, "GET", "/servers/abc12345/bedrock-packs?world="+q("Bedrock level"), nil)
	if !strings.Contains(rec.Body.String(), `"name":"Smoki"`) || !strings.Contains(rec.Body.String(), `"name":"Smoki RP"`) {
		t.Fatalf("list: %s", rec.Body)
	}

	// Removing takes it off the world and deletes its folder.
	if rec := call(t, h, "DELETE", "/servers/abc12345/bedrock-packs/"+bpUUID, nil); rec.Code != 200 {
		t.Fatalf("remove: %d %s", rec.Code, rec.Body)
	}
	if _, err := os.Stat(filepath.Join(data, "behavior_packs", "Smoki-1a2b3c4d")); !os.IsNotExist(err) {
		t.Error("folder left")
	}
	b, _ = os.ReadFile(filepath.Join(data, "worlds", "Bedrock level", "world_behavior_packs.json"))
	if strings.Contains(string(b), bpUUID) {
		t.Errorf("still listed: %s", b)
	}
	// The server's own packs stay.
	if rec := call(t, h, "DELETE", "/servers/abc12345/bedrock-packs/ee649bcf-256c-4013-9068-6a802b89d756", nil); rec.Code != 200 {
		t.Fatalf("remove builtin: %d", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(data, "behavior_packs", "vanilla", "manifest.json")); err != nil {
		t.Error("vanilla pack deleted")
	}

	// Files that aren't server packs say what they are.
	for _, tc := range []struct {
		files map[string]string
		want  string
	}{
		{map[string]string{"readme.txt": "hi"}, "noPack"},
		{map[string]string{"manifest.json": `{"header":{"uuid":"` + rpUUID + `"},"modules":[{"type":"skin_pack"}]}`}, "skinPack"},
		{map[string]string{"manifest.json": `{"header":{"uuid":"` + rpUUID + `"},"modules":[{"type":"world_template"}]}`}, "worldTemplate"},
	} {
		upload(zipOf(t, tc.files))
		rec := call(t, h, "POST", "/servers/abc12345/bedrock-packs/import?path=.addon-uploads/a.mcaddon", nil)
		if rec.Code != 400 || !strings.Contains(rec.Body.String(), tc.want) {
			t.Errorf("%s: %d %s", tc.want, rec.Code, rec.Body)
		}
	}
}
