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
  planks: ["#b8894f", "#a87a44", "#c29458"],
  cobble: ["#8a8f95", "#6b7076", "#9aa0a6", "#5c6066"],
  nether: ["#7a2a2a", "#8c3232", "#6a2222", "#9a3b36"],
  brass: ["#d9a441", "#c8922f", "#e6b65a", "#b07e26"],
  sand: ["#dbcf8e", "#e3d89b", "#d2c47f", "#e8dfa8"],
  cactus: ["#3f8f3a", "#357e31", "#4a9c43"],
  snow: ["#f4f8fb", "#e8eff5", "#fbfdff", "#dde7ef"],
  tnt: ["#d33b2c", "#c4321f", "#de4a36"],
  gold: ["#f2c14e", "#e6b03a", "#f7d16b", "#d9a441"],
  lime: ["#7cc63f", "#6fb835", "#86d048"],
  purple: ["#8e44c9", "#7f3bb8", "#9a52d4"],
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
    case "planks":
      // Boards run across, with a darker seam every other row.
      return j % 2 === 1 && i % 2 === 0 ? "#8d6537" : pick(P.planks);
    case "cobble":
      return pick(P.cobble);
    case "nether":
      return pick(P.nether);
    case "sand":
      return pick(P.sand);
    case "cactus":
      // Pale spines in a grid on the sides.
      if (face !== "top" && i % 2 === 1 && j % 2 === 0) return "#c9d98a";
      return pick(P.cactus);
    case "snow":
      return pick(P.snow);
    case "tnt":
      // A white band with a dark label across the sides, a fuse on top.
      if (face === "top") return i > 0 && i < N - 1 && j > 0 && j < N - 1 ? "#2b2b2b" : "#9a9a9a";
      if (j === 1 || j === 2) return i === 1 || i === 2 ? "#2b2b2b" : "#eeeeee";
      return pick(P.tnt);
    case "gold":
      return pick(P.gold);
    case "lime":
      return pick(P.lime);
    case "purple":
      return pick(P.purple);
    case "brass":
      if (face !== "top" && (i === 0 || i === N - 1 || j === 0 || j === N - 1)) return "#8a6420";
      return pick(P.brass);
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

// Little scenes for the ready-game cards on the home page.
function plot(n, top = "grass", under = "dirt") {
  const b = [];
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) b.push({ x, y, z: 1, type: top }, { x, y, z: 0, type: under });
  return b;
}
function tree(x, y, z, b) {
  for (let k = 0; k < 3; k++) b.push({ x, y, z: z + k, type: "log" });
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      if (dx || dy) b.push({ x: x + dx, y: y + dy, z: z + 2, type: "leaves" });
      if (!dx || !dy) b.push({ x: x + dx, y: y + dy, z: z + 3, type: "leaves" });
    }
}
const GAME_SCENES = {
  survival() {
    const b = plot(3);
    b.push({ x: 0, y: 0, z: 2, type: "stone" }, { x: 0, y: 0, z: 3, type: "stone" }, { x: 1, y: 0, z: 2, type: "ore" }, { x: 0, y: 1, z: 2, type: "stone" });
    b.push({ x: 2, y: 0, z: 2, type: "log" }, { x: 2, y: 0, z: 3, type: "leaves" }, { x: 0, y: 2, z: 2, type: "leaves" });
    return b;
  },
  "survival-plus"() {
    const b = plot(3);
    for (let x = 0; x < 2; x++)
      for (let y = 0; y < 2; y++) {
        b.push({ x, y, z: 2, type: "cobble" }, { x, y, z: 3, type: "planks" });
      }
    b.push({ x: 0, y: 0, z: 4, type: "planks" }, { x: 2, y: 2, z: 2, type: "log" });
    return b;
  },
  lifesteal() {
    const b = plot(3, "nether", "nether");
    b.push({ x: 1, y: 1, z: 2, type: "nether" }, { x: 1, y: 1, z: 3, type: "nether" }, { x: 0, y: 2, z: 2, type: "stone" });
    return b;
  },
  // Classic map: the L-shaped starting island with its tree, and the sand island with a cactus further off.
  skymap() {
    const b = plot(3).filter((k) => !(k.x === 2 && k.y >= 1));
    tree(0, 0, 2, b);
    b.push({ x: 4, y: -2, z: 0, type: "sand" }, { x: 5, y: -2, z: 0, type: "sand" }, { x: 4, y: -1, z: 0, type: "sand" }, { x: 5, y: -1, z: 0, type: "sand" });
    b.push({ x: 4, y: -2, z: 1, type: "cactus" }, { x: 4, y: -2, z: 2, type: "cactus" });
    return b;
  },
  // Minigames: a Spleef floor of snow with TNT on it, and parkour blocks climbing to a gold finish.
  minigames() {
    const b = plot(3, "snow", "snow").filter((k) => k.z === 1);
    b.push({ x: 2, y: 2, z: 2, type: "tnt" }, { x: 0, y: 2, z: 2, type: "tnt" }, { x: 2, y: 0, z: 2, type: "cobble" });
    b.push({ x: -2, y: 1, z: 2, type: "lime" }, { x: -2, y: -1, z: 3, type: "purple" }, { x: 0, y: -2, z: 4, type: "gold" });
    return b;
  },
  skyblock() {
    const b = plot(3).filter((k) => !(k.x === 2 && k.y === 2));
    b.push({ x: 1, y: 1, z: -1, type: "stone" }, { x: 0, y: 1, z: -1, type: "dirt" }, { x: 1, y: 0, z: -1, type: "dirt" }, { x: 1, y: 1, z: -2, type: "stone" });
    tree(0, 0, 2, b);
    return b;
  },
  modpack() {
    const b = plot(3, "stone", "deep");
    b.push({ x: 0, y: 0, z: 2, type: "brass" }, { x: 1, y: 0, z: 2, type: "brass" }, { x: 0, y: 1, z: 2, type: "brass" }, { x: 0, y: 0, z: 3, type: "brass" }, { x: 2, y: 2, z: 2, type: "server" });
    return b;
  },
  mods() {
    const b = plot(3);
    b.push({ x: 1, y: 1, z: 2, type: "planks" }, { x: 0, y: 2, z: 2, type: "cobble" }, { x: 2, y: 0, z: 2, type: "log" });
    return b;
  },
};

