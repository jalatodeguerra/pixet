import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// `src/components/studio3d/three/*` and `src/store/editorStore.ts` use extensionless
// relative TypeScript imports for Vite; register a local-only ESM resolve hook so
// Node 22 `--experimental-strip-types` can import `modelExporter.ts` and
// `modelSpriteBaker.ts` directly without modifying any files outside this test.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[a-zA-Z0-9]+$/.test(specifier) &&
      context.parentURL?.startsWith("file:")
    ) {
      const candidateTs = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(candidateTs))) {
        return nextResolve(specifier + ".ts", context);
      }
      const candidateTsx = new URL(specifier + ".tsx", context.parentURL);
      if (existsSync(fileURLToPath(candidateTsx))) {
        return nextResolve(specifier + ".tsx", context);
      }
    }
    return nextResolve(specifier, context);
  },
});

import { PixelBuffer, type RGBA } from "../src/engine/document/PixelBuffer.ts";
import {
  createModelClip,
  evaluateNodePoseAtFrame,
  evaluateWorldNodeTransforms,
  recordNodeTransformKeyframes,
} from "../src/engine/model3d/animEval.ts";
import {
  computeFaceNormal,
  convertNodeCuboidToMesh,
  extrudeFaces,
} from "../src/engine/model3d/meshOps.ts";
import { Model3DEngine } from "../src/engine/model3d/Model3DEngine.ts";
import {
  createPrimitiveNode,
  instantiateStarterTemplate,
} from "../src/engine/model3d/primitives.ts";
import { vec3Length } from "../src/engine/model3d/quatMath.ts";
import {
  deserializeModel3DScene,
  serializeModel3DScene,
} from "../src/engine/model3d/serialization.ts";
import { autoPackModelUvs } from "../src/engine/model3d/uvOps.ts";

const { exportModelToObj, patchGlbNearestSamplers } = await import(
  "../src/components/studio3d/three/modelExporter.ts"
);
const { postProcessBakedSpriteBuffer } = await import(
  "../src/components/studio3d/three/modelSpriteBaker.ts"
);

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_CHUNK_JSON = 0x4e4f534a;
const GLB_CHUNK_BIN = 0x004e4942;

function buildSyntheticGlb(
  jsonObj: Record<string, unknown>,
  binPayload: Uint8Array
): ArrayBuffer {
  const rawJson = new TextEncoder().encode(JSON.stringify(jsonObj));
  const paddedJsonLen = Math.ceil(rawJson.byteLength / 4) * 4;
  const paddedJson = new Uint8Array(paddedJsonLen);
  paddedJson.set(rawJson);
  for (let i = rawJson.byteLength; i < paddedJsonLen; i++) {
    paddedJson[i] = 0x20;
  }

  const paddedBinLen = Math.ceil(binPayload.byteLength / 4) * 4;
  const paddedBin = new Uint8Array(paddedBinLen);
  paddedBin.set(binPayload);

  const totalLen = 12 + 8 + paddedJsonLen + 8 + paddedBinLen;
  const buf = new ArrayBuffer(totalLen);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, totalLen, true);

  view.setUint32(12, paddedJsonLen, true);
  view.setUint32(16, GLB_CHUNK_JSON, true);
  bytes.set(paddedJson, 20);

  const binHeaderOffset = 20 + paddedJsonLen;
  view.setUint32(binHeaderOffset, paddedBinLen, true);
  view.setUint32(binHeaderOffset + 4, GLB_CHUNK_BIN, true);
  bytes.set(paddedBin, binHeaderOffset + 8);

  return buf;
}

