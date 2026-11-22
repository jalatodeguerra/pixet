import { PixelBuffer, type RGBA } from "../document/PixelBuffer.ts";

export type Rotate3DMode = "extruded" | "stack";
export type SpinAxis = "yaw" | "pitch" | "roll";

export interface Rotate25DOptions {
  pitchDeg: number;
  yawDeg: number;
  rollDeg: number;
  extrudeDepth: number;
  perspective: number;
  shadeDepth: boolean;
  supersample: boolean;
  outlineColor: RGBA | null;
}

export interface SpriteStackOptions {
  yawDeg: number;
  pitchDeg: number;
  sliceSpacing: number;
  depthShading: boolean;
  outlineColor: RGBA | null;
}

export interface BakeTurntableOptions {
  mode: Rotate3DMode;
  frameCount: number;
  spinAxis: SpinAxis;
  source?: PixelBuffer;
  slices?: readonly PixelBuffer[];
  opts25d: Rotate25DOptions;
  optsStack: SpriteStackOptions;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Adds a 1-pixel 4-connected outline around opaque pixels in `src`.
 */
export function applyPixelOutline(src: PixelBuffer, color: RGBA): PixelBuffer {
  const out = src.clone();
  const w = src.width;
  const h = src.height;
  const srcData = src.data;
  const outData = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (srcData[idx + 3] > 0) continue;

      const hasNeighbor =
        (x > 0 && srcData[idx - 4 + 3] > 0) ||
        (x + 1 < w && srcData[idx + 4 + 3] > 0) ||
        (y > 0 && srcData[idx - w * 4 + 3] > 0) ||
        (y + 1 < h && srcData[idx + w * 4 + 3] > 0);

      if (hasNeighbor) {
        outData[idx] = color[0];
        outData[idx + 1] = color[1];
        outData[idx + 2] = color[2];
        outData[idx + 3] = color[3];
      }
    }
  }

  out.markAllDirty();
  return out;
}

interface HitSample {
  r: number;
  g: number;
  b: number;
  a: number;
  t: number;
}

/**
 * Renders a 2D sprite rotated in 3D (Pitch X, Yaw Y, Roll Z) with optional
 * Z-extrusion depth, perspective projection, depth shading, and 1px outline.
 */
