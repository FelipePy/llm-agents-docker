import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeBrain, brainEnv, type QueryFn } from '../src/voice/brain.ts';

const delta = (text: string) => ({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
const ok = { type: 'result', subtype: 'success', session_id: 's1' };

/** query falso em modo streaming: uma "rodada" do roteiro por mensagem do usuario. */
function fakeQuery(turns: unknown[][]) {
  const calls: any[] = [];
  let interrupts = 0;
  const fn = ((params: any) => {
    calls.push(params);
    let interrupted = false;
    const gen = (async function* () {
      yield { type: 'system', subtype: 'init', session_id: 's1' };
      for await (const user of params.prompt) {
        void user;
        for (const m of turns.shift() ?? [ok]) {
          await new Promise((r) => setImmediate(r));
          if (interrupted) {
            interrupted = false;
            yield { type: 'result', subtype: 'error_during_execution', session_id: 's1' };
            break;
          }
          yield m;
        }
      }
    })();
    return Object.assign(gen, {
      interrupt: async () => {
        interrupted = true;
        interrupts++;
      },
      close: () => {},
    });
  }) as unknown as QueryFn;
  return { fn, calls, interrupts: () => interrupts };
}

async function collect(brain: ClaudeBrain, text: string, signal = new AbortController().signal) {
  const out: string[] = [];
  for await (const t of brain.reply(text, signal)) out.push(t);
  return out;
}

test('ClaudeBrain usa uma sessao aberta para todas as falas', async () => {
  const q = fakeQuery([[delta('Olá, '), delta('tudo bem?'), ok], [delta('Sim.'), ok]]);
  const brain = new ClaudeBrain({ model: 'haiku', cwd: '/w', query: q.fn });
  assert.deepEqual(await collect(brain, 'oi'), ['Olá, ', 'tudo bem?']);
  assert.deepEqual(await collect(brain, 'e você?'), ['Sim.']);
  assert.equal(q.calls.length, 1, 'um processo so');
  const o = q.calls[0].options;
  assert.deepEqual([o.model, o.cwd, o.tools, o.settingSources, o.includePartialMessages], ['haiku', '/w', [], [], true]);
  assert.match(o.systemPrompt, /Jarvis/);
  brain.close();
});

test('interromper corta a resposta e a seguinte nao recebe restos dela', async () => {
  const q = fakeQuery([[delta('a'), delta('b'), delta('c'), ok], [delta('x'), ok]]);
  const brain = new ClaudeBrain({ model: 'haiku', cwd: '/w', query: q.fn });
  const abort = new AbortController();
  const got: string[] = [];
  for await (const t of brain.reply('longa', abort.signal)) {
    got.push(t);
    abort.abort();
    break;
  }
  assert.deepEqual(got, ['a']);
  assert.equal(q.interrupts(), 1);
  assert.deepEqual(await collect(brain, 'outra'), ['x']);
  brain.close();
});

test('erro na resposta fecha a sessao; a proxima fala retoma a conversa', async () => {
  const q = fakeQuery([[{ type: 'result', subtype: 'error_max_turns', session_id: 's1' }]]);
  const brain = new ClaudeBrain({ model: 'haiku', cwd: '/w', query: q.fn });
  await assert.rejects(collect(brain, 'x'), /error_max_turns/);
  q.calls.length = 0;
  const q2 = fakeQuery([[delta('ok'), ok]]);
  (brain as unknown as { run: QueryFn }).run = q2.fn;
  assert.deepEqual(await collect(brain, 'y'), ['ok']);
  assert.equal(q2.calls[0].options.resume, 's1');
  brain.close();
});

test('brainEnv remove credenciais de API do ambiente', () => {
  const env = brainEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u', CLAUDECODE: '1', HOME: '/h' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h' });
});

test('warm abre a sessao antes da primeira fala', async () => {
  const q = fakeQuery([[delta('oi'), ok]]);
  const brain = new ClaudeBrain({ model: 'haiku', cwd: '/w', query: q.fn });
  brain.warm();
  await new Promise((r) => setImmediate(r));
  assert.equal(q.calls.length, 1);
  assert.deepEqual(await collect(brain, 'oi'), ['oi']);
  assert.equal(q.calls.length, 1);
  brain.close();
});

test('as memorias sobre o usuario entram nas instrucoes', async () => {
  const q = fakeQuery([[delta('Oi, Felipe!'), ok]]);
  const brain = new ClaudeBrain({ model: 'haiku', cwd: '/w', query: q.fn, about: async () => 'Chama-se Felipe; prefere respostas curtas.' });
  assert.deepEqual(await collect(brain, 'oi'), ['Oi, Felipe!']);
  assert.match(q.calls[0].options.systemPrompt, /O que você já sabe sobre o usuário[\s\S]*Felipe/);
  brain.close();
});
