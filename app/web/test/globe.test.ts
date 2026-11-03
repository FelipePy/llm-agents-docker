import { expect, it } from 'vitest';
import { GLOBE_COLORS, GLOBE_RADIUS, globeDynamics, globeFragments, isGlobeColor, mulberry32 } from '../src/scene/globe.ts';

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
