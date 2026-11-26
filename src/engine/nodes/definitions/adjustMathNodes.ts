import { COMMON_UNIFORMS_GLSL, SCALAR_PACK_GLSL } from "../shaders/common.glsl.ts";
import type { NodeDefinition } from "../types.ts";

const LEVELS_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform float u_inMin;
uniform float u_inMax;
uniform float u_gamma;
uniform float u_outMin;
uniform float u_outMax;

void main() {
  vec4 c = texture(u_src, v_uv);
  float span = max(1e-5, u_inMax - u_inMin);
  vec3 v = clamp((c.rgb - u_inMin) / span, 0.0, 1.0);
  v = pow(v, vec3(1.0 / max(0.05, u_gamma)));
  v = mix(vec3(u_outMin), vec3(u_outMax), v);
  outColor = vec4(v, c.a);
}
`;

const HSV_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform float u_hue;
uniform float u_sat;
uniform float u_val;
uniform float u_contrast;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec4 c = texture(u_src, v_uv);
  vec3 hsv = rgb2hsv(c.rgb);
  hsv.x = fract(hsv.x + u_hue / 360.0);
  hsv.y = clamp(hsv.y * u_sat, 0.0, 1.0);
  hsv.z = clamp(hsv.z * u_val, 0.0, 1.0);
  vec3 rgb = hsv2rgb(hsv);
  rgb = clamp((rgb - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  outColor = vec4(rgb, c.a);
}
`;

const INVERT_THRESHOLD_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform float u_invert;
uniform float u_useThreshold;
uniform float u_threshold;
uniform float u_feather;

void main() {
  vec4 c = texture(u_src, v_uv);
  vec3 rgb = c.rgb;
  if (u_useThreshold > 0.5) {
    float f = max(0.001, u_feather);
    rgb = smoothstep(vec3(u_threshold - f), vec3(u_threshold + f), rgb);
  }
  if (u_invert > 0.5) {
    rgb = 1.0 - rgb;
  }
  outColor = vec4(rgb, c.a);
}
`;

const MATH_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}

uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_op;
uniform float u_bFallback;
uniform float u_hasB;

void main() {
  float a = sampleScalar(u_a, v_uv);
  float b = u_hasB > 0.5 ? sampleScalar(u_b, v_uv) : u_bFallback;
  int op = int(u_op + 0.5);
  float res = a;
  if (op == 0) res = a + b;
  else if (op == 1) res = a - b;
  else if (op == 2) res = a * b;
  else if (op == 3) res = a / max(b, 1e-4);
  else if (op == 4) res = pow(max(a, 0.0), max(b, 0.01));
  else if (op == 5) res = min(a, b);
  else if (op == 6) res = max(a, b);
  else if (op == 7) res = abs(a - b);
  else if (op == 8) res = step(b, a);
  else res = clamp(a, 0.0, 1.0);
  outColor = encodeScalar(clamp(res, 0.0, 1.0));
}
`;

const CHANNEL_PACK_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}

uniform sampler2D u_r;
uniform sampler2D u_g;
uniform sampler2D u_b;
uniform sampler2D u_a;

