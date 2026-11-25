import { mat3FromEulerDeg, mat3MulVec } from "./math3d.ts";

export type Scene3DGridMode = "perspective" | "isometric" | "none";

export interface Scene3DCamera {
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  perspective: number;
  canvasWidth: number;
  canvasHeight: number;
  floorY: number;
  viewWidth: number;
  viewHeight: number;
  pixelScale: number;
  gridMode: Scene3DGridMode;
}

export interface ProjectedPoint {
  sx: number;
  sy: number;
  depth: number;
  visible: boolean;
}

export interface SceneGridLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "minor" | "major" | "axisX" | "axisY" | "axisZ" | "isoFootprint";
  alpha: number;
}

export interface TurntableRingGeometry {
  points: Array<{ sx: number; sy: number }>;
  ticks: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    label?: string;
    lx?: number;
    ly?: number;
  }>;
}

export function projectScenePoint(
  x: number,
  y: number,
  z: number,
  cam: Scene3DCamera
): ProjectedPoint {
  const R = mat3FromEulerDeg(cam.yawDeg, cam.pitchDeg, cam.rollDeg);
  const [wx, wy, wz] = mat3MulVec(R, x, y, z);

  const persp =
    cam.gridMode === "isometric"
      ? 0
      : Math.max(0, Math.min(1, cam.perspective));
  const usePersp = persp > 0.001;
  const maxDim = Math.max(1, cam.canvasWidth, cam.canvasHeight);
  const camDist = maxDim * (2.6 - 1.5 * persp);

  if (usePersp) {
    const denom = camDist - wz;
    if (denom <= 1e-2) {
      return { sx: 0, sy: 0, depth: wz, visible: false };
    }
    const projX = (wx * camDist) / denom;
    const projY = (wy * camDist) / denom;
    return {
      sx: cam.viewWidth / 2 + projX * cam.pixelScale,
      sy: cam.viewHeight / 2 + projY * cam.pixelScale,
      depth: wz,
      visible: true,
    };
  }

  return {
    sx: cam.viewWidth / 2 + wx * cam.pixelScale,
    sy: cam.viewHeight / 2 + wy * cam.pixelScale,
    depth: wz,
    visible: true,
  };
}

function pushSegmentedLine(
  out: SceneGridLine[],
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  segments: number,
  kind: SceneGridLine["kind"],
  baseAlpha: number,
  cam: Scene3DCamera,
  maxDist: number
): void {
  let prev = projectScenePoint(x0, y0, z0, cam);
  for (let s = 1; s <= segments; s++) {
    const t = s / segments;
    const px = x0 + (x1 - x0) * t;
    const py = y0 + (y1 - y0) * t;
    const pz = z0 + (z1 - z0) * t;
    const curr = projectScenePoint(px, py, pz, cam);
    if (prev.visible && curr.visible) {
      const midX = x0 + (x1 - x0) * ((s - 0.5) / segments);
      const midZ = z0 + (z1 - z0) * ((s - 0.5) / segments);
      const radial = Math.hypot(midX, midZ);
      const fade = Math.max(0.18, 1 - (radial / Math.max(1, maxDist)) * 0.65);
      out.push({
        x1: prev.sx,
        y1: prev.sy,
        x2: curr.sx,
        y2: curr.sy,
        kind,
        alpha: Math.max(0.05, Math.min(1, baseAlpha * fade)),
      });
    }
    prev = curr;
  }
}

