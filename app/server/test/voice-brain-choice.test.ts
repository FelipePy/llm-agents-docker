import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { BrainChoiceStore, SwitchingBrain, claudeModels, codexModels, preferred, type BrainChoice, type BrainModel, type BrainProvider, type ClosableBrain } from '../src/voice/brain-choice.ts';
import { CodexBrain, codexArgs, type SpawnFn } from '../src/voice/codex-brain.ts';
import { GROQ_MODELS } from '../src/voice/settings.ts';
import { CONFIG_OPTIONS } from '../src/voice/config.ts';
import type { VoiceWorker } from '../src/voice/session.ts';
import { tempHome } from './helpers.ts';
import { startApp } from './app.ts';

const MODELS: Record<BrainProvider, BrainModel[]> = {
  claude: [{ id: 'opus', label: 'Opus 5.5' }, { id: 'haiku', label: 'Haiku 5.5' }],
  codex: [{ id: 'gpt-6-sol', label: 'GPT-6-Sol' }, { id: 'gpt-6-luna', label: 'GPT-6-Luna' }],
};

function store(file = join(tempHome(), 'b.json'), list?: (p: BrainProvider) => Promise<BrainModel[]>) {
  const changes: BrainChoice[] = [];
  let calls = 0;
  const s = new BrainChoiceStore(file, {
    list: list ?? (async (p) => (calls++, MODELS[p])),
    fallback: { provider: 'claude', model: 'haiku' },
    onChange: (c) => changes.push(c),
  });
  return { s, changes, file, calls: () => calls };
}

test('BrainChoiceStore: padrao, troca conferida na lista do plano e gravada so para o usuario', async () => {
  const { s, changes, file } = store();
  assert.deepEqual(s.get(), { provider: 'claude', model: 'haiku' });
  assert.match(((await s.set({ provider: 'codex', model: 'gpt-9' })) as { error: string }).error, /não tem o modelo "gpt-9"/);
  assert.match(((await s.set({ provider: 'gemini' })) as { error: string }).error, /provedor inválido/);
  assert.deepEqual(changes, [], 'erro nao muda nada');
  // So o provedor: o primeiro modelo da lista dele.
  assert.deepEqual(await s.set({ provider: 'codex' }), { choice: { provider: 'codex', model: 'gpt-6-sol' } });
  assert.deepEqual(await s.set({ model: 'gpt-6-luna' }), { choice: { provider: 'codex', model: 'gpt-6-luna' } });
  assert.deepEqual(changes, [{ provider: 'codex', model: 'gpt-6-sol' }, { provider: 'codex', model: 'gpt-6-luna' }]);
  await s.set({ model: 'gpt-6-luna' });
  assert.equal(changes.length, 2, 'a mesma escolha nao avisa de novo');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { provider: 'codex', model: 'gpt-6-luna' });
  assert.deepEqual(store(file).s.get(), { provider: 'codex', model: 'gpt-6-luna' }, 'vale depois de reiniciar');
  // De volta ao Claude sem modelo: o Haiku (o mais rapido para falar).
  assert.deepEqual(await s.set({ provider: 'claude' }), { choice: { provider: 'claude', model: 'haiku' } });
});

test('BrainChoiceStore: a tela consulta a lista na hora; o erro de um provedor nao esconde o outro', async () => {
  const t = store(undefined, async (p) => {
    if (p === 'codex') throw new Error('Codex não instalado');
    return MODELS[p];
  });
  const v = await t.s.view();
  assert.deepEqual(v.models.claude, MODELS.claude);
  assert.deepEqual(v.models.codex, []);
  assert.deepEqual(v.errors, { codex: 'Codex não instalado' });
  const fresh = store();
  await fresh.s.view();
  await fresh.s.view();
  assert.equal(fresh.calls(), 4, 'cada abertura da tela consulta de novo');
  await fresh.s.models('claude');
  assert.equal(fresh.calls(), 4, 'para conferir uma escolha, a lista recente basta');
});

