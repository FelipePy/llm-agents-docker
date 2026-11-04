// Globo holografico do Jarvis: fragmentos (tracos, paineis e arcos) em cascas
// esfericas, agrupados em faixas inclinadas que giram em sentidos diferentes.
// Aqui ficam so os dados e a dinamica (testaveis); o desenho e o shader.

export const GLOBE_RADIUS = 7;

export const GLOBE_COLORS = {
  dourado: { label: 'Dourado', base: '#ffa733', hot: '#fff0c2' },
  ciano: { label: 'Ciano', base: '#33cfff', hot: '#e3fbff' },
  branco: { label: 'Branco', base: '#c9d4e6', hot: '#ffffff' },
} as const;
export type GlobeColor = keyof typeof GLOBE_COLORS;

export const isGlobeColor = (v: unknown): v is GlobeColor => typeof v === 'string' && v in GLOBE_COLORS;

/** Gerador pseudoaleatorio pequeno e deterministico (o globo e sempre o mesmo). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tipos de fragmento (shape[3]). */
export const SEGMENT = 0;
export const PANEL = 1;
export const ARC = 2;
/** Ponto redondo, sempre de frente para a camera. */
export const DOT = 3;

/**
 * Atributos por instancia, prontos para o InstancedBufferGeometry:
 * - band  (4): angulo inicial, latitude, raio, velocidade (rad/s; o sinal e o sentido)
 * - shape (4): comprimento, largura, semente (0..1), tipo
 * - tilt  (2): inclinacao da faixa em X e em Z
 */
export interface GlobeFragments {
  count: number;
  band: Float32Array;
  shape: Float32Array;
  tilt: Float32Array;
}

const BANDS = 30;
const SHELLS = [0.42, 0.7, 0.88, 1.0];

export function globeFragments(count: number, seed = 1): GlobeFragments {
  const rnd = mulberry32(seed);
  const range = (a: number, b: number) => a + (b - a) * rnd();
  const bands = Array.from({ length: BANDS }, (_, i) => ({
    tiltX: range(-0.7, 0.7),
    tiltZ: range(-0.7, 0.7),
    // Faixas alternam o sentido; as internas giram mais rapido.
    speed: (i % 2 ? -1 : 1) * range(0.04, 0.3),
    shell: SHELLS[i % SHELLS.length] * GLOBE_RADIUS,
    lat: range(-1.15, 1.15),
    spread: range(0.06, 0.28),
  }));
  const band = new Float32Array(count * 4);
  const shape = new Float32Array(count * 4);
  const tilt = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const b = bands[Math.floor(rnd() * BANDS)];
    const k = rnd();
    const kind = k < 0.1 ? PANEL : k < 0.26 ? ARC : SEGMENT;
    const inner = b.shell < GLOBE_RADIUS * 0.5;
    const lat = kind === ARC ? range(-0.05, 0.05) : b.lat + range(-b.spread, b.spread);
    band.set(
      [
        range(0, Math.PI * 2),
        Math.max(-Math.PI / 2, Math.min(Math.PI / 2, lat)),
        b.shell * range(0.96, 1.04) * (kind === ARC ? range(1.02, 1.1) : 1),
        b.speed * (inner ? 1.8 : 1),
      ],
      i * 4,
    );
    const [length, width] =
      kind === PANEL ? [range(0.35, 0.9), range(0.25, 0.6)] : kind === ARC ? [range(0.8, 2.4), range(0.025, 0.05)] : [range(0.12, 0.65), range(0.025, 0.07)];
    shape.set([length, width, rnd(), kind], i * 4);
    tilt.set([b.tiltX, b.tiltZ], i * 2);
  }
  return { count, band, shape, tilt };
}

/** Nuvem de pontos em duas cascas, distribuidos por igual (espiral de Fibonacci). */
export function particleFragments(count: number, seed = 1): GlobeFragments {
  const rnd = mulberry32(seed);
  const range = (a: number, b: number) => a + (b - a) * rnd();
  const band = new Float32Array(count * 4);
  const shape = new Float32Array(count * 4);
  const tilt = new Float32Array(count * 2);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const outer = i % 3 !== 0;
    const lat = Math.asin(1 - (2 * (i + 0.5)) / count);
    band.set([(i * goldenAngle) % (Math.PI * 2), lat, GLOBE_RADIUS * (outer ? 1 : 0.68) * range(0.985, 1.015), outer ? 0.09 : -0.14], i * 4);
    const size = range(0.06, 0.17);
    shape.set([size, size, rnd(), DOT], i * 4);
    tilt.set([0.25, -0.15], i * 2);
  }
  return { count, band, shape, tilt };
}

