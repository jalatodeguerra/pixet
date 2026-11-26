import {
  COMMON_UNIFORMS_GLSL,
  HASH_AND_MATH_GLSL,
  SCALAR_PACK_GLSL,
} from "../shaders/common.glsl.ts";
import { NOISE_GLSL } from "../shaders/noise.glsl.ts";
import { SDF_GLSL } from "../shaders/sdf.glsl.ts";
import type { NodeDefinition } from "../types.ts";

const NOISE_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}
${HASH_AND_MATH_GLSL}
${NOISE_GLSL}

uniform sampler2D u_uv;
uniform float u_scaleX;
uniform float u_scaleY;
uniform float u_octaves;
uniform float u_persistence;
uniform float u_lacunarity;
uniform float u_mode;

void main() {
  vec2 offset = texture(u_uv, v_uv).xy * 0.15;
  vec2 uv = fract(v_uv + offset);
  vec2 period = max(vec2(1.0), floor(vec2(u_scaleX, u_scaleY) + 0.5));
  float n = periodicFbm(uv, period, int(u_octaves), u_persistence, u_lacunarity, int(u_mode), u_seed);
  outColor = encodeScalar(n);
}
`;

const VORONOI_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}
${HASH_AND_MATH_GLSL}
${NOISE_GLSL}

uniform sampler2D u_uv;
uniform float u_scaleX;
uniform float u_scaleY;
uniform float u_jitter;
uniform float u_metric;
uniform float u_mode; // 0=F1, 1=F2-F1 cracks, 2=CellID

void main() {
  vec2 offset = texture(u_uv, v_uv).xy * 0.15;
  vec2 uv = fract(v_uv + offset);
  vec2 period = max(vec2(1.0), floor(vec2(u_scaleX, u_scaleY) + 0.5));
  vec4 v = periodicVoronoi(uv, period, u_jitter, int(u_metric), u_seed);
  float val = u_mode < 0.5 ? v.x : (u_mode < 1.5 ? v.y : v.z);
  outColor = encodeScalar(val);
}
`;

const BRICKS_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}
${HASH_AND_MATH_GLSL}

uniform float u_rows;
uniform float u_cols;
uniform float u_offset;
uniform float u_mortar;
uniform float u_bevel;
uniform float u_roundness;
uniform float u_variance;
uniform float u_pattern; // 0=RunningBond, 1=Grid, 2=Herringbone, 3=Cobble

void main() {
  vec2 rowsCols = max(vec2(1.0), floor(vec2(u_cols, u_rows) + 0.5));
  vec2 st = v_uv * rowsCols;
  float row = floor(st.y);
  if (u_pattern < 0.5) {
    st.x += mod(row, 2.0) * u_offset;
  } else if (u_pattern > 1.5 && u_pattern < 2.5) {
    // Herringbone-like alternating tile swap
    float checker = mod(floor(st.x) + row, 2.0);
    st = mix(st, st.yx, checker * 0.5);
  }
  vec2 cell = mod(floor(st), rowsCols);
  vec2 f = fract(st) - 0.5;
  if (u_pattern > 2.5) {
    vec2 jit = (hash22(cell, u_seed) - 0.5) * 0.14;
    f += jit;
  }
  vec2 halfSize = vec2(0.5 - u_mortar * 0.5) - vec2(u_roundness * 0.25);
  vec2 q = abs(f) - max(halfSize, vec2(0.01));
  float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_roundness * 0.25;
  float edge = clamp(-dist / max(u_bevel * 0.25, 0.002), 0.0, 1.0);
  float hRand = 1.0 - hash21(cell, u_seed) * u_variance;
  float height = edge * hRand;
  outColor = encodeScalar(clamp(height, 0.0, 1.0));
}
`;

const SDF_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}
${SDF_GLSL}

uniform float u_shape;
uniform float u_sizeX;
uniform float u_sizeY;
uniform float u_softness;
uniform float u_angle;
uniform float u_profile; // 0=Flat, 1=LinearBevel, 2=Dome

void main() {
  vec2 p = rotate2D(v_uv - 0.5, radians(u_angle));
  vec2 sz = vec2(u_sizeX, u_sizeY) * 0.5;
  float d = 0.0;
  int sh = int(u_shape + 0.5);
  if (sh == 0) d = sdCircle(p, sz.x);
  else if (sh == 1) d = sdBox(p, sz);
  else if (sh == 2) d = sdRoundedBox(p, sz, min(sz.x, sz.y) * 0.25);
  else if (sh == 3) d = sdRegularPolygon(p, sz.x, 6);
  else if (sh == 4) d = sdStar(p, sz.x, 5, 2.5);
  else if (sh == 5) d = sdCross(p, vec2(sz.x, sz.y * 0.35), 0.0);
  else d = sdRing(p, sz.x * 0.75, sz.y * 0.2);

  float soft = max(u_softness, 0.002);
  float val = clamp(-d / soft, 0.0, 1.0);
  if (u_profile < 0.5) {
    val = smoothstep(0.0, soft, -d);
  } else if (u_profile > 1.5) {
    val = sqrt(max(0.0, 1.0 - pow(1.0 - val, 2.0)));
  }
  outColor = encodeScalar(val);
}
`;

