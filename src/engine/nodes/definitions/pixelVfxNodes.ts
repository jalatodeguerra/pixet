import { COMMON_UNIFORMS_GLSL, OKLAB_GLSL, SCALAR_PACK_GLSL } from "../shaders/common.glsl.ts";
import { parseHexToRgba } from "../PaletteLut.ts";
import { scale2xEPX } from "../../tools/rotsprite.ts";
import { fillSinglePixelHoles, removeOrphanPixels } from "../../rig/pixelCleanup.ts";
import { PixelBuffer } from "../../document/PixelBuffer.ts";
import type { CpuSocketValue, NodeDefinition } from "../types.ts";

const BLEND_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}

uniform sampler2D u_base;
uniform sampler2D u_top;
uniform sampler2D u_mask;
uniform float u_mode;
uniform float u_opacity;
uniform float u_clipAlpha;

vec3 blendRgb(vec3 b, vec3 t, int m) {
  if (m == 1) return b * t; // Multiply
  if (m == 2) return 1.0 - (1.0 - b) * (1.0 - t); // Screen
  if (m == 3) return mix(2.0 * b * t, 1.0 - 2.0 * (1.0 - b) * (1.0 - t), step(0.5, b)); // Overlay
  if (m == 4) return min(vec3(1.0), b + t); // Add
  if (m == 5) return max(vec3(0.0), b - t); // Subtract
  if (m == 6) return min(b, t); // Darken
  if (m == 7) return max(b, t); // Lighten
  if (m == 8) return mix(2.0 * b * t, 1.0 - 2.0 * (1.0 - b) * (1.0 - t), step(0.5, t)); // Hard Light
  if (m == 9) return abs(b - t); // Difference
  return t; // Normal
}

void main() {
  vec4 b = texture(u_base, v_uv);
  vec4 t = texture(u_top, v_uv);
  float mask = sampleScalar(u_mask, v_uv);
  float a = clamp(t.a * u_opacity * mask, 0.0, 1.0);
  if (u_clipAlpha > 0.5) a *= b.a;
  vec3 mixed = blendRgb(b.rgb, t.rgb, int(u_mode + 0.5));
  vec3 outRgb = mix(b.rgb, mixed, a);
  float outA = max(b.a, a);
  outColor = vec4(outRgb, outA);
}
`;

const PIXELATE_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform float u_gridSize;

void main() {
  float g = max(2.0, floor(u_gridSize + 0.5));
  vec2 snapped = (floor(v_uv * g) + 0.5) / g;
  outColor = texture(u_src, snapped);
}
`;

const QUANTIZE_DITHER_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${OKLAB_GLSL}

uniform sampler2D u_src;
uniform sampler2D u_palette;
uniform int u_paletteCount;
uniform float u_ditherMode; // 0=None, 1=Bayer2, 2=Bayer4
uniform float u_ditherSpread;
uniform float u_alphaCutoff;

void main() {
  vec4 c = texture(u_src, v_uv);
  if (c.a < u_alphaCutoff) {
    outColor = vec4(0.0);
    return;
  }
  vec3 rgb = c.rgb;
  if (u_ditherMode > 0.5 && u_ditherSpread > 0.0) {
    float b = bayer4x4(v_uv * u_resolution);
    rgb = clamp(rgb + b * u_ditherSpread * 0.25, 0.0, 1.0);
  }
  if (u_paletteCount <= 0) {
    outColor = vec4(rgb, 1.0);
    return;
  }
  vec3 targetLab = srgbToOklab(rgb);
  float bestDist = 1e9;
  vec3 bestColor = rgb;
  int count = min(256, u_paletteCount);
  for (int i = 0; i < 256; i++) {
    if (i >= count) break;
    vec3 palRgb = texelFetch(u_palette, ivec2(i, 0), 0).rgb;
    vec3 palLab = srgbToOklab(palRgb);
    vec3 d = targetLab - palLab;
    float dist = dot(d, d);
    if (dist < bestDist) {
      bestDist = dist;
      bestColor = palRgb;
    }
  }
  outColor = vec4(bestColor, 1.0);
}
`;

const PALETTE_REMAP_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform sampler2D u_palette;
uniform int u_paletteCount;
uniform float u_offset;

void main() {
  vec4 c = texture(u_src, v_uv);
  if (c.a < 0.01 || u_paletteCount <= 0) {
    outColor = c;
    return;
  }
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  int idx = int(mod(floor(lum * float(u_paletteCount) + u_offset * float(u_paletteCount)), float(u_paletteCount)));
  vec3 pal = texelFetch(u_palette, ivec2(clamp(idx, 0, 255), 0), 0).rgb;
  outColor = vec4(pal, c.a);
}
`;

