import { expect, it } from 'vitest';
import { HIGH_QUALITY, LOW_STEPS, nextQuality } from '../src/scene/quality.ts';

const feed = (samples: number[]) => samples.reduce(nextQuality, HIGH_QUALITY);

it('FPS bom nao muda nada (e devolve o mesmo objeto)', () => {
  expect(nextQuality(HIGH_QUALITY, 60)).toBe(HIGH_QUALITY);
});

it('tres amostras baixas seguidas desligam o bloom', () => {
  expect(feed([20, 20]).bloom).toBe(true);
  expect(feed([20, 20, 20])).toEqual({ bloom: false, steps: HIGH_QUALITY.steps, lowStreak: 0 });
});

it('uma amostra boa zera a sequencia', () => {
  expect(feed([20, 20, 60, 20, 20]).bloom).toBe(true);
});

it('depois do bloom, reduz os passos do shader e para ai', () => {
  expect(feed([20, 20, 20, 20, 20, 20])).toEqual({ bloom: false, steps: LOW_STEPS, lowStreak: 0 });
  expect(feed(Array(12).fill(10))).toEqual({ bloom: false, steps: LOW_STEPS, lowStreak: 0 });
});
