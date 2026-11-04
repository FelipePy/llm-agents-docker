import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, SessionAgent } from './types.ts';
import { bearer, originAllowed, tokenMatches } from './auth.ts';
import { buildOverview, listProjects, projectDetail, projectPathFromId, projectsBase } from './catalog.ts';
import { scanConversations } from './conversations.ts';
import { NEWS_DEFAULT, createDayService } from './day.ts';
import { createSearchService } from './search.ts';
import { isFile } from './files.ts';
import { PROJECT_NAME, TASKS, isTask, projectPrompt } from './tasks.ts';
import { TerminalManager } from './terminals.ts';
import type { Brain, InterruptJudge } from './voice/brain.ts';
import { createJarvisServer, jarvisHandlers, type JarvisContext } from './voice/tools.ts';
import { COMMANDS } from './voice/commands.ts';
import { EvolutionManager, markUpdateAnnounced, readUpdate, updateNotice, updateOutcome, type EvolutionDeps, type SelfCheck } from './evolution.ts';
import { writeFile } from 'node:fs/promises';
import { Announcer } from './voice/announcer.ts';
import { SessionWatcher, type WatchSummarizer } from './voice/session-watch.ts';
import { shortTitle } from './conversations.ts';
import { gitLines } from './catalog.ts';
import { VoiceSession, type VoiceWorker, type WorkerEvent } from './voice/session.ts';
import { pauseConfig, type VoiceSettingsStore } from './voice/settings.ts';
import { SpeakerProfileStore, type Mailer } from './voice/speaker.ts';
import { JarvisMemory } from './voice/memory.ts';
import { NewsHistory } from './voice/news-history.ts';
import type { SessionInfo, VoiceClientMessage, VoiceServerMessage } from './types.ts';

export interface AppOptions {
  home: string;
  /** 0 escolhe uma porta livre (testes). */
  port: number;
  token: string;
  webDir: string;
  /** Caminho do llm-agent executado pelos terminais. */
  bin: string;
  extraOrigins: string[];
  /** Pasta das sessoes de tarefa ("+ Nova skill", "+ Sobre mim"); fica fora da lista de projetos. */
  workspaceDir: string;
  /** Onde "+ Novo projeto" cria pastas (padrao: a pasta-mae mais comum dos projetos). */
  projectsDir?: string;
  /** Cidade do clima quando o navegador nao manda coordenadas. */
  city?: string;
  newsUrl?: string;
  fetch?: typeof fetch;
  /** Busca na web de reserva do Jarvis, quando o DuckDuckGo falha (a do Claude, em main.ts). */
  webSearchFallback?: (query: string) => Promise<string>;
  /** Voz (etapa 3a): sem ela, /ws/voice responde 404. */
  voice?: {
    worker: VoiceWorker;
    brain: Brain | ((ctx: JarvisContext) => Brain);
    bargeIn?: boolean;
    greetings?: string[];
    /** Falas espontaneas (inicio, periodo do dia, notícias); minutos entre rodadas de notícias. */
    announce?: { newsEveryMin: number };
    /** Decide se uma fala dita por cima da resposta muda a resposta (sem ele, sempre muda). */
    judge?: InterruptJudge;
    /** Configuracoes feitas pela tela (transcricao local ou Groq). */
    settings?: VoiceSettingsStore;
    /** Escreve o aviso falado de uma sessao acompanhada (sem ele, um texto simples). */
    watchSummary?: WatchSummarizer;
    /** Tempo sem saida nova para considerar terminada uma sessao acompanhada. */
    watchQuietMs?: number;
    /**
     * Voz do usuario (so ela ativa o Jarvis, quando cadastrada): arquivo do
     * perfil, envio do codigo de recuperacao por e-mail e semelhanca minima.
     */
    profile?: { file: string; mailer?: Mailer; threshold?: number };
  };
  /**
   * Evolucao do Jarvis por voz: repositorio, clones e arquivos de estado (as
   * sessoes vem do proprio servidor). `updateFile` tambem guarda o resultado
   * do /api/self-check que o app/restart.sh chama depois de reiniciar.
   */
  evolution?: Omit<EvolutionDeps, 'openSession' | 'sessions' | 'sessionOutput' | 'closeSession'>;
  /** Verificacoes extras do /api/self-check (o cerebro responde?). */
  selfCheck?: { brain?: () => Promise<void> };
  /** Memoria do Jarvis entre sessoes (sem ela, um arquivo na pasta de trabalho). */
  memory?: JarvisMemory;
  /** Manchetes ja apresentadas por voz (sem ele, um arquivo na pasta de trabalho). */
  newsHistory?: NewsHistory;
  /** Manual do app consultado pelo Jarvis (o README do projeto). */
  manualPath?: string;
}

