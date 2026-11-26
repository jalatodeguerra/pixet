import { PixelBuffer } from "../../document/PixelBuffer.ts";
import { generateHeightMap, generateNormalMap } from "../../gamedev/pbrMaps.ts";
import {
  CURVATURE_FS,
  HEIGHT_TO_AO_FS,
  HEIGHT_TO_NORMAL_FS,
  NORMAL_BLEND_RNM_FS,
} from "../shaders/pbr.glsl.ts";
import { COMMON_UNIFORMS_GLSL } from "../shaders/common.glsl.ts";
import type { CpuSocketValue, NodeDefinition } from "../types.ts";

const MATERIAL_OUTPUT_PASSTHROUGH_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
uniform sampler2D u_albedo;
void main() {
  outColor = texture(u_albedo, v_uv);
}
`;

export const PBR_OUTPUT_NODES: NodeDefinition[] = [
  {
    type: "adjust.floodFill",
    label: "Flood Fill (Cell Metrics)",
    category: "adjust",
    description:
      "Seamless CPU-bridge connected-components pass giving each cell a unique random luminance.",
    inputs: [{ id: "mask", label: "Binary Mask", type: "gray" }],
    outputs: [{ id: "rand", label: "Cell Random", type: "gray" }],
    params: [
      { id: "threshold", label: "Threshold", kind: "float", min: 0.05, max: 0.95, step: 0.05, default: 0.5 },
      { id: "seed", label: "Seed", kind: "seed", default: 707 },
    ],
    cpuEvaluate: (inputs, params, ctx): Record<string, CpuSocketValue> => {
      const src = inputs.mask;
      const w = src?.width ?? ctx.width;
      const h = src?.height ?? ctx.height;
      const out = new Float32Array(w * h);
      if (!src) {
        return { rand: { kind: "gray", width: w, height: h, data: out } };
      }
      const thresh = Number(params.threshold ?? 0.5);
      const labels = new Int32Array(w * h);
      const queue = new Int32Array(w * h);
      let nextLabel = 1;
      const wrap = ctx.wrap === "repeat";

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const start = y * w + x;
          if (labels[start] !== 0) continue;
          const v =
            src.kind === "gray"
              ? src.data[start]
              : src.data[start * 4] / 255;
          if (v < thresh) continue;

          const label = nextLabel++;
          let head = 0;
          let tail = 0;
          queue[tail++] = start;
          labels[start] = label;

          // Deterministic hash for this cell
          let hval = (label * 2654435761) ^ ctx.seed;
          hval = ((hval >>> 16) ^ hval) * 0x45d9f3b;
          hval = ((hval >>> 16) ^ hval) >>> 0;
          const randVal = (hval & 0xffff) / 65535;

          while (head < tail) {
            const idx = queue[head++];
            out[idx] = randVal;
            const cx = idx % w;
            const cy = Math.floor(idx / w);
            const neighbors = [
              [cx - 1, cy],
              [cx + 1, cy],
              [cx, cy - 1],
              [cx, cy + 1],
            ];
            for (const [nxRaw, nyRaw] of neighbors) {
              const nx = wrap ? (nxRaw + w) % w : nxRaw;
              const ny = wrap ? (nyRaw + h) % h : nyRaw;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              const nIdx = ny * w + nx;
              if (labels[nIdx] !== 0) continue;
              const nv =
                src.kind === "gray"
                  ? src.data[nIdx]
                  : src.data[nIdx * 4] / 255;
              if (nv >= thresh) {
                labels[nIdx] = label;
                queue[tail++] = nIdx;
              }
            }
          }
        }
      }
      return { rand: { kind: "gray", width: w, height: h, data: out } };
    },
  },
  {
    type: "pbr.heightToNormal",
    label: "Height → Normal",
    category: "pbr",
    description: "Converts a grayscale heightfield into an OpenGL (+Y) tangent-space normal map.",
    inputs: [{ id: "height", label: "Height", type: "gray" }],
    outputs: [{ id: "normal", label: "Normal", type: "normal" }],
    params: [
      {
        id: "kernel",
        label: "Kernel",
        kind: "enum",
        options: [
          { value: "0", label: "Sobel 3×3" },
          { value: "1", label: "Scharr 3×3" },
        ],
        default: "0",
      },
      { id: "strength", label: "Strength", kind: "float", min: 0.1, max: 20, step: 0.1, default: 3.0 },
    ],
    fragmentShader: HEIGHT_TO_NORMAL_FS,
    getUniforms: (p) => ({
      u_kernel: Number(p.kernel ?? 0),
      u_strength: Number(p.strength ?? 3.0),
    }),
  },
  {
    type: "pbr.normalBlend",
    label: "Normal Blend (RNM)",
    category: "pbr",
    description: "Blends base and detail normal maps using Reoriented Normal Mapping.",
    inputs: [
      { id: "base", label: "Base", type: "normal" },
      { id: "detail", label: "Detail", type: "normal" },
      { id: "mask", label: "Mask", type: "gray", optional: true },
    ],
    outputs: [{ id: "normal", label: "Normal", type: "normal" }],
    params: [
      { id: "strength", label: "Detail Strength", kind: "float", min: 0, max: 1, step: 0.02, default: 1 },
    ],
    fragmentShader: NORMAL_BLEND_RNM_FS,
    getUniforms: (p) => ({ u_strength: Number(p.strength ?? 1) }),
  },
  {
    type: "pbr.heightToAo",
    label: "Height → AO",
    category: "pbr",
    description: "Computes horizon-based ambient occlusion from a heightfield.",
    inputs: [{ id: "height", label: "Height", type: "gray" }],
    outputs: [{ id: "ao", label: "AO", type: "gray" }],
    params: [
      { id: "radius", label: "Radius", kind: "float", min: 1, max: 32, step: 1, default: 8 },
      { id: "intensity", label: "Intensity", kind: "float", min: 0, max: 4, step: 0.05, default: 1.5 },
      { id: "bias", label: "Bias", kind: "float", min: 0, max: 0.2, step: 0.005, default: 0.02 },
    ],
    fragmentShader: HEIGHT_TO_AO_FS,
    getUniforms: (p) => ({
      u_radius: Number(p.radius ?? 8),
      u_intensity: Number(p.intensity ?? 1.5),
      u_bias: Number(p.bias ?? 0.02),
    }),
  },
  {
    type: "pbr.curvature",
    label: "Curvature / Edge Wear",
    category: "pbr",
    description: "Extracts convex edges and concave crevices from a heightfield.",
    inputs: [{ id: "height", label: "Height", type: "gray" }],
    outputs: [{ id: "out", label: "Curvature", type: "gray" }],
    params: [
      {
        id: "mode",
        label: "Mode",
        kind: "enum",
        options: [
          { value: "0", label: "Both" },
          { value: "1", label: "Convex Edges" },
          { value: "2", label: "Concave Crevices" },
        ],
        default: "1",
      },
      { id: "radius", label: "Radius", kind: "float", min: 1, max: 8, step: 0.5, default: 1.5 },
      { id: "contrast", label: "Contrast", kind: "float", min: 0.5, max: 16, step: 0.25, default: 4 },
    ],
    fragmentShader: CURVATURE_FS,
    getUniforms: (p) => ({
      u_mode: Number(p.mode ?? 1),
      u_radius: Number(p.radius ?? 1.5),
      u_contrast: Number(p.contrast ?? 4),
    }),
  },
  {
    type: "pbr.spriteToPbr",
    label: "Sprite → Height & Normal",
    category: "pbr",
    description: "CPU-bridge using Pixet's Chamfer Bevel/Pillow height & Sobel/Scharr normal generator.",
    inputs: [{ id: "src", label: "Sprite", type: "rgba" }],
    outputs: [
      { id: "height", label: "Height", type: "gray" },
      { id: "normal", label: "Normal", type: "normal" },
    ],
    params: [
      {
        id: "source",
        label: "Height Source",
        kind: "enum",
        options: [
          { value: "hybrid", label: "Hybrid" },
          { value: "bevel", label: "Chamfer Bevel" },
          { value: "pillow", label: "Pillow" },
          { value: "luminance", label: "Luminance" },
        ],
        default: "hybrid",
      },
      { id: "strength", label: "Normal Strength", kind: "float", min: 0.5, max: 10, step: 0.25, default: 2.5 },
    ],
    defaultWrap: "clamp",
    defaultFilter: "nearest",
    cpuEvaluate: (inputs, params, ctx): Record<string, CpuSocketValue> => {
      const src = inputs.src;
      const w = src?.width ?? ctx.width;
      const h = src?.height ?? ctx.height;
      const buf = new PixelBuffer(w, h);
      if (src && src.kind === "rgba") {
        buf.data.set(src.data);
      }
      const sourceMode = String(params.source ?? "hybrid") as
        | "hybrid"
        | "bevel"
        | "pillow"
        | "luminance";
      const hBuf = generateHeightMap(buf, { source: sourceMode });
      const nBuf = generateNormalMap(buf, {
        strength: Number(params.strength ?? 2.5),
        heightMap: hBuf,
      });
      const hFloat = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        hFloat[i] = hBuf.data[i * 4] / 255;
      }
      return {
        height: { kind: "gray", width: w, height: h, data: hFloat },
        normal: { kind: "rgba", width: w, height: h, data: nBuf.data },
      };
    },
  },
  {
    type: "pbr.materialCombine",
    label: "Material Combine",
    category: "pbr",
    description: "Packages PBR channels into a single material bundle wire.",
    inputs: [
      { id: "albedo", label: "Albedo", type: "rgba", optional: true },
      { id: "normal", label: "Normal", type: "normal", optional: true },
      { id: "height", label: "Height", type: "gray", optional: true },
      { id: "roughness", label: "Roughness", type: "gray", optional: true },
      { id: "metallic", label: "Metallic", type: "gray", optional: true },
      { id: "ao", label: "AO", type: "gray", optional: true },
      { id: "emissive", label: "Emissive", type: "rgba", optional: true },
    ],
    outputs: [{ id: "material", label: "Material", type: "material" }],
    params: [],
    isMaterialRouter: true,
  },
  {
    type: "pbr.materialSplit",
    label: "Material Split",
    category: "pbr",
    description: "Unpacks a material bundle into individual PBR channel wires.",
    inputs: [{ id: "material", label: "Material", type: "material" }],
    outputs: [
      { id: "albedo", label: "Albedo", type: "rgba" },
      { id: "normal", label: "Normal", type: "normal" },
      { id: "height", label: "Height", type: "gray" },
      { id: "roughness", label: "Roughness", type: "gray" },
      { id: "metallic", label: "Metallic", type: "gray" },
      { id: "ao", label: "AO", type: "gray" },
      { id: "emissive", label: "Emissive", type: "rgba" },
    ],
    params: [],
    isMaterialRouter: true,
  },
  {
    type: "pbr.materialBlend",
    label: "Material Height-Blend",
    category: "pbr",
    description: "Blends two material bundles coherently using height & mask.",
    inputs: [
      { id: "base", label: "Base", type: "material" },
      { id: "top", label: "Top", type: "material" },
      { id: "mask", label: "Mask", type: "gray", optional: true },
    ],
    outputs: [{ id: "material", label: "Material", type: "material" }],
    params: [
      { id: "offset", label: "Height Offset", kind: "float", min: -1, max: 1, step: 0.02, default: 0 },
      { id: "contrast", label: "Contrast", kind: "float", min: 0.01, max: 1, step: 0.02, default: 0.2 },
    ],
    isMaterialRouter: true,
  },
  {
    type: "output.material",
    label: "Material Output",
    category: "outputs",
    description:
      "Primary PBR Material Output driving 2D/3D Preview, Low-Poly 3D Material binding, and PBR/ORM/Auto-Tile bakes.",
    inputs: [{ id: "material", label: "Material", type: "material" }],
    outputs: [],
    params: [],
    isSink: true,
    isMaterialRouter: true,
    fragmentShader: MATERIAL_OUTPUT_PASSTHROUGH_FS,
  },
  {
    type: "output.bake",
    label: "Bake Output (Draw / Tile)",
    category: "outputs",
    description: "Target output for baking RGBA surfaces to Draw layers or Tileset slots.",
    inputs: [{ id: "src", label: "Surface", type: "rgba" }],
    outputs: [{ id: "out", label: "Out", type: "rgba" }],
    params: [
      { id: "layerName", label: "Layer Name", kind: "enum", options: [{ value: "Node Bake", label: "Node Bake" }], default: "Node Bake" },
      { id: "tilesetIndex", label: "Tileset Index", kind: "int", min: 0, max: 8, step: 1, default: 0 },
      { id: "tileId", label: "Tile ID", kind: "int", min: 0, max: 255, step: 1, default: 0 },
    ],
    isSink: true,
    fragmentShader: `#version 300 es
${COMMON_UNIFORMS_GLSL}
uniform sampler2D u_src;
void main() { outColor = texture(u_src, v_uv); }`,
  },
];
