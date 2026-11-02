import { expect, it } from 'vitest';
import { createBus } from '../src/bus.ts';

it('guarda a saida ate o terminal montar', () => {
  const bus = createBus();
  bus.data('a', 'um ');
  bus.data('a', 'dois');
  const got: [string, boolean][] = [];
  bus.on('a', (d, reset) => got.push([d, reset]));
  expect(got).toEqual([['um ', false], ['dois', false]]);
  bus.data('a', 'tres');
  expect(got.at(-1)).toEqual(['tres', false]);
});

it('history substitui o pendente e pede reset', () => {
  const bus = createBus();
  bus.data('a', 'velho');
  bus.history('a', 'tudo');
  const got: [string, boolean][] = [];
  const off = bus.on('a', (d, reset) => got.push([d, reset]));
  expect(got).toEqual([['tudo', true]]);
  bus.history('a', 'de novo');
  expect(got.at(-1)).toEqual(['de novo', true]);
  off();
  bus.data('a', 'depois');
  const later: string[] = [];
  bus.on('a', (d) => later.push(d));
  expect(later).toEqual(['depois']);
});
