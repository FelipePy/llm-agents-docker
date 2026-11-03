import { expect, it } from 'vitest';
import { HIGH_QUALITY, LOW_DETAIL, nextQuality } from '../src/scene/quality.ts';

const feed = (samples: number[]) => samples.reduce(nextQuality, HIGH_QUALITY);

it('FPS bom nao muda nada (e devolve o mesmo objeto)', () => {
  expect(nextQuality(HIGH_QUALITY, 60)).toBe(HIGH_QUALITY);
});

it('tres amostras baixas seguidas desligam o bloom', () => {
  expect(feed([20, 20]).bloom).toBe(true);
  expect(feed([20, 20, 20])).toEqual({ bloom: false, detail: HIGH_QUALITY.detail, lowStreak: 0 });
});

it('uma amostra boa zera a sequencia', () => {
  expect(feed([20, 20, 60, 20, 20]).bloom).toBe(true);
});

it('depois do bloom, reduz os fragmentos do globo e para ai', () => {
  expect(feed([20, 20, 20, 20, 20, 20])).toEqual({ bloom: false, detail: LOW_DETAIL, lowStreak: 0 });
  expect(feed(Array(12).fill(10))).toEqual({ bloom: false, detail: LOW_DETAIL, lowStreak: 0 });
});
