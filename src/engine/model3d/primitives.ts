import {
  createDefaultCuboidData,
  createDefaultTransform,
  DEFAULT_MODEL3D_MATERIAL_ID,
  Model3DEngine,
} from "./Model3DEngine.ts";
import { vec3Cross, vec3Dot, vec3Sub } from "./quatMath.ts";
import type {
  CuboidData,
  ModelNode,
  PolyFace,
  PolyMeshData,
  Vec2,
  Vec3,
} from "./types.ts";

export type PrimitiveKind =
  | "cuboid"
  | "plane"
  | "crossBillboard"
  | "wedge"
  | "prism"
  | "cylinder"
  | "cone"
  | "pyramid"
  | "icosphere";

export type StarterTemplateKind =
  | "chibi16"
  | "humanoid32"
  | "weaponProp"
  | "dungeonChunk";

export interface CreatePrimitiveOptions {
  id?: string;
  name?: string;
  sizePx?: Vec3;
  segments?: number;
  materialId?: string;
  position?: Vec3;
  pivot?: Vec3;
  parentId?: string | null;
}

export const PRIMITIVE_CATALOG: ReadonlyArray<{
  kind: PrimitiveKind;
  label: string;
  defaultSizePx: Vec3;
}> = [
  { kind: "cuboid", label: "Cuboid", defaultSizePx: [16, 16, 16] },
  { kind: "plane", label: "Plane", defaultSizePx: [16, 16, 16] },
  {
    kind: "crossBillboard",
    label: "Cross-Billboard",
    defaultSizePx: [16, 16, 16],
  },
  { kind: "wedge", label: "Wedge", defaultSizePx: [16, 16, 16] },
  { kind: "prism", label: "Prism", defaultSizePx: [16, 16, 16] },
  { kind: "cylinder", label: "Cylinder", defaultSizePx: [16, 16, 16] },
  { kind: "cone", label: "Cone", defaultSizePx: [16, 16, 16] },
  { kind: "pyramid", label: "Pyramid", defaultSizePx: [16, 16, 16] },
  { kind: "icosphere", label: "Icosphere", defaultSizePx: [16, 16, 16] },
];

export const STARTER_TEMPLATE_CATALOG: ReadonlyArray<{
  kind: StarterTemplateKind;
  label: string;
  description: string;
}> = [
  {
    kind: "chibi16",
    label: "Chibi 16px",
    description:
      "16px tall chibi character rig with neck, shoulder, and hip pivots plus non-overlapping Box-UVs.",
  },
  {
    kind: "humanoid32",
    label: "Retro Humanoid 32px",
    description:
      "32px tall hierarchical humanoid rig (Pelvis -> Torso -> Head, Arms, Legs) with clean joint pivots.",
  },
  {
    kind: "weaponProp",
    label: "Weapon Prop",
    description:
      "Hierarchical sword prop with pommel, grip, crossguard, and tapered blade with pyramid tip.",
  },
  {
    kind: "dungeonChunk",
    label: "Dungeon Chunk",
    description:
      "32x32px dungeon corner room with floor plane, north/west walls, and corner pillar.",
  },
];

let nextPrimitiveSeq = 1;

