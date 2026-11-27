import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { loadOrCreateToken, originAllowed, tokenMatches } from '../src/auth.ts';
import { projectId } from '../src/catalog.ts';
import { httpGet, startApp } from './app.ts';
import { fakeFetch } from './fakes.ts';
import { buildFixture } from './fixture.ts';
import { tempHome, write } from './helpers.ts';

const auth = { authorization: 'Bearer tok' };

test('loadOrCreateToken cria token 600 e reaproveita', () => {
  const dir = join(tempHome(), 'state');
  const t = loadOrCreateToken(dir);
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(statSync(join(dir, 'token')).mode & 0o777, 0o600);
  assert.equal(loadOrCreateToken(dir), t);
});

test('tokenMatches e originAllowed', () => {
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abd', 'abc'), false);
  assert.equal(tokenMatches(null, 'abc'), false);
  assert.equal(originAllowed(undefined, 7777, []), true);
  assert.equal(originAllowed('http://127.0.0.1:7777', 7777, []), true);
  assert.equal(originAllowed('http://localhost:7777', 7777, []), true);
  assert.equal(originAllowed('http://evil.com', 7777, []), false);
  assert.equal(originAllowed('http://tauri.localhost', 7777, []), true, 'bolinha do app desktop (Windows)');
  assert.equal(originAllowed('tauri://localhost', 7777, []), true, 'bolinha do app desktop (Linux)');
  assert.equal(originAllowed('http://dev:5173', 7777, ['http://dev:5173']), true);
});

test('API exige token e Origin permitido', async () => {
  const fx = buildFixture();
  const { app, base, port } = await startApp(fx.home);
  try {
    const health = JSON.parse((await httpGet(`${base}/api/health`)).body);
    assert.deepEqual([health.ok, health.app, health.pid], [true, 'llm-agent-ui', process.pid], 'health diz quem e o servidor');
    assert.equal((await httpGet(`${base}/api/overview`)).status, 401);
    assert.equal((await httpGet(`${base}/api/overview`, { authorization: 'Bearer errado' })).status, 401);
    assert.equal((await httpGet(`${base}/api/overview`, { ...auth, origin: 'http://evil.com' })).status, 403);
    assert.equal((await httpGet(`${base}/api/overview`, { ...auth, origin: `http://127.0.0.1:${port}` })).status, 200);
    assert.equal((await httpGet(`${base}/api/overview`, { ...auth, origin: 'http://dev:5173' })).status, 200);
    const o = JSON.parse((await httpGet(`${base}/api/overview`, auth)).body);
    assert.equal(o.projects[0].name, 'meu-app');
    assert.equal(o.conversations.length, 3);
    assert.equal(o.projectsDir, join(fx.home, 'dev'));
  } finally {
    await app.close();
  }
});

test('detalhe do projeto e 404 para projeto desconhecido', async () => {
  const fx = buildFixture();
  const { app, base } = await startApp(fx.home);
  try {
    const ok = await httpGet(`${base}/api/projects/${projectId(fx.p1)}`, auth);
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).conversationList.length, 3);
    assert.equal((await httpGet(`${base}/api/projects/${projectId(fx.p2)}`, auth)).status, 404);
    assert.equal((await httpGet(`${base}/api/nada`, auth)).status, 404);
  } finally {
    await app.close();
  }
});

test('/api/day devolve clima e noticias', async () => {
  const { app, base } = await startApp(tempHome(), { fetch: fakeFetch().impl, newsUrl: 'https://news.example/rss' });
  try {
    assert.equal((await httpGet(`${base}/api/day?lat=1&lon=2`)).status, 401);
    const d = JSON.parse((await httpGet(`${base}/api/day?lat=1&lon=2`, auth)).body);
    assert.equal(d.weather.temperature, 25);
    assert.equal(d.news.length, 2);
    const bad = JSON.parse((await httpGet(`${base}/api/day?lat=999&lon=2`, auth)).body);
    assert.equal(bad.weather, null, 'coordenada invalida conta como ausente');
  } finally {
    await app.close();
  }
});

test('arquivos estaticos, fallback para index.html e bloqueio de ../', async () => {
  const home = tempHome();
  write(join(home, 'web', 'index.html'), 'INDEX');
  write(join(home, 'web', 'app.js'), 'JS');
  write(join(home, 'secreto.txt'), 'SEGREDO');
  const { app, base } = await startApp(home);
  try {
    const js = await httpGet(`${base}/app.js`);
    assert.equal(js.body, 'JS');
    assert.match(js.type, /javascript/);
    assert.equal((await httpGet(`${base}/projetos/qualquer`)).body, 'INDEX');
    const evil = await httpGet(`${base}/..%2fsecreto.txt`);
    assert.equal(evil.status, 403);
    assert.notEqual(evil.body, 'SEGREDO');
  } finally {
    await app.close();
  }
});

test('sem build da UI, responde 404 com instrucao', async () => {
  const { app, base } = await startApp(tempHome());
  try {
    const r = await httpGet(`${base}/`);
    assert.equal(r.status, 404);
    assert.match(r.body, /npm run build/);
  } finally {
    await app.close();
  }
});

test('/api/remote: estado, ligar/desligar e a origem do celular aceita', async () => {
  const calls: boolean[] = [];
  let host: string | null = null;
  const remote = {
    origins: () => (host ? [`https://${host}`] : []),
    status: async () => {
      host = 'pc.tail1.ts.net';
      return { installed: true, running: true, host, https: true, serving: calls.at(-1) ?? false, link: null, problem: null };
    },
    set: async (on: boolean) => {
      if (on && calls.includes(true)) throw new Error('já ligado');
      calls.push(on);
      return remote.status();
    },
  };
  const { app, base } = await startApp(tempHome(), { remote });
  try {
    const phone = { ...auth, origin: 'https://pc.tail1.ts.net' };
    assert.equal((await httpGet(`${base}/api/remote`, phone)).status, 403);
    const got = await httpGet(`${base}/api/remote`, auth);
    assert.equal(got.status, 200);
    assert.equal(JSON.parse(got.body).host, 'pc.tail1.ts.net');
    assert.equal((await httpGet(`${base}/api/remote`, phone)).status, 200);
    const put = (body: unknown) =>
      fetch(`${base}/api/remote`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await put({ on: 'sim' })).status, 400);
    const on = await put({ on: true });
    assert.equal(on.status, 200);
    assert.equal((await on.json()).serving, true);
    const again = await put({ on: true });
    assert.equal(again.status, 400);
    assert.equal((await again.json()).error, 'já ligado');
    assert.deepEqual(calls, [true]);
  } finally {
    await app.close();
  }
});

test('/api/remote: 404 sem o acesso pelo celular', async () => {
  const { app, base } = await startApp(tempHome());
  try {
    assert.equal((await httpGet(`${base}/api/remote`, auth)).status, 404);
  } finally {
    await app.close();
  }
});
