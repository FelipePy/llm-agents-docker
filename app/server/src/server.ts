import { createServer, type ServerResponse } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, SessionAgent } from './types.ts';
import { bearer, originAllowed, tokenMatches } from './auth.ts';
import { buildOverview, listProjects, projectDetail, projectPathFromId, projectsBase } from './catalog.ts';
import { scanConversations } from './conversations.ts';
import { NEWS_DEFAULT, createDayService } from './day.ts';
import { isFile } from './files.ts';
import { PROJECT_NAME, TASKS, isTask, projectPrompt } from './tasks.ts';
import { TerminalManager } from './terminals.ts';
import type { Brain } from './voice/brain.ts';
import type { JarvisContext } from './voice/tools.ts';
import { Announcer } from './voice/announcer.ts';
import { shortTitle } from './conversations.ts';
import { gitLines } from './catalog.ts';
import { VoiceSession, type VoiceWorker } from './voice/session.ts';
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
  /** Voz (etapa 3a): sem ela, /ws/voice responde 404. */
  voice?: {
    worker: VoiceWorker;
    brain: Brain | ((ctx: JarvisContext) => Brain);
    bargeIn?: boolean;
    greetings?: string[];
    /** Falas espontaneas (inicio, periodo do dia, notícias); minutos entre rodadas de notícias. */
    announce?: { newsEveryMin: number };
  };
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
  const hidden = [workspace];
  const terminals = new TerminalManager(opts.bin);
  const day = createDayService({ fetch: opts.fetch ?? fetch, city: opts.city, newsUrl: opts.newsUrl ?? NEWS_DEFAULT });
  const clients = new Set<WebSocket>();

  const broadcast = (msg: ServerMessage): void => {
    const data = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
  };
  terminals.on('output', (id: string, data: string) => broadcast({ type: 'output', id, data }));
  terminals.on('exit', (id: string, code: number) => broadcast({ type: 'exit', id, code }));
  terminals.on('sessions', () => broadcast({ type: 'sessions', sessions: terminals.list() }));

  async function api(res: ServerResponse, url: URL): Promise<void> {
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
      if (url.pathname === '/api/health') return send(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/')) {
        if (!originAllowed(req.headers.origin, port, opts.extraOrigins)) return send(res, 403, { error: 'origem não permitida' });
        if (!tokenMatches(bearer(req.headers.authorization), opts.token)) return send(res, 401, { error: 'token inválido' });
        return await api(res, url);
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
    sessionOutput: (id) => terminals.history(id),
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
  };
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
        relaySend: (id, text) => jarvis.sendToSession(id, text),
        // Nomes que o whisper deve acertar: projetos e os agentes.
        vocabulary: async () => ['Jarvis', 'Claude', 'Codex', ...(await jarvis.projects()).map((p) => p.name)],
        onReady: () => {
          if (!voice.announce || announcer) return;
          announcer = new Announcer({
            day: () => day.day(coords.lat, coords.lon),
            say: (text) => session.announce(text),
            newsEveryMs: voice.announce.newsEveryMin * 60e3,
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
      terminals.closeAll();
      voiceSession?.stop();
      voiceSocket?.terminate();
      for (const c of clients) c.terminate();
      wss.close();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
    broadcast,
  };
}
