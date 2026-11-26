// Pure TypeScript port of crates/pixet-core/src/export.rs spritesheet
// packing and metadata writers (pack_spritesheet, try_pack_maxrects,
// blit_with_extrude, generate_spritesheet_json, generate_godot_spriteframes).
// Keep the two implementations in sync: web and desktop exports must match.

export type PackModeTs = "grid" | "tight";

export interface PackOptions {
  pack: PackModeTs;
  trim: boolean;
  extrude: number;
  padding: number;
}

export interface SheetSourceFrame {
  frameIndex: number;
  durationMs: number;
  /** Full-document RGBA composite. */
  rgba: Uint8ClampedArray | Uint8Array;
}

export interface PackedFrame {
  frameIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  sourceX: number;
  sourceY: number;
  sourceW: number;
  sourceH: number;
  trimmed: boolean;
  durationMs: number;
}

export interface PackedSheet {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  frames: PackedFrame[];
}

export interface SheetTag {
  name: string;
  fromFrame: number;
  toFrame: number;
  color: string;
}

interface CroppedFrame {
  frameIndex: number;
  durationMs: number;
  sourceX: number;
  sourceY: number;
  sourceW: number;
  sourceH: number;
  w: number;
  h: number;
  trimmed: boolean;
  rgba: Uint8ClampedArray | Uint8Array;
}

function cropFrame(
  f: SheetSourceFrame,
  srcW: number,
  srcH: number,
  trim: boolean
): CroppedFrame {
  const base = {
    frameIndex: f.frameIndex,
    durationMs: f.durationMs,
    sourceW: srcW,
    sourceH: srcH,
  };
  if (!trim) {
    return {
      ...base,
      sourceX: 0,
      sourceY: 0,
      w: srcW,
      h: srcH,
      trimmed: false,
      rgba: f.rgba,
    };
  }
  const rgba = f.rgba;
  let minX = srcW;
  let minY = srcH;
  let maxX = 0;
  let maxY = 0;
  let any = false;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      if (rgba[(y * srcW + x) * 4 + 3] > 0) {
        any = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!any) {
    return {
      ...base,
      sourceX: 0,
      sourceY: 0,
      w: 1,
      h: 1,
      trimmed: true,
      rgba: new Uint8ClampedArray(4),
    };
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const cropped = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const s = ((minY + row) * srcW + minX) * 4;
    cropped.set(rgba.subarray(s, s + w * 4), row * w * 4);
  }
  return {
    ...base,
    sourceX: minX,
    sourceY: minY,
    w,
    h,
    trimmed: w !== srcW || h !== srcH,
    rgba: cropped,
  };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectContains(a: Rect, b: Rect): boolean {
  return (
    b.x >= a.x &&
    b.y >= a.y &&
    b.x + b.w <= a.x + a.w &&
    b.y + b.h <= a.y + a.h
  );
}

type Item = [index: number, w: number, h: number];

/** MaxRects, best-short-side-fit, mirrors try_pack_maxrects. */
export function tryPackMaxRects(
  items: readonly Item[],
  binW: number,
  binH: number
): Array<[number, number, number]> | null {
  let free: Rect[] = [{ x: 0, y: 0, w: binW, h: binH }];
  const placements: Array<[number, number, number]> = [];

  for (const [origIdx, w, h] of items) {
    let best: Rect | null = null;
    let bestShort = Infinity;
    let bestLong = Infinity;
    for (const fr of free) {
      if (fr.w >= w && fr.h >= h) {
        const lh = fr.w - w;
        const lv = fr.h - h;
        const short = Math.min(lh, lv);
        const long = Math.max(lh, lv);
        if (short < bestShort || (short === bestShort && long < bestLong)) {
          bestShort = short;
          bestLong = long;
          best = { x: fr.x, y: fr.y, w, h };
        }
      }
    }
    if (!best) return null;
    const placed = best;
    placements.push([origIdx, placed.x, placed.y]);

    const nextFree: Rect[] = [];
    for (const fr of free) {
      const intersects = !(
        placed.x >= fr.x + fr.w ||
        placed.x + placed.w <= fr.x ||
        placed.y >= fr.y + fr.h ||
        placed.y + placed.h <= fr.y
      );
      if (!intersects) {
        nextFree.push(fr);
        continue;
      }
      if (placed.x > fr.x) {
        nextFree.push({ x: fr.x, y: fr.y, w: placed.x - fr.x, h: fr.h });
      }
      if (placed.x + placed.w < fr.x + fr.w) {
        nextFree.push({
          x: placed.x + placed.w,
          y: fr.y,
          w: fr.x + fr.w - (placed.x + placed.w),
          h: fr.h,
        });
      }
      if (placed.y > fr.y) {
        nextFree.push({ x: fr.x, y: fr.y, w: fr.w, h: placed.y - fr.y });
      }
      if (placed.y + placed.h < fr.y + fr.h) {
        nextFree.push({
          x: fr.x,
          y: placed.y + placed.h,
          w: fr.w,
          h: fr.y + fr.h - (placed.y + placed.h),
        });
      }
    }

    const pruned: Rect[] = [];
    for (let i = 0; i < nextFree.length; i++) {
      let contained = false;
      for (let j = 0; j < nextFree.length; j++) {
        if (i !== j && rectContains(nextFree[j], nextFree[i])) {
          contained = true;
          break;
        }
      }
      if (!contained) pruned.push(nextFree[i]);
    }
    free = pruned;
  }
  return placements;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function blitWithExtrude(
  sheet: Uint8ClampedArray,
  sheetW: number,
  src: Uint8ClampedArray | Uint8Array,
  dstX: number,
  dstY: number,
  w: number,
  h: number,
  extrude: number
): void {
  const put = (x: number, y: number, si: number): void => {
    const di = (y * sheetW + x) * 4;
    sheet[di] = src[si];
    sheet[di + 1] = src[si + 1];
    sheet[di + 2] = src[si + 2];
    sheet[di + 3] = src[si + 3];
  };
  const at = (sx: number, sy: number): number => (sy * w + sx) * 4;

  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) put(dstX + sx, dstY + sy, at(sx, sy));
  }
  if (extrude === 0) return;

  for (let sx = 0; sx < w; sx++) {
    for (let e = 1; e <= extrude; e++) {
      put(dstX + sx, dstY - e, at(sx, 0));
      put(dstX + sx, dstY + h - 1 + e, at(sx, h - 1));
    }
  }
  for (let sy = 0; sy < h; sy++) {
    for (let e = 1; e <= extrude; e++) {
      put(dstX - e, dstY + sy, at(0, sy));
      put(dstX + w - 1 + e, dstY + sy, at(w - 1, sy));
    }
  }
  for (let ey = 1; ey <= extrude; ey++) {
    for (let ex = 1; ex <= extrude; ex++) {
      put(dstX - ex, dstY - ey, at(0, 0));
      put(dstX + w - 1 + ex, dstY - ey, at(w - 1, 0));
      put(dstX - ex, dstY + h - 1 + ey, at(0, h - 1));
      put(dstX + w - 1 + ex, dstY + h - 1 + ey, at(w - 1, h - 1));
    }
  }
}

