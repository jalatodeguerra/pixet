export const NOISE_GLSL = `
vec2 mod289_2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }

vec2 periodicGrad(vec2 cell, vec2 period, int seed) {
  vec2 wrapped = mod(mod(cell, period) + period, period);
  float a = hash21(wrapped, seed) * 6.28318530718;
  return vec2(cos(a), sin(a));
}

float periodicPerlin(vec2 uv, vec2 period, int seed) {
  vec2 p = uv * period;
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  float a = dot(periodicGrad(i + vec2(0.0, 0.0), period, seed), f - vec2(0.0, 0.0));
  float b = dot(periodicGrad(i + vec2(1.0, 0.0), period, seed), f - vec2(1.0, 0.0));
  float c = dot(periodicGrad(i + vec2(0.0, 1.0), period, seed), f - vec2(0.0, 1.0));
  float d = dot(periodicGrad(i + vec2(1.0, 1.0), period, seed), f - vec2(1.0, 1.0));

  float v = mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  return clamp(v * 0.7 + 0.5, 0.0, 1.0);
}

float periodicValueNoise(vec2 uv, vec2 period, int seed) {
  vec2 p = uv * period;
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);

  float a = hash21(mod(mod(i + vec2(0.0, 0.0), period) + period, period), seed);
  float b = hash21(mod(mod(i + vec2(1.0, 0.0), period) + period, period), seed);
  float c = hash21(mod(mod(i + vec2(0.0, 1.0), period) + period, period), seed);
  float d = hash21(mod(mod(i + vec2(1.0, 1.0), period) + period, period), seed);

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float periodicFbm(vec2 uv, vec2 basePeriod, int octaves, float persistence, float lacunarity, int mode, int seed) {
  float sum = 0.0;
  float amp = 0.5;
  float norm = 0.0;
  vec2 period = max(vec2(1.0), floor(basePeriod + 0.5));
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = (mode == 1)
      ? periodicValueNoise(uv, period, seed + i * 131)
      : periodicPerlin(uv, period, seed + i * 131);
    if (mode == 2) {
      // Ridged
      n = 1.0 - abs(n * 2.0 - 1.0);
      n = n * n;
    } else if (mode == 3) {
      // Turbulence
      n = abs(n * 2.0 - 1.0);
    }
    sum += n * amp;
    norm += amp;
    amp *= persistence;
    period = max(vec2(1.0), floor(period * lacunarity + 0.5));
  }
  return norm > 0.0 ? clamp(sum / norm, 0.0, 1.0) : 0.0;
}

vec4 periodicVoronoi(vec2 uv, vec2 period, float jitter, int metric, int seed) {
  vec2 p = uv * period;
  vec2 n = floor(p);
  vec2 f = fract(p);

  float d1 = 1e6;
  float d2 = 1e6;
  float cellId = 0.0;
  vec2 bestCenter = vec2(0.0);

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 wrapped = mod(mod(n + g, period) + period, period);
      vec2 rnd = hash22(wrapped, seed);
      vec2 o = 0.5 + (rnd - 0.5) * jitter;
      vec2 r = g + o - f;

      float d;
      if (metric == 1) {
        d = abs(r.x) + abs(r.y); // Manhattan
      } else if (metric == 2) {
        d = max(abs(r.x), abs(r.y)); // Chebyshev
      } else {
        d = length(r); // Euclidean
      }

      if (d < d1) {
        d2 = d1;
        d1 = d;
        cellId = rnd.x;
        bestCenter = fract((n + g + o) / period);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec4(clamp(d1, 0.0, 1.0), clamp(d2 - d1, 0.0, 1.0), cellId, bestCenter.x);
}
`;
