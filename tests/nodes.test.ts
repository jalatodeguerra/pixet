import test from "node:test";
import assert from "node:assert/strict";

import {
  NodeGraphManager,
  addNode,
  computeDownstreamNodes,
  computeReachableNodes,
  connectSockets,
  createEmptyGraph,
  deserializeNodesExt,
  duplicateSelection,
  removeNodes,
  serializeNodesExt,
  spliceNodeOnEdge,
  toggleBypassNodes,
  topologicalSort,
  wouldCreateCycle,
} from "../src/engine/nodes/NodeGraph.ts";
import { NodeHistory } from "../src/engine/nodes/NodeHistory.ts";
import { NodeRegistry, canConnectSockets, linkConversion } from "../src/engine/nodes/NodeRegistry.ts";
import {
  CUSTOM_PALETTE_SOURCE,
  DOCUMENT_PALETTE_SOURCE,
  buildPaletteLutBytes,
  buildRampLutBytes,
  oklabDistanceSq,
  resolvePaletteColors,
  srgbToOklab,
} from "../src/engine/nodes/PaletteLut.ts";
import { registerBuiltInNodes } from "../src/engine/nodes/definitions/index.ts";
import { rasterizeModel3DMap } from "../src/engine/nodes/definitions/pixetInputNodes.ts";
import {
  buildGodotStandardMaterialTres,
  buildOrmPackedRgba,
} from "../src/engine/nodes/pixetBridges.ts";
import { buildPreviewMesh } from "../src/engine/nodes/pbrPreview3d.ts";
import { NODE_GRAPH_PRESETS } from "../src/engine/nodes/presets.ts";
import { pixelEngine } from "../src/engine/document/PixelEngine.ts";

function createTestRegistry(): NodeRegistry {
  const reg = new NodeRegistry();
  reg.register({
    type: "test.noise",
    label: "Noise",
    category: "generators",
    description: "Noise generator",
    inputs: [],
    outputs: [{ id: "out", label: "Height", type: "gray" }],
    params: [{ id: "scale", label: "Scale", kind: "float", min: 1, max: 32, step: 1, default: 4 }],
  });
  reg.register({
    type: "test.levels",
    label: "Levels",
    category: "adjust",
    description: "Adjust levels",
    inputs: [{ id: "in", label: "Input", type: "gray" }],
    outputs: [{ id: "out", label: "Output", type: "gray" }],
    params: [{ id: "gamma", label: "Gamma", kind: "float", min: 0.1, max: 4, step: 0.1, default: 1 }],
  });
  reg.register({
    type: "test.blend",
    label: "Blend",
    category: "pixel",
    description: "Blend two rgba",
    inputs: [
      { id: "base", label: "Base", type: "rgba" },
      { id: "top", label: "Top", type: "rgba" },
    ],
    outputs: [{ id: "out", label: "Out", type: "rgba" }],
    params: [],
  });
  reg.register({
    type: "test.matOut",
    label: "Material Output",
    category: "outputs",
    description: "Material sink",
    inputs: [{ id: "mat", label: "Material", type: "material" }],
    outputs: [],
    params: [],
    isSink: true,
  });
  reg.register({
    type: "test.palette",
    label: "Palette",
    category: "inputs",
    description: "Palette LUT",
    inputs: [],
    outputs: [{ id: "pal", label: "Palette", type: "palette" }],
    params: [],
  });
  return reg;
}

test("Socket coercion matrix enforces strict material/palette rules and allows valid coercions", () => {
  assert.deepEqual(canConnectSockets("rgba", "rgba"), { allowed: true, coerced: false });
  assert.deepEqual(canConnectSockets("rgba", "gray"), { allowed: true, coerced: true });
  assert.deepEqual(canConnectSockets("gray", "rgba"), { allowed: true, coerced: true });
  assert.deepEqual(canConnectSockets("color", "rgba"), { allowed: true, coerced: true });
  assert.deepEqual(canConnectSockets("float", "gray"), { allowed: true, coerced: true });
  assert.deepEqual(canConnectSockets("normal", "rgba"), { allowed: true, coerced: true });

  assert.deepEqual(canConnectSockets("material", "rgba"), { allowed: false, coerced: false });
  assert.deepEqual(canConnectSockets("rgba", "material"), { allowed: false, coerced: false });
  assert.deepEqual(canConnectSockets("palette", "rgba"), { allowed: false, coerced: false });
  assert.deepEqual(canConnectSockets("material", "material"), { allowed: true, coerced: false });
});