export function packSpritesheet(
  frames: readonly SheetSourceFrame[],
  srcW: number,
  srcH: number,
  opts: PackOptions
): PackedSheet {
  if (frames.length === 0) {
    throw new Error("Document has no frames to export");
  }
  const cropped = frames.map((f) => cropFrame(f, srcW, srcH, opts.trim));
  const n = cropped.length;
  const extrude = Math.max(0, Math.floor(opts.extrude));
  const padding = Math.max(0, Math.floor(opts.padding));
  const coords: Array<[number, number]> = new Array(n).fill(null).map(() => [0, 0]);
  let sheetW: number;
  let sheetH: number;

  if (opts.pack === "grid") {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const maxW = Math.max(...cropped.map((c) => c.w));
    const maxH = Math.max(...cropped.map((c) => c.h));
    const cellW = maxW + 2 * extrude;
    const cellH = maxH + 2 * extrude;
    sheetW = cols * cellW + Math.max(0, cols - 1) * padding;
    sheetH = rows * cellH + Math.max(0, rows - 1) * padding;
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      coords[i] = [col * (cellW + padding) + extrude, row * (cellH + padding) + extrude];
    }
  } else {
    const items: Item[] = cropped.map((c, i) => [
      i,
      c.w + 2 * extrude + padding,
      c.h + 2 * extrude + padding,
    ]);
    items.sort((a, b) => {
      const maxB = Math.max(b[1], b[2]);
      const maxA = Math.max(a[1], a[2]);
      return maxB - maxA || b[1] * b[2] - a[1] * a[2];
    });
    const minW = Math.max(1, ...items.map((it) => it[1]));
    const minH = Math.max(1, ...items.map((it) => it[2]));
    const totalArea = items.reduce((s, it) => s + it[1] * it[2], 0);
    const side = Math.max(Math.ceil(Math.sqrt(totalArea)), minW, minH);
    let binW = Math.max(nextPowerOfTwo(side), minW);
    let binH = Math.max(nextPowerOfTwo(side), minH);
    let placements = tryPackMaxRects(items, binW, binH);
    while (!placements) {
      if (binW <= binH) binW *= 2;
      else binH *= 2;
      placements = tryPackMaxRects(items, binW, binH);
    }
    let usedW = 1;
    let usedH = 1;
    for (const [idx, px, py] of placements) {
      const fx = px + extrude;
      const fy = py + extrude;
      coords[idx] = [fx, fy];
      usedW = Math.max(usedW, fx + cropped[idx].w + extrude);
      usedH = Math.max(usedH, fy + cropped[idx].h + extrude);
    }
    sheetW = usedW;
    sheetH = usedH;
  }

  const sheet = new Uint8ClampedArray(sheetW * sheetH * 4);
  const out: PackedFrame[] = [];
  for (let i = 0; i < n; i++) {
    const c = cropped[i];
    const [fx, fy] = coords[i];
    blitWithExtrude(sheet, sheetW, c.rgba, fx, fy, c.w, c.h, extrude);
    out.push({
      frameIndex: c.frameIndex,
      x: fx,
      y: fy,
      w: c.w,
      h: c.h,
      sourceX: c.sourceX,
      sourceY: c.sourceY,
      sourceW: c.sourceW,
      sourceH: c.sourceH,
      trimmed: c.trimmed,
      durationMs: c.durationMs,
    });
  }
  return { width: sheetW, height: sheetH, rgba: sheet, frames: out };
}

