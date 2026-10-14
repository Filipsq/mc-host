// Draws the site's block artwork as isometric SVGs: the hero island and the small block icons.
// Run with `node scripts/gen-art.mjs` after changing anything here; the output is committed.
import fs from "node:fs";

const S = 32; // block edge in px
const W = (S * Math.sqrt(3)) / 2;
const H = S / 2;
const N = 4; // texture pixels per face edge

// Seeded random so the textures don't change on every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const P = {
  grassTop: ["#5fae3a", "#6bbd43", "#58a334", "#74c74b", "#4f9a2f"],
  grassSide: ["#559e33", "#5fae3a", "#4f9a2f"],
  dirt: ["#8a5a35", "#7b4f2e", "#946342", "#6f4528", "#86573a"],
  stone: ["#7d8288", "#71767c", "#8a8f95", "#676c72"],
  deep: ["#3c4048", "#353940", "#454a52", "#2f3238"],
  log: ["#6b4a2b", "#5e4025", "#775434"],
  logTop: ["#a07a4c", "#8d6a40", "#b08a58"],
  leaves: ["#2f7d32", "#3a8f3b", "#276b2a", "#43a047", "#2a7330"],
  server: ["#1f252d", "#232a33", "#1b2027"],
  diamond: ["#4dd0e1", "#80deea"],
  led: ["#5bc236", "#4dd0e1", "#f2c14e"],
};

const shade = { top: 1, left: 0.86, right: 0.7 };

function tint(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

const proj = ([x, y, z]) => [(x - y) * W, (x + y) * H - z * S];
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Corners in order: top-left, top-right, bottom-right, bottom-left of the face as you look at it.
function faceCorners(x, y, z, face) {
  if (face === "top") return [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]];
  if (face === "right") return [[x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z], [x + 1, y, z]];
  return [[x, y + 1, z + 1], [x + 1, y + 1, z + 1], [x + 1, y + 1, z], [x, y + 1, z]];
}

// Colour for texture pixel (i across, j down) of a face.
function pixel(type, face, i, j, r) {
  const pick = (list) => list[Math.floor(r() * list.length)];
  switch (type) {
    case "grass":
      if (face === "top") return pick(P.grassTop);
      if (j === 0 || (j === 1 && r() < 0.35)) return pick(P.grassSide);
      return pick(P.dirt);
    case "dirt":
      return pick(P.dirt);
    case "stone":
      return pick(P.stone);
    case "ore":
      return (i + j) % 3 === 1 && r() < 0.8 ? pick(P.diamond) : pick(P.stone);
    case "deep":
      return pick(P.deep);
    case "log":
      if (face === "top") return i > 0 && i < N - 1 && j > 0 && j < N - 1 ? pick(P.logTop) : pick(P.log);
      return pick(P.log);
    case "leaves":
      return r() < 0.12 ? "#1f5a22" : pick(P.leaves);
    case "server":
      // Side faces look like rack units: a column of status lights and dark vent slots.
      if (face === "top") return j % 2 ? "#14181d" : pick(P.server);
      if (j % 2 === 1) return "#14181d";
      if (i === N - 1) return P.led[(j / 2 + (face === "left" ? 1 : 0)) % P.led.length];
      return pick(P.server);
  }
}

function polygon(pts, fill) {
  return `<polygon points="${pts.map((p) => proj(p).map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="${fill}"/>`;
}

function render(blocks, seed = 7) {
  const r = rng(seed);
  const key = (x, y, z) => `${x},${y},${z}`;
  const solid = new Set(blocks.map((b) => key(b.x, b.y, b.z)));
  const sorted = [...blocks].sort((a, b) => a.x + a.y + a.z - (b.x + b.y + b.z) || a.z - b.z);
  const out = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of sorted) {
    const faces = [];
    if (!solid.has(key(b.x, b.y, b.z + 1))) faces.push("top");
    if (!solid.has(key(b.x, b.y + 1, b.z))) faces.push("left");
    if (!solid.has(key(b.x + 1, b.y, b.z))) faces.push("right");
    for (const face of faces) {
      const [a, bb, c, d] = faceCorners(b.x, b.y, b.z, face);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const p = (u, v) => lerp(lerp(a, bb, u), lerp(d, c, u), v);
          // Overlap each pixel slightly so no hairline gaps show between them.
          const e = 0.02;
          const quad = [p(i / N - e, j / N - e), p((i + 1) / N + e, j / N - e), p((i + 1) / N + e, (j + 1) / N + e), p(i / N - e, (j + 1) / N + e)];
          out.push(polygon(quad, tint(pixel(b.type, face, i, j, r), shade[face])));
          for (const q of quad) {
            const [sx, sy] = proj(q);
            minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
          }
        }
      }
    }
  }
  return { body: out.join(""), box: [minX, minY, maxX - minX, maxY - minY] };
}

