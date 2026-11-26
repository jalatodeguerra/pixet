import { PALETTE_PRESETS } from "../../../utils/paletteParser.ts";
import {
  DOCUMENT_PALETTE_SOURCE,
  parseHexToRgba,
  resolvePaletteColors,
} from "../PaletteLut.ts";
import { COMMON_UNIFORMS_GLSL } from "../shaders/common.glsl.ts";
import type { NodeDefinition } from "../types.ts";

const SOLID_COLOR_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform vec4 u_color;

void main() {
  outColor = u_color;
}
`;

const PREVIEW_SINK_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_in;

void main() {
  outColor = texture(u_in, v_uv);
}
`;

export const BASIC_INPUT_OUTPUT_NODES: NodeDefinition[] = [
  {
    type: "input.solidColor",
    label: "Solid Color",
    category: "inputs",
    description: "Constant RGBA color surface.",
    inputs: [],
    outputs: [{ id: "out", label: "Color", type: "rgba" }],
    params: [{ id: "color", label: "Color", kind: "color", default: "#4c8bf5" }],
    outputPrecision: "ldr8",
    fragmentShader: SOLID_COLOR_FS,
    getUniforms: (p) => {
      const rgba = parseHexToRgba(String(p.color ?? "#4c8bf5"));
      return {
        u_color: [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255],
      };
    },
  },
  {
    type: "input.palette",
    label: "Palette",
    category: "inputs",
    description: "Select a document, preset, or custom color palette to output as a GPU LUT.",
    inputs: [],
    outputs: [{ id: "pal", label: "Palette", type: "palette" }],
    params: [
      {
        id: "palette",
        label: "Palette",
        kind: "palette",
        default: {
          source: DOCUMENT_PALETTE_SOURCE,
          colors: [...PALETTE_PRESETS[0].colors],
        },
      },
    ],
    paletteEvaluate: (params, documentPalette) =>
      resolvePaletteColors(params.palette, documentPalette),
  },
  {
    type: "output.preview",
    label: "Preview Output",
    category: "outputs",
    description: "Primary preview sink for compositor & texture graphs.",
    inputs: [{ id: "in", label: "Surface", type: "rgba" }],
    outputs: [{ id: "out", label: "Out", type: "rgba" }],
    params: [],
    isSink: true,
    fragmentShader: PREVIEW_SINK_FS,
  },
];
