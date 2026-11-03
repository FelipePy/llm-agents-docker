import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { startApp } from './app.ts';
import { tempHome } from './helpers.ts';
import { DEFAULT_PAUSES, VoiceSettingsStore, keyHint, pauseConfig, sttConfig, type VoiceSettings } from '../src/voice/settings.ts';
import type { VoiceWorker } from '../src/voice/session.ts';

const KEY = 'gsk_abcdefghijklmnopqrstuvwxyz0123';
/** Pausas padrao, como a tela as ve. */
const P = { pauses: DEFAULT_PAUSES, pauseDefaults: DEFAULT_PAUSES };

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
  assert.deepEqual(store.view(), { stt: 'local', groqModel: 'whisper-large-v3-turbo', groqKeyHint: null, ...P });

  assert.match(JSON.stringify(await store.update({ stt: 'groq' })), /Cole a chave/);
  assert.match(JSON.stringify(await store.update({ stt: 'groq', groqKey: 'gsk_errada_mas_comprida_0000' })), /recusou a chave/);
  assert.match(JSON.stringify(await store.update({ groqKey: 'curta' })), /não parece/);
  assert.equal(changes.length, 0, 'erros nao mudam nada');

  const ok = await store.update({ stt: 'groq', groqKey: `  ${KEY} `, groqModel: 'whisper-large-v3' });
  assert.deepEqual(ok, { view: { stt: 'groq', groqModel: 'whisper-large-v3', groqKeyHint: 'gsk_…0123', ...P } });
  assert.ok(!JSON.stringify(ok).includes(KEY));
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).groqKey, KEY);
  assert.deepEqual(sttConfig(changes.at(-1)!), { provider: 'groq', key: KEY, model: 'whisper-large-v3' });

  // Mesma chave de novo: nao confere outra vez. Recarrega do arquivo.
  const before = calls.length;
  await store.update({ groqKey: KEY, stt: 'local' });
  assert.equal(calls.length, before);
  const again = new VoiceSettingsStore(file, { fetch: groqFetch() });
  assert.deepEqual(again.view(), { stt: 'local', groqModel: 'whisper-large-v3', groqKeyHint: 'gsk_…0123', ...P });
  assert.deepEqual(sttConfig(again.get()), { provider: 'local' });

  // "" apaga a chave.
  assert.deepEqual(await again.update({ groqKey: '' }), { view: { stt: 'local', groqModel: 'whisper-large-v3', groqKeyHint: null, ...P } });
  assert.equal(keyHint(''), null);
});

test('pausas: limita os tempos, limpa a lista, salva e restaura', async () => {
  const file = join(tempHome(), 'ui', 'voice.json');
  const changes: VoiceSettings[] = [];
  const store = new VoiceSettingsStore(file, { fetch: groqFetch(), onChange: (s) => changes.push(s) });
  assert.deepEqual(pauseConfig(store.get().pauses).extraWaitMs, 2000);

  for (const bad of [{ pauses: 'x' }, { pauses: { silenceMs: '2' } }, { pauses: { incompleteMs: null } }, { pauses: { continuationWords: [1] } }])
    assert.ok('error' in (await store.update(bad)), JSON.stringify(bad));
  assert.equal(changes.length, 0);

  const ok = await store.update({ pauses: { silenceMs: 50, incompleteMs: 99_999, continuationWords: [' O Meu, ', 'e', 'E', '...', 'projeto'] } });
  assert.ok('view' in ok);
  assert.deepEqual(ok.view.pauses, { silenceMs: 300, incompleteMs: 15_000, continuationWords: ['o meu', 'e', 'projeto'] });
  assert.deepEqual(pauseConfig(changes.at(-1)!.pauses), { endMs: 300, extraWaitMs: 14_700, words: ['o meu', 'e', 'projeto'] });

  // Espera menor que o silencio sobe ate ele; lista vazia vale.
  const short = await store.update({ pauses: { silenceMs: 9000, incompleteMs: 1000, continuationWords: [] } });
  assert.ok('view' in short);
  assert.deepEqual(short.view.pauses, { silenceMs: 5000, incompleteMs: 5000, continuationWords: [] });
  assert.equal(pauseConfig(short.view.pauses).extraWaitMs, 0);

  // Recarrega do arquivo; campos ausentes mantem; restaurar = mandar os padroes.
  const again = new VoiceSettingsStore(file, { fetch: groqFetch() });
  assert.deepEqual(again.view().pauses, { silenceMs: 5000, incompleteMs: 5000, continuationWords: [] });
  const restored = await again.update({ pauses: { continuationWords: again.view().pauseDefaults.continuationWords } });
  assert.ok('view' in restored);
  assert.deepEqual(restored.view.pauses, { silenceMs: 5000, incompleteMs: 5000, continuationWords: DEFAULT_PAUSES.continuationWords });
  // Arquivo antigo (sem pausas): padroes.
  assert.deepEqual(new VoiceSettingsStore(join(tempHome(), 'nada.json'), { fetch: groqFetch() }).view().pauses, DEFAULT_PAUSES);
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
    assert.deepEqual(await get.json(), { stt: 'local', groqModel: 'whisper-large-v3-turbo', groqKeyHint: null, ...P });
    assert.equal((await put(`${base}/api/voice/settings`, '{"stt":"groq"}', {})).status, 401);
    assert.equal((await put(`${base}/api/voice/settings`, '{"stt":"groq"}', { ...auth, origin: 'http://evil.com' })).status, 403);
    assert.equal((await put(`${base}/api/voice/settings`, 'nao e json', auth)).status, 400);
    const bad = await put(`${base}/api/voice/settings`, '{"stt":"groq"}', auth);
    assert.equal(bad.status, 400);
    assert.match(bad.body, /Cole a chave/);
    const ok = await put(`${base}/api/voice/settings`, JSON.stringify({ stt: 'groq', groqKey: KEY }), auth);
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body), { stt: 'groq', groqModel: 'whisper-large-v3-turbo', groqKeyHint: 'gsk_…0123', ...P });
    assert.equal((await put(`${base}/api/overview`, '{}', auth)).status, 405);
  } finally {
    await app.close();
  }
});
