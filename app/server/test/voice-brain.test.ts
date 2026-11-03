import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeBrain, JUDGE_PROMPT, WATCH_PROMPT, brainEnv, claudeJudge, claudeWatchSummary, claudeWebSearch, type QueryFn } from '../src/voice/brain.ts';

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
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' });
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

test('avisa as ferramentas usadas e manda data e hora junto com a fala', async () => {
  const toolStart = { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'mcp__jarvis__clima_agora' } } };
  const prompts: string[] = [];
  const base = fakeQuery([[toolStart, delta('Faz 23 graus.'), ok]]);
  const spy = ((params: any) => {
    const wrapped = (async function* () {
      for await (const m of params.prompt) {
        prompts.push(m.message.content);
        yield m;
      }
    })();
    return base.fn({ ...params, prompt: wrapped });
  }) as unknown as QueryFn;
  const brain = new ClaudeBrain({ model: 'haiku', cwd: '/w', query: spy, now: () => new Date(2026, 10, 3, 22, 10) });
  const tools: string[] = [];
  const out: string[] = [];
  for await (const t of brain.reply('qual a temperatura?', new AbortController().signal, { onTool: (n) => tools.push(n) })) out.push(t);
  assert.deepEqual(tools, ['clima_agora']);
  assert.deepEqual(out, ['Faz 23 graus.']);
  assert.match(prompts[0], /^qual a temperatura\?\n\n\[terça-feira, 3 de novembro.*22:10\]$/);
  brain.close();
});

/** query falso de uma consulta so (prompt em texto): devolve as mensagens dadas. */
function oneShot(messages: unknown[] | ((params: any) => AsyncGenerator<unknown>)) {
  const calls: any[] = [];
  let closed = 0;
  const fn = ((params: any) => {
    calls.push(params);
    const gen = typeof messages === 'function' ? messages(params) : (async function* () { yield* messages; })();
    return Object.assign(gen, { close: () => void closed++ });
  }) as unknown as QueryFn;
  return { fn, calls, closed: () => closed };
}

test('claudeWebSearch pesquisa so com a ferramenta WebSearch e devolve o resumo', async () => {
  const q = oneShot([{ type: 'system', subtype: 'init', session_id: 'w' }, { type: 'result', subtype: 'success', result: '- Dólar a R$ 5,44 (Dólar Hoje)', session_id: 'w' }]);
  const search = claudeWebSearch({ model: 'haiku', cwd: '/w', query: q.fn });
  assert.equal(await search('cotação do dólar'), '- Dólar a R$ 5,44 (Dólar Hoje)');
  const { prompt, options: o } = q.calls[0];
  assert.match(prompt, /^Pesquise na web: cotação do dólar/);
  assert.deepEqual([o.model, o.cwd, o.tools, o.allowedTools, o.settingSources, o.mcpServers], ['haiku', '/w', ['WebSearch'], ['WebSearch'], [], {}]);
  assert.equal(Object.keys(o.env).some((k) => k.startsWith('ANTHROPIC_')), false);
  assert.equal(q.closed(), 1);
});

test('claudeWebSearch: erro do SDK e demora viram excecao', async () => {
  const failed = oneShot([{ type: 'result', subtype: 'error_max_turns', session_id: 'w' }]);
  await assert.rejects(claudeWebSearch({ model: 'haiku', cwd: '/w', query: failed.fn })('x'), /error_max_turns/);
  const slow = oneShot(async function* (params: any) {
    await new Promise((_, reject) => params.options.abortController.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  });
  await assert.rejects(claudeWebSearch({ model: 'haiku', cwd: '/w', query: slow.fn, timeoutMs: 20 })('x'), /demorou demais/);
  assert.equal(slow.closed(), 1);
});

test('claudeJudge: IGNORAR descarta, NOVO aceita, demora conta como NOVO', async () => {
  const q = fakeQuery([[delta('IGNO'), delta('RAR'), ok], [delta('NOVO'), ok]]);
  const judge = claudeJudge({ model: 'haiku', cwd: '/w', query: q.fn });
  const c = { asked: 'como está o tempo?', said: 'Amanhã faz sol.', heard: 'batata voadora' };
  assert.equal(await judge.relevant(c), false);
  assert.equal(await judge.relevant({ ...c, heard: 'e no domingo' }), true);
  assert.equal(q.calls[0].options.systemPrompt, JUDGE_PROMPT);
  assert.deepEqual(q.calls[0].options.allowedTools, []);
  // Resposta que nao chega a tempo: interrompe e conta como NOVO (o pedido nao se perde).
  const slow = fakeQuery([Array.from({ length: 20000 }, () => delta('.'))]);
  assert.equal(await claudeJudge({ model: 'haiku', cwd: '/w', query: slow.fn, timeoutMs: 5 }).relevant(c), true);
  assert.equal(slow.interrupts(), 1);
});

test('claudeWatchSummary: o aviso vem do Claude; falha ou vazio usa o texto simples', async () => {
  const report = { id: 's1', label: 'Claude de meu-app', outcome: 'done' as const, tail: 'Todos os 12 testes passaram.\nCommit feito.' };
  const q = fakeQuery([[delta('Senhor, o Claude de meu-app terminou: testes passando. Quer que eu conte mais?'), ok]]);
  assert.equal(await claudeWatchSummary({ model: 'haiku', cwd: '/w', query: q.fn })(report), 'Senhor, o Claude de meu-app terminou: testes passando. Quer que eu conte mais?');
  assert.equal(q.calls[0].options.systemPrompt, WATCH_PROMPT);
  const empty = fakeQuery([[ok]]);
  assert.match(await claudeWatchSummary({ model: 'haiku', cwd: '/w', query: empty.fn })(report), /Claude de meu-app terminou.*Commit feito.*conte mais/);
  const slow = fakeQuery([Array.from({ length: 20000 }, () => delta('.'))]);
  const error = { ...report, outcome: 'error' as const, error: 'API Error: 500' };
  assert.equal(await claudeWatchSummary({ model: 'haiku', cwd: '/w', query: slow.fn, timeoutMs: 5 })(error), 'Senhor, a sessão do Claude de meu-app deu erro: API Error: 500.');
});
