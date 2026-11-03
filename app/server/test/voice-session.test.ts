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
      if (!signal.aborted) await new Promise((r) => signal.addEventListener('abort', r, { once: true }));
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
  const logs: string[] = [];
  const session = new VoiceSession(worker, brain, (m) => sent.push(m), now, (l) => logs.push(l));
  const states = () => sent.filter((m) => m.type === 'state').map((m) => (m as { state: string }).state);
  return { worker, brain, sent, session, states, logs };
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

  s.worker.fire({ event: 'transcript', id: 2, text: 'Qual é a boa de hoje?' });
  assert.deepEqual(s.sent.find((m) => m.type === 'caption'), { type: 'caption', who: 'user', text: 'Qual é a boa de hoje?' });
  await waitFor(() => s.worker.speaks().length === 2);
  assert.deepEqual(s.worker.speaks().map((c) => c.text), ['Olá.', 'Tudo bem?']);
  assert.equal(s.session.state, 'speaking');
  assert.ok(s.worker.commands.some((c) => c.cmd === 'listen' && c.barge), 'falando: worker continua ouvindo para a interrupcao');

  const [a, b] = s.worker.speaks();
  s.worker.fire({ event: 'audio', id: a.id, data: 'QQ==', last: false });
  s.worker.fire({ event: 'audio', id: a.id, data: 'Qg==', last: true });
  assert.deepEqual(s.sent.filter((m) => m.type === 'audio').map((m) => (m as { last: boolean }).last), [false, true]);
  s.session.client({ type: 'played', id: a.id });
  assert.equal(s.session.state, 'speaking');
  s.session.client({ type: 'played', id: b.id });
  assert.equal(s.session.state, 'listening');
  assert.equal(s.worker.last(), 'listen');
  assert.deepEqual(s.brain.calls, ['Qual é a boa de hoje?']);
});

test('silencio nao encerra: continua ouvindo', async () => {
  const s = await started();
  s.worker.fire({ event: 'wake', score: 0.9 });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(s.session.state, 'listening');
});

test('despedida: o cerebro se despede com as proprias palavras e o Jarvis volta a dormir', async () => {
  const s = await started([['Até a próxima!']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'Tchau, Jarvis!' });
  await waitFor(() => s.worker.speaks().length === 1);
  assert.deepEqual(s.brain.calls, ['Tchau, Jarvis!']);
  assert.equal(s.worker.speaks()[0].text, 'Até a próxima!');
  s.session.client({ type: 'played', id: s.worker.speaks()[0].id });
  assert.equal(s.session.state, 'sleeping');
  assert.equal(s.worker.last(), 'sleep');
});

test('registro da conversa (memoria): inicio, pedidos e fim na despedida ou ao desligar', async () => {
  const log: string[] = [];
  const worker = new FakeWorker();
  const brain = new FakeBrain([['Abrindo.'], ['Até mais!'], ['Oi.']]);
  const session = new VoiceSession(worker, brain, () => {}, () => 0, () => {}, {
    conversation: { start: () => log.push('start'), request: (t) => log.push(`req:${t}`), end: () => log.push('end') },
  });
  await session.start();
  worker.fire({ event: 'wake', score: 0.9 });
  worker.fire({ event: 'transcript', id: 1, text: 'abre o meu-app' });
  await waitFor(() => worker.speaks().length === 1);
  worker.fire({ event: 'wake', score: 0.9 }); // chamado de novo no meio: mesma conversa
  worker.fire({ event: 'transcript', id: 2, text: 'obrigado, tchau' });
  await waitFor(() => worker.speaks().length === 2);
  session.client({ type: 'played', id: worker.speaks()[1].id });
  assert.equal(session.state, 'sleeping');
  assert.deepEqual(log, ['start', 'req:abre o meu-app', 'req:obrigado, tchau', 'end']);

  worker.fire({ event: 'wake', score: 0.9 });
  worker.fire({ event: 'transcript', id: 3, text: 'oi' });
  await waitFor(() => worker.speaks().length === 3);
  session.stop();
  assert.deepEqual(log.slice(4), ['start', 'req:oi', 'end']);
});