test("Blender-style links: value sockets interconvert, palette/material stay strict", () => {
  // Newly allowed, like Blender's implicit conversion.
  assert.deepEqual(canConnectSockets("gray", "normal"), { allowed: true, coerced: true });
  assert.deepEqual(canConnectSockets("gray", "vec2"), { allowed: true, coerced: true });
  assert.deepEqual(canConnectSockets("rgba", "vec2"), { allowed: true, coerced: true });
  assert.deepEqual(canConnectSockets("normal", "gray"), { allowed: true, coerced: true });
  assert.deepEqual(canConnectSockets("float", "rgba"), { allowed: true, coerced: true });
  assert.deepEqual(canConnectSockets("float", "normal"), { allowed: true, coerced: true });

  // A per-pixel texture can't become a single CPU number.
  assert.deepEqual(canConnectSockets("gray", "float"), { allowed: false, coerced: false });
  assert.deepEqual(canConnectSockets("rgba", "float"), { allowed: false, coerced: false });
  assert.deepEqual(canConnectSockets("float", "palette"), { allowed: false, coerced: false });
  assert.deepEqual(canConnectSockets("gray", "material"), { allowed: false, coerced: false });
});

test("linkConversion picks the conversion the evaluator runs", () => {
  assert.equal(linkConversion("rgba", "rgba"), "none");
  assert.equal(linkConversion("gray", "rgba"), "broadcast");
  assert.equal(linkConversion("gray", "normal"), "broadcast");
  assert.equal(linkConversion("rgba", "gray"), "luminance");
  assert.equal(linkConversion("normal", "gray"), "luminance");
  assert.equal(linkConversion("normal", "rgba"), "passthrough");
  assert.equal(linkConversion("rgba", "vec2"), "passthrough");
  assert.equal(linkConversion("float", "gray"), "fillScalar");
  assert.equal(linkConversion("float", "rgba"), "fillColor");
  assert.equal(linkConversion("gray", "float"), "invalid");
  assert.equal(linkConversion("palette", "rgba"), "invalid");
});

test("connectSockets rejects cycles and replaces existing input wire", () => {
  const reg = createTestRegistry();
  let g = createEmptyGraph("Test", "material", 128, "g1");
  const n1 = reg.createNodeInstance("test.noise", { x: 0, y: 0 }, { id: "n1" });
  const n2 = reg.createNodeInstance("test.levels", { x: 200, y: 0 }, { id: "n2" });
  const n3 = reg.createNodeInstance("test.levels", { x: 400, y: 0 }, { id: "n3" });
  g = addNode(g, n1);
  g = addNode(g, n2);
  g = addNode(g, n3);

  const c1 = connectSockets(g, reg, {
    fromNode: "n1",
    fromSocket: "out",
    toNode: "n2",
    toSocket: "in",
  });
  assert.equal(c1.ok, true);
  g = c1.graph;

  const c2 = connectSockets(g, reg, {
    fromNode: "n2",
    fromSocket: "out",
    toNode: "n3",
    toSocket: "in",
  });
  assert.equal(c2.ok, true);
  g = c2.graph;

  // Cycle n3 -> n2 must fail
  assert.equal(wouldCreateCycle(g, "n3", "n2"), true);
  const cyc = connectSockets(g, reg, {
    fromNode: "n3",
    fromSocket: "out",
    toNode: "n2",
    toSocket: "in",
  });
  assert.equal(cyc.ok, false);

  // Connecting n1 -> n3 replaces n2 -> n3 on n3.in
  const rep = connectSockets(g, reg, {
    fromNode: "n1",
    fromSocket: "out",
    toNode: "n3",
    toSocket: "in",
  });
  assert.equal(rep.ok, true);
  const n3Inputs = rep.graph.edges.filter((e) => e.toNode === "n3" && e.toSocket === "in");
  assert.equal(n3Inputs.length, 1);
  assert.equal(n3Inputs[0].fromNode, "n1");
});

