import { PixelBuffer, type RGBA } from "../document/PixelBuffer.ts";
import { applyPixelOutline } from "../tools/rotate3d.ts";

/**
 * R6 — pixel cleanup pass applied after rig deformation.
 *
 * Order: orphan removal → 1-px hole fill → outline preservation → palette
 * lock. Palette lock runs last so the outline/hole colors it introduces are
 * snapped back into the source palette, guaranteeing no new colors.
 *
 * React-free; explicit `.ts` relative imports for `node --test`.
 */

export interface PixelCleanupOptions {
  /** Remove isolated pixels whose 8 neighbors are all transparent. */
  removeOrphans: boolean;
  /** Fill transparent pixels surrounded on >= 3 orthogonal sides by one color. */
  fillHoles: boolean;
  /** Snap every opaque output color to a color present in the source cel. */
  paletteLock: boolean;
  /** Re-apply a 1px outline using the dominant darkest source color. */
  preserveOutline: boolean;
}

export const DEFAULT_PIXEL_CLEANUP: PixelCleanupOptions = {
  removeOrphans: false,
  fillHoles: false,
  paletteLock: false,
  preserveOutline: false,
};

export interface PixelCleanupSource {
  /** Source palette; defaults to the colors present in `src`. */
  palette?: readonly RGBA[] | null;
  /** Outline color; defaults to the dominant darkest source color. */
  outlineColor?: RGBA | null;
}

export function hasPixelCleanup(
  options: PixelCleanupOptions | null | undefined
): boolean {
  if (!options) return false;
  return (
    options.removeOrphans ||
    options.fillHoles ||
    options.paletteLock ||
    options.preserveOutline
  );
}

export function packRgba(r: number, g: number, b: number, a: number): number {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

/** Unique opaque colors present in `src`, in first-seen order. */
export function collectPalette(src: PixelBuffer): RGBA[] {
  const seen = new Map<number, RGBA>();
  const data = src.data;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    const packed = packRgba(data[i], data[i + 1], data[i + 2], a);
    if (!seen.has(packed)) {
      seen.set(packed, [data[i], data[i + 1], data[i + 2], a]);
    }
  }
  return Array.from(seen.values());
}

/** Darkest palette color (lowest luminance), used for outline preservation. */
export function dominantDarkestColor(
  palette: readonly RGBA[]
): RGBA | null {
  let best: RGBA | null = null;
  let bestLuma = Infinity;
  for (const color of palette) {
    if (color[3] === 0) continue;
    const luma = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
    if (luma < bestLuma) {
      bestLuma = luma;
      best = color;
    }
  }
  return best ? [best[0], best[1], best[2], best[3]] : null;
}

/** Removes single opaque pixels whose 8 neighbors are all transparent. */
export function removeOrphanPixels(src: PixelBuffer): PixelBuffer {
  const out = src.clone();
  const w = src.width;
  const h = src.height;
  const data = src.data;
  const outData = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = (y * w + x) * 4;
      if (data[index + 3] === 0) continue;

      let hasNeighbor = false;
      for (let oy = -1; oy <= 1 && !hasNeighbor; oy++) {
        const ny = y + oy;
        if (ny < 0 || ny >= h) continue;
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          if (nx < 0 || nx >= w) continue;
          if (data[(ny * w + nx) * 4 + 3] > 0) {
            hasNeighbor = true;
            break;
          }
        }
      }

      if (!hasNeighbor) {
        outData[index] = 0;
        outData[index + 1] = 0;
        outData[index + 2] = 0;
        outData[index + 3] = 0;
      }
    }
  }

  out.markAllDirty();
  return out;
}

/**
 * Fills a transparent pixel with a color present on >= 3 of its 4 orthogonal
 * sides (same color on each counted side). Neighborhood is read from `src`,
 * so one pass never cascades into newly filled pixels.
 */
