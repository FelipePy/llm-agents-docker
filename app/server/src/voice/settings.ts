// Configuracoes da voz feitas pela tela: quem transcreve a fala e as pausas (quanto
// silencio encerra a fala, quanto esperar por uma frase incompleta e as palavras que a indicam).
// Ficam num arquivo so do usuario (0600); a chave nunca volta inteira para a tela.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_CONTINUATION_WORDS, continuationWord } from './text.ts';

export type SttProvider = 'local' | 'groq';
export const GROQ_MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'] as const;
export type GroqModel = (typeof GROQ_MODELS)[number];

/** Pausas da fala. */
export interface PauseSettings {
  /** Silencio que encerra a fala (o worker manda transcrever). */
  silenceMs: number;
  /** Espera total por uma fala que parou no meio da frase (contando o silencio acima). */
  incompleteMs: number;
  /** Fala que termina numa destas parece incompleta. Vazia: so vale o silencio. */
  continuationWords: string[];
}

export interface VoiceSettings {
  stt: SttProvider;
  groqKey: string;
  groqModel: GroqModel;
  pauses: PauseSettings;
}

/** O que a tela ve: a chave so como dica ("gsk_…a1b2"); os padroes das pausas, para restaurar. */
export interface VoiceSettingsView {
  stt: SttProvider;
  groqModel: GroqModel;
  groqKeyHint: string | null;
  pauses: PauseSettings;
  pauseDefaults: PauseSettings;
}

/** Mudancas pedidas pela tela. groqKey: texto novo; "" apaga a chave; ausente mantem. pauses: campos ausentes mantem. */
export interface VoiceSettingsInput {
  stt?: unknown;
  groqKey?: unknown;
  groqModel?: unknown;
  pauses?: unknown;
}

/** Faixas aceitas; valores fora delas sao limitados. */
export const SILENCE_MS = { min: 300, max: 5000 } as const;
export const INCOMPLETE_MAX_MS = 15_000;
const MAX_WORDS = 200;
const MAX_WORD_CHARS = 40;

export const DEFAULT_PAUSES: PauseSettings = {
  silenceMs: 1000,
  incompleteMs: 3000,
  continuationWords: [...DEFAULT_CONTINUATION_WORDS],
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(n)));

/** Lista normalizada: minusculas, sem pontuacao, sem repeticao nem vazias. */
export function cleanWords(words: readonly string[]): string[] {
  const out = new Set<string>();
  for (const w of words) {
    const entry = continuationWord(w.slice(0, MAX_WORD_CHARS));
    if (entry) out.add(entry);
    if (out.size >= MAX_WORDS) break;
  }
  return [...out];
}

/** Aplica as mudancas validas sobre `base`, limitando os tempos. Tipo errado vira erro. */
export function mergePauses(base: PauseSettings, raw: unknown): PauseSettings | { error: string } {
  if (raw === undefined) return base;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'pausas inválidas' };
  const o = raw as Record<string, unknown>;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (o.silenceMs !== undefined && !num(o.silenceMs)) return { error: 'tempo de silêncio inválido' };
  if (o.incompleteMs !== undefined && !num(o.incompleteMs)) return { error: 'tempo de espera inválido' };
  const words = o.continuationWords;
  if (words !== undefined && !(Array.isArray(words) && words.every((w) => typeof w === 'string'))) {
    return { error: 'lista de palavras inválida' };
  }
  const silenceMs = clamp((o.silenceMs as number | undefined) ?? base.silenceMs, SILENCE_MS.min, SILENCE_MS.max);
  // A espera total nunca e menor que o silencio (seria o mesmo que nao esperar a mais).
  const incompleteMs = clamp((o.incompleteMs as number | undefined) ?? base.incompleteMs, silenceMs, INCOMPLETE_MAX_MS);
  return { silenceMs, incompleteMs, continuationWords: words ? cleanWords(words as string[]) : [...base.continuationWords] };
}

/** O que a sessao usa: o silencio vai para o worker; a espera extra e o total menos o silencio. */
export const pauseConfig = (p: PauseSettings): { endMs: number; extraWaitMs: number; words: string[] } => ({
  endMs: p.silenceMs,
  extraWaitMs: Math.max(0, p.incompleteMs - p.silenceMs),
  words: p.continuationWords,
});

