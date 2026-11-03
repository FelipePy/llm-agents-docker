import { request } from 'node:http';
import { join } from 'node:path';
import { createApp, type AppOptions } from '../src/server.ts';

export function httpGet(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body }));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function startApp(home: string, extra: Partial<AppOptions> = {}) {
  const app = createApp({
    home,
    port: 0,
    token: 'tok',
    webDir: join(home, 'web'),
    bin: '/bin/false',
    extraOrigins: ['http://dev:5173'],
    workspaceDir: join(home, 'workspace'),
    ...extra,
  });
  const port = await app.listen();
  return { app, port, base: `http://127.0.0.1:${port}` };
}