test("W3-1B patchGlbNearestSamplers: forces 9728 nearest samplers, 4-byte 0x20 JSON padding, and bit-exact BIN chunk", () => {
  const binBytes = new Uint8Array([
    0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
    0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
  ]);
  const syntheticGltf = {
    asset: { version: "2.0" },
    samplers: [
      { magFilter: 9729, minFilter: 9729, wrapS: 10497, wrapT: 10497 },
      { magFilter: 9729, minFilter: 9987 },
    ],
    textures: [{ source: 0, sampler: 0 }, { source: 1 }],
    buffers: [{ byteLength: binBytes.byteLength }],
  };

  const rawGlb = buildSyntheticGlb(syntheticGltf, binBytes);
  const patchedGlb = patchGlbNearestSamplers(rawGlb);

  const view = new DataView(patchedGlb);
  assert.equal(view.getUint32(0, true), GLB_MAGIC);
  assert.equal(view.getUint32(4, true), GLB_VERSION);

  const totalLength = view.getUint32(8, true);
  assert.equal(totalLength, patchedGlb.byteLength);

  const jsonLen = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);
  assert.equal(jsonType, GLB_CHUNK_JSON);
  assert.equal(jsonLen % 4, 0);

  const jsonBytes = new Uint8Array(patchedGlb, 20, jsonLen);
  const jsonStr = new TextDecoder().decode(jsonBytes);
  // Any trailing alignment bytes must be 0x20 ASCII spaces
  const trimmedEnd = jsonStr.replace(/ +$/, "");
  const padByteCount = jsonLen - new TextEncoder().encode(trimmedEnd).byteLength;
  for (let i = jsonLen - padByteCount; i < jsonLen; i++) {
    assert.equal(jsonBytes[i], 0x20);
  }

  const parsed = JSON.parse(jsonStr) as {
    samplers: Array<{ magFilter?: number; minFilter?: number }>;
    textures: Array<{ sampler?: number }>;
  };
  assert.equal(parsed.samplers.length, 2);
  for (const sampler of parsed.samplers) {
    assert.equal(sampler.magFilter, 9728);
    assert.equal(sampler.minFilter, 9728);
  }
  assert.equal(parsed.textures[1].sampler, 0);

  const binOffset = 20 + jsonLen;
  assert.equal(view.getUint32(binOffset, true), binBytes.byteLength);
  assert.equal(view.getUint32(binOffset + 4, true), GLB_CHUNK_BIN);
  assert.equal(totalLength, binOffset + 8 + binBytes.byteLength);

  const outBin = new Uint8Array(patchedGlb, binOffset + 8, binBytes.byteLength);
  assert.deepEqual(Array.from(outBin), Array.from(binBytes));
});

test("W3-1B exportModelToObj: preserves 4-vertex quads when triangulate=false, splits into 3-vertex tris when triangulate=true, and emits valid MTL", async () => {
  const engine = new Model3DEngine();
  engine.pixelsPerUnit = 16;

  const rootGroup = engine.addGroup({
    name: "Root Rig",
    transform: { pivot: [0, 0, 0], position: [0, 0, 0] },
  });

  // Base cuboid (6 quad faces)
  const baseCuboid = createPrimitiveNode("cuboid", {
    name: "BaseCuboid",
    sizePx: [8, 8, 8],
    parentId: rootGroup.id,
    position: [0, 0, 0],
    pivot: [0, 4, 0],
  });
  engine.addNode(baseCuboid);

  // Wedge primitive (3 quad faces + 2 triangle faces)
  const wedge = createPrimitiveNode("wedge", {
    name: "SlopeWedge",
    sizePx: [8, 8, 8],
    parentId: rootGroup.id,
    position: [16, 0, 0],
  });
  engine.addNode(wedge);

  // Hierarchical child cuboid attached to BaseCuboid with non-zero local transform
  const parentCuboidNode = engine.nodes.find((n) => n.name === "BaseCuboid")!;
  const childCuboid = createPrimitiveNode("cuboid", {
    name: "ChildTurret",
    sizePx: [4, 4, 4],
    parentId: parentCuboidNode.id,
    position: [0, 8, 0],
    pivot: [0, 8, 0],
  });
  engine.addNode(childCuboid);

  const commonOpts = {
    layers: [],
    currentFrame: 0,
    canvasWidth: 32,
    canvasHeight: 32,
  };

  const quadRes = await exportModelToObj(
    engine,
    { ...commonOpts, triangulate: false },
    "TestAsset"
  );

  assert.ok(quadRes.objText.includes("mtllib TestAsset.mtl"));
  assert.ok(quadRes.objText.includes("o BaseCuboid"));
  assert.ok(quadRes.objText.includes("o SlopeWedge"));
  assert.ok(quadRes.objText.includes("o ChildTurret"));
  assert.ok(quadRes.mtlText.includes("newmtl "));
  assert.ok(quadRes.mtlText.includes("Kd 1.000000 1.000000 1.000000"));
  assert.ok(quadRes.mtlText.includes("map_Kd TestAsset_"));
  assert.equal(quadRes.textures.length, 1);

  const quadFaceLines = quadRes.objText
    .split("\n")
    .filter((line) => line.startsWith("f "));
  // 6 (base) + 5 (wedge: 3 quads + 2 tris) + 6 (child) = 17 faces
  assert.equal(quadFaceLines.length, 17);

  const quadFaces = quadFaceLines.filter(
    (line) => line.trim().split(/\s+/).slice(1).length === 4
  );
  const triFacesInQuadMode = quadFaceLines.filter(
    (line) => line.trim().split(/\s+/).slice(1).length === 3
  );
  assert.equal(quadFaces.length, 15);
  assert.equal(triFacesInQuadMode.length, 2);

  // Verify child cuboid vertices sit above base cuboid (y >= 8 / 16 = 0.5)
  const childSection = quadRes.objText.split("o ChildTurret")[1] ?? "";
  const childVLines = childSection
    .split("\n")
    .filter((line) => line.startsWith("v "));
  assert.ok(childVLines.length > 0);
  for (const vLine of childVLines) {
    const [, , yStr] = vLine.trim().split(/\s+/);
    const yVal = Number(yStr);
    assert.ok(yVal >= 0.499, `expected ChildTurret y >= 0.5, got ${yVal}`);
  }

  const triRes = await exportModelToObj(
    engine,
    { ...commonOpts, triangulate: true },
    "TestAsset"
  );
  const triFaceLines = triRes.objText
    .split("\n")
    .filter((line) => line.startsWith("f "));
  // 15 quads * 2 tris + 2 existing tris = 32 triangles
  assert.equal(triFaceLines.length, 32);
  for (const fLine of triFaceLines) {
    const tokens = fLine.trim().split(/\s+/).slice(1);
    assert.equal(tokens.length, 3, `expected 3-vertex triangle face: ${fLine}`);
  }
});

