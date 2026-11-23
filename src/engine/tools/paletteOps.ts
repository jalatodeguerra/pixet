import {
  PixelBuffer,
  hexToRgba,
  rgbaToHex,
  type RGBA,
} from "../document/PixelBuffer.ts";

export type HarmonyKind =
  | "complementary"
  | "analogous"
  | "triadic"
  | "splitComplementary";

export type PaletteSortMode = "hue" | "luminance" | "saturation";

interface Hsv {
  h: number; // [0, 360)
  s: number; // [0, 1]
  v: number; // [0, 1]
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function normalizeHue(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = clamp(r, 0, 255) / 255;
  const gn = clamp(g, 0, 255) / 255;
  const bn = clamp(b, 0, 255) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
        break;
      case gn:
        h = ((bn - rn) / d + 2) * 60;
        break;
      default:
        h = ((rn - gn) / d + 4) * 60;
        break;
    }
  }

  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h: normalizeHue(h), s, v };
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hn = normalizeHue(h);
  const sn = clamp(s, 0, 1);
  const vn = clamp(v, 0, 1);

  const c = vn * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = vn - c;

  let rn = 0;
  let gn = 0;
  let bn = 0;
  if (hn < 60) {
    rn = c;
    gn = x;
  } else if (hn < 120) {
    rn = x;
    gn = c;
  } else if (hn < 180) {
    gn = c;
    bn = x;
  } else if (hn < 240) {
    gn = x;
    bn = c;
  } else if (hn < 300) {
    rn = x;
    bn = c;
  } else {
    rn = c;
    bn = x;
  }

  return [
    Math.round((rn + m) * 255),
    Math.round((gn + m) * 255),
    Math.round((bn + m) * 255),
  ];
}

function rec709Luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function computeColorHarmonies(
  hex: string
): Record<HarmonyKind, string[]> {
  const [r, g, b] = hexToRgba(hex);
  const { h, s, v } = rgbToHsv(r, g, b);
  const shift = (deg: number): string => {
    const [hr, hg, hb] = hsvToRgb(h + deg, s, v);
    return rgbaToHex(hr, hg, hb);
  };

  return {
    complementary: [shift(180)],
    analogous: [shift(-30), shift(30)],
    triadic: [shift(120), shift(240)],
    splitComplementary: [shift(150), shift(210)],
  };
}

export function sortPaletteColors(
  palette: readonly string[],
  mode: PaletteSortMode
): string[] {
  const items = palette.map((hex, index) => {
    const [r, g, b] = hexToRgba(hex);
    const hsv = rgbToHsv(r, g, b);
    const lum = rec709Luminance(r, g, b);
    return { hex, index, hsv, lum };
  });

  const ACHROMATIC_SAT_EPS = 0.01;

  items.sort((a, b) => {
    if (mode === "luminance") {
      if (a.lum !== b.lum) return a.lum - b.lum;
      if (a.hsv.h !== b.hsv.h) return a.hsv.h - b.hsv.h;
      return a.index - b.index;
    }

    if (mode === "saturation") {
      if (a.hsv.s !== b.hsv.s) return a.hsv.s - b.hsv.s;
      if (a.lum !== b.lum) return a.lum - b.lum;
      return a.index - b.index;
    }

    // mode === "hue": chromatic colors sorted by hue first,
    // achromatic colors grouped by luminance at the end.
    const aAchromatic = a.hsv.s < ACHROMATIC_SAT_EPS;
    const bAchromatic = b.hsv.s < ACHROMATIC_SAT_EPS;
    if (aAchromatic !== bAchromatic) {
      return aAchromatic ? 1 : -1;
    }
    if (aAchromatic && bAchromatic) {
      if (a.lum !== b.lum) return a.lum - b.lum;
      return a.index - b.index;
    }
    if (a.hsv.h !== b.hsv.h) return a.hsv.h - b.hsv.h;
    if (a.hsv.s !== b.hsv.s) return a.hsv.s - b.hsv.s;
    if (a.lum !== b.lum) return a.lum - b.lum;
    return a.index - b.index;
  });

  return items.map((item) => item.hex);
}

interface ColorEntry {
  r: number;
  g: number;
  b: number;
  count: number;
}

interface ColorBucket {
  entries: ColorEntry[];
  totalCount: number;
  rRange: number;
  gRange: number;
  bRange: number;
  maxRange: number;
  splitChannel: "r" | "g" | "b";
}

function buildBucket(entries: ColorEntry[]): ColorBucket {
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;
  let totalCount = 0;

  for (const e of entries) {
    if (e.r < minR) minR = e.r;
    if (e.r > maxR) maxR = e.r;
    if (e.g < minG) minG = e.g;
    if (e.g > maxG) maxG = e.g;
    if (e.b < minB) minB = e.b;
    if (e.b > maxB) maxB = e.b;
    totalCount += e.count;
  }

  const rRange = maxR - minR;
  const gRange = maxG - minG;
  const bRange = maxB - minB;

  let splitChannel: "r" | "g" | "b" = "r";
  let maxRange = rRange;
  if (gRange > maxRange) {
    maxRange = gRange;
    splitChannel = "g";
  }
  if (bRange > maxRange) {
    maxRange = bRange;
    splitChannel = "b";
  }

  return {
    entries,
    totalCount,
    rRange,
    gRange,
    bRange,
    maxRange,
    splitChannel,
  };
}

