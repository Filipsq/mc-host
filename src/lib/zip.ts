import "server-only";
import { crc32, inflateRawSync } from "node:zlib";

// Just enough zip for the players' mod pack (src/lib/playerMods.ts): reading a
// few small text files out of a mod's .jar, and writing a pack as a stream
// with the files stored as they are (jars are zips already, so packing them
// again gains nothing).

/** A file's text from a zip held in memory, or null if it isn't there (or is too big to bother with). */
export function readZipText(zip: Buffer, name: string, maxBytes = 1024 * 1024): string | null {
  // The end record is in the last 64 KiB (its comment is at most that long).
  const from = Math.max(0, zip.length - 22 - 0xffff);
  let end = -1;
  for (let i = zip.length - 22; i >= from; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let n = 0; n < count && at + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(at + 10);
    const packed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const entry = zip.toString("utf8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (entry !== name) continue;
    if (size > maxBytes || local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) return null;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + packed);
    try {
      if (method === 0) return data.toString("utf8");
      if (method === 8) return inflateRawSync(data, { maxOutputLength: maxBytes }).toString("utf8");
    } catch {
      return null;
    }
    return null;
  }
  return null;
}

export type ZipSource = { name: string; data: Uint8Array | (() => Promise<ReadableStream<Uint8Array>>) };

// Dates in zips are MS-DOS ones; one fixed date keeps the same pack byte for byte the same.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/**
 * Streams a zip of these files, stored without compression. Streamed files
 * get their sizes and checksum after the data (a data descriptor), which
 * every zip reader takes. No zip64: the caller keeps the whole under 4 GiB.
 */
export function zipStream(files: ZipSource[]): ReadableStream<Uint8Array> {
  const central: Buffer[] = [];
  let offset = 0;
  let i = 0;
  // The streamed file being sent, one chunk per pull so a slow download never piles up in memory.
  let open: { reader: ReadableStreamDefaultReader<Uint8Array>; name: Buffer; start: number; crc: number; size: number } | null = null;

  const local = (name: Buffer, flags: number, crc: number, size: number) => {
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(flags, 6);
    h.writeUInt16LE(DOS_TIME, 10);
    h.writeUInt16LE(DOS_DATE, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(size, 18);
    h.writeUInt32LE(size, 22);
    h.writeUInt16LE(name.length, 26);
    return Buffer.concat([h, name]);
  };
  const record = (name: Buffer, flags: number, crc: number, size: number, start: number) => {
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(flags, 8);
    c.writeUInt16LE(DOS_TIME, 12);
    c.writeUInt16LE(DOS_DATE, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(size, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(start, 42);
    central.push(Buffer.concat([c, name]));
  };
  const STREAMED = 0x0808; // UTF-8 names, sizes after the data
  const PLAIN = 0x0800;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (open) {
        const { done, value } = await open.reader.read();
        if (!done) {
          open.crc = crc32(value, open.crc);
          open.size += value.length;
          if (open.start + open.size > 0xfffffff0) throw new Error("zip too big");
          controller.enqueue(value);
          return;
        }
        const crc = open.crc >>> 0;
        const desc = Buffer.alloc(16);
        desc.writeUInt32LE(0x08074b50, 0);
        desc.writeUInt32LE(crc, 4);
        desc.writeUInt32LE(open.size, 8);
        desc.writeUInt32LE(open.size, 12);
        controller.enqueue(desc);
        offset += open.size + desc.length;
        record(open.name, STREAMED, crc, open.size, open.start);
        open = null;
        return;
      }
      if (i === files.length) {
        const dir = Buffer.concat(central);
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(files.length, 8);
        end.writeUInt16LE(files.length, 10);
        end.writeUInt32LE(dir.length, 12);
        end.writeUInt32LE(offset, 16);
        controller.enqueue(Buffer.concat([dir, end]));
        controller.close();
        return;
      }
      const file = files[i++];
      const name = Buffer.from(file.name, "utf8");
      const start = offset;
      if (typeof file.data === "function") {
        const head = local(name, STREAMED, 0, 0);
        open = { reader: (await file.data()).getReader(), name, start, crc: 0, size: 0 };
        controller.enqueue(head);
        offset += head.length;
      } else {
        const crc = crc32(file.data) >>> 0;
        const head = local(name, PLAIN, crc, file.data.length);
        controller.enqueue(Buffer.concat([head, file.data]));
        offset += head.length + file.data.length;
        record(name, PLAIN, crc, file.data.length, start);
      }
    },
    async cancel() {
      await open?.reader.cancel().catch(() => {});
    },
  });
}