test("W3-1B postProcessBakedSpriteBuffer: binary alpha cutoff, palette quantization, and 4-connected outside 1px outline", () => {
  const buf = new PixelBuffer(5, 5);
  // Center pixel with a=200 (above default 128 cutoff) and off-palette warm color
  buf.setPixel(2, 2, 240, 50, 40, 200);
  // Neighboring faint fringe pixel with a=60 (below 128 cutoff)
  buf.setPixel(1, 2, 120, 220, 90, 60);
  // Another opaque-ish pixel (2,1) with off-palette blue-ish color
  buf.setPixel(2, 1, 30, 80, 230, 210);

  const palette: RGBA[] = [
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 255, 255],
  ];
  const outlineColor: RGBA = [16, 18, 22, 255];

  const processed = postProcessBakedSpriteBuffer(buf, {
    alphaCutoff: 128,
    quantizeToPalette: true,
    ditherMode: "none",
    paletteRgba: palette,
    outline: "outside",
    outlineColor,
  });

  // Alpha=200 promoted to 255 and snapped strictly to palette red/blue
  assert.deepEqual(processed.getPixel(2, 2), [255, 0, 0, 255]);
  assert.deepEqual(processed.getPixel(2, 1), [0, 0, 255, 255]);

  // (1,2) had a=60 so binary cutoff cleared it to [0,0,0,0], then outside 4-connected
  // outline colored it because it borders (2,2)
  assert.deepEqual(processed.getPixel(1, 2), outlineColor);

  // Verify exact 4-connected outline set around {(2,1), (2,2)} without diagonal bleed
  const expectedOutlineCoords = new Set([
    "2,0",
    "1,1",
    "3,1",
    "1,2",
    "3,2",
    "2,3",
  ]);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      if ((x === 2 && y === 2) || (x === 2 && y === 1)) continue;
      const px = processed.getPixel(x, y);
      if (expectedOutlineCoords.has(`${x},${y}`)) {
        assert.deepEqual(px, outlineColor, `expected outline at (${x},${y})`);
      } else {
        assert.deepEqual(px, [0, 0, 0, 0], `expected transparent at (${x},${y})`);
      }
    }
  }

  // Also check standalone binary alpha cutoff without outline: a=60 -> [0,0,0,0]
  const cutoffOnly = postProcessBakedSpriteBuffer(buf, {
    alphaCutoff: 128,
    quantizeToPalette: false,
    outline: "none",
  });
  assert.deepEqual(cutoffOnly.getPixel(1, 2), [0, 0, 0, 0]);
  assert.deepEqual(cutoffOnly.getPixel(2, 2), [240, 50, 40, 255]);
});