function finiteOr(v: number | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clampDim(v: number | undefined, fallback: number): number {
  return Math.max(0.01, finiteOr(v, fallback));
}

function clampSegments(segments: number | undefined): number {
  return Math.max(3, Math.min(16, Math.round(finiteOr(segments, 8))));
}

function roundCoord(n: number): number {
  const cleaned = Math.round(n * 1e6) / 1e6;
  return Object.is(cleaned, -0) ? 0 : cleaned;
}

function vec3Clean(x: number, y: number, z: number): Vec3 {
  return [roundCoord(x), roundCoord(y), roundCoord(z)];
}

function uvClean(u: number, v: number): Vec2 {
  return [roundCoord(u), roundCoord(v)];
}

function makeFace(
  id: string,
  verts: number[],
  uvs: Vec2[],
  materialId: string
): PolyFace {
  return {
    id,
    verts,
    uvs,
    triSplit: verts.length === 4 ? "02" : undefined,
    flatShading: true,
    materialId,
  };
}

/**
 * Applies a standard non-overlapping Box-UV net layout onto a CuboidData
 * based on its pixel dimensions [dx, dy, dz] and boxUvOrigin [ox, oy].
 */
export function applyBoxUvLayout(
  cuboid: CuboidData,
  boxUvOrigin: Vec2 = cuboid.boxUvOrigin
): CuboidData {
  const ox = finiteOr(boxUvOrigin[0], 0);
  const oy = finiteOr(boxUvOrigin[1], 0);
  const dx = Math.max(1, Math.round(Math.abs(cuboid.to[0] - cuboid.from[0])));
  const dy = Math.max(1, Math.round(Math.abs(cuboid.to[1] - cuboid.from[1])));
  const dz = Math.max(1, Math.round(Math.abs(cuboid.to[2] - cuboid.from[2])));

  cuboid.boxUvOrigin = [ox, oy];
  cuboid.uvMode = "box";

  cuboid.faces.up.uv = [ox + dz, oy, ox + dz + dx, oy + dz];
  cuboid.faces.down.uv = [ox + dz + dx, oy, ox + dz + 2 * dx, oy + dz];
  cuboid.faces.west.uv = [ox, oy + dz, ox + dz, oy + dz + dy];
  cuboid.faces.north.uv = [ox + dz, oy + dz, ox + dz + dx, oy + dz + dy];
  cuboid.faces.east.uv = [
    ox + dz + dx,
    oy + dz,
    ox + 2 * dz + dx,
    oy + dz + dy,
  ];
  cuboid.faces.south.uv = [
    ox + 2 * dz + dx,
    oy + dz,
    ox + 2 * dz + 2 * dx,
    oy + dz + dy,
  ];

  return cuboid;
}

function buildPlaneMesh(sx: number, sz: number, materialId: string): PolyMeshData {
  const hx = sx / 2;
  const hz = sz / 2;
  const vertices: Vec3[] = [
    vec3Clean(-hx, 0, hz),
    vec3Clean(hx, 0, hz),
    vec3Clean(hx, 0, -hz),
    vec3Clean(-hx, 0, -hz),
  ];
  const faces: PolyFace[] = [
    makeFace(
      "plane-top",
      [0, 1, 2, 3],
      [
        uvClean(0, sz),
        uvClean(sx, sz),
        uvClean(sx, 0),
        uvClean(0, 0),
      ],
      materialId
    ),
  ];
  return { vertices, faces };
}

function buildCrossBillboardMesh(
  sx: number,
  sy: number,
  sz: number,
  materialId: string
): PolyMeshData {
  const hx = sx / 2;
  const hz = sz / 2;
  const vertices: Vec3[] = [
    // Diagonal 1: (-hx, -hz) -> (+hx, +hz)
    vec3Clean(-hx, 0, -hz),
    vec3Clean(hx, 0, hz),
    vec3Clean(hx, sy, hz),
    vec3Clean(-hx, sy, -hz),
    // Diagonal 2: (-hx, +hz) -> (+hx, -hz)
    vec3Clean(-hx, 0, hz),
    vec3Clean(hx, 0, -hz),
    vec3Clean(hx, sy, -hz),
    vec3Clean(-hx, sy, hz),
  ];
  const quadUvs: Vec2[] = [
    uvClean(0, sy),
    uvClean(sx, sy),
    uvClean(sx, 0),
    uvClean(0, 0),
  ];
  const faces: PolyFace[] = [
    makeFace(
      "cross-a",
      [0, 1, 2, 3],
      quadUvs.map((uv): Vec2 => [uv[0], uv[1]]),
      materialId
    ),
    makeFace(
      "cross-b",
      [4, 5, 6, 7],
      quadUvs.map((uv): Vec2 => [uv[0], uv[1]]),
      materialId
    ),
  ];
  return { vertices, faces };
}

function buildWedgeMesh(
  sx: number,
  sy: number,
  sz: number,
  materialId: string
): PolyMeshData {
  const hx = sx / 2;
  const hz = sz / 2;
  const slopeLen = Math.hypot(sy, sz);
  const vertices: Vec3[] = [
    vec3Clean(-hx, 0, hz), // 0: front-bottom-left
    vec3Clean(hx, 0, hz), // 1: front-bottom-right
    vec3Clean(hx, 0, -hz), // 2: back-bottom-right
    vec3Clean(-hx, 0, -hz), // 3: back-bottom-left
    vec3Clean(hx, sy, -hz), // 4: back-top-right
    vec3Clean(-hx, sy, -hz), // 5: back-top-left
  ];
  const faces: PolyFace[] = [
    // Bottom (-Y)
    makeFace(
      "wedge-bottom",
      [3, 2, 1, 0],
      [uvClean(0, 0), uvClean(sx, 0), uvClean(sx, sz), uvClean(0, sz)],
      materialId
    ),
    // Back (-Z)
    makeFace(
      "wedge-back",
      [2, 3, 5, 4],
      [uvClean(0, sy), uvClean(sx, sy), uvClean(sx, 0), uvClean(0, 0)],
      materialId
    ),
    // Slope (+Y, +Z)
    makeFace(
      "wedge-slope",
      [0, 1, 4, 5],
      [
        uvClean(0, slopeLen),
        uvClean(sx, slopeLen),
        uvClean(sx, 0),
        uvClean(0, 0),
      ],
      materialId
    ),
    // Left (-X)
    makeFace(
      "wedge-left",
      [3, 0, 5],
      [uvClean(0, sy), uvClean(sz, sy), uvClean(0, 0)],
      materialId
    ),
    // Right (+X)
    makeFace(
      "wedge-right",
      [1, 2, 4],
      [uvClean(0, sy), uvClean(sz, sy), uvClean(sz, 0)],
      materialId
    ),
  ];
  return { vertices, faces };
}

function buildPrismMesh(
  sx: number,
  sy: number,
  sz: number,
  materialId: string
): PolyMeshData {
  const hx = sx / 2;
  const hz = sz / 2;
  const sideLen = Math.hypot(hx, sz);
  const vertices: Vec3[] = [
    vec3Clean(-hx, 0, hz), // 0: bottom front-left
    vec3Clean(hx, 0, hz), // 1: bottom front-right
    vec3Clean(0, 0, -hz), // 2: bottom back-center
    vec3Clean(-hx, sy, hz), // 3: top front-left
    vec3Clean(hx, sy, hz), // 4: top front-right
    vec3Clean(0, sy, -hz), // 5: top back-center
  ];
  const faces: PolyFace[] = [
    // Bottom cap (-Y)
    makeFace(
      "prism-bottom",
      [0, 2, 1],
      [uvClean(0, sz), uvClean(sx / 2, 0), uvClean(sx, sz)],
      materialId
    ),
    // Top cap (+Y)
    makeFace(
      "prism-top",
      [3, 4, 5],
      [uvClean(0, sz), uvClean(sx, sz), uvClean(sx / 2, 0)],
      materialId
    ),
    // Front (+Z)
    makeFace(
      "prism-front",
      [0, 1, 4, 3],
      [uvClean(0, sy), uvClean(sx, sy), uvClean(sx, 0), uvClean(0, 0)],
      materialId
    ),
    // Back-right (+X, -Z)
    makeFace(
      "prism-right",
      [1, 2, 5, 4],
      [
        uvClean(0, sy),
        uvClean(sideLen, sy),
        uvClean(sideLen, 0),
        uvClean(0, 0),
      ],
      materialId
    ),
    // Back-left (-X, -Z)
    makeFace(
      "prism-left",
      [2, 0, 3, 5],
      [
        uvClean(0, sy),
        uvClean(sideLen, sy),
        uvClean(sideLen, 0),
        uvClean(0, 0),
      ],
      materialId
    ),
  ];
  return { vertices, faces };
}

function buildCylinderMesh(
  sx: number,
  sy: number,
  sz: number,
  segments: number,
  materialId: string
): PolyMeshData {
  const hx = sx / 2;
  const hz = sz / 2;
  const vertices: Vec3[] = [];

  // 0 .. segments-1: bottom ring (CCW when viewed from +Y)
  // segments .. 2*segments-1: top ring
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const x = hx * Math.cos(theta);
    const z = -hz * Math.sin(theta);
    vertices.push(vec3Clean(x, 0, z));
  }
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const x = hx * Math.cos(theta);
    const z = -hz * Math.sin(theta);
    vertices.push(vec3Clean(x, sy, z));
  }
  const botCenterIdx = vertices.length;
  vertices.push([0, 0, 0]);
  const topCenterIdx = vertices.length;
  vertices.push(vec3Clean(0, sy, 0));

  const faces: PolyFace[] = [];
  const capUvs: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    capUvs.push(
      uvClean(
        (0.5 + 0.5 * Math.cos(theta)) * sx,
        (0.5 - 0.5 * Math.sin(theta)) * sz
      )
    );
  }
  const centerUv = uvClean(sx / 2, sz / 2);

  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    const u0 = (i / segments) * sx;
    const u1 = ((i + 1) / segments) * sx;

    // Side quad
    faces.push(
      makeFace(
        `cyl-side-${i}`,
        [i, next, segments + next, segments + i],
        [
          uvClean(u0, sy),
          uvClean(u1, sy),
          uvClean(u1, 0),
          uvClean(u0, 0),
        ],
        materialId
      )
    );

    // Top fan triangle
    faces.push(
      makeFace(
        `cyl-top-${i}`,
        [topCenterIdx, segments + i, segments + next],
        [centerUv, capUvs[i], capUvs[next]],
        materialId
      )
    );

    // Bottom fan triangle
    faces.push(
      makeFace(
        `cyl-bot-${i}`,
        [botCenterIdx, next, i],
        [centerUv, capUvs[next], capUvs[i]],
        materialId
      )
    );
  }

  return { vertices, faces };
}

