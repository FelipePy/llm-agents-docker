import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { startApp } from './app.ts';
import { tempHome, waitFor } from './helpers.ts';
import type { VoiceWorker, WorkerCommand } from '../src/voice/session.ts';
import type { Brain } from '../src/voice/brain.ts';

class FakeWorker extends EventEmitter implements VoiceWorker {
  audioBytes = 0;
  commands: WorkerCommand[] = [];
  async ensureReady(): Promise<void> {}
  command(c: WorkerCommand): void {
    this.commands.push(c);
  }
  sendAudio(pcm: Buffer): void {
    this.audioBytes += pcm.length;
  }
}

const brain: Brain = { async *reply() {} };

function open(port: number, token = 'tok') {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/voice?token=${token}`);
  const messages: any[] = [];
  ws.on('message', (d, binary) => {
    if (!binary) messages.push(JSON.parse(d.toString()));
  });
  const ready = new Promise<void>((ok, fail) => {
    ws.once('open', () => ok());
    ws.once('unexpected-response', (_req, res) => fail(new Error(`HTTP ${res.statusCode}`)));
    ws.once('error', fail);
  });
  return { ws, messages, ready };
}

test('/ws/voice exige token e conduz a sessao de voz', async () => {
  const worker = new FakeWorker();
  const { app, port } = await startApp(tempHome(), { voice: { worker, brain } });
  try {
    await assert.rejects(open(port, 'errado').ready, /HTTP 403/);
    const a = open(port);
    await a.ready;
    a.ws.send(JSON.stringify({ type: 'start' }));
    await waitFor(() => a.messages.some((m) => m.type === 'state' && m.state === 'sleeping'));
    a.ws.send(Buffer.alloc(2560));
    await waitFor(() => worker.audioBytes === 2560);

    // Uma segunda conexao substitui a primeira.
    const b = open(port);
    await b.ready;
    await waitFor(() => a.ws.readyState === WebSocket.CLOSED);
    b.ws.send(JSON.stringify({ type: 'start' }));
    await waitFor(() => b.messages.some((m) => m.type === 'state' && m.state === 'sleeping'));
    b.ws.close();
  } finally {
    await app.close();
  }
});

test('as ferramentas do Jarvis chegam a interface pelo /ws/voice e abrem sessoes', async () => {
  const { buildFixture } = await import('./fixture.ts');
  const fx = buildFixture();
  const worker = new FakeWorker();
  let ctx: import('../src/voice/tools.ts').JarvisContext | undefined;
  const { app, port } = await startApp(fx.home, {
    bin: '/bin/true',
    voice: {
      worker,
      brain: (c) => {
        ctx = c;
        return brain;
      },
    },
  });
  try {
    const a = open(port);
    await a.ready;
    assert.ok(ctx);
    ctx!.ui({ kind: 'back' });
    await waitFor(() => a.messages.some((m) => m.type === 'ui' && m.command.kind === 'back'));
    assert.deepEqual((await ctx!.projects()).map((p) => p.name), ['meu-app']);
    const s = ctx!.openSession(fx.p1, 'claude', 'corrigir os testes');
    assert.equal(s.title, 'corrigir os testes');
    assert.ok(ctx!.sessions().some((x) => x.id === s.id));
    await assert.rejects(ctx!.createProject('../fora'), /inválido/);
    a.ws.close();
  } finally {
    await app.close();
  }
});

test('o estado da voz e a fala do Jarvis chegam tambem ao /ws principal (bolinha flutuante)', async () => {
  const worker = new FakeWorker();
  const { app, port } = await startApp(tempHome(), { voice: { worker, brain } });
  try {
    const main = new WebSocket(`ws://127.0.0.1:${port}/ws?token=tok`, { origin: 'http://tauri.localhost' });
    const seen: any[] = [];
    main.on('message', (d) => seen.push(JSON.parse(d.toString())));
    await new Promise<void>((ok, fail) => (main.once('open', () => ok()), main.once('error', fail)));
    const v = open(port);
    await v.ready;
    v.ws.send(JSON.stringify({ type: 'start' }));
    await waitFor(() => seen.some((m) => m.type === 'voice' && m.state === 'sleeping'));
    main.close();
    v.ws.close();
  } finally {
    await app.close();
  }
});

test('/ws/voice no modo atalho: o audio so passa entre apertar e soltar', async () => {
  const worker = new FakeWorker();
  const { app, port } = await startApp(tempHome(), { voice: { worker, brain } });
  try {
    const a = open(port);
    await a.ready;
    a.ws.send(JSON.stringify({ type: 'start', hold: true }));
    await waitFor(() => a.messages.some((m) => m.type === 'state' && m.state === 'sleeping'));
    a.ws.send(Buffer.alloc(2560));
    a.ws.send(JSON.stringify({ type: 'hold-start' }));
    a.ws.send(Buffer.alloc(1280));
    a.ws.send(JSON.stringify({ type: 'hold-end' }));
    await waitFor(() => worker.commands.some((c) => c.cmd === 'release'));
    assert.equal(worker.audioBytes, 1280);
    a.ws.close();
  } finally {
    await app.close();
  }
});
