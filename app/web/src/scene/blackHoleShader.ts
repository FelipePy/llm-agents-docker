// Buraco negro de Schwarzschild (raio 1) com disco de acrecao no plano y = 0.
// Cada pixel lanca um raio da camera e integra a curvatura da luz
// (aceleracao -1.5 h^2 r / |r|^5); onde o raio cruza o disco, soma a cor dele;
// se cai no horizonte, fica preto; se escapa, mostra o ceu.

export const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.999, 1.0);
}
`;

export const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uCamPos;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform float uSteps;
uniform float uDiskInner;
uniform float uDiskOuter;
varying vec2 vUv;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

vec3 sky(vec3 d) {
  vec3 p = d * 220.0;
  vec3 c = floor(p);
  float h = hash(c);
  float star = step(0.992, h) * smoothstep(0.45, 0.0, length(fract(p) - 0.5));
  vec3 tint = mix(vec3(0.65, 0.75, 1.0), vec3(1.0, 0.85, 0.7), hash(c + 7.1));
  float neb = fbm(d * 2.5 + 4.0);
  vec3 nebula = mix(vec3(0.02, 0.01, 0.06), vec3(0.10, 0.04, 0.16), neb) * smoothstep(0.3, 0.9, neb);
  return tint * star * 1.6 + nebula;
}

vec4 disk(vec3 p, vec3 dir) {
  float r = length(p.xz);
  float t = clamp((r - uDiskInner) / (uDiskOuter - uDiskInner), 0.0, 1.0);
  // Rotacao diferencial: o interior gira mais rapido (Kepler).
  float spin = uTime * 1.6 / pow(r, 1.5);
  float c = cos(spin);
  float s = sin(spin);
  vec2 q = mat2(c, -s, s, c) * p.xz;
  float bands = fbm(vec3(q * 1.8, uTime * 0.05));
  float streaks = fbm(vec3(r * 6.0, q * 0.4));
  float density = (0.55 + 0.9 * bands * streaks) * smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.65, 1.0, t));
  vec3 hot = vec3(1.0, 0.93, 0.82);
  vec3 warm = vec3(1.0, 0.55, 0.18);
  vec3 cool = vec3(0.55, 0.12, 0.05);
  vec3 col = t < 0.35 ? mix(hot, warm, t / 0.35) : mix(warm, cool, (t - 0.35) / 0.65);
  // Efeito Doppler: o lado que vem na direcao da camera brilha mais.
  vec3 tangent = normalize(vec3(-p.z, 0.0, p.x));
  float doppler = 1.0 + 0.75 * dot(tangent, -dir);
  float intensity = density * pow(1.0 - t, 1.2) * 2.6 * doppler * doppler;
  return vec4(col * intensity, clamp(density * 0.95, 0.0, 1.0));
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 view = uInvProj * vec4(ndc, 1.0, 1.0);
  view /= view.w;
  vec3 pos = uCamPos;
  vec3 vel = normalize((uCamWorld * vec4(view.xyz, 0.0)).xyz);
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);
  vec3 col = vec3(0.0);
  float trans = 1.0;
  bool captured = false;

  for (int i = 0; i < 400; i++) {
    if (float(i) >= uSteps) break;
    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    float dt = clamp(0.06 * r, 0.015, 2.0);
    vec3 prev = pos;
    vel += -1.5 * h2 * pos / (r2 * r2 * r) * dt;
    pos += vel * dt;
    if (prev.y * pos.y < 0.0) {
      vec3 cp = mix(prev, pos, prev.y / (prev.y - pos.y));
      float cr = length(cp.xz);
      if (cr > uDiskInner && cr < uDiskOuter) {
        vec4 d = disk(cp, normalize(vel));
        col += trans * d.rgb * d.a;
        trans *= 1.0 - d.a;
      }
    }
    if (r2 < 1.0) { captured = true; break; }
    if (r2 > 4000.0 && dot(pos, vel) > 0.0) break;
    if (trans < 0.02) break;
  }

  if (!captured) col += trans * sky(normalize(vel));
  col = 1.0 - exp(-col * 1.1);
  gl_FragColor = vec4(col, 1.0);
}
`;