function buildConeMesh(
  sx: number,
  sy: number,
  sz: number,
  segments: number,
  materialId: string
): PolyMeshData {
  const hx = sx / 2;
  const hz = sz / 2;
  const vertices: Vec3[] = [];

  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    vertices.push(vec3Clean(hx * Math.cos(theta), 0, -hz * Math.sin(theta)));
  }
  const botCenterIdx = vertices.length;
  vertices.push([0, 0, 0]);
  const apexIdx = vertices.length;
  vertices.push(vec3Clean(0, sy, 0));

  const capUvs: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    capUvs.push(
      uvClean(
        (0.5 + 0.5 * Math.cos(theta)) * sx,
        (0.5 - 0.5 * Math.sin(theta)) * sz
      )
    );
  }
  const centerUv = uvClean(sx / 2, sz / 2);

  const faces: PolyFace[] = [];
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    const u0 = (i / segments) * sx;
    const u1 = ((i + 1) / segments) * sx;

    faces.push(
      makeFace(
        `cone-side-${i}`,
        [i, next, apexIdx],
        [uvClean(u0, sy), uvClean(u1, sy), uvClean((u0 + u1) * 0.5, 0)],
        materialId
      )
    );

    faces.push(
      makeFace(
        `cone-bot-${i}`,
        [botCenterIdx, next, i],
        [centerUv, capUvs[next], capUvs[i]],
        materialId
      )
    );
  }

  return { vertices, faces };
}