export function extractPaletteMedianCut(
  buffers: readonly PixelBuffer[],
  maxColors: number
): string[] {
  const limit = Number.isFinite(maxColors)
    ? Math.max(2, Math.min(64, Math.round(maxColors)))
    : 16;

  const colorMap = new Map<number, ColorEntry>();
  for (const buf of buffers) {
    const data = buf.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const key = (r << 16) | (g << 8) | b;
      const existing = colorMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        colorMap.set(key, { r, g, b, count: 1 });
      }
    }
  }

  if (colorMap.size === 0) {
    return [];
  }

  const uniqueEntries = Array.from(colorMap.values());
  if (uniqueEntries.length <= limit) {
    uniqueEntries.sort(
      (a, b) => rec709Luminance(a.r, a.g, a.b) - rec709Luminance(b.r, b.g, b.b)
    );
    return uniqueEntries.map((e) => rgbaToHex(e.r, e.g, e.b));
  }

  const buckets: ColorBucket[] = [buildBucket(uniqueEntries)];

  while (buckets.length < limit) {
    let bestIdx = -1;
    let bestRange = 0;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.entries.length > 1 && b.maxRange > bestRange) {
        bestRange = b.maxRange;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    const target = buckets[bestIdx];
    const ch = target.splitChannel;
    const sorted = [...target.entries].sort((a, b) => {
      if (a[ch] !== b[ch]) return a[ch] - b[ch];
      if (a.r !== b.r) return a.r - b.r;
      if (a.g !== b.g) return a.g - b.g;
      return a.b - b.b;
    });

    const halfWeight = target.totalCount / 2;
    let acc = 0;
    let splitIdx = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += sorted[i].count;
      if (acc >= halfWeight) {
        splitIdx = i + 1;
        break;
      }
    }
    splitIdx = Math.max(1, Math.min(sorted.length - 1, splitIdx));

    const left = buildBucket(sorted.slice(0, splitIdx));
    const right = buildBucket(sorted.slice(splitIdx));
    buckets.splice(bestIdx, 1, left, right);
  }

  const seen = new Set<string>();
  const averaged: Array<{ hex: string; lum: number }> = [];

  for (const bucket of buckets) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (const e of bucket.entries) {
      sumR += e.r * e.count;
      sumG += e.g * e.count;
      sumB += e.b * e.count;
    }
    const r = Math.round(sumR / bucket.totalCount);
    const g = Math.round(sumG / bucket.totalCount);
    const b = Math.round(sumB / bucket.totalCount);
    const hex = rgbaToHex(r, g, b);
    if (!seen.has(hex)) {
      seen.add(hex);
      averaged.push({ hex, lum: rec709Luminance(r, g, b) });
    }
  }

  averaged.sort((a, b) => a.lum - b.lum);
  return averaged.map((item) => item.hex);
}

export function generateHueShiftedRamp(
  darkHex: string,
  lightHex: string,
  steps: number,
  hueShiftDeg = 0
): string[] {
  const count = Number.isFinite(steps)
    ? Math.max(2, Math.min(16, Math.round(steps)))
    : 5;

  const [dr, dg, db] = hexToRgba(darkHex);
  const [lr, lg, lb] = hexToRgba(lightHex);
  const darkHsv = rgbToHsv(dr, dg, db);
  const lightHsv = rgbToHsv(lr, lg, lb);

  const hStart = darkHsv.s === 0 && lightHsv.s > 0 ? lightHsv.h : darkHsv.h;
  const hEnd = lightHsv.s === 0 && darkHsv.s > 0 ? darkHsv.h : lightHsv.h;
  const dh = ((hEnd - hStart + 540) % 360) - 180;

  const result: string[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      result.push(rgbaToHex(dr, dg, db));
      continue;
    }
    if (i === count - 1) {
      result.push(rgbaToHex(lr, lg, lb));
      continue;
    }
    const t = i / (count - 1);
    const h = hStart + dh * t + Math.sin(Math.PI * t) * hueShiftDeg;
    const s = darkHsv.s + (lightHsv.s - darkHsv.s) * t;
    const v = darkHsv.v + (lightHsv.v - darkHsv.v) * t;
    const [r, g, b] = hsvToRgb(h, s, v);
    result.push(rgbaToHex(r, g, b));
  }
  return result;
}

export function snapRgbaToPalette(
  rgba: RGBA,
  paletteRgba: readonly RGBA[]
): RGBA {
  if (rgba[3] === 0 || paletteRgba.length === 0) {
    return [rgba[0], rgba[1], rgba[2], rgba[3]];
  }

  let best = paletteRgba[0];
  let bestDistSq = Infinity;

  for (let i = 0; i < paletteRgba.length; i++) {
    const p = paletteRgba[i];
    const dr = rgba[0] - p[0];
    const dg = rgba[1] - p[1];
    const db = rgba[2] - p[2];
    const distSq = dr * dr + dg * dg + db * db;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = p;
      if (distSq === 0) break;
    }
  }

  return [best[0], best[1], best[2], rgba[3]];
}
