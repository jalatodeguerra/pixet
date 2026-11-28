export const FULLSCREEN_TRIANGLE_VS = `#version 300 es
precision highp float;

out vec2 v_uv;

void main() {
  float x = -1.0 + float((gl_VertexID & 1) << 2);
  float y = -1.0 + float((gl_VertexID & 2) << 1);
  v_uv = vec2(x, y) * 0.5 + 0.5;
  gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

export const COMMON_UNIFORMS_GLSL = `
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 outColor;

uniform vec2 u_resolution;
uniform vec2 u_texelSize;
uniform int u_seed;
uniform float u_time;
uniform float u_frame;
uniform float u_progress;
`;

export const SCALAR_PACK_GLSL = `
vec2 packU16(float v) {
  float c = clamp(v, 0.0, 1.0) * 65535.0;
  float hi = floor(c / 256.0);
  return vec2(hi / 255.0, (c - hi * 256.0) / 255.0);
}

float unpackU16(vec2 rg) {
  return (rg.r * 255.0 * 256.0 + rg.g * 255.0) / 65535.0;
}

vec4 encodeScalar(float v) {
#ifdef PIXET_RG8_SCALAR
  return vec4(packU16(v), 0.0, 1.0);
#else
  return vec4(v, 0.0, 0.0, 1.0);
#endif
}

float sampleScalar(sampler2D tex, vec2 uv) {
#ifdef PIXET_RG8_SCALAR
  return unpackU16(texture(tex, uv).rg);
#else
  return texture(tex, uv).r;
#endif
}

float sampleScalarLinear(sampler2D tex, vec2 uv, vec2 texSize) {
#ifdef PIXET_RG8_SCALAR
  vec2 st = uv * texSize - 0.5;
  vec2 f = fract(st);
  vec2 i = floor(st) + 0.5;
  vec2 inv = 1.0 / texSize;
  float a = unpackU16(texture(tex, i * inv).rg);
  float b = unpackU16(texture(tex, (i + vec2(1.0, 0.0)) * inv).rg);
  float c = unpackU16(texture(tex, (i + vec2(0.0, 1.0)) * inv).rg);
  float d = unpackU16(texture(tex, (i + vec2(1.0, 1.0)) * inv).rg);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
#else
  return texture(tex, uv).r;
#endif
}
`;

export const HASH_AND_MATH_GLSL = `
uint hashU32(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

float hash21(vec2 p, int seed) {
  uvec2 u = uvec2(ivec2(floor(p))) + uvec2(uint(seed) * 747796405u, uint(seed) * 2891336453u);
  uint h = hashU32(u.x ^ hashU32(u.y));
  return float(h & 0x00ffffffu) / 16777215.0;
}

vec2 hash22(vec2 p, int seed) {
  float x = hash21(p, seed);
  float y = hash21(p + vec2(37.0, 91.0), seed ^ 0x517cc1b7);
  return vec2(x, y);
}

float luminance709(vec3 rgb) {
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}
`;

export const OKLAB_GLSL = `
vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow(max((c + 0.055) / 1.055, vec3(0.0)), vec3(2.4));
  return mix(hi, lo, lessThanEqual(c, vec3(0.04045)));
}

vec3 linearToSrgb(vec3 c) {
  vec3 clamped = clamp(c, 0.0, 1.0);
  vec3 lo = clamped * 12.92;
  vec3 hi = 1.055 * pow(clamped, vec3(1.0 / 2.4)) - 0.055;
  return mix(hi, lo, lessThanEqual(clamped, vec3(0.0031308)));
}

vec3 srgbToOklab(vec3 srgb) {
  vec3 c = srgbToLinear(srgb);
  float l = pow(max(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b, 0.0), 1.0 / 3.0);
  float m = pow(max(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b, 0.0), 1.0 / 3.0);
  float s = pow(max(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b, 0.0), 1.0 / 3.0);
  return vec3(
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
  );
}

float bayer4x4(vec2 fragCoord) {
  ivec2 p = ivec2(mod(fragCoord, 4.0));
  int idx = p.y * 4 + p.x;
  const float m[16] = float[16](
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0
  );
  return (m[idx] + 0.5) / 16.0 - 0.5;
}
`;

export const COERCE_BLIT_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}
${HASH_AND_MATH_GLSL}

uniform sampler2D u_src;
// Set through uniform1f like every other custom uniform, so it must be a float here.
uniform float u_mode; // 0=rgba, 1=gray->rgba, 2=rgba->gray, 3=channelR, 4=channelG, 5=channelB, 6=channelA, 7=tile3x3

void main() {
  int mode = int(u_mode + 0.5);
  vec2 uv = mode == 7 ? fract(v_uv * 3.0) : v_uv;
  vec4 c = texture(u_src, uv);
  if (mode == 0 || mode == 7) {
    outColor = c;
  } else if (mode == 1) {
    float g = sampleScalar(u_src, uv);
    outColor = vec4(g, g, g, 1.0);
  } else if (mode == 2) {
    float lum = luminance709(c.rgb) * c.a;
    outColor = encodeScalar(lum);
  } else if (mode == 3) {
    outColor = vec4(c.r, c.r, c.r, 1.0);
  } else if (mode == 4) {
    outColor = vec4(c.g, c.g, c.g, 1.0);
  } else if (mode == 5) {
    outColor = vec4(c.b, c.b, c.b, 1.0);
  } else {
    outColor = vec4(c.a, c.a, c.a, 1.0);
  }
}
`;

/** Implicit conversion on a link between different socket types (see linkConversion). */
export const LINK_CONVERT_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}
${HASH_AND_MATH_GLSL}

uniform sampler2D u_src;
uniform float u_mode; // 1=broadcast gray->rgba, 2=luminance rgba->gray, 3=fill scalar, 4=fill color
uniform float u_value;

void main() {
  int mode = int(u_mode + 0.5);
  if (mode == 3) {
    outColor = encodeScalar(clamp(u_value, 0.0, 1.0));
  } else if (mode == 4) {
    outColor = vec4(vec3(u_value), 1.0);
  } else if (mode == 1) {
    float g = sampleScalar(u_src, v_uv);
    outColor = vec4(g, g, g, 1.0);
  } else {
    vec4 c = texture(u_src, v_uv);
    outColor = encodeScalar(luminance709(c.rgb) * c.a);
  }
}
`;
