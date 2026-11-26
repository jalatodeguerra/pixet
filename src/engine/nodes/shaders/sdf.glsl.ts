export const SDF_GLSL = `
float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float sdRegularPolygon(vec2 p, float r, int n) {
  float an = 3.14159265359 / float(max(3, n));
  float he = r * cos(an);
  float a = mod(atan(p.y, p.x) + an, 2.0 * an) - an;
  vec2 q = length(p) * vec2(cos(a), abs(sin(a)));
  q.x -= he;
  q.y -= clamp(q.y, -r * sin(an), r * sin(an));
  return length(q) * sign(q.x);
}

float sdStar(vec2 p, float r, int n, float m) {
  float an = 3.14159265359 / float(max(3, n));
  float en = 3.14159265359 / m;
  vec2 acs = vec2(cos(an), sin(an));
  vec2 ecs = vec2(cos(en), sin(en));
  float bn = mod(atan(p.x, p.y), 2.0 * an) - an;
  p = length(p) * vec2(cos(bn), abs(sin(bn)));
  p -= r * acs;
  p += ecs * clamp(-dot(p, ecs), 0.0, r * acs.y / ecs.y);
  return length(p) * sign(p.x);
}

float sdCross(vec2 p, vec2 b, float r) {
  p = abs(p);
  p = (p.y > p.x) ? p.yx : p.xy;
  vec2 q = p - b;
  float k = max(q.y, q.x);
  vec2 w = (k > 0.0) ? q : vec2(b.y - p.x, -k);
  return sign(k) * length(max(w, 0.0)) + r;
}

float sdRing(vec2 p, float r, float thickness) {
  return abs(length(p) - r) - thickness;
}

vec2 rotate2D(vec2 p, float angleRad) {
  float c = cos(angleRad);
  float s = sin(angleRad);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
`;
