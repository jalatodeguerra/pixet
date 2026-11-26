import { COMMON_UNIFORMS_GLSL } from "../shaders/common.glsl.ts";
import type { NodeDefinition } from "../types.ts";

const DIR_WARP_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform sampler2D u_intensity;
uniform float u_strength;
uniform float u_angle;

void main() {
  float m = texture(u_intensity, v_uv).r;
  float rad = radians(u_angle);
  vec2 dir = vec2(cos(rad), sin(rad));
  vec2 uv = v_uv + dir * (m - 0.5) * u_strength * 0.25;
  outColor = texture(u_src, uv);
}
`;

const WARP_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform sampler2D u_disp;
uniform float u_mode; // 0=Grayscale Slope, 1=RG Vector
uniform float u_strengthX;
uniform float u_strengthY;

void main() {
  vec2 offset = vec2(0.0);
  if (u_mode < 0.5) {
    float dx = texture(u_disp, v_uv + vec2(u_texelSize.x, 0.0)).r - texture(u_disp, v_uv - vec2(u_texelSize.x, 0.0)).r;
    float dy = texture(u_disp, v_uv + vec2(0.0, u_texelSize.y)).r - texture(u_disp, v_uv - vec2(0.0, u_texelSize.y)).r;
    offset = vec2(dx, dy);
  } else {
    offset = texture(u_disp, v_uv).rg * 2.0 - 1.0;
  }
  vec2 uv = v_uv + offset * vec2(u_strengthX, u_strengthY) * 0.2;
  outColor = texture(u_src, uv);
}
`;

const SLOPE_BLUR_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform sampler2D u_slope;
uniform float u_intensity;
uniform float u_samples;
uniform float u_mode; // 0=Both, 1=Min(Chipped), 2=Max(Puffed)

void main() {
  vec4 acc = texture(u_src, v_uv);
  vec2 uv = v_uv;
  int steps = int(clamp(u_samples, 2.0, 16.0));
  float stepLen = u_intensity * 0.03 / float(steps);

  for (int i = 0; i < 16; i++) {
    if (i >= steps) break;
    float dx = texture(u_slope, uv + vec2(u_texelSize.x, 0.0)).r - texture(u_slope, uv - vec2(u_texelSize.x, 0.0)).r;
    float dy = texture(u_slope, uv + vec2(0.0, u_texelSize.y)).r - texture(u_slope, uv - vec2(0.0, u_texelSize.y)).r;
    uv += vec2(dx, dy) * stepLen * 12.0;
    vec4 s = texture(u_src, uv);
    if (u_mode < 0.5) {
      acc += s;
    } else if (u_mode < 1.5) {
      acc = min(acc, s);
    } else {
      acc = max(acc, s);
    }
  }
  if (u_mode < 0.5) {
    acc /= float(steps + 1);
  }
  outColor = acc;
}
`;

const BLUR_SHARPEN_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform float u_mode; // 0=Gaussian, 1=Box, 2=Sharpen
uniform float u_radius;

void main() {
  float r = max(0.0, u_radius);
  if (r < 0.01) {
    outColor = texture(u_src, v_uv);
    return;
  }
  vec4 center = texture(u_src, v_uv);
  vec4 sum = vec4(0.0);
  float wSum = 0.0;
  int ir = int(min(4.0, ceil(r)));
  float stepScale = max(1.0, r / 4.0);
  for (int y = -4; y <= 4; y++) {
    if (abs(y) > ir) continue;
    for (int x = -4; x <= 4; x++) {
      if (abs(x) > ir) continue;
      float d2 = float(x * x + y * y);
      float w = u_mode < 0.5 ? exp(-d2 / max(0.5, r * 0.8)) : 1.0;
      sum += texture(u_src, v_uv + vec2(float(x), float(y)) * u_texelSize * stepScale) * w;
      wSum += w;
    }
  }
  vec4 blurred = sum / max(wSum, 1e-5);
  if (u_mode > 1.5) {
    outColor = clamp(center + (center - blurred) * 1.5, 0.0, 1.0);
  } else {
    outColor = blurred;
  }
}
`;

