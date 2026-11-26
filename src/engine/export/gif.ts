// Pure GIF89a encoder (no dependencies).
//
// Palette strategy:
//  * If every opaque colour across the whole animation fits in the colour
//    table (<= 256, or <= 255 when a transparent slot is needed) a single
//    global palette is built exactly from the pixels (no dithering).
//  * Otherwise each frame gets a local palette: exact when that frame fits,
//    median-cut quantized (colours reduced) when it does not.
// Transparency: alpha < 128 is transparent, alpha >= 128 is opaque. Every
// frame uses disposal method 2 (restore to background) so transparent
// animations do not smear.

export const GIF_ALPHA_THRESHOLD = 128;

export interface GifFrameInput {
  /** RGBA pixels, width*height*4 */
  rgba: Uint8ClampedArray | Uint8Array;
  delayMs: number;
}

export interface GifEncodeOptions {
  width: number;
  height: number;
  frames: readonly GifFrameInput[];
  /** true (default): loop forever via NETSCAPE2.0. false: play once. */
  loop?: boolean;
}

export interface GifEncodeHooks {
  onProgress?: (done: number, total: number) => void;
  /** Awaited between frames so the UI can breathe. Default: setTimeout 0. */
  yieldToEventLoop?: () => Promise<void>;
}

export interface GifEncodeResult {
  bytes: Uint8Array;
  paletteMode: "global" | "local";
  /** true when any frame had to be quantized (> 256 colours). */
  colorsReduced: boolean;
  /** Distinct opaque colours found across the animation. */
  uniqueColors: number;
}

export function gifDelayCentiseconds(ms: number): number {
  const cs = Math.round(ms / 10);
  return Math.max(2, Math.min(0xffff, Number.isFinite(cs) ? cs : 2));
}

class ByteSink {
  private buf = new Uint8Array(1 << 16);
  length = 0;
  private ensure(extra: number): void {
    if (this.length + extra <= this.buf.length) return;
    let n = this.buf.length;
    while (n < this.length + extra) n *= 2;
    const next = new Uint8Array(n);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  byte(b: number): void {
    this.ensure(1);
    this.buf[this.length++] = b & 255;
  }
  u16(v: number): void {
    this.byte(v & 255);
    this.byte((v >> 8) & 255);
  }
  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }
  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  finish(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

/** GIF-flavoured LZW. Returns the raw code stream (not sub-blocked). */
export function lzwEncode(
  indices: Uint8Array,
  minCodeSize: number
): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out = new ByteSink();
  let acc = 0;
  let accBits = 0;
  let size = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map<number, number>();

  const emit = (code: number): void => {
    acc |= code << accBits;
    accBits += size;
    while (accBits >= 8) {
      out.byte(acc & 255);
      acc >>>= 8;
      accBits -= 8;
    }
  };

  emit(clear);
  if (indices.length > 0) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const found = dict.get(key);
      if (found !== undefined) {
        prefix = found;
        continue;
      }
      emit(prefix);
      if (next === 4096) {
        emit(clear);
        next = eoi + 1;
        size = minCodeSize + 1;
        dict = new Map();
      } else {
        if (next >= 1 << size) size++;
        dict.set(key, next++);
      }
      prefix = k;
    }
    emit(prefix);
  }
  emit(eoi);
  if (accBits > 0) out.byte(acc & 255);
  return out.finish();
}

function writeSubBlocks(sink: ByteSink, data: Uint8Array): void {
  for (let i = 0; i < data.length; i += 255) {
    const n = Math.min(255, data.length - i);
    sink.byte(n);
    sink.bytes(data.subarray(i, i + n));
  }
  sink.byte(0);
}

interface ColorEntry {
  r: number;
  g: number;
  b: number;
  count: number;
}