const GRADIENT_MAP_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}
${OKLAB_GLSL}

uniform sampler2D u_src;
uniform sampler2D u_palette;
uniform int u_paletteCount;
uniform float u_dither;

void main() {
  float g = sampleScalar(u_src, v_uv);
  if (u_dither > 0.0) {
    g = clamp(g + bayer4x4(v_uv * u_resolution) * u_dither * 0.15, 0.0, 1.0);
  }
  if (u_paletteCount <= 0) {
    outColor = vec4(g, g, g, 1.0);
    return;
  }
  float fidx = clamp(g, 0.0, 1.0) * float(max(1, u_paletteCount - 1));
  int i0 = int(floor(fidx));
  int i1 = min(u_paletteCount - 1, i0 + 1);
  vec3 c0 = texelFetch(u_palette, ivec2(i0, 0), 0).rgb;
  vec3 c1 = texelFetch(u_palette, ivec2(i1, 0), 0).rgb;
  outColor = vec4(mix(c0, c1, fract(fidx)), 1.0);
}
`;

const OUTLINE_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform float u_placement; // 0=Outside, 1=Inside, 2=OutlineOnly
uniform float u_conn; // 0=4-way, 1=8-way
uniform float u_thickness;
uniform float u_cutoff;
uniform vec4 u_color;

void main() {
  vec4 c = texture(u_src, v_uv);
  bool selfOpaque = c.a >= u_cutoff;
  int r = int(clamp(u_thickness, 1.0, 8.0));
  bool neighborOpaque = false;
  bool neighborTransp = false;

  for (int dy = -8; dy <= 8; dy++) {
    if (abs(dy) > r) continue;
    for (int dx = -8; dx <= 8; dx++) {
      if (abs(dx) > r) continue;
      if (dx == 0 && dy == 0) continue;
      if (u_conn < 0.5 && (abs(dx) + abs(dy) > r)) continue;
      float na = texture(u_src, v_uv + vec2(float(dx), float(dy)) * u_texelSize).a;
      if (na >= u_cutoff) neighborOpaque = true;
      else neighborTransp = true;
    }
  }

  if (u_placement < 0.5) {
    outColor = selfOpaque ? c : (neighborOpaque ? u_color : vec4(0.0));
  } else if (u_placement < 1.5) {
    outColor = (selfOpaque && neighborTransp) ? u_color : c;
  } else {
    outColor = (!selfOpaque && neighborOpaque) ? u_color : vec4(0.0);
  }
}
`;

const MORPHOLOGY_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform float u_op; // 0=Dilate, 1=Erode
uniform float u_radius;

void main() {
  int r = int(clamp(u_radius, 1.0, 8.0));
  vec4 best = texture(u_src, v_uv);
  for (int dy = -8; dy <= 8; dy++) {
    if (abs(dy) > r) continue;
    for (int dx = -8; dx <= 8; dx++) {
      if (abs(dx) > r) continue;
      vec4 s = texture(u_src, v_uv + vec2(float(dx), float(dy)) * u_texelSize);
      if (u_op < 0.5) best = max(best, s);
      else best = min(best, s);
    }
  }
  outColor = best;
}
`;

const DROP_SHADOW_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform float u_offsetX;
uniform float u_offsetY;
uniform vec4 u_color;
uniform float u_opacity;

void main() {
  vec4 c = texture(u_src, v_uv);
  vec2 shUv = v_uv - vec2(u_offsetX, u_offsetY) * u_texelSize;
  float shA = texture(u_src, shUv).a * u_opacity * u_color.a;
  vec4 shadow = vec4(u_color.rgb, shA);
  outColor = mix(shadow, c, c.a);
}
`;

const GLOW_VFX_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}

uniform sampler2D u_src;
uniform float u_threshold;
uniform float u_radius;
uniform float u_intensity;
uniform float u_chromatic;
uniform float u_scanlines;

