import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { VoiceSession, type VoiceWorker, type WorkerCommand, type WorkerEvent } from '../src/voice/session.ts';
import type { Brain } from '../src/voice/brain.ts';
import type { VoiceServerMessage } from '../src/types.ts';
import { waitFor } from './helpers.ts';

class FakeWorker extends EventEmitter implements VoiceWorker {
  commands: WorkerCommand[] = [];
  audioBytes = 0;
  readyCalls = 0;
  failReady: Error | null = null;
  async ensureReady(): Promise<void> {
    this.readyCalls++;
    if (this.failReady) throw this.failReady;
  }
  command(c: WorkerCommand): void {
    this.commands.push(c);
  }
  sendAudio(pcm: Buffer): void {
    this.audioBytes += pcm.length;
  }
  fire(e: WorkerEvent): void {
    this.emit('event', e);
  }
  speaks(): { id: number; text: string }[] {
    return this.commands.filter((c): c is { cmd: 'speak'; id: number; text: string } => c.cmd === 'speak');
  }
  last(): string {
    return this.commands.at(-1)?.cmd ?? '';
  }
}

type Step = string[] | Error | 'hang';

class FakeBrain implements Brain {
  calls: string[] = [];
  script: Step[];
  constructor(script: Step[]) {
    this.script = script;
  }
  async *reply(text: string, signal: AbortSignal): AsyncGenerator<string> {
    this.calls.push(text);
    const step = this.script.shift() ?? [];
    if (step === 'hang') {
      await new Promise((r) => signal.addEventListener('abort', r, { once: true }));
      return;
    }
    if (step instanceof Error) throw step;
    for (const chunk of step) {
      await new Promise((r) => setImmediate(r));
      if (signal.aborted) return;
      yield chunk;
    }
  }
}

function setup(script: Step[] = [], now = () => 0) {
  const worker = new FakeWorker();
  const brain = new FakeBrain(script);
  const sent: VoiceServerMessage[] = [];
  const session = new VoiceSession(worker, brain, (m) => sent.push(m), now);
  const states = () => sent.filter((m) => m.type === 'state').map((m) => (m as { state: string }).state);
  return { worker, brain, sent, session, states };
}

async function started(script: Step[] = [], now?: () => number) {
  const s = setup(script, now);
  await s.session.start();
  return s;
}

test('start prepara o worker e espera a palavra de ativacao', async () => {
  const s = setup();
  s.session.audio(Buffer.alloc(10));
  assert.equal(s.worker.audioBytes, 0, 'sem escuta ligada, nao repassa audio');
  await s.session.start();
  assert.deepEqual(s.states(), ['preparing', 'sleeping']);
  assert.equal(s.worker.last(), 'sleep');
  s.session.audio(Buffer.alloc(10));
  assert.equal(s.worker.audioBytes, 10);
});

test('ciclo completo: ativa, ouve, pensa, fala frase a frase e volta a ouvir', async () => {
  const s = await started([['Olá. ', 'Tudo **bem**?']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  assert.equal(s.session.state, 'listening');
  assert.ok(s.sent.some((m) => m.type === 'chime'));
  assert.equal(s.worker.last(), 'listen');

  s.worker.fire({ event: 'transcript', id: 1, text: '  ' });
  assert.equal(s.session.state, 'listening', 'transcricao vazia e ignorada');

  s.worker.fire({ event: 'transcript', id: 2, text: 'Oi, Jarvis' });
  assert.deepEqual(s.sent.find((m) => m.type === 'caption'), { type: 'caption', who: 'user', text: 'Oi, Jarvis' });
  await waitFor(() => s.worker.speaks().length === 2);
  assert.deepEqual(s.worker.speaks().map((c) => c.text), ['Olá.', 'Tudo bem?']);
  assert.equal(s.session.state, 'speaking');
  assert.ok(s.worker.commands.some((c) => c.cmd === 'sleep'), 'falando: worker so escuta a palavra de ativacao');

  const [a, b] = s.worker.speaks();
  s.worker.fire({ event: 'audio', id: a.id, data: 'QQ==' });
  assert.ok(s.sent.some((m) => m.type === 'audio' && m.id === a.id));
  s.session.client({ type: 'played', id: a.id });
  assert.equal(s.session.state, 'speaking');
  s.session.client({ type: 'played', id: b.id });
  assert.equal(s.session.state, 'listening');
  assert.equal(s.worker.last(), 'listen');
  assert.deepEqual(s.brain.calls, ['Oi, Jarvis']);
});

test('silencio nao encerra: continua ouvindo', async () => {
  const s = await started();
  s.worker.fire({ event: 'wake', score: 0.9 });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(s.session.state, 'listening');
});

test('despedida: fala "Até mais!" sem o cerebro e volta a dormir', async () => {
  const s = await started();
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'Tchau, Jarvis!' });
  assert.deepEqual(s.worker.speaks().map((c) => c.text), ['Até mais!']);
  s.session.client({ type: 'played', id: s.worker.speaks()[0].id });
  assert.equal(s.session.state, 'sleeping');
  assert.equal(s.worker.last(), 'sleep');
  assert.deepEqual(s.brain.calls, []);
});

