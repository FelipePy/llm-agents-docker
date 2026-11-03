import { query, type McpServerConfig, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { COMMANDS } from './commands.ts';
import { JARVIS_TOOL_NAMES } from './tools.ts';

/** Responde a uma fala do usuario, em pedacos de texto (streaming). */
/** Avisos do cerebro durante uma resposta (para medir a latencia). */
export interface BrainHooks {
  /** Uma ferramenta comecou a ser chamada (nome sem o prefixo mcp__jarvis__). */
  onTool?(name: string): void;
}

export interface Brain {
  reply(text: string, signal: AbortSignal, hooks?: BrainHooks): AsyncIterable<string>;
  /** Abre a sessao antes da primeira fala (opcional). */
  warm?(): void;
}

export type QueryFn = typeof query;

export const JARVIS_PROMPT = [
  'Você é o Jarvis, o assistente pessoal do usuário. Você conversa por voz, em português do Brasil.',
  // Jeito de falar: orientacoes de estilo, nao frases prontas.
  'Fale como um assistente de verdade conversando com alguém que você conhece bem: caloroso, natural e direto, com um bom humor leve quando cabe.',
  'Use o português falado do dia a dia, sem formalidade e sem soar como manual; contrações como "tá" e "pra" são bem-vindas.',
  'Varie o jeito de começar e de terminar as respostas; não repita fórmulas de confirmação. Reaja ao que a pessoa disse quando fizer sentido e, se algo estiver ambíguo, pergunte de volta em vez de adivinhar.',
  'Se souber o nome do usuário, use de vez em quando, sem exagero. Lembre do que já foi dito nesta conversa.',
  'Suas respostas viram fala: em geral, uma a três frases curtas, a menos que peçam mais. Não use markdown, listas, tabelas, emojis nem código; escreva números e siglas do jeito que se fala.',
  // Conhecimento e ferramentas.
  'Você vive dentro do llm-agent, o app do usuário para conversar com agentes de código e acompanhar os projetos dele. Quando ele perguntar como fazer algo no app ou para que serve alguma parte dele, consulte a ferramenta manual_do_app e responda com base nela; não invente funcionalidades.',
  'Cada fala do usuário chega com a data e a hora atuais entre colchetes no fim; use-as direto, sem ferramenta. Para clima e notícias, use clima_agora e noticias_do_dia; nunca diga que não sabe sem consultá-las antes.',
  'Você controla a interface e os projetos pelas ferramentas do servidor jarvis; use-as sempre que o pedido for uma ação, sem pedir confirmação para o que só mostra coisas.',
  'Importante para a fala não travar: sempre que for usar uma ferramenta, escreva ANTES dela uma frase curta, com suas palavras, dizendo o que vai fazer; o usuário escuta essa frase enquanto a ferramenta roda. Depois, conte o resultado como contaria a alguém, sem ler listas inteiras.',
  'Trabalho de verdade nos projetos (corrigir, implementar, investigar) vai para uma sessão com iniciar_sessao, com a tarefa completa e clara; diga que ela segue em background.',
  'Se o usuário perguntar o que você sabe fazer, use a ferramenta comandos. Se ele se despedir ou disser que é só isso, despeça-se uma única vez, em poucas palavras e do seu jeito, chame encerrar_conversa e não diga mais nada depois da ferramenta.',
  `Comandos disponíveis: ${COMMANDS.map((c) => `${c.title} (ex.: "${c.examples[0]}")`).join('; ')}.`,
].join(' ');

/** Ambiente do cerebro sem credenciais de API: ele usa sempre o login do plano. */
export function brainEnv(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('ANTHROPIC_') && key !== 'CLAUDECODE') out[key] = value;
  }
  // Sem chamadas extras do Claude Code (telemetria, titulos...) disputando com a resposta.
  out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
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
  private readonly mcp: (() => McpServerConfig) | undefined;
  private readonly about: (() => Promise<string>) | undefined;
  private q: Query | undefined;
  private input: MessageQueue<SDKUserMessage> | undefined;
  private messages: AsyncIterator<SDKMessage> | undefined;
  /** A resposta anterior ainda nao chegou ao "result" (foi interrompida). */
  private inTurn = false;
  private readonly now: () => Date;

  /** `mcp`: cria o servidor de ferramentas do Jarvis (uma instancia por sessao). */
  /** `about`: o que os agentes ja sabem sobre o usuario (memorias), para respostas pessoais. */
  constructor(opts: {
    model: string;
    cwd: string;
    query?: QueryFn;
    mcp?: () => McpServerConfig;
    about?: () => Promise<string>;
    now?: () => Date;
  }) {
    this.now = opts.now ?? (() => new Date());
    this.mcp = opts.mcp;
    this.about = opts.about;
    this.model = opts.model;
    this.cwd = opts.cwd;
    this.run = opts.query ?? query;
  }

  private open(about = ''): void {
    this.input = new MessageQueue<SDKUserMessage>();
    this.q = this.run({
      prompt: this.input,
      options: {
        model: this.model,
        cwd: this.cwd,
        tools: [],
        settingSources: [],
        mcpServers: this.mcp ? { jarvis: this.mcp() } : {},
        allowedTools: this.mcp ? JARVIS_TOOL_NAMES : [],
        strictMcpConfig: true,
        systemPrompt: about ? `${JARVIS_PROMPT}\n\nO que você já sabe sobre o usuário (das memórias dele):\n${about}` : JARVIS_PROMPT,
        includePartialMessages: true,
        resume: this.sessionId,
        effort: 'low',
        // Respostas curtas faladas: sem raciocinio estendido, o primeiro token chega antes.
        thinking: { type: 'disabled' },
        env: brainEnv(),
      },
    });
    this.messages = this.q[Symbol.asyncIterator]();
  }

  /** Abre o processo do Claude ja, para a primeira fala nao esperar por ele. */
  warm(): void {
    void this.ensureOpen();
  }

  private opening: Promise<void> | undefined;

  private ensureOpen(): Promise<void> {
    if (this.q) return Promise.resolve();
    this.opening ??= (async () => {
      const about = await this.about?.().catch(() => '');
      if (!this.q) this.open(about ?? '');
    })().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
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

  async *reply(text: string, signal: AbortSignal, hooks: BrainHooks = {}): AsyncGenerator<string> {
    if (signal.aborted) return;
    await this.ensureOpen();
    // Descarta o resto de uma resposta interrompida antes de comecar outra.
    while (this.inTurn) {
      if ((await this.next()).type === 'result') this.inTurn = false;
    }
    const onAbort = () => void this.q?.interrupt().catch(() => {});
    signal.addEventListener('abort', onAbort, { once: true });
    this.inTurn = true;
    let spoke = false;
    // Data e hora vao junto com a fala: perguntas de hora nao precisam de ferramenta.
    const content = `${text}\n\n[${this.now().toLocaleString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}]`;
    this.input!.push({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null } as SDKUserMessage);
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
          // Um bloco de texto novo (ex.: depois de uma ferramenta) comeca com espaco.
          if (e.type === 'content_block_start' && e.content_block.type === 'tool_use') {
            hooks.onTool?.(e.content_block.name.replace(/^mcp__jarvis__/, ''));
          }
          if (e.type === 'content_block_start' && e.content_block.type === 'text' && spoke) yield ' ';
          if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') {
            spoke = true;
            yield e.delta.text;
          }
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
