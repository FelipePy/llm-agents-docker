import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, SessionAgent } from './types.ts';
import { bearer, originAllowed, tokenMatches } from './auth.ts';
import { buildOverview, listProjects, projectDetail, projectPathFromId } from './catalog.ts';
import { scanConversations } from './conversations.ts';
import { isFile } from './files.ts';
import { TerminalManager } from './terminals.ts';

export interface AppOptions {
  home: string;
  /** 0 escolhe uma porta livre (testes). */
  port: number;
  token: string;
  webDir: string;
  /** Caminho do llm-agent executado pelos terminais. */
  bin: string;
  extraOrigins: string[];
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

export function createApp(opts: AppOptions): App {
  let port = opts.port;
  const webRoot = resolve(opts.webDir);
  const terminals = new TerminalManager(opts.bin);
  const clients = new Set<WebSocket>();

  const broadcast = (msg: ServerMessage): void => {
    const data = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
  };
  terminals.on('output', (id: string, data: string) => broadcast({ type: 'output', id, data }));
  terminals.on('exit', (id: string, code: number) => broadcast({ type: 'exit', id, code }));
  terminals.on('sessions', () => broadcast({ type: 'sessions', sessions: terminals.list() }));

  async function api(res: ServerResponse, pathname: string): Promise<void> {
    if (pathname === '/api/overview') return send(res, 200, await buildOverview(opts.home));
    const m = /^\/api\/projects\/([A-Za-z0-9_-]+)$/.exec(pathname);
    if (m) {
      const detail = await projectDetail(opts.home, projectPathFromId(m[1]), await scanConversations(opts.home));
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
        return await api(res, url.pathname);
      }
      await serveStatic(res, url.pathname);
    } catch (err) {
      if (!res.headersSent) send(res, err instanceof URIError ? 400 : 500, { error: String(err) });
    }
  });

  async function handle(ws: WebSocket, msg: ClientMessage): Promise<void> {
    const reply = (m: ServerMessage) => ws.send(JSON.stringify(m));
    switch (msg.type) {
      case 'open': {
        if (!AGENTS.includes(msg.agent)) return reply({ type: 'error', message: 'agente inválido' });
        const convs = await scanConversations(opts.home);
        const projects = await listProjects(opts.home, convs);
        if (!projects.some((p) => p.path === msg.projectPath)) {
          return reply({ type: 'error', message: `projeto desconhecido: ${msg.projectPath}` });
        }
        let title = msg.agent === 'shell' ? 'shell' : 'nova conversa';
        if (msg.resume !== undefined) {
          const conv = convs.find((c) => c.id === msg.resume && c.agent === msg.agent && c.cwd === msg.projectPath);
          if (!conv) return reply({ type: 'error', message: `conversa desconhecida: ${msg.resume}` });
          title = conv.title;
        }
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

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const allowed =
      url.pathname === '/ws' &&
      originAllowed(req.headers.origin, port, opts.extraOrigins) &&
      tokenMatches(url.searchParams.get('token'), opts.token);
    if (!allowed) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
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
      for (const c of clients) c.terminate();
      wss.close();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
    broadcast,
  };
}
