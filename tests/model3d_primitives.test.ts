import test from "node:test";
import assert from "node:assert/strict";

import { Model3DEngine } from "../src/engine/model3d/Model3DEngine.ts";
import {
  createPrimitiveNode,
  PRIMITIVE_CATALOG,
  STARTER_TEMPLATE_CATALOG,
  instantiateStarterTemplate,
  type PrimitiveKind,
  type StarterTemplateKind,
} from "../src/engine/model3d/primitives.ts";
import { vec3Cross, vec3Dot, vec3Sub } from "../src/engine/model3d/quatMath.ts";
import {
  deserializeModel3DScene,
  serializeModel3DScene,
} from "../src/engine/model3d/serialization.ts";
import type { PolyMeshData, Vec3 } from "../src/engine/model3d/types.ts";

function computeMeshCentroid(mesh: PolyMeshData): Vec3 {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const v of mesh.vertices) {
    sx += v[0];
    sy += v[1];
    sz += v[2];
  }
  const n = mesh.vertices.length;
  return [sx / n, sy / n, sz / n];
}

function assertValidMesh(
  mesh: PolyMeshData,
  label: string,
  checkClosedOutwardNormals: boolean
): void {
  assert.ok(mesh.vertices.length > 0, `${label}: expected vertices`);
  assert.ok(mesh.faces.length > 0, `${label}: expected faces`);

  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    assert.equal(v.length, 3, `${label}: vertex ${i} length`);
    for (let c = 0; c < 3; c++) {
      assert.ok(Number.isFinite(v[c]), `${label}: vertex ${i}[${c}] finite`);
    }
  }

  const centroid = computeMeshCentroid(mesh);

  for (const face of mesh.faces) {
    assert.ok(
      face.verts.length === 3 || face.verts.length === 4,
      `${label} face ${face.id}: expected 3 or 4 verts`
    );
    assert.equal(
      face.uvs.length,
      face.verts.length,
      `${label} face ${face.id}: uvs length matches verts`
    );

    const uniqueVerts = new Set(face.verts);
    assert.equal(
      uniqueVerts.size,
      face.verts.length,
      `${label} face ${face.id}: distinct vertex indices`
    );

    for (const vi of face.verts) {
      assert.ok(
        Number.isInteger(vi) && vi >= 0 && vi < mesh.vertices.length,
        `${label} face ${face.id}: valid vertex index ${vi}`
      );
    }

    for (let ui = 0; ui < face.uvs.length; ui++) {
      const [u, v] = face.uvs[ui];
      assert.ok(
        Number.isFinite(u) && Number.isFinite(v),
        `${label} face ${face.id}: finite UV[${ui}]`
      );
      assert.ok(
        u >= 0 && v >= 0,
        `${label} face ${face.id}: non-negative pixel UV[${ui}] (${u}, ${v})`
      );
    }

    if (checkClosedOutwardNormals) {
      const v0 = mesh.vertices[face.verts[0]];
      const v1 = mesh.vertices[face.verts[1]];
      const v2 = mesh.vertices[face.verts[2]];
      const normal = vec3Cross(vec3Sub(v1, v0), vec3Sub(v2, v0));

      let fx = 0;
      let fy = 0;
      let fz = 0;
      for (const vi of face.verts) {
        fx += mesh.vertices[vi][0];
        fy += mesh.vertices[vi][1];
        fz += mesh.vertices[vi][2];
      }
      const faceCenter: Vec3 = [
        fx / face.verts.length,
        fy / face.verts.length,
        fz / face.verts.length,
      ];
      const outwardDir = vec3Sub(faceCenter, centroid);
      const dot = vec3Dot(normal, outwardDir);
      assert.ok(
        dot > 0,
        `${label} face ${face.id}: outward normal dot product must be > 0, got ${dot}`
      );
    }
  }
}

