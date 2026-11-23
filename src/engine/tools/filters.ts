import { PixelBuffer, type RGBA } from "../document/PixelBuffer.ts";
import { getDitherMatrixValue } from "./dither.ts";

export type PixelMask = { contains(x: number, y: number): boolean } | null | undefined;

export interface OutlineFilterOptions {
  thickness: number;
  connectivity: 4 | 8;
  placement: "outside" | "inside";
  mode: "solid" | "selective";
  color: RGBA;
}

export interface DropShadowFilterOptions {
  offsetX: number;
  offsetY: number;
  color: RGBA;
  opacity: number;
}

export interface HsvAdjustOptions {
  hueDeg: number;
  satDelta: number;
  valDelta: number;
}

export interface BrightnessContrastOptions {
  brightness: number;
  contrast: number;
}

export interface ColorReplaceOptions {
  fromRgba: RGBA;
  toRgba: RGBA;
  tolerance: number;
}

export interface QuantizeToPaletteOptions {
  palette: readonly RGBA[];
  dither: "none" | "bayer4" | "floydSteinberg";
}

export interface PixelCleanupFilterOptions {
  removeOrphans: boolean;
  fillHoles: boolean;
}

const CARDINAL_OFFSETS: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const EIGHT_WAY_OFFSETS: readonly [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function maskAllows(mask: PixelMask, x: number, y: number): boolean {
  return !mask || mask.contains(x, y);
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
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
  return [h, s, v];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360;
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
    clampByte((rn + m) * 255),
    clampByte((gn + m) * 255),
    clampByte((bn + m) * 255),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
      break;
    case gn:
      h = (bn - rn) / d + 2;
      break;
    default:
      h = (rn - gn) / d + 4;
      break;
  }
  return [(h / 6) * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = (((h % 360) + 360) % 360) / 360;
  const sn = clamp(s, 0, 1);
  const ln = clamp(l, 0, 1);
  if (sn === 0) {
    const v = clampByte(ln * 255);
    return [v, v, v];
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };

  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  return [
    clampByte(hue2rgb(p, q, hn + 1 / 3) * 255),
    clampByte(hue2rgb(p, q, hn) * 255),
    clampByte(hue2rgb(p, q, hn - 1 / 3) * 255),
  ];
}

function deriveSelectiveOutlineColor(r: number, g: number, b: number): RGBA {
  const [h, s, l] = rgbToHsl(r, g, b);
  // Shift hue subtly toward cool blue/violet shadow (250 deg), with +15 deg baseline shift when neutral
  const targetCoolHue = 250;
  let shiftedHue: number;
  if (s < 0.04) {
    shiftedHue = 240;
  } else {
    const diff = ((targetCoolHue - h + 540) % 360) - 180;
    const step = Math.abs(diff) < 15 ? diff : Math.sign(diff) * 15;
    shiftedHue = (h + (step === 0 ? 15 : step) + 360) % 360;
  }
  const nextS = s < 0.04 ? 0.18 : clamp(s + 0.08, 0, 1);
  const nextL = clamp(l * 0.55, 0.03, 0.92);
  const [or, og, ob] = hslToRgb(shiftedHue, nextS, nextL);
  return [or, og, ob, 255];
}

export function applyOutlineFilter(
  buf: PixelBuffer,
  opts: OutlineFilterOptions,
  mask?: PixelMask
): PixelBuffer {
  const w = buf.width;
  const h = buf.height;
  if (w === 0 || h === 0) return buf.clone();

  const passes = clamp(Math.round(opts.thickness), 1, 4);
  const offsets = opts.connectivity === 8 ? EIGHT_WAY_OFFSETS : CARDINAL_OFFSETS;

  let current = buf.clone();
  for (let pass = 0; pass < passes; pass++) {
    const srcData = current.data;
    const next = current.clone();
    const dstData = next.data;

    if (opts.placement === "outside") {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!maskAllows(mask, x, y)) continue;
          const idx = (y * w + x) * 4;
          if (srcData[idx + 3] > 0) continue;

          let neighborIdx = -1;
          for (let i = 0; i < offsets.length; i++) {
            const nx = x + offsets[i][0];
            const ny = y + offsets[i][1];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const nIdx = (ny * w + nx) * 4;
            if (srcData[nIdx + 3] > 0) {
              neighborIdx = nIdx;
              break;
            }
          }

          if (neighborIdx !== -1) {
            const c: RGBA =
              opts.mode === "selective"
                ? deriveSelectiveOutlineColor(
                    srcData[neighborIdx],
                    srcData[neighborIdx + 1],
                    srcData[neighborIdx + 2]
                  )
                : opts.color;
            dstData[idx] = c[0];
            dstData[idx + 1] = c[1];
            dstData[idx + 2] = c[2];
            dstData[idx + 3] = c[3];
          }
        }
      }
    } else {
      // "inside": opaque pixels adjacent to transparent pixel or canvas edge
      const borderedMask = pass === 0 ? null : new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!maskAllows(mask, x, y)) continue;
          const idx = (y * w + x) * 4;
          if (srcData[idx + 3] === 0) continue;

          let touchesOutside = false;
          for (let i = 0; i < offsets.length; i++) {
            const nx = x + offsets[i][0];
            const ny = y + offsets[i][1];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
              touchesOutside = true;
              break;
            }
            const nIdx = (ny * w + nx) * 4;
            if (srcData[nIdx + 3] === 0) {
              touchesOutside = true;
              break;
            }
          }

          if (touchesOutside) {
            if (borderedMask) borderedMask[y * w + x] = 1;
            const c: RGBA =
              opts.mode === "selective"
                ? deriveSelectiveOutlineColor(
                    srcData[idx],
                    srcData[idx + 1],
                    srcData[idx + 2]
                  )
                : opts.color;
            dstData[idx] = c[0];
            dstData[idx + 1] = c[1];
            dstData[idx + 2] = c[2];
            dstData[idx + 3] = c[3];
          }
        }
      }
      // On multi-pass inside outline, step inward only if thickness > 1 by peeling via outline-eligible frontier
      if (pass === 0 && passes > 1) {
        // Track pixels converted to outline so subsequent passes step inward into interior opaque pixels
        const outlineFrontier = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (!maskAllows(mask, x, y)) continue;
            const idx = (y * w + x) * 4;
            if (srcData[idx + 3] === 0) continue;
            for (let i = 0; i < offsets.length; i++) {
              const nx = x + offsets[i][0];
              const ny = y + offsets[i][1];
              if (
                nx < 0 ||
                ny < 0 ||
                nx >= w ||
                ny >= h ||
                srcData[(ny * w + nx) * 4 + 3] === 0
              ) {
                outlineFrontier[y * w + x] = 1;
                break;
              }
            }
          }
        }
        next.markAllDirty();
        current = next;
        for (let p = 1; p < passes; p++) {
          const stepNext = current.clone();
          const stepSrc = current.data;
          const stepDst = stepNext.data;
          const nextFrontier = new Uint8Array(outlineFrontier);
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              if (!maskAllows(mask, x, y)) continue;
              const cell = y * w + x;
              if (outlineFrontier[cell] !== 0) continue;
              const idx = cell * 4;
              if (stepSrc[idx + 3] === 0) continue;

              let adjacentToOutline = false;
              for (let i = 0; i < offsets.length; i++) {
                const nx = x + offsets[i][0];
                const ny = y + offsets[i][1];
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
                  adjacentToOutline = true;
                  break;
                }
                if (outlineFrontier[ny * w + nx] !== 0) {
                  adjacentToOutline = true;
                  break;
                }
              }

              if (adjacentToOutline) {
                nextFrontier[cell] = 1;
                const c: RGBA =
                  opts.mode === "selective"
                    ? deriveSelectiveOutlineColor(
                        stepSrc[idx],
                        stepSrc[idx + 1],
                        stepSrc[idx + 2]
                      )
                    : opts.color;
                stepDst[idx] = c[0];
                stepDst[idx + 1] = c[1];
                stepDst[idx + 2] = c[2];
                stepDst[idx + 3] = c[3];
              }
            }
          }
          outlineFrontier.set(nextFrontier);
          stepNext.markAllDirty();
          current = stepNext;
        }
        return current;
      }
    }

    next.markAllDirty();
    current = next;
  }

  return current;
}

