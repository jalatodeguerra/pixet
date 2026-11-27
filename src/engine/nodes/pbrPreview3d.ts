import { getEvaluatedMesh } from "../model3d/modifiers.ts";
import type { ModelNode } from "../model3d/types.ts";

export type Preview3DMeshKind = "quad" | "cube" | "sphere" | "cylinder" | "active3d";

export interface PreviewMeshBuffers {
  /** Interleaved: pos(3), normal(3), uv(2) = 8 floats per vertex */
  vertices: Float32Array;
  vertexCount: number;
}

function pushTri(
  out: number[],
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  uv0: [number, number],
  uv1: [number, number],
  uv2: [number, number]
): void {
  const ax = p1[0] - p0[0];
  const ay = p1[1] - p0[1];
  const az = p1[2] - p0[2];
  const bx = p2[0] - p0[0];
  const by = p2[1] - p0[1];
  const bz = p2[2] - p0[2];
  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;

  out.push(p0[0], p0[1], p0[2], nx, ny, nz, uv0[0], uv0[1]);
  out.push(p1[0], p1[1], p1[2], nx, ny, nz, uv1[0], uv1[1]);
  out.push(p2[0], p2[1], p2[2], nx, ny, nz, uv2[0], uv2[1]);
}

function pushQuad(
  out: number[],
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number]
): void {
  pushTri(out, p0, p1, p2, [0, 0], [1, 0], [1, 1]);
  pushTri(out, p0, p2, p3, [0, 0], [1, 1], [0, 1]);
}

