import { COMMON_UNIFORMS_GLSL, SCALAR_PACK_GLSL } from "./common.glsl.ts";

export const HEIGHT_TO_NORMAL_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}

uniform sampler2D u_height;
uniform float u_strength;
uniform float u_kernel; // 0=Sobel, 1=Scharr

void main() {
  vec2 ts = u_texelSize;
  float tl = sampleScalar(u_height, v_uv + vec2(-ts.x,  ts.y));
  float t  = sampleScalar(u_height, v_uv + vec2(  0.0,  ts.y));
  float tr = sampleScalar(u_height, v_uv + vec2( ts.x,  ts.y));
  float l  = sampleScalar(u_height, v_uv + vec2(-ts.x,   0.0));
  float r  = sampleScalar(u_height, v_uv + vec2( ts.x,   0.0));
  float bl = sampleScalar(u_height, v_uv + vec2(-ts.x, -ts.y));
  float b  = sampleScalar(u_height, v_uv + vec2(  0.0, -ts.y));
  float br = sampleScalar(u_height, v_uv + vec2( ts.x, -ts.y));

  float dx;
  float dy;
  if (u_kernel > 0.5) {
    dx = (3.0 * tr + 10.0 * r + 3.0 * br) - (3.0 * tl + 10.0 * l + 3.0 * bl);
    dy = (3.0 * tl + 10.0 * t + 3.0 * tr) - (3.0 * bl + 10.0 * b + 3.0 * br);
    dx /= 16.0;
    dy /= 16.0;
  } else {
    dx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
    dy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
    dx /= 4.0;
    dy /= 4.0;
  }

  // OpenGL +Y tangent-space normal
  vec3 n = normalize(vec3(-dx * u_strength, -dy * u_strength, 1.0));
  outColor = vec4(n * 0.5 + 0.5, 1.0);
}
`;

export const NORMAL_BLEND_RNM_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}

uniform sampler2D u_base;
uniform sampler2D u_detail;
uniform sampler2D u_mask;
uniform float u_strength;

void main() {
  vec3 n1 = normalize(texture(u_base, v_uv).xyz * 2.0 - 1.0);
  vec3 n2Raw = normalize(texture(u_detail, v_uv).xyz * 2.0 - 1.0);
  float m = sampleScalar(u_mask, v_uv) * u_strength;
  vec3 n2 = normalize(mix(vec3(0.0, 0.0, 1.0), n2Raw, clamp(m, 0.0, 1.0)));

  // Reoriented Normal Mapping (RNM)
  vec3 t = n1 + vec3(0.0, 0.0, 1.0);
  vec3 u = n2 * vec3(-1.0, -1.0, 1.0);
  vec3 r = normalize(t * dot(t, u) - u * t.z);
  outColor = vec4(r * 0.5 + 0.5, 1.0);
}
`;

export const HEIGHT_TO_AO_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}

uniform sampler2D u_height;
uniform float u_radius;
uniform float u_intensity;
uniform float u_bias;

void main() {
  float h0 = sampleScalar(u_height, v_uv);
  float occ = 0.0;
  const float TWO_PI = 6.28318530718;
  for (int i = 0; i < 8; i++) {
    float ang = float(i) * (TWO_PI / 8.0);
    vec2 dir = vec2(cos(ang), sin(ang)) * u_texelSize;
    float maxSlope = 0.0;
    for (int s = 1; s <= 4; s++) {
      float frac = float(s) / 4.0;
      float hs = sampleScalar(u_height, v_uv + dir * (u_radius * frac));
      float diff = (hs - h0) - u_bias;
      maxSlope = max(maxSlope, diff / max(frac, 0.1));
    }
    occ += clamp(maxSlope * u_intensity, 0.0, 1.0);
  }
  float ao = clamp(1.0 - occ / 8.0, 0.0, 1.0);
  outColor = encodeScalar(ao);
}
`;

export const CURVATURE_FS = `#version 300 es
${COMMON_UNIFORMS_GLSL}
${SCALAR_PACK_GLSL}

uniform sampler2D u_height;
uniform float u_radius;
uniform float u_contrast;
uniform float u_mode; // 0=Both, 1=Convex, 2=Concave