test("W3-1B end-to-end pure engine pipeline: instantiateStarterTemplate('chibi16') -> convertNodeCuboidToMesh -> extrudeFaces -> autoPackModelUvs -> clip/keyframes -> serialize/deserialize", () => {
  const engine = new Model3DEngine();
  const created = instantiateStarterTemplate(engine, "chibi16");
  assert.ok(created.length >= 7);

  const headNode = engine.nodes.find((n) => n.name === "Head");
  assert.ok(headNode && headNode.kind === "cuboid");

  // 1. Convert Head cuboid to editable mesh and extrude its +Y top face
  const headMeshNode = convertNodeCuboidToMesh(headNode);
  assert.equal(headMeshNode.kind, "mesh");
  assert.ok(headMeshNode.mesh);
  assert.equal(headMeshNode.mesh.faces.length, 6);

  const upFace = headMeshNode.mesh.faces.find((f) => f.id === "cuboid-up");
  assert.ok(upFace);
  const extruded = extrudeFaces(headMeshNode.mesh, [upFace.id], 2);
  assert.equal(extruded.extrudedFaceIds.length, 1);
  assert.equal(extruded.sideFaceIds.length, 4);
  assert.equal(extruded.mesh.faces.length, 10);

  for (const face of extruded.mesh.faces) {
    assert.equal(face.uvs.length, face.verts.length);
    const n = computeFaceNormal(extruded.mesh.vertices, face);
    assert.ok(
      Math.abs(vec3Length(n) - 1) < 1e-4,
      `face ${face.id} should have unit normal`
    );
  }

  // Replace Head node in engine with the extruded mesh node
  engine.nodes = engine.nodes.map((n) =>
    n.id === headNode.id ? { ...headMeshNode, mesh: extruded.mesh } : n
  );

  // 2. Auto-pack all model UVs into a 64x64 texture atlas
  const packed = autoPackModelUvs(engine.nodes, 64, 64, 1);
  assert.equal(packed.overflowCount, 0);
  assert.ok(packed.packedCount > 0);
  engine.nodes = packed.nodes;

  const packedHead = engine.nodes.find((n) => n.id === headNode.id);
  assert.ok(packedHead?.mesh);
  for (const face of packedHead.mesh.faces) {
    for (const [u, v] of face.uvs) {
      assert.ok(u >= 0 && u <= 64, `packed u=${u} out of 64x64 bounds`);
      assert.ok(v >= 0 && v <= 64, `packed v=${v} out of 64x64 bounds`);
    }
  }

  // 3. Create animation clip and record transform keyframes for Head
  let clip = createModelClip("Nod", 10, 12, true);
  const headPose0 = engine.getNode(headNode.id)!;
  clip = recordNodeTransformKeyframes(clip, headPose0, 0, "linear");

  engine.updateNode(headNode.id, {
    transform: { rotation: [30, 0, 0] },
  });
  const headPose4 = engine.getNode(headNode.id)!;
  clip = recordNodeTransformKeyframes(clip, headPose4, 4, "linear");

  engine.clips = [clip];
  engine.activeClipId = clip.id;

  // 4. Serialize -> JSON -> Deserialize -> Reload into fresh engine
  const serialized = serializeModel3DScene(engine.toSnapshot());
  const roundTrippedJson = JSON.parse(JSON.stringify(serialized)) as unknown;
  const deserialized = deserializeModel3DScene(roundTrippedJson);

  const reloaded = new Model3DEngine();
  reloaded.loadSnapshot(deserialized);

  assert.equal(reloaded.nodes.length, engine.nodes.length);
  assert.equal(reloaded.clips.length, 1);
  assert.equal(reloaded.activeClipId, clip.id);

  const reloadedHead = reloaded.getNode(headNode.id);
  assert.ok(reloadedHead && reloadedHead.kind === "mesh");
  assert.equal(reloadedHead.mesh?.faces.length, 10);

  const reloadedClip = reloaded.clips[0];
  const midPose = evaluateNodePoseAtFrame(reloadedHead, reloadedClip, 2);
  assert.ok(
    Math.abs(midPose.rotation[0] - 15) < 1e-2,
    `expected interpolated rotX ~ 15 deg at frame 2, got ${midPose.rotation[0]}`
  );

  const worldTransforms = evaluateWorldNodeTransforms(reloaded.nodes);
  const headWorld = worldTransforms.get(headNode.id);
  assert.ok(headWorld);
  assert.deepEqual(headWorld.worldPivot, [0, 8, 0]);
});