const GRADIENT_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}
${SDF_GLSL}

uniform float u_mode; // 0=Linear, 1=Bilinear, 2=Radial, 3=Angular, 4=Diamond
uniform float u_angle;
uniform float u_repeat;
uniform float u_pingPong;

void main() {
  vec2 p = rotate2D(v_uv - 0.5, radians(u_angle));
  float g = 0.0;
  int m = int(u_mode + 0.5);
  if (m == 0) g = p.x + 0.5;
  else if (m == 1) g = 1.0 - abs(p.x * 2.0);
  else if (m == 2) g = 1.0 - clamp(length(p) * 2.0, 0.0, 1.0);
  else if (m == 3) g = atan(p.y, p.x) / 6.28318530718 + 0.5;
  else g = 1.0 - clamp((abs(p.x) + abs(p.y)) * 1.414, 0.0, 1.0);

  g *= max(1.0, u_repeat);
  if (u_pingPong > 0.5) {
    g = 1.0 - abs(mod(g, 2.0) - 1.0);
  } else {
    g = fract(g);
  }
  outColor = encodeScalar(clamp(g, 0.0, 1.0));
}
`;

const WEAVE_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}
${HASH_AND_MATH_GLSL}

uniform float u_pattern; // 0=Weave, 1=Chainmail, 2=Truchet, 3=Checker
uniform float u_tilingX;
uniform float u_tilingY;
uniform float u_strandWidth;
uniform float u_depth;

void main() {
  vec2 tiling = max(vec2(1.0), floor(vec2(u_tilingX, u_tilingY) + 0.5));
  vec2 st = v_uv * tiling;
  vec2 cell = mod(floor(st), tiling);
  vec2 f = fract(st) - 0.5;
  float val = 0.0;
  int pat = int(u_pattern + 0.5);

  if (pat == 3) {
    val = mod(cell.x + cell.y, 2.0);
  } else if (pat == 2) {
    float flip = step(0.5, hash21(cell, u_seed));
    vec2 q = flip > 0.5 ? vec2(f.x, -f.y) : f;
    float d1 = abs(length(q - 0.5) - 0.5);
    float d2 = abs(length(q + 0.5) - 0.5);
    val = 1.0 - smoothstep(u_strandWidth * 0.25, u_strandWidth * 0.25 + 0.05, min(d1, d2));
  } else if (pat == 1) {
    float r = length(f);
    float ring = 1.0 - smoothstep(0.12 * u_strandWidth, 0.12 * u_strandWidth + 0.04, abs(r - 0.34));
    val = ring;
  } else {
    float chk = mod(cell.x + cell.y, 2.0);
    float wx = 1.0 - smoothstep(u_strandWidth * 0.4, u_strandWidth * 0.45, abs(f.x));
    float wy = 1.0 - smoothstep(u_strandWidth * 0.4, u_strandWidth * 0.45, abs(f.y));
    float archX = cos(f.y * 3.14159) * u_depth;
    float archY = cos(f.x * 3.14159) * u_depth;
    val = chk > 0.5 ? max(wx * archX, wy * (1.0 - u_depth)) : max(wy * archY, wx * (1.0 - u_depth));
  }
  outColor = encodeScalar(clamp(val, 0.0, 1.0));
}
`;

