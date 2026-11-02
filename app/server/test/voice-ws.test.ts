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
