package main

import (
	"bytes"
	"compress/gzip"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"io/fs"
	"math/bits"
	"net/http"
	"strconv"
	"strings"
)

// A Java world seen from above, as a small picture: the top block of every
// column around the spawn, coloured like a Minecraft map and shaded by height
// so hills show. Read straight from the region files (worlds from 1.18 on,
// whose chunks keep "sections" with block palettes); a running server's files
// are read as they are, and a chunk being written just stays dark.

const (
	mapDefaultSize = 384  // blocks across
	mapMaxSize     = 1024 // 2×2 regions at most, so a request reads ≤ ~40 MB
	mapMaxRegion   = 64 << 20
)

// ---- a small NBT decoder: compounds become map[string]any, lists []any ----

func (r *nbtReader) i16() (int, error) {
	b, err := r.take(2)
	if err != nil {
		return 0, err
	}
	return int(int16(binary.BigEndian.Uint16(b))), nil
}

func (r *nbtReader) i64() (int64, error) {
	b, err := r.take(8)
	if err != nil {
		return 0, err
	}
	return int64(binary.BigEndian.Uint64(b)), nil
}

// value reads the value of a tag of type t. Arrays and numbers other than the
// ones the map needs are skipped (nil).
func (r *nbtReader) value(t byte, depth int) (any, error) {
	if depth > nbtMaxDepth {
		return nil, errBadNBT
	}
	switch t {
	case 1:
		b, err := r.u8()
		return int(int8(b)), err
	case 2:
		return r.i16()
	case 3:
		return r.i32()
	case 8:
		return r.str()
	case 11:
		n, err := r.i32()
		if err != nil || n < 0 || n > (len(r.b)-r.p)/4 {
			return nil, errBadNBT
		}
		out := make([]int, n)
		for i := range out {
			out[i], _ = r.i32()
		}
		return out, nil
	case 12:
		n, err := r.i32()
		if err != nil || n < 0 || n > (len(r.b)-r.p)/8 {
			return nil, errBadNBT
		}
		out := make([]int64, n)
		for i := range out {
			out[i], _ = r.i64()
		}
		return out, nil
	case nbtList:
		et, err := r.u8()
		if err != nil {
			return nil, err
		}
		n, err := r.i32()
		if err != nil || n < 0 || n > len(r.b)-r.p {
			return nil, errBadNBT
		}
		out := make([]any, 0, n)
		for i := 0; i < n; i++ {
			v, err := r.value(et, depth+1)
			if err != nil {
				return nil, err
			}
			out = append(out, v)
		}
		return out, nil
	case nbtCompound:
		out := map[string]any{}
		for {
			ct, err := r.u8()
			if err != nil {
				return nil, err
			}
			if ct == nbtEnd {
				return out, nil
			}
			name, err := r.str()
			if err != nil {
				return nil, err
			}
			v, err := r.value(ct, depth+1)
			if err != nil {
				return nil, err
			}
			out[name] = v
		}
	default:
		return nil, r.skip(t, depth)
	}
}

// decodeNBT reads a whole NBT document: its root compound.
func decodeNBT(b []byte) (map[string]any, error) {
	r := &nbtReader{b: b}
	t, err := r.u8()
	if err != nil || t != nbtCompound {
		return nil, errBadNBT
	}
	if _, err := r.str(); err != nil {
		return nil, err
	}
	v, err := r.value(nbtCompound, 0)
	if err != nil {
		return nil, err
	}
	return v.(map[string]any), nil
}

func nbtInt(v any) (int, bool) {
	n, ok := v.(int)
	return n, ok
}

// ---- reading chunks ----

// mapRegion is one region file's raw bytes (nil when not generated).
type mapRegion []byte