const SPLATTER_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${HASH_AND_MATH_GLSL}

uniform sampler2D u_stamp;
uniform sampler2D u_mask;
uniform float u_grid;
uniform float u_scaleMin;
uniform float u_scaleMax;
uniform float u_rotJitter;
uniform float u_snap90;

void main() {
  float grid = max(1.0, floor(u_grid + 0.5));
  vec4 acc = vec4(0.0);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 baseCell = floor(v_uv * grid) + vec2(float(dx), float(dy));
      vec2 wrappedCell = mod(mod(baseCell, grid) + grid, grid);
      vec2 r1 = hash22(wrappedCell, u_seed);
      vec2 r2 = hash22(wrappedCell + 19.0, u_seed + 7);
      vec2 center = (baseCell + 0.25 + r1 * 0.5) / grid;
      float prob = texture(u_mask, fract(center)).r;
      if (r2.x > prob && prob < 0.99) continue;

      vec2 diff = v_uv - center;
      float ang = (r2.y - 0.5) * radians(u_rotJitter);
      if (u_snap90 > 0.5) {
        ang = floor(r2.y * 4.0) * 1.57079632679;
      }
      float c = cos(ang);
      float s = sin(ang);
      vec2 rot = vec2(c * diff.x - s * diff.y, s * diff.x + c * diff.y);
      float sc = mix(u_scaleMin, u_scaleMax, r1.x) / grid;
      vec2 suv = rot / max(sc, 0.001) + 0.5;
      if (suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0) {
        vec4 samp = texture(u_stamp, suv);
        acc = mix(acc, samp, samp.a);
      }
    }
  }
  outColor = acc;
}
`;

const AUTOTILE_MASK_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}
${HASH_AND_MATH_GLSL}
${NOISE_GLSL}

uniform float u_bitmask;
uniform float u_borderWidth;
uniform float u_roundness;
uniform float u_edgeNoise;

void main() {
  int mask = int(u_bitmask + 0.5);
  bool hasN = (mask & 1) != 0;
  bool hasE = (mask & 2) != 0;
  bool hasS = (mask & 4) != 0;
  bool hasW = (mask & 8) != 0;

  float bw = u_borderWidth;
  float left = hasW ? 0.0 : bw;
  float right = hasE ? 1.0 : 1.0 - bw;
  float top = hasN ? 0.0 : bw;
  float bottom = hasS ? 1.0 : 1.0 - bw;

  vec2 center = vec2((left + right) * 0.5, (top + bottom) * 0.5);
  vec2 halfExt = vec2((right - left) * 0.5, (bottom - top) * 0.5);
  float r = min(u_roundness * 0.25, min(halfExt.x, halfExt.y));
  vec2 q = abs(v_uv - center) - (halfExt - vec2(r));
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;

  float n = (periodicFbm(v_uv, vec2(6.0), 3, 0.5, 2.0, 0, u_seed) - 0.5) * u_edgeNoise * 0.2;
  float val = smoothstep(0.02, -0.02, sd + n);
  outColor = encodeScalar(val);
}
`;