test('palavra de ativacao durante a fala cala o Jarvis; a resposta termina em background', async () => {
  const s = await started([['Uma frase longa. ', 'Outra frase. ', 'Mais uma.'], ['Resposta nova.']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'conta uma historia' });
  await waitFor(() => s.worker.speaks().length >= 1);
  const old = s.worker.speaks()[0].id;
  const spokenBefore = s.worker.speaks().length;
  s.worker.fire({ event: 'wake', score: 0.9 });
  assert.equal(s.session.state, 'listening');
  assert.ok(s.worker.commands.some((c) => c.cmd === 'cancel'));
  assert.ok(s.sent.some((m) => m.type === 'stop-audio'));
  s.worker.fire({ event: 'audio', id: old, data: 'QQ==', last: true });
  assert.equal(s.sent.filter((m) => m.type === 'audio').length, 0, 'audio antigo e descartado');

  // A pergunta nova e respondida depois que a anterior acaba (calada).
  s.worker.fire({ event: 'transcript', id: 2, text: 'e agora?' });
  await waitFor(() => s.worker.speaks().some((c) => c.text === 'Resposta nova.'));
  assert.deepEqual(s.worker.speaks().slice(spokenBefore).map((c) => c.text), ['Resposta nova.'], 'depois da interrupcao, so a resposta nova fala');
  assert.deepEqual(s.brain.calls, ['conta uma historia', 'e agora?']);
});

test('o eco da propria voz nao interrompe o Jarvis', async () => {
  const s = await started([['Boa noite, senhor. ', 'Tudo pronto por aqui.']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'oi' });
  await waitFor(() => s.session.state === 'speaking' && s.worker.speaks().length === 2);
  s.worker.fire({ event: 'speech-start' });
  s.worker.fire({ event: 'transcript', id: 2, text: 'Boa noite, senhor. Tudo pronto.' });
  assert.equal(s.session.state, 'speaking');
  assert.ok(!s.sent.some((m) => m.type === 'stop-audio'));
  assert.equal(s.brain.calls.length, 1, 'o eco nao vira pergunta');
});

test('falar por cima de verdade interrompe e a fala vira a nova pergunta', async () => {
  const s = await started([['Frase um. ', 'Frase dois.'], ['Ok.']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'oi' });
  await waitFor(() => s.session.state === 'speaking');
  const before = s.worker.commands.length;
  s.worker.fire({ event: 'speech-start' });
  assert.equal(s.session.state, 'speaking', 'so a deteccao de fala nao basta');
  s.worker.fire({ event: 'transcript', id: 2, text: 'espera, abre o projeto meu-app' });
  assert.ok(s.sent.some((m) => m.type === 'stop-audio'));
  assert.ok(!s.worker.commands.slice(before).some((c) => c.cmd === 'listen'), 'nao reinicia a escuta');
  await waitFor(() => s.brain.calls.length === 2);
  assert.equal(s.brain.calls[1], 'espera, abre o projeto meu-app');
});

test('sem interrupcao por voz, falando o worker so escuta a palavra de ativacao', async () => {
  const worker = new FakeWorker();
  const session = new VoiceSession(worker, new FakeBrain([['Oi.']]), () => {}, () => 0, () => {}, { bargeIn: false });
  await session.start();
  worker.fire({ event: 'wake', score: 0.9 });
  worker.fire({ event: 'transcript', id: 1, text: 'oi' });
  await waitFor(() => session.state === 'speaking');
  assert.equal(worker.last(), 'speak');
  assert.equal(worker.commands.at(-2)?.cmd, 'sleep');
});

test('Esc durante "pensando" cala o Jarvis sem abortar o cerebro', async () => {
  const s = await started(['hang']);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'pergunta difícil' });
  assert.equal(s.session.state, 'thinking');
  s.session.client({ type: 'interrupt' });
  assert.equal(s.session.state, 'listening');
  await new Promise((r) => setImmediate(r));
  assert.equal(s.session.state, 'listening');
});