// chunk returns the decoded chunk at (cx, cz) inside the region (0..31), or nil.
func (reg mapRegion) chunk(cx, cz int) map[string]any {
	if len(reg) < 8192 {
		return nil
	}
	i := 4 * (cx + cz*32)
	loc := binary.BigEndian.Uint32(reg[i : i+4])
	off := int(loc>>8) * 4096
	if off == 0 || off+5 > len(reg) {
		return nil
	}
	n := int(binary.BigEndian.Uint32(reg[off : off+4]))
	if n < 1 || off+4+n > len(reg) {
		return nil
	}
	data := reg[off+5 : off+4+n]
	var rd io.Reader
	var err error
	switch reg[off+4] {
	case 1:
		rd, err = gzip.NewReader(bytes.NewReader(data))
	case 2:
		rd, err = zlib.NewReader(bytes.NewReader(data))
	case 3:
		rd = bytes.NewReader(data)
	default: // LZ4 or a chunk kept in its own .mcc file: not drawn
		return nil
	}
	if err != nil {
		return nil
	}
	raw, err := io.ReadAll(io.LimitReader(rd, 16<<20))
	if err != nil {
		return nil
	}
	c, err := decodeNBT(raw)
	if err != nil {
		return nil
	}
	return c
}

// mapSection is one 16×16×16 cube: its palette's block names and their packed indexes.
type mapSection struct {
	names []string
	data  []int64
	bits  int
}

func (s *mapSection) at(x, y, z int) string {
	if len(s.names) == 1 || len(s.data) == 0 {
		return s.names[0]
	}
	i := (y*16+z)*16 + x
	per := 64 / s.bits
	w := i / per
	if w >= len(s.data) {
		return s.names[0]
	}
	idx := int(uint64(s.data[w])>>uint((i%per)*s.bits)) & (1<<s.bits - 1)
	if idx >= len(s.names) {
		return s.names[0]
	}
	return s.names[idx]
}

// sectionsOf reads a chunk's sections by their Y, top first.
func sectionsOf(c map[string]any) (ys []int, secs map[int]*mapSection) {
	list, _ := c["sections"].([]any)
	secs = map[int]*mapSection{}
	for _, v := range list {
		sec, _ := v.(map[string]any)
		y, ok := nbtInt(sec["Y"])
		if !ok {
			continue
		}
		states, _ := sec["block_states"].(map[string]any)
		palette, _ := states["palette"].([]any)
		if len(palette) == 0 {
			continue
		}
		names := make([]string, len(palette))
		allAir := true
		for i, p := range palette {
			pm, _ := p.(map[string]any)
			names[i], _ = pm["Name"].(string)
			names[i] = strings.TrimPrefix(names[i], "minecraft:")
			if !isClear(names[i]) {
				allAir = false
			}
		}
		if allAir {
			continue
		}
		data, _ := states["data"].([]int64)
		secs[y] = &mapSection{names: names, data: data, bits: max(4, bits.Len(uint(len(names)-1)))}
		ys = append(ys, y)
	}
	// Top first.
	for i := 1; i < len(ys); i++ {
		for j := i; j > 0 && ys[j] > ys[j-1]; j-- {
			ys[j], ys[j-1] = ys[j-1], ys[j]
		}
	}
	return ys, secs
}

// isClear: blocks the map looks through (air, small plants, torches...).
func isClear(name string) bool {
	switch name {
	case "", "air", "cave_air", "void_air", "short_grass", "grass", "tall_grass", "fern", "large_fern", "dead_bush",
		"torch", "wall_torch", "soul_torch", "redstone_wire", "string", "tripwire", "light", "barrier", "structure_void",
		"vine", "glow_lichen", "sugar_cane", "seagrass", "tall_seagrass", "kelp_plant", "kelp":
		return true
	}
	return strings.HasSuffix(name, "_button") || strings.HasSuffix(name, "_sapling") || strings.HasSuffix(name, "_tulip") ||
		strings.HasSuffix(name, "_pressure_plate") || strings.HasSuffix(name, "glass_pane") ||
		name == "dandelion" || name == "poppy" || name == "cornflower" || name == "azure_bluet" || name == "oxeye_daisy" ||
		name == "allium" || name == "blue_orchid" || name == "lily_of_the_valley" || name == "pink_petals" || name == "rail" ||
		strings.HasSuffix(name, "_rail") || strings.HasSuffix(name, "_sign") || strings.HasSuffix(name, "_banner")
}

