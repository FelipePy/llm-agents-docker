import { expect, it } from 'vitest';
import {
  ARC, DOT, GLOBE_COLORS, GLOBE_RADIUS, GLOBE_STYLES, globeDynamics, globeFragments, isGlobeColor, isGlobeStyle, mulberry32, orbitFragments, particleFragments,
} from '../src/scene/globe.ts';

it('mulberry32 e deterministico e fica em [0, 1)', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  const xs = Array.from({ length: 200 }, () => a());
  expect(xs).toEqual(Array.from({ length: 200 }, () => b()));
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...xs)).toBeLessThan(1);
});

it('globeFragments: quantidade, cascas dentro do raio, faixas girando para os dois lados', () => {
  const f = globeFragments(2000, 1);
  expect(f.count).toBe(2000);
  expect(f.band.length).toBe(2000 * 4);
  expect(f.shape.length).toBe(2000 * 4);
  expect(f.tilt.length).toBe(2000 * 2);
  const radii: number[] = [];
  const speeds = new Set<number>();
  let panels = 0;
  let arcs = 0;
  for (let i = 0; i < f.count; i++) {
    radii.push(f.band[i * 4 + 2]);
    speeds.add(Math.sign(f.band[i * 4 + 3]));
    const kind = f.shape[i * 4 + 3];
    if (kind === 1) panels++;
    if (kind === 2) arcs++;
    expect(Math.abs(f.band[i * 4 + 1])).toBeLessThanOrEqual(Math.PI / 2);
  }
  expect(Math.min(...radii)).toBeGreaterThanOrEqual(GLOBE_RADIUS * 0.3);
  expect(Math.max(...radii)).toBeLessThanOrEqual(GLOBE_RADIUS * 1.15);
  expect(speeds).toEqual(new Set([1, -1]));
  expect(panels).toBeGreaterThan(0);
  expect(arcs).toBeGreaterThan(0);
  expect(panels + arcs).toBeLessThan(f.count / 2);
});

it('globeFragments: mesma semente, mesmo globo', () => {
  expect(globeFragments(300, 5).band).toEqual(globeFragments(300, 5).band);
});

it('globeDynamics: parado e calmo; falando alto cresce, agita e brilha mais', () => {
  const idle = globeDynamics(0.05, 0);
  const listening = globeDynamics(0.2, 0);
  const quiet = globeDynamics(0.3, 0);
  const loud = globeDynamics(1, 1);
  expect(idle.expand).toBe(1);
  expect(loud.expand).toBeGreaterThan(1.2);
  expect(loud.expand).toBeLessThanOrEqual(1.35);
  expect(loud.agitation).toBeGreaterThan(quiet.agitation * 3);
  expect(loud.grow).toBeGreaterThan(quiet.grow);
  expect(loud.glow).toBeGreaterThan(idle.glow);
  expect(listening.spin).toBeGreaterThan(idle.spin);
});

it('cores: dourado, ciano e branco; valida o que vem do localStorage', () => {
  expect(Object.keys(GLOBE_COLORS)).toEqual(['dourado', 'ciano', 'branco']);
  expect(isGlobeColor('ciano')).toBe(true);
  expect(isGlobeColor('roxo')).toBe(false);
  expect(isGlobeColor(null)).toBe(false);
});

it('estilos: holografico continua sendo o globo original; valida o que vem do localStorage', () => {
  expect(Object.keys(GLOBE_STYLES)).toEqual(['holografico', 'particulas', 'orbitas']);
  expect(GLOBE_STYLES.holografico.build).toBe(globeFragments);
  expect(GLOBE_STYLES.holografico.fragments).toBe(3600);
  expect(GLOBE_STYLES.holografico.rings).toHaveLength(3);
  expect(isGlobeStyle('orbitas')).toBe(true);
  expect(isGlobeStyle('roxo')).toBe(false);
  expect(isGlobeStyle('toString')).toBe(false);
  expect(isGlobeStyle(null)).toBe(false);
});

it.each(Object.entries(GLOBE_STYLES))('estilo %s: atributos completos, dentro do raio e deterministicos', (_id, style) => {
  const f = style.build(600, 3);
  expect(f.count).toBe(600);
  expect(f.band.length).toBe(600 * 4);
  expect(f.shape.length).toBe(600 * 4);
  expect(f.tilt.length).toBe(600 * 2);
  expect(f.band.every(Number.isFinite)).toBe(true);
  expect(f.shape.every(Number.isFinite)).toBe(true);
  for (let i = 0; i < f.count; i++) {
    expect(f.band[i * 4 + 2]).toBeGreaterThanOrEqual(GLOBE_RADIUS * 0.3);
    expect(f.band[i * 4 + 2]).toBeLessThanOrEqual(GLOBE_RADIUS * 1.15);
    expect(Math.abs(f.band[i * 4 + 1])).toBeLessThanOrEqual(Math.PI / 2);
  }
  expect(style.build(600, 3).band).toEqual(f.band);
});

it('particulas: so pontos, cobrindo a esfera de polo a polo, em duas cascas com giros opostos', () => {
  const f = particleFragments(1500);
  const speeds = new Set<number>();
  const lats: number[] = [];
  for (let i = 0; i < f.count; i++) {
    expect(f.shape[i * 4 + 3]).toBe(DOT);
    lats.push(f.band[i * 4 + 1]);
    speeds.add(Math.sign(f.band[i * 4 + 3]));
  }
  expect(Math.max(...lats)).toBeGreaterThan(1.4);
  expect(Math.min(...lats)).toBeLessThan(-1.4);
  expect(speeds).toEqual(new Set([1, -1]));
});

it('orbitas: arcos e contas em poucos planos, sem o arco dar a volta inteira', () => {
  const f = orbitFragments(1200);
  const planes = new Set<string>();
  let arcs = 0;
  let dots = 0;
  for (let i = 0; i < f.count; i++) {
    planes.add(`${f.tilt[i * 2]},${f.tilt[i * 2 + 1]}`);
    expect(f.band[i * 4 + 1]).toBe(0);
    const kind = f.shape[i * 4 + 3];
    if (kind === ARC) {
      arcs++;
      expect(f.shape[i * 4] / f.band[i * 4 + 2]).toBeLessThan(1.4);
    }
    if (kind === DOT) dots++;
  }
  expect(planes.size).toBe(6);
  expect(arcs).toBeGreaterThan(0);
  expect(dots).toBeGreaterThan(arcs);
  expect(arcs + dots).toBe(f.count);
  // Com a voz, o arco cresce ate 2,6 vezes: cada divisao ainda precisa parecer curva.
  expect((1.4 * 2.6) / GLOBE_STYLES.orbitas.segments).toBeLessThan(0.25);
});