export function applyDropShadowFilter(
  buf: PixelBuffer,
  opts: DropShadowFilterOptions,
  mask?: PixelMask
): PixelBuffer {
  const w = buf.width;
  const h = buf.height;
  const out = buf.clone();
  if (w === 0 || h === 0) return out;

  const ox = Math.round(opts.offsetX);
  const oy = Math.round(opts.offsetY);
  const opacityNorm =
    opts.opacity <= 1 ? clamp(opts.opacity, 0, 1) : clamp(opts.opacity, 0, 100) / 100;

  if (opacityNorm <= 0 || opts.color[3] === 0) return out;

  const srcData = buf.data;
  const outData = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x - ox;
      const sy = y - oy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      if (!maskAllows(mask, x, y)) continue;

      const sIdx = (sy * w + sx) * 4;
      const srcAlpha = srcData[sIdx + 3];
      if (srcAlpha === 0) continue;

      const shadowAlpha = (srcAlpha / 255) * (opts.color[3] / 255) * opacityNorm;
      if (shadowAlpha <= 0) continue;

      const dIdx = (y * w + x) * 4;
      const da = outData[dIdx + 3] / 255;

      // Porter-Duff destination-over: dst (foreground) over shadow (source)
      // outA = da + shadowAlpha * (1 - da)
      const outA = da + shadowAlpha * (1 - da);
      if (outA <= 0) continue;

      const shadowContrib = shadowAlpha * (1 - da);
      outData[dIdx] = clampByte(
        (outData[dIdx] * da + opts.color[0] * shadowContrib) / outA
      );
      outData[dIdx + 1] = clampByte(
        (outData[dIdx + 1] * da + opts.color[1] * shadowContrib) / outA
      );
      outData[dIdx + 2] = clampByte(
        (outData[dIdx + 2] * da + opts.color[2] * shadowContrib) / outA
      );
      outData[dIdx + 3] = clampByte(outA * 255);
    }
  }

  out.markAllDirty();
  return out;
}