test('erro do cerebro: legenda com o detalhe, sem frase pronta, e volta a ouvir', async () => {
  const s = await started([new Error('sem rede')]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'oi' });
  await waitFor(() => s.session.state === 'listening' && s.sent.some((m) => m.type === 'error'));
  assert.equal(s.worker.speaks().length, 0);
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

test('log de latencia', async () => {
  let clock = 0;
  const s = await started([['Oi.']], () => clock);
  s.worker.fire({ event: 'wake', score: 0.9 });
  clock = 1000;
  s.worker.fire({ event: 'transcript', id: 1, text: 'qual o tempo hoje', ms: 420 });
  await waitFor(() => s.worker.speaks().length === 1);
  clock = 1900;
  s.worker.fire({ event: 'audio', id: s.worker.speaks()[0].id, data: 'QQ==', last: true });
  assert.match(s.logs[0], /transcrição 420 ms .* 1º token 0 ms .* 1º áudio 900 ms/);
});

test('chamar pelo nome: "Jarvis" acorda; "Jarvis, abre..." ja executa', async () => {
  const s = await started([['Abrindo.']]);
  s.worker.fire({ event: 'heard', text: 'que horas são' });
  assert.equal(s.session.state, 'sleeping', 'fala sem o nome e ignorada');
  s.worker.fire({ event: 'heard', text: 'Jarvis' });
  assert.equal(s.session.state, 'listening');
  s.session.stop();
  const t = await started([['Abrindo.']]);
  t.worker.fire({ event: 'heard', text: 'Jarvis, abre o projeto meu-app.' });
  await waitFor(() => t.brain.calls.length === 1);
  assert.deepEqual(t.brain.calls, ['abre o projeto meu-app.']);
});

test('"Hey Jarvis, ..." no meio da escuta tira o chamado do pedido', async () => {
  const s = await started([['Ok.']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'Hey Jarvis, mostra as skills' });
  await waitFor(() => s.brain.calls.length === 1);
  assert.deepEqual(s.brain.calls, ['mostra as skills']);
  s.worker.fire({ event: 'transcript', id: 2, text: 'Jarvis' });
  assert.equal(s.brain.calls.length, 1, 'so o nome nao vira pergunta');
});

test('conversa direta: ditado digita sem enviar; "envia", "apaga", "limpa" e os botoes', async () => {
  const worker = new FakeWorker();
  const brain = new FakeBrain([['Voltei.']]);
  const sent: VoiceServerMessage[] = [];
  const io: string[] = [];
  const session = new VoiceSession(worker, brain, (m) => sent.push(m), () => 0, () => {}, {
    relay: {
      type: (_id, text) => (io.push(`type:${text}`), true),
      submit: () => (io.push('submit'), true),
      erase: (_id, n) => (io.push(`erase:${n}`), true),
    },
    vocabulary: async () => ['Nowcasting-Geoserver'],
  });
  const lastRelay = () => sent.filter((m) => m.type === 'relay').at(-1);
  await session.start();
  await waitFor(() => worker.commands.some((c) => c.cmd === 'vocab'));
  worker.fire({ event: 'wake', score: 0.9 });
  session.setRelay({ id: 's1', label: 'Claude de meu-app' });
  assert.deepEqual(lastRelay(), { type: 'relay', target: 'Claude de meu-app', draft: '' });

  worker.fire({ event: 'transcript', id: 1, text: 'roda os testes' });
  worker.fire({ event: 'transcript', id: 2, text: 'de login' });
  assert.deepEqual(io, ['type:roda os testes', 'type: de login'], 'digita sem Enter');
  assert.deepEqual(lastRelay(), { type: 'relay', target: 'Claude de meu-app', draft: 'roda os testes de login' });
  worker.fire({ event: 'transcript', id: 3, text: 'Apaga isso.' });
  assert.equal(io.at(-1), 'erase:9', 'apaga o ultimo trecho (" de login")');
  worker.fire({ event: 'transcript', id: 4, text: 'Envia.' });
  assert.equal(io.at(-1), 'submit');
  assert.deepEqual(lastRelay(), { type: 'relay', target: 'Claude de meu-app', draft: '' });

  worker.fire({ event: 'transcript', id: 5, text: 'outra coisa' });
  session.client({ type: 'relay-clear' });
  assert.equal(io.at(-1), 'erase:11');
  worker.fire({ event: 'transcript', id: 6, text: 'mais uma' });
  session.client({ type: 'relay-submit' });
  assert.equal(io.at(-1), 'submit');
  assert.equal(brain.calls.length, 0, 'nada disso passa pelo cerebro');

  worker.fire({ event: 'transcript', id: 7, text: 'Jarvis, volta' });
  assert.deepEqual(lastRelay(), { type: 'relay', target: null, draft: '' });
  worker.fire({ event: 'transcript', id: 8, text: 'abre as skills' });
  await waitFor(() => brain.calls.length === 1);
});

test('botao Sair encerra a conversa direta sem enviar', async () => {
  const worker = new FakeWorker();
  const io: string[] = [];
  const sent: VoiceServerMessage[] = [];
  const session = new VoiceSession(worker, new FakeBrain([]), (m) => sent.push(m), () => 0, () => {}, {
    relay: { type: () => (io.push('type'), true), submit: () => (io.push('submit'), true), erase: () => true },
  });
  await session.start();
  worker.fire({ event: 'wake', score: 0.9 });
  session.setRelay({ id: 's1', label: 'Claude' });
  worker.fire({ event: 'transcript', id: 1, text: 'rascunho' });
  session.client({ type: 'relay-exit' });
  assert.deepEqual(io, ['type']);
  assert.deepEqual(sent.filter((m) => m.type === 'relay').at(-1), { type: 'relay', target: null, draft: '' });
});

test('encerrar_conversa: depois da resposta, volta a dormir', async () => {
  const s = await started([['Valeu, até mais!']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'beleza, era isso então' });
  await waitFor(() => s.session.state === 'speaking');
  s.session.endConversation();
  s.session.client({ type: 'played', id: s.worker.speaks()[0].id });
  assert.equal(s.session.state, 'sleeping');
});

test('interromper: a deteccao de fala abaixa a voz; "para" ou "Jarvis" no meio do eco interrompem', async () => {
  const s = await started([['Hoje o dia está nublado e vai chover à tarde. ', 'Leve guarda-chuva.']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'como está o tempo' });
  await waitFor(() => s.session.state === 'speaking' && s.worker.speaks().length === 2);
  s.worker.fire({ event: 'speech-start' });
  assert.deepEqual(s.sent.filter((m) => m.type === 'duck'), [{ type: 'duck', on: true }]);
  // Eco puro: volta o volume e segue falando.
  s.worker.fire({ event: 'transcript', id: 2, text: 'o dia está nublado e vai chover' });
  assert.equal(s.session.state, 'speaking');
  assert.deepEqual(s.sent.filter((m) => m.type === 'duck').at(-1), { type: 'duck', on: false });
  // A fala do usuario misturada ao eco, com uma palavra de parada: interrompe.
  s.worker.fire({ event: 'transcript', id: 3, text: 'vai chover à tarde para Jarvis' });
  assert.equal(s.session.state, 'thinking', 'parou de falar e ja responde ao que o usuario disse');
  assert.ok(s.sent.some((m) => m.type === 'stop-audio'));
});

test('as ferramentas usadas aparecem nos tempos da resposta', async () => {
  const worker = new FakeWorker();
  const sent: VoiceServerMessage[] = [];
  const brain: Brain = {
    async *reply(_text, _signal, hooks) {
      hooks?.onTool?.('clima_agora');
      yield 'Faz 23 graus.';
    },
  };
  const session = new VoiceSession(worker, brain, (m) => sent.push(m), () => 0);
  await session.start();
  worker.fire({ event: 'wake', score: 0.9 });
  worker.fire({ event: 'transcript', id: 1, text: 'qual a temperatura' });
  await waitFor(() => worker.speaks().length === 1);
  worker.fire({ event: 'audio', id: worker.speaks()[0].id, data: 'QQ==', last: true });
  const timing = sent.find((m) => m.type === 'timing') as { tools: string[] } | undefined;
  assert.deepEqual(timing?.tools, ['clima_agora']);
});

test('chamado sem pedido: responde com uma saudacao sorteada, sem repetir', async () => {
  const worker = new FakeWorker();
  const greetings = ['Estou à disposição, senhor.', 'Às suas ordens, senhor.'];
  const session = new VoiceSession(worker, new FakeBrain([['Abrindo.']]), () => {}, () => 0, () => {}, { greetings, random: () => 0 });
  await session.start();
  assert.ok(worker.commands.some((c) => c.cmd === 'prefetch'));
  worker.fire({ event: 'wake', score: 0.9 });
  assert.equal(session.state, 'speaking');
  const first = worker.speaks()[0];
  assert.equal(first.text, 'Estou à disposição, senhor.');
  session.client({ type: 'played', id: first.id });
  assert.equal(session.state, 'listening');
  session.stop();
  await session.start();
  worker.fire({ event: 'heard', text: 'Jarvis' });
  assert.equal(worker.speaks().at(-1)?.text, 'Às suas ordens, senhor.', 'nao repete a ultima');
  session.stop();
  await session.start();
  const before = worker.speaks().length;
  worker.fire({ event: 'heard', text: 'Jarvis, abre o meu-app' });
  await waitFor(() => worker.speaks().length > before);
  assert.equal(worker.speaks().at(-1)?.text, 'Abrindo.', 'com pedido, vai direto ao pedido');
});

test('anuncio so fala quando o Jarvis esta esperando, e volta a esperar', async () => {
  let ready = 0;
  const worker = new FakeWorker();
  const session = new VoiceSession(worker, new FakeBrain([]), () => {}, () => 0, () => {}, { onReady: () => ready++ });
  await session.start();
  assert.equal(ready, 1);
  assert.equal(session.announce('Já está à tarde, senhor.'), true);
  assert.equal(session.state, 'speaking');
  assert.equal(session.announce('outra'), false, 'ocupado');
  session.client({ type: 'played', id: worker.speaks()[0].id });
  assert.equal(session.state, 'sleeping');
  worker.fire({ event: 'wake', score: 0.9 });
  assert.equal(session.announce('x'), false, 'conversando: nao interrompe');
});

test('aviso pedido sai no meio da conversa, num silencio, e o cerebro fica sabendo dele', async () => {
  let t = 0;
  const s = await started([['Vou acompanhar.'], ['O meu-app terminou os testes.']], () => t);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'me avisa quando o meu-app terminar' });
  await waitFor(() => s.worker.speaks().length === 1);
  s.session.client({ type: 'played', id: s.worker.speaks()[0].id });
  assert.equal(s.session.state, 'listening');
  const notice = 'Senhor, a sessão do meu-app terminou.';
  assert.equal(s.session.announce(notice), false, 'anuncio comum: so dormindo');
  t = 5_000;
  assert.equal(s.session.announce(notice, { whileListening: true }), false, 'acabou de responder: espera um silencio');
  t = 20_000;
  s.worker.fire({ event: 'speech-start' });
  assert.equal(s.session.announce(notice, { whileListening: true }), false, 'o usuario esta falando');
  s.worker.fire({ event: 'speech-drop' });
  assert.equal(s.session.announce(notice, { whileListening: true }), true);
  assert.equal(s.session.state, 'speaking');
  s.session.client({ type: 'played', id: s.worker.speaks().at(-1)!.id });
  assert.equal(s.session.state, 'listening', 'continua a conversa');
  s.worker.fire({ event: 'transcript', id: 2, text: 'conta mais' });
  await waitFor(() => s.brain.calls.length === 2);
  assert.equal(s.brain.calls[1], `[você avisou o usuário, sem ele pedir agora: "${notice}"]\nconta mais`);
});