function buildPyramidMesh(
  sx: number,
  sy: number,
  sz: number,
  materialId: string
): PolyMeshData {
  const hx = sx / 2;
  const hz = sz / 2;
  const vertices: Vec3[] = [
    vec3Clean(-hx, 0, hz), // 0: front-left
    vec3Clean(hx, 0, hz), // 1: front-right
    vec3Clean(hx, 0, -hz), // 2: back-right
    vec3Clean(-hx, 0, -hz), // 3: back-left
    vec3Clean(0, sy, 0), // 4: apex
  ];
  const faces: PolyFace[] = [
    makeFace(
      "pyr-bottom",
      [3, 2, 1, 0],
      [uvClean(0, 0), uvClean(sx, 0), uvClean(sx, sz), uvClean(0, sz)],
      materialId
    ),
    makeFace(
      "pyr-front",
      [0, 1, 4],
      [uvClean(0, sy), uvClean(sx, sy), uvClean(sx / 2, 0)],
      materialId
    ),
    makeFace(
      "pyr-right",
      [1, 2, 4],
      [uvClean(0, sy), uvClean(sz, sy), uvClean(sz / 2, 0)],
      materialId
    ),
    makeFace(
      "pyr-back",
      [2, 3, 4],
      [uvClean(0, sy), uvClean(sx, sy), uvClean(sx / 2, 0)],
      materialId
    ),
    makeFace(
      "pyr-left",
      [3, 0, 4],
      [uvClean(0, sy), uvClean(sz, sy), uvClean(sz / 2, 0)],
      materialId
    ),
  ];
  return { vertices, faces };
}