export function applyHsvAdjust(
  buf: PixelBuffer,
  opts: HsvAdjustOptions,
  mask?: PixelMask
): PixelBuffer {
  const hueDeg = clamp(opts.hueDeg, -180, 180);
  const satDelta = clamp(opts.satDelta, -100, 100);
  const valDelta = clamp(opts.valDelta, -100, 100);

  const out = buf.clone();
  if (hueDeg === 0 && satDelta === 0 && valDelta === 0) {
    return out;
  }

  const w = out.width;
  const h = out.height;
  const data = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!maskAllows(mask, x, y)) continue;
      const idx = (y * w + x) * 4;
      if (data[idx + 3] === 0) continue;

      const [ch, cs, cv] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2]);
      const nh = (ch + hueDeg + 360) % 360;
      const ns = clamp(cs + satDelta / 100, 0, 1);
      const nv = clamp(cv + valDelta / 100, 0, 1);
      const [nr, ng, nb] = hsvToRgb(nh, ns, nv);

      data[idx] = nr;
      data[idx + 1] = ng;
      data[idx + 2] = nb;
    }
  }

  out.markAllDirty();
  return out;
}

export function applyBrightnessContrast(
  buf: PixelBuffer,
  opts: BrightnessContrastOptions,
  mask?: PixelMask
): PixelBuffer {
  const brightness = clamp(opts.brightness, -100, 100);
  const contrast = clamp(opts.contrast, -100, 100);

  const out = buf.clone();
  if (brightness === 0 && contrast === 0) {
    return out;
  }

  const w = out.width;
  const h = out.height;
  const data = out.data;

  // Classic GIMP/Photoshop-style brightness offset + contrast factor
  const bOffset = (brightness / 100) * 255;
  const cScaled = (contrast / 100) * 255;
  const factor = (259 * (cScaled + 255)) / (255 * (259 - cScaled));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!maskAllows(mask, x, y)) continue;
      const idx = (y * w + x) * 4;
      if (data[idx + 3] === 0) continue;

      data[idx] = clampByte(factor * (data[idx] + bOffset - 128) + 128);
      data[idx + 1] = clampByte(factor * (data[idx + 1] + bOffset - 128) + 128);
      data[idx + 2] = clampByte(factor * (data[idx + 2] + bOffset - 128) + 128);
    }
  }

  out.markAllDirty();
  return out;
}