test('interromper na hora: fala detectada + microfone acima do eco (o usuario, nao o eco)', async () => {
  let t = 0;
  const s = await started([['Hoje o dia está nublado e vai chover à tarde. ', 'Leve guarda-chuva.']], () => t);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'como está o tempo' });
  await waitFor(() => s.session.state === 'speaking' && s.worker.speaks().length === 2);
  // So o eco: o worker detecta fala, mas o microfone nao passa do eco previsto.
  t = 1000;
  s.worker.fire({ event: 'speech-start' });
  assert.equal(s.session.state, 'speaking');
  // Voz acima do eco muito depois da deteccao: nao conta.
  t = 3000;
  s.session.client({ type: 'over-echo' });
  assert.equal(s.session.state, 'speaking');
  // O usuario fala: as duas coisas juntas param o Jarvis na hora, sem esperar a transcricao.
  t = 3300;
  s.worker.fire({ event: 'speech-start' });
  assert.equal(s.session.state, 'listening');
  assert.ok(s.sent.some((m) => m.type === 'stop-audio'));
  // O que ele disse vira o proximo pedido.
  s.worker.fire({ event: 'transcript', id: 2, text: 'espera, e amanhã?' });
  await waitFor(() => s.brain.calls.length === 2);
});

test('pausa e continuacao: a fala nova e emendada na anterior e so a completa e respondida', async () => {
  const s = await started(['hang', ['Abrindo os dois.']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'abre o projeto meu-app.' });
  assert.equal(s.session.state, 'thinking');
  // O usuario continua antes da resposta: a resposta anterior e cancelada.
  s.worker.fire({ event: 'speech-start' });
  assert.equal(s.session.state, 'listening');
  s.worker.fire({ event: 'transcript', id: 2, text: 'e o agendarse também' });
  await waitFor(() => s.worker.speaks().length === 1);
  assert.deepEqual(s.brain.calls, ['abre o projeto meu-app.', 'abre o projeto meu-app e o agendarse também']);
  assert.equal(s.worker.speaks()[0].text, 'Abrindo os dois.');
});

