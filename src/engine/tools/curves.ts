import {
  applyPixelPerfectFilter,
  plotBresenhamLine,
  type Point,
} from "./pixelAlgos.ts";

function dedupeConsecutive(points: readonly Point[]): Point[] {
  if (points.length === 0) return [];
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    if (cur.x !== prev.x || cur.y !== prev.y) {
      out.push(cur);
    }
  }
  return out;
}

function dedupeAll(points: readonly Point[]): Point[] {
  const seen = new Set<string>();
  const out: Point[] = [];
  for (const pt of points) {
    const key = `${pt.x},${pt.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(pt);
    }
  }
  return out;
}

function connectSamples(samples: readonly Point[], pixelPerfect: boolean): Point[] {
  if (samples.length === 0) return [];
  const raw: Point[] = [];
  for (let i = 0; i < samples.length; i++) {
    const cur = {
      x: Math.round(samples[i].x),
      y: Math.round(samples[i].y),
    };
    if (i === 0) {
      raw.push(cur);
      continue;
    }
    const prev = raw[raw.length - 1];
    if (cur.x === prev.x && cur.y === prev.y) continue;
    const seg = plotBresenhamLine(prev.x, prev.y, cur.x, cur.y);
    for (let j = 1; j < seg.length; j++) {
      raw.push(seg[j]);
    }
  }
  const deduped = dedupeConsecutive(raw);
  return pixelPerfect ? applyPixelPerfectFilter(deduped) : deduped;
}

export function plotQuadraticBezier(
  p0: Point,
  p1: Point,
  p2: Point,
  pixelPerfect = false
): Point[] {
  const polyLen =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const steps = Math.max(1, Math.ceil(polyLen * 2));

  const samples: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x;
    const y = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y;
    samples.push({ x, y });
  }

  return connectSamples(samples, pixelPerfect);
}

export function plotCubicBezier(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  pixelPerfect = false
): Point[] {
  const polyLen =
    Math.hypot(p1.x - p0.x, p1.y - p0.y) +
    Math.hypot(p2.x - p1.x, p2.y - p1.y) +
    Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const steps = Math.max(1, Math.ceil(polyLen * 2));

  const samples: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    const x =
      mt2 * mt * p0.x +
      3 * mt2 * t * p1.x +
      3 * mt * t2 * p2.x +
      t2 * t * p3.x;
    const y =
      mt2 * mt * p0.y +
      3 * mt2 * t * p1.y +
      3 * mt * t2 * p2.y +
      t2 * t * p3.y;
    samples.push({ x, y });
  }

  return connectSamples(samples, pixelPerfect);
}

export function plotPolygon(
  vertices: readonly Point[],
  filled: boolean,
  closed = true
): Point[] {
  if (vertices.length === 0) return [];
  if (vertices.length === 1) {
    return [{ x: Math.round(vertices[0].x), y: Math.round(vertices[0].y) }];
  }

  const intVerts: Point[] = vertices.map((v) => ({
    x: Math.round(v.x),
    y: Math.round(v.y),
  }));

  const outline: Point[] = [];
  for (let i = 0; i < intVerts.length - 1; i++) {
    const a = intVerts[i];
    const b = intVerts[i + 1];
    const seg = plotBresenhamLine(a.x, a.y, b.x, b.y);
    for (let j = i === 0 ? 0 : 1; j < seg.length; j++) {
      outline.push(seg[j]);
    }
  }

  if (closed && intVerts.length >= 3) {
    const last = intVerts[intVerts.length - 1];
    const first = intVerts[0];
    const seg = plotBresenhamLine(last.x, last.y, first.x, first.y);
    for (let j = 1; j < seg.length; j++) {
      outline.push(seg[j]);
    }
  }

  const dedupedOutline = dedupeConsecutive(outline);
  if (!filled || intVerts.length < 3) {
    return dedupedOutline;
  }

  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of intVerts) {
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }

  const filledPoints: Point[] = [...dedupedOutline];
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    const intersections: number[] = [];
    for (let i = 0, j = intVerts.length - 1; i < intVerts.length; j = i++) {
      const y1 = intVerts[i].y + 0.5;
      const y2 = intVerts[j].y + 0.5;
      if ((y1 > py) !== (y2 > py)) {
        const x1 = intVerts[i].x + 0.5;
        const x2 = intVerts[j].x + 0.5;
        const ix = x1 + ((py - y1) * (x2 - x1)) / (y2 - y1);
        intersections.push(ix);
      }
    }
    intersections.sort((a, b) => a - b);
    for (let k = 0; k + 1 < intersections.length; k += 2) {
      const startX = Math.floor(intersections[k]);
      const endX = Math.floor(intersections[k + 1]);
      for (let x = startX; x <= endX; x++) {
        filledPoints.push({ x, y });
      }
    }
  }

  return dedupeAll(filledPoints);
}
