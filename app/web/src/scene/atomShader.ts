// Nucleo: esfera deformada por ruido (mais forte quando o agente fala),
// com brilho de borda. Halo: esfera externa, faces de tras, aditiva.

const noise = /* glsl */ `
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
`;

export const coreVertex = /* glsl */ `
uniform float uTime;
uniform float uLevel;
varying vec3 vNormal;
varying vec3 vView;
varying float vDisp;
${noise}
void main() {
  float n = noise(position * 1.6 + vec3(0.0, uTime * 0.5, uTime * 0.2)) * 0.65
          + noise(position * 4.2 - vec3(uTime * 0.9)) * 0.35;
  float disp = (n - 0.5) * (0.10 + 0.70 * uLevel);
  vDisp = disp;
  vec4 mv = modelViewMatrix * vec4(position + normal * disp, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const coreFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uLevel;
varying vec3 vNormal;
varying vec3 vView;
varying float vDisp;
void main() {
  float fres = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.0);
  vec3 col = mix(uHot, uColor, 0.35 + 0.65 * fres);
  col *= 0.55 + 1.4 * fres + 0.9 * uLevel + vDisp * 3.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const haloVertex = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const haloFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float i = pow(max(0.0, -dot(normalize(vNormal), normalize(vView))), 3.0);
  gl_FragColor = vec4(uColor * i * (0.9 + 1.5 * uLevel), i);
}
`;