export function applyColorReplace(
  buf: PixelBuffer,
  opts: ColorReplaceOptions,
  mask?: PixelMask
): PixelBuffer {
  const out = buf.clone();
  const w = out.width;
  const h = out.height;
  const data = out.data;
  const tol = Math.max(0, opts.tolerance);
  const [fr, fg, fb, fa] = opts.fromRgba;
  const [tr, tg, tb, ta] = opts.toRgba;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!maskAllows(mask, x, y)) continue;
      const idx = (y * w + x) * 4;
      const dist = Math.max(
        Math.abs(data[idx] - fr),
        Math.abs(data[idx + 1] - fg),
        Math.abs(data[idx + 2] - fb),
        Math.abs(data[idx + 3] - fa)
      );
      if (dist <= tol) {
        data[idx] = tr;
        data[idx + 1] = tg;
        data[idx + 2] = tb;
        data[idx + 3] = ta;
      }
    }
  }

  out.markAllDirty();
  return out;
}

function findNearestPaletteRgb(
  r: number,
  g: number,
  b: number,
  palette: readonly RGBA[]
): RGBA {
  let best = palette[0];
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

export function applyQuantizeToPalette(
  buf: PixelBuffer,
  opts: QuantizeToPaletteOptions,
  mask?: PixelMask
): PixelBuffer {
  const out = buf.clone();
  const { palette, dither } = opts;
  if (palette.length === 0) return out;

  const w = out.width;
  const h = out.height;
  const data = out.data;

  if (dither === "none" || dither === "bayer4") {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!maskAllows(mask, x, y)) continue;
        const idx = (y * w + x) * 4;
        if (data[idx + 3] === 0) continue;

        let r = data[idx];
        let g = data[idx + 1];
        let b = data[idx + 2];

        if (dither === "bayer4") {
          const offset = (getDitherMatrixValue(x, y, "bayer4") - 0.5) * 48;
          r = clampByte(r + offset);
          g = clampByte(g + offset);
          b = clampByte(b + offset);
        }

        const matched = findNearestPaletteRgb(r, g, b, palette);
        data[idx] = matched[0];
        data[idx + 1] = matched[1];
        data[idx + 2] = matched[2];
      }
    }
    out.markAllDirty();
    return out;
  }

  // Floyd-Steinberg error diffusion across opaque, mask-allowed pixels
  const work = new Float32Array(w * h * 3);
  const eligible = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = y * w + x;
      const idx = cell * 4;
      const wIdx = cell * 3;
      work[wIdx] = data[idx];
      work[wIdx + 1] = data[idx + 1];
      work[wIdx + 2] = data[idx + 2];
      if (data[idx + 3] > 0 && maskAllows(mask, x, y)) {
        eligible[cell] = 1;
      }
    }
  }

  const distribute = (
    nx: number,
    ny: number,
    er: number,
    eg: number,
    eb: number,
    weight: number
  ): void => {
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
    const cell = ny * w + nx;
    if (eligible[cell] === 0) return;
    const wIdx = cell * 3;
    work[wIdx] = clamp(work[wIdx] + er * weight, 0, 255);
    work[wIdx + 1] = clamp(work[wIdx + 1] + eg * weight, 0, 255);
    work[wIdx + 2] = clamp(work[wIdx + 2] + eb * weight, 0, 255);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = y * w + x;
      if (eligible[cell] === 0) continue;

      const wIdx = cell * 3;
      const oldR = work[wIdx];
      const oldG = work[wIdx + 1];
      const oldB = work[wIdx + 2];

      const matched = findNearestPaletteRgb(oldR, oldG, oldB, palette);
      const idx = cell * 4;
      data[idx] = matched[0];
      data[idx + 1] = matched[1];
      data[idx + 2] = matched[2];

      const er = oldR - matched[0];
      const eg = oldG - matched[1];
      const eb = oldB - matched[2];

      distribute(x + 1, y, er, eg, eb, 7 / 16);
      distribute(x - 1, y + 1, er, eg, eb, 3 / 16);
      distribute(x, y + 1, er, eg, eb, 5 / 16);
      distribute(x + 1, y + 1, er, eg, eb, 1 / 16);
    }
  }

  out.markAllDirty();
  return out;
}

