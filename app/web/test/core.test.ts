import { expect, it } from 'vitest';
import { demoSignal, electronSpeed, smoothLevel, speechEnvelope } from '../src/scene/core.ts';

it('smoothLevel sobe rapido, desce devagar e fica em [0, 1]', () => {
  const up = smoothLevel(0, 1, 0.05);
  const down = 1 - smoothLevel(1, 0, 0.05);
  expect(up).toBeGreaterThan(down);
  expect(smoothLevel(0.5, 2, 10)).toBe(1);
  expect(smoothLevel(0.5, -1, 10)).toBe(0);
});

it('electronSpeed: pensando e o mais rapido; falar alto acelera', () => {
  expect(electronSpeed('thinking', 0)).toBeGreaterThan(electronSpeed('speaking', 0.5));
  expect(electronSpeed('speaking', 1)).toBeGreaterThan(electronSpeed('speaking', 0));
  expect(electronSpeed('listening', 0)).toBeGreaterThan(electronSpeed('idle', 0));
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