export function fillSinglePixelHoles(src: PixelBuffer): PixelBuffer {
  const out = src.clone();
  const w = src.width;
  const h = src.height;
  const data = src.data;
  const outData = out.data;

  const neighbors: RGBA[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const index = (y * w + x) * 4;
      if (data[index + 3] > 0) continue;

      neighbors.length = 0;
      if (x > 0) {
        const i = (y * w + x - 1) * 4;
        if (data[i + 3] > 0) neighbors.push([data[i], data[i + 1], data[i + 2], data[i + 3]]);
      }
      if (x + 1 < w) {
        const i = (y * w + x + 1) * 4;
        if (data[i + 3] > 0) neighbors.push([data[i], data[i + 1], data[i + 2], data[i + 3]]);
      }
      if (y > 0) {
        const i = ((y - 1) * w + x) * 4;
        if (data[i + 3] > 0) neighbors.push([data[i], data[i + 1], data[i + 2], data[i + 3]]);
      }
      if (y + 1 < h) {
        const i = ((y + 1) * w + x) * 4;
        if (data[i + 3] > 0) neighbors.push([data[i], data[i + 1], data[i + 2], data[i + 3]]);
      }
      if (neighbors.length < 3) continue;

      const counts = new Map<number, { count: number; color: RGBA }>();
      for (const color of neighbors) {
        const packed = packRgba(color[0], color[1], color[2], color[3]);
        const existing = counts.get(packed);
        if (existing) existing.count++;
        else counts.set(packed, { count: 1, color });
      }

      let fill: RGBA | null = null;
      let bestCount = 2;
      for (const entry of counts.values()) {
        if (entry.count > bestCount) {
          bestCount = entry.count;
          fill = entry.color;
        }
      }
      if (!fill) continue;

      outData[index] = fill[0];
      outData[index + 1] = fill[1];
      outData[index + 2] = fill[2];
      outData[index + 3] = fill[3];
    }
  }

  out.markAllDirty();
  return out;
}

/**
 * Snaps every opaque pixel to the nearest palette color (RGBA distance).
 * Colors already in the palette are copied untouched, so the common case is
 * O(pixels) and the output never contains a color outside `palette`.
 */
export function snapToPalette(
  src: PixelBuffer,
  palette: readonly RGBA[]
): PixelBuffer {
  const out = new PixelBuffer(src.width, src.height, src.data);
  if (palette.length === 0) return out;

  const known = new Set<number>();
  for (const color of palette) {
    known.add(packRgba(color[0], color[1], color[2], color[3]));
  }

  const outData = out.data;
  for (let i = 0; i < outData.length; i += 4) {
    if (outData[i + 3] === 0) continue;
    const packed = packRgba(outData[i], outData[i + 1], outData[i + 2], outData[i + 3]);
    if (known.has(packed)) continue;

    let best = palette[0];
    let bestDist = Infinity;
    for (const color of palette) {
      const dr = outData[i] - color[0];
      const dg = outData[i + 1] - color[1];
      const db = outData[i + 2] - color[2];
      const da = outData[i + 3] - color[3];
      const dist = dr * dr + dg * dg + db * db + da * da;
      if (dist < bestDist) {
        bestDist = dist;
        best = color;
      }
    }
    outData[i] = best[0];
    outData[i + 1] = best[1];
    outData[i + 2] = best[2];
    outData[i + 3] = best[3];
  }

  out.markAllDirty();
  return out;
}

export function applyPixelCleanup(
  src: PixelBuffer,
  options: PixelCleanupOptions,
  source: PixelCleanupSource = {}
): PixelBuffer {
  let result = src.clone();
  if (options.removeOrphans) result = removeOrphanPixels(result);
  if (options.fillHoles) result = fillSinglePixelHoles(result);

  const palette =
    source.palette && source.palette.length > 0
      ? source.palette
      : collectPalette(src);

  if (options.preserveOutline) {
    const color =
      source.outlineColor ?? dominantDarkestColor(palette) ?? [0, 0, 0, 255];
    result = applyPixelOutline(result, color);
  }

  if (options.paletteLock && palette.length > 0) {
    result = snapToPalette(result, palette);
  }

  return result;
}