void main() {
  vec2 d = u_texelSize * max(1.0, u_radius);
  float c = sampleScalar(u_height, v_uv);
  float l = sampleScalar(u_height, v_uv - vec2(d.x, 0.0));
  float r = sampleScalar(u_height, v_uv + vec2(d.x, 0.0));
  float t = sampleScalar(u_height, v_uv + vec2(0.0, d.y));
  float b = sampleScalar(u_height, v_uv - vec2(0.0, d.y));
  float lap = (c * 4.0 - (l + r + t + b)) * u_contrast;
  float val;
  if (u_mode < 0.5) {
    val = clamp(0.5 + lap * 0.5, 0.0, 1.0);
  } else if (u_mode < 1.5) {
    val = clamp(lap, 0.0, 1.0);
  } else {
    val = clamp(-lap, 0.0, 1.0);
  }
  outColor = encodeScalar(val);
}
`;

export const PBR_PREVIEW_3D_VS = `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_mvp;
uniform mat4 u_model;

out vec3 v_worldPos;
out vec3 v_normal;
out vec2 v_uv;

void main() {
  vec4 wp = u_model * vec4(a_pos, 1.0);
  v_worldPos = wp.xyz;
  v_normal = normalize(mat3(u_model) * a_normal);
  v_uv = a_uv;
  gl_Position = u_mvp * vec4(a_pos, 1.0);
}
`;

export const PBR_PREVIEW_3D_FS = `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_normal;
in vec2 v_uv;

out vec4 outColor;

uniform sampler2D u_albedo;
uniform sampler2D u_normalMap;
uniform sampler2D u_roughness;
uniform sampler2D u_metallic;
uniform sampler2D u_ao;
uniform sampler2D u_emissive;

uniform vec3 u_camPos;
uniform vec3 u_lightDir;

const float PI = 3.14159265359;

float distributionGGX(vec3 N, vec3 H, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float NdotH = max(dot(N, H), 0.0);
  float denom = (NdotH * NdotH * (a2 - 1.0) + 1.0);
  return a2 / max(PI * denom * denom, 0.0001);
}

float geometrySchlickGGX(float NdotV, float roughness) {
  float r = roughness + 1.0;
  float k = (r * r) / 8.0;
  return NdotV / max(NdotV * (1.0 - k) + k, 0.0001);
}

float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
  return geometrySchlickGGX(max(dot(N, V), 0.0), roughness) *
         geometrySchlickGGX(max(dot(N, L), 0.0), roughness);
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

void main() {
  vec4 albedoSamp = texture(u_albedo, v_uv);
  if (albedoSamp.a < 0.05) discard;
  vec3 albedo = pow(albedoSamp.rgb, vec3(2.2));
  float roughness = clamp(texture(u_roughness, v_uv).r, 0.06, 1.0);
  float metallic = clamp(texture(u_metallic, v_uv).r, 0.0, 1.0);
  float ao = clamp(texture(u_ao, v_uv).r, 0.0, 1.0);
  vec3 emissive = pow(texture(u_emissive, v_uv).rgb, vec3(2.2));

  vec3 geomN = normalize(v_normal);
  vec3 up = abs(geomN.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(up, geomN));
  vec3 B = cross(geomN, T);
  vec3 mapN = texture(u_normalMap, v_uv).xyz * 2.0 - 1.0;
  vec3 N = normalize(T * mapN.x + B * mapN.y + geomN * max(0.01, mapN.z));

  vec3 V = normalize(u_camPos - v_worldPos);
  vec3 L = normalize(u_lightDir);
  vec3 H = normalize(V + L);

  vec3 F0 = mix(vec3(0.04), albedo, metallic);
  float NDF = distributionGGX(N, H, roughness);
  float G = geometrySmith(N, V, L, roughness);
  vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);

  vec3 spec = (NDF * G * F) / max(4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0), 0.001);
  vec3 kD = (vec3(1.0) - F) * (1.0 - metallic);
  float NdotL = max(dot(N, L), 0.0);

  vec3 keyLight = (kD * albedo / PI + spec) * vec3(2.4) * NdotL;
  vec3 hemi = mix(vec3(0.12, 0.13, 0.16), vec3(0.38, 0.42, 0.48), N.y * 0.5 + 0.5);
  vec3 ambient = hemi * albedo * ao;
  vec3 color = ambient + keyLight + emissive;

  color = color / (color + vec3(1.0));
  color = pow(color, vec3(1.0 / 2.2));
  outColor = vec4(color, 1.0);
}
`;
