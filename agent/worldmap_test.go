package main

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"image/color"
	"testing"
)

// A tiny NBT writer for building test chunks.
type nbtW struct{ bytes.Buffer }

func (w *nbtW) name(t byte, n string) {
	w.WriteByte(t)
	binary.Write(w, binary.BigEndian, uint16(len(n)))
	w.WriteString(n)
}
func (w *nbtW) str(n, v string) {
	w.name(8, n)
	binary.Write(w, binary.BigEndian, uint16(len(v)))
	w.WriteString(v)
}
func (w *nbtW) byteTag(n string, v int8) { w.name(1, n); w.WriteByte(byte(v)) }
func (w *nbtW) longs(n string, v []int64) {
	w.name(12, n)
	binary.Write(w, binary.BigEndian, int32(len(v)))
	for _, x := range v {
		binary.Write(w, binary.BigEndian, x)
	}
}
func (w *nbtW) end() { w.WriteByte(0) }

// testChunk: stone up to y=63 (section 3 top), grass at y=64 except water at x=0 column, with palette packing.
func testChunk(t *testing.T, grassY int) []byte {
	var w nbtW
	w.name(10, "")
	w.str("Status", "minecraft:full")
	w.name(9, "sections")
	w.WriteByte(10)
	binary.Write(&w, binary.BigEndian, int32(2))
	// Section Y=3 (y 48..63): all stone.
	w.byteTag("Y", 3)
	w.name(10, "block_states")
	w.name(9, "palette")
	w.WriteByte(10)
	binary.Write(&w, binary.BigEndian, int32(1))
	w.str("Name", "minecraft:stone")
	w.end()
	w.end() // block_states
	w.end() // section
	// Section Y=4 (y 64..79): air, grass at grassY-64, water in column x=0.
	w.byteTag("Y", 4)
	w.name(10, "block_states")
	w.name(9, "palette")
	w.WriteByte(10)
	binary.Write(&w, binary.BigEndian, int32(3))
	for _, n := range []string{"minecraft:air", "minecraft:grass_block", "minecraft:water"} {
		w.str("Name", n)
		w.end()
	}
	data := make([]int64, 4096*4/64)
	for z := 0; z < 16; z++ {
		for x := 0; x < 16; x++ {
			v := int64(1)
			if x == 0 {
				v = 2
			}
			i := ((grassY-64)*16+z)*16 + x
			data[i/16] |= v << uint((i%16)*4)
		}
	}
	w.longs("data", data)
	w.end()
	w.end()
	w.end() // root
	return w.Bytes()
}

func testRegion(t *testing.T, chunks map[[2]int][]byte) mapRegion {
	reg := make([]byte, 8192)
	for pos, raw := range chunks {
		var z bytes.Buffer
		zw := zlib.NewWriter(&z)
		zw.Write(raw)
		zw.Close()
		sector := len(reg) / 4096
		body := make([]byte, 5+z.Len())
		binary.BigEndian.PutUint32(body, uint32(z.Len()+1))
		body[4] = 2
		copy(body[5:], z.Bytes())
		for len(body)%4096 != 0 {
			body = append(body, 0)
		}
		i := 4 * (pos[0] + pos[1]*32)
		binary.BigEndian.PutUint32(reg[i:], uint32(sector<<8|len(body)/4096))
		reg = append(reg, body...)
	}
	return reg
}

func TestWorldMap(t *testing.T) {
	reg := testRegion(t, map[[2]int][]byte{{0, 0}: testChunk(t, 64), {0, 1}: testChunk(t, 66)})
	img := drawWorldMap(16, 16, 32, func(rx, rz int) mapRegion {
		if rx == 0 && rz == 0 {
			return reg
		}
		return nil
	})
	at := func(x, z int) color.RGBA { return img.RGBAAt(x, z) }
	grass := blockColor("grass_block")
	if got := at(5, 3); got != grass { // chunk 0,0 at pixel (16-16+5, 3)
		t.Fatalf("grass pixel %v, want %v", got, grass)
	}
	if got := at(0, 3); got.B <= got.G { // water column x=0
		t.Fatalf("water pixel %v", got)
	}
	if got := at(5, 16); got.G <= grass.G { // chunk 0,1 is two blocks higher than its northern neighbour: lighter
		t.Fatalf("step up not lighter: %v", got)
	}
	if got := at(20, 3); got != (color.RGBA{14, 18, 24, 255}) { // chunk 1,0 not generated
		t.Fatalf("empty chunk %v", got)
	}
}

func TestBlockColor(t *testing.T) {
	if blockColor("light_gray_wool") != woolColors["light_gray"] || blockColor("red_sand") != exactColors["red_sand"] || blockColor("oak_leaves") != (color.RGBA{59, 102, 30, 255}) {
		t.Fatal("colours")
	}
}