test('claudeModels e codexModels: so os modelos que se escolhem, com nomes legiveis', () => {
  assert.deepEqual(
    claudeModels([
      { value: 'default', displayName: 'Default (recommended)', description: 'Opus 5.5 · Best' },
      { value: 'claude-fable-5-1[1m]', displayName: 'Fable', description: 'Fable 5.1 · Most capable' },
      { value: 'haiku', displayName: 'Haiku', description: '' },
    ]),
    [{ id: 'claude-fable-5-1[1m]', label: 'Fable 5.1' }, { id: 'haiku', label: 'Haiku' }],
  );
  const json = JSON.stringify({ models: [
    { slug: 'gpt-6-sol', display_name: 'GPT-6-Sol', visibility: 'list' },
    { slug: 'codex-auto-review', display_name: 'Auto Review', visibility: 'hide' },
    { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list' },
  ] });
  assert.deepEqual(codexModels(json), [{ id: 'gpt-6-sol', label: 'GPT-6-Sol' }, { id: 'gpt-6-luna', label: 'GPT-6-Luna' }]);
  assert.equal(preferred('codex', MODELS.codex), 'gpt-6-sol');
});

test('o catalogo das configuracoes usa os mesmos ids do servidor', () => {
  const ids = (key: string) => CONFIG_OPTIONS.find((o) => o.key === key)!.choices!.map((c) => c.id);
  assert.deepEqual(ids('modeloTranscricao').sort(), [...GROQ_MODELS].sort());
  assert.deepEqual(ids('agenteVoz'), ['claude', 'codex']);
});

/** Cerebro falso: guarda o que aconteceu com ele. */
function fakeBrain(name: string, log: string[]): ClosableBrain & { model: string } {
  return {
    model: name,
    async *reply(text: string) {
      log.push(`${this.model}: ${text}`);
      yield 'ok';
    },
    close() {
      log.push(`fechou ${this.model}`);
    },
  };
}

async function drain(it: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const d of it) out += d;
  return out;
}

test('SwitchingBrain: a troca vale na fala seguinte; outro modelo do mesmo provedor mantem a conversa', async () => {
  const log: string[] = [];
  const b = new SwitchingBrain(
    { provider: 'claude', model: 'haiku' },
    (c) => fakeBrain(`${c.provider}/${c.model}`, log),
    (brain, c) => c.provider === 'claude' && ((brain as ReturnType<typeof fakeBrain>).model = `claude/${c.model}`, true),
  );
  await drain(b.reply('oi', new AbortController().signal));
  // Pedida no meio da resposta: a resposta atual nao e cortada.
  const it = b.reply('troca', new AbortController().signal)[Symbol.asyncIterator]();
  b.choose({ provider: 'claude', model: 'sonnet' });
  await it.next();
  assert.deepEqual(log, ['claude/haiku: oi', 'claude/haiku: troca']);
  await drain(b.reply('e agora?', new AbortController().signal));
  assert.equal(log.at(-1), 'claude/sonnet: e agora?', 'mesmo cerebro, modelo novo');
  b.choose({ provider: 'codex', model: 'gpt-6-sol' });
  await drain(b.reply('e com o codex?', new AbortController().signal));
  assert.deepEqual(log.slice(-2), ['fechou claude/sonnet', 'codex/gpt-6-sol: e com o codex?']);
  b.close();
  assert.equal(log.at(-1), 'fechou codex/gpt-6-sol');
});

test('codexArgs: so as ferramentas do Jarvis, sem shell, busca nem config do usuario; retoma pelo id', () => {
  const a = codexArgs({ model: 'gpt-6-sol', mcpUrl: 'http://127.0.0.1:7777/mcp/jarvis', instructions: 'Você é "o Jarvis".\nCurto.' });
  assert.deepEqual(a.slice(0, 2), ['exec', '--json']);
  for (const flag of ['--ignore-user-config', 'sandbox_mode="read-only"', 'web_search="disabled"', 'features.shell_tool=false', 'mcp_servers.jarvis.url="http://127.0.0.1:7777/mcp/jarvis"']) assert.ok(a.includes(flag), flag);
  assert.ok(a.includes('developer_instructions="Você é \\"o Jarvis\\".\\nCurto."'), 'instrucoes como texto TOML');
  assert.deepEqual(a.slice(-3), ['-m', 'gpt-6-sol', '-']);
  assert.deepEqual(codexArgs({ model: 'm', mcpUrl: 'u', instructions: 'i', thread: 't1' }).slice(0, 3), ['exec', 'resume', 't1']);
});

/** "codex exec" falso: devolve os eventos dados e guarda os argumentos e a entrada. */
function fakeCodex(runs: { events: object[]; code?: number }[]) {
  const calls: { args: string[]; input: string; env: Record<string, string | undefined> }[] = [];
  const spawn: SpawnFn = (_cmd, args, opts) => {
    const run = runs.shift()!;
    const stdout = new PassThrough();
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout, stderr: new PassThrough(), kill: () => true }) as unknown as ChildProcess;
    const call = { args, input: '', env: opts.env };
    calls.push(call);
    child.stdin!.on('data', (d) => (call.input += d));
    setImmediate(() => {
      for (const e of run.events) stdout.write(JSON.stringify(e) + '\n');
      stdout.end();
      setImmediate(() => child.emit('exit', run.code ?? 0));
    });
    return child;
  };
  return { spawn, calls };
}

