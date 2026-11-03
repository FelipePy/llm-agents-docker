import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startApp } from './app.ts';
import { tempHome } from './helpers.ts';
import type { VoiceWorker, WorkerCommand } from '../src/voice/session.ts';

/** Worker falso que "fala" (devolve audio) quando a voz funciona. */
class SpeakingWorker extends EventEmitter implements VoiceWorker {
  private readonly works: boolean;
  constructor(works: boolean) {
    super();
    this.works = works;
  }
  async ensureReady() {}
  command(c: WorkerCommand) {
    if (c.cmd !== 'speak') return;
    setImmediate(() =>
      this.emit('event', this.works ? { event: 'audio', id: c.id, data: '', last: true } : { event: 'speak-error', id: c.id, message: 'edge-tts fora do ar' }),
    );
  }
  sendAudio() {}
}

async function app(opts: { voiceWorks: boolean; brain?: () => Promise<void> }) {
  const home = tempHome();
  mkdirSync(join(home, 'web'), { recursive: true });
  writeFileSync(join(home, 'web', 'index.html'), '<html></html>');
  const updateFile = join(home, 'state', 'update.json');
  mkdirSync(join(home, 'state'), { recursive: true });
  writeFileSync(updateFile, JSON.stringify({ from: 'a', to: 'b', title: 'X', summary: 's', startedAt: '', desktop: false, announced: false }));
  const started = await startApp(home, {
    voice: { worker: new SpeakingWorker(opts.voiceWorks), brain: { async *reply() {} } },
    evolution: {
      repoDir: home,
      devRoot: join(home, 'dev'),
      stateFile: join(home, 'state', 'evolution.json'),
      updateFile,
      run: async () => ({ code: 0, out: '' }),
      restart: () => {},
    },
    selfCheck: { brain: opts.brain },
  });
  return { ...started, updateFile };
}

const get = (base: string, path: string) => fetch(`${base}${path}`, { headers: { authorization: 'Bearer tok' } });

test('/api/self-check: tudo ok e grava o resultado no update.json', async () => {
  const s = await app({ voiceWorks: true, brain: async () => {} });
  try {
    assert.equal((await fetch(`${s.base}/api/self-check`)).status, 401);
    const r = await (await get(s.base, '/api/self-check?record=1')).json();
    assert.equal(r.ok, true);
    assert.deepEqual(r.checks.map((c: { name: string; ok: boolean }) => `${c.name}:${c.ok}`), ['catalogo:true', 'ferramentas:true', 'web:true', 'voz:true', 'cerebro:true']);
    assert.equal(JSON.parse(readFileSync(s.updateFile, 'utf8')).checks.length, 5);
  } finally {
    await s.app.close();
  }
});

test('/api/self-check: voz quebrada reprova; cerebro fora do ar nao', async () => {
  const s = await app({ voiceWorks: false, brain: async () => Promise.reject(new Error('sem internet')) });
  try {
    const r = await (await get(s.base, '/api/self-check')).json();
    assert.equal(r.ok, false);
    const voz = r.checks.find((c: { name: string }) => c.name === 'voz');
    assert.deepEqual([voz.ok, voz.error], [false, 'edge-tts fora do ar']);
    assert.equal(r.checks.find((c: { name: string }) => c.name === 'cerebro').ok, false);
    assert.equal(JSON.parse(readFileSync(s.updateFile, 'utf8')).checks, undefined, 'sem record=1 nao grava');
  } finally {
    await s.app.close();
  }
  const t = await app({ voiceWorks: true, brain: async () => Promise.reject(new Error('sem internet')) });
  try {
    assert.equal((await (await get(t.base, '/api/self-check')).json()).ok, true, 'cerebro nao e essencial');
  } finally {
    await t.app.close();
  }
});
