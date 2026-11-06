import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startApp } from './app.ts';
import { tempHome } from './helpers.ts';
import { AutoNewsSetting } from '../src/voice/news-auto.ts';

test('noticias automaticas: ligadas por padrao, a escolha persiste (0600)', () => {
  const file = join(tempHome(), 'ui', 'jarvis-news-auto.json');
  const s = new AutoNewsSetting(file);
  assert.equal(s.enabled(), true);
  s.set(false);
  assert.equal(s.enabled(), false);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(new AutoNewsSetting(file).enabled(), false, 'vale nas proximas aberturas');
  s.set(true);
  assert.equal(new AutoNewsSetting(file).enabled(), true);
  writeFileSync(file, 'nao e json');
  assert.equal(new AutoNewsSetting(file).enabled(), true, 'arquivo estragado volta ao padrao');
});

test('/api/news/auto: GET e PUT com token, valida e persiste', async () => {
  const home = tempHome();
  const file = join(home, 'ui', 'jarvis-news-auto.json');
  const { app, base } = await startApp(home, { autoNews: new AutoNewsSetting(file) });
  const url = `${base}/api/news/auto`;
  const auth = { authorization: 'Bearer tok' };
  const put = (body: string, headers: Record<string, string> = auth) => fetch(url, { method: 'PUT', headers, body });
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.deepEqual(await (await fetch(url, { headers: auth })).json(), { enabled: true });
    assert.equal((await put('{"enabled":false}', {})).status, 401);
    assert.equal((await put('{"enabled":false}', { ...auth, origin: 'http://evil.com' })).status, 403);
    assert.equal((await put('nao e json')).status, 400);
    assert.equal((await put('{"enabled":"nao"}')).status, 400);
    assert.equal((await put('null')).status, 400);
    assert.equal((await fetch(url, { method: 'DELETE', headers: auth })).status, 405);
    assert.deepEqual(await (await fetch(url, { headers: auth })).json(), { enabled: true }, 'pedidos invalidos nao mudam nada');

    const off = await put('{"enabled":false}');
    assert.equal(off.status, 200);
    assert.deepEqual(await off.json(), { enabled: false });
    assert.deepEqual(await (await fetch(url, { headers: auth })).json(), { enabled: false });
    assert.equal(new AutoNewsSetting(file).enabled(), false);
  } finally {
    await app.close();
  }
});