test("M1-A primitives: catalog covers all 9 primitive kinds with valid geometry, winding, and UVs", () => {
  const expectedKinds: PrimitiveKind[] = [
    "cuboid",
    "plane",
    "crossBillboard",
    "wedge",
    "prism",
    "cylinder",
    "cone",
    "pyramid",
    "icosphere",
  ];
  assert.deepEqual(
    PRIMITIVE_CATALOG.map((p) => p.kind),
    expectedKinds
  );

  // Cuboid
  const cuboidNode = createPrimitiveNode("cuboid", {
    sizePx: [10, 12, 8],
    materialId: "mat-custom",
  });
  assert.equal(cuboidNode.kind, "cuboid");
  assert.ok(cuboidNode.cuboid);
  assert.deepEqual(cuboidNode.cuboid.from, [-5, 0, -4]);
  assert.deepEqual(cuboidNode.cuboid.to, [5, 12, 4]);
  assert.equal(cuboidNode.cuboid.uvMode, "box");
  assert.deepEqual(cuboidNode.cuboid.faces.up.uv, [8, 0, 18, 8]);
  assert.deepEqual(cuboidNode.cuboid.faces.down.uv, [18, 0, 28, 8]);
  assert.deepEqual(cuboidNode.cuboid.faces.west.uv, [0, 8, 8, 20]);
  assert.deepEqual(cuboidNode.cuboid.faces.north.uv, [8, 8, 18, 20]);
  assert.deepEqual(cuboidNode.cuboid.faces.east.uv, [18, 8, 26, 20]);
  assert.deepEqual(cuboidNode.cuboid.faces.south.uv, [26, 8, 36, 20]);
  assert.equal(cuboidNode.cuboid.faces.north.materialId, "mat-custom");

  // Plane
  const planeNode = createPrimitiveNode("plane", { sizePx: [16, 16, 24] });
  assert.equal(planeNode.kind, "mesh");
  assert.ok(planeNode.mesh);
  assert.equal(planeNode.mesh.vertices.length, 4);
  assert.equal(planeNode.mesh.faces.length, 1);
  assert.equal(planeNode.mesh.faces[0].verts.length, 4);
  for (const v of planeNode.mesh.vertices) {
    assert.equal(v[1], 0);
  }
  assertValidMesh(planeNode.mesh, "plane", false);
  const p0 = planeNode.mesh.vertices[planeNode.mesh.faces[0].verts[0]];
  const p1 = planeNode.mesh.vertices[planeNode.mesh.faces[0].verts[1]];
  const p2 = planeNode.mesh.vertices[planeNode.mesh.faces[0].verts[2]];
  const planeNormal = vec3Cross(vec3Sub(p1, p0), vec3Sub(p2, p0));
  assert.ok(planeNormal[1] > 0, "plane normal points +Y");

  // Cross-Billboard
  const crossNode = createPrimitiveNode("crossBillboard", {
    sizePx: [16, 20, 16],
  });
  assert.equal(crossNode.kind, "mesh");
  assert.ok(crossNode.mesh);
  assert.equal(crossNode.mesh.vertices.length, 8);
  assert.equal(crossNode.mesh.faces.length, 2);
  assertValidMesh(crossNode.mesh, "crossBillboard", false);

  // Wedge
  const wedgeNode = createPrimitiveNode("wedge", { sizePx: [16, 16, 16] });
  assert.equal(wedgeNode.kind, "mesh");
  assert.ok(wedgeNode.mesh);
  assert.equal(wedgeNode.mesh.vertices.length, 6);
  assert.equal(wedgeNode.mesh.faces.length, 5);
  assertValidMesh(wedgeNode.mesh, "wedge", true);

  // Prism
  const prismNode = createPrimitiveNode("prism", { sizePx: [12, 18, 12] });
  assert.equal(prismNode.kind, "mesh");
  assert.ok(prismNode.mesh);
  assert.equal(prismNode.mesh.vertices.length, 6);
  assert.equal(prismNode.mesh.faces.length, 5);
  assertValidMesh(prismNode.mesh, "prism", true);

  // Cylinder (default 8 segments + clamped bounds)
  const cylDefault = createPrimitiveNode("cylinder", { sizePx: [16, 24, 16] });
  assert.equal(cylDefault.kind, "mesh");
  assert.ok(cylDefault.mesh);
  assert.equal(cylDefault.mesh.vertices.length, 8 * 2 + 2);
  assert.equal(cylDefault.mesh.faces.length, 8 * 3);
  assertValidMesh(cylDefault.mesh, "cylinder-8", true);

  const cylClampedMin = createPrimitiveNode("cylinder", { segments: 1 });
  assert.equal(cylClampedMin.mesh?.faces.length, 3 * 3);
  assertValidMesh(cylClampedMin.mesh!, "cylinder-3", true);

  const cylClampedMax = createPrimitiveNode("cylinder", { segments: 64 });
  assert.equal(cylClampedMax.mesh?.faces.length, 16 * 3);
  assertValidMesh(cylClampedMax.mesh!, "cylinder-16", true);

  // Cone
  const coneNode = createPrimitiveNode("cone", {
    sizePx: [16, 20, 16],
    segments: 10,
  });
  assert.equal(coneNode.kind, "mesh");
  assert.ok(coneNode.mesh);
  assert.equal(coneNode.mesh.vertices.length, 10 + 2);
  assert.equal(coneNode.mesh.faces.length, 10 * 2);
  assertValidMesh(coneNode.mesh, "cone-10", true);

  // Pyramid
  const pyramidNode = createPrimitiveNode("pyramid", { sizePx: [16, 16, 16] });
  assert.equal(pyramidNode.kind, "mesh");
  assert.ok(pyramidNode.mesh);
  assert.equal(pyramidNode.mesh.vertices.length, 5);
  assert.equal(pyramidNode.mesh.faces.length, 5);
  assertValidMesh(pyramidNode.mesh, "pyramid", true);

  // Icosphere
  const icoNode = createPrimitiveNode("icosphere", { sizePx: [16, 16, 16] });
  assert.equal(icoNode.kind, "mesh");
  assert.ok(icoNode.mesh);
  assert.equal(icoNode.mesh.vertices.length, 12);
  assert.equal(icoNode.mesh.faces.length, 20);
  assertValidMesh(icoNode.mesh, "icosphere", true);

  // Bounding check: y rests in [0 .. sy] and centered on X/Z
  for (const kind of expectedKinds) {
    const node = createPrimitiveNode(kind, { sizePx: [12, 18, 10] });
    if (node.mesh) {
      const ys = node.mesh.vertices.map((v) => v[1]);
      assert.ok(Math.min(...ys) >= -1e-6, `${kind}: min y >= 0`);
      assert.ok(Math.max(...ys) <= 18 + 1e-6, `${kind}: max y <= sy`);
    }
  }
});

function cuboidUvRectsOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number]
): boolean {
  const ax0 = Math.min(a[0], a[2]);
  const ax1 = Math.max(a[0], a[2]);
  const ay0 = Math.min(a[1], a[3]);
  const ay1 = Math.max(a[1], a[3]);
  const bx0 = Math.min(b[0], b[2]);
  const bx1 = Math.max(b[0], b[2]);
  const by0 = Math.min(b[1], b[3]);
  const by1 = Math.max(b[1], b[3]);
  return ax0 < bx1 && ax1 > bx0 && ay0 < by1 && ay1 > by0;
}

test("M1-A starter templates: hierarchy, pivots, Box-UVs, and serialization round-trip", () => {
  const expectedTemplates: StarterTemplateKind[] = [
    "chibi16",
    "humanoid32",
    "weaponProp",
    "dungeonChunk",
  ];
  assert.deepEqual(
    STARTER_TEMPLATE_CATALOG.map((t) => t.kind),
    expectedTemplates
  );

  // 1. chibi16
  {
    const engine = new Model3DEngine();
    const nodes = instantiateStarterTemplate(engine, "chibi16");
    assert.equal(nodes.length, 7);
    const root = nodes.find((n) => n.name === "Chibi_Root");
    assert.ok(root && root.kind === "group");
    assert.deepEqual(engine.selectedNodeIds, [root.id]);

    const head = nodes.find((n) => n.name === "Head");
    const armR = nodes.find((n) => n.name === "Arm_R");
    assert.ok(head && armR);
    assert.deepEqual(head.transform.pivot, [0, 8, 0]);
    assert.equal(armR.cuboid?.mirrorUvX, true);

    // Check every child points to valid parent & Box-UV faces do not overlap across cuboids
    const faceRects: Array<{
      nodeName: string;
      uv: [number, number, number, number];
    }> = [];
    for (const node of nodes) {
      if (node.parentId !== null) {
        assert.ok(engine.getNode(node.parentId), `valid parent for ${node.name}`);
      }
      if (node.cuboid) {
        for (const face of Object.values(node.cuboid.faces)) {
          faceRects.push({ nodeName: node.name, uv: face.uv });
        }
      }
    }
    for (let i = 0; i < faceRects.length; i++) {
      for (let j = i + 1; j < faceRects.length; j++) {
        assert.equal(
          cuboidUvRectsOverlap(faceRects[i].uv, faceRects[j].uv),
          false,
          `UV overlap between ${faceRects[i].nodeName} and ${faceRects[j].nodeName}`
        );
      }
    }

    const roundTripped = deserializeModel3DScene(
      JSON.parse(JSON.stringify(serializeModel3DScene(engine.toSnapshot())))
    );
    assert.equal(roundTripped.nodes.length, 7);
  }

  // 2. humanoid32
  {
    const engine = new Model3DEngine();
    const nodes = instantiateStarterTemplate(engine, "humanoid32");
    assert.equal(nodes.length, 8);
    const root = nodes.find((n) => n.name === "Humanoid_Root");
    const pelvis = nodes.find((n) => n.name === "Pelvis");
    const torso = nodes.find((n) => n.name === "Torso");
    const head = nodes.find((n) => n.name === "Head");
    const legL = nodes.find((n) => n.name === "Leg_L");
    assert.ok(root && pelvis && torso && head && legL);
    assert.equal(pelvis.parentId, root.id);
    assert.equal(torso.parentId, pelvis.id);
    assert.equal(head.parentId, torso.id);
    assert.equal(legL.parentId, pelvis.id);
    assert.deepEqual(head.cuboid?.to, [4, 32, 4]);
    assert.deepEqual(engine.selectedNodeIds, [root.id]);

    const roundTripped = deserializeModel3DScene(
      JSON.parse(JSON.stringify(serializeModel3DScene(engine.toSnapshot())))
    );
    assert.equal(roundTripped.nodes.length, 8);
  }

  // 3. weaponProp
  {
    const engine = new Model3DEngine();
    const nodes = instantiateStarterTemplate(engine, "weaponProp");
    assert.equal(nodes.length, 5);
    const root = nodes.find((n) => n.name === "Sword_Root");
    const blade = nodes.find((n) => n.name === "Blade");
    assert.ok(root && blade && blade.mesh);
    assert.equal(blade.parentId, root.id);
    assertValidMesh(blade.mesh, "weaponProp-blade", true);

    const roundTripped = deserializeModel3DScene(
      JSON.parse(JSON.stringify(serializeModel3DScene(engine.toSnapshot())))
    );
    assert.equal(roundTripped.nodes.length, 5);
  }

  // 4. dungeonChunk
  {
    const engine = new Model3DEngine();
    const nodes = instantiateStarterTemplate(engine, "dungeonChunk");
    assert.equal(nodes.length, 5);
    const root = nodes.find((n) => n.name === "Room_Root");
    const floor = nodes.find((n) => n.name === "Floor");
    assert.ok(root && floor && floor.mesh);
    assert.equal(floor.parentId, root.id);
    assertValidMesh(floor.mesh, "dungeonChunk-floor", false);

    const roundTripped = deserializeModel3DScene(
      JSON.parse(JSON.stringify(serializeModel3DScene(engine.toSnapshot())))
    );
    assert.equal(roundTripped.nodes.length, 5);
  }
});
