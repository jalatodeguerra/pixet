import { pixelEngine } from "../../document/PixelEngine.ts";
import { PixelBuffer } from "../../document/PixelBuffer.ts";
import type { CpuSocketValue, NodeDefinition } from "../types.ts";

/**
 * Rasterizes pure `pixelEngine.model3d` UV island mask or vertex-color/AO map
 * into a 2D RGBA buffer without importing Three.js.
 */
export function rasterizeModel3DMap(
  mode: "uvMask" | "vertexColor" | "faceNormal",
  width: number,
  height: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const nodes = pixelEngine.model3d.nodes;
  for (const node of nodes) {
    if (!node.visible) continue;
    if (node.kind === "cuboid" && node.cuboid) {
      for (const face of Object.values(node.cuboid.faces)) {
        if (face.hidden) continue;
        const [u0, v0, u1, v1] = face.uv;
        const x0 = Math.max(0, Math.min(width, Math.floor(Math.min(u0, u1))));
        const x1 = Math.max(0, Math.min(width, Math.ceil(Math.max(u0, u1))));
        const y0 = Math.max(0, Math.min(height, Math.floor(Math.min(v0, v1))));
        const y1 = Math.max(0, Math.min(height, Math.ceil(Math.max(v0, v1))));
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const p = (y * width + x) * 4;
            if (mode === "faceNormal") {
              out[p] = 128;
              out[p + 1] = 128;
              out[p + 2] = 255;
            } else {
              out[p] = 255;
              out[p + 1] = 255;
              out[p + 2] = 255;
            }
            out[p + 3] = 255;
          }
        }
      }
    } else if (node.kind === "mesh" && node.mesh) {
      for (const face of node.mesh.faces) {
        if (face.uvs.length === 0) continue;
        let minX = width;
        let maxX = 0;
        let minY = height;
        let maxY = 0;
        for (const [u, v] of face.uvs) {
          minX = Math.min(minX, u);
          maxX = Math.max(maxX, u);
          minY = Math.min(minY, v);
          maxY = Math.max(maxY, v);
        }
        const x0 = Math.max(0, Math.floor(minX));
        const x1 = Math.min(width, Math.ceil(maxX));
        const y0 = Math.max(0, Math.floor(minY));
        const y1 = Math.min(height, Math.ceil(maxY));
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const p = (y * width + x) * 4;
            out[p] = 255;
            out[p + 1] = 255;
            out[p + 2] = 255;
            out[p + 3] = 255;
          }
        }
      }
    }
  }
  return out;
}