function buildIcosphereMesh(
  sx: number,
  sy: number,
  sz: number,
  materialId: string
): PolyMeshData {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const t = (1 + Math.sqrt(5)) / 2;
  const invLen = 1 / Math.hypot(1, t);

  const rawDirs: Vec3[] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map(([x, y, z]): Vec3 => [x * invLen, y * invLen, z * invLen]);

  const vertices: Vec3[] = rawDirs.map(([nx, ny, nz]) =>
    vec3Clean(nx * hx, hy + ny * hy, nz * hz)
  );

  const rawTris: Array<[number, number, number]> = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  const center: Vec3 = [0, hy, 0];
  const faces: PolyFace[] = rawTris.map((tri, idx) => {
    let [a, b, c] = tri;
    const va = vertices[a];
    const vb = vertices[b];
    const vc = vertices[c];
    const normal = vec3Cross(vec3Sub(vb, va), vec3Sub(vc, va));
    const faceMid: Vec3 = [
      (va[0] + vb[0] + vc[0]) / 3,
      (va[1] + vb[1] + vc[1]) / 3,
      (va[2] + vb[2] + vc[2]) / 3,
    ];
    if (vec3Dot(normal, vec3Sub(faceMid, center)) < 0) {
      [b, c] = [c, b];
    }

    const triIndices = [a, b, c];
    const rawUvs = triIndices.map((vi): Vec2 => {
      const [nx, ny, nz] = rawDirs[vi];
      const u = (Math.atan2(nx, nz) / (Math.PI * 2) + 0.5) * sx;
      const v =
        (0.5 - Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI) * sy;
      return [u, v];
    });

    // Unwrap seam-crossing triangles so U coordinates stay continuous
    const us = rawUvs.map((p) => p[0]);
    if (Math.max(...us) - Math.min(...us) > sx * 0.5) {
      for (const uv of rawUvs) {
        if (uv[0] < sx * 0.5) {
          uv[0] += sx;
        }
      }
    }

    return makeFace(
      `ico-${idx}`,
      triIndices,
      rawUvs.map(([u, v]) => uvClean(u, v)),
      materialId
    );
  });

  return { vertices, faces };
}

