import { query, type McpServerConfig, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { COMMANDS } from './commands.ts';
import { JARVIS_TOOL_NAMES } from './tools.ts';
import { plainReport, type WatchReport, type WatchSummarizer } from './session-watch.ts';

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
  'Suas respostas viram fala: frases curtas, a menos que peçam mais. Não use markdown, listas, tabelas, emojis nem código; escreva números e siglas do jeito que se fala.',
  // Conhecimento e ferramentas.
  'Você vive dentro do llm-agent, o app do usuário para conversar com agentes de código e acompanhar os projetos dele. Quando ele perguntar como fazer algo no app ou para que serve alguma parte dele, consulte a ferramenta manual_do_app e responda com base nela; não invente funcionalidades.',
  'Cada fala do usuário chega com a data e a hora atuais entre colchetes no fim; use-as direto, sem ferramenta. Para clima e notícias, use clima_agora e noticias_do_dia; nunca diga que não sabe sem consultá-las antes.',
  'Notícias: noticias_do_dia já traz só as manchetes que você ainda não apresentou; para mais, chame de novo. Nunca repita uma manchete já dita, nem tirada da conversa; se não houver novas, diga isso.',
  'Para qualquer outra coisa que dependa da web ou que possa ter mudado (fatos recentes, preços, resultados, pessoas, lugares), ou quando o usuário pedir para pesquisar, use pesquisar_na_web em vez de responder de memória ou de abrir uma sessão; responda com os pontos principais, dizendo de onde veio.',
  'Você controla a interface e os projetos pelas ferramentas do servidor jarvis; use-as sempre que o pedido for uma ação, sem pedir confirmação para o que só mostra coisas.',
  // Tamanho da resposta: so o necessario, sem perder o que importa.
  'Fale só o necessário. Comandos no app (abrir ou mostrar algo, voltar, fechar um terminal, mandar recado, ligar a conversa direta, criar algo) são instantâneos: chame a ferramenta direto, sem anunciar antes, e depois confirme em no máximo quatro palavras, do seu jeito (por exemplo, para a conversa direta, algo como "pode falar"). Não explique o que a tela já mostra nem repita instruções de uso.',
  'Perguntas de informação (estado de um projeto, como está uma sessão, notícias, clima, resultado de uma busca no manual ou na web) pedem o essencial: em uma a três frases, traga os dados que importam, como números, nomes, erros, decisões e pendências, sem detalhes de enfeite; se houver mais coisa relevante, ofereça contar mais em vez de despejar tudo.',
  'O usuário às vezes faz uma pausa no meio da fala e continua; aí a mensagem seguinte traz a fala completa (a anterior emendada com a parte nova). Responda só a ela, sem repetir ações já feitas para a parte anterior; se a parte nova corrigir ou contradisser a anterior, vale só a parte nova.',
  'Para essas consultas, que demoram um pouco, diga antes uma frase bem curta com suas palavras (o usuário escuta enquanto a ferramenta roda).',
  'Sessões abertas têm um número pela ordem de abertura (o mesmo da gaveta de terminais), mostrado por sessoes_abertas. Quando o usuário apontar uma sessão específica (pelo número, "a do codex", "a que corrige o login"), passe isso em sessao; se a ferramenta avisar que havia outras sessões ou que ficou ambíguo, pergunte qual em vez de adivinhar.',
  'Trabalho de verdade nos projetos (corrigir, implementar, investigar) vai para uma sessão com iniciar_sessao, com a tarefa completa e clara; diga que ela segue em background.',
  'Quando o usuário pedir para avisar quando uma sessão terminar ou se der erro, use acompanhar_sessao (ou acompanhar em iniciar_sessao, se for uma sessão nova). Você mesmo avisa por voz em poucas frases e oferece contar mais; se ele quiser, use estado_da_sessao para os detalhes.',
  'Se o usuário perguntar o que você sabe fazer, use a ferramenta comandos. Se ele se despedir ou disser que é só isso, despeça-se uma única vez, em poucas palavras e do seu jeito, chame encerrar_conversa e não diga mais nada depois da ferramenta.',
  'Memória: guarde com lembrar, sem anunciar, o que for duradouro e útil depois (nome, preferências, rotina, pessoas, metas, decisões, stack e prazos dos projetos); não guarde o passageiro (clima, hora, pedidos únicos). Se ele pedir para você lembrar de algo, guarde e confirme só com "Anotado.". Se um fato guardado mudou, use substitui com o id dele em vez de duplicar.',
  'Use o que você lembra com naturalidade, quando ajudar (ex.: retomar o que ficou da última conversa), sem recitar a lista. Ao encerrar a conversa, passe em resumo uma frase do que foi feito.',
  'Funcionalidades novas para você mesmo: quando o usuário quiser que você aprenda algo ou mude algo em você ou no app, conduza uma definição curta, uma pergunta por vez (no máximo 4 ou 5: o que dispara, o que você faz ou diz, onde aparece na tela, casos especiais), e guarde a proposta completa com rascunhar_evolucao a cada resposta. Quando ele disser que está tudo certo, chame resumir_evolucao e leia o resumo perguntando se pode começar; só chame iniciar_evolucao depois que ele aprovar, numa fala seguinte. O desenvolvimento roda em background: siga conversando normalmente. Aplique (aplicar_evolucao) só quando ele pedir ou aceitar seu aviso de que terminou.',
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

/**
 * Busca na web pela ferramenta WebSearch do proprio Claude (no login do plano,
 * sem chave de API), numa consulta curta e isolada: so essa ferramenta, sem
 * MCP nem configuracoes. Mais lenta que DuckDuckGo/Wikipedia (uns 15 a 20 s),
 * por isso e a reserva da busca do Jarvis. Devolve um resumo com as fontes.
 */
export function claudeWebSearch(opts: { model: string; cwd: string; query?: QueryFn; timeoutMs?: number }) {
  const run = opts.query ?? query;
  return async (subject: string): Promise<string> => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? 45_000);
    const q = run({
      prompt:
        `Pesquise na web: ${subject}\n\n` +
        'Responda em português, em até cinco tópicos curtos com os fatos principais (números, datas, nomes), ' +
        'cada um com o nome do site de onde veio. Se as fontes divergirem ou forem antigas, diga.',
      options: {
        model: opts.model,
        cwd: opts.cwd,
        tools: ['WebSearch'],
        allowedTools: ['WebSearch'],
        settingSources: [],
        mcpServers: {},
        strictMcpConfig: true,
        maxTurns: 4,
        effort: 'low',
        thinking: { type: 'disabled' },
        abortController: abort,
        env: brainEnv(),
      },
    });
    try {
      for await (const m of q) {
        if (m.type !== 'result') continue;
        if (m.subtype !== 'success') throw new Error(m.subtype);
        return m.result;
      }
      throw new Error('a busca terminou sem resposta');
    } catch (err) {
      if (abort.signal.aborted) throw new Error('demorou demais');
      throw err;
    } finally {
      clearTimeout(timer);
      q.close();
    }
  };
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
  private readonly systemPrompt: string;

  /** `mcp`: cria o servidor de ferramentas do Jarvis (uma instancia por sessao). */
  /** `about`: o que os agentes ja sabem sobre o usuario (memorias), para respostas pessoais. */
  constructor(opts: {
    model: string;
    cwd: string;
    query?: QueryFn;
    mcp?: () => McpServerConfig;
    about?: () => Promise<string>;
    now?: () => Date;
    /** Outras instrucoes no lugar das do Jarvis (ex.: o juiz de interrupcoes). */
    systemPrompt?: string;
  }) {
    this.systemPrompt = opts.systemPrompt ?? JARVIS_PROMPT;
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
        systemPrompt: about ? `${this.systemPrompt}\n\nO que você já sabe sobre o usuário (das memórias dele):\n${about}` : this.systemPrompt,
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

/** Decide se uma fala dita por cima da resposta do Jarvis deve mudar a resposta. */
export interface InterruptJudge {
  warm?(): void;
  /** true: e um pedido/comentario para o Jarvis; false: sem sentido, ignorar e retomar. */
  relevant(c: { asked: string; said: string; heard: string }): Promise<boolean>;
}

export const JUDGE_PROMPT = [
  'Você avalia interrupções de um assistente de voz em português.',
  'O assistente estava respondendo ao usuário e o microfone captou uma fala por cima da resposta.',
  'Responda NOVO se a fala for dirigida ao assistente e fizer sentido: um pedido, uma pergunta, uma correção, um comentário sobre o assunto ou um pedido para parar.',
  'Responda IGNORAR se ela não fizer sentido como algo dito ao assistente: frase sem nexo, palavras soltas, conversa com outra pessoa, TV ou música transcrita, ou o eco das palavras do próprio assistente.',
  'Na dúvida, responda NOVO. Responda só com uma palavra: NOVO ou IGNORAR.',
].join(' ');

/** Juiz num segundo Claude (sem ferramentas, ja aberto): responde em ~1 s. Na falha ou demora, NOVO. */
export function claudeJudge(opts: { model: string; cwd: string; query?: QueryFn; timeoutMs?: number }): InterruptJudge {
  const brain = new ClaudeBrain({ model: opts.model, cwd: opts.cwd, query: opts.query, systemPrompt: JUDGE_PROMPT });
  return {
    warm: () => brain.warm(),
    async relevant({ asked, said, heard }) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? 4000);
      const prompt = `Pergunta do usuário: ${asked || '(nenhuma)'}\nO assistente estava dizendo: ${said.slice(-400) || '(nada ainda)'}\nFala captada por cima: ${heard}`;
      let out = '';
      try {
        for await (const d of brain.reply(prompt, abort.signal)) {
          out += d;
          if (/NOVO|IGNORAR/i.test(out)) break;
        }
      } catch {
        return true;
      } finally {
        clearTimeout(timer);
      }
      return !/IGNORAR/i.test(out);
    },
  };
}