function svg({ body, box }, pad = 2, extra = "") {
  const [x, y, w, h] = [box[0] - pad, box[1] - pad, box[2] + pad * 2, box[3] + pad * 2].map((v) => +v.toFixed(1));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" shape-rendering="crispEdges">${extra}${body}</svg>\n`;
}

// The hero island: a grass platform with a tree, a server tower and a diamond in the rock.
function island() {
  const b = [];
  const n = 6;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      b.push({ x, y, z: 2, type: "grass" });
      b.push({ x, y, z: 1, type: "dirt" });
      // Anything below this layer would be hidden by the platform when seen from above.
      b.push({ x, y, z: 0, type: x === 4 && y === 5 ? "ore" : "stone" });
    }
  }
  // Tree
  for (let z = 3; z <= 5; z++) b.push({ x: 1, y: 1, z, type: "log" });
  for (let x = 0; x <= 2; x++)
    for (let y = 0; y <= 2; y++)
      for (let z = 5; z <= 6; z++) {
        if (x === 1 && y === 1 && z === 5) continue;
        if (z === 6 && (x !== 1 || y !== 1) && (x + y) % 2 === 0) continue;
        b.push({ x, y, z, type: "leaves" });
      }
  b.push({ x: 1, y: 1, z: 7, type: "leaves" });
  // Server tower
  for (let z = 3; z <= 4; z++) {
    b.push({ x: 4, y: 3, z, type: "server" });
    b.push({ x: 4, y: 2, z, type: "server" });
  }
  b.push({ x: 3, y: 4, z: 3, type: "grass" });
  return b;
}

// Terraria is flat, so its icon is flat pixel art: a sword, one character per pixel.
const SWORD = [
  ".............OOO",
  "............OWWO",
  "...........OWWBO",
  "..........OWWBO.",
  ".........OWWBO..",
  "........OWWBO...",
  ".......OWWBO....",
  "......OWWBO.....",
  "..OO.OWWBO......",
  "..OGOWWBO.......",
  "...OGWBO........",
  "....OGGO........",
  "...OHOGGO.......",
  "..OHO..OGO......",
  ".OGO....OO......",
  "..O.............",
];
const SWORD_COLORS = { O: "#1b2430", W: "#e6f1f5", B: "#8fb3c2", G: "#f2c14e", H: "#8a5a35" };

function pixelArt(rows, colors) {
  let rects = "";
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (colors[ch]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${colors[ch]}"/>`;
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges">${rects}</svg>`;
}

const dir = new URL("../public/art/", import.meta.url);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(new URL("island.svg", dir), svg(render(island(), 11), 4));
fs.writeFileSync(new URL("block-grass.svg", dir), svg(render([{ x: 0, y: 0, z: 0, type: "grass" }], 3), 1));
fs.writeFileSync(new URL("block-stone.svg", dir), svg(render([{ x: 0, y: 0, z: 0, type: "deep" }], 5), 1));
fs.writeFileSync(new URL("block-server.svg", dir), svg(render([{ x: 0, y: 0, z: 0, type: "server" }], 5), 1));
fs.writeFileSync(new URL("sword.svg", dir), pixelArt(SWORD, SWORD_COLORS));
fs.copyFileSync(new URL("block-grass.svg", dir), new URL("../src/app/icon.svg", import.meta.url));
console.log("wrote", fs.readdirSync(dir).join(", "));