// ---- colours, close to Minecraft's own map colours ----

var exactColors = map[string]color.RGBA{
	"grass_block": {109, 153, 48, 255}, "water": {52, 90, 180, 255}, "bubble_column": {52, 90, 180, 255},
	"sand": {219, 207, 163, 255}, "sandstone": {216, 203, 155, 255}, "red_sand": {190, 102, 33, 255},
	"gravel": {136, 126, 126, 255}, "dirt": {134, 96, 67, 255}, "coarse_dirt": {119, 85, 59, 255}, "podzol": {91, 63, 24, 255},
	"mud": {60, 57, 60, 255}, "clay": {160, 166, 179, 255}, "snow": {249, 254, 254, 255}, "snow_block": {249, 254, 254, 255},
	"powder_snow": {249, 254, 254, 255}, "ice": {145, 183, 253, 255}, "packed_ice": {141, 180, 250, 255}, "blue_ice": {116, 167, 253, 255},
	"lava": {207, 92, 15, 255}, "stone": {125, 125, 125, 255}, "cobblestone": {122, 122, 122, 255}, "andesite": {136, 136, 137, 255},
	"diorite": {188, 188, 188, 255}, "granite": {149, 103, 85, 255}, "deepslate": {80, 80, 82, 255}, "tuff": {108, 109, 102, 255},
	"calcite": {223, 224, 220, 255}, "bedrock": {85, 85, 85, 255}, "obsidian": {20, 18, 30, 255}, "netherrack": {111, 54, 52, 255},
	"mycelium": {111, 99, 105, 255}, "moss_block": {89, 109, 45, 255}, "farmland": {143, 102, 70, 255}, "dirt_path": {148, 121, 65, 255},
	"pumpkin": {198, 118, 24, 255}, "melon": {111, 145, 30, 255}, "hay_block": {166, 136, 38, 255}, "cactus": {85, 127, 43, 255},
	"lily_pad": {32, 128, 48, 255}, "end_stone": {219, 222, 158, 255}, "terracotta": {152, 94, 67, 255}, "mangrove_roots": {74, 59, 38, 255},
}

var suffixColors = []struct {
	suffix string
	c      color.RGBA
}{
	{"leaves", color.RGBA{59, 102, 30, 255}}, {"_log", color.RGBA{102, 81, 51, 255}}, {"_wood", color.RGBA{102, 81, 51, 255}},
	{"planks", color.RGBA{162, 130, 78, 255}}, {"_stairs", color.RGBA{150, 120, 80, 255}}, {"_slab", color.RGBA{150, 130, 100, 255}},
	{"_fence", color.RGBA{150, 120, 80, 255}}, {"_door", color.RGBA{140, 110, 70, 255}}, {"_bricks", color.RGBA{150, 97, 83, 255}},
	{"wool", color.RGBA{220, 220, 220, 255}}, {"concrete", color.RGBA{200, 200, 200, 255}}, {"_terracotta", color.RGBA{160, 100, 75, 255}},
	{"glass", color.RGBA{190, 220, 230, 255}}, {"_ore", color.RGBA{125, 125, 125, 255}}, {"coral", color.RGBA{200, 90, 120, 255}},
	{"mushroom_block", color.RGBA{150, 90, 70, 255}}, {"_carpet", color.RGBA{200, 200, 200, 255}}, {"nylium", color.RGBA{60, 120, 110, 255}},
	{"stone", color.RGBA{125, 125, 125, 255}},
}

