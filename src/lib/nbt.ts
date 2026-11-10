// Minecraft's binary NBT format (level.dat, playerdata, .nbt structures) and a
// text form of it (SNBT, like in /data commands) so the file manager can show
// and edit such files in the browser. Every type is kept exactly: 1b is a byte,
// 1s a short, 1 an int, 1L a long, 1.0f a float, 1.0d a double, [B; ...] etc.
// are arrays. Compression (gzip/zlib) is handled by the caller.

export type Tag =
  | { t: 1 | 2 | 3 | 5 | 6; v: number }
  | { t: 4; v: bigint }
  | { t: 7; v: Int8Array }
  | { t: 8; v: string }
  | { t: 9; el: number; v: Tag[] }
  | { t: 10; v: [string, Tag][] }
  | { t: 11; v: Int32Array }
  | { t: 12; v: BigInt64Array };

export type Root = { name: string; tag: Tag };

export class NbtError extends Error {
  line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.line = line;
  }
}

const MAX_DEPTH = 512;

// ---------- binary ----------

/** Java's "modified UTF-8": NUL as two bytes, characters above U+FFFF as two 3-byte surrogates. */
function decodeMutf8(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; ) {
    const c = b[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if ((c & 0xe0) === 0xc0) out += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else out += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
  }
  return out;
}

function encodeMutf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 1 && c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  if (out.length > 0xffff) throw new NbtError("Tekst jest za długi (ponad 65535 bajtów).");
  return Uint8Array.from(out);
}

/** Reads an uncompressed NBT file; le = Bedrock (little-endian, plain UTF-8). */
export function readNbt(buf: Uint8Array, le = false): Root {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 0;
  const need = (n: number) => {
    if (n < 0 || p + n > buf.length) throw new NbtError("Plik jest uszkodzony albo to nie jest NBT.");
  };
  const str = () => {
    need(2);
    const n = view.getUint16(p, le);
    p += 2;
    need(n);
    const s = le ? new TextDecoder().decode(buf.subarray(p, p + n)) : decodeMutf8(buf.subarray(p, p + n));
    p += n;
    return s;
  };
  const len = () => {
    need(4);
    const n = view.getInt32(p, le);
    p += 4;
    if (n < 0) throw new NbtError("Plik jest uszkodzony albo to nie jest NBT.");
    return n;
  };
  const payload = (t: number, depth: number): Tag => {
    if (depth > MAX_DEPTH) throw new NbtError("Za głęboko zagnieżdżony plik.");
    switch (t) {
      case 1: need(1); return { t, v: view.getInt8(p++) };
      case 2: need(2); p += 2; return { t, v: view.getInt16(p - 2, le) };
      case 3: need(4); p += 4; return { t, v: view.getInt32(p - 4, le) };
      case 4: need(8); p += 8; return { t, v: view.getBigInt64(p - 8, le) };
      case 5: need(4); p += 4; return { t, v: view.getFloat32(p - 4, le) };
      case 6: need(8); p += 8; return { t, v: view.getFloat64(p - 8, le) };
      case 7: {
        const n = len();
        need(n);
        const v = new Int8Array(buf.subarray(p, p + n)); // a copy (Node Buffers share one pool)
        p += n;
        return { t, v };
      }
      case 8: return { t, v: str() };
      case 9: {
        need(1);
        const el = view.getUint8(p++);
        const n = len();
        if (el === 0 && n > 0) throw new NbtError("Plik jest uszkodzony albo to nie jest NBT.");
        const v: Tag[] = [];
        for (let i = 0; i < n; i++) v.push(payload(el, depth + 1));
        return { t, el, v };
      }
      case 10: {
        const v: [string, Tag][] = [];
        for (;;) {
          need(1);
          const ct = view.getUint8(p++);
          if (ct === 0) return { t, v };
          const name = str();
          v.push([name, payload(ct, depth + 1)]);
        }
      }
      case 11: {
        const n = len();
        need(n * 4);
        const v = new Int32Array(n);
        for (let i = 0; i < n; i++, p += 4) v[i] = view.getInt32(p, le);
        return { t, v };
      }
      case 12: {
        const n = len();
        need(n * 8);
        const v = new BigInt64Array(n);
        for (let i = 0; i < n; i++, p += 8) v[i] = view.getBigInt64(p, le);
        return { t, v };
      }
      default:
        throw new NbtError("Plik jest uszkodzony albo to nie jest NBT.");
    }
  };
  need(1);
  const t = view.getUint8(p++);
  if (t === 0) throw new NbtError("Plik jest uszkodzony albo to nie jest NBT.");
  const name = str();
  const tag = payload(t, 0);
  if (p !== buf.length) throw new NbtError("Plik jest uszkodzony albo to nie jest NBT.");
  return { name, tag };
}

