package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestTrimArea(t *testing.T) {
	a := trimArea{0, 0, 1000}
	// Region 1 spans blocks 512..1023, region 2 starts at 1024; region -2 ends at -513, -3 at -1025.
	for _, c := range []struct {
		rx, rz int
		keep   bool
	}{{0, 0, true}, {1, 1, true}, {2, 0, false}, {-2, -2, true}, {-3, 0, false}, {0, -1954, false}} {
		if got := a.keeps(c.rx, c.rz); got != c.keep {
			t.Errorf("keeps(%d,%d) = %v", c.rx, c.rz, got)
		}
	}
	if r := a.reach(-3125, 0); r != 1600000 {
		t.Errorf("reach = %d", r)
	}
	if floorDiv(-1, 32) != -1 || floorDiv(-32, 32) != -1 || floorDiv(-33, 32) != -2 || floorDiv(31, 32) != 0 {
		t.Error("floorDiv")
	}
}

func TestWorldTrim(t *testing.T) {
	h, _, data := filesAgent(t)
	writeFiles(t, data, map[string]string{
		"world/level.dat":                                     "a",
		"world/region/r.0.0.mca":                              "near",
		"world/region/r.-1.-1.mca":                            "near",
		"world/region/r.0.-3000.mca":                          "far far far",
		"world/region/c.0.-96000.mcc":                         "far",
		"world/entities/r.0.-3000.mca":                        "far",
		"world/poi/r.0.-3000.mca":                             "far",
		"world/region/notes.txt":                              "keep",
		"world_nether/level.dat":                              "n",
		"world_nether/DIM-1/region/r.5.5.mca":                 "nether far",
		"world_nether/DIM-1/region/r.0.0.mca":                 "nether",
		"world/dimensions/minecraft/the_end/region/r.9.0.mca": "end",
	})
	rec := call(t, h, "GET", "/servers/abc12345/worlds/world/trim?radius=2000", nil)
	if rec.Code != 200 {
		t.Fatalf("preview: %d %s", rec.Code, rec.Body)
	}
	var p trimPreview
	json.Unmarshal(rec.Body.Bytes(), &p)
	if p.Files != 9 || p.Cut == nil || p.Cut.Files != 6 || p.Reach != 1536000 {
		t.Fatalf("preview = %+v", p)
	}
	if len(p.Dimensions) != 3 || p.Dimensions[0].Dimension != "overworld" || p.Dimensions[1].Dimension != "nether" || p.Dimensions[2].Dimension != "end" {
		t.Errorf("dimensions = %+v", p.Dimensions)
	}
	if len(p.Cuts) != len(trimRadii) || p.Cuts[0].Files != 6 {
		t.Errorf("cuts = %+v", p.Cuts)
	}

	if rec := call(t, h, "POST", "/servers/abc12345/worlds/world/trim?radius=500", nil); rec.Code != 400 {
		t.Errorf("radius under the minimum: %d", rec.Code)
	}
	if rec := call(t, h, "POST", "/servers/abc12345/worlds/world/trim", nil); rec.Code != 400 {
		t.Errorf("no radius: %d", rec.Code)
	}
	if rec := call(t, h, "POST", "/servers/abc12345/worlds/world/trim?radius=2000&edition=BEDROCK", nil); rec.Code != 400 {
		t.Errorf("bedrock: %d", rec.Code)
	}
	rec = call(t, h, "POST", "/servers/abc12345/worlds/world/trim?radius=2000", nil)
	if rec.Code != 200 {
		t.Fatalf("trim: %d %s", rec.Code, rec.Body)
	}
	var res struct{ Files int }
	json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Files != 6 {
		t.Errorf("removed %d", res.Files)
	}
	for _, gone := range []string{"world/region/r.0.-3000.mca", "world/region/c.0.-96000.mcc", "world/entities/r.0.-3000.mca", "world/poi/r.0.-3000.mca", "world_nether/DIM-1/region/r.5.5.mca", "world/dimensions/minecraft/the_end/region/r.9.0.mca"} {
		if _, err := os.Stat(filepath.Join(data, gone)); err == nil {
			t.Errorf("%s still there", gone)
		}
	}
	for _, kept := range []string{"world/region/r.0.0.mca", "world/region/r.-1.-1.mca", "world/region/notes.txt", "world_nether/DIM-1/region/r.0.0.mca", "world/level.dat"} {
		if _, err := os.Stat(filepath.Join(data, kept)); err != nil {
			t.Errorf("%s gone", kept)
		}
	}

	rec = call(t, h, "GET", "/servers/abc12345/usage", nil)
	var u struct {
		Entries []usageEntry
		Total   int64
	}
	json.Unmarshal(rec.Body.Bytes(), &u)
	if rec.Code != 200 || len(u.Entries) != 2 || u.Entries[0].Name != "world" {
		t.Errorf("usage: %d %+v", rec.Code, u)
	}
}
