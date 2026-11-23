export type BlendMode =
  | "Normal"
  | "Multiply"
  | "Screen"
  | "Overlay"
  | "Add"
  | "Darken"
  | "Lighten"
  | "ColorDodge"
  | "ColorBurn"
  | "HardLight"
  | "SoftLight"
  | "Difference"
  | "Hue"
  | "Saturation"
  | "Color"
  | "Luminosity";

export const ALL_BLEND_MODES: readonly BlendMode[] = [
  "Normal",
  "Multiply",
  "Screen",
  "Overlay",
  "Add",
  "Darken",
  "Lighten",
  "ColorDodge",
  "ColorBurn",
  "HardLight",
  "SoftLight",
  "Difference",
  "Hue",
  "Saturation",
  "Color",
  "Luminosity",
] as const;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function hardLightChannel(cb: number, cs: number): number {
  return cs <= 0.5 ? cb * (2 * cs) : 1 - (1 - cb) * (2 * (1 - cs));
}

function colorDodgeChannel(cb: number, cs: number): number {
  if (cb === 0) return 0;
  if (cs >= 1) return 1;
  return Math.min(1, cb / (1 - cs));
}

function colorBurnChannel(cb: number, cs: number): number {
  if (cb === 1) return 1;
  if (cs <= 0) return 0;
  return 1 - Math.min(1, (1 - cb) / cs);
}

function softLightChannel(cb: number, cs: number): number {
  if (cs <= 0.5) {
    return cb - (1 - 2 * cs) * cb * (1 - cb);
  }
  const d =
    cb <= 0.25
      ? ((16 * cb - 12) * cb + 4) * cb
      : Math.sqrt(cb);
  return cb + (2 * cs - 1) * (d - cb);
}

function lum(r: number, g: number, b: number): number {
  return 0.3 * r + 0.59 * g + 0.11 * b;
}

function clipColor(r: number, g: number, b: number): [number, number, number] {
  const l = lum(r, g, b);
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  let cr = r;
  let cg = g;
  let cb = b;
  if (n < 0) {
    const denom = l - n;
    if (denom > 0) {
      cr = l + ((cr - l) * l) / denom;
      cg = l + ((cg - l) * l) / denom;
      cb = l + ((cb - l) * l) / denom;
    } else {
      cr = l;
      cg = l;
      cb = l;
    }
  }
  if (x > 1) {
    const denom = x - l;
    if (denom > 0) {
      cr = l + ((cr - l) * (1 - l)) / denom;
      cg = l + ((cg - l) * (1 - l)) / denom;
      cb = l + ((cb - l) * (1 - l)) / denom;
    } else {
      cr = l;
      cg = l;
      cb = l;
    }
  }
  return [clamp01(cr), clamp01(cg), clamp01(cb)];
}

function setLum(
  r: number,
  g: number,
  b: number,
  targetL: number
): [number, number, number] {
  const d = targetL - lum(r, g, b);
  return clipColor(r + d, g + d, b + d);
}

function sat(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function setSat(
  r: number,
  g: number,
  b: number,
  s: number
): [number, number, number] {
  const c = [r, g, b];
  let minIdx = 0;
  let midIdx = 1;
  let maxIdx = 2;
  if (c[minIdx] > c[midIdx]) [minIdx, midIdx] = [midIdx, minIdx];
  if (c[midIdx] > c[maxIdx]) [midIdx, maxIdx] = [maxIdx, midIdx];
  if (c[minIdx] > c[midIdx]) [minIdx, midIdx] = [midIdx, minIdx];

  const out: [number, number, number] = [0, 0, 0];
  if (c[maxIdx] > c[minIdx]) {
    out[midIdx] = ((c[midIdx] - c[minIdx]) * s) / (c[maxIdx] - c[minIdx]);
    out[maxIdx] = s;
  } else {
    out[midIdx] = 0;
    out[maxIdx] = 0;
  }
  out[minIdx] = 0;
  return out;
}

export function blendRgb(
  dr: number,
  dg: number,
  db: number,
  sr: number,
  sg: number,
  sb: number,
  mode: BlendMode
): [number, number, number] {
  switch (mode) {
    case "Normal":
      return [sr, sg, sb];
    case "Multiply":
      return [dr * sr, dg * sg, db * sb];
    case "Screen":
      return [
        1 - (1 - dr) * (1 - sr),
        1 - (1 - dg) * (1 - sg),
        1 - (1 - db) * (1 - sb),
      ];
    case "Overlay":
      return [
        hardLightChannel(sr, dr),
        hardLightChannel(sg, dg),
        hardLightChannel(sb, db),
      ];
    case "Add":
      return [
        Math.min(1, dr + sr),
        Math.min(1, dg + sg),
        Math.min(1, db + sb),
      ];
    case "Darken":
      return [Math.min(dr, sr), Math.min(dg, sg), Math.min(db, sb)];
    case "Lighten":
      return [Math.max(dr, sr), Math.max(dg, sg), Math.max(db, sb)];
    case "ColorDodge":
      return [
        colorDodgeChannel(dr, sr),
        colorDodgeChannel(dg, sg),
        colorDodgeChannel(db, sb),
      ];
    case "ColorBurn":
      return [
        colorBurnChannel(dr, sr),
        colorBurnChannel(dg, sg),
        colorBurnChannel(db, sb),
      ];
    case "HardLight":
      return [
        hardLightChannel(dr, sr),
        hardLightChannel(dg, sg),
        hardLightChannel(db, sb),
      ];
    case "SoftLight":
      return [
        softLightChannel(dr, sr),
        softLightChannel(dg, sg),
        softLightChannel(db, sb),
      ];
    case "Difference":
      return [Math.abs(dr - sr), Math.abs(dg - sg), Math.abs(db - sb)];
    case "Hue": {
      const [hr, hg, hb] = setSat(sr, sg, sb, sat(dr, dg, db));
      return setLum(hr, hg, hb, lum(dr, dg, db));
    }
    case "Saturation": {
      const [sr2, sg2, sb2] = setSat(dr, dg, db, sat(sr, sg, sb));
      return setLum(sr2, sg2, sb2, lum(dr, dg, db));
    }
    case "Color":
      return setLum(sr, sg, sb, lum(dr, dg, db));
    case "Luminosity":
      return setLum(dr, dg, db, lum(sr, sg, sb));
  }
}