test('pausa e correcao: se a fala nova contradiz a anterior, vale so a nova', async () => {
  const s = await started(['hang', ['Abrindo.']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'abre o projeto meu-app' });
  s.worker.fire({ event: 'speech-start' });
  s.worker.fire({ event: 'transcript', id: 2, text: 'não, na verdade abre o agendarse' });
  await waitFor(() => s.brain.calls.length === 2);
  assert.equal(s.brain.calls[1], 'não, na verdade abre o agendarse');
});

test('pausa seguida de ruido: a fala anterior e respondida de novo', async () => {
  const s = await started(['hang', ['Pronto.']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'que horas são' });
  s.worker.fire({ event: 'speech-start' });
  s.worker.fire({ event: 'speech-drop' });
  await waitFor(() => s.worker.speaks().length === 1);
  assert.deepEqual(s.brain.calls, ['que horas são', 'que horas são']);
});

test('falando: ruido transcrito por cima da voz nao interrompe o Jarvis', async () => {
  const s = await started([['Hoje o dia está nublado. ', 'Leve guarda-chuva.']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'como está o tempo' });
  await waitFor(() => s.session.state === 'speaking' && s.worker.speaks().length === 2);
  s.worker.fire({ event: 'speech-start' });
  s.worker.fire({ event: 'transcript', id: 2, text: 'Legendas pela comunidade Amara.org' });
  assert.equal(s.session.state, 'speaking');
  assert.ok(!s.sent.some((m) => m.type === 'stop-audio'));
  assert.deepEqual(s.sent.filter((m) => m.type === 'duck').at(-1), { type: 'duck', on: false });
  assert.equal(s.brain.calls.length, 1);
  assert.ok(s.logs.some((l) => l.includes('fala descartada')));
});

