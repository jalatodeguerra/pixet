import type { Point } from "./pixelAlgos.ts";

export interface SymmetryConfig {
  symX: boolean;
  symY: boolean;
  axisX: number;
  axisY: number;
  diag45: boolean;
  diag135: boolean;
  radialSegments: number;
  radialCx: number;
  radialCy: number;
}

export function expandSymmetryV2(pt: Point, cfg: SymmetryConfig): Point[] {
  const origin: Point = { x: pt.x, y: pt.y };
  const result: Point[] = [origin];
  const seen = new Set<string>([`${origin.x},${origin.y}`]);

  const addUnique = (x: number, y: number) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    const key = `${ix},${iy}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ x: ix, y: iy });
    }
  };

  // Reflection helpers matching expandSymmetry center parity:
  // When axisX = width / 2, Math.round(2 * axisX - x - 1) === width - 1 - x.
  const reflectX = (x: number) => Math.round(2 * cfg.axisX - x - 1);
  const reflectY = (y: number) => Math.round(2 * cfg.axisY - y - 1);

  const applyAxialAndDiag = (baseX: number, baseY: number) => {
    const candidates: Point[] = [{ x: baseX, y: baseY }];

    if (cfg.symX) {
      const len = candidates.length;
      for (let i = 0; i < len; i++) {
        candidates.push({ x: reflectX(candidates[i].x), y: candidates[i].y });
      }
    }
    if (cfg.symY) {
      const len = candidates.length;
      for (let i = 0; i < len; i++) {
        candidates.push({ x: candidates[i].x, y: reflectY(candidates[i].y) });
      }
    }

    if (cfg.diag45) {
      const len = candidates.length;
      for (let i = 0; i < len; i++) {
        const c = candidates[i];
        // Reflect across y - (axisY - 0.5) = x - (axisX - 0.5)
        const dx = c.x + 0.5 - cfg.axisX;
        const dy = c.y + 0.5 - cfg.axisY;
        candidates.push({
          x: Math.round(cfg.axisX + dy - 0.5),
          y: Math.round(cfg.axisY + dx - 0.5),
        });
      }
    }

    if (cfg.diag135) {
      const len = candidates.length;
      for (let i = 0; i < len; i++) {
        const c = candidates[i];
        // Reflect across y - (axisY - 0.5) = -(x - (axisX - 0.5))
        const dx = c.x + 0.5 - cfg.axisX;
        const dy = c.y + 0.5 - cfg.axisY;
        candidates.push({
          x: Math.round(cfg.axisX - dy - 0.5),
          y: Math.round(cfg.axisY - dx - 0.5),
        });
      }
    }

    for (const c of candidates) {
      addUnique(c.x, c.y);
    }
  };

  applyAxialAndDiag(origin.x, origin.y);

  const segs = Math.floor(cfg.radialSegments);
  if (segs >= 2) {
    const clampedSegs = Math.min(12, segs);
    const seedPoints = result.slice();
    const cx = cfg.radialCx;
    const cy = cfg.radialCy;

    for (let k = 1; k < clampedSegs; k++) {
      const angle = (2 * Math.PI * k) / clampedSegs;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      for (const s of seedPoints) {
        const dx = s.x - cx;
        const dy = s.y - cy;
        const rx = cx + dx * cos - dy * sin;
        const ry = cy + dx * sin + dy * cos;
        addUnique(rx, ry);
      }
    }
  }

  return result;
}