/** Writes an uncompressed NBT file; le = Bedrock. */
export function writeNbt(root: Root, le = false): Uint8Array<ArrayBuffer> {
  let buf = new Uint8Array(4096);
  let view = new DataView(buf.buffer);
  let p = 0;
  const room = (n: number) => {
    if (p + n <= buf.length) return;
    let size = buf.length * 2;
    while (size < p + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(buf);
    buf = next;
    view = new DataView(buf.buffer);
  };
  const u8 = (n: number) => (room(1), view.setUint8(p, n), p++);
  const i32 = (n: number) => (room(4), view.setInt32(p, n, le), (p += 4));
  const str = (s: string) => {
    const b = le ? new TextEncoder().encode(s) : encodeMutf8(s);
    if (b.length > 0xffff) throw new NbtError("Tekst jest za długi (ponad 65535 bajtów).");
    room(2 + b.length);
    view.setUint16(p, b.length, le);
    buf.set(b, p + 2);
    p += 2 + b.length;
  };
  const payload = (tag: Tag) => {
    switch (tag.t) {
      case 1: room(1); view.setInt8(p, tag.v); p += 1; break;
      case 2: room(2); view.setInt16(p, tag.v, le); p += 2; break;
      case 3: i32(tag.v); break;
      case 4: room(8); view.setBigInt64(p, tag.v, le); p += 8; break;
      case 5: room(4); view.setFloat32(p, tag.v, le); p += 4; break;
      case 6: room(8); view.setFloat64(p, tag.v, le); p += 8; break;
      case 7: i32(tag.v.length); room(tag.v.length); buf.set(new Uint8Array(tag.v.buffer, tag.v.byteOffset, tag.v.length), p); p += tag.v.length; break;
      case 8: str(tag.v); break;
      case 9: u8(tag.v.length ? tag.el : 0); i32(tag.v.length); tag.v.forEach(payload); break;
      case 10:
        for (const [name, child] of tag.v) {
          u8(child.t);
          str(name);
          payload(child);
        }
        u8(0);
        break;
      case 11: i32(tag.v.length); for (const n of tag.v) i32(n); break;
      case 12: i32(tag.v.length); room(tag.v.length * 8); for (const n of tag.v) { view.setBigInt64(p, n, le); p += 8; } break;
    }
  };
  u8(root.tag.t);
  str(root.name);
  payload(root.tag);
  return buf.slice(0, p);
}

// ---------- text (SNBT) ----------

/** The shortest text that reads back as the same 32-bit float. */
function floatText(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  for (let digits = 1; digits <= 9; digits++) {
    const s = String(Number(v.toPrecision(digits)));
    if (Math.fround(Number(s)) === v) return s;
  }
  return String(v);
}

const withPoint = (s: string) => (/[.eEIN]/.test(s) ? s : `${s}.0`);
const BARE_KEY = /^[A-Za-z0-9_\-.+]+$/;
const quote = (s: string) =>
  `"${s.replace(/[\\"\n\r\t]|[\u0000-\u001f]/g, (c) =>
    c === "\\" ? "\\\\" : c === '"' ? '\\"' : c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\t" ? "\\t" : `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )}"`;

/** The file as readable, indented SNBT text. */
export function toSnbt(tag: Tag, indent = ""): string {
  const inner = indent + "  ";
  switch (tag.t) {
    case 1: return `${tag.v}b`;
    case 2: return `${tag.v}s`;
    case 3: return String(tag.v);
    case 4: return `${tag.v}L`;
    case 5: return `${withPoint(floatText(tag.v))}f`;
    case 6: return `${withPoint(String(tag.v))}d`;
    case 7: return `[B; ${Array.from(tag.v, (n) => `${n}b`).join(", ")}]`;
    case 8: return quote(tag.v);
    case 9: {
      if (!tag.v.length) return "[]";
      if (tag.el !== 9 && tag.el !== 10 && tag.el !== 7 && tag.el !== 11 && tag.el !== 12) {
        const line = `[${tag.v.map((x) => toSnbt(x)).join(", ")}]`;
        if (line.length <= 100) return line;
      }
      return `[\n${tag.v.map((x) => inner + toSnbt(x, inner)).join(",\n")}\n${indent}]`;
    }
    case 10:
      if (!tag.v.length) return "{}";
      return `{\n${tag.v.map(([k, x]) => `${inner}${BARE_KEY.test(k) ? k : quote(k)}: ${toSnbt(x, inner)}`).join(",\n")}\n${indent}}`;
    case 11: return `[I; ${Array.from(tag.v).join(", ")}]`;
    case 12: return `[L; ${Array.from(tag.v, (n) => `${n}L`).join(", ")}]`;
  }
}