/** Jarvis falando duas frases e o usuario falando por cima (pausa na hora). */
async function cutIn(judge?: (heard: string) => boolean) {
  let t = 0;
  const worker = new FakeWorker();
  const brain = new FakeBrain([['Hoje o dia está nublado. ', 'Leve guarda-chuva.'], ['Resposta nova.']]);
  const sent: VoiceServerMessage[] = [];
  const judged: string[] = [];
  const session = new VoiceSession(worker, brain, (m) => sent.push(m), () => t, () => {}, {
    judge: judge && {
      relevant: async ({ heard }) => {
        judged.push(heard);
        return judge(heard);
      },
    },
  });
  await session.start();
  worker.fire({ event: 'wake', score: 0.9 });
  worker.fire({ event: 'transcript', id: 1, text: 'como está o tempo' });
  await waitFor(() => session.state === 'speaking' && worker.speaks().length === 2);
  session.client({ type: 'played', id: worker.speaks()[0].id }); // a primeira frase ja tocou
  t = 1000;
  session.client({ type: 'over-echo' });
  worker.fire({ event: 'speech-start' });
  return { worker, brain, sent, session, judged };
}

test('falou por cima: pausa na hora e, se nao foi entendido, retoma a frase cortada', async () => {
  const s = await cutIn();
  assert.equal(s.session.state, 'listening');
  assert.ok(s.sent.some((m) => m.type === 'stop-audio'));
  assert.ok(s.worker.commands.some((c) => c.cmd === 'cancel'));
  s.worker.fire({ event: 'transcript', id: 2, text: 'hmm ahn' });
  assert.equal(s.session.state, 'speaking');
  assert.deepEqual(s.worker.speaks().map((c) => c.text), ['Hoje o dia está nublado.', 'Leve guarda-chuva.', 'Leve guarda-chuva.']);
  assert.ok(!s.sent.some((m) => m.type === 'caption' && m.who === 'user' && m.text === 'hmm ahn'));
  assert.equal(s.brain.calls.length, 1, 'a fala nao entendida nao vira pedido');
});

test('falou por cima algo sem sentido: o juiz manda ignorar e a resposta continua', async () => {
  const s = await cutIn(() => false);
  s.worker.fire({ event: 'transcript', id: 2, text: 'batata voadora azul cadeira' });
  await waitFor(() => s.session.state === 'speaking');
  assert.deepEqual(s.judged, ['batata voadora azul cadeira']);
  assert.equal(s.brain.calls.length, 1);
  assert.equal(s.worker.speaks().at(-1)?.text, 'Leve guarda-chuva.');
});

