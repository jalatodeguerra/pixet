interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function isValidHex(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const toByte = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
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
  return { h: (h / 6) * 360, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hn = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, hn + 1 / 3) * 255,
    g: hue2rgb(p, q, hn) * 255,
    b: hue2rgb(p, q, hn - 1 / 3) * 255,
  };
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  if (!isValidHex(hex)) return { h: 0, s: 0, v: 0 };
  const { r, g, b } = hexToRgb(hex);
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
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return { h: Math.round(h), s: Math.round(s), v: Math.round(v) };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const hn = ((h % 360) + 360) % 360;
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const vn = Math.max(0, Math.min(100, v)) / 100;

  const c = vn * sn;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = vn - c;

  let rn = 0;
  let gn = 0;
  let bn = 0;
  if (hn < 60) {
    rn = c; gn = x; bn = 0;
  } else if (hn < 120) {
    rn = x; gn = c; bn = 0;
  } else if (hn < 180) {
    rn = 0; gn = c; bn = x;
  } else if (hn < 240) {
    rn = 0; gn = x; bn = c;
  } else if (hn < 300) {
    rn = x; gn = 0; bn = c;
  } else {
    rn = c; gn = 0; bn = x;
  }

  return rgbToHex({
    r: (rn + m) * 255,
    g: (gn + m) * 255,
    b: (bn + m) * 255,
  });
}

/**
 * Generates a 5-step hue-shifted pixel-art shading ramp centered on `baseHex`.
 * Darker shadows shift toward cool blues/purples; highlights shift toward warm yellows.
 */
export function buildShadingRamp(baseHex: string): string[] {
  if (!isValidHex(baseHex)) {
    return ["#1f2647", "#3a4f96", "#5b8cff", "#8eb8ff", "#d4ecff"];
  }
  const base = rgbToHsl(hexToRgb(baseHex));
  const steps = [-2, -1, 0, 1, 2];

  return steps.map((step) => {
    if (step === 0) return baseHex.toLowerCase();
    // Shift hue subtly toward purple/blue (240) in shadows, yellow (55) in highlights
    const targetHue = step < 0 ? 240 : 55;
    const hueDiff = ((targetHue - base.h + 540) % 360) - 180;
    const h = base.h + hueDiff * Math.abs(step) * 0.14;
    const s = Math.max(0.08, Math.min(0.95, base.s + (step < 0 ? 0.06 : -0.04) * Math.abs(step)));
    const l = Math.max(0.08, Math.min(0.94, base.l + step * 0.14));
    return rgbToHex(hslToRgb({ h, s, l }));
  });
}