test('CodexBrain: fala as mensagens, avisa as ferramentas e continua a mesma conversa', async () => {
  const fake = fakeCodex([
    { events: [{ type: 'thread.started', thread_id: 'th-1' }, { type: 'item.completed', item: { type: 'agent_message', text: 'Um instante.' } }, { type: 'item.started', item: { type: 'mcp_tool_call', tool: 'clima_agora' } }, { type: 'item.completed', item: { type: 'agent_message', text: 'Faz 24 graus.' } }, { type: 'turn.completed' }] },
    { events: [{ type: 'thread.started', thread_id: 'th-1' }, { type: 'item.completed', item: { type: 'agent_message', text: 'De nada!' } }] },
  ]);
  const brain = new CodexBrain({ model: 'gpt-6-sol', cwd: '/ws', mcpUrl: () => 'http://127.0.0.1:1/mcp/jarvis', token: 'tok', about: async () => 'O nome dele é Felipe.', now: () => new Date(2026, 10, 6, 9, 0), spawn: fake.spawn });
  const tools: string[] = [];
  assert.equal(await drain(brain.reply('como está o tempo?', new AbortController().signal, { onTool: (t) => tools.push(t) })), 'Um instante. Faz 24 graus.');
  assert.deepEqual(tools, ['clima_agora']);
  assert.match(fake.calls[0].input, /^como está o tempo\?\n\n\[.*novembro.*\]$/s);
  assert.equal(fake.calls[0].env.JARVIS_MCP_TOKEN, 'tok', 'o token vai pelo ambiente, nunca nos argumentos');
  assert.ok(!fake.calls[0].args.join(' ').includes('tok '));
  assert.ok(fake.calls[0].args.some((a) => a.includes('O nome dele é Felipe.')), 'as memorias entram nas instrucoes');
  assert.equal(await drain(brain.reply('obrigado', new AbortController().signal)), 'De nada!');
  assert.deepEqual(fake.calls[1].args.slice(0, 3), ['exec', 'resume', 'th-1']);
});

test('CodexBrain: erro do Codex vira excecao e a proxima fala abre outra conversa', async () => {
  const fake = fakeCodex([
    { events: [{ type: 'thread.started', thread_id: 'th-1' }, { type: 'turn.failed', error: { message: 'limite do plano' } }], code: 1 },
    { events: [{ type: 'item.completed', item: { type: 'agent_message', text: 'Oi' } }] },
  ]);
  const brain = new CodexBrain({ model: 'm', cwd: '/ws', mcpUrl: () => 'u', token: 't', spawn: fake.spawn });
  await assert.rejects(drain(brain.reply('oi', new AbortController().signal)), /limite do plano/);
  await drain(brain.reply('oi de novo', new AbortController().signal));
  assert.equal(fake.calls[1].args[1], '--json', 'sem retomar a conversa que falhou');
});

const mcpPost = (base: string, body: unknown, headers: Record<string, string> = { authorization: 'Bearer tok' }) =>
  fetch(`${base}/mcp/jarvis`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('/mcp/jarvis: as ferramentas do Jarvis por HTTP, so com o token e sem pagina de origem', async () => {
  const { app, base } = await startApp(tempHome());
  try {
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
    assert.equal((await mcpPost(base, init, {})).status, 401);
    assert.equal((await mcpPost(base, init, { authorization: 'Bearer tok', origin: 'http://127.0.0.1' })).status, 403);
    const r = await mcpPost(base, init);
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { id: number }).id, 1);
    assert.equal((await mcpPost(base, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    const list = (await (await mcpPost(base, { jsonrpc: '2.0', id: 'b', method: 'tools/list' })).json()) as { id: string; result: { tools: { name: string }[] } };
    assert.equal(list.id, 'b');
    assert.ok(list.result.tools.some((t) => t.name === 'mudar_configuracao'));
    const call = (await (await mcpPost(base, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'data_e_hora', arguments: {} } })).json()) as { result: { content: { text: string }[] } };
    assert.match(call.result.content[0].text, /^Agora são/);
    assert.equal((await fetch(`${base}/mcp/jarvis`, { headers: { authorization: 'Bearer tok' } })).status, 405);
  } finally {
    await app.close();
  }
});

test('/api/voice/brain: GET traz a escolha e os modelos; PUT confere e salva', async () => {
  const worker = Object.assign(new EventEmitter(), { async ensureReady() {}, command() {}, sendAudio() {} }) as unknown as VoiceWorker;
  const { s } = store();
  const { app, base } = await startApp(tempHome(), { voice: { worker, brain: { async *reply() {} }, brainChoice: s } });
  try {
    const auth = { authorization: 'Bearer tok' };
    const get = await fetch(`${base}/api/voice/brain`, { headers: auth });
    assert.deepEqual(await get.json(), { provider: 'claude', model: 'haiku', models: MODELS, errors: {} });
    const put = (body: unknown) => fetch(`${base}/api/voice/brain`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await put({ provider: 'codex', model: 'nao-existe' })).status, 400);
    const ok = await put({ provider: 'codex', model: 'gpt-6-luna' });
    assert.deepEqual(await ok.json(), { provider: 'codex', model: 'gpt-6-luna' });
    assert.equal((await fetch(`${base}/api/voice/brain`, { method: 'PUT', body: '{}' })).status, 401);
  } finally {
    await app.close();
  }
});
