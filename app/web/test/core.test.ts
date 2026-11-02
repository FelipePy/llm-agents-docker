import { expect, it } from 'vitest';
import { demoSignal, electronSpeed, jitterAmplitude, smoothHeat, speechEnvelope, targetHeat, wobble } from '../src/scene/core.ts';

it('targetHeat: frio parado, quente falando alto', () => {
  expect(targetHeat('idle', 1)).toBe(0.05);
  expect(targetHeat('listening', 0)).toBeGreaterThan(targetHeat('idle', 0));
  expect(targetHeat('thinking', 0)).toBeGreaterThan(targetHeat('speaking', 0));
  expect(targetHeat('speaking', 1)).toBe(1);
  expect(targetHeat('speaking', 5)).toBe(1);
});

it('smoothHeat esquenta rapido, esfria devagar e fica em [0, 1]', () => {
  const up = smoothHeat(0, 1, 0.05);
  const down = 1 - smoothHeat(1, 0, 0.05);
  expect(up).toBeGreaterThan(down);
  expect(smoothHeat(0.5, 2, 10)).toBe(1);
  expect(smoothHeat(0.5, -1, 10)).toBe(0);
});

it('agitacao cresce com o calor e e quase nula no frio', () => {
  for (const f of [electronSpeed, jitterAmplitude, wobble]) expect(f(1)).toBeGreaterThan(f(0.3));
  expect(jitterAmplitude(targetHeat('idle', 0))).toBeLessThan(0.03);
  expect(wobble(targetHeat('idle', 0))).toBeLessThan(0.02);
  expect(electronSpeed(1) / electronSpeed(0.05)).toBeGreaterThan(4);
});

it('demoSignal percorre os estados a cada 16 s', () => {
  expect(demoSignal(1)).toEqual({ mode: 'idle', level: 0 });
  expect(demoSignal(5)).toEqual({ mode: 'listening', level: 0 });
  expect(demoSignal(8).mode).toBe('thinking');
  expect(demoSignal(10).mode).toBe('speaking');
  expect(demoSignal(17).mode).toBe('idle');
});

it('speechEnvelope varia entre silencio e pico, dentro de [0, 1]', () => {
  const v = Array.from({ length: 400 }, (_, i) => speechEnvelope(i * 0.02));
  expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...v)).toBeLessThanOrEqual(1);
  expect(Math.max(...v)).toBeGreaterThan(0.6);
  expect(Math.min(...v)).toBeLessThan(0.2);
});
