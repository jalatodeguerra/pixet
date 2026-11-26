// Minimal STORE-only (no compression) ZIP writer. Pure, no dependencies.

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

export function crc32(data: Uint8Array): number {
  const t = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Builds a ZIP archive using method 0 (stored). Names are UTF-8. */
export function createZip(
  entries: readonly ZipEntry[],
  modified: Date = new Date(1980, 0, 1)
): Uint8Array {
  if (entries.length > 0xffff) {
    throw new Error("Too many files for a ZIP archive");
  }
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(modified);
  const names = entries.map((e) => enc.encode(e.name));

  let total = 22;
  for (let i = 0; i < entries.length; i++) {
    total += 30 + names[i].length + entries[i].data.length;
    total += 46 + names[i].length;
  }
  if (total > 0xffffffff) throw new Error("ZIP archive too large");

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let pos = 0;
  const offsets: number[] = [];
  const crcs: number[] = [];

  for (let i = 0; i < entries.length; i++) {
    const data = entries[i].data;
    const crc = crc32(data);
    crcs.push(crc);
    offsets.push(pos);
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 0x0800, true); // UTF-8 names
    view.setUint16(pos + 8, 0, true); // stored
    view.setUint16(pos + 10, time, true);
    view.setUint16(pos + 12, date, true);
    view.setUint32(pos + 14, crc, true);
    view.setUint32(pos + 18, data.length, true);
    view.setUint32(pos + 22, data.length, true);
    view.setUint16(pos + 26, names[i].length, true);
    view.setUint16(pos + 28, 0, true);
    pos += 30;
    out.set(names[i], pos);
    pos += names[i].length;
    out.set(data, pos);
    pos += data.length;
  }

  const cdStart = pos;
  for (let i = 0; i < entries.length; i++) {
    const data = entries[i].data;
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 20, true);
    view.setUint16(pos + 8, 0x0800, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, time, true);
    view.setUint16(pos + 14, date, true);
    view.setUint32(pos + 16, crcs[i], true);
    view.setUint32(pos + 20, data.length, true);
    view.setUint32(pos + 24, data.length, true);
    view.setUint16(pos + 28, names[i].length, true);
    view.setUint16(pos + 30, 0, true);
    view.setUint16(pos + 32, 0, true);
    view.setUint16(pos + 34, 0, true);
    view.setUint16(pos + 36, 0, true);
    view.setUint32(pos + 38, 0, true);
    view.setUint32(pos + 42, offsets[i], true);
    pos += 46;
    out.set(names[i], pos);
    pos += names[i].length;
  }
  const cdSize = pos - cdStart;

  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, cdSize, true);
  view.setUint32(pos + 16, cdStart, true);
  view.setUint16(pos + 20, 0, true);
  return out;
}
