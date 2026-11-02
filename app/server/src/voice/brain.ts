import { query } from '@anthropic-ai/claude-agent-sdk';

/** Responde a uma fala do usuario, em pedacos de texto (streaming). */
export interface Brain {
  reply(text: string, signal: AbortSignal): AsyncIterable<string>;
}

export type QueryFn = typeof query;

export const JARVIS_PROMPT = [
  'Você é o Jarvis, o assistente de voz do usuário, e fala português do Brasil.',
  'Suas respostas são convertidas em fala: responda em uma a três frases curtas e naturais, a menos que o usuário peça mais detalhes.',
  'Não use markdown, listas, tabelas, emojis nem blocos de código. Escreva números e siglas do jeito que devem ser falados.',
  'Nesta versão você ainda não consegue abrir projetos, ler arquivos nem executar tarefas; se pedirem algo assim, diga em uma frase que isso chega em breve.',
].join(' ');

/** Ambiente do cerebro sem credenciais de API: ele usa sempre o login do plano. */
export function brainEnv(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('ANTHROPIC_') && key !== 'CLAUDECODE') out[key] = value;
  }
  return out;
}

/** Claude via Agent SDK, sem ferramentas, mantendo a conversa entre as falas. */
export class ClaudeBrain implements Brain {
  private sessionId: string | undefined;
  private readonly model: string;
  private readonly cwd: string;
  private readonly run: QueryFn;

  constructor(opts: { model: string; cwd: string; query?: QueryFn }) {
    this.model = opts.model;
    this.cwd = opts.cwd;
    this.run = opts.query ?? query;
  }

  async *reply(text: string, signal: AbortSignal): AsyncGenerator<string> {
    if (signal.aborted) return;
    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const messages = this.run({
        prompt: text,
        options: {
          model: this.model,
          cwd: this.cwd,
          tools: [],
          settingSources: [],
          mcpServers: {},
          strictMcpConfig: true,
          systemPrompt: JARVIS_PROMPT,
          includePartialMessages: true,
          resume: this.sessionId,
          abortController,
          effort: 'low',
          env: brainEnv(),
        },
      });
      for await (const m of messages) {
        if (signal.aborted) return;
        if (m.type === 'system' && m.subtype === 'init') {
          this.sessionId = m.session_id;
        } else if (m.type === 'stream_event') {
          const e = m.event;
          if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') yield e.delta.text;
        } else if (m.type === 'result') {
          this.sessionId = m.session_id;
          if (m.subtype !== 'success') throw new Error(`o cérebro terminou com erro: ${m.subtype}`);
        }
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