// Pixel badges that float over some scenes.
const HEART = [
  ".OO...OO.",
  "ORRO.ORRO",
  "ORWRORRRO",
  "ORRRRRRRO",
  ".ORRRRRO.",
  "..ORRRO..",
  "...ORO...",
  "....O....",
];
const GEAR = [
  "....OO....",
  ".OO.YY.OO.",
  ".OYYYYYYO.",
  "..YYOOYY..",
  "OYYO..OYYO",
  "OYYO..OYYO",
  "..YYOOYY..",
  ".OYYYYYYO.",
  ".OO.YY.OO.",
  "....OO....",
];
const WRENCH = [
  "......O.O.",
  ".....OWOWO",
  ".....OWWWO",
  "....OWWWO.",
  "...OWWO...",
  "..OWWO....",
  ".OWWO.....",
  "OWWO......",
  "OWO.......",
  ".O........",
];
const BADGE_COLORS = { O: "#1b2430", R: "#e5484d", W: "#e6f1f5", Y: "#d9a441" };

const dir = new URL("../public/art/", import.meta.url);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(new URL("island.svg", dir), svg(render(island(), 11), 4));
fs.writeFileSync(new URL("block-grass.svg", dir), svg(render([{ x: 0, y: 0, z: 0, type: "grass" }], 3), 1));
fs.writeFileSync(new URL("block-stone.svg", dir), svg(render([{ x: 0, y: 0, z: 0, type: "deep" }], 5), 1));
fs.writeFileSync(new URL("block-server.svg", dir), svg(render([{ x: 0, y: 0, z: 0, type: "server" }], 5), 1));
fs.writeFileSync(new URL("sword.svg", dir), pixelArt(SWORD, SWORD_COLORS));
fs.mkdirSync(new URL("games/", dir), { recursive: true });
for (const [id, scene] of Object.entries(GAME_SCENES)) fs.writeFileSync(new URL(`games/${id}.svg`, dir), svg(render(scene(), 21), 2));
// OneBlock's one block changes: the card fades between these.
for (const type of ["grass", "stone", "log", "ore"]) fs.writeFileSync(new URL(`games/oneblock-${type}.svg`, dir), svg(render([{ x: 0, y: 0, z: 0, type }], 9), 1));
fs.writeFileSync(new URL("heart.svg", dir), pixelArt(HEART, BADGE_COLORS));
fs.writeFileSync(new URL("gear.svg", dir), pixelArt(GEAR, BADGE_COLORS));
fs.writeFileSync(new URL("wrench.svg", dir), pixelArt(WRENCH, BADGE_COLORS));
fs.copyFileSync(new URL("block-grass.svg", dir), new URL("../src/app/icon.svg", import.meta.url));
console.log("wrote", fs.readdirSync(dir).join(", "));