export const WATCH_PROMPT = [
  'Você escreve o aviso falado de um assistente de voz em português do Brasil, chamado Jarvis, que chama o usuário de senhor.',
  'Você recebe as últimas linhas do terminal de uma sessão de um agente de programação que o usuário pediu para acompanhar.',
  'Se a tarefa terminou: diga em uma ou duas frases curtas o resultado (o que foi feito, testes, commits, pendências, ou se o agente está esperando uma resposta) e termine perguntando se o usuário quer que você conte mais.',
  'Se deu erro: diga em uma ou duas frases curtas qual foi o erro, em palavras simples.',
  'Comece com "Senhor," e diga de qual sessão se trata. Texto para falar: sem markdown, listas, caminhos longos ou códigos.',
  'Responda só com o aviso.',
].join(' ');

/** Aviso de uma sessao acompanhada, escrito por um Claude a parte (sem ferramentas). */
export function claudeWatchSummary(opts: { model: string; cwd: string; query?: QueryFn; timeoutMs?: number }): WatchSummarizer {
  return async (r: WatchReport) => {
    const brain = new ClaudeBrain({ model: opts.model, cwd: opts.cwd, query: opts.query, systemPrompt: WATCH_PROMPT });
    const prompt = [
      `Sessão: ${r.label}.`,
      r.outcome === 'error' ? `Situação: deu erro (${r.error ?? 'veja o terminal'}).` : 'Situação: a tarefa terminou (o terminal parou).',
      `Últimas linhas do terminal:\n${r.tail || '(vazio)'}`,
    ].join('\n');
    const signal = AbortSignal.timeout(opts.timeoutMs ?? 30_000);
    let out = '';
    try {
      for await (const d of brain.reply(prompt, signal)) out += d;
    } catch {
      return plainReport(r);
    } finally {
      brain.close();
    }
    // Cortado pela demora: aviso pela metade nao serve.
    return (!signal.aborted && out.trim()) || plainReport(r);
  };
}