export function render25DSprite(
  src: PixelBuffer,
  opts: Rotate25DOptions
): PixelBuffer {
  const w = src.width;
  const h = src.height;
  const out = new PixelBuffer(w, h);
  if (w === 0 || h === 0) return out;

  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  const yaw = degToRad(opts.yawDeg);
  const pitch = degToRad(opts.pitchDeg);
  const roll = degToRad(opts.rollDeg);

  const cyaw = Math.cos(yaw);
  const syaw = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);

  // R = Rz(roll) * Rx(pitch) * Ry(yaw)
  // Compute A = Rx * Ry first
  const a00 = cyaw;
  const a01 = 0;
  const a02 = syaw;
  const a10 = sp * syaw;
  const a11 = cp;
  const a12 = -sp * cyaw;
  const a20 = -cp * syaw;
  const a21 = sp;
  const a22 = cp * cyaw;

  // Compute R = Rz * A (only rows needed; R^T uses columns of R)
  const r00 = cr * a00 - sr * a10;
  const r01 = cr * a01 - sr * a11;
  const r02 = cr * a02 - sr * a12;
  const r10 = sr * a00 + cr * a10;
  const r11 = sr * a01 + cr * a11;
  const r12 = sr * a02 + cr * a12;
  const r20 = a20;
  const r21 = a21;
  const r22 = a22;

  const persp = Math.max(0, Math.min(1, opts.perspective));
  const usePersp = persp > 0.001;
  const maxDim = Math.max(w, h);
  const camDist = usePersp ? maxDim * (2.6 - 1.5 * persp) : maxDim * 4;

  const depth = Math.max(0, Math.min(16, Math.round(opts.extrudeDepth)));
  const sliceValues: number[] = [];
  if (depth === 0) {
    sliceValues.push(0);
  } else {
    const half = depth / 2;
    const steps = Math.max(1, Math.round(depth * 2));
    for (let i = 0; i <= steps; i++) {
      sliceValues.push(-half + (i / steps) * depth);
    }
  }

  const subOffsets = opts.supersample ? [-0.25, 0.25] : [0];
  const srcData = src.data;
  const outData = out.data;
  const numSlices = sliceValues.length;

  const traceSubRay = (px: number, py: number): HitSample | null => {
    const sx = px - cx;
    const sy = py - cy;

    let worldOx: number;
    let worldOy: number;
    let worldOz: number;
    let worldDx: number;
    let worldDy: number;
    let worldDz: number;

    if (usePersp) {
      worldOx = 0;
      worldOy = 0;
      worldOz = camDist;
      worldDx = sx;
      worldDy = sy;
      worldDz = -camDist;
    } else {
      worldOx = sx;
      worldOy = sy;
      worldOz = camDist;
      worldDx = 0;
      worldDy = 0;
      worldDz = -1;
    }

    // Transform into local sprite space via R^T
    const ox = r00 * worldOx + r10 * worldOy + r20 * worldOz;
    const oy = r01 * worldOx + r11 * worldOy + r21 * worldOz;
    const oz = r02 * worldOx + r12 * worldOy + r22 * worldOz;

    const dx = r00 * worldDx + r10 * worldDy + r20 * worldDz;
    const dy = r01 * worldDx + r11 * worldDy + r21 * worldDz;
    const dz = r02 * worldDx + r12 * worldDy + r22 * worldDz;

    if (Math.abs(dz) < 1e-5) return null;

    const frontToBack = dz < 0;
    for (let s = 0; s < numSlices; s++) {
      const sliceIdx = frontToBack ? numSlices - 1 - s : s;
      const zSlice = sliceValues[sliceIdx];
      const t = (zSlice - oz) / dz;
      if (t <= 0) continue;

      const u = Math.round(ox + t * dx + cx);
      const v = Math.round(oy + t * dy + cy);
      if (u < 0 || v < 0 || u >= w || v >= h) continue;

      const sIdx = (v * w + u) * 4;
      const alpha = srcData[sIdx + 3];
      if (alpha === 0) continue;

      let shade = 1;
      if (opts.shadeDepth && depth > 0 && s > 0) {
        const depthT = 1 - s / Math.max(1, numSlices - 1);
        shade = 0.62 + 0.26 * depthT;
      }

      return {
        r: clampByte(srcData[sIdx] * shade),
        g: clampByte(srcData[sIdx + 1] * shade),
        b: clampByte(srcData[sIdx + 2] * shade),
        a: alpha,
        t,
      };
    }

    return null;
  };

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      let bestHit: HitSample | null = null;
      for (const oy of subOffsets) {
        for (const ox of subOffsets) {
          const hit = traceSubRay(px + ox, py + oy);
          if (hit && (!bestHit || hit.t < bestHit.t)) {
            bestHit = hit;
          }
        }
      }

      if (bestHit) {
        const oIdx = (py * w + px) * 4;
        outData[oIdx] = bestHit.r;
        outData[oIdx + 1] = bestHit.g;
        outData[oIdx + 2] = bestHit.b;
        outData[oIdx + 3] = bestHit.a;
      }
    }
  }

  out.markAllDirty();
  return opts.outlineColor ? applyPixelOutline(out, opts.outlineColor) : out;
}

/**
 * Renders a stack of 2D horizontal slice layers (`slices[0]` = bottom,
 * `slices[n-1]` = top) rotated by yaw and tilted by pitch.
 */
