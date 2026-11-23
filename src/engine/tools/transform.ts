import { PixelBuffer } from "../document/PixelBuffer.ts";
import { scale2xEPX } from "./rotsprite.ts";

export type TransformAlgorithm = "nearest" | "rotsprite" | "scale2x";

export interface TransformState {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  skewX: number;
  skewY: number;
  pivotX: number;
  pivotY: number;
  algorithm: TransformAlgorithm;
}

export interface TransformResult {
  buffer: PixelBuffer;
  offsetX: number;
  offsetY: number;
}

function isRightAngleDeg(deg: number): boolean {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return (
    Math.abs(a) < 1e-6 ||
    Math.abs(a - 90) < 1e-6 ||
    Math.abs(a + 90) < 1e-6 ||
    Math.abs(Math.abs(a) - 180) < 1e-6
  );
}

/**
 * Applies a 2D affine Free Transform around `(pivotX, pivotY)` in local source coordinates:
 * translate(-pivot) -> scale(scaleX, scaleY) -> skew(skewX, skewY) -> rotate(rotationDeg) -> translate(+pivot + (x, y)).
 */
export function applyFreeTransform(
  src: PixelBuffer,
  state: TransformState
): TransformResult {
  const {
    x,
    y,
    scaleX,
    scaleY,
    rotationDeg,
    skewX,
    skewY,
    algorithm,
  } = state;

  if (
    src.width === 0 ||
    src.height === 0 ||
    (scaleX === 1 &&
      scaleY === 1 &&
      Math.abs(rotationDeg) < 1e-6 &&
      Math.abs(skewX) < 1e-6 &&
      Math.abs(skewY) < 1e-6)
  ) {
    return {
      buffer: src.clone(),
      offsetX: Math.round(x),
      offsetY: Math.round(y),
    };
  }

  const px = Number.isFinite(state.pivotX) ? state.pivotX : src.width / 2;
  const py = Number.isFinite(state.pivotY) ? state.pivotY : src.height / 2;

  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Linear matrix M = R(rotationDeg) * Skew(skewX, skewY) * Scale(scaleX, scaleY)
  const kxx = scaleX;
  const kxy = skewX * scaleY;
  const kyx = skewY * scaleX;
  const kyy = scaleY;

  const a = cos * kxx - sin * kyx;
  const b = cos * kxy - sin * kyy;
  const c = sin * kxx + cos * kyx;
  const d = sin * kxy + cos * kyy;

  const tx = px + x;
  const ty = py + y;

  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) {
    return {
      buffer: new PixelBuffer(1, 1),
      offsetX: Math.round(tx),
      offsetY: Math.round(ty),
    };
  }

  // Transform 4 source corners to compute integer bounding box
  const cornersX = [0, src.width, src.width, 0];
  const cornersY = [0, 0, src.height, src.height];
  let minCornerX = Infinity;
  let minCornerY = Infinity;
  let maxCornerX = -Infinity;
  let maxCornerY = -Infinity;

  for (let i = 0; i < 4; i++) {
    const lx = cornersX[i] - px;
    const ly = cornersY[i] - py;
    const wx = a * lx + b * ly + tx;
    const wy = c * lx + d * ly + ty;
    if (wx < minCornerX) minCornerX = wx;
    if (wx > maxCornerX) maxCornerX = wx;
    if (wy < minCornerY) minCornerY = wy;
    if (wy > maxCornerY) maxCornerY = wy;
  }

  const minX = Math.floor(minCornerX + 1e-9);
  const minY = Math.floor(minCornerY + 1e-9);
  const maxX = Math.ceil(maxCornerX - 1e-9);
  const maxY = Math.ceil(maxCornerY - 1e-9);

  const outW = Math.max(1, maxX - minX);
  const outH = Math.max(1, maxY - minY);

  // Choose pre-upscale factor according to resampling algorithm
  let sampleBuf = src;
  let upFactor = 1;

  const pureRightAngleUnit =
    Math.abs(scaleX) === 1 &&
    Math.abs(scaleY) === 1 &&
    Math.abs(skewX) < 1e-6 &&
    Math.abs(skewY) < 1e-6 &&
    isRightAngleDeg(rotationDeg);

  if (algorithm === "rotsprite" && !pureRightAngleUnit) {
    sampleBuf = scale2xEPX(scale2xEPX(src));
    upFactor = 4;
  } else if (
    algorithm === "scale2x" &&
    !pureRightAngleUnit &&
    (Math.abs(scaleX) > 1 ||
      Math.abs(scaleY) > 1 ||
      Math.abs(rotationDeg) >= 1e-6 ||
      Math.abs(skewX) >= 1e-6 ||
      Math.abs(skewY) >= 1e-6)
  ) {
    sampleBuf = scale2xEPX(src);
    upFactor = 2;
  }

  const invA = d / det;
  const invB = -b / det;
  const invC = -c / det;
  const invD = a / det;

  const out = new PixelBuffer(outW, outH);
  const sData = sampleBuf.data;
  const oData = out.data;
  const upW = sampleBuf.width;
  const upH = sampleBuf.height;
  const srcW = src.width;
  const srcH = src.height;

  for (let by = 0; by < outH; by++) {
    const wy = minY + by + 0.5 - ty;
    for (let bx = 0; bx < outW; bx++) {
      const wx = minX + bx + 0.5 - tx;
      let sx = invA * wx + invB * wy + px;
      let sy = invC * wx + invD * wy + py;

      if (sx > -1e-6 && sx < 0) sx = 0;
      if (sy > -1e-6 && sy < 0) sy = 0;
      if (sx < 0 || sy < 0 || sx >= srcW || sy >= srcH) continue;

      const ux = Math.min(upW - 1, Math.floor(sx * upFactor));
      const uy = Math.min(upH - 1, Math.floor(sy * upFactor));
      const sIdx = (uy * upW + ux) * 4;
      if (sData[sIdx + 3] === 0) continue;

      const oIdx = (by * outW + bx) * 4;
      oData[oIdx] = sData[sIdx];
      oData[oIdx + 1] = sData[sIdx + 1];
      oData[oIdx + 2] = sData[sIdx + 2];
      oData[oIdx + 3] = sData[sIdx + 3];
    }
  }

  out.markAllDirty();
  return {
    buffer: out,
    offsetX: minX,
    offsetY: minY,
  };
}

