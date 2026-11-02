import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeBrain, brainEnv, type QueryFn } from '../src/voice/brain.ts';

function fakeQuery(script: unknown[][]) {
  const calls: any[] = [];
  const fn = ((params: any) => {
    calls.push(params);
    const messages = script.shift() ?? [];
    return (async function* () {
      for (const m of messages) yield m;
    })();
  }) as unknown as QueryFn;
  return { fn, calls };
}

const delta = (text: string) => ({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });

test('ClaudeBrain transmite o texto e retoma a sessao na fala seguinte', async () => {
  const q = fakeQuery([
    [{ type: 'system', subtype: 'init', session_id: 's1' }, delta('Olá, '), delta('tudo bem?'), { type: 'result', subtype: 'success', session_id: 's1' }],
    [delta('Sim.'), { type: 'result', subtype: 'success', session_id: 's1' }],
  ]);
  const brain = new ClaudeBrain({ model: 'haiku', cwd: '/w', query: q.fn });
  const out: string[] = [];
  for await (const t of brain.reply('oi', new AbortController().signal)) out.push(t);
  assert.deepEqual(out, ['Olá, ', 'tudo bem?']);
  for await (const t of brain.reply('e você?', new AbortController().signal)) out.push(t);
  assert.equal(q.calls[0].options.resume, undefined);
  assert.equal(q.calls[1].options.resume, 's1');
  const o = q.calls[0].options;
  assert.deepEqual([o.model, o.cwd, o.tools, o.settingSources, o.includePartialMessages], ['haiku', '/w', [], [], true]);
  assert.match(o.systemPrompt, /Jarvis/);
});

test('ClaudeBrain falha quando o resultado nao e sucesso e para ao abortar', async () => {
  const q = fakeQuery([[{ type: 'result', subtype: 'error_during_execution', session_id: 's' }], [delta('a'), delta('b')]]);
  const brain = new ClaudeBrain({ model: 'haiku', cwd: '/w', query: q.fn });
  await assert.rejects(async () => {
    for await (const _ of brain.reply('x', new AbortController().signal));
  }, /error_during_execution/);
  const abort = new AbortController();
  const got: string[] = [];
  for await (const t of brain.reply('y', abort.signal)) {
    got.push(t);
    abort.abort();
  }
  assert.deepEqual(got, ['a']);
  assert.equal(q.calls[1].options.abortController.signal.aborted, true);
});

test('brainEnv remove credenciais de API do ambiente', () => {
  const env = brainEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u', CLAUDECODE: '1', HOME: '/h' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h' });
});