const TRANSFORM_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform float u_offsetX;
uniform float u_offsetY;
uniform float u_rotate;
uniform float u_scaleX;
uniform float u_scaleY;
uniform float u_mirrorX;
uniform float u_mirrorY;
uniform float u_repeatX;
uniform float u_repeatY;

void main() {
  vec2 uv = v_uv - 0.5;
  float rad = radians(-u_rotate);
  float c = cos(rad);
  float s = sin(rad);
  uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
  uv /= max(vec2(u_scaleX, u_scaleY), vec2(0.01));
  uv += 0.5 - vec2(u_offsetX, u_offsetY);
  uv *= vec2(u_repeatX, u_repeatY);
  if (u_mirrorX > 0.5) uv.x = 1.0 - abs(mod(uv.x, 2.0) - 1.0);
  if (u_mirrorY > 0.5) uv.y = 1.0 - abs(mod(uv.y, 2.0) - 1.0);
  outColor = texture(u_src, uv);
}
`;

const MAKE_TILEABLE_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform float u_seamWidth;

void main() {
  vec4 a = texture(u_src, v_uv);
  vec4 b = texture(u_src, fract(v_uv + 0.5));
  vec2 edge = abs(v_uv - 0.5) * 2.0;
  float border = max(edge.x, edge.y);
  float w = smoothstep(1.0 - u_seamWidth, 1.0, border);
  outColor = mix(a, b, w * 0.85);
}
`;