export function renderSpriteStack(
  slices: readonly PixelBuffer[],
  opts: SpriteStackOptions
): PixelBuffer {
  if (slices.length === 0) {
    return new PixelBuffer(1, 1);
  }

  const w = slices[0].width;
  const h = slices[0].height;
  const out = new PixelBuffer(w, h);
  if (w === 0 || h === 0) return out;

  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  const yaw = degToRad(opts.yawDeg);
  const pitch = degToRad(Math.max(0, Math.min(80, opts.pitchDeg)));
  const cyaw = Math.cos(yaw);
  const syaw = Math.sin(yaw);
  const tiltScale = Math.max(0.15, Math.cos(pitch));
  const sliceSpacing = Math.max(0.25, Math.min(4, opts.sliceSpacing));
  const zLift = Math.sin(pitch) * sliceSpacing;
  const midZ = (slices.length - 1) / 2;
  const subSteps = Math.max(1, Math.ceil(sliceSpacing));

  const outData = out.data;
  const maxSliceIdx = Math.max(1, slices.length - 1);

  for (let sIdx = 0; sIdx < slices.length; sIdx++) {
    const slice = slices[sIdx];
    const sw = slice.width;
    const sh = slice.height;
    const scx = (sw - 1) / 2;
    const scy = (sh - 1) / 2;
    const srcData = slice.data;

    const shade = opts.depthShading
      ? 0.72 + 0.28 * (sIdx / maxSliceIdx)
      : 1;

    for (let sub = 0; sub < subSteps; sub++) {
      const zPos = sIdx + sub / subSteps;
      const yShift = (zPos - midZ) * zLift;

      for (let py = 0; py < h; py++) {
        const sy = (py - cy + yShift) / tiltScale;
        for (let px = 0; px < w; px++) {
          const sx = px - cx;
          // Inverse rotate by -yaw
          const u = Math.round(sx * cyaw + sy * syaw + scx);
          const v = Math.round(-sx * syaw + sy * cyaw + scy);
          if (u < 0 || v < 0 || u >= sw || v >= sh) continue;

          const pIdx = (v * sw + u) * 4;
          const alpha = srcData[pIdx + 3];
          if (alpha === 0) continue;

          const oIdx = (py * w + px) * 4;
          outData[oIdx] = clampByte(srcData[pIdx] * shade);
          outData[oIdx + 1] = clampByte(srcData[pIdx + 1] * shade);
          outData[oIdx + 2] = clampByte(srcData[pIdx + 2] * shade);
          outData[oIdx + 3] = alpha;
        }
      }
    }
  }

  out.markAllDirty();
  return opts.outlineColor ? applyPixelOutline(out, opts.outlineColor) : out;
}

/**
 * Generates an N-frame 360-degree turntable sequence for either 2.5D Extruded
 * or Sprite Stacking mode.
 */
export function bakeTurntableFrames(
  options: BakeTurntableOptions
): PixelBuffer[] {
  const count = Math.max(2, Math.min(32, Math.round(options.frameCount)));
  const frames: PixelBuffer[] = [];

  for (let i = 0; i < count; i++) {
    const stepDeg = (i / count) * 360;
    if (options.mode === "stack") {
      const slices = options.slices ?? [];
      frames.push(
        renderSpriteStack(slices, {
          ...options.optsStack,
          yawDeg: options.optsStack.yawDeg + stepDeg,
        })
      );
    } else {
      const src = options.source ?? new PixelBuffer(1, 1);
      const nextOpts: Rotate25DOptions = {
        ...options.opts25d,
        yawDeg:
          options.spinAxis === "yaw"
            ? options.opts25d.yawDeg + stepDeg
            : options.opts25d.yawDeg,
        pitchDeg:
          options.spinAxis === "pitch"
            ? options.opts25d.pitchDeg + stepDeg
            : options.opts25d.pitchDeg,
        rollDeg:
          options.spinAxis === "roll"
            ? options.opts25d.rollDeg + stepDeg
            : options.opts25d.rollDeg,
      };
      frames.push(render25DSprite(src, nextOpts));
    }
  }

  return frames;
}