export function buildSceneGridLines(
  cam: Scene3DCamera,
  opts?: { showAxes?: boolean; halfExtent?: number; cellSize?: number }
): SceneGridLine[] {
  const lines: SceneGridLine[] = [];
  const maxDim = Math.max(8, cam.canvasWidth, cam.canvasHeight);
  const cellSize = opts?.cellSize ?? Math.max(4, Math.round(maxDim / 4));
  const halfExtent = opts?.halfExtent ?? 6;
  const extent = halfExtent * cellSize;
  const maxDist = extent * Math.SQRT2;
  const y = cam.floorY;

  if (cam.gridMode !== "none") {
    const segs = cam.gridMode === "perspective" ? 8 : 2;
    for (let i = -halfExtent; i <= halfExtent; i++) {
      const pos = i * cellSize;
      const isMajor = i % 4 === 0;
      const kind: SceneGridLine["kind"] = isMajor ? "major" : "minor";
      const baseAlpha = isMajor ? 0.42 : 0.2;

      pushSegmentedLine(
        lines,
        -extent,
        y,
        pos,
        extent,
        y,
        pos,
        segs,
        kind,
        baseAlpha,
        cam,
        maxDist
      );
      pushSegmentedLine(
        lines,
        pos,
        y,
        -extent,
        pos,
        y,
        extent,
        segs,
        kind,
        baseAlpha,
        cam,
        maxDist
      );
    }

    if (cam.gridMode === "isometric") {
      const tileHalf = Math.max(cellSize * 0.5, maxDim * 0.5);
      const corners: Array<[number, number]> = [
        [-tileHalf, -tileHalf],
        [tileHalf, -tileHalf],
        [tileHalf, tileHalf],
        [-tileHalf, tileHalf],
      ];
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i];
        const [bx, bz] = corners[(i + 1) % 4];
        pushSegmentedLine(
          lines,
          ax,
          y,
          az,
          bx,
          y,
          bz,
          1,
          "isoFootprint",
          0.9,
          cam,
          maxDist
        );
      }
    }
  }

  if (opts?.showAxes !== false) {
    const axisSegs = cam.gridMode === "perspective" ? 6 : 1;
    pushSegmentedLine(
      lines,
      -extent,
      y,
      0,
      extent,
      y,
      0,
      axisSegs,
      "axisX",
      0.85,
      cam,
      maxDist * 1.4
    );
    pushSegmentedLine(
      lines,
      0,
      y,
      -extent,
      0,
      y,
      extent,
      axisSegs,
      "axisZ",
      0.85,
      cam,
      maxDist * 1.4
    );
    pushSegmentedLine(
      lines,
      0,
      y,
      0,
      0,
      y - maxDim * 0.65,
      0,
      1,
      "axisY",
      0.85,
      cam,
      maxDist * 1.4
    );
  }

  return lines;
}

export function buildTurntableRing(
  cam: Scene3DCamera,
  radius: number,
  segments = 48
): TurntableRingGeometry {
  const points: Array<{ sx: number; sy: number }> = [];
  const y = cam.floorY;

  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const p = projectScenePoint(
      Math.cos(a) * radius,
      y,
      Math.sin(a) * radius,
      cam
    );
    if (p.visible) {
      points.push({ sx: p.sx, sy: p.sy });
    }
  }

  const ticks: TurntableRingGeometry["ticks"] = [];
  const cardinalLabels: Record<number, string> = {
    0: "0°",
    2: "90°",
    4: "180°",
    6: "270°",
  };
  for (let k = 0; k < 8; k++) {
    // 0° at +Z (front), 90° at +X, 180° at -Z, 270° at -X
    const a = (k / 8) * Math.PI * 2;
    const sinA = Math.sin(a);
    const cosA = Math.cos(a);
    const inner = radius * 0.92;
    const outer = radius * 1.04;
    const labelR = radius * 1.18;
    const p1 = projectScenePoint(sinA * inner, y, cosA * inner, cam);
    const p2 = projectScenePoint(sinA * outer, y, cosA * outer, cam);
    if (!p1.visible || !p2.visible) continue;
    const label = cardinalLabels[k];
    if (label) {
      const lp = projectScenePoint(sinA * labelR, y, cosA * labelR, cam);
      ticks.push({
        x1: p1.sx,
        y1: p1.sy,
        x2: p2.sx,
        y2: p2.sy,
        label,
        lx: lp.visible ? lp.sx : p2.sx,
        ly: lp.visible ? lp.sy : p2.sy,
      });
    } else {
      ticks.push({
        x1: p1.sx,
        y1: p1.sy,
        x2: p2.sx,
        y2: p2.sy,
      });
    }
  }

  return { points, ticks };
}

export function buildFloorShadowEllipse(
  cam: Scene3DCamera,
  radiusX: number,
  radiusZ: number,
  segments = 32
): Array<{ sx: number; sy: number }> {
  const points: Array<{ sx: number; sy: number }> = [];
  const y = cam.floorY;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const p = projectScenePoint(
      Math.cos(a) * radiusX,
      y,
      Math.sin(a) * radiusZ,
      cam
    );
    if (p.visible) {
      points.push({ sx: p.sx, sy: p.sy });
    }
  }
  return points;
}