void main() {
  vec2 ca = vec2(u_chromatic, 0.0) * u_texelSize;
  float rCh = texture(u_src, v_uv + ca).r;
  vec4 base = texture(u_src, v_uv);
  float bCh = texture(u_src, v_uv - ca).b;
  vec3 col = vec3(rCh, base.g, bCh);

  vec3 bloom = vec3(0.0);
  int rad = int(clamp(u_radius, 1.0, 6.0));
  float cnt = 0.0;
  for (int dy = -6; dy <= 6; dy++) {
    if (abs(dy) > rad) continue;
    for (int dx = -6; dx <= 6; dx++) {
      if (abs(dx) > rad) continue;
      vec4 s = texture(u_src, v_uv + vec2(float(dx), float(dy)) * u_texelSize * 1.5);
      float lum = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
      bloom += s.rgb * s.a * max(0.0, lum - u_threshold);
      cnt += 1.0;
    }
  }
  col += (bloom / max(1.0, cnt)) * u_intensity * 3.0;
  if (u_scanlines > 0.0) {
    float scan = 1.0 - u_scanlines * 0.35 * step(0.5, fract(v_uv.y * u_resolution.y * 0.5));
    col *= scan;
  }
  outColor = vec4(clamp(col, 0.0, 1.0), base.a);
}
`;

export const PIXEL_VFX_NODES: NodeDefinition[] = [
  {
    type: "pixel.blend",
    label: "Blend",
    category: "pixel",
    description: "Composites two RGBA layers with Pixet blend modes and an optional mask.",
    inputs: [
      { id: "base", label: "Base", type: "rgba" },
      { id: "top", label: "Top", type: "rgba" },
      { id: "mask", label: "Mask", type: "gray", optional: true },
    ],
    outputs: [{ id: "out", label: "Result", type: "rgba" }],
    params: [
      {
        id: "mode",
        label: "Mode",
        kind: "enum",
        options: [
          { value: "0", label: "Normal" },
          { value: "1", label: "Multiply" },
          { value: "2", label: "Screen" },
          { value: "3", label: "Overlay" },
          { value: "4", label: "Add" },
          { value: "5", label: "Subtract" },
          { value: "6", label: "Darken" },
          { value: "7", label: "Lighten" },
          { value: "8", label: "Hard Light" },
          { value: "9", label: "Difference" },
        ],
        default: "0",
      },
      { id: "opacity", label: "Opacity", kind: "float", min: 0, max: 1, step: 0.02, default: 1 },
      { id: "clipAlpha", label: "Clip to Base", kind: "bool", default: false },
    ],
    fragmentShader: BLEND_FS,
    getUniforms: (p) => ({
      u_mode: Number(p.mode ?? 0),
      u_opacity: Number(p.opacity ?? 1),
      u_clipAlpha: Boolean(p.clipAlpha),
    }),
  },
  {
    type: "pixel.pixelate",
    label: "Pixelate",
    category: "pixel",
    description: "Snaps sampling to a crisp nearest-neighbor pixel grid.",
    inputs: [{ id: "src", label: "Source", type: "rgba" }],
    outputs: [{ id: "out", label: "Pixelated", type: "rgba" }],
    params: [
      { id: "gridSize", label: "Grid Size", kind: "int", min: 8, max: 512, step: 4, default: 64 },
    ],
    defaultFilter: "nearest",
    fragmentShader: PIXELATE_FS,
    getUniforms: (p) => ({ u_gridSize: Number(p.gridSize ?? 64) }),
  },
  {
    type: "pixel.clean",
    label: "Pixel Clean / Scale2x",
    category: "pixel",
    description: "CPU-bridge Scale2x / EPX upscaling or 1px orphan & hole cleanup.",
    inputs: [{ id: "src", label: "Source", type: "rgba" }],
    outputs: [{ id: "out", label: "Cleaned", type: "rgba" }],
    params: [
      {
        id: "mode",
        label: "Mode",
        kind: "enum",
        options: [
          { value: "cleanup", label: "1px Orphan & Hole Cleanup" },
          { value: "scale2x", label: "Scale2x (EPX)" },
        ],
        default: "cleanup",
      },
    ],
    defaultFilter: "nearest",
    outputPrecision: "ldr8",
    cpuEvaluate: (inputs, params): Record<string, CpuSocketValue> => {
      const src = inputs.src;
      if (!src || src.kind !== "rgba") {
        return {
          out: { kind: "rgba", width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0]) },
        };
      }
      const buf = new PixelBuffer(src.width, src.height);
      buf.data.set(src.data);
      const mode = String(params.mode ?? "cleanup");
      const outBuf =
        mode === "scale2x"
          ? scale2xEPX(buf)
          : fillSinglePixelHoles(removeOrphanPixels(buf));
      return {
        out: {
          kind: "rgba",
          width: outBuf.width,
          height: outBuf.height,
          data: outBuf.data,
        },
      };
    },
  },
  {
    type: "pixel.quantize",
    label: "Palette Quantize & Dither",
    category: "pixel",
    description: "Quantizes colors to the connected Palette LUT in OKLab with optional Bayer dither.",
    inputs: [
      { id: "src", label: "Source", type: "rgba" },
      { id: "palette", label: "Palette", type: "palette" },
    ],
    outputs: [{ id: "out", label: "Indexed", type: "rgba" }],
    params: [
      {
        id: "ditherMode",
        label: "Dither",
        kind: "enum",
        options: [
          { value: "0", label: "None" },
          { value: "1", label: "Bayer 4×4" },
        ],
        default: "1",
      },
      { id: "ditherSpread", label: "Dither Spread", kind: "float", min: 0, max: 1, step: 0.05, default: 0.35 },
      { id: "alphaCutoff", label: "Alpha Cutoff", kind: "float", min: 0.05, max: 0.95, step: 0.05, default: 0.5 },
    ],
    defaultFilter: "nearest",
    outputPrecision: "ldr8",
    fragmentShader: QUANTIZE_DITHER_FS,
    getUniforms: (p) => ({
      u_ditherMode: Number(p.ditherMode ?? 1),
      u_ditherSpread: Number(p.ditherSpread ?? 0.35),
      u_alphaCutoff: Number(p.alphaCutoff ?? 0.5),
    }),
  },
  {
    type: "pixel.paletteRemap",
    label: "Palette Remap / Cycle",
    category: "pixel",
    description: "Remaps luminance to palette entries with animatable cycle offset.",
    inputs: [
      { id: "src", label: "Source", type: "rgba" },
      { id: "palette", label: "Palette", type: "palette" },
    ],
    outputs: [{ id: "out", label: "Remapped", type: "rgba" }],
    params: [
      { id: "offset", label: "Cycle Offset", kind: "float", min: 0, max: 1, step: 0.02, default: 0, animatable: true },
    ],
    defaultFilter: "nearest",
    outputPrecision: "ldr8",
    fragmentShader: PALETTE_REMAP_FS,
    getUniforms: (p) => ({ u_offset: Number(p.offset ?? 0) }),
  },
  {
    type: "pixel.gradientMap",
    label: "Gradient Map",
    category: "pixel",
    description: "Maps a grayscale heightfield across the connected Palette LUT.",
    inputs: [
      { id: "src", label: "Height", type: "gray" },
      { id: "palette", label: "Palette", type: "palette" },
    ],
    outputs: [{ id: "out", label: "Colored", type: "rgba" }],
    params: [
      { id: "dither", label: "Bayer Dither", kind: "float", min: 0, max: 1, step: 0.05, default: 0 },
    ],
    defaultFilter: "nearest",
    outputPrecision: "ldr8",
    fragmentShader: GRADIENT_MAP_FS,
    getUniforms: (p) => ({ u_dither: Number(p.dither ?? 0) }),
  },
  {
    type: "pixel.outline",
    label: "Outline / Inline",
    category: "pixel",
    description: "Adds crisp 4-way or 8-way pixel outlines or inlines around sprites.",
    inputs: [{ id: "src", label: "Sprite", type: "rgba" }],
    outputs: [{ id: "out", label: "Outlined", type: "rgba" }],
    params: [
      {
        id: "placement",
        label: "Placement",
        kind: "enum",
        options: [
          { value: "0", label: "Outside" },
          { value: "1", label: "Inside" },
          { value: "2", label: "Outline Only" },
        ],
        default: "0",
      },
      {
        id: "conn",
        label: "Connectivity",
        kind: "enum",
        options: [
          { value: "0", label: "4-Way Pixel" },
          { value: "1", label: "8-Way" },
        ],
        default: "0",
      },
      { id: "thickness", label: "Thickness", kind: "int", min: 1, max: 8, step: 1, default: 1 },
      { id: "color", label: "Color", kind: "color", default: "#000000" },
      { id: "cutoff", label: "Alpha Cutoff", kind: "float", min: 0.05, max: 0.95, step: 0.05, default: 0.5 },
    ],
    defaultWrap: "clamp",
    defaultFilter: "nearest",
    outputPrecision: "ldr8",
    fragmentShader: OUTLINE_FS,
    getUniforms: (p) => {
      const rgba = parseHexToRgba(String(p.color ?? "#000000"));
      return {
        u_placement: Number(p.placement ?? 0),
        u_conn: Number(p.conn ?? 0),
        u_thickness: Number(p.thickness ?? 1),
        u_cutoff: Number(p.cutoff ?? 0.5),
        u_color: [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255],
      };
    },
  },
  {
    type: "pixel.morphology",
    label: "Morphology (Dilate / Erode)",
    category: "pixel",
    description: "Expands or shrinks masks and sprites.",
    inputs: [{ id: "src", label: "Source", type: "rgba" }],
    outputs: [{ id: "out", label: "Result", type: "rgba" }],
    params: [
      {
        id: "op",
        label: "Operation",
        kind: "enum",
        options: [
          { value: "0", label: "Dilate" },
          { value: "1", label: "Erode" },
        ],
        default: "0",
      },
      { id: "radius", label: "Radius", kind: "int", min: 1, max: 8, step: 1, default: 1 },
    ],
    defaultFilter: "nearest",
    fragmentShader: MORPHOLOGY_FS,
    getUniforms: (p) => ({
      u_op: Number(p.op ?? 0),
      u_radius: Number(p.radius ?? 1),
    }),
  },
  {
    type: "pixel.dropShadow",
    label: "Drop Shadow",
    category: "pixel",
    description: "Projects a crisp pixel-offset drop shadow behind a sprite.",
    inputs: [{ id: "src", label: "Sprite", type: "rgba" }],
    outputs: [{ id: "out", label: "Result", type: "rgba" }],
    params: [
      { id: "offsetX", label: "Offset X", kind: "int", min: -32, max: 32, step: 1, default: 2 },
      { id: "offsetY", label: "Offset Y", kind: "int", min: -32, max: 32, step: 1, default: 2 },
      { id: "color", label: "Shadow Color", kind: "color", default: "#000000" },
      { id: "opacity", label: "Opacity", kind: "float", min: 0, max: 1, step: 0.05, default: 0.65 },
    ],
    defaultWrap: "clamp",
    defaultFilter: "nearest",
    fragmentShader: DROP_SHADOW_FS,
    getUniforms: (p) => {
      const rgba = parseHexToRgba(String(p.color ?? "#000000"));
      return {
        u_offsetX: Number(p.offsetX ?? 2),
        u_offsetY: Number(p.offsetY ?? 2),
        u_opacity: Number(p.opacity ?? 0.65),
        u_color: [rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255],
      };
    },
  },
  {
    type: "pixel.glowVfx",
    label: "Glow / Chromatic VFX",
    category: "pixel",
    description: "Adds thresholded bloom, chromatic aberration, and CRT scanlines.",
    inputs: [{ id: "src", label: "Sprite", type: "rgba" }],
    outputs: [{ id: "out", label: "VFX", type: "rgba" }],
    params: [
      { id: "threshold", label: "Threshold", kind: "float", min: 0, max: 1, step: 0.02, default: 0.45 },
      { id: "radius", label: "Bloom Radius", kind: "int", min: 1, max: 6, step: 1, default: 3 },
      { id: "intensity", label: "Intensity", kind: "float", min: 0, max: 2, step: 0.05, default: 0.6 },
      { id: "chromatic", label: "Chromatic Shift", kind: "float", min: 0, max: 6, step: 0.5, default: 0 },
      { id: "scanlines", label: "Scanlines", kind: "float", min: 0, max: 1, step: 0.05, default: 0 },
    ],
    defaultWrap: "clamp",
    fragmentShader: GLOW_VFX_FS,
    getUniforms: (p) => ({
      u_threshold: Number(p.threshold ?? 0.45),
      u_radius: Number(p.radius ?? 3),
      u_intensity: Number(p.intensity ?? 0.6),
      u_chromatic: Number(p.chromatic ?? 0),
      u_scanlines: Number(p.scanlines ?? 0),
    }),
  },
];