/** Reads SNBT text back; errors name the line. */
export function fromSnbt(text: string): Tag {
  let p = 0;
  const line = () => text.slice(0, p).split("\n").length;
  const fail = (msg: string): never => {
    throw new NbtError(msg, line());
  };
  const ws = () => {
    while (p < text.length && /\s/.test(text[p])) p++;
  };
  const eat = (c: string) => {
    ws();
    if (text[p] !== c) fail(`Brakuje znaku „${c}”.`);
    p++;
  };
  const quoted = (): string => {
    const q = text[p++];
    let out = "";
    while (p < text.length && text[p] !== q) {
      if (text[p] === "\\") {
        const e = text[++p];
        if (e === "n") out += "\n";
        else if (e === "r") out += "\r";
        else if (e === "t") out += "\t";
        else if (e === "u") {
          const hex = text.slice(p + 1, p + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("Zły kod \\u w tekście.");
          out += String.fromCharCode(parseInt(hex, 16));
          p += 4;
        } else if (e === undefined) break;
        else out += e;
        p++;
      } else out += text[p++];
    }
    if (p >= text.length) fail("Tekst w cudzysłowie nie jest zamknięty.");
    p++;
    return out;
  };
  const bare = () => {
    const start = p;
    while (p < text.length && BARE_KEY.test(text[p])) p++;
    return text.slice(start, p);
  };

  const INT = /^[-+]?\d+$/;
  const DEC = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
  const SPECIAL = /^[-+]?(NaN|Infinity)$/;
  const range = (s: string, lo: number, hi: number, t: 1 | 2 | 3): Tag => {
    const v = Number(s);
    if (v < lo || v > hi) fail(`Liczba ${s} jest poza zakresem tego typu.`);
    return { t, v };
  };
  const scalar = (s: string): Tag => {
    const body = s.slice(0, -1);
    const suf = s.slice(-1).toLowerCase();
    if (suf === "b" && INT.test(body)) return range(body, -128, 127, 1);
    if (suf === "s" && INT.test(body)) return range(body, -32768, 32767, 2);
    if (suf === "l" && INT.test(body)) {
      const v = BigInt(body);
      if (v !== BigInt.asIntN(64, v)) fail(`Liczba ${s} jest poza zakresem typu L.`);
      return { t: 4, v };
    }
    if (suf === "f" && (DEC.test(body) || SPECIAL.test(body))) return { t: 5, v: Math.fround(Number(body)) };
    if (suf === "d" && (DEC.test(body) || SPECIAL.test(body))) return { t: 6, v: Number(body) };
    if (INT.test(s)) return range(s, -2147483648, 2147483647, 3);
    if (DEC.test(s)) return { t: 6, v: Number(s) };
    if (s === "true") return { t: 1, v: 1 };
    if (s === "false") return { t: 1, v: 0 };
    return { t: 8, v: s };
  };

  const value = (depth: number): Tag => {
    if (depth > MAX_DEPTH) fail("Za głęboko zagnieżdżone.");
    ws();
    const c = text[p];
    if (c === "{") {
      p++;
      const v: [string, Tag][] = [];
      const seen = new Set<string>();
      ws();
      if (text[p] === "}") return p++, { t: 10, v };
      for (;;) {
        ws();
        const isQuoted = text[p] === '"' || text[p] === "'";
        const key = isQuoted ? quoted() : bare();
        if (!key && !isQuoted) fail("Brakuje nazwy pola.");
        if (seen.has(key)) fail(`Pole „${key}” jest dwa razy.`);
        seen.add(key);
        eat(":");
        v.push([key, value(depth + 1)]);
        ws();
        if (text[p] === ",") { p++; ws(); if (text[p] === "}") { p++; return { t: 10, v }; } continue; }
        if (text[p] === "}") return p++, { t: 10, v };
        fail("Brakuje przecinka albo „}”.");
      }
    }
    if (c === "[") {
      p++;
      ws();
      const typed = /^([BIL])\s*;/.exec(text.slice(p, p + 8));
      if (typed) {
        p += typed[0].length;
        const items: Tag[] = [];
        ws();
        while (text[p] !== "]") {
          items.push(value(depth + 1));
          ws();
          if (text[p] === ",") { p++; ws(); } else if (text[p] !== "]") fail("Brakuje przecinka albo „]”.");
        }
        p++;
        const want = typed[1] === "B" ? 1 : typed[1] === "I" ? 3 : 4;
        // Plain numbers are fine inside a typed array: [B; 1, 2] means bytes.
        const nums = items.map((x) => {
          if (x.t === want) return x.v;
          if (x.t === 3 && want === 1 && x.v >= -128 && x.v <= 127) return x.v;
          if (x.t === 3 && want === 4) return BigInt(x.v);
          return fail(`W tablicy [${typed[1]}; ...] są tylko liczby tego typu.`);
        });
        if (want === 1) return { t: 7, v: Int8Array.from(nums as number[]) };
        if (want === 3) return { t: 11, v: Int32Array.from(nums as number[]) };
        return { t: 12, v: BigInt64Array.from(nums as bigint[]) };
      }
      const v: Tag[] = [];
      while (text[p] !== "]") {
        const item = value(depth + 1);
        if (v.length && item.t !== v[0].t) fail("Na liście wszystkie elementy muszą być tego samego typu.");
        v.push(item);
        ws();
        if (text[p] === ",") { p++; ws(); } else if (text[p] !== "]") fail("Brakuje przecinka albo „]”.");
      }
      p++;
      return { t: 9, el: v.length ? v[0].t : 0, v };
    }
    if (c === '"' || c === "'") return { t: 8, v: quoted() };
    const word = bare();
    if (!word) fail(p >= text.length ? "Tekst kończy się za wcześnie." : `Nieoczekiwany znak „${text[p]}”.`);
    return scalar(word);
  };

  const tag = value(0);
  ws();
  if (p < text.length) fail("Po końcu danych jest jeszcze tekst.");
  return tag;
}

// ---------- compression (server only) ----------

// bedrock: Bedrock's level.dat, an 8-byte header (format version, length) then little-endian NBT.
export type NbtPacking = "gzip" | "zlib" | "raw" | "bedrock" | "le";
export const NBT_FILE = /\.(dat|dat_old|nbt)$/i;
/** Biggest unpacked file the editor takes. */
const MAX_UNPACKED = 16 * 1024 * 1024;

/** Unpacks and reads a file, remembering how it was packed so it's saved the same way. */
export async function unpackNbt(bytes: Uint8Array): Promise<{ packing: NbtPacking; root: Root; version?: number }> {
  const zlib = await import("node:zlib");
  const opts = { maxOutputLength: MAX_UNPACKED };
  try {
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) return { packing: "gzip", root: readNbt(zlib.gunzipSync(bytes, opts)) };
    if (bytes[0] === 0x78 && ((bytes[0] << 8) | bytes[1]) % 31 === 0) return { packing: "zlib", root: readNbt(zlib.inflateSync(bytes, opts)) };
  } catch (err) {
    if (err instanceof NbtError) throw err;
    throw new NbtError("Nie udało się rozpakować pliku albo jest za duży.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 8 && view.getUint32(4, true) === bytes.length - 8 && bytes[8] === 10) {
    return { packing: "bedrock", root: readNbt(bytes.subarray(8), true), version: view.getUint32(0, true) };
  }
  try {
    return { packing: "raw", root: readNbt(bytes) };
  } catch (err) {
    // Bedrock files without the header (other .dat files of a Bedrock world).
    try {
      return { packing: "le", root: readNbt(bytes, true) };
    } catch {
      throw err;
    }
  }
}

export async function packNbt(root: Root, packing: NbtPacking, version = 10): Promise<Uint8Array<ArrayBuffer>> {
  const zlib = await import("node:zlib");
  if (packing === "le") return writeNbt(root, true);
  if (packing === "bedrock") {
    const body = writeNbt(root, true);
    const out = new Uint8Array(8 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, version, true);
    view.setUint32(4, body.length, true);
    out.set(body, 8);
    return out;
  }
  const raw = writeNbt(root);
  if (packing === "raw") return raw;
  const out = packing === "gzip" ? zlib.gzipSync(raw) : zlib.deflateSync(raw);
  return new Uint8Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)) as Uint8Array<ArrayBuffer>;
}