export function applyInvertFilter(
  buf: PixelBuffer,
  mask?: PixelMask
): PixelBuffer {
  const out = buf.clone();
  const w = out.width;
  const h = out.height;
  const data = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!maskAllows(mask, x, y)) continue;
      const idx = (y * w + x) * 4;
      if (data[idx + 3] === 0) continue;
      data[idx] = 255 - data[idx];
      data[idx + 1] = 255 - data[idx + 1];
      data[idx + 2] = 255 - data[idx + 2];
    }
  }

  out.markAllDirty();
  return out;
}

export function applyDesaturateFilter(
  buf: PixelBuffer,
  mask?: PixelMask
): PixelBuffer {
  const out = buf.clone();
  const w = out.width;
  const h = out.height;
  const data = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!maskAllows(mask, x, y)) continue;
      const idx = (y * w + x) * 4;
      if (data[idx + 3] === 0) continue;
      const l = clampByte(
        0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2]
      );
      data[idx] = l;
      data[idx + 1] = l;
      data[idx + 2] = l;
    }
  }

  out.markAllDirty();
  return out;
}

export function applyPixelCleanupFilter(
  buf: PixelBuffer,
  opts: PixelCleanupFilterOptions,
  mask?: PixelMask
): PixelBuffer {
  const w = buf.width;
  const h = buf.height;
  let current = buf.clone();
  if (w === 0 || h === 0) return current;

  if (opts.removeOrphans) {
    const srcData = current.data;
    const next = current.clone();
    const dstData = next.data;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!maskAllows(mask, x, y)) continue;
        const idx = (y * w + x) * 4;
        if (srcData[idx + 3] === 0) continue;

        let hasNeighbor = false;
        for (let i = 0; i < EIGHT_WAY_OFFSETS.length; i++) {
          const nx = x + EIGHT_WAY_OFFSETS[i][0];
          const ny = y + EIGHT_WAY_OFFSETS[i][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (srcData[(ny * w + nx) * 4 + 3] > 0) {
            hasNeighbor = true;
            break;
          }
        }

        if (!hasNeighbor) {
          dstData[idx] = 0;
          dstData[idx + 1] = 0;
          dstData[idx + 2] = 0;
          dstData[idx + 3] = 0;
        }
      }
    }

    next.markAllDirty();
    current = next;
  }

  if (opts.fillHoles) {
    const srcData = current.data;
    const next = current.clone();
    const dstData = next.data;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!maskAllows(mask, x, y)) continue;
        const idx = (y * w + x) * 4;
        if (srcData[idx + 3] > 0) continue;

        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let sumA = 0;
        let allOpaque = true;

        for (let i = 0; i < CARDINAL_OFFSETS.length; i++) {
          const nx = x + CARDINAL_OFFSETS[i][0];
          const ny = y + CARDINAL_OFFSETS[i][1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
            allOpaque = false;
            break;
          }
          const nIdx = (ny * w + nx) * 4;
          if (srcData[nIdx + 3] === 0) {
            allOpaque = false;
            break;
          }
          sumR += srcData[nIdx];
          sumG += srcData[nIdx + 1];
          sumB += srcData[nIdx + 2];
          sumA += srcData[nIdx + 3];
        }

        if (allOpaque) {
          dstData[idx] = Math.round(sumR / 4);
          dstData[idx + 1] = Math.round(sumG / 4);
          dstData[idx + 2] = Math.round(sumB / 4);
          dstData[idx + 3] = Math.round(sumA / 4);
        }
      }
    }

    next.markAllDirty();
    current = next;
  }

  return current;
}