test('palavra de ativacao durante a fala interrompe e volta a ouvir', async () => {
  const s = await started([['Uma frase longa. ', 'Outra.']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'conta uma historia' });
  await waitFor(() => s.worker.speaks().length === 2);
  const old = s.worker.speaks()[0].id;
  s.worker.fire({ event: 'wake', score: 0.9 });
  assert.equal(s.session.state, 'listening');
  assert.ok(s.worker.commands.some((c) => c.cmd === 'cancel'));
  assert.ok(s.sent.some((m) => m.type === 'stop-audio'));
  s.worker.fire({ event: 'audio', id: old, data: 'QQ==' });
  assert.equal(s.sent.filter((m) => m.type === 'audio').length, 0, 'audio antigo e descartado');
});

test('Esc durante "pensando" aborta o cerebro', async () => {
  const s = await started(['hang']);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'pergunta difícil' });
  assert.equal(s.session.state, 'thinking');
  s.session.client({ type: 'interrupt' });
  assert.equal(s.session.state, 'listening');
  await new Promise((r) => setImmediate(r));
  assert.equal(s.session.state, 'listening');
});

test('erro do cerebro: legenda com o detalhe e uma frase de desculpa', async () => {
  const s = await started([new Error('sem rede')]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'oi' });
  await waitFor(() => s.worker.speaks().length === 1);
  assert.equal(s.worker.speaks()[0].text, 'Tive um problema para responder agora.');
  assert.ok(s.sent.some((m) => m.type === 'caption' && m.who === 'jarvis' && m.text.includes('sem rede')));
});

test('falha da sintese conta como frase tocada', async () => {
  const s = await started([['Oi.']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'oi' });
  await waitFor(() => s.worker.speaks().length === 1);
  await waitFor(() => s.session.state === 'speaking');
  s.worker.fire({ event: 'speak-error', id: s.worker.speaks()[0].id, message: 'offline' });
  assert.equal(s.session.state, 'listening');
  assert.ok(s.sent.some((m) => m.type === 'error'));
});

test('stop desliga tudo', async () => {
  const s = await started();
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.session.stop();
  assert.equal(s.session.state, 'off');
  assert.equal(s.worker.last(), 'sleep');
  s.worker.fire({ event: 'wake', score: 0.9 });
  assert.equal(s.session.state, 'off', 'eventos depois do stop sao ignorados');
});

test('falha ao preparar o worker: aviso e escuta desligada', async () => {
  const s = setup();
  s.worker.failReady = new Error('Python 3.10 ou mais novo');
  await s.session.start();
  assert.equal(s.session.state, 'off');
  assert.ok(s.sent.some((m) => m.type === 'error' && m.message.includes('Python')));
});

test('worker cai: reinicia uma vez; caindo de novo em 60 s, desliga', async () => {
  let clock = 0;
  const s = await started([], () => clock);
  clock = 1000;
  s.worker.fire({ event: 'exit', code: 1 });
  await waitFor(() => s.session.state === 'sleeping' && s.worker.readyCalls === 2);
  clock = 30_000;
  s.worker.fire({ event: 'exit', code: 1 });
  await waitFor(() => s.session.state === 'off');
  assert.ok(s.sent.some((m) => m.type === 'error' && m.message.includes('parou')));
});