export interface App {
  listen(): Promise<number>;
  close(): Promise<void>;
  broadcast(msg: ServerMessage): void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const STARTED_AT = Math.floor(Date.now() / 1000);

const AGENTS: SessionAgent[] = ['claude', 'codex', 'shell'];

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const size = (v: unknown, fallback: number): number =>
  Number.isInteger(v) && (v as number) > 0 && (v as number) < 1000 ? (v as number) : fallback;

const coord = (v: string | null, max: number): number | undefined => {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : undefined;
};

/** Corpo JSON pequeno (ate 16 KB, ou `max`). */
async function readJson(req: IncomingMessage, max = 16_384): Promise<unknown> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > max) throw new Error('corpo grande demais');
  }
  return JSON.parse(body || '{}');
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

export function createApp(opts: AppOptions): App {
  let port = opts.port;
  const webRoot = resolve(opts.webDir);
  const workspace = resolve(opts.workspaceDir);
  const hidden = [workspace, ...(opts.evolution ? [opts.evolution.devRoot] : [])];
  const terminals = new TerminalManager(opts.bin);
  const day = createDayService({ fetch: opts.fetch ?? fetch, city: opts.city, newsUrl: opts.newsUrl ?? NEWS_DEFAULT });
  const web = createSearchService({ fetch: opts.fetch ?? fetch, fallback: opts.webSearchFallback });
  const clients = new Set<WebSocket>();
  const memory = opts.memory ?? new JarvisMemory(join(workspace, '.jarvis-memory.json'));
  const newsHistory = opts.newsHistory ?? new NewsHistory(join(workspace, '.jarvis-news.json'));
  // Sessoes que o usuario pediu para acompanhar (aviso por voz ao terminar ou dar erro).
  const watcher = new SessionWatcher({
    sessions: () => terminals.list(),
    // A tela emulada, nao os bytes brutos: o que ja foi apagado (o "esc to interrupt") nao conta.
    output: (id) => terminals.screen(id),
    summarize: opts.voice?.watchSummary,
    quietMs: opts.voice?.watchQuietMs,
  });

  const broadcast = (msg: ServerMessage): void => {
    const data = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
  };
  terminals.on('output', (id: string, data: string) => broadcast({ type: 'output', id, data }));
  terminals.on('exit', (id: string, code: number) => broadcast({ type: 'exit', id, code }));
  terminals.on('sessions', () => broadcast({ type: 'sessions', sessions: terminals.list() }));

  // Voz do usuario: o worker calcula os vetores (cadastro, recuperacao e ativacao).
  let embedSeq = 0;
  function workerEmbed(input: { audio: string[]; trim?: boolean } | { clip: number }): Promise<(number[] | null)[]> {
    const worker = opts.voice!.worker;
    const id = ++embedSeq;
    return worker.ensureReady().then(
      () =>
        new Promise((ok, fail) => {
          // Na primeira vez o modelo e baixado (~26 MB).
          const timer = setTimeout(() => done(() => fail(new Error('o reconhecimento de voz não respondeu'))), 120_000);
          const listener = (e: WorkerEvent) => {
            if (e.event !== 'embedding' || e.id !== id) return;
            done(() => (e.error ? fail(new Error(e.error)) : ok(e.vectors ?? [])));
          };
          const done = (then: () => void) => {
            clearTimeout(timer);
            worker.off('event', listener);
            then();
          };
          worker.on('event', listener);
          worker.command({ cmd: 'embed', id, ...input });
        }),
    );
  }
  const profileOpts = opts.voice?.profile;
  const speaker = profileOpts
    ? new SpeakerProfileStore({
        file: profileOpts.file,
        mailer: profileOpts.mailer,
        threshold: profileOpts.threshold,
        embed: (audio, o) => workerEmbed({ audio, ...(o?.trim ? { trim: true } : {}) }),
        embedClip: async (clip) => (await workerEmbed({ clip }))[0] ?? null,
        log: (line) => console.error(`[voz] ${line}`),
      })
    : undefined;

  /** Rotas da voz do usuario: ver, cadastrar/refazer, escolher o acesso (voz/senha) e recuperar a senha. */
  async function profileApi(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (!speaker) return send(res, 404, { error: 'voz desligada neste servidor' });
    if (path === '/api/voice/profile' && req.method === 'GET') return send(res, 200, speaker.view());
    if (req.method !== 'POST') return send(res, 405, { error: 'use GET ou POST' });
    let input: Record<string, unknown>;
    try {
      // 4 frases de ate 15 s em base64 (~4 MB).
      const raw = await readJson(req, 4 * 1024 * 1024);
      if (!raw || typeof raw !== 'object') throw new Error('JSON inválido');
      input = raw as Record<string, unknown>;
    } catch {
      return send(res, 400, { error: 'JSON inválido' });
    }
    const reply = (r: object) => send(res, 'error' in r ? 400 : 200, 'view' in r ? r.view : r);
    try {
      if (path === '/api/voice/profile') return reply(await speaker.enroll(input));
      if (path === '/api/voice/profile/access') return reply(speaker.setAccess(input));
      if (path === '/api/voice/profile/recover') {
        if (input.method === 'voice') return reply(await speaker.recoverByVoice(input));
        if (input.method === 'email') return reply(await speaker.sendRecoveryEmail());
        if (input.method === 'code') return reply(speaker.recoverByCode(input));
        return send(res, 400, { error: 'use method "voice", "email" ou "code"' });
      }
    } catch (err) {
      return send(res, 503, { error: `Não consegui analisar a voz agora (${String((err as Error)?.message ?? err)}).` });
    }
    send(res, 404, { error: 'rota desconhecida' });
  }

  async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (url.pathname === '/api/voice/profile' || url.pathname === '/api/voice/profile/recover' || url.pathname === '/api/voice/profile/access') return profileApi(req, res, url.pathname);
    if (url.pathname === '/api/voice/settings') {
      const store = opts.voice?.settings;
      if (!store) return send(res, 404, { error: 'voz desligada neste servidor' });
      if (req.method === 'GET') return send(res, 200, store.view());
      if (req.method !== 'PUT') return send(res, 405, { error: 'use GET ou PUT' });
      let input: unknown;
      try {
        input = await readJson(req);
      } catch {
        return send(res, 400, { error: 'JSON inválido' });
      }
      if (!input || typeof input !== 'object') return send(res, 400, { error: 'JSON inválido' });
      const result = await store.update(input);
      return 'error' in result ? send(res, 400, result) : send(res, 200, result.view);
    }
    if (url.pathname === '/api/self-check' && req.method === 'GET') {
      return send(res, 200, await selfCheck(url.searchParams.get('record') === '1', url.searchParams.get('voice') !== '0'));
    }
    if (url.pathname === '/api/jarvis/memory' && req.method === 'GET') {
      return send(res, 200, { facts: memory.facts(), conversations: memory.conversations() });
    }
    const mem = /^\/api\/jarvis\/memory\/([0-9a-f]{6})$/.exec(url.pathname);
    if (mem && req.method === 'DELETE') return send(res, 200, { removed: memory.forget({ id: mem[1] }) });
    if (req.method !== 'GET') return send(res, 405, { error: 'use GET' });
    if (url.pathname === '/api/overview') {
      return send(res, 200, await buildOverview(opts.home, { hidden, projectsDir: opts.projectsDir }));
    }
    if (url.pathname === '/api/day') {
      const lat = coord(url.searchParams.get('lat'), 90);
      const lon = coord(url.searchParams.get('lon'), 180);
      return send(res, 200, await day.day(lat !== undefined && lon !== undefined ? lat : undefined, lat !== undefined ? lon : undefined));
    }
    const m = /^\/api\/projects\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (m) {
      const detail = await projectDetail(opts.home, projectPathFromId(m[1]), await scanConversations(opts.home), hidden);
      return detail ? send(res, 200, detail) : send(res, 404, { error: 'projeto não encontrado' });
    }
    send(res, 404, { error: 'rota desconhecida' });
  }

  async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
    let file = resolve(webRoot, '.' + decodeURIComponent(pathname));
    if (file !== webRoot && !file.startsWith(webRoot + sep)) return send(res, 403, 'proibido', 'text/plain; charset=utf-8');
    if (!(await isFile(file))) file = join(webRoot, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      send(res, 404, 'Interface não construída: rode "npm ci && npm run build" em app/web.', 'text/plain; charset=utf-8');
    }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // pid e inicio: o "llm-agent ui" acha (e encerra) este servidor mesmo sem o server.json.
      if (url.pathname === '/api/health') return send(res, 200, { ok: true, app: 'llm-agent-ui', pid: process.pid, startedAt: STARTED_AT });
      if (url.pathname.startsWith('/api/')) {
        if (!originAllowed(req.headers.origin, port, opts.extraOrigins)) return send(res, 403, { error: 'origem não permitida' });
        if (!tokenMatches(bearer(req.headers.authorization), opts.token)) return send(res, 401, { error: 'token inválido' });
        return await api(req, res, url);
      }
      await serveStatic(res, url.pathname);
    } catch (err) {
      if (!res.headersSent) send(res, err instanceof URIError ? 400 : 500, { error: String(err) });
    }
  });

  async function openTask(name: unknown, cols: number, rows: number): Promise<SessionInfo> {
    if (!isTask(name)) throw new Error(`tarefa desconhecida: ${String(name)}`);
    const task = TASKS[name];
    await mkdir(workspace, { recursive: true });
    return terminals.open({ projectPath: workspace, agent: 'claude', prompt: task.prompt, title: task.title, cols, rows });
  }

  async function createProjectSession(name: unknown, cols: number, rows: number): Promise<SessionInfo> {
    if (typeof name !== 'string' || !PROJECT_NAME.test(name)) {
      throw new Error('nome de projeto inválido: use letras, números, ".", "_" ou "-"');
    }
    const projects = await listProjects(opts.home, await scanConversations(opts.home), hidden);
    const path = join(projectsBase(opts.home, projects, opts.projectsDir), name);
    if (await exists(path)) throw new Error(`já existe uma pasta em ${path}`);
    await mkdir(path, { recursive: true });
    return terminals.open({ projectPath: path, agent: 'claude', prompt: projectPrompt(path), title: 'projeto novo', cols, rows });
  }

  // Ferramentas do Jarvis (etapa 3b): as mesmas acoes da interface, sem shell livre.
  let voiceUi: ((m: VoiceServerMessage) => void) | undefined;
  const jarvis: JarvisContext = {
    projects: async () => listProjects(opts.home, await scanConversations(opts.home), hidden),
    projectDetail: async (path) => projectDetail(opts.home, path, await scanConversations(opts.home), hidden),
    gitLog: (path) => gitLines(path, ['log', '-5', '--format=%h %ar %s']),
    gitChanges: (path) => gitLines(path, ['status', '--porcelain']),
    sessions: () => terminals.list(),
    sessionOutput: (id) => terminals.screen(id),
    openSession: (projectPath, agent, prompt) =>
      terminals.open({
        projectPath,
        agent,
        prompt,
        title: prompt ? shortTitle(prompt) : agent === 'shell' ? 'shell' : 'nova conversa',
        cols: 120,
        rows: 30,
      }),
    runTask: (task) => openTask(task, 120, 30),
    createProject: (name) => createProjectSession(name, 120, 30),
    ui: (command) => voiceUi?.({ type: 'ui', command }),
    manual: async () => (opts.manualPath ? readFile(opts.manualPath, 'utf8').catch(() => '') : ''),
    sendToSession: (id, text) => {
      if (!terminals.list().some((s) => s.id === id && s.alive)) return false;
      terminals.write(id, text);
      // Enter separado do texto: os agentes tratam texto + Enter juntos como colagem.
      setTimeout(() => terminals.write(id, '\r'), 80);
      return true;
    },
    relay: (target) => voiceSession?.setRelay(target),
    day: () => day.day(voiceCoords.lat, voiceCoords.lon),
    webSearch: (q) => web.search(q),
    now: () => new Date(),
    closeSession: (id) => terminals.close(id),
    endConversation: () => voiceSession?.endConversation(),
    userTurn: () => voiceSession?.userTurns ?? 0,
    memory,
    newsHistory,
    watcher,
  };

  // Funcionalidades novas para o proprio Jarvis (definidas e aprovadas por voz).
  const evolution = opts.evolution
    ? new EvolutionManager({
        ...opts.evolution,
        openSession: (dir, prompt, title) => terminals.open({ projectPath: dir, agent: 'claude', prompt, title, cols: 120, rows: 30 }),
        sessions: () => terminals.list(),
        sessionOutput: (id) => terminals.screen(id),
        closeSession: (id) => terminals.close(id),
      })
    : undefined;
  // Avisos que esperam o Jarvis ficar livre (ele nao interrompe uma conversa).
  const notices: string[] = [];
  if (evolution) {
    jarvis.evolution = {
      draft: (t, spec) => evolution.draft(t, spec),
      summarize: (summary, turn) => evolution.summarize(summary, turn),
      start: (turn) => evolution.start(turn),
      status: () => evolution.status(),
      apply: (o) => evolution.apply(o, (text) => notices.push(text)),
      discard: () => evolution.discard(),
    };
  }
  let delivering = false;
  /** Fala o que estiver pendente: avisos, o resultado de uma atualizacao, "terminei". */
  async function deliverNotices(): Promise<void> {
    if (delivering) return;
    delivering = true;
    try {
      // Avisos pedidos (sessao acompanhada, evolucao): saem tambem no meio da conversa, num silencio.
      const say = (text: string) => voiceSession?.announce(text, { whileListening: true }) ?? false;
      notices.push(...(await watcher.check()));
      while (notices.length && say(notices[0])) notices.shift();
      const file = opts.evolution?.updateFile;
      const u = file ? readUpdate(file) : null;
      const outcome = updateOutcome(u);
      if (file && u && outcome !== 'wait' && say(updateNotice(u))) {
        markUpdateAnnounced(file);
        // 'failed': o codigo novo ficou no ar (ninguem voltou atras), entao a evolucao termina.
        if (outcome === 'rolledBack') evolution?.rolledBack(u.error ?? 'a verificação falhou');
        else evolution?.finish();
      }
      const done = await evolution?.poll();
      if (done && say(done)) evolution!.markNotified();
    } finally {
      delivering = false;
    }
  }
  const noticeTimer = setInterval(() => void deliverNotices().catch(() => {}), 15_000);

  /** O worker sobe e sintetiza uma fala curta. */
  async function voiceCheck(worker: VoiceWorker): Promise<void> {
    await worker.ensureReady();
    const id = 1e9 + Math.floor(Math.random() * 1e6);
    await new Promise<void>((ok, fail) => {
      const listener = (e: { event: string; id?: number; last?: boolean; message?: string }) => {
        if (e.id !== id) return;
        if (e.event === 'audio' && e.last) done(ok);
        else if (e.event === 'speak-error') done(() => fail(new Error(e.message)));
      };
      const done = (then: () => void) => {
        worker.off('event', listener);
        then();
      };
      worker.on('event', listener);
      worker.command({ cmd: 'speak', id, text: 'ok' });
    });
  }

  /** Verificacoes depois de uma atualizacao (chamadas pelo app/restart.sh). `voice` falso pula a voz (ainda nao instalada). */
  async function selfCheck(record: boolean, voice = true): Promise<{ ok: boolean; checks: SelfCheck[] }> {
    const checks: SelfCheck[] = [];
    const check = async (name: string, essential: boolean, fn: () => Promise<unknown>, timeoutMs: number) => {
      const started = Date.now();
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          fn(),
          new Promise((_, fail) => {
            timer = setTimeout(() => fail(new Error(`sem resposta em ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
          }),
        ]);
        checks.push({ name, ok: true, ms: Date.now() - started, essential });
      } catch (err) {
        checks.push({ name, ok: false, ms: Date.now() - started, essential, error: String((err as Error)?.message ?? err).slice(0, 200) });
      } finally {
        clearTimeout(timer);
      }
    };
    // Logo depois do reinicio a primeira varredura dos projetos e lenta (cache de disco frio).
    await check('catalogo', true, () => buildOverview(opts.home, { hidden, projectsDir: opts.projectsDir }), 90_000);
    await check('ferramentas', true, async () => {
      createJarvisServer(jarvis);
      const tools = Object.keys(jarvisHandlers(jarvis)).sort().join();
      if (tools !== COMMANDS.map((c) => c.name).sort().join()) throw new Error('ferramentas e comandos de voz não batem');
    }, 5_000);
    await check('web', true, async () => {
      if (!(await isFile(join(webRoot, 'index.html')))) throw new Error('interface não compilada');
    }, 2_000);
    if (opts.voice && voice) await check('voz', true, () => voiceCheck(opts.voice!.worker), 180_000);
    if (opts.selfCheck?.brain) await check('cerebro', false, opts.selfCheck.brain, 45_000);
    const ok = checks.every((c) => c.ok || !c.essential);
    const file = opts.evolution?.updateFile;
    const u = file && record ? readUpdate(file) : null;
    if (file && u && !u.announced) await writeFile(file, JSON.stringify({ ...u, checks, checkedAt: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 });
    return { ok, checks };
  }

  // Conversa direta (ditado): digita, envia (Enter) e apaga no terminal da sessao.
  const isAlive = (id: string) => terminals.list().some((s) => s.id === id && s.alive);
  const relayIo = {
    type: (id: string, text: string) => isAlive(id) && (terminals.write(id, text), true),
    submit: (id: string) => isAlive(id) && (terminals.write(id, '\r'), true),
    erase: (id: string, chars: number) => isAlive(id) && (terminals.write(id, '\x7f'.repeat(chars)), true),
  };
  /** Localizacao enviada pelo navegador ao ligar a voz (para clima por voz e saudacao). */
  let voiceCoords: { lat?: number; lon?: number } = {};
  const voiceBrain = opts.voice ? (typeof opts.voice.brain === 'function' ? opts.voice.brain(jarvis) : opts.voice.brain) : undefined;

  async function handle(ws: WebSocket, msg: ClientMessage): Promise<void> {
    const reply = (m: ServerMessage) => ws.send(JSON.stringify(m));
    switch (msg.type) {
      case 'open': {
        if (!AGENTS.includes(msg.agent)) return reply({ type: 'error', message: 'agente inválido' });
        const convs = await scanConversations(opts.home);
        const projects = await listProjects(opts.home, convs, hidden);
        const isWorkspace = msg.projectPath === workspace && msg.resume === undefined;
        if (!isWorkspace && !projects.some((p) => p.path === msg.projectPath)) {
          return reply({ type: 'error', message: `projeto desconhecido: ${msg.projectPath}` });
        }
        let title = msg.agent === 'shell' ? 'shell' : 'nova conversa';
        if (msg.resume !== undefined) {
          const conv = convs.find((c) => c.id === msg.resume && c.agent === msg.agent && c.cwd === msg.projectPath);
          if (!conv) return reply({ type: 'error', message: `conversa desconhecida: ${msg.resume}` });
          title = conv.title;
        }
        if (isWorkspace) await mkdir(workspace, { recursive: true });
        const session = terminals.open({
          projectPath: msg.projectPath,
          agent: msg.agent,
          resume: msg.resume,
          title,
          cols: size(msg.cols, 80),
          rows: size(msg.rows, 24),
        });
        return reply({ type: 'opened', session });
      }
      case 'task':
        return reply({ type: 'opened', session: await openTask(msg.task, size(msg.cols, 80), size(msg.rows, 24)) });
      case 'create-project':
        return reply({ type: 'opened', session: await createProjectSession(msg.name, size(msg.cols, 80), size(msg.rows, 24)) });
      case 'attach': {
        const data = terminals.history(msg.id);
        if (data !== null) reply({ type: 'history', id: msg.id, data });
        return;
      }
      case 'input':
        return terminals.write(msg.id, String(msg.data ?? ''));
      case 'resize':
        return terminals.resize(msg.id, size(msg.cols, 80), size(msg.rows, 24));
      case 'close':
        return terminals.close(msg.id);
    }
  }

  // Uma conversa de voz por vez: uma conexao nova substitui a anterior.
  let voiceSocket: WebSocket | undefined;
  let voiceSession: VoiceSession | undefined;
  function openVoice(ws: WebSocket): void {
    const voice = opts.voice!;
    voiceSession?.stop();
    voiceSocket?.close(4000, 'substituída por outra conexão');
    const sendVoice = (m: VoiceServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
      // Resumo para outras janelas (a bolinha flutuante do app desktop): estado e fala do Jarvis.
      if (m.type === 'state') broadcast({ type: 'voice', state: m.state });
      else if (m.type === 'caption' && m.who === 'jarvis') broadcast({ type: 'voice', state: voiceSession?.state ?? 'speaking', text: m.text });
    };
    voiceUi = sendVoice;
    // Coordenadas do navegador (mensagem "start"), para o clima da saudacao.
    let coords: { lat?: number; lon?: number } = {};
    let announcer: Announcer | undefined;
    const session: VoiceSession = new VoiceSession(
      voice.worker,
      voiceBrain!,
      sendVoice,
      Date.now,
      (line) => console.error(`[voz] ${line}`),
      {
        bargeIn: voice.bargeIn ?? true,
        greetings: voice.greetings,
        relay: relayIo,
        judge: voice.judge,
        speaker,
        // Pausas salvas nas configuracoes (sem elas, os padroes).
        pauses: voice.settings ? () => pauseConfig(voice.settings!.get().pauses) : undefined,
        conversation: { start: () => memory.startConversation(), request: (t) => memory.noteRequest(t), end: () => memory.endConversation() },
        // Nomes que o whisper deve acertar: projetos e os agentes.
        vocabulary: async () => ['Jarvis', 'Claude', 'Codex', ...(await jarvis.projects()).map((p) => p.name)],
        onReady: () => {
          // Voltou (talvez de uma atualizacao): fala o que estiver pendente.
          setTimeout(() => void deliverNotices().catch(() => {}), 1500);
          if (!voice.announce || announcer) return;
          announcer = new Announcer({
            day: () => day.day(coords.lat, coords.lon),
            say: (text) => session.announce(text),
            newsEveryMs: voice.announce.newsEveryMin * 60e3,
            history: newsHistory,
          });
          void announcer.start();
        },
      },
    );
    voiceSocket = ws;
    voiceSession = session;
    ws.on('message', (raw, isBinary) => {
      if (isBinary) return session.audio(Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer));
      let msg: VoiceClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'start') {
        const ok = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max ? v : undefined);
        coords = { lat: ok(msg.lat, 90), lon: ok(msg.lon, 180) };
        voiceCoords = coords;
      }
      session.client(msg);
    });
    ws.on('close', () => {
      announcer?.stop();
      session.stop();
      if (voiceSession === session) {
        voiceSession = undefined;
        voiceSocket = undefined;
      }
    });
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const allowed =
      (url.pathname === '/ws' || (url.pathname === '/ws/voice' && opts.voice)) &&
      originAllowed(req.headers.origin, port, opts.extraOrigins) &&
      tokenMatches(url.searchParams.get('token'), opts.token);
    if (!allowed) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (url.pathname === '/ws/voice') {
      wss.handleUpgrade(req, socket, head, (ws) => openVoice(ws));
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.send(JSON.stringify({ type: 'sessions', sessions: terminals.list() } satisfies ServerMessage));
      ws.on('message', (raw) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        handle(ws, msg).catch((err) => ws.send(JSON.stringify({ type: 'error', message: String(err?.message ?? err) })));
      });
    });
  });

  return {
    listen: () =>
      new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(opts.port, '127.0.0.1', () => {
          port = (server.address() as AddressInfo).port;
          ok(port);
        });
      }),
    close: async () => {
      clearInterval(noticeTimer);
      terminals.closeAll();
      voiceSession?.stop();
      voiceSocket?.terminate();
      for (const c of clients) c.terminate();
      wss.close();
      // Conexoes HTTP abertas (keep-alive do app) nao podem segurar o encerramento.
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
    broadcast,
  };
}
