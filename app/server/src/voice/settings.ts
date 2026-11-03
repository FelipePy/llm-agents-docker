// Configuracoes da voz feitas pela tela (hoje: quem transcreve a fala).
// Ficam num arquivo so do usuario (0600); a chave nunca volta inteira para a tela.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type SttProvider = 'local' | 'groq';
export const GROQ_MODELS = ['whisper-large-v3-turbo', 'whisper-large-v3'] as const;
export type GroqModel = (typeof GROQ_MODELS)[number];

export interface VoiceSettings {
  stt: SttProvider;
  groqKey: string;
  groqModel: GroqModel;
}

/** O que a tela ve: a chave so como dica ("gsk_…a1b2"). */
export interface VoiceSettingsView {
  stt: SttProvider;
  groqModel: GroqModel;
  groqKeyHint: string | null;
}

/** Mudancas pedidas pela tela. groqKey: texto novo; "" apaga a chave; ausente mantem. */
export interface VoiceSettingsInput {
  stt?: unknown;
  groqKey?: unknown;
  groqModel?: unknown;
}

/** O que o worker de voz recebe (comando "stt"). */
export interface SttConfig {
  provider: SttProvider;
  key?: string;
  model?: GroqModel;
}

export const DEFAULT_SETTINGS: VoiceSettings = { stt: 'local', groqKey: '', groqModel: 'whisper-large-v3-turbo' };

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
    return { ...this.settings };
  }

  view(): VoiceSettingsView {
    const s = this.settings;
    return { stt: s.stt, groqModel: s.groqModel, groqKeyHint: keyHint(s.groqKey) };
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
    if (next.stt === 'groq' && !next.groqKey) return { error: 'Cole a chave de API do Groq para usar a transcrição na nuvem.' };

    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    this.settings = next;
    this.onChange(this.get());
    return { view: this.view() };
  }
}