/** Planos orbitais: inclinacao em X e em Z e raio relativo. */
const ORBITS: { tilt: [number, number]; shell: number }[] = [
  { tilt: [0.15, 0.1], shell: 0.42 },
  { tilt: [1.1, -0.35], shell: 0.56 },
  { tilt: [-0.95, 0.5], shell: 0.68 },
  { tilt: [0.5, 1.15], shell: 0.8 },
  { tilt: [-0.45, -1.05], shell: 0.9 },
  { tilt: [1.4, 0.75], shell: 1.0 },
];

/** Arcos longos e contas correndo em poucos planos, como um atomo. */
export function orbitFragments(count: number, seed = 1): GlobeFragments {
  const rnd = mulberry32(seed);
  const range = (a: number, b: number) => a + (b - a) * rnd();
  const band = new Float32Array(count * 4);
  const shape = new Float32Array(count * 4);
  const tilt = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const index = i % ORBITS.length;
    const orbit = ORBITS[index];
    const radius = orbit.shell * GLOBE_RADIUS;
    const arc = rnd() < 0.35;
    // Orbitas vizinhas giram em sentidos opostos; as internas, mais rapido.
    const speed = (index % 2 ? -1 : 1) * (0.5 - 0.3 * orbit.shell);
    band.set([range(0, Math.PI * 2), 0, radius * range(0.995, 1.005), speed], i * 4);
    const size = range(0.09, 0.24);
    // No shader, comprimento / raio e o angulo do arco: ate 1,3 rad em qualquer orbita.
    shape.set(arc ? [radius * range(0.3, 1.3), range(0.03, 0.06), rnd(), ARC] : [size, size, rnd(), DOT], i * 4);
    tilt.set(orbit.tilt, i * 2);
  }
  return { count, band, shape, tilt };
}

export interface GlobeRing {
  radius: number;
  /** Inclinacao do anel em X e em Y. */
  tilt: [number, number];
  speed: number;
}

export interface GlobeStyleDef {
  label: string;
  /** Fragmentos com o detalhe no maximo. */
  fragments: number;
  build: (count: number, seed?: number) => GlobeFragments;
  /** Divisoes de cada fragmento: arcos longos precisam de mais para ficarem redondos. */
  segments: number;
  rings: readonly GlobeRing[];
  coreRadius: number;
}

/** Um estilo novo so precisa de uma entrada aqui: as configuracoes listam o que houver. */
export const GLOBE_STYLES = {
  holografico: {
    label: 'Holográfico',
    fragments: 3600,
    build: globeFragments,
    segments: 1,
    rings: [
      { radius: 1.5, tilt: [0.4, 0.2], speed: 0.9 },
      { radius: 2.1, tilt: [-0.9, 0.5], speed: -0.6 },
      { radius: 2.8, tilt: [1.3, -0.3], speed: 0.4 },
    ],
    coreRadius: 0.55,
  },
  particulas: { label: 'Partículas', fragments: 3000, build: particleFragments, segments: 1, rings: [], coreRadius: 0.4 },
  orbitas: { label: 'Órbitas', fragments: 1200, build: orbitFragments, segments: 16, rings: [], coreRadius: 0.95 },
} as const satisfies Record<string, GlobeStyleDef>;
export type GlobeStyle = keyof typeof GLOBE_STYLES;

export const isGlobeStyle = (v: unknown): v is GlobeStyle => typeof v === 'string' && Object.hasOwn(GLOBE_STYLES, v);

export interface GlobeDynamics {
  /** Escala das cascas (1 = repouso). */
  expand: number;
  /** Tremor e afastamento dos fragmentos. */
  agitation: number;
  /** Quanto os fragmentos crescem. */
  grow: number;
  /** Brilho. */
  glow: number;
  /** Multiplicador da rotacao das faixas. */
  spin: number;
}

/**
 * Do "calor" (estado da voz, 0..1, ja suavizado) e do volume da fala (0..1)
 * para a aparencia do globo. Parado ele so deriva; falando alto ele cresce,
 * treme e brilha, acompanhando cada silaba.
 */
export function globeDynamics(heat: number, level: number): GlobeDynamics {
  const h = Math.min(1, Math.max(0, heat));
  const l = Math.min(1, Math.max(0, level));
  return {
    expand: 1 + 0.28 * l + 0.05 * Math.max(0, h - 0.05),
    agitation: 0.02 + 0.1 * h + 0.9 * l,
    grow: 1 + 1.6 * l + 0.3 * h,
    glow: 0.55 + 0.6 * h + 0.6 * l,
    spin: 0.4 + 2.2 * h,
  };
}