test('falou por cima algo com sentido: o juiz confirma e ele responde a isso', async () => {
  const s = await cutIn(() => true);
  s.worker.fire({ event: 'transcript', id: 2, text: 'eu prefiro saber do fim de semana' });
  await waitFor(() => s.brain.calls.length === 2);
  assert.equal(s.brain.calls[1], 'eu prefiro saber do fim de semana');
  await waitFor(() => s.worker.speaks().at(-1)?.text === 'Resposta nova.');
  assert.ok(!s.worker.speaks().slice(2).some((c) => c.text === 'Leve guarda-chuva.'), 'a resposta antiga nao volta');
});

test('pergunta, comando ou "Jarvis, ..." por cima: responde direto, sem juiz', async () => {
  for (const text of ['e amanhã?', 'abre o projeto meu-app', 'Jarvis, pesquisa o dólar']) {
    const s = await cutIn(() => false);
    s.worker.fire({ event: 'transcript', id: 2, text });
    await waitFor(() => s.brain.calls.length === 2);
    assert.deepEqual(s.judged, [], text);
  }
});

test('"para" ou "espera ai" por cima: cala de vez e fica ouvindo', async () => {
  const s = await cutIn(() => true);
  s.worker.fire({ event: 'transcript', id: 2, text: 'Espera aí.' });
  assert.equal(s.session.state, 'listening');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(s.worker.speaks().length, 2, 'nao retoma');
  assert.equal(s.brain.calls.length, 1);
});

test('pensando: continuacao nao entendida e descartada e a pergunta anterior e respondida', async () => {
  const s = await started(['hang', ['Pronto.']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'que horas são' });
  s.worker.fire({ event: 'speech-start' });
  s.worker.fire({ event: 'transcript', id: 2, text: '[Música]' });
  await waitFor(() => s.worker.speaks().length === 1);
  assert.deepEqual(s.brain.calls, ['que horas são', 'que horas são'], 'nada de "que horas são [Música]"');
});

test('fora de uma interrupcao, o filtro nao se aplica', async () => {
  const s = await started([['Oi.'], ['Hum?']]);
  s.worker.fire({ event: 'wake', score: 0.9 });
  s.worker.fire({ event: 'transcript', id: 1, text: 'oi' });
  await waitFor(() => s.worker.speaks().length === 1);
  s.session.client({ type: 'played', id: s.worker.speaks()[0].id });
  assert.equal(s.session.state, 'listening');
  s.worker.fire({ event: 'transcript', id: 2, text: 'hmm' });
  await waitFor(() => s.brain.calls.length === 2);
});

/** Sessao com voz cadastrada: `answer` diz se o trecho e do usuario (ou lanca erro). */
async function withSpeaker(
  answer: (clip: number | undefined) => boolean | Error,
  script: Step[] = [['Abrindo.']],
  clock: { t: number } = { t: 0 },
) {
  const worker = new FakeWorker();
  const brain = new FakeBrain(script);
  const sent: VoiceServerMessage[] = [];
  const checked: (number | undefined)[] = [];
  const conversations: string[] = [];
  const session = new VoiceSession(worker, brain, (m) => sent.push(m), () => clock.t, () => {}, {
    speaker: {
      enrolled: () => true,
      verify: async (clip) => {
        checked.push(clip);
        const r = answer(clip);
        if (r instanceof Error) throw r;
        return r;
      },
    },
    conversation: { start: () => conversations.push('start'), request: () => {}, end: () => conversations.push('end') },
  });
  await session.start();
  const captions = () => sent.filter((m) => m.type === 'caption').map((m) => (m as { text: string }).text);
  return { worker, brain, sent, session, checked, captions, conversations };
}

test('voz cadastrada: a ativacao so acorda se a voz for a do usuario', async () => {
  const s = await withSpeaker((clip) => clip === 7);
  s.worker.fire({ event: 'wake', score: 0.9, clip: 7 });
  assert.equal(s.session.state, 'sleeping', 'espera a verificacao');
  await waitFor(() => s.session.state === 'listening');
  assert.deepEqual(s.checked, [7]);
  // No meio da conversa, chamar de novo nao confere outra vez.
  s.worker.fire({ event: 'transcript', id: 1, text: 'que horas são' });
  await waitFor(() => s.brain.calls.length === 1);
  s.worker.fire({ event: 'wake', score: 0.9, clip: 8 });
  assert.deepEqual(s.checked, [7]);
});