export interface TransformPoint {
  x: number;
  y: number;
}

export type TransformHandleId =
  | "tl"
  | "t"
  | "tr"
  | "r"
  | "br"
  | "b"
  | "bl"
  | "l";

export interface TransformGizmoGeometry {
  corners: [TransformPoint, TransformPoint, TransformPoint, TransformPoint];
  midpoints: [TransformPoint, TransformPoint, TransformPoint, TransformPoint];
  pivot: TransformPoint;
  rotStemStart: TransformPoint;
  rotHandle: TransformPoint;
}

export function transformLocalPoint(
  lx: number,
  ly: number,
  srcW: number,
  srcH: number,
  state: TransformState
): TransformPoint {
  const px = Number.isFinite(state.pivotX) ? state.pivotX : srcW / 2;
  const py = Number.isFinite(state.pivotY) ? state.pivotY : srcH / 2;
  const rad = (state.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const kxx = state.scaleX;
  const kxy = state.skewX * state.scaleY;
  const kyx = state.skewY * state.scaleX;
  const kyy = state.scaleY;

  const a = cos * kxx - sin * kyx;
  const b = cos * kxy - sin * kyy;
  const c = sin * kxx + cos * kyx;
  const d = sin * kxy + cos * kyy;

  return {
    x: a * (lx - px) + b * (ly - py) + px + state.x,
    y: c * (lx - px) + d * (ly - py) + py + state.y,
  };
}

export function computeTransformGizmo(
  srcW: number,
  srcH: number,
  state: TransformState,
  stemDistance = 2
): TransformGizmoGeometry {
  const tl = transformLocalPoint(0, 0, srcW, srcH, state);
  const tr = transformLocalPoint(srcW, 0, srcW, srcH, state);
  const br = transformLocalPoint(srcW, srcH, srcW, srcH, state);
  const bl = transformLocalPoint(0, srcH, srcW, srcH, state);

  const t = transformLocalPoint(srcW / 2, 0, srcW, srcH, state);
  const r = transformLocalPoint(srcW, srcH / 2, srcW, srcH, state);
  const b = transformLocalPoint(srcW / 2, srcH, srcW, srcH, state);
  const l = transformLocalPoint(0, srcH / 2, srcW, srcH, state);
  const center = transformLocalPoint(srcW / 2, srcH / 2, srcW, srcH, state);

  const px = Number.isFinite(state.pivotX) ? state.pivotX : srcW / 2;
  const py = Number.isFinite(state.pivotY) ? state.pivotY : srcH / 2;
  const pivot: TransformPoint = { x: px + state.x, y: py + state.y };

  const dx = t.x - center.x;
  const dy = t.y - center.y;
  const len = Math.hypot(dx, dy);
  const rad = (state.rotationDeg * Math.PI) / 180;
  const ux = len > 1e-6 ? dx / len : Math.sin(rad);
  const uy = len > 1e-6 ? dy / len : -Math.cos(rad);

  const rotHandle: TransformPoint = {
    x: t.x + ux * stemDistance,
    y: t.y + uy * stemDistance,
  };

  return {
    corners: [tl, tr, br, bl],
    midpoints: [t, r, b, l],
    pivot,
    rotStemStart: t,
    rotHandle,
  };
}

function getHandleLocalCoords(
  handle: TransformHandleId,
  srcW: number,
  srcH: number
): { hx: number; hy: number; ax: number; ay: number } {
  switch (handle) {
    case "tl":
      return { hx: 0, hy: 0, ax: srcW, ay: srcH };
    case "t":
      return { hx: srcW / 2, hy: 0, ax: srcW / 2, ay: srcH };
    case "tr":
      return { hx: srcW, hy: 0, ax: 0, ay: srcH };
    case "r":
      return { hx: srcW, hy: srcH / 2, ax: 0, ay: srcH / 2 };
    case "br":
      return { hx: srcW, hy: srcH, ax: 0, ay: 0 };
    case "b":
      return { hx: srcW / 2, hy: srcH, ax: srcW / 2, ay: 0 };
    case "bl":
      return { hx: 0, hy: srcH, ax: srcW, ay: 0 };
    case "l":
      return { hx: 0, hy: srcH / 2, ax: srcW, ay: srcH / 2 };
  }
}

export function computeScaleTransformPatch(
  srcW: number,
  srcH: number,
  startState: TransformState,
  handle: TransformHandleId,
  pointerCanvas: TransformPoint,
  lockAspect: boolean,
  scaleAroundPivot = false
): Partial<TransformState> {
  const safeW = Math.max(1, srcW);
  const safeH = Math.max(1, srcH);
  const coords = getHandleLocalCoords(handle, safeW, safeH);
  const px = Number.isFinite(startState.pivotX) ? startState.pivotX : safeW / 2;
  const py = Number.isFinite(startState.pivotY) ? startState.pivotY : safeH / 2;
  const ax = scaleAroundPivot ? px : coords.ax;
  const ay = scaleAroundPivot ? py : coords.ay;

  const anchorWorld = transformLocalPoint(ax, ay, safeW, safeH, startState);
  const wx = pointerCanvas.x - anchorWorld.x;
  const wy = pointerCanvas.y - anchorWorld.y;

  const rad = (startState.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const u = wx * cos + wy * sin;
  const v = -wx * sin + wy * cos;

  const dlx = coords.hx - ax;
  const dly = coords.hy - ay;
  const hasX = Math.abs(dlx) > 1e-6;
  const hasY = Math.abs(dly) > 1e-6;

  let nextScaleX = hasX ? u / dlx : startState.scaleX;
  let nextScaleY = hasY ? v / dly : startState.scaleY;

  const minScaleX = 1 / safeW;
  const minScaleY = 1 / safeH;
  if (Math.abs(nextScaleX) < minScaleX) {
    nextScaleX = (nextScaleX >= 0 ? 1 : -1) * minScaleX;
  }
  if (Math.abs(nextScaleY) < minScaleY) {
    nextScaleY = (nextScaleY >= 0 ? 1 : -1) * minScaleY;
  }

  if (lockAspect) {
    const baseRatio =
      Math.abs(startState.scaleX) > 1e-6
        ? Math.abs(startState.scaleY / startState.scaleX)
        : 1;
    if (hasX && hasY) {
      const rx =
        Math.abs(nextScaleX) / Math.max(1e-6, Math.abs(startState.scaleX));
      const ry =
        Math.abs(nextScaleY) / Math.max(1e-6, Math.abs(startState.scaleY));
      if (rx >= ry) {
        nextScaleY =
          (nextScaleY >= 0 ? 1 : -1) * Math.abs(nextScaleX) * baseRatio;
      } else {
        nextScaleX =
          (nextScaleX >= 0 ? 1 : -1) *
          (Math.abs(nextScaleY) / Math.max(1e-6, baseRatio));
      }
    } else if (hasX) {
      nextScaleY =
        (startState.scaleY >= 0 ? 1 : -1) * Math.abs(nextScaleX) * baseRatio;
    } else if (hasY) {
      nextScaleX =
        (startState.scaleX >= 0 ? 1 : -1) *
        (Math.abs(nextScaleY) / Math.max(1e-6, baseRatio));
    }
  }

  const nextStateZero: TransformState = {
    ...startState,
    scaleX: nextScaleX,
    scaleY: nextScaleY,
    x: 0,
    y: 0,
  };
  const anchorAtZero = transformLocalPoint(ax, ay, safeW, safeH, nextStateZero);
  const nextX = anchorWorld.x - anchorAtZero.x;
  const nextY = anchorWorld.y - anchorAtZero.y;

  return {
    scaleX: nextScaleX,
    scaleY: nextScaleY,
    width: Math.max(1, Math.round(safeW * Math.abs(nextScaleX))),
    height: Math.max(1, Math.round(safeH * Math.abs(nextScaleY))),
    x: nextX,
    y: nextY,
  };
}

export function computeRotateTransformPatch(
  srcW: number,
  srcH: number,
  startState: TransformState,
  startPointer: TransformPoint,
  currentPointer: TransformPoint,
  snap15: boolean
): Partial<TransformState> {
  const px = Number.isFinite(startState.pivotX) ? startState.pivotX : srcW / 2;
  const py = Number.isFinite(startState.pivotY) ? startState.pivotY : srcH / 2;
  const pivotWorldX = px + startState.x;
  const pivotWorldY = py + startState.y;

  const startAngle =
    (Math.atan2(startPointer.y - pivotWorldY, startPointer.x - pivotWorldX) *
      180) /
    Math.PI;
  const curAngle =
    (Math.atan2(
      currentPointer.y - pivotWorldY,
      currentPointer.x - pivotWorldX
    ) *
      180) /
    Math.PI;

  let delta = curAngle - startAngle;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;

  let nextDeg = startState.rotationDeg + delta;
  if (snap15) {
    nextDeg = Math.round(nextDeg / 15) * 15;
  } else {
    nextDeg = Math.round(nextDeg * 10) / 10;
  }

  // Normalize to (-180, 180]
  nextDeg = ((((nextDeg + 180) % 360) + 360) % 360) - 180;
  if (Object.is(nextDeg, -0) || Math.abs(nextDeg + 180) < 1e-9) {
    nextDeg = nextDeg < 0 ? 180 : 0;
  }

  return { rotationDeg: nextDeg };
}

export function computePivotTransformPatch(
  srcW: number,
  srcH: number,
  startState: TransformState,
  pointerCanvas: TransformPoint
): Partial<TransformState> {
  const px0 = Number.isFinite(startState.pivotX) ? startState.pivotX : srcW / 2;
  const py0 = Number.isFinite(startState.pivotY) ? startState.pivotY : srcH / 2;

  const rad = (startState.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const kxx = startState.scaleX;
  const kxy = startState.skewX * startState.scaleY;
  const kyx = startState.skewY * startState.scaleX;
  const kyy = startState.scaleY;

  const a = cos * kxx - sin * kyx;
  const b = cos * kxy - sin * kyy;
  const c = sin * kxx + cos * kyx;
  const d = sin * kxy + cos * kyy;

  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) {
    return {};
  }

  const wx = pointerCanvas.x - (px0 + startState.x);
  const wy = pointerCanvas.y - (py0 + startState.y);

  const invA = d / det;
  const invB = -b / det;
  const invC = -c / det;
  const invD = a / det;

  const nextPivotX = Math.round((invA * wx + invB * wy + px0) * 2) / 2;
  const nextPivotY = Math.round((invC * wx + invD * wy + py0) * 2) / 2;

  const dpx = nextPivotX - px0;
  const dpy = nextPivotY - py0;

  return {
    pivotX: nextPivotX,
    pivotY: nextPivotY,
    x: startState.x + (a - 1) * dpx + b * dpy,
    y: startState.y + c * dpx + (d - 1) * dpy,
  };
}

export function computeSkewTransformPatch(
  srcW: number,
  srcH: number,
  startState: TransformState,
  handle: "n" | "s" | "e" | "w",
  startPt: TransformPoint,
  currentPt: TransformPoint
): Partial<TransformState> {
  const safeW = Math.max(1, srcW);
  const safeH = Math.max(1, srcH);

  const dx = currentPt.x - startPt.x;
  const dy = currentPt.y - startPt.y;

  const rad = (startState.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Project drag delta into unrotated local axes (u along X, v along Y)
  const u = dx * cos + dy * sin;
  const v = -dx * sin + dy * cos;

  const clampSkew = (val: number) =>
    Math.max(-2, Math.min(2, Math.round(val * 1000) / 1000));

  if (handle === "n" || handle === "s") {
    const transformedH = Math.max(
      1,
      Math.abs(safeH * startState.scaleY)
    );
    const sign = handle === "s" ? 1 : -1;
    const deltaSkewX = (sign * u) / transformedH;
    return {
      skewX: clampSkew(startState.skewX + deltaSkewX),
    };
  }

  const transformedW = Math.max(
    1,
    Math.abs(safeW * startState.scaleX)
  );
  const sign = handle === "e" ? 1 : -1;
  const deltaSkewY = (sign * v) / transformedW;
  return {
    skewY: clampSkew(startState.skewY + deltaSkewY),
  };
}