test("topologicalSort, reachability pruning, and dirty downstream propagation", () => {
  const reg = createTestRegistry();
  let g = createEmptyGraph("Test", "material", 128, "g2");
  g = addNode(g, reg.createNodeInstance("test.noise", { x: 0, y: 0 }, { id: "a" }));
  g = addNode(g, reg.createNodeInstance("test.levels", { x: 100, y: 0 }, { id: "b" }));
  g = addNode(g, reg.createNodeInstance("test.levels", { x: 200, y: 0 }, { id: "c" }));
  g = addNode(g, reg.createNodeInstance("test.noise", { x: 0, y: 200 }, { id: "dead" }));

  g = connectSockets(g, reg, { fromNode: "a", fromSocket: "out", toNode: "b", toSocket: "in" }).graph;
  g = connectSockets(g, reg, { fromNode: "b", fromSocket: "out", toNode: "c", toSocket: "in" }).graph;

  const topo = topologicalSort(g);
  assert.equal(topo.hasCycle, false);
  assert.ok(topo.order.indexOf("a") < topo.order.indexOf("b"));
  assert.ok(topo.order.indexOf("b") < topo.order.indexOf("c"));

  const reachable = computeReachableNodes(g, ["c"]);
  assert.equal(reachable.has("a"), true);
  assert.equal(reachable.has("b"), true);
  assert.equal(reachable.has("c"), true);
  assert.equal(reachable.has("dead"), false);

  const dirty = computeDownstreamNodes(g, ["b"]);
  assert.equal(dirty.has("a"), false);
  assert.equal(dirty.has("b"), true);
  assert.equal(dirty.has("c"), true);
});

test("spliceNodeOnEdge, toggleBypassNodes, duplicateSelection, and removeNodes", () => {
  const reg = createTestRegistry();
  let g = createEmptyGraph("Ops", "compositor", 64, "g3");
  g = addNode(g, reg.createNodeInstance("test.noise", { x: 0, y: 0 }, { id: "n1" }));
  g = addNode(g, reg.createNodeInstance("test.levels", { x: 300, y: 0 }, { id: "n2" }));
  g = connectSockets(g, reg, {
    id: "e1",
    fromNode: "n1",
    fromSocket: "out",
    toNode: "n2",
    toSocket: "in",
  }).graph;

  g = addNode(g, reg.createNodeInstance("test.levels", { x: 150, y: 0 }, { id: "mid" }));
  const spliced = spliceNodeOnEdge(g, reg, "mid", "e1");
  assert.equal(spliced.spliced, true);
  assert.equal(spliced.graph.edges.length, 2);

  const bypassed = toggleBypassNodes(spliced.graph, ["mid"]);
  assert.equal(bypassed.nodes.find((n) => n.id === "mid")?.bypassed, true);

  const dup = duplicateSelection(bypassed, ["n1", "mid"], 30, 40);
  assert.equal(dup.createdNodeIds.length, 2);
  // Only internal edge between n1 and mid is duplicated (plus original 2 edges)
  assert.equal(dup.graph.edges.length, 3);

  const removed = removeNodes(dup.graph, ["mid"]);
  assert.equal(removed.nodes.some((n) => n.id === "mid"), false);
});

