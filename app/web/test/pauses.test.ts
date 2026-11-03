import { describe, expect, it } from 'vitest';
import { fromDraft, parseSeconds, parseWords, sameDraft, toDraft } from '../src/pauses.ts';

describe('pausas da fala', () => {
  it('mostra em segundos e lista com virgulas', () => {
    expect(toDraft({ silenceMs: 1000, incompleteMs: 2500, continuationWords: ['e', 'o meu'] })).toEqual({
      silence: '1',
      incomplete: '2,5',
      words: 'e, o meu',
    });
  });
  it('le segundos com virgula ou ponto', () => {
    expect([parseSeconds('1,5'), parseSeconds(' 2.25 '), parseSeconds('3'), parseSeconds(''), parseSeconds('abc')]).toEqual([
      1500, 2250, 3000, null, null,
    ]);
  });
  it('separa as palavras por virgula ou linha e limpa', () => {
    expect(parseWords(' E, que,,  o   meu \n pra ,')).toEqual(['e', 'que', 'o meu', 'pra']);
    expect(parseWords('  ')).toEqual([]);
  });
  it('monta o pedido ao servidor ou explica o erro', () => {
    expect(fromDraft({ silence: '1,2', incomplete: '4', words: 'e, de' })).toEqual({
      silenceMs: 1200,
      incompleteMs: 4000,
      continuationWords: ['e', 'de'],
    });
    expect(fromDraft({ silence: 'x', incomplete: '4', words: '' })).toHaveProperty('error');
    expect(fromDraft({ silence: '1', incomplete: '', words: '' })).toHaveProperty('error');
  });
  it('mudanca so de espacos ou maiusculas nao conta como alteracao', () => {
    const a = { silence: '1', incomplete: '3', words: 'e, que' };
    expect(sameDraft(a, { ...a, words: 'E,que ' })).toBe(true);
    expect(sameDraft(a, { ...a, words: 'e' })).toBe(false);
    expect(sameDraft(a, { ...a, silence: '1,5' })).toBe(false);
  });
});
