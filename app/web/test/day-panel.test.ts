import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AutoNewsButton, nextDay } from '../src/components/DayPanel.tsx';
import type { DayInfo } from '../src/types.ts';

const item = (title: string) => ({ title, source: 'G1', link: '', published: '' });
const weather = (temperature: number) => ({ temperature, code: 2, description: 'nublado', max: 29, min: 18, place: '' });
const shown: DayInfo = { weather: weather(20), news: [item('A')] };
const fresh: DayInfo = { weather: weather(25), news: [item('B')] };

describe('nextDay', () => {
  it('ligadas: a lista acompanha a atualizacao', () => {
    expect(nextDay(shown, fresh, true)).toEqual(fresh);
  });
  it('desligadas: o clima muda e as manchetes da tela ficam', () => {
    expect(nextDay(shown, fresh, false)).toEqual({ weather: weather(25), news: [item('A')], newsError: undefined });
  });
  it('desligadas e sem manchete na tela: a lista ainda carrega', () => {
    expect(nextDay(null, fresh, false)).toEqual(fresh);
    expect(nextDay({ weather: null, news: [], newsError: 'fora do ar' }, fresh, false)).toEqual(fresh);
  });
});

describe('AutoNewsButton', () => {
  const render = (enabled: boolean | undefined) => renderToStaticMarkup(createElement(AutoNewsButton, { enabled, onToggle: () => {} }));
  it('o mesmo botao desliga e religa', () => {
    expect(render(true)).toContain('Desativar automáticas');
    expect(render(false)).toContain('Ativar automáticas');
  });
  it('fica travado enquanto a escolha carrega', () => {
    expect(render(undefined)).toContain('disabled');
    expect(render(true)).not.toContain('disabled');
  });
});
