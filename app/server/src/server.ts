import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { ServerMessage } from './types.ts';
import { bearer, originAllowed, tokenMatches } from './auth.ts';
import { buildOverview, projectDetail, projectPathFromId } from './catalog.ts';
import { scanConversations } from './conversations.ts';
import { isFile } from './files.ts';

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

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

export function createApp(opts: AppOptions): App {
  let port = opts.port;
  const webRoot = resolve(opts.webDir);

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

  return {
    listen: () =>
      new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(opts.port, '127.0.0.1', () => {
          port = (server.address() as AddressInfo).port;
          ok(port);
        });
      }),
    close: () => new Promise((ok) => server.close(() => ok())),
    broadcast: () => {},
  };
}
