import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { startApp } from './app.ts';
import { fakeFetch } from './fakes.ts';
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

test('com issues configurado, o Jarvis grava no ISSUES.md daquele repositorio', async () => {
  const repoDir = tempHome();
  writeFileSync(join(repoDir, 'ISSUES.md'), '# Issues\n\n## Pendentes\n');
  const worker = new FakeWorker();
  let ctx: import('../src/voice/tools.ts').JarvisContext | undefined;
  const commits: string[][] = [];
  const { app, port } = await startApp(tempHome(), {
    issues: { repoDir, run: async (_cmd, args) => (commits.push(args), { code: 0, out: '' }) },
    voice: { worker, brain: (c) => ((ctx = c), brain) },
  });
  try {
    const a = open(port);
    await a.ready;
    assert.equal(await ctx!.createIssue!('Nova', 'Texto.'), 1);
    assert.match(readFileSync(join(repoDir, 'ISSUES.md'), 'utf8'), /### 1\. Nova/);
    assert.equal(commits.length, 1);
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

// Com o Date falso o waitFor nao estoura: quem limita o teste e o timeout.
test('o botao das noticias automaticas para e retoma o anuncio, sem depender de reconectar', { timeout: 10_000 }, async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: new Date(2026, 10, 2, 9).getTime() });
  const worker = new FakeWorker();
  const { app, port, base } = await startApp(tempHome(), {
    fetch: fakeFetch().impl,
    newsUrl: 'https://news.example/rss',
    voice: { worker, brain, announce: { newsEveryMin: 90 } },
  });
  const said = () => worker.commands.flatMap((c) => (c.cmd === 'speak' ? [c] : []));
  const put = (enabled: boolean) =>
    fetch(`${base}/api/news/auto`, { method: 'PUT', headers: { authorization: 'Bearer tok' }, body: JSON.stringify({ enabled }) });
  const c = open(port);
  try {
    await put(false);
    await c.ready;
    c.ws.send(JSON.stringify({ type: 'start' }));
    const hello = await waitFor(() => said()[0]);
    assert.match(hello.text, /senhor/);
    // A saudacao termina de tocar: o Jarvis fica livre, e so o botao pode segurar a noticia.
    c.ws.send(JSON.stringify({ type: 'played', id: hello.id }));
    await waitFor(() => c.messages.filter((m) => m.type === 'state').at(-1)?.state === 'sleeping');

    mock.timers.tick(60e3);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(said().length, 1, 'desligadas: nada de noticia');

    await put(true);
    mock.timers.tick(60e3);
    const news = await waitFor(() => said()[1]);
    assert.match(news.text, /Chuva forte em SP/);
  } finally {
    c.ws.close();
    await app.close();
    mock.timers.reset();
  }
});
