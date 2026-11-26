// Pure RGBA helpers used by the animated exporters.

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** Integer nearest-neighbour upscale. */
export function scaleRgbaNearest(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  scale: number
): Uint8ClampedArray {
  const s = Math.max(1, Math.floor(scale));
  if (s === 1) return new Uint8ClampedArray(rgba);
  const ow = width * s;
  const out = new Uint8ClampedArray(ow * height * s * 4);
  const src32 = new Uint32Array(
    rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + width * height * 4)
  );
  const dst32 = new Uint32Array(out.buffer);
  for (let y = 0; y < height; y++) {
    const rowStart = y * s * ow;
    for (let x = 0; x < width; x++) {
      const v = src32[y * width + x];
      const base = rowStart + x * s;
      for (let dx = 0; dx < s; dx++) dst32[base + dx] = v;
    }
    for (let dy = 1; dy < s; dy++) {
      dst32.copyWithin(rowStart + dy * ow, rowStart, rowStart + ow);
    }
  }
  return out;
}

/** Alpha-composites onto an opaque background colour (result alpha = 255). */
export function flattenOnBackground(
  rgba: Uint8ClampedArray | Uint8Array,
  bg: RgbColor
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a === 255) {
      out[i] = rgba[i];
      out[i + 1] = rgba[i + 1];
      out[i + 2] = rgba[i + 2];
    } else {
      const k = a / 255;
      out[i] = Math.round(rgba[i] * k + bg.r * (1 - k));
      out[i + 1] = Math.round(rgba[i + 1] * k + bg.g * (1 - k));
      out[i + 2] = Math.round(rgba[i + 2] * k + bg.b * (1 - k));
    }
    out[i + 3] = 255;
  }
  return out;
}

export function parseHexColor(hex: string): RgbColor | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}
