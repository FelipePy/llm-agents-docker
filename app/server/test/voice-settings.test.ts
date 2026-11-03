import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { startApp } from './app.ts';
import { tempHome } from './helpers.ts';
import { VoiceSettingsStore, keyHint, sttConfig, type VoiceSettings } from '../src/voice/settings.ts';
import type { VoiceWorker } from '../src/voice/session.ts';

const KEY = 'gsk_abcdefghijklmnopqrstuvwxyz0123';

/** Groq falso: aceita so a chave KEY. */
function groqFetch(calls: string[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    calls.push(`${url} ${auth}`);
    return new Response('{}', { status: auth === `Bearer ${KEY}` ? 200 : 401 });
  }) as typeof fetch;
}

test('VoiceSettingsStore valida a chave no Groq, salva 0600 e nunca devolve a chave', async () => {
  const file = join(tempHome(), 'ui', 'voice.json');
  const calls: string[] = [];
  const changes: VoiceSettings[] = [];
  const store = new VoiceSettingsStore(file, { fetch: groqFetch(calls), onChange: (s) => changes.push(s) });
  assert.deepEqual(store.view(), { stt: 'local', groqModel: 'whisper-large-v3-turbo', groqKeyHint: null });

  assert.match(JSON.stringify(await store.update({ stt: 'groq' })), /Cole a chave/);
  assert.match(JSON.stringify(await store.update({ stt: 'groq', groqKey: 'gsk_errada_mas_comprida_0000' })), /recusou a chave/);
  assert.match(JSON.stringify(await store.update({ groqKey: 'curta' })), /não parece/);
  assert.equal(changes.length, 0, 'erros nao mudam nada');

  const ok = await store.update({ stt: 'groq', groqKey: `  ${KEY} `, groqModel: 'whisper-large-v3' });
  assert.deepEqual(ok, { view: { stt: 'groq', groqModel: 'whisper-large-v3', groqKeyHint: 'gsk_…0123' } });
  assert.ok(!JSON.stringify(ok).includes(KEY));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).groqKey, KEY);
  assert.deepEqual(sttConfig(changes.at(-1)!), { provider: 'groq', key: KEY, model: 'whisper-large-v3' });

  // Mesma chave de novo: nao confere outra vez. Recarrega do arquivo.
  const before = calls.length;
  await store.update({ groqKey: KEY, stt: 'local' });
  assert.equal(calls.length, before);
  const again = new VoiceSettingsStore(file, { fetch: groqFetch() });
  assert.deepEqual(again.view(), { stt: 'local', groqModel: 'whisper-large-v3', groqKeyHint: 'gsk_…0123' });
  assert.deepEqual(sttConfig(again.get()), { provider: 'local' });

  // "" apaga a chave.
  assert.deepEqual(await again.update({ groqKey: '' }), { view: { stt: 'local', groqModel: 'whisper-large-v3', groqKeyHint: null } });
  assert.equal(keyHint(''), null);
});

test('checkGroqKey: sem internet vira mensagem clara', async () => {
  const store = new VoiceSettingsStore(join(tempHome(), 'v.json'), {
    fetch: (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch,
  });
  assert.match(JSON.stringify(await store.update({ groqKey: KEY })), /Não consegui falar com o Groq/);
});

function put(url: string, body: string, headers: Record<string, string>) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(url, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('/api/voice/settings: GET e PUT com token', async () => {
  const worker = Object.assign(new EventEmitter(), {
    async ensureReady() {},
    command() {},
    sendAudio() {},
  }) as unknown as VoiceWorker;
  const settings = new VoiceSettingsStore(join(tempHome(), 'v.json'), { fetch: groqFetch() });
  const { app, base } = await startApp(tempHome(), { voice: { worker, brain: { async *reply() {} }, settings } });
  try {
    const auth = { authorization: 'Bearer tok' };
    const get = await fetch(`${base}/api/voice/settings`, { headers: auth });
    assert.deepEqual(await get.json(), { stt: 'local', groqModel: 'whisper-large-v3-turbo', groqKeyHint: null });
    assert.equal((await put(`${base}/api/voice/settings`, '{"stt":"groq"}', {})).status, 401);
    assert.equal((await put(`${base}/api/voice/settings`, '{"stt":"groq"}', { ...auth, origin: 'http://evil.com' })).status, 403);
    assert.equal((await put(`${base}/api/voice/settings`, 'nao e json', auth)).status, 400);
    const bad = await put(`${base}/api/voice/settings`, '{"stt":"groq"}', auth);
    assert.equal(bad.status, 400);
    assert.match(bad.body, /Cole a chave/);
    const ok = await put(`${base}/api/voice/settings`, JSON.stringify({ stt: 'groq', groqKey: KEY }), auth);
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body), { stt: 'groq', groqModel: 'whisper-large-v3-turbo', groqKeyHint: 'gsk_…0123' });
    assert.equal((await put(`${base}/api/overview`, '{}', auth)).status, 405);
  } finally {
    await app.close();
  }
});