export function buildPreviewMesh(
  kind: Preview3DMeshKind,
  modelNodes: readonly ModelNode[] = [],
  texW = 16,
  texH = 16
): PreviewMeshBuffers {
  const out: number[] = [];

  if (kind === "quad") {
    pushQuad(out, [-0.8, -0.8, 0], [0.8, -0.8, 0], [0.8, 0.8, 0], [-0.8, 0.8, 0]);
  } else if (kind === "cube") {
    const s = 0.65;
    pushQuad(out, [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]);
    pushQuad(out, [s, -s, -s], [-s, -s, -s], [-s, s, -s], [s, s, -s]);
    pushQuad(out, [s, -s, s], [s, -s, -s], [s, s, -s], [s, s, s]);
    pushQuad(out, [-s, -s, -s], [-s, -s, s], [-s, s, s], [-s, s, -s]);
    pushQuad(out, [-s, s, s], [s, s, s], [s, s, -s], [-s, s, -s]);
    pushQuad(out, [-s, -s, -s], [s, -s, -s], [s, -s, s], [-s, -s, s]);
  } else if (kind === "sphere") {
    const segs = 24;
    const rings = 16;
    const r = 0.78;
    const pt = (lat: number, lon: number): [number, number, number] => [
      r * Math.cos(lat) * Math.cos(lon),
      r * Math.sin(lat),
      r * Math.cos(lat) * Math.sin(lon),
    ];
    for (let y = 0; y < rings; y++) {
      const lat0 = ((y / rings) - 0.5) * Math.PI;
      const lat1 = (((y + 1) / rings) - 0.5) * Math.PI;
      for (let x = 0; x < segs; x++) {
        const lon0 = (x / segs) * Math.PI * 2;
        const lon1 = ((x + 1) / segs) * Math.PI * 2;
        const u0 = x / segs;
        const u1 = (x + 1) / segs;
        const v0 = y / rings;
        const v1 = (y + 1) / rings;
        const a = pt(lat0, lon0);
        const b = pt(lat0, lon1);
        const c = pt(lat1, lon1);
        const d = pt(lat1, lon0);
        pushTri(out, a, b, c, [u0, v0], [u1, v0], [u1, v1]);
        pushTri(out, a, c, d, [u0, v0], [u1, v1], [u0, v1]);
      }
    }
  } else if (kind === "cylinder") {
    const segs = 24;
    const r = 0.6;
    const h = 0.72;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const p0: [number, number, number] = [r * Math.cos(a0), -h, r * Math.sin(a0)];
      const p1: [number, number, number] = [r * Math.cos(a1), -h, r * Math.sin(a1)];
      const p2: [number, number, number] = [r * Math.cos(a1), h, r * Math.sin(a1)];
      const p3: [number, number, number] = [r * Math.cos(a0), h, r * Math.sin(a0)];
      pushTri(out, p0, p1, p2, [i / segs, 0], [(i + 1) / segs, 0], [(i + 1) / segs, 1]);
      pushTri(out, p0, p2, p3, [i / segs, 0], [(i + 1) / segs, 1], [i / segs, 1]);
    }
  } else if (kind === "active3d") {
    const rawPts: Array<[number, number, number]> = [];
    for (const node of modelNodes) {
      if (!node.visible) continue;
      if (node.kind === "cuboid" && node.cuboid) {
        const [x0, y0, z0] = node.cuboid.from;
        const [x1, y1, z1] = node.cuboid.to;
        const ox = node.transform.position[0];
        const oy = node.transform.position[1];
        const oz = node.transform.position[2];
        const a: [number, number, number] = [x0 + ox, y0 + oy, z0 + oz];
        const b: [number, number, number] = [x1 + ox, y0 + oy, z0 + oz];
        const c: [number, number, number] = [x1 + ox, y1 + oy, z0 + oz];
        const d: [number, number, number] = [x0 + ox, y1 + oy, z0 + oz];
        const e: [number, number, number] = [x0 + ox, y0 + oy, z1 + oz];
        const f: [number, number, number] = [x1 + ox, y0 + oy, z1 + oz];
        const g: [number, number, number] = [x1 + ox, y1 + oy, z1 + oz];
        const h: [number, number, number] = [x0 + ox, y1 + oy, z1 + oz];
        rawPts.push(a, b, c, d, e, f, g, h);
        pushQuad(out, e, f, g, h);
        pushQuad(out, b, a, d, c);
        pushQuad(out, f, b, c, g);
        pushQuad(out, a, e, h, d);
        pushQuad(out, h, g, c, d);
        pushQuad(out, a, b, f, e);
      } else if (node.kind === "mesh" && node.mesh) {
        const evalMesh = getEvaluatedMesh(node, "export") ?? node.mesh;
        const verts = evalMesh.vertices;
        const ox = node.transform.position[0];
        const oy = node.transform.position[1];
        const oz = node.transform.position[2];
        for (const face of evalMesh.faces) {
          if (face.verts.length < 3) continue;
          const getP = (vi: number): [number, number, number] => {
            const v = verts[vi] ?? [0, 0, 0];
            return [v[0] + ox, v[1] + oy, v[2] + oz];
          };
          const getUv = (idx: number): [number, number] => {
            const uv = face.uvs[idx] ?? [0, 0];
            return [uv[0] / Math.max(1, texW), uv[1] / Math.max(1, texH)];
          };
          for (let i = 1; i + 1 < face.verts.length; i++) {
            const p0 = getP(face.verts[0]);
            const p1 = getP(face.verts[i]);
            const p2 = getP(face.verts[i + 1]);
            rawPts.push(p0, p1, p2);
            pushTri(out, p0, p1, p2, getUv(0), getUv(i), getUv(i + 1));
          }
        }
      }
    }
    if (out.length === 0) {
      return buildPreviewMesh("cube");
    }
    // Center and normalize to [-0.8, 0.8]
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < out.length; i += 8) {
      minX = Math.min(minX, out[i]);
      maxX = Math.max(maxX, out[i]);
      minY = Math.min(minY, out[i + 1]);
      maxY = Math.max(maxY, out[i + 1]);
      minZ = Math.min(minZ, out[i + 2]);
      maxZ = Math.max(maxZ, out[i + 2]);
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const span = Math.max(1e-4, maxX - minX, maxY - minY, maxZ - minZ);
    const scale = 1.5 / span;
    for (let i = 0; i < out.length; i += 8) {
      out[i] = (out[i] - cx) * scale;
      out[i + 1] = (out[i + 1] - cy) * scale;
      out[i + 2] = (out[i + 2] - cz) * scale;
    }
  }

  return {
    vertices: new Float32Array(out),
    vertexCount: out.length / 8,
  };
}