export function createPrimitiveNode(
  kind: PrimitiveKind,
  options?: CreatePrimitiveOptions
): ModelNode {
  const entry = PRIMITIVE_CATALOG.find((item) => item.kind === kind);
  const defaultSize: Vec3 = entry ? entry.defaultSizePx : [16, 16, 16];
  const sx = clampDim(options?.sizePx?.[0], defaultSize[0]);
  const sy = clampDim(options?.sizePx?.[1], defaultSize[1]);
  const sz = clampDim(options?.sizePx?.[2], defaultSize[2]);
  const segments = clampSegments(options?.segments);
  const materialId = options?.materialId?.trim() || DEFAULT_MODEL3D_MATERIAL_ID;

  const id = options?.id?.trim() || `${kind}-${nextPrimitiveSeq++}`;
  const name = options?.name?.trim() || entry?.label || kind;
  const transform = createDefaultTransform({
    position: options?.position,
    pivot: options?.pivot,
  });

  if (kind === "cuboid") {
    const cuboid = createDefaultCuboidData(
      vec3Clean(-sx / 2, 0, -sz / 2),
      vec3Clean(sx / 2, sy, sz / 2),
      materialId
    );
    applyBoxUvLayout(cuboid, [0, 0]);
    return {
      id,
      name,
      kind: "cuboid",
      parentId: options?.parentId ?? null,
      visible: true,
      locked: false,
      collider: "none",
      transform,
      cuboid,
    };
  }

  let mesh: PolyMeshData;
  switch (kind) {
    case "plane":
      mesh = buildPlaneMesh(sx, sz, materialId);
      break;
    case "crossBillboard":
      mesh = buildCrossBillboardMesh(sx, sy, sz, materialId);
      break;
    case "wedge":
      mesh = buildWedgeMesh(sx, sy, sz, materialId);
      break;
    case "prism":
      mesh = buildPrismMesh(sx, sy, sz, materialId);
      break;
    case "cylinder":
      mesh = buildCylinderMesh(sx, sy, sz, segments, materialId);
      break;
    case "cone":
      mesh = buildConeMesh(sx, sy, sz, segments, materialId);
      break;
    case "pyramid":
      mesh = buildPyramidMesh(sx, sy, sz, materialId);
      break;
    case "icosphere":
      mesh = buildIcosphereMesh(sx, sy, sz, materialId);
      break;
  }

  return {
    id,
    name,
    kind: "mesh",
    parentId: options?.parentId ?? null,
    visible: true,
    locked: false,
    collider: "none",
    transform,
    mesh,
  };
}

function makeCuboidSpec(
  from: Vec3,
  to: Vec3,
  boxUvOrigin: Vec2,
  materialId: string,
  mirrorUvX = false
): CuboidData {
  const cuboid = createDefaultCuboidData(from, to, materialId);
  cuboid.mirrorUvX = mirrorUvX;
  return applyBoxUvLayout(cuboid, boxUvOrigin);
}

function buildSwordBladeMesh(materialId: string): PolyMeshData {
  // Base y=9..22 tapered shaft + y=22..26 pyramid tip
  const vertices: Vec3[] = [
    [-1.5, 9, 1], // 0: base front-left
    [1.5, 9, 1], // 1: base front-right
    [1.5, 9, -1], // 2: base back-right
    [-1.5, 9, -1], // 3: base back-left
    [-1, 22, 0.5], // 4: shoulder front-left
    [1, 22, 0.5], // 5: shoulder front-right
    [1, 22, -0.5], // 6: shoulder back-right
    [-1, 22, -0.5], // 7: shoulder back-left
    [0, 26, 0], // 8: tip apex
  ];
  const faces: PolyFace[] = [
    makeFace(
      "blade-base",
      [3, 2, 1, 0],
      [
        [0, 0],
        [3, 0],
        [3, 2],
        [0, 2],
      ],
      materialId
    ),
    makeFace(
      "blade-front",
      [0, 1, 5, 4],
      [
        [0, 13],
        [3, 13],
        [2.5, 0],
        [0.5, 0],
      ],
      materialId
    ),
    makeFace(
      "blade-right",
      [1, 2, 6, 5],
      [
        [0, 13],
        [2, 13],
        [1.5, 0],
        [0.5, 0],
      ],
      materialId
    ),
    makeFace(
      "blade-back",
      [2, 3, 7, 6],
      [
        [0, 13],
        [3, 13],
        [2.5, 0],
        [0.5, 0],
      ],
      materialId
    ),
    makeFace(
      "blade-left",
      [3, 0, 4, 7],
      [
        [0, 13],
        [2, 13],
        [1.5, 0],
        [0.5, 0],
      ],
      materialId
    ),
    makeFace(
      "tip-front",
      [4, 5, 8],
      [
        [0, 4],
        [2, 4],
        [1, 0],
      ],
      materialId
    ),
    makeFace(
      "tip-right",
      [5, 6, 8],
      [
        [0, 4],
        [1, 4],
        [0.5, 0],
      ],
      materialId
    ),
    makeFace(
      "tip-back",
      [6, 7, 8],
      [
        [0, 4],
        [2, 4],
        [1, 0],
      ],
      materialId
    ),
    makeFace(
      "tip-left",
      [7, 4, 8],
      [
        [0, 4],
        [1, 4],
        [0.5, 0],
      ],
      materialId
    ),
  ];
  return { vertices, faces };
}