/** Weighted median-cut. Returns up to `limit` RGB palette entries. */
export function medianCutPalette(
  entries: readonly ColorEntry[],
  limit: number
): Array<[number, number, number]> {
  interface Box {
    items: ColorEntry[];
    total: number;
    range: number;
    channel: "r" | "g" | "b";
  }
  const makeBox = (items: ColorEntry[]): Box => {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    let total = 0;
    for (const e of items) {
      total += e.count;
      if (e.r < rMin) rMin = e.r;
      if (e.r > rMax) rMax = e.r;
      if (e.g < gMin) gMin = e.g;
      if (e.g > gMax) gMax = e.g;
      if (e.b < bMin) bMin = e.b;
      if (e.b > bMax) bMax = e.b;
    }
    const rr = rMax - rMin;
    const gr = gMax - gMin;
    const br = bMax - bMin;
    const range = Math.max(rr, gr, br);
    const channel = range === rr ? "r" : range === gr ? "g" : "b";
    return { items, total, range, channel };
  };

  const boxes: Box[] = [makeBox(entries.slice())];
  while (boxes.length < limit) {
    let best = -1;
    let bestRange = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].items.length > 1 && boxes[i].range > bestRange) {
        bestRange = boxes[i].range;
        best = i;
      }
    }
    if (best < 0) break;
    const box = boxes[best];
    const ch = box.channel;
    const sorted = box.items
      .slice()
      .sort((a, b) => a[ch] - b[ch] || a.r - b.r || a.g - b.g || a.b - b.b);
    const half = box.total / 2;
    let acc = 0;
    let split = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += sorted[i].count;
      if (acc >= half) {
        split = i + 1;
        break;
      }
    }
    split = Math.max(1, Math.min(sorted.length - 1, split));
    boxes.splice(best, 1, makeBox(sorted.slice(0, split)), makeBox(sorted.slice(split)));
  }

  return boxes.map((box) => {
    let r = 0, g = 0, b = 0;
    for (const e of box.items) {
      r += e.r * e.count;
      g += e.g * e.count;
      b += e.b * e.count;
    }
    const t = Math.max(1, box.total);
    return [Math.round(r / t), Math.round(g / t), Math.round(b / t)];
  });
}

function bitsForCount(n: number): number {
  let bits = 1;
  while (1 << bits < n) bits++;
  return Math.min(8, bits);
}

function scanColors(
  rgba: Uint8ClampedArray | Uint8Array,
  into: Map<number, ColorEntry>
): boolean {
  let hasTransparent = false;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < GIF_ALPHA_THRESHOLD) {
      hasTransparent = true;
      continue;
    }
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    const e = into.get(key);
    if (e) e.count++;
    else into.set(key, { r: rgba[i], g: rgba[i + 1], b: rgba[i + 2], count: 1 });
  }
  return hasTransparent;
}

interface FramePalette {
  /** RGB triples, length = colorCount*3 (padded to 2^bits) */
  table: Uint8Array;
  bits: number;
  transparentIndex: number; // -1 when none
  lookup: Map<number, number>; // exact colour key -> index
  quantized: boolean;
  /** Nearest colour search for non-exact colours */
  colors: Array<[number, number, number]>;
  firstColorIndex: number;
}

function buildPalette(
  entries: readonly ColorEntry[],
  needTransparent: boolean
): FramePalette {
  const cap = needTransparent ? 255 : 256;
  let colors: Array<[number, number, number]>;
  let quantized = false;
  if (entries.length <= cap) {
    colors = entries.map((e) => [e.r, e.g, e.b] as [number, number, number]);
  } else {
    colors = medianCutPalette(entries, cap);
    quantized = true;
  }
  const first = needTransparent ? 1 : 0;
  const total = colors.length + first;
  const bits = bitsForCount(Math.max(2, total));
  const table = new Uint8Array((1 << bits) * 3);
  const lookup = new Map<number, number>();
  colors.forEach((c, i) => {
    const idx = i + first;
    table[idx * 3] = c[0];
    table[idx * 3 + 1] = c[1];
    table[idx * 3 + 2] = c[2];
    lookup.set((c[0] << 16) | (c[1] << 8) | c[2], idx);
  });
  return {
    table,
    bits,
    transparentIndex: needTransparent ? 0 : -1,
    lookup,
    quantized,
    colors,
    firstColorIndex: first,
  };
}

