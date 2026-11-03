// Pausas da fala nas configuracoes: conversao entre o que a tela mostra (segundos,
// palavras separadas por virgula) e o que o servidor guarda (ms, lista).
import type { PauseSettings } from './api.ts';

/** O que esta nos campos (texto, como o usuario digitou). */
export interface PauseDraft {
  silence: string;
  incomplete: string;
  words: string;
}

const seconds = (ms: number): string => String(Math.round(ms / 100) / 10).replace('.', ',');

export const toDraft = (p: PauseSettings): PauseDraft => ({
  silence: seconds(p.silenceMs),
  incomplete: seconds(p.incompleteMs),
  words: p.continuationWords.join(', '),
});

/** "1,5" ou "1.5" segundos -> 1500 ms; texto invalido -> null. */
export function parseSeconds(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() && Number.isFinite(n) ? Math.round(n * 1000) : null;
}

/** "e, que,  o meu ,," -> ["e", "que", "o meu"]. */
export const parseWords = (text: string): string[] =>
  text
    .split(/[,\n]/)
    .map((w) => w.trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean);

/** Rascunho -> o que vai para o servidor (que limita os tempos), ou a mensagem do erro. */
export function fromDraft(d: PauseDraft): PauseSettings | { error: string } {
  const silenceMs = parseSeconds(d.silence);
  if (silenceMs === null) return { error: 'Tempo de silêncio inválido: use segundos, como 1 ou 1,5.' };
  const incompleteMs = parseSeconds(d.incomplete);
  if (incompleteMs === null) return { error: 'Espera da frase incompleta inválida: use segundos, como 3.' };
  return { silenceMs, incompleteMs, continuationWords: parseWords(d.words) };
}

export const sameDraft = (a: PauseDraft, b: PauseDraft): boolean =>
  a.silence === b.silence && a.incomplete === b.incomplete && parseWords(a.words).join('|') === parseWords(b.words).join('|');
