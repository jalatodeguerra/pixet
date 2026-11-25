import { PixelBuffer, hexToRgba } from "../document/PixelBuffer.ts";

export type LayerMapRole = "albedo" | "normal" | "height" | "depth" | "emission";

export interface Light2DOptions {
  enabled: boolean;
  lightX: number; // 0..1 normalized canvas X
  lightY: number; // 0..1 normalized canvas Y
  lightZ: number; // 0.05..2.0 height
  lightColor: string; // #rrggbb
  intensity: number; // 0..3
  ambient: number; // 0..1
  emissionStrength: number; // 0..2.5
  lightType?: "point" | "directional";
  ambientColor?: string;
  specularStrength?: number; // 0..2
  shininess?: number; // 4..128
  heightScale?: number; // 0..1 (relief self-shadowing)
  aoStrength?: number; // 0..1
  celSteps?: number; // 0 = smooth, 2..8 = quantized
  autoNormalIfMissing?: boolean;
}

export const DEFAULT_LIGHT_2D: Light2DOptions = {
  enabled: false,
  lightX: 0.35,
  lightY: 0.25,
  lightZ: 0.35,
  lightColor: "#fff4d6",
  intensity: 1.4,
  ambient: 0.28,
  emissionStrength: 1.2,
  lightType: "point",
  ambientColor: "#3a4664",
  specularStrength: 0.35,
  shininess: 24,
  heightScale: 0.25,
  aoStrength: 0.2,
  celSteps: 0,
  autoNormalIfMissing: true,
};

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
}

/**
 * Applies live 2D/3D point or directional lighting using optional tangent-space
 * normal (+X right, +Y up, +Z out), height/displacement map (relief self-shadowing),
 * depth map (AO), Blinn-Phong specular, cel-shading, and unlit emission layers.
 */