void main() {
  float r = sampleScalar(u_r, v_uv);
  float g = sampleScalar(u_g, v_uv);
  float b = sampleScalar(u_b, v_uv);
  float a = sampleScalar(u_a, v_uv);
  outColor = vec4(r, g, b, a);
}
`;

export const ADJUST_MATH_NODES: NodeDefinition[] = [
  {
    type: "adjust.levels",
    label: "Levels / Contrast",
    category: "adjust",
    description: "Remaps input black/white points, gamma, and output range.",
    inputs: [{ id: "src", label: "Input", type: "rgba" }],
    outputs: [{ id: "out", label: "Output", type: "rgba" }],
    params: [
      { id: "inMin", label: "In Black", kind: "float", min: 0, max: 0.95, step: 0.01, default: 0 },
      { id: "inMax", label: "In White", kind: "float", min: 0.05, max: 1, step: 0.01, default: 1 },
      { id: "gamma", label: "Gamma", kind: "float", min: 0.1, max: 4, step: 0.05, default: 1 },
      { id: "outMin", label: "Out Black", kind: "float", min: 0, max: 1, step: 0.01, default: 0 },
      { id: "outMax", label: "Out White", kind: "float", min: 0, max: 1, step: 0.01, default: 1 },
    ],
    fragmentShader: LEVELS_FS,
    getUniforms: (p) => ({
      u_inMin: Number(p.inMin ?? 0),
      u_inMax: Number(p.inMax ?? 1),
      u_gamma: Number(p.gamma ?? 1),
      u_outMin: Number(p.outMin ?? 0),
      u_outMax: Number(p.outMax ?? 1),
    }),
  },
  {
    type: "adjust.hsv",
    label: "HSV / Balance",
    category: "adjust",
    description: "Adjusts hue, saturation, value, and contrast.",
    inputs: [{ id: "src", label: "Input", type: "rgba" }],
    outputs: [{ id: "out", label: "Output", type: "rgba" }],
    params: [
      { id: "hue", label: "Hue Shift", kind: "float", min: -180, max: 180, step: 1, default: 0 },
      { id: "sat", label: "Saturation", kind: "float", min: 0, max: 2, step: 0.02, default: 1 },
      { id: "val", label: "Value", kind: "float", min: 0, max: 2, step: 0.02, default: 1 },
      { id: "contrast", label: "Contrast", kind: "float", min: 0, max: 3, step: 0.02, default: 1 },
    ],
    fragmentShader: HSV_FS,
    getUniforms: (p) => ({
      u_hue: Number(p.hue ?? 0),
      u_sat: Number(p.sat ?? 1),
      u_val: Number(p.val ?? 1),
      u_contrast: Number(p.contrast ?? 1),
    }),
  },
  {
    type: "adjust.invertThreshold",
    label: "Invert / Threshold",
    category: "adjust",
    description: "Inverts values and/or applies a feathered binary threshold.",
    inputs: [{ id: "src", label: "Input", type: "rgba" }],
    outputs: [{ id: "out", label: "Output", type: "rgba" }],
    params: [
      { id: "invert", label: "Invert", kind: "bool", default: true },
      { id: "useThreshold", label: "Threshold", kind: "bool", default: false },
      { id: "threshold", label: "Cutoff", kind: "float", min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: "feather", label: "Feather", kind: "float", min: 0, max: 0.5, step: 0.01, default: 0.02 },
    ],
    fragmentShader: INVERT_THRESHOLD_FS,
    getUniforms: (p) => ({
      u_invert: Boolean(p.invert),
      u_useThreshold: Boolean(p.useThreshold),
      u_threshold: Number(p.threshold ?? 0.5),
      u_feather: Number(p.feather ?? 0.02),
    }),
  },
  {
    type: "adjust.math",
    label: "Scalar Math",
    category: "adjust",
    description: "Combines two grayscale fields with arithmetic or min/max ops.",
    inputs: [
      { id: "a", label: "A", type: "gray" },
      { id: "b", label: "B", type: "gray", optional: true },
    ],
    outputs: [{ id: "out", label: "Result", type: "gray" }],
    params: [
      {
        id: "op",
        label: "Operation",
        kind: "enum",
        options: [
          { value: "0", label: "Add" },
          { value: "1", label: "Subtract" },
          { value: "2", label: "Multiply" },
          { value: "3", label: "Divide" },
          { value: "4", label: "Power" },
          { value: "5", label: "Min" },
          { value: "6", label: "Max" },
          { value: "7", label: "Abs Diff" },
          { value: "8", label: "Step" },
        ],
        default: "2",
      },
      { id: "bFallback", label: "B Value", kind: "float", min: 0, max: 4, step: 0.02, default: 0.5 },
    ],
    fragmentShader: MATH_FS,
    getUniforms: (p) => ({
      u_op: Number(p.op ?? 2),
      u_bFallback: Number(p.bFallback ?? 0.5),
      u_hasB: 0,
    }),
  },
  {
    type: "adjust.channelPack",
    label: "Channel Pack (ORM)",
    category: "adjust",
    description: "Packs separate R, G, B, A scalar masks into a single RGBA texture.",
    inputs: [
      { id: "r", label: "R (AO)", type: "gray" },
      { id: "g", label: "G (Rough)", type: "gray" },
      { id: "b", label: "B (Metal)", type: "gray" },
      { id: "a", label: "A", type: "gray", optional: true },
    ],
    outputs: [{ id: "out", label: "RGBA", type: "rgba" }],
    params: [],
    fragmentShader: CHANNEL_PACK_FS,
  },
];