test('voz cadastrada: "Jarvis, abre..." de outra voz e recusado e nada e executado', async () => {
  const s = await withSpeaker(() => false);
  s.worker.fire({ event: 'heard', text: 'Jarvis, abre o projeto meu-app.', clip: 3 });
  await waitFor(() => s.worker.speaks().length === 1);
  assert.equal(s.worker.speaks()[0].text, 'Acesso negado.');
  assert.ok(
    s.sent.some((m) => m.type === 'caption' && m.who === 'user' && m.ignored && m.text === 'Jarvis, abre o projeto meu-app.'),
    'a legenda mostra a fala ignorada',
  );
  assert.equal(s.worker.last(), 'sleep', 'nao ouve pedidos nem fala por cima');
  assert.deepEqual(s.brain.calls, []);
  // Enquanto avisa, nem fala nem "Jarvis" de novo abrem a conversa.
  s.worker.fire({ event: 'speech-start' });
  s.worker.fire({ event: 'transcript', id: 1, text: 'abre o projeto meu-app' });
  s.worker.fire({ event: 'wake', score: 0.9, clip: 4 });
  s.session.client({ type: 'played', id: s.worker.speaks()[0].id });
  assert.equal(s.session.state, 'sleeping');
  assert.deepEqual(s.brain.calls, []);
  assert.deepEqual(s.conversations, [], 'recusa nao conta como conversa');
});

test('voz cadastrada: outro chamado recusado logo depois so aparece na legenda', async () => {
  const clock = { t: 1000 };
  const s = await withSpeaker(() => false, [], clock);
  s.worker.fire({ event: 'heard', text: 'Jarvis', clip: 1 });
  await waitFor(() => s.worker.speaks().length === 1);
  s.session.client({ type: 'played', id: s.worker.speaks()[0].id });
  assert.equal(s.session.state, 'sleeping');
  clock.t += 10_000;
  s.worker.fire({ event: 'heard', text: 'Jarvis, desliga tudo', clip: 2 });
  await waitFor(() => s.checked.length === 2);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(s.worker.speaks().length, 1, 'nao repete o aviso em voz');
  assert.equal(s.session.state, 'sleeping');
  assert.deepEqual(s.captions().slice(-2), ['Jarvis, desliga tudo', 'Acesso negado.']);
  // Passado o intervalo, avisa em voz de novo.
  clock.t += 30_000;
  s.worker.fire({ event: 'wake', score: 0.9, clip: 3 });
  await waitFor(() => s.worker.speaks().length === 2);
  assert.deepEqual(s.brain.calls, []);
});

test('esperando: conversa de fundo sem chamado e ignorada, sem resposta nem conferencia', async () => {
  const s = await withSpeaker(() => false);
  s.worker.fire({ event: 'heard', text: 'passa o sal, por favor', clip: 1 });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(s.checked, []);
  assert.deepEqual(s.worker.speaks(), []);
  assert.equal(s.session.state, 'sleeping');
});

test('voz cadastrada: Esc durante o aviso volta a esperar', async () => {
  const s = await withSpeaker(() => false);
  s.worker.fire({ event: 'wake', score: 0.9, clip: 1 });
  await waitFor(() => s.session.state === 'speaking');
  s.session.client({ type: 'interrupt' });
  assert.equal(s.session.state, 'sleeping');
  s.worker.fire({ event: 'transcript', id: 1, text: 'abre o projeto meu-app' });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(s.brain.calls, []);
});

test('voz cadastrada: se nao der para conferir, avisa e nao executa', async () => {
  const s = await withSpeaker(() => new Error('modelo indisponivel'));
  s.worker.fire({ event: 'heard', text: 'Jarvis, que horas são', clip: 2 });
  await waitFor(() => s.worker.speaks().length === 1);
  assert.match(s.worker.speaks()[0].text, /Não consegui conferir a sua voz/);
  assert.deepEqual(s.brain.calls, []);
});

test('voz cadastrada: duas ativacoes seguidas conferem uma vez so', async () => {
  const s = await withSpeaker(() => true);
  s.worker.fire({ event: 'wake', score: 0.9, clip: 1 });
  s.worker.fire({ event: 'heard', text: 'Jarvis', clip: 2 });
  await waitFor(() => s.session.state === 'listening');
  assert.deepEqual(s.checked, [1]);
});

test('sem voz cadastrada, qualquer voz ativa (sem conferir)', async () => {
  const worker = new FakeWorker();
  let asked = 0;
  const session = new VoiceSession(worker, new FakeBrain([]), () => {}, () => 0, () => {}, {
    speaker: { enrolled: () => false, verify: async () => (asked++, false) },
  });
  await session.start();
  worker.fire({ event: 'wake', score: 0.9, clip: 1 });
  assert.equal(session.state, 'listening');
  assert.equal(asked, 0);
});