export function instantiateStarterTemplate(
  engine: Model3DEngine,
  kind: StarterTemplateKind,
  materialId?: string
): ModelNode[] {
  const matId =
    materialId?.trim() ||
    engine.materials[0]?.id ||
    DEFAULT_MODEL3D_MATERIAL_ID;
  const created: ModelNode[] = [];

  if (kind === "chibi16") {
    const root = engine.addGroup({
      name: "Chibi_Root",
      transform: { pivot: [0, 0, 0] },
    });
    created.push(root);

    created.push(
      engine.addNode({
        kind: "cuboid",
        name: "Torso",
        parentId: root.id,
        transform: { pivot: [0, 4, 0] },
        cuboid: makeCuboidSpec([-3, 4, -2], [3, 8, 2], [0, 16], matId),
      }),
      engine.addNode({
        kind: "cuboid",
        name: "Head",
        parentId: root.id,
        transform: { pivot: [0, 8, 0] },
        cuboid: makeCuboidSpec([-4, 8, -4], [4, 16, 4], [0, 0], matId),
      }),
      engine.addNode({
        kind: "cuboid",
        name: "Arm_L",
        parentId: root.id,
        transform: { pivot: [3, 8, 0] },
        cuboid: makeCuboidSpec([3, 4, -1], [5, 8, 1], [20, 16], matId, false),
      }),
      engine.addNode({
        kind: "cuboid",
        name: "Arm_R",
        parentId: root.id,
        transform: { pivot: [-3, 8, 0] },
        cuboid: makeCuboidSpec([-5, 4, -1], [-3, 8, 1], [28, 16], matId, true),
      }),
      engine.addNode({
        kind: "cuboid",
        name: "Leg_L",
        parentId: root.id,
        transform: { pivot: [1, 4, 0] },
        cuboid: makeCuboidSpec([0, 0, -2], [2, 4, 2], [0, 24], matId),
      }),
      engine.addNode({
        kind: "cuboid",
        name: "Leg_R",
        parentId: root.id,
        transform: { pivot: [-1, 4, 0] },
        cuboid: makeCuboidSpec([-2, 0, -2], [0, 4, 2], [12, 24], matId),
      })
    );

    engine.selectNodes([root.id], root.id);
    return created;
  }

  if (kind === "humanoid32") {
    const root = engine.addGroup({
      name: "Humanoid_Root",
      transform: { pivot: [0, 0, 0] },
    });
    created.push(root);

    const pelvis = engine.addNode({
      kind: "cuboid",
      name: "Pelvis",
      parentId: root.id,
      transform: { pivot: [0, 14, 0] },
      cuboid: makeCuboidSpec([-4, 12, -2], [4, 16, 2], [32, 0], matId),
    });
    created.push(pelvis);

    const torso = engine.addNode({
      kind: "cuboid",
      name: "Torso",
      parentId: pelvis.id,
      transform: { pivot: [0, 16, 0] },
      cuboid: makeCuboidSpec([-4, 16, -2], [4, 24, 2], [0, 16], matId),
    });
    created.push(torso);

    created.push(
      engine.addNode({
        kind: "cuboid",
        name: "Head",
        parentId: torso.id,
        transform: { pivot: [0, 24, 0] },
        cuboid: makeCuboidSpec([-4, 24, -4], [4, 32, 4], [0, 0], matId),
      }),
      engine.addNode({
        kind: "cuboid",
        name: "Arm_L",
        parentId: torso.id,
        transform: { pivot: [4, 23, 0] },
        cuboid: makeCuboidSpec([4, 12, -2], [8, 24, 2], [24, 16], matId, false),
      }),
      engine.addNode({
        kind: "cuboid",
        name: "Arm_R",
        parentId: torso.id,
        transform: { pivot: [-4, 23, 0] },
        cuboid: makeCuboidSpec([-8, 12, -2], [-4, 24, 2], [40, 16], matId, true),
      }),
      engine.addNode({
        kind: "cuboid",
        name: "Leg_L",
        parentId: pelvis.id,
        transform: { pivot: [2, 12, 0] },
        cuboid: makeCuboidSpec([0, 0, -2], [4, 12, 2], [0, 32], matId, false),
      }),
      engine.addNode({
        kind: "cuboid",
        name: "Leg_R",
        parentId: pelvis.id,
        transform: { pivot: [-2, 12, 0] },
        cuboid: makeCuboidSpec([-4, 0, -2], [0, 12, 2], [16, 32], matId, true),
      })
    );

    engine.selectNodes([root.id], root.id);
    return created;
  }

  if (kind === "weaponProp") {
    const root = engine.addGroup({
      name: "Sword_Root",
      transform: { pivot: [0, 0, 0] },
    });
    created.push(root);

    created.push(
      engine.addNode({
        kind: "cuboid",
        name: "Pommel",
        parentId: root.id,
        transform: { pivot: [0, 1, 0] },
        cuboid: makeCuboidSpec([-2, 0, -2], [2, 2, 2], [0, 0], matId),
      }),
      engine.addNode({
        kind: "cuboid",
        name: "Grip",
        parentId: root.id,
        transform: { pivot: [0, 4, 0] },
        cuboid: makeCuboidSpec([-1, 2, -1], [1, 7, 1], [16, 0], matId),
      }),
      engine.addNode({
        kind: "cuboid",
        name: "Crossguard",
        parentId: root.id,
        transform: { pivot: [0, 8, 0] },
        cuboid: makeCuboidSpec([-5, 7, -1.5], [5, 9, 1.5], [0, 8], matId),
      }),
      engine.addNode({
        kind: "mesh",
        name: "Blade",
        parentId: root.id,
        transform: { pivot: [0, 9, 0] },
        mesh: buildSwordBladeMesh(matId),
      })
    );

    engine.selectNodes([root.id], root.id);
    return created;
  }

  // "dungeonChunk"
  const root = engine.addGroup({
    name: "Room_Root",
    transform: { pivot: [0, 0, 0] },
  });
  created.push(root);

  const floorSpec = createPrimitiveNode("plane", {
    name: "Floor",
    sizePx: [32, 16, 32],
    materialId: matId,
    parentId: root.id,
  });

  created.push(
    engine.addNode({
      kind: "mesh",
      name: "Floor",
      parentId: root.id,
      transform: floorSpec.transform,
      mesh: floorSpec.mesh,
    }),
    engine.addNode({
      kind: "cuboid",
      name: "Wall_North",
      parentId: root.id,
      transform: { pivot: [0, 0, -15] },
      cuboid: makeCuboidSpec([-16, 0, -16], [16, 24, -14], [0, 0], matId),
    }),
    engine.addNode({
      kind: "cuboid",
      name: "Wall_West",
      parentId: root.id,
      transform: { pivot: [-15, 0, 1] },
      cuboid: makeCuboidSpec([-16, 0, -14], [-14, 24, 16], [0, 28], matId),
    }),
    engine.addNode({
      kind: "cuboid",
      name: "Pillar_Corner",
      parentId: root.id,
      transform: { pivot: [-13.5, 0, -13.5] },
      cuboid: makeCuboidSpec([-16, 0, -16], [-11, 26, -11], [72, 0], matId),
    })
  );

  engine.selectNodes([root.id], root.id);
  return created;
}