export const PIXET_INPUT_NODES: NodeDefinition[] = [
  {
    type: "input.sprite",
    label: "Sprite Input",
    category: "inputs",
    description: "Pulls the active Draw sprite frame from PixelEngine.",
    inputs: [],
    outputs: [{ id: "rgba", label: "Sprite", type: "rgba" }],
    params: [
      { id: "frame", label: "Frame Index", kind: "int", min: 0, max: 128, step: 1, default: 0 },
    ],
    defaultWrap: "clamp",
    defaultFilter: "nearest",
    outputPrecision: "ldr8",
    cpuEvaluate: (_inputs, params): Record<string, CpuSocketValue> => {
      const w = Math.max(1, pixelEngine.width);
      const h = Math.max(1, pixelEngine.height);
      const frame = Math.max(0, Math.round(Number(params.frame ?? 0)));
      // Composite first available cels if no store layer list is passed
      const out = new PixelBuffer(w, h);
      for (const [key, cel] of pixelEngine.cels.entries()) {
        if (key.endsWith(`:${frame}`)) {
          for (let i = 0; i < out.data.length; i += 4) {
            if (cel.data[i + 3] > 0) {
              out.data[i] = cel.data[i];
              out.data[i + 1] = cel.data[i + 1];
              out.data[i + 2] = cel.data[i + 2];
              out.data[i + 3] = cel.data[i + 3];
            }
          }
        }
      }
      return { rgba: { kind: "rgba", width: w, height: h, data: out.data } };
    },
  },
  {
    type: "input.selectionMask",
    label: "Draw Selection Mask",
    category: "inputs",
    description: "Pulls the active Draw selection mask (or full 1.0 when unselected).",
    inputs: [],
    outputs: [{ id: "mask", label: "Mask", type: "gray" }],
    params: [{ id: "invert", label: "Invert", kind: "bool", default: false }],
    defaultWrap: "clamp",
    defaultFilter: "nearest",
    cpuEvaluate: (_inputs, params): Record<string, CpuSocketValue> => {
      const w = Math.max(1, pixelEngine.width);
      const h = Math.max(1, pixelEngine.height);
      const out = new Float32Array(w * h);
      const inv = Boolean(params.invert);
      const sel = pixelEngine.selection;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const hit = sel ? (sel.contains(x, y) ? 1 : 0) : 1;
          out[y * w + x] = inv ? 1 - hit : hit;
        }
      }
      return { mask: { kind: "gray", width: w, height: h, data: out } };
    },
  },
  {
    type: "input.tilesetTile",
    label: "Tileset Tile Input",
    category: "inputs",
    description: "Pulls a tile by ID from the active Pixet TilesetRegistry.",
    inputs: [],
    outputs: [{ id: "rgba", label: "Tile", type: "rgba" }],
    params: [
      { id: "tilesetIndex", label: "Tileset Index", kind: "int", min: 0, max: 8, step: 1, default: 0 },
      { id: "tileId", label: "Tile ID", kind: "int", min: 0, max: 255, step: 1, default: 0 },
    ],
    defaultWrap: "repeat",
    defaultFilter: "nearest",
    outputPrecision: "ldr8",
    cpuEvaluate: (_inputs, params): Record<string, CpuSocketValue> => {
      const tsIdx = Math.max(0, Math.round(Number(params.tilesetIndex ?? 0)));
      const tileId = Math.max(0, Math.round(Number(params.tileId ?? 0)));
      const ts = pixelEngine.tilesetRegistry.tilesets[tsIdx] ?? pixelEngine.tileset;
      const tile = ts.tiles[tileId];
      if (!tile) {
        const tw = Math.max(1, ts.tileWidth);
        const th = Math.max(1, ts.tileHeight);
        return { rgba: { kind: "rgba", width: tw, height: th, data: new Uint8ClampedArray(tw * th * 4) } };
      }
      return {
        rgba: {
          kind: "rgba",
          width: tile.width,
          height: tile.height,
          data: new Uint8ClampedArray(tile.data),
        },
      };
    },
  },
  {
    type: "input.model3dMap",
    label: "3D Model Map Input",
    category: "inputs",
    description: "Pulls UV island masks or face normal masks from the active Low-Poly 3D model.",
    inputs: [],
    outputs: [{ id: "rgba", label: "Map", type: "rgba" }],
    params: [
      {
        id: "mode",
        label: "Mode",
        kind: "enum",
        options: [
          { value: "uvMask", label: "UV Island Mask" },
          { value: "faceNormal", label: "Baked Face Normal" },
        ],
        default: "uvMask",
      },
    ],
    defaultWrap: "clamp",
    defaultFilter: "nearest",
    outputPrecision: "ldr8",
    cpuEvaluate: (_inputs, params, ctx): Record<string, CpuSocketValue> => {
      const w = ctx.width;
      const h = ctx.height;
      const mode = String(params.mode ?? "uvMask") as "uvMask" | "faceNormal";
      const data = rasterizeModel3DMap(mode, w, h);
      return { rgba: { kind: "rgba", width: w, height: h, data } };
    },
  },
  {
    type: "input.image",
    label: "Image Input",
    category: "inputs",
    description: "External PNG/asset stored in the project's deduped nodes asset table.",
    inputs: [],
    outputs: [{ id: "rgba", label: "Image", type: "rgba" }],
    params: [{ id: "assetId", label: "Asset", kind: "asset", default: null }],
    outputPrecision: "ldr8",
    cpuEvaluate: (_inputs, _params, ctx): Record<string, CpuSocketValue> => {
      const w = ctx.width;
      const h = ctx.height;
      return {
        rgba: { kind: "rgba", width: w, height: h, data: new Uint8ClampedArray(w * h * 4) },
      };
    },
  },
];