test("NodeHistory coalesces scrub transactions and supports undo/redo", () => {
  const reg = createTestRegistry();
  const hist = new NodeHistory(50);
  const g0 = addNode(
    createEmptyGraph("Hist", "material", 128, "g4"),
    reg.createNodeInstance("test.noise", { x: 0, y: 0 }, { id: "n1" })
  );

  hist.beginTransaction(g0, "Scrub Scale");
  const g1 = {
    ...g0,
    nodes: [{ ...g0.nodes[0], params: { scale: 8 } }],
  };
  const g2 = {
    ...g0,
    nodes: [{ ...g0.nodes[0], params: { scale: 12 } }],
  };
  assert.equal(hist.commitTransaction(g2), true);
  assert.equal(hist.canUndo(), true);

  const undone = hist.undo(g2);
  assert.ok(undone);
  assert.equal(undone.graph.nodes[0].params.scale, 4);

  const redone = hist.redo(undone.graph);
  assert.ok(redone);
  assert.equal(redone.graph.nodes[0].params.scale, 12);

  // No-op transaction is ignored
  hist.beginTransaction(g1, "No-op");
  assert.equal(hist.commitTransaction(g1), false);
});

test("serializeNodesExt / deserializeNodesExt round-trips graphs and prunes unreferenced assets", () => {
  const reg = createTestRegistry();
  const mgr = new NodeGraphManager();
  let g = createEmptyGraph("Persist", "material", 256, "g5");
  g = addNode(
    g,
    reg.createNodeInstance("test.noise", { x: 10, y: 20 }, { id: "n1", params: { assetId: "used-1" } })
  );
  mgr.graphs = [g];
  mgr.activeGraphId = "g5";
  mgr.assets = {
    "used-1": { id: "used-1", name: "tex.png", width: 16, height: 16, pngBase64: "AAA" },
    "unused-2": { id: "unused-2", name: "old.png", width: 16, height: 16, pngBase64: "BBB" },
  };

  const ext = serializeNodesExt(mgr);
  assert.ok(ext.assets["used-1"]);
  assert.equal(ext.assets["unused-2"], undefined);

  const restored = deserializeNodesExt(ext);
  assert.equal(restored.graphs.length, 1);
  assert.equal(restored.activeGraphId, "g5");

  const empty = deserializeNodesExt(null);
  assert.equal(empty.schemaVersion, 1);
  assert.equal(empty.graphs.length, 0);
});

test("PaletteLut builds 256x1 RGBA8 LUTs, gradient ramps, and perceptual OKLab distances", () => {
  const pal = buildPaletteLutBytes(["#000000", "#ff0000", "#ffffff"]);
  assert.equal(pal.count, 3);
  assert.equal(pal.data.length, 256 * 4);
  assert.equal(pal.data[4], 255);
  assert.equal(pal.data[5], 0);

  const ramp = buildRampLutBytes([
    { pos: 0, color: "#000000" },
    { pos: 1, color: "#ffffff" },
  ]);
  assert.equal(ramp[0], 0);
  assert.equal(ramp[255 * 4], 255);
  assert.ok(ramp[128 * 4] >= 126 && ramp[128 * 4] <= 130);

  const black = srgbToOklab(0, 0, 0);
  const darkGray = srgbToOklab(20, 20, 20);
  const white = srgbToOklab(255, 255, 255);
  assert.ok(oklabDistanceSq(black, darkGray) < oklabDistanceSq(black, white));

  // Palette node resolution: document, preset, custom, and legacy undefined
  const docPal = ["#111111", "#eeeeee"];
  assert.deepEqual(
    resolvePaletteColors({ source: DOCUMENT_PALETTE_SOURCE, colors: ["#ff0000"] }, docPal),
    docPal
  );
  assert.deepEqual(resolvePaletteColors(undefined, docPal), docPal);
  const pico = resolvePaletteColors({ source: "PICO-8 16", colors: [] }, docPal);
  assert.equal(pico.length, 16);
  assert.equal(pico[0], "#000000");
  assert.deepEqual(
    resolvePaletteColors({ source: CUSTOM_PALETTE_SOURCE, colors: ["#123456", "#abcdef"] }, docPal),
    ["#123456", "#abcdef"]
  );
});

