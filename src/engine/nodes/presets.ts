import { addNode, connectSockets, createEmptyGraph } from "./NodeGraph.ts";
import { nodeRegistry } from "./NodeRegistry.ts";
import "./definitions/index.ts";
import type { NodeGraph } from "./types.ts";

export interface NodeGraphPreset {
  id: string;
  name: string;
  description: string;
  build: () => NodeGraph;
}

export const NODE_GRAPH_PRESETS: NodeGraphPreset[] = [
  {
    id: "dungeon-bricks",
    name: "Dungeon Stone Bricks (PBR)",
    description: "Beveled running-bond stone bricks with slope blur weathering and full PBR maps.",
    build: () => {
      let g = createEmptyGraph("Dungeon Stone Bricks", "material", 128, "preset-bricks");
      const bricks = nodeRegistry.createNodeInstance("gen.bricks", { x: 40, y: 80 }, { id: "bricks" });
      const noise = nodeRegistry.createNodeInstance("gen.noise", { x: 40, y: 280 }, { id: "noise" });
      const slope = nodeRegistry.createNodeInstance("distort.slopeBlur", { x: 260, y: 120 }, { id: "slope" });
      const norm = nodeRegistry.createNodeInstance("pbr.heightToNormal", { x: 480, y: 40 }, { id: "norm" });
      const ao = nodeRegistry.createNodeInstance("pbr.heightToAo", { x: 480, y: 180 }, { id: "ao" });
      const pal = nodeRegistry.createNodeInstance("input.palette", { x: 260, y: 340 }, { id: "pal" });
      const grad = nodeRegistry.createNodeInstance("pixel.gradientMap", { x: 480, y: 320 }, { id: "grad" });
      const comb = nodeRegistry.createNodeInstance("pbr.materialCombine", { x: 720, y: 140 }, { id: "comb" });
      const out = nodeRegistry.createNodeInstance("output.material", { x: 960, y: 140 }, { id: "out" });
      for (const n of [bricks, noise, slope, norm, ao, pal, grad, comb, out]) g = addNode(g, n);
      g = connectSockets(g, nodeRegistry, { fromNode: "bricks", fromSocket: "height", toNode: "slope", toSocket: "src" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "noise", fromSocket: "out", toNode: "slope", toSocket: "slope" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "slope", fromSocket: "out", toNode: "norm", toSocket: "height" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "slope", fromSocket: "out", toNode: "ao", toSocket: "height" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "slope", fromSocket: "out", toNode: "grad", toSocket: "src" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "pal", fromSocket: "pal", toNode: "grad", toSocket: "palette" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "grad", fromSocket: "out", toNode: "comb", toSocket: "albedo" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "norm", fromSocket: "normal", toNode: "comb", toSocket: "normal" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "slope", fromSocket: "out", toNode: "comb", toSocket: "height" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "ao", fromSocket: "ao", toNode: "comb", toSocket: "ao" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "comb", fromSocket: "material", toNode: "out", toSocket: "material" }).graph;
      g.exposedParams = [
        { id: "ep-rows", label: "Brick Rows", nodeId: "bricks", paramId: "rows" },
        { id: "ep-wear", label: "Edge Wear", nodeId: "slope", paramId: "intensity" },
        { id: "ep-norm", label: "Normal Strength", nodeId: "norm", paramId: "strength" },
      ];
      return g;
    },
  },
  {
    id: "mossy-cobble",
    name: "Mossy Cobblestone Height-Blend (PBR)",
    description: "Voronoi cobbles height-blended with cellular moss.",
    build: () => {
      let g = createEmptyGraph("Mossy Cobblestone", "material", 128, "preset-cobble");
      const vor = nodeRegistry.createNodeInstance("gen.voronoi", { x: 40, y: 60 }, { id: "vor" });
      const noise = nodeRegistry.createNodeInstance("gen.noise", { x: 40, y: 240 }, { id: "noise" });
      const normA = nodeRegistry.createNodeInstance("pbr.heightToNormal", { x: 260, y: 40 }, { id: "normA" });
      const colA = nodeRegistry.createNodeInstance("input.solidColor", { x: 260, y: 160 }, { id: "colA", params: { color: "#6c7078" } });
      const colB = nodeRegistry.createNodeInstance("input.solidColor", { x: 260, y: 280 }, { id: "colB", params: { color: "#3d6b35" } });
      const matA = nodeRegistry.createNodeInstance("pbr.materialCombine", { x: 480, y: 80 }, { id: "matA" });
      const matB = nodeRegistry.createNodeInstance("pbr.materialCombine", { x: 480, y: 260 }, { id: "matB" });
      const blend = nodeRegistry.createNodeInstance("pbr.materialBlend", { x: 720, y: 160 }, { id: "blend" });
      const out = nodeRegistry.createNodeInstance("output.material", { x: 940, y: 160 }, { id: "out" });
      for (const n of [vor, noise, normA, colA, colB, matA, matB, blend, out]) g = addNode(g, n);
      g = connectSockets(g, nodeRegistry, { fromNode: "vor", fromSocket: "out", toNode: "normA", toSocket: "height" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "colA", fromSocket: "out", toNode: "matA", toSocket: "albedo" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "normA", fromSocket: "normal", toNode: "matA", toSocket: "normal" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "vor", fromSocket: "out", toNode: "matA", toSocket: "height" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "colB", fromSocket: "out", toNode: "matB", toSocket: "albedo" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "noise", fromSocket: "out", toNode: "matB", toSocket: "height" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "matA", fromSocket: "material", toNode: "blend", toSocket: "base" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "matB", fromSocket: "material", toNode: "blend", toSocket: "top" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "blend", fromSocket: "material", toNode: "out", toSocket: "material" }).graph;
      return g;
    },
  },
  {
    id: "autotile-grass-dirt",
    name: "Grass-to-Dirt Auto-Tile Generator",
    description: "Auto-Tile Mask ready for one-click 16-tile Tileset baking.",
    build: () => {
      let g = createEmptyGraph("Auto-Tile Grass", "material", 32, "preset-autotile");
      const mask = nodeRegistry.createNodeInstance("gen.autotileMask", { x: 60, y: 120 }, { id: "mask" });
      const pal = nodeRegistry.createNodeInstance("input.palette", { x: 60, y: 280 }, { id: "pal" });
      const grad = nodeRegistry.createNodeInstance("pixel.gradientMap", { x: 280, y: 140 }, { id: "grad" });
      const comb = nodeRegistry.createNodeInstance("pbr.materialCombine", { x: 500, y: 140 }, { id: "comb" });
      const out = nodeRegistry.createNodeInstance("output.material", { x: 720, y: 140 }, { id: "out" });
      for (const n of [mask, pal, grad, comb, out]) g = addNode(g, n);
      g = connectSockets(g, nodeRegistry, { fromNode: "mask", fromSocket: "mask", toNode: "grad", toSocket: "src" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "pal", fromSocket: "pal", toNode: "grad", toSocket: "palette" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "grad", fromSocket: "out", toNode: "comb", toSocket: "albedo" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "comb", fromSocket: "material", toNode: "out", toSocket: "material" }).graph;
      return g;
    },
  },
  {
    id: "bayer-metal",
    name: "Retro Bayer-Dithered Metal (Pixel PBR)",
    description: "Noise-driven brushed metal quantized to active palette with Bayer 4x4 dither.",
    build: () => {
      let g = createEmptyGraph("Bayer Metal", "material", 64, "preset-bayer");
      const noise = nodeRegistry.createNodeInstance("gen.noise", { x: 40, y: 100 }, { id: "noise" });
      const pal = nodeRegistry.createNodeInstance("input.palette", { x: 40, y: 260 }, { id: "pal" });
      const quant = nodeRegistry.createNodeInstance("pixel.quantize", { x: 260, y: 120 }, { id: "quant" });
      const norm = nodeRegistry.createNodeInstance("pbr.heightToNormal", { x: 260, y: 280 }, { id: "norm" });
      const comb = nodeRegistry.createNodeInstance("pbr.materialCombine", { x: 500, y: 140 }, { id: "comb" });
      const out = nodeRegistry.createNodeInstance("output.material", { x: 720, y: 140 }, { id: "out" });
      for (const n of [noise, pal, quant, norm, comb, out]) g = addNode(g, n);
      g = connectSockets(g, nodeRegistry, { fromNode: "noise", fromSocket: "out", toNode: "quant", toSocket: "src" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "pal", fromSocket: "pal", toNode: "quant", toSocket: "palette" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "noise", fromSocket: "out", toNode: "norm", toSocket: "height" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "quant", fromSocket: "out", toNode: "comb", toSocket: "albedo" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "norm", fromSocket: "normal", toNode: "comb", toSocket: "normal" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "comb", fromSocket: "material", toNode: "out", toSocket: "material" }).graph;
      return g;
    },
  },
  {
    id: "sprite-outline-shadow",
    name: "Sprite Outline + Drop Shadow (Compositor)",
    description: "Non-destructive 1px outline and pixel drop shadow on the active Draw sprite.",
    build: () => {
      let g = createEmptyGraph("Sprite Outline FX", "compositor", 64, "preset-outline");
      const sprite = nodeRegistry.createNodeInstance("input.sprite", { x: 60, y: 120 }, { id: "sprite" });
      const outline = nodeRegistry.createNodeInstance("pixel.outline", { x: 280, y: 120 }, { id: "outline" });
      const shadow = nodeRegistry.createNodeInstance("pixel.dropShadow", { x: 500, y: 120 }, { id: "shadow" });
      const bake = nodeRegistry.createNodeInstance("output.bake", { x: 720, y: 120 }, { id: "bake" });
      for (const n of [sprite, outline, shadow, bake]) g = addNode(g, n);
      g = connectSockets(g, nodeRegistry, { fromNode: "sprite", fromSocket: "rgba", toNode: "outline", toSocket: "src" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "outline", fromSocket: "out", toNode: "shadow", toSocket: "src" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "shadow", fromSocket: "out", toNode: "bake", toSocket: "src" }).graph;
      return g;
    },
  },
  {
    id: "arcane-glow-vfx",
    name: "Arcane Glow / Chromatic VFX (Compositor)",
    description: "Thresholded bloom, chromatic shift, and CRT scanlines on the active sprite.",
    build: () => {
      let g = createEmptyGraph("Arcane Glow VFX", "compositor", 64, "preset-glow");
      const sprite = nodeRegistry.createNodeInstance("input.sprite", { x: 60, y: 120 }, { id: "sprite" });
      const glow = nodeRegistry.createNodeInstance("pixel.glowVfx", { x: 300, y: 120 }, { id: "glow", params: { chromatic: 1.5, scanlines: 0.25 } });
      const out = nodeRegistry.createNodeInstance("output.preview", { x: 540, y: 120 }, { id: "out" });
      for (const n of [sprite, glow, out]) g = addNode(g, n);
      g = connectSockets(g, nodeRegistry, { fromNode: "sprite", fromSocket: "rgba", toNode: "glow", toSocket: "src" }).graph;
      g = connectSockets(g, nodeRegistry, { fromNode: "glow", fromSocket: "out", toNode: "out", toSocket: "in" }).graph;
      return g;
    },
  },
];
