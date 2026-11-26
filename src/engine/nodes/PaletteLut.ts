import { PALETTE_PRESETS } from "../../utils/paletteParser.ts";
import type { GradientStop, PaletteParamValue } from "./types.ts";

export const DOCUMENT_PALETTE_SOURCE = "document";
export const CUSTOM_PALETTE_SOURCE = "custom";

export function normalizePaletteParam(raw: unknown): PaletteParamValue {
  if (raw && typeof raw === "object") {
    const obj = raw as Partial<PaletteParamValue>;
    const source =
      typeof obj.source === "string" && obj.source.length > 0
        ? obj.source
        : DOCUMENT_PALETTE_SOURCE;
    const colors = Array.isArray(obj.colors)
      ? obj.colors.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      : [...PALETTE_PRESETS[0].colors];
    return {
      source,
      colors: colors.length > 0 ? colors : [...PALETTE_PRESETS[0].colors],
    };
  }
  return {
    source: DOCUMENT_PALETTE_SOURCE,
    colors: [...PALETTE_PRESETS[0].colors],
  };
}

export function resolvePaletteColors(
  rawParam: unknown,
  documentPalette?: readonly string[]
): string[] {
  const param = normalizePaletteParam(rawParam);
  const fallback =
    documentPalette && documentPalette.length > 0
      ? [...documentPalette]
      : [...PALETTE_PRESETS[0].colors];

  if (param.source === DOCUMENT_PALETTE_SOURCE) {
    return fallback;
  }
  if (param.source === CUSTOM_PALETTE_SOURCE) {
    return param.colors.length > 0 ? [...param.colors] : fallback;
  }
  const preset = PALETTE_PRESETS.find((p) => p.name === param.source);
  if (preset && preset.colors.length > 0) {
    return [...preset.colors];
  }
  return fallback;
}

export function parseHexToRgba(hex: string): [number, number, number, number] {
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return [r, g, b, 255];
  }
  if (clean.length === 6 || clean.length === 8) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const a = clean.length === 8 ? parseInt(clean.slice(6, 8), 16) : 255;
    if (
      Number.isFinite(r) &&
      Number.isFinite(g) &&
      Number.isFinite(b) &&
      Number.isFinite(a)
    ) {
      return [r, g, b, a];
    }
  }
  return [0, 0, 0, 255];
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  const clamped = c < 0 ? 0 : c > 1 ? 1 : c;
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

export function srgbToOklab(
  r8: number,
  g8: number,
  b8: number
): [number, number, number] {
  const r = srgbToLinear(r8 / 255);
  const g = srgbToLinear(g8 / 255);
  const b = srgbToLinear(b8 / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabDistanceSq(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): number {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return dl * dl + da * da + db * db;
}

export function buildPaletteLutBytes(hexColors: readonly string[]): {
  data: Uint8Array;
  count: number;
} {
  const data = new Uint8Array(256 * 4);
  const count = Math.min(256, hexColors.length);
  for (let i = 0; i < count; i++) {
    const [r, g, b, a] = parseHexToRgba(hexColors[i]);
    const idx = i * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = a;
  }
  return { data, count };
}

export function sampleGradientRamp(
  stops: readonly GradientStop[],
  t: number
): [number, number, number, number] {
  if (stops.length === 0) return [0, 0, 0, 255];
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  if (clamped <= sorted[0].pos) return parseHexToRgba(sorted[0].color);
  const last = sorted[sorted.length - 1];
  if (clamped >= last.pos) return parseHexToRgba(last.color);

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (clamped >= a.pos && clamped <= b.pos) {
      const span = Math.max(1e-6, b.pos - a.pos);
      const u = (clamped - a.pos) / span;
      const ca = parseHexToRgba(a.color);
      const cb = parseHexToRgba(b.color);
      return [
        Math.round(ca[0] + (cb[0] - ca[0]) * u),
        Math.round(ca[1] + (cb[1] - ca[1]) * u),
        Math.round(ca[2] + (cb[2] - ca[2]) * u),
        Math.round(ca[3] + (cb[3] - ca[3]) * u),
      ];
    }
  }
  return parseHexToRgba(last.color);
}

export function buildRampLutBytes(stops: readonly GradientStop[]): Uint8Array {
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const [r, g, b, a] = sampleGradientRamp(stops, i / 255);
    const idx = i * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = a;
  }
  return data;
}

export function uploadPaletteLut(
  gl: WebGL2RenderingContext,
  existing: WebGLTexture | null,
  data: Uint8Array
): WebGLTexture {
  const tex = existing ?? gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    256,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    data
  );
  return tex;
}