test("registerBuiltInNodes registers 30+ N3/N4 nodes with valid sockets, shaders, and pixel.clean CPU bridge", () => {
  const reg = new NodeRegistry();
  registerBuiltInNodes(reg);
  const all = reg.list();
  assert.ok(all.length >= 30, `Expected >= 30 built-in nodes, got ${all.length}`);

  for (const def of all) {
    assert.ok(def.type.length > 0);
    assert.ok(def.label.length > 0);
    const defaults = reg.createDefaultParams(def.type);
    for (const param of def.params) {
      assert.ok(param.id in defaults, `Missing default for ${def.type}.${param.id}`);
    }
    if (!def.isMaterialRouter) {
      assert.ok(
        Boolean(def.fragmentShader) ||
          Boolean(def.passes?.length) ||
          Boolean(def.cpuEvaluate) ||
          Boolean(def.scalarEvaluate) ||
          Boolean(def.paletteEvaluate),
        `Node ${def.type} has no shader or evaluator`
      );
    }
  }

  const palDef = reg.get("input.palette");
  assert.equal(palDef?.label, "Palette");
  assert.ok(palDef?.paletteEvaluate);
  assert.equal(palDef.paletteEvaluate({ palette: { source: "Sweetie 16", colors: [] } }, []).length, 16);

  const cleanDef = reg.get("pixel.clean");
  assert.ok(cleanDef?.cpuEvaluate);
  const srcData = new Uint8ClampedArray(4 * 4 * 4);
  // Single isolated opaque pixel at (1, 1) -> orphan cleanup removes it
  srcData[(1 * 4 + 1) * 4 + 3] = 255;
  const cleaned = cleanDef.cpuEvaluate(
    { src: { kind: "rgba", width: 4, height: 4, data: srcData } },
    { mode: "cleanup" },
    { width: 4, height: 4, seed: 1, time: 0, frame: 0, progress: 0, wrap: "clamp" }
  );
  assert.equal(cleaned.out.kind, "rgba");
  assert.equal(cleaned.out.data[(1 * 4 + 1) * 4 + 3], 0);

  const scaled = cleanDef.cpuEvaluate(
    { src: { kind: "rgba", width: 4, height: 4, data: srcData } },
    { mode: "scale2x" },
    { width: 4, height: 4, seed: 1, time: 0, frame: 0, progress: 0, wrap: "clamp" }
  );
  assert.equal(scaled.out.width, 8);
  assert.equal(scaled.out.height, 8);
});