/** O que o worker de voz recebe (comando "stt"). */
export interface SttConfig {
  provider: SttProvider;
  key?: string;
  model?: GroqModel;
}

export const DEFAULT_SETTINGS: VoiceSettings = { stt: 'local', groqKey: '', groqModel: 'whisper-large-v3-turbo', pauses: DEFAULT_PAUSES };

const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';

export const keyHint = (key: string): string | null => (key ? `${key.slice(0, 4)}…${key.slice(-4)}` : null);

export const sttConfig = (s: VoiceSettings): SttConfig =>
  s.stt === 'groq' && s.groqKey ? { provider: 'groq', key: s.groqKey, model: s.groqModel } : { provider: 'local' };

function parse(raw: unknown): VoiceSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    stt: o.stt === 'groq' ? 'groq' : 'local',
    groqKey: typeof o.groqKey === 'string' ? o.groqKey : '',
    groqModel: GROQ_MODELS.includes(o.groqModel as GroqModel) ? (o.groqModel as GroqModel) : DEFAULT_SETTINGS.groqModel,
    pauses: (() => {
      const p = mergePauses(DEFAULT_PAUSES, o.pauses);
      return 'error' in p ? { ...DEFAULT_PAUSES, continuationWords: [...DEFAULT_PAUSES.continuationWords] } : p;
    })(),
  };
}

/** Confere a chave com o Groq (lista de modelos). Devolve a mensagem de erro, ou null se valeu. */
export async function checkGroqKey(key: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(GROQ_MODELS_URL, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return null;
    if (res.status === 401 || res.status === 403) return 'O Groq recusou a chave: confira se ela foi copiada inteira.';
    return `O Groq respondeu com erro ${res.status}; tente de novo em instantes.`;
  } catch {
    return 'Não consegui falar com o Groq (sem internet?).';
  }
}

export class VoiceSettingsStore {
  private settings: VoiceSettings;
  private readonly file: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onChange: (s: VoiceSettings) => void;

  constructor(file: string, opts: { fetch: typeof fetch; onChange?: (s: VoiceSettings) => void }) {
    this.file = file;
    this.fetchImpl = opts.fetch;
    this.onChange = opts.onChange ?? (() => {});
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      raw = undefined;
    }
    this.settings = parse(raw);
  }

  get(): VoiceSettings {
    return { ...this.settings, pauses: { ...this.settings.pauses, continuationWords: [...this.settings.pauses.continuationWords] } };
  }

  view(): VoiceSettingsView {
    const s = this.get();
    return {
      stt: s.stt,
      groqModel: s.groqModel,
      groqKeyHint: keyHint(s.groqKey),
      pauses: s.pauses,
      pauseDefaults: { ...DEFAULT_PAUSES, continuationWords: [...DEFAULT_PAUSES.continuationWords] },
    };
  }

  /** Aplica e salva. Erros de validacao voltam como { error } e nada muda. */
  async update(input: VoiceSettingsInput): Promise<{ view: VoiceSettingsView } | { error: string }> {
    const next = { ...this.settings };
    if (input.stt !== undefined) {
      if (input.stt !== 'local' && input.stt !== 'groq') return { error: 'transcrição inválida: use "local" ou "groq"' };
      next.stt = input.stt;
    }
    if (input.groqModel !== undefined) {
      if (!GROQ_MODELS.includes(input.groqModel as GroqModel)) return { error: 'modelo do Groq inválido' };
      next.groqModel = input.groqModel as GroqModel;
    }
    if (input.groqKey !== undefined) {
      if (typeof input.groqKey !== 'string') return { error: 'chave inválida' };
      const key = input.groqKey.trim();
      if (key && !/^[\x21-\x7e]{20,200}$/.test(key)) return { error: 'Essa chave não parece uma chave do Groq (gsk_…).' };
      if (key && key !== this.settings.groqKey) {
        const problem = await checkGroqKey(key, this.fetchImpl);
        if (problem) return { error: problem };
      }
      next.groqKey = key;
    }
    const pauses = mergePauses(next.pauses, input.pauses);
    if ('error' in pauses) return pauses;
    next.pauses = pauses;
    if (next.stt === 'groq' && !next.groqKey) return { error: 'Cole a chave de API do Groq para usar a transcrição na nuvem.' };

    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    this.settings = next;
    this.onChange(this.get());
    return { view: this.view() };
  }
}
