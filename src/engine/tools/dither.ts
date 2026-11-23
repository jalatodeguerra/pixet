export type DitherPattern =
  | "bayer2"
  | "bayer4"
  | "bayer8"
  | "checker"
  | "diagL"
  | "diagR"
  | "dots";

const BAYER_2X2: readonly (readonly number[])[] = [
  [0, 2],
  [3, 1],
];

const BAYER_4X4: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

const BAYER_8X8: readonly (readonly number[])[] = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

// 2x2 checkerboard threshold matrix (normalized by 2)
const CHECKER_2X2: readonly (readonly number[])[] = [
  [0, 1],
  [1, 0],
];

// 4x4 diagonal lines '\' (x - y mod 4)
const DIAG_L_4X4: readonly (readonly number[])[] = [
  [0, 1, 2, 3],
  [3, 0, 1, 2],
  [2, 3, 0, 1],
  [1, 2, 3, 0],
];

// 4x4 diagonal lines '/' (x + y mod 4)
const DIAG_R_4X4: readonly (readonly number[])[] = [
  [0, 1, 2, 3],
  [1, 2, 3, 0],
  [2, 3, 0, 1],
  [3, 0, 1, 2],
];

// 4x4 halftone-style radial dots matrix (normalized by 16)
const DOTS_4X4: readonly (readonly number[])[] = [
  [0, 4, 12, 5],
  [6, 10, 14, 11],
  [13, 15, 8, 7],
  [9, 3, 2, 1],
];

function posMod(n: number, m: number): number {
  const f = Math.floor(n);
  return ((f % m) + m) % m;
}

export function getDitherMatrixValue(
  x: number,
  y: number,
  pattern: DitherPattern
): number {
  switch (pattern) {
    case "bayer2": {
      const mx = posMod(x, 2);
      const my = posMod(y, 2);
      return BAYER_2X2[my][mx] / 4;
    }
    case "bayer4": {
      const mx = posMod(x, 4);
      const my = posMod(y, 4);
      return BAYER_4X4[my][mx] / 16;
    }
    case "bayer8": {
      const mx = posMod(x, 8);
      const my = posMod(y, 8);
      return BAYER_8X8[my][mx] / 64;
    }
    case "checker": {
      const mx = posMod(x, 2);
      const my = posMod(y, 2);
      return CHECKER_2X2[my][mx] / 2;
    }
    case "diagL": {
      const mx = posMod(x, 4);
      const my = posMod(y, 4);
      return DIAG_L_4X4[my][mx] / 4;
    }
    case "diagR": {
      const mx = posMod(x, 4);
      const my = posMod(y, 4);
      return DIAG_R_4X4[my][mx] / 4;
    }
    case "dots": {
      const mx = posMod(x, 4);
      const my = posMod(y, 4);
      return DOTS_4X4[my][mx] / 16;
    }
  }
}

export function shouldPlotDither(
  x: number,
  y: number,
  threshold01: number,
  pattern: DitherPattern
): boolean {
  if (threshold01 <= 0) return false;
  if (threshold01 >= 1) return true;
  return getDitherMatrixValue(x, y, pattern) < threshold01;
}