var woolColors = map[string]color.RGBA{
	"white": {233, 236, 236, 255}, "orange": {240, 118, 19, 255}, "magenta": {189, 68, 179, 255}, "light_blue": {58, 175, 217, 255},
	"yellow": {248, 197, 39, 255}, "lime": {112, 185, 25, 255}, "pink": {237, 141, 172, 255}, "gray": {62, 68, 71, 255},
	"light_gray": {142, 142, 134, 255}, "cyan": {21, 137, 145, 255}, "purple": {121, 42, 172, 255}, "blue": {53, 57, 157, 255},
	"brown": {114, 71, 40, 255}, "green": {84, 109, 27, 255}, "red": {161, 39, 34, 255}, "black": {20, 21, 25, 255},
}

func blockColor(name string) color.RGBA {
	if c, ok := exactColors[name]; ok {
		return c
	}
	// Dyed blocks (wool, concrete, terracotta, glass...) by their colour; "light_gray_" before "gray_".
	best := ""
	for dye := range woolColors {
		if strings.HasPrefix(name, dye+"_") && len(dye) > len(best) {
			best = dye
		}
	}
	if best != "" {
		return woolColors[best]
	}
	for _, s := range suffixColors {
		if strings.HasSuffix(name, s.suffix) {
			return s.c
		}
	}
	return color.RGBA{128, 128, 128, 255}
}

// ---- drawing ----

type mapColumn struct {
	name  string
	y     int
	water int // blocks of water above the ground, for depth shading
	ok    bool
}

// topOf finds the top block of column (x, z) of a chunk's sections.
func topOf(ys []int, secs map[int]*mapSection, x, z int) mapColumn {
	col := mapColumn{}
	for _, sy := range ys {
		s := secs[sy]
		for y := 15; y >= 0; y-- {
			n := s.at(x, y, z)
			if isClear(n) {
				continue
			}
			if n == "water" || n == "bubble_column" {
				if col.water == 0 {
					col.y = sy*16 + y
				}
				col.water++
				if col.water >= 12 {
					return mapColumn{name: "water", y: col.y, water: col.water, ok: true}
				}
				continue
			}
			if col.water > 0 {
				return mapColumn{name: "water", y: col.y, water: col.water, ok: true}
			}
			return mapColumn{name: n, y: sy*16 + y, ok: true}
		}
	}
	if col.water > 0 {
		return mapColumn{name: "water", y: col.y, water: col.water, ok: true}
	}
	return col
}

func shade(c color.RGBA, f float64) color.RGBA {
	m := func(v uint8) uint8 { return uint8(min(255, float64(v)*f)) }
	return color.RGBA{m(c.R), m(c.G), m(c.B), 255}
}

// drawWorldMap draws size×size blocks centred on (cx, cz); regions loads a region by its coordinates.
func drawWorldMap(cx, cz, size int, regions func(rx, rz int) mapRegion) *image.RGBA {
	x0, z0 := cx-size/2, cz-size/2
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	heights := make([]int, size*size)
	cols := make([]mapColumn, size*size)
	bg := color.RGBA{14, 18, 24, 255}
	type key struct{ x, z int }
	loaded := map[key]mapRegion{}
	for chz := floorDiv(z0, 16); chz <= floorDiv(z0+size-1, 16); chz++ {
		for chx := floorDiv(x0, 16); chx <= floorDiv(x0+size-1, 16); chx++ {
			rk := key{floorDiv(chx, 32), floorDiv(chz, 32)}
			reg, ok := loaded[rk]
			if !ok {
				reg = regions(rk.x, rk.z)
				loaded[rk] = reg
			}
			c := reg.chunk(chx-rk.x*32, chz-rk.z*32)
			if c == nil {
				continue
			}
			if status, _ := c["Status"].(string); status != "" && strings.TrimPrefix(status, "minecraft:") != "full" {
				continue // not finished generating: no surface yet
			}
			ys, secs := sectionsOf(c)
			for lz := 0; lz < 16; lz++ {
				for lx := 0; lx < 16; lx++ {
					px, pz := chx*16+lx-x0, chz*16+lz-z0
					if px < 0 || pz < 0 || px >= size || pz >= size {
						continue
					}
					cols[pz*size+px] = topOf(ys, secs, lx, lz)
					heights[pz*size+px] = cols[pz*size+px].y
				}
			}
		}
	}
	for pz := 0; pz < size; pz++ {
		for px := 0; px < size; px++ {
			col := cols[pz*size+px]
			if !col.ok {
				img.SetRGBA(px, pz, bg)
				continue
			}
			c := blockColor(col.name)
			switch {
			case col.name == "water":
				c = shade(c, 1.15-0.04*float64(min(col.water, 10)))
			case pz > 0 && cols[(pz-1)*size+px].ok:
				// Lit from the north-west like Minecraft's maps: up a step is lighter, down darker.
				d := heights[pz*size+px] - heights[(pz-1)*size+px]
				switch {
				case d > 0:
					c = shade(c, 1.12)
				case d < 0:
					c = shade(c, 0.82)
				}
			}
			img.SetRGBA(px, pz, c)
		}
	}
	return img
}