export function apply2DLighting(
  albedo: Uint8ClampedArray,
  normal: Uint8ClampedArray | null,
  emission: Uint8ClampedArray | null,
  width: number,
  height: number,
  opts: Light2DOptions,
  heightMap: Uint8ClampedArray | null = null,
  depthMap: Uint8ClampedArray | null = null
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(albedo.length);
  if (!opts.enabled) {
    out.set(albedo);
    return out;
  }

  const [lr, lg, lb] = hexToRgba(opts.lightColor);
  const lightR = lr / 255;
  const lightG = lg / 255;
  const lightB = lb / 255;

  let ambR = 1;
  let ambG = 1;
  let ambB = 1;
  if (opts.ambientColor) {
    const [ar, ag, ab] = hexToRgba(opts.ambientColor);
    ambR = ar / 255;
    ambG = ag / 255;
    ambB = ab / 255;
  }

  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const isDirectional = opts.lightType === "directional";
  const specStrength = Math.max(0, opts.specularStrength ?? 0);
  const shininess = Math.max(4, Math.min(128, opts.shininess ?? 24));
  const heightScale = Math.max(0, Math.min(1, opts.heightScale ?? 0));
  const aoStrength = Math.max(0, Math.min(1, opts.aoStrength ?? 0));
  const celSteps = opts.celSteps && opts.celSteps >= 2 ? Math.round(opts.celSteps) : 0;
  const autoNormal = opts.autoNormalIfMissing === true && !normal;

  const sampleHeightVal = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    const i = (y * width + x) * 4;
    if (heightMap && heightMap[i + 3] > 0) {
      return (
        ((0.2126 * heightMap[i] +
          0.7152 * heightMap[i + 1] +
          0.0722 * heightMap[i + 2]) /
          255) *
        (heightMap[i + 3] / 255)
      );
    }
    const a = albedo[i + 3];
    if (a === 0) return 0;
    const lum =
      (0.299 * albedo[i] + 0.587 * albedo[i + 1] + 0.114 * albedo[i + 2]) / 255;
    return (0.35 + 0.65 * lum) * (a / 255);
  };

  // Precompute directional light vector if in directional mode
  let dirLx = 0;
  let dirLy = 0;
  let dirLz = 1;
  if (isDirectional) {
    const dx = opts.lightX - 0.5;
    const dyUp = 0.5 - opts.lightY;
    const dz = Math.max(0.05, opts.lightZ);
    const inv = 1 / Math.hypot(dx, dyUp, dz);
    dirLx = dx * inv;
    dirLy = dyUp * inv;
    dirLz = dz * inv;
  }

  for (let y = 0; y < height; y++) {
    const py = (y + 0.5) / safeH;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = albedo[idx + 3];
      const ea = emission ? emission[idx + 3] : 0;

      if (alpha === 0 && ea === 0) continue;

      let nx = 0;
      let ny = 0;
      let nz = 1;
      if (normal && normal[idx + 3] > 0) {
        const rx = (normal[idx] / 255) * 2 - 1;
        const ry = (normal[idx + 1] / 255) * 2 - 1;
        const rz = (normal[idx + 2] / 255) * 2 - 1;
        const nLen = Math.hypot(rx, ry, rz);
        if (nLen > 1e-4) {
          nx = rx / nLen;
          ny = ry / nLen;
          nz = rz / nLen;
        }
      } else if (autoNormal) {
        const tl = sampleHeightVal(x - 1, y - 1);
        const t = sampleHeightVal(x, y - 1);
        const tr = sampleHeightVal(x + 1, y - 1);
        const l = sampleHeightVal(x - 1, y);
        const r = sampleHeightVal(x + 1, y);
        const bl = sampleHeightVal(x - 1, y + 1);
        const b = sampleHeightVal(x, y + 1);
        const br = sampleHeightVal(x + 1, y + 1);
        const gx = tr + 2 * r + br - (tl + 2 * l + bl);
        const gy = bl + 2 * b + br - (tl + 2 * t + tr);
        const ax = -gx;
        const ay = gy;
        const az = 0.45;
        const inv = 1 / Math.hypot(ax, ay, az);
        nx = ax * inv;
        ny = ay * inv;
        nz = az * inv;
      }

      let lx: number;
      let ly: number;
      let lz: number;
      let atten = 1;

      if (isDirectional) {
        lx = dirLx;
        ly = dirLy;
        lz = dirLz;
      } else {
        const px = (x + 0.5) / safeW;
        const dx = opts.lightX - px;
        // OpenGL/Godot normal map +Y points up (-Y in canvas coords)
        const dyUp = py - opts.lightY;
        const dz = Math.max(0.05, opts.lightZ);
        const distSq = dx * dx + dyUp * dyUp + dz * dz;
        const invLen = 1 / Math.sqrt(distSq);
        lx = dx * invLen;
        ly = dyUp * invLen;
        lz = dz * invLen;
        atten = 1 / (1 + (dx * dx + dyUp * dyUp) * 1.5);
      }

      let ndotl = Math.max(0, nx * lx + ny * ly + nz * lz);
      if (celSteps >= 2) {
        ndotl = Math.round(ndotl * (celSteps - 1)) / (celSteps - 1);
      }

      // Lightweight 4-step heightfield raymarch for relief self-shadowing
      let shadow = 1;
      if (heightMap && heightScale > 0 && ndotl > 0.01) {
        const h0 = sampleHeightVal(x, y);
        const stepX = lx * 1.5;
        const stepY = -ly * 1.5;
        const stepZ = (lz / Math.max(0.15, heightScale)) * 0.12;
        for (let s = 1; s <= 4; s++) {
          const sx = Math.round(x + stepX * s);
          const sy = Math.round(y + stepY * s);
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) break;
          const sh = sampleHeightVal(sx, sy);
          if (sh > h0 + stepZ * s + 0.04) {
            shadow *= 0.72;
          }
        }
      }

      const direct = ndotl * opts.intensity * atten * shadow;

      // Blinn-Phong specular (V = (0, 0, 1))
      let spec = 0;
      if (specStrength > 0 && ndotl > 0) {
        const hx = lx;
        const hy = ly;
        const hz = lz + 1;
        const hInv = 1 / Math.hypot(hx, hy, hz);
        const ndoth = Math.max(0, (nx * hx + ny * hy + nz * hz) * hInv);
        spec = Math.pow(ndoth, shininess) * specStrength * opts.intensity * atten * shadow;
      }

      // Ambient occlusion from depth or height map
      let ao = 1;
      if (aoStrength > 0) {
        let aoSample = 1;
        if (depthMap && depthMap[idx + 3] > 0) {
          aoSample =
            (0.2126 * depthMap[idx] +
              0.7152 * depthMap[idx + 1] +
              0.0722 * depthMap[idx + 2]) /
            255;
        } else if (heightMap && heightMap[idx + 3] > 0) {
          aoSample = sampleHeightVal(x, y);
        }
        ao = 1 - aoStrength * (1 - aoSample);
      }

      const emFactor = ea > 0 ? (ea / 255) * opts.emissionStrength : 0;
      const er = emission ? emission[idx] * emFactor : 0;
      const eg = emission ? emission[idx + 1] * emFactor : 0;
      const eb = emission ? emission[idx + 2] * emFactor : 0;

      const ambTerm = opts.ambient * ao;
      out[idx] = clampByte(
        albedo[idx] * (ambTerm * ambR + lightR * direct) + lr * spec + er
      );
      out[idx + 1] = clampByte(
        albedo[idx + 1] * (ambTerm * ambG + lightG * direct) + lg * spec + eg
      );
      out[idx + 2] = clampByte(
        albedo[idx + 2] * (ambTerm * ambB + lightB * direct) + lb * spec + eb
      );
      out[idx + 3] = alpha > 0 ? alpha : ea;
    }
  }

  return out;
}