function mapFrame(
  rgba: Uint8ClampedArray | Uint8Array,
  pal: FramePalette
): Uint8Array {
  const n = rgba.length / 4;
  const out = new Uint8Array(n);
  const cache = new Map<number, number>();
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (rgba[i + 3] < GIF_ALPHA_THRESHOLD) {
      out[p] = Math.max(0, pal.transparentIndex);
      continue;
    }
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    let idx = pal.lookup.get(key);
    if (idx === undefined) idx = cache.get(key);
    if (idx === undefined) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < pal.colors.length; c++) {
        const dr = pal.colors[c][0] - rgba[i];
        const dg = pal.colors[c][1] - rgba[i + 1];
        const db = pal.colors[c][2] - rgba[i + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      idx = best + pal.firstColorIndex;
      cache.set(key, idx);
    }
    out[p] = idx;
  }
  return out;
}

const defaultYield = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

export async function encodeGif(
  opts: GifEncodeOptions,
  hooks: GifEncodeHooks = {}
): Promise<GifEncodeResult> {
  const { width, height, frames } = opts;
  if (frames.length === 0) throw new Error("GIF needs at least one frame");
  if (width < 1 || height < 1 || width > 0xffff || height > 0xffff) {
    throw new Error("GIF dimensions out of range");
  }
  const doYield = hooks.yieldToEventLoop ?? defaultYield;
  const loop = opts.loop ?? true;

  // Pass 1: colour census across the whole animation.
  const globalColors = new Map<number, ColorEntry>();
  let anyTransparent = false;
  for (const f of frames) {
    if (scanColors(f.rgba, globalColors)) anyTransparent = true;
  }
  const uniqueColors = globalColors.size;
  const useGlobal = uniqueColors + (anyTransparent ? 1 : 0) <= 256;
  const globalPal = useGlobal
    ? buildPalette(Array.from(globalColors.values()), anyTransparent)
    : null;

  const sink = new ByteSink();
  sink.ascii("GIF89a");
  sink.u16(width);
  sink.u16(height);
  if (globalPal) {
    sink.byte(0x80 | (7 << 4) | (globalPal.bits - 1));
  } else {
    sink.byte(7 << 4);
  }
  sink.byte(0); // background colour index
  sink.byte(0); // pixel aspect ratio
  if (globalPal) sink.bytes(globalPal.table);

  if (loop) {
    sink.byte(0x21);
    sink.byte(0xff);
    sink.byte(11);
    sink.ascii("NETSCAPE2.0");
    sink.byte(3);
    sink.byte(1);
    sink.u16(0); // 0 = loop forever
    sink.byte(0);
  }

  let colorsReduced = false;
  for (let fi = 0; fi < frames.length; fi++) {
    const frame = frames[fi];
    let pal = globalPal;
    if (!pal) {
      const colors = new Map<number, ColorEntry>();
      const hasT = scanColors(frame.rgba, colors);
      pal = buildPalette(Array.from(colors.values()), hasT);
      if (pal.quantized) colorsReduced = true;
    }
    const indices = mapFrame(frame.rgba, pal);

    // Graphic Control Extension: disposal 2 (restore to background)
    sink.byte(0x21);
    sink.byte(0xf9);
    sink.byte(4);
    sink.byte((2 << 2) | (pal.transparentIndex >= 0 ? 1 : 0));
    sink.u16(gifDelayCentiseconds(frame.delayMs));
    sink.byte(Math.max(0, pal.transparentIndex));
    sink.byte(0);

    // Image descriptor
    sink.byte(0x2c);
    sink.u16(0);
    sink.u16(0);
    sink.u16(width);
    sink.u16(height);
    if (globalPal) {
      sink.byte(0);
    } else {
      sink.byte(0x80 | (pal.bits - 1));
      sink.bytes(pal.table);
    }

    const minCode = Math.max(2, pal.bits);
    sink.byte(minCode);
    writeSubBlocks(sink, lzwEncode(indices, minCode));

    hooks.onProgress?.(fi + 1, frames.length);
    await doYield();
  }

  sink.byte(0x3b);
  return {
    bytes: sink.finish(),
    paletteMode: globalPal ? "global" : "local",
    colorsReduced,
    uniqueColors,
  };
}