// spawnOf reads the world's spawn from level.dat (0, 0 if it can't).
func (s *serverFiles) spawnOf(world string) (int, int) {
	f, err := s.root.Open(world + "/level.dat")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	zr, err := gzip.NewReader(io.LimitReader(f, 8<<20))
	if err != nil {
		return 0, 0
	}
	raw, err := io.ReadAll(io.LimitReader(zr, 32<<20))
	if err != nil {
		return 0, 0
	}
	root, err := decodeNBT(raw)
	if err != nil {
		return 0, 0
	}
	data, _ := root["Data"].(map[string]any)
	if x, ok := nbtInt(data["SpawnX"]); ok {
		z, _ := nbtInt(data["SpawnZ"])
		return x, z
	}
	// 1.21.9 on: spawn: {pos: [I; x, y, z], dimension: ...}
	spawn, _ := data["spawn"].(map[string]any)
	if pos, ok := spawn["pos"].([]int); ok && len(pos) == 3 {
		return pos[0], pos[2]
	}
	return 0, 0
}

func (s *serverFiles) readRegion(world string, rx, rz int) mapRegion {
	name := fmt.Sprintf("%s/region/r.%d.%d.mca", world, rx, rz)
	f, err := s.root.Open(name)
	if err != nil {
		return nil
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, mapMaxRegion))
	if err != nil {
		return nil
	}
	return b
}

var errNoRegions = errors.New("this world has no region files (never played, or Bedrock)")

// GET /servers/{id}/worlds/map?name=world&size=384[&x=..&z=..]: the world from above as a PNG.
func (a *agent) worldMap(w http.ResponseWriter, r *http.Request) {
	_, s, ok := a.filesFrom(w, r)
	if !ok {
		return
	}
	defer s.Close()
	bedrock, name, err := worldRequest(r)
	if err != nil || bedrock {
		writeFileError(w, errBadPath)
		return
	}
	if !s.isWorld(name) {
		writeFileError(w, fs.ErrNotExist)
		return
	}
	if !s.isDir(name + "/region") {
		writeError(w, http.StatusNotFound, errNoRegions.Error())
		return
	}
	q := r.URL.Query()
	size := mapDefaultSize
	if v := q.Get("size"); v != "" {
		if size, err = strconv.Atoi(v); err != nil || size < 64 || size > mapMaxSize {
			writeFileError(w, errBadPath)
			return
		}
	}
	cx, cz := s.spawnOf(name)
	if v := q.Get("x"); v != "" {
		if cx, err = strconv.Atoi(v); err != nil || abs(cx) > trimMaxRadius {
			writeFileError(w, errBadPath)
			return
		}
	}
	if v := q.Get("z"); v != "" {
		if cz, err = strconv.Atoi(v); err != nil || abs(cz) > trimMaxRadius {
			writeFileError(w, errBadPath)
			return
		}
	}
	img := drawWorldMap(cx, cz, size, func(rx, rz int) mapRegion { return s.readRegion(name, rx, rz) })
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=600")
	if err := png.Encode(w, img); err != nil {
		return
	}
}
