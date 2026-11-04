// Fragmentos do globo: um quadrado por instancia, curvado ao longo da latitude
// da sua faixa, inclinado com a faixa e animado na GPU (um unico desenho).

export const globeVertexShader = /* glsl */ `
attribute vec4 aBand;   // angulo inicial, latitude, raio, velocidade
attribute vec4 aShape;  // comprimento, largura, semente, tipo
attribute vec2 aTilt;   // inclinacao da faixa (X, Z)

uniform float uTime;
uniform float uSpinTime;
uniform float uExpand;
uniform float uAgitation;
uniform float uGrow;

varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying float vFlicker;

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

void main() {
  float seed = aShape.z;
  float kind = aShape.w;
  float panel = kind > 0.5 && kind < 1.5 ? 1.0 : 0.0;
  float isDot = kind > 2.5 ? 1.0 : 0.0;

  // Tremor proprio de cada fragmento; com a voz ele tambem se afasta do centro.
  float wob = sin(uTime * (3.0 + seed * 9.0) + seed * 40.0);
  float r = aBand.z * uExpand + uAgitation * (0.35 * wob + 0.9 * seed);
  float phi = aBand.y + uAgitation * 0.02 * sin(uTime * 4.0 + seed * 25.0);
  float len = aShape.x * mix(uGrow, 1.0 + 0.4 * (uGrow - 1.0), max(panel, isDot));
  float width = aShape.y * (1.0 + 0.5 * (uGrow - 1.0));

  // Curva ao longo da latitude (os arcos ficam redondos).
  float theta = aBand.x + uSpinTime * aBand.w + (1.0 - isDot) * position.x * len / (r * max(cos(phi), 0.25));
  vec3 p = r * vec3(cos(phi) * cos(theta), sin(phi), cos(phi) * sin(theta));
  vec3 north = vec3(-sin(phi) * cos(theta), cos(phi), -sin(phi) * sin(theta));
  p += (1.0 - isDot) * north * position.y * width;
  p = rotZ(aTilt.y) * rotX(aTilt.x) * p;
  vec4 viewPos = modelViewMatrix * vec4(p, 1.0);
  // O ponto nao curva: fica de frente para a camera.
  viewPos.xy += isDot * position.xy * len;

  vUv = uv;
  vKind = kind;
  vSeed = seed;
  vFlicker = 0.7 + 0.3 * sin(uTime * (1.5 + seed * 5.0) + seed * 30.0);
  gl_Position = projectionMatrix * viewPos;
}
`;

export const globeFragmentShader = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uHot;
uniform float uGlow;

varying vec2 vUv;
varying float vKind;
varying float vSeed;
varying float vFlicker;

void main() {
  float a;
  if (vKind > 2.5) {
    // Ponto: redondo, com o centro mais forte.
    float d = 1.0 - length(vUv - 0.5) * 2.0;
    a = smoothstep(0.0, 0.75, d);
  } else if (vKind > 0.5 && vKind < 1.5) {
    // Painel: moldura e uma grade fina, como uma tela holografica.
    vec2 e = min(vUv, 1.0 - vUv);
    float frame = 1.0 - step(0.07, min(e.x, e.y));
    vec2 g = abs(fract(vUv * vec2(5.0, 3.0)) - 0.5);
    float grid = step(0.44, max(g.x, g.y));
    a = max(frame * 0.9, grid * 0.35) + 0.05;
  } else {
    // Traco ou arco: borda suave e pontas que se apagam. O clamp evita valor negativo:
    // em tracos finos o antialiasing extrapola o vUv, e a cor negativa escurece o fundo.
    float across = clamp(1.0 - abs(vUv.y - 0.5) * 2.0, 0.0, 1.0);
    float along = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
    a = across * along;
  }
  vec3 col = mix(uBase, uHot, clamp(vSeed * 0.45 + (uGlow - 0.7) * 0.7, 0.0, 1.0));
  gl_FragColor = vec4(col * a * uGlow * vFlicker, 1.0);
}
`;