export const FILTER_WARP_NODES: NodeDefinition[] = [
  {
    type: "distort.dirWarp",
    label: "Directional Warp",
    category: "distort",
    description: "Warps an input surface along a fixed angle driven by a grayscale mask.",
    inputs: [
      { id: "src", label: "Source", type: "rgba" },
      { id: "intensity", label: "Intensity", type: "gray" },
    ],
    outputs: [{ id: "out", label: "Output", type: "rgba" }],
    params: [
      { id: "strength", label: "Strength", kind: "float", min: -2, max: 2, step: 0.02, default: 0.4 },
      { id: "angle", label: "Angle", kind: "float", min: 0, max: 360, step: 1, default: 45 },
    ],
    fragmentShader: DIR_WARP_FS,
    getUniforms: (p) => ({
      u_strength: Number(p.strength ?? 0.4),
      u_angle: Number(p.angle ?? 45),
    }),
  },
  {
    type: "distort.warp",
    label: "Warp / Displace",
    category: "distort",
    description: "Displaces UVs using either grayscale height slope or an RG vector map.",
    inputs: [
      { id: "src", label: "Source", type: "rgba" },
      { id: "disp", label: "Displace", type: "rgba" },
    ],
    outputs: [{ id: "out", label: "Output", type: "rgba" }],
    params: [
      {
        id: "mode",
        label: "Mode",
        kind: "enum",
        options: [
          { value: "0", label: "Grayscale Slope" },
          { value: "1", label: "RG Vector" },
        ],
        default: "0",
      },
      { id: "strengthX", label: "Strength X", kind: "float", min: -2, max: 2, step: 0.02, default: 0.35 },
      { id: "strengthY", label: "Strength Y", kind: "float", min: -2, max: 2, step: 0.02, default: 0.35 },
    ],
    fragmentShader: WARP_FS,
    getUniforms: (p) => ({
      u_mode: Number(p.mode ?? 0),
      u_strengthX: Number(p.strengthX ?? 0.35),
      u_strengthY: Number(p.strengthY ?? 0.35),
    }),
  },
  {
    type: "distort.slopeBlur",
    label: "Slope Blur",
    category: "distort",
    description: "Advects pixels along a heightfield slope for weathered stone & eroded edges.",
    inputs: [
      { id: "src", label: "Source", type: "rgba" },
      { id: "slope", label: "Slope", type: "gray" },
    ],
    outputs: [{ id: "out", label: "Output", type: "rgba" }],
    params: [
      { id: "intensity", label: "Intensity", kind: "float", min: 0, max: 2, step: 0.02, default: 0.5 },
      { id: "samples", label: "Samples", kind: "int", min: 2, max: 16, step: 1, default: 8 },
      {
        id: "mode",
        label: "Mode",
        kind: "enum",
        options: [
          { value: "0", label: "Both (Blur)" },
          { value: "1", label: "Min (Chipped)" },
          { value: "2", label: "Max (Puffed)" },
        ],
        default: "1",
      },
    ],
    fragmentShader: SLOPE_BLUR_FS,
    getUniforms: (p) => ({
      u_intensity: Number(p.intensity ?? 0.5),
      u_samples: Number(p.samples ?? 8),
      u_mode: Number(p.mode ?? 1),
    }),
  },
  {
    type: "distort.blurSharpen",
    label: "Blur / Sharpen",
    category: "distort",
    description: "Gaussian blur, box blur, or unsharp-mask sharpen.",
    inputs: [{ id: "src", label: "Source", type: "rgba" }],
    outputs: [{ id: "out", label: "Output", type: "rgba" }],
    params: [
      {
        id: "mode",
        label: "Mode",
        kind: "enum",
        options: [
          { value: "0", label: "Gaussian" },
          { value: "1", label: "Box" },
          { value: "2", label: "Sharpen" },
        ],
        default: "0",
      },
      { id: "radius", label: "Radius", kind: "float", min: 0, max: 16, step: 0.25, default: 2 },
    ],
    fragmentShader: BLUR_SHARPEN_FS,
    getUniforms: (p) => ({
      u_mode: Number(p.mode ?? 0),
      u_radius: Number(p.radius ?? 2),
    }),
  },
  {
    type: "distort.transform",
    label: "Transform / Tile",
    category: "distort",
    description: "Translates, rotates, scales, mirrors, and tiles a surface.",
    inputs: [{ id: "src", label: "Source", type: "rgba" }],
    outputs: [{ id: "out", label: "Output", type: "rgba" }],
    params: [
      { id: "offsetX", label: "Offset X", kind: "float", min: -1, max: 1, step: 0.01, default: 0 },
      { id: "offsetY", label: "Offset Y", kind: "float", min: -1, max: 1, step: 0.01, default: 0 },
      { id: "rotate", label: "Rotate", kind: "float", min: -180, max: 180, step: 1, default: 0 },
      { id: "scaleX", label: "Scale X", kind: "float", min: 0.1, max: 4, step: 0.05, default: 1 },
      { id: "scaleY", label: "Scale Y", kind: "float", min: 0.1, max: 4, step: 0.05, default: 1 },
      { id: "mirrorX", label: "Mirror X", kind: "bool", default: false },
      { id: "mirrorY", label: "Mirror Y", kind: "bool", default: false },
      { id: "repeatX", label: "Tile X", kind: "int", min: 1, max: 8, step: 1, default: 1 },
      { id: "repeatY", label: "Tile Y", kind: "int", min: 1, max: 8, step: 1, default: 1 },
    ],
    fragmentShader: TRANSFORM_FS,
    getUniforms: (p) => ({
      u_offsetX: Number(p.offsetX ?? 0),
      u_offsetY: Number(p.offsetY ?? 0),
      u_rotate: Number(p.rotate ?? 0),
      u_scaleX: Number(p.scaleX ?? 1),
      u_scaleY: Number(p.scaleY ?? 1),
      u_mirrorX: Boolean(p.mirrorX),
      u_mirrorY: Boolean(p.mirrorY),
      u_repeatX: Number(p.repeatX ?? 1),
      u_repeatY: Number(p.repeatY ?? 1),
    }),
  },
  {
    type: "distort.makeTileable",
    label: "Make Tileable",
    category: "distort",
    description: "Cross-fades borders with half-offset samples to remove seams.",
    inputs: [{ id: "src", label: "Source", type: "rgba" }],
    outputs: [{ id: "out", label: "Output", type: "rgba" }],
    params: [
      { id: "seamWidth", label: "Seam Width", kind: "float", min: 0.05, max: 0.5, step: 0.02, default: 0.25 },
    ],
    fragmentShader: MAKE_TILEABLE_FS,
    getUniforms: (p) => ({
      u_seamWidth: Number(p.seamWidth ?? 0.25),
    }),
  },
];