export const GENERATOR_NODES: NodeDefinition[] = [
  {
    type: "gen.noise",
    label: "Tileable Noise",
    category: "generators",
    description: "Seamless periodic Perlin, Value, Ridged, or Turbulence noise.",
    inputs: [{ id: "uv", label: "UV Warp", type: "vec2", optional: true }],
    outputs: [{ id: "out", label: "Height", type: "gray" }],
    params: [
      {
        id: "mode",
        label: "Type",
        kind: "enum",
        options: [
          { value: "0", label: "Perlin" },
          { value: "1", label: "Value" },
          { value: "2", label: "Ridged FBM" },
          { value: "3", label: "Turbulence" },
        ],
        default: "0",
      },
      { id: "scaleX", label: "Scale X", kind: "int", min: 1, max: 32, step: 1, default: 4 },
      { id: "scaleY", label: "Scale Y", kind: "int", min: 1, max: 32, step: 1, default: 4 },
      { id: "octaves", label: "Octaves", kind: "int", min: 1, max: 8, step: 1, default: 4 },
      { id: "persistence", label: "Persistence", kind: "float", min: 0.1, max: 0.9, step: 0.05, default: 0.5 },
      { id: "lacunarity", label: "Lacunarity", kind: "float", min: 1.0, max: 4.0, step: 0.1, default: 2.0 },
      { id: "seed", label: "Seed", kind: "seed", default: 101 },
    ],
    fragmentShader: NOISE_FS,
    getUniforms: (p) => ({
      u_mode: Number(p.mode ?? 0),
      u_scaleX: Number(p.scaleX ?? 4),
      u_scaleY: Number(p.scaleY ?? 4),
      u_octaves: Number(p.octaves ?? 4),
      u_persistence: Number(p.persistence ?? 0.5),
      u_lacunarity: Number(p.lacunarity ?? 2.0),
    }),
  },
  {
    type: "gen.voronoi",
    label: "Voronoi / Worley",
    category: "generators",
    description: "Seamless cellular Voronoi distance, cracks (F2-F1), and cell IDs.",
    inputs: [{ id: "uv", label: "UV Warp", type: "vec2", optional: true }],
    outputs: [{ id: "out", label: "Output", type: "gray" }],
    params: [
      {
        id: "mode",
        label: "Output",
        kind: "enum",
        options: [
          { value: "0", label: "Distance (F1)" },
          { value: "1", label: "Cracks (F2 - F1)" },
          { value: "2", label: "Cell ID" },
        ],
        default: "0",
      },
      {
        id: "metric",
        label: "Metric",
        kind: "enum",
        options: [
          { value: "0", label: "Euclidean" },
          { value: "1", label: "Manhattan" },
          { value: "2", label: "Chebyshev" },
        ],
        default: "0",
      },
      { id: "scaleX", label: "Scale X", kind: "int", min: 1, max: 32, step: 1, default: 4 },
      { id: "scaleY", label: "Scale Y", kind: "int", min: 1, max: 32, step: 1, default: 4 },
      { id: "jitter", label: "Jitter", kind: "float", min: 0, max: 1, step: 0.02, default: 0.85 },
      { id: "seed", label: "Seed", kind: "seed", default: 202 },
    ],
    fragmentShader: VORONOI_FS,
    getUniforms: (p) => ({
      u_mode: Number(p.mode ?? 0),
      u_metric: Number(p.metric ?? 0),
      u_scaleX: Number(p.scaleX ?? 4),
      u_scaleY: Number(p.scaleY ?? 4),
      u_jitter: Number(p.jitter ?? 0.85),
    }),
  },
  {
    type: "gen.bricks",
    label: "Bricks / Tiles",
    category: "generators",
    description: "Procedural tileable bricks, cobbles, and beveled masonry.",
    inputs: [],
    outputs: [{ id: "height", label: "Height", type: "gray" }],
    params: [
      {
        id: "pattern",
        label: "Pattern",
        kind: "enum",
        options: [
          { value: "0", label: "Running Bond" },
          { value: "1", label: "Grid" },
          { value: "2", label: "Herringbone" },
          { value: "3", label: "Cobble" },
        ],
        default: "0",
      },
      { id: "rows", label: "Rows", kind: "int", min: 1, max: 32, step: 1, default: 6 },
      { id: "cols", label: "Columns", kind: "int", min: 1, max: 32, step: 1, default: 3 },
      { id: "offset", label: "Row Offset", kind: "float", min: 0, max: 1, step: 0.05, default: 0.5 },
      { id: "mortar", label: "Mortar", kind: "float", min: 0.01, max: 0.3, step: 0.01, default: 0.08 },
      { id: "bevel", label: "Bevel", kind: "float", min: 0.02, max: 1, step: 0.02, default: 0.25 },
      { id: "roundness", label: "Roundness", kind: "float", min: 0, max: 1, step: 0.05, default: 0.15 },
      { id: "variance", label: "Height Var", kind: "float", min: 0, max: 0.8, step: 0.02, default: 0.2 },
      { id: "seed", label: "Seed", kind: "seed", default: 303 },
    ],
    fragmentShader: BRICKS_FS,
    getUniforms: (p) => ({
      u_pattern: Number(p.pattern ?? 0),
      u_rows: Number(p.rows ?? 6),
      u_cols: Number(p.cols ?? 3),
      u_offset: Number(p.offset ?? 0.5),
      u_mortar: Number(p.mortar ?? 0.08),
      u_bevel: Number(p.bevel ?? 0.25),
      u_roundness: Number(p.roundness ?? 0.15),
      u_variance: Number(p.variance ?? 0.2),
    }),
  },
  {
    type: "gen.sdf",
    label: "Shape / 2D SDF",
    category: "generators",
    description: "2D signed distance shape with flat, beveled, or dome profile.",
    inputs: [],
    outputs: [{ id: "out", label: "Shape", type: "gray" }],
    params: [
      {
        id: "shape",
        label: "Shape",
        kind: "enum",
        options: [
          { value: "0", label: "Circle" },
          { value: "1", label: "Box" },
          { value: "2", label: "Rounded Box" },
          { value: "3", label: "Hexagon" },
          { value: "4", label: "Star" },
          { value: "5", label: "Cross" },
          { value: "6", label: "Ring" },
        ],
        default: "0",
      },
      { id: "sizeX", label: "Size X", kind: "float", min: 0.05, max: 1, step: 0.01, default: 0.65 },
      { id: "sizeY", label: "Size Y", kind: "float", min: 0.05, max: 1, step: 0.01, default: 0.65 },
      {
        id: "profile",
        label: "Profile",
        kind: "enum",
        options: [
          { value: "0", label: "Flat" },
          { value: "1", label: "Linear Bevel" },
          { value: "2", label: "Smooth Dome" },
        ],
        default: "1",
      },
      { id: "softness", label: "Softness", kind: "float", min: 0.001, max: 0.5, step: 0.01, default: 0.05 },
      { id: "angle", label: "Angle", kind: "float", min: 0, max: 360, step: 1, default: 0 },
    ],
    defaultWrap: "clamp",
    fragmentShader: SDF_FS,
    getUniforms: (p) => ({
      u_shape: Number(p.shape ?? 0),
      u_sizeX: Number(p.sizeX ?? 0.65),
      u_sizeY: Number(p.sizeY ?? 0.65),
      u_profile: Number(p.profile ?? 1),
      u_softness: Number(p.softness ?? 0.05),
      u_angle: Number(p.angle ?? 0),
    }),
  },
  {
    type: "gen.gradient",
    label: "Gradient",
    category: "generators",
    description: "Linear, bilinear, radial, angular, or diamond gradient.",
    inputs: [],
    outputs: [{ id: "out", label: "Gradient", type: "gray" }],
    params: [
      {
        id: "mode",
        label: "Mode",
        kind: "enum",
        options: [
          { value: "0", label: "Linear" },
          { value: "1", label: "Bilinear" },
          { value: "2", label: "Radial" },
          { value: "3", label: "Angular" },
          { value: "4", label: "Diamond" },
        ],
        default: "0",
      },
      { id: "angle", label: "Angle", kind: "float", min: 0, max: 360, step: 1, default: 0 },
      { id: "repeat", label: "Repeat", kind: "int", min: 1, max: 16, step: 1, default: 1 },
      { id: "pingPong", label: "Ping-Pong", kind: "bool", default: false },
    ],
    fragmentShader: GRADIENT_FS,
    getUniforms: (p) => ({
      u_mode: Number(p.mode ?? 0),
      u_angle: Number(p.angle ?? 0),
      u_repeat: Number(p.repeat ?? 1),
      u_pingPong: Boolean(p.pingPong),
    }),
  },
  {
    type: "gen.weave",
    label: "Weave / Truchet",
    category: "generators",
    description: "Over-under fabric weave, chainmail, Truchet arcs, or checker.",
    inputs: [],
    outputs: [{ id: "out", label: "Height", type: "gray" }],
    params: [
      {
        id: "pattern",
        label: "Pattern",
        kind: "enum",
        options: [
          { value: "0", label: "Over-Under Weave" },
          { value: "1", label: "Chainmail" },
          { value: "2", label: "Truchet Arcs" },
          { value: "3", label: "Checker" },
        ],
        default: "0",
      },
      { id: "tilingX", label: "Tiling X", kind: "int", min: 1, max: 32, step: 1, default: 6 },
      { id: "tilingY", label: "Tiling Y", kind: "int", min: 1, max: 32, step: 1, default: 6 },
      { id: "strandWidth", label: "Strand Width", kind: "float", min: 0.1, max: 1, step: 0.02, default: 0.7 },
      { id: "depth", label: "Weave Depth", kind: "float", min: 0.1, max: 1, step: 0.05, default: 0.8 },
      { id: "seed", label: "Seed", kind: "seed", default: 404 },
    ],
    fragmentShader: WEAVE_FS,
    getUniforms: (p) => ({
      u_pattern: Number(p.pattern ?? 0),
      u_tilingX: Number(p.tilingX ?? 6),
      u_tilingY: Number(p.tilingY ?? 6),
      u_strandWidth: Number(p.strandWidth ?? 0.7),
      u_depth: Number(p.depth ?? 0.8),
    }),
  },
  {
    type: "gen.splatter",
    label: "Splatter / Scatter",
    category: "generators",
    description: "Stamps an input sprite or shape across a seamless jittered grid.",
    inputs: [
      { id: "stamp", label: "Stamp", type: "rgba" },
      { id: "mask", label: "Prob Mask", type: "gray", optional: true },
    ],
    outputs: [{ id: "out", label: "Surface", type: "rgba" }],
    params: [
      { id: "grid", label: "Grid Density", kind: "int", min: 1, max: 16, step: 1, default: 4 },
      { id: "scaleMin", label: "Scale Min", kind: "float", min: 0.2, max: 2, step: 0.05, default: 0.6 },
      { id: "scaleMax", label: "Scale Max", kind: "float", min: 0.2, max: 2, step: 0.05, default: 1.1 },
      { id: "rotJitter", label: "Rot Jitter", kind: "float", min: 0, max: 360, step: 5, default: 180 },
      { id: "snap90", label: "90° Pixel Snap", kind: "bool", default: false },
      { id: "seed", label: "Seed", kind: "seed", default: 505 },
    ],
    fragmentShader: SPLATTER_FS,
    getUniforms: (p) => ({
      u_grid: Number(p.grid ?? 4),
      u_scaleMin: Number(p.scaleMin ?? 0.6),
      u_scaleMax: Number(p.scaleMax ?? 1.1),
      u_rotJitter: Number(p.rotJitter ?? 180),
      u_snap90: Boolean(p.snap90),
    }),
  },
  {
    type: "gen.autotileMask",
    label: "Auto-Tile Mask",
    category: "generators",
    description: "Generates 4-bit (16-tile) or 8-bit blob (47-tile) terrain masks.",
    inputs: [],
    outputs: [{ id: "mask", label: "Mask", type: "gray" }],
    params: [
      { id: "bitmask", label: "Bitmask (0..15)", kind: "int", min: 0, max: 15, step: 1, default: 15 },
      { id: "borderWidth", label: "Border Width", kind: "float", min: 0.05, max: 0.45, step: 0.01, default: 0.2 },
      { id: "roundness", label: "Roundness", kind: "float", min: 0, max: 1, step: 0.05, default: 0.4 },
      { id: "edgeNoise", label: "Edge Noise", kind: "float", min: 0, max: 1, step: 0.02, default: 0.25 },
      { id: "seed", label: "Seed", kind: "seed", default: 606 },
    ],
    defaultWrap: "clamp",
    fragmentShader: AUTOTILE_MASK_FS,
    getUniforms: (p) => ({
      u_bitmask: Number(p.bitmask ?? 15),
      u_borderWidth: Number(p.borderWidth ?? 0.2),
      u_roundness: Number(p.roundness ?? 0.4),
      u_edgeNoise: Number(p.edgeNoise ?? 0.25),
    }),
  },
];