/**
 * Generates an OpenGL/Godot tangent-space normal map (+X right, +Y up, +Z out)
 * from an albedo buffer's Sobel height/luminance gradient.
 */
export function generateAutoNormalMap(
  albedo: PixelBuffer,
  strength = 2.0
): PixelBuffer {
  const w = albedo.width;
  const h = albedo.height;
  const src = albedo.data;
  const out = new PixelBuffer(w, h);

  const sampleHeight = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    const idx = (y * w + x) * 4;
    const a = src[idx + 3];
    if (a === 0) return 0;
    const lum =
      (0.299 * src[idx] + 0.587 * src[idx + 1] + 0.114 * src[idx + 2]) / 255;
    return (0.35 + 0.65 * lum) * (a / 255);
  };

  const zBase = 1 / Math.max(0.1, strength);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (src[idx + 3] === 0) continue;

      const tl = sampleHeight(x - 1, y - 1);
      const t = sampleHeight(x, y - 1);
      const tr = sampleHeight(x + 1, y - 1);
      const l = sampleHeight(x - 1, y);
      const r = sampleHeight(x + 1, y);
      const bl = sampleHeight(x - 1, y + 1);
      const b = sampleHeight(x, y + 1);
      const br = sampleHeight(x + 1, y + 1);

      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);

      const nx = -gx;
      const nyUp = gy;
      const nz = zBase;
      const invLen = 1 / Math.hypot(nx, nyUp, nz);

      out.setPixel(
        x,
        y,
        clampByte((nx * invLen * 0.5 + 0.5) * 255),
        clampByte((nyUp * invLen * 0.5 + 0.5) * 255),
        clampByte((nz * invLen * 0.5 + 0.5) * 255),
        255
      );
    }
  }

  out.markAllDirty();
  return out;
}

/**
 * Remaps opaque pixel colors present in `sourcePalette` to the corresponding
 * index in `targetPalette`, preserving per-pixel alpha.
 */
export function applyPaletteSwapLut(
  rgba: Uint8ClampedArray,
  sourcePalette: readonly string[],
  targetPalette: readonly string[]
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  if (sourcePalette.length === 0 || targetPalette.length === 0) {
    return out;
  }

  const lut = new Map<number, [number, number, number]>();
  for (let i = 0; i < sourcePalette.length; i++) {
    const [sr, sg, sb] = hexToRgba(sourcePalette[i]);
    const [tr, tg, tb] = hexToRgba(targetPalette[i % targetPalette.length]);
    const packed = (sr << 16) | (sg << 8) | sb;
    lut.set(packed, [tr, tg, tb]);
  }

  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] === 0) continue;
    const key = (out[i] << 16) | (out[i + 1] << 8) | out[i + 2];
    const mapped = lut.get(key);
    if (mapped) {
      out[i] = mapped[0];
      out[i + 1] = mapped[1];
      out[i + 2] = mapped[2];
    }
  }

  return out;
}
