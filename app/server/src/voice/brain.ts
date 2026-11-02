import { query, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

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

/** Fila assincrona: as falas do usuario entram aqui e o SDK as consome. */
class MessageQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private ended = false;

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

/**
 * Claude via Agent SDK, sem ferramentas. Mantem UMA sessao aberta (modo de
 * entrada em streaming): cada fala entra na mesma conversa, sem abrir um
 * processo novo, o que corta o atraso antes do primeiro token.
 */
export class ClaudeBrain implements Brain {
  private sessionId: string | undefined;
  private readonly model: string;
  private readonly cwd: string;
  private readonly run: QueryFn;
  private q: Query | undefined;
  private input: MessageQueue<SDKUserMessage> | undefined;
  private messages: AsyncIterator<SDKMessage> | undefined;
  /** A resposta anterior ainda nao chegou ao "result" (foi interrompida). */
  private inTurn = false;

  constructor(opts: { model: string; cwd: string; query?: QueryFn }) {
    this.model = opts.model;
    this.cwd = opts.cwd;
    this.run = opts.query ?? query;
  }

  private open(): void {
    this.input = new MessageQueue<SDKUserMessage>();
    this.q = this.run({
      prompt: this.input,
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
        effort: 'low',
        env: brainEnv(),
      },
    });
    this.messages = this.q[Symbol.asyncIterator]();
  }

  /** Fecha a sessao; a proxima fala abre outra, retomando a conversa. */
  close(): void {
    this.input?.end();
    this.q?.close();
    this.q = undefined;
    this.input = undefined;
    this.messages = undefined;
    this.inTurn = false;
  }

  private async next(): Promise<SDKMessage> {
    const r = await this.messages!.next();
    if (r.done) {
      this.close();
      throw new Error('a sessão do cérebro terminou');
    }
    const m = r.value;
    if ((m.type === 'system' && m.subtype === 'init') || m.type === 'result') this.sessionId = m.session_id;
    return m;
  }

  async *reply(text: string, signal: AbortSignal): AsyncGenerator<string> {
    if (signal.aborted) return;
    if (!this.q) this.open();
    // Descarta o resto de uma resposta interrompida antes de comecar outra.
    while (this.inTurn) {
      if ((await this.next()).type === 'result') this.inTurn = false;
    }
    const onAbort = () => void this.q?.interrupt().catch(() => {});
    signal.addEventListener('abort', onAbort, { once: true });
    this.inTurn = true;
    this.input!.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null } as SDKUserMessage);
    try {
      for (;;) {
        const m = await this.next();
        if (m.type === 'result') {
          this.inTurn = false;
          if (!signal.aborted && m.subtype !== 'success') {
            this.close();
            throw new Error(`o cérebro terminou com erro: ${m.subtype}`);
          }
          return;
        }
        if (signal.aborted) continue;
        if (m.type === 'stream_event') {
          const e = m.event;
          if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') yield e.delta.text;
        }
      }
    } catch (err) {
      // Erro no meio da sessao: fecha para a proxima fala abrir uma limpa.
      this.close();
      throw err;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