test("N5-N7: 40+ nodes registered, Flood Fill, Sprite->PBR, Active 3D Model preview, ORM/Godot, and all 6 presets valid", () => {
  const reg = new NodeRegistry();
  registerBuiltInNodes(reg);
  const all = reg.list();
  assert.ok(all.length >= 40, `Expected >= 40 built-in nodes, got ${all.length}`);

  // Flood Fill connected-components test
  const flood = reg.get("adjust.floodFill");
  assert.ok(flood?.cpuEvaluate);
  const mask = new Float32Array(16);
  mask[0] = 1; mask[1] = 1; // component 1
  mask[10] = 1; mask[11] = 1; // component 2
  const floodOut = flood.cpuEvaluate(
    { mask: { kind: "gray", width: 4, height: 4, data: mask } },
    { threshold: 0.5 },
    { width: 4, height: 4, seed: 42, time: 0, frame: 0, progress: 0, wrap: "clamp" }
  );
  assert.equal(floodOut.rand.kind, "gray");
  assert.equal(floodOut.rand.data[0], floodOut.rand.data[1]);
  assert.notEqual(floodOut.rand.data[0], floodOut.rand.data[10]);

  // Sprite -> Height & Normal CPU bridge test
  const spritePbr = reg.get("pbr.spriteToPbr");
  assert.ok(spritePbr?.cpuEvaluate);
  const sprData = new Uint8ClampedArray(8 * 8 * 4);
  for (let y = 2; y < 6; y++) {
    for (let x = 2; x < 6; x++) {
      const p = (y * 8 + x) * 4;
      sprData[p] = 180; sprData[p + 1] = 120; sprData[p + 2] = 90; sprData[p + 3] = 255;
    }
  }
  const sprOut = spritePbr.cpuEvaluate(
    { src: { kind: "rgba", width: 8, height: 8, data: sprData } },
    { source: "hybrid", strength: 2.5 },
    { width: 8, height: 8, seed: 1, time: 0, frame: 0, progress: 0, wrap: "clamp" }
  );
  assert.equal(sprOut.height.kind, "gray");
  assert.equal(sprOut.normal.kind, "rgba");

  // 3D Model Map Input & Active 3D Model mesh builder
  pixelEngine.model3d.reset();
  const uvMask = rasterizeModel3DMap("uvMask", 16, 16);
  assert.equal(uvMask.length, 16 * 16 * 4);
  const activeMesh = buildPreviewMesh("active3d", pixelEngine.model3d.nodes);
  assert.ok(activeMesh.vertexCount > 0);

  // ORM packing & Godot .tres
  const ao = new Uint8ClampedArray([200, 200, 200, 255]);
  const rough = new Uint8ClampedArray([120, 120, 120, 255]);
  const metal = new Uint8ClampedArray([10, 10, 10, 255]);
  const orm = buildOrmPackedRgba(ao, rough, metal);
  assert.deepEqual(Array.from(orm), [200, 120, 10, 255]);
  const tres = buildGodotStandardMaterialTres("Stone", {
    albedoFile: "stone_albedo.png",
    normalFile: "stone_normal.png",
    ormFile: "stone_orm.png",
  });
  assert.ok(tres.includes("StandardMaterial3D"));
  assert.ok(tres.includes("stone_orm.png"));

  // All 6 starter presets must be valid acyclic DAGs with registered node types
  assert.equal(NODE_GRAPH_PRESETS.length, 6);
  for (const preset of NODE_GRAPH_PRESETS) {
    const g = preset.build();
    assert.ok(g.nodes.length >= 3);
    const topo = topologicalSort(g);
    assert.equal(topo.hasCycle, false, `Preset ${preset.id} has a cycle`);
    for (const n of g.nodes) {
      assert.ok(reg.has(n.type), `Preset ${preset.id} references unknown node ${n.type}`);
    }
  }
});

test("Macro & Animation nodes: param:<id> connections and scalar evaluation", () => {
  const reg = new NodeRegistry();
  registerBuiltInNodes(reg);

  let g = createEmptyGraph("MacroAnim", "material", 128, "g-macro");
  const macro = reg.createNodeInstance("macro.controller", { x: 0, y: 0 }, { id: "m1" });
  const lfo = reg.createNodeInstance("anim.lfo", { x: 0, y: 150 }, { id: "lfo1" });
  const noise = reg.createNodeInstance("gen.noise", { x: 240, y: 0 }, { id: "noise1" });
  const matOut = reg.createNodeInstance("output.material", { x: 480, y: 0 }, { id: "out1" });
  g = addNode(g, macro);
  g = addNode(g, lfo);
  g = addNode(g, noise);
  g = addNode(g, matOut);

  // Connecting macro float output -> param:scaleX succeeds
  const okConn = connectSockets(g, reg, {
    fromNode: "m1",
    fromSocket: "m1",
    toNode: "noise1",
    toSocket: "param:scaleX",
  });
  assert.equal(okConn.ok, true);

  // Connecting to non-existent param fails
  const badParam = connectSockets(g, reg, {
    fromNode: "m1",
    fromSocket: "m1",
    toNode: "noise1",
    toSocket: "param:doesNotExist",
  });
  assert.equal(badParam.ok, false);

  // LFO evaluation across progress
  const lfoDef = reg.get("anim.lfo")!;
  assert.ok(lfoDef.scalarEvaluate);
  const v0 = lfoDef.scalarEvaluate({}, { wave: "triangle", cycles: 1, phaseOffset: 0, min: 0, max: 1 }, { time: 0, frame: 0, progress: 0, seed: 1 });
  const vMid = lfoDef.scalarEvaluate({}, { wave: "triangle", cycles: 1, phaseOffset: 0, min: 0, max: 1 }, { time: 0.5, frame: 2, progress: 0.5, seed: 1 });
  assert.ok(Math.abs(v0.out - 0) < 1e-5);
  assert.ok(Math.abs(vMid.out - 1) < 1e-5);
});