/** Matches generate_spritesheet_json (serde_json keys are alphabetical). */
export function generateSpritesheetJson(
  documentName: string,
  tags: readonly SheetTag[],
  sheet: PackedSheet,
  pngFilename: string,
  appVersion = "0.1.0"
): string {
  const base = documentName.endsWith(".pixet")
    ? documentName.slice(0, -".pixet".length)
    : documentName;
  const frames = sheet.frames.map((f) => ({
    duration: f.durationMs,
    filename: `${base}_${f.frameIndex}.png`,
    frame: { h: f.h, w: f.w, x: f.x, y: f.y },
    rotated: false,
    sourceSize: { h: f.sourceH, w: f.sourceW },
    spriteSourceSize: { h: f.h, w: f.w, x: f.sourceX, y: f.sourceY },
    trimmed: f.trimmed,
  }));
  const frameTags = tags.map((t) => ({
    color: t.color,
    direction: "forward",
    from: t.fromFrame,
    name: t.name,
    to: t.toFrame,
  }));
  const root = {
    frames,
    meta: {
      app: "pixet",
      format: "RGBA8888",
      frameTags,
      image: pngFilename,
      scale: "1",
      size: { h: sheet.height, w: sheet.width },
      version: appVersion,
    },
  };
  return JSON.stringify(root, null, 2);
}

const f32 = Math.fround;

/** Matches generate_godot_spriteframes (f32 arithmetic, {:.2} formatting). */
export function generateGodotSpriteFrames(
  tags: readonly SheetTag[],
  sheet: PackedSheet,
  pngFilename: string
): string {
  const loadSteps = 2 + sheet.frames.length;
  let out = `[gd_resource type="SpriteFrames" load_steps=${loadSteps} format=3]\n\n`;
  out += `[ext_resource type="Texture2D" path="res://${pngFilename}" id="1_tex"]\n\n`;

  sheet.frames.forEach((f, i) => {
    out += `[sub_resource type="AtlasTexture" id="AtlasTexture_${i}"]\n`;
    out += `atlas = ExtResource("1_tex")\n`;
    out += `region = Rect2(${f.x}, ${f.y}, ${f.w}, ${f.h})\n`;
    if (f.trimmed) {
      out += `margin = Rect2(${f.sourceX}, ${f.sourceY}, ${Math.max(0, f.sourceW - f.w)}, ${Math.max(0, f.sourceH - f.h)})\n`;
    }
    out += "\n";
  });

  out += "[resource]\n";
  out += "animations = [";

  const buildEntries = (from: number, to: number): [string, number] => {
    let slice = sheet.frames.filter(
      (f) => f.frameIndex >= from && f.frameIndex <= to
    );
    if (slice.length === 0) slice = sheet.frames.slice();
    let sum = f32(0);
    for (const f of slice) sum = f32(sum + f32(f.durationMs));
    const avgMs = Math.max(f32(sum / f32(Math.max(slice.length, 1))), 16);
    const speed = f32(1000 / avgMs);
    const entries = slice.map((f) => {
      const rel = Math.max(f32(f32(f.durationMs) / avgMs), f32(0.1));
      return `{\n"duration": ${rel.toFixed(2)},\n"texture": SubResource("AtlasTexture_${f.frameIndex}")\n}`;
    });
    return [entries.join(", "), speed];
  };

  if (tags.length === 0) {
    const maxIdx = Math.max(0, sheet.frames.length - 1);
    const [framesStr, speed] = buildEntries(0, maxIdx);
    out += `{\n"frames": [${framesStr}],\n"loop": true,\n"name": &"default",\n"speed": ${speed.toFixed(2)}\n}`;
  } else {
    const blocks = tags.map((tag) => {
      const [framesStr, speed] = buildEntries(tag.fromFrame, tag.toFrame);
      return `{\n"frames": [${framesStr}],\n"loop": true,\n"name": &"${tag.name}",\n"speed": ${speed.toFixed(2)}\n}`;
    });
    out += blocks.join(", ");
  }
  out += "]\n";
  return out;
}
