import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { TerminalManager, agentArgs } from '../src/terminals.ts';
import { buildFixture } from './fixture.ts';
import { startApp } from './app.ts';
import { tempHome, waitFor, write } from './helpers.ts';

/** llm-agent falso: mostra argumentos e projeto, le uma linha e sai com 3. */
function fakeAgent(dir: string): string {
  const bin = join(dir, 'fake-llm-agent');
  write(bin, '#!/usr/bin/env bash\necho "ARGS:$*"\necho "WORKDIR:$AGENT_WORKDIR"\nIFS= read -r line\necho "GOT:$line"\nexit 3\n');
  chmodSync(bin, 0o755);
  return bin;
}

test('agentArgs monta os comandos de cada agente', () => {
  assert.deepEqual(agentArgs('claude'), ['claude', '--dangerously-skip-permissions']);
  assert.deepEqual(agentArgs('claude', 'abc'), ['claude', '--dangerously-skip-permissions', '--resume', 'abc']);
  assert.deepEqual(agentArgs('claude', undefined, 'oi'), ['claude', '--dangerously-skip-permissions', 'oi']);
  assert.deepEqual(agentArgs('codex'), ['codex', '--dangerously-bypass-approvals-and-sandbox']);
  assert.deepEqual(agentArgs('codex', 'xyz'), ['codex', 'resume', '--dangerously-bypass-approvals-and-sandbox', 'xyz']);
  assert.deepEqual(agentArgs('codex', undefined, 'oi'), ['codex', '--dangerously-bypass-approvals-and-sandbox', 'oi']);
  assert.deepEqual(agentArgs('shell', undefined, 'oi'), ['zsh']);
});

test('TerminalManager executa o llm-agent no projeto e guarda o historico', async () => {
  const home = tempHome();
  const proj = join(home, 'proj');
  mkdirSync(proj);
  const tm = new TerminalManager(fakeAgent(home));
  let out = '';
  let code: number | undefined;
  tm.on('output', (_id: string, d: string) => (out += d));
  tm.on('exit', (_id: string, c: number) => (code = c));
  const s = tm.open({ projectPath: proj, agent: 'claude', resume: 'abc', title: 't', cols: 80, rows: 24 });
  await waitFor(() => out.includes('WORKDIR:'));
  assert.ok(out.includes('ARGS:claude --dangerously-skip-permissions --resume abc'));
  assert.ok(out.includes(`WORKDIR:${proj}`));
  tm.write(s.id, 'oi\r');
  await waitFor(() => code !== undefined && out.includes('GOT:oi'));
  assert.equal(code, 3);
  assert.equal(tm.list()[0].alive, false);
  assert.equal(tm.list()[0].exitCode, 3);
  assert.ok(tm.history(s.id)?.includes('ARGS:'));
  tm.close(s.id);
  assert.deepEqual(tm.list(), []);
  assert.equal(tm.history(s.id), null);
});

test('TerminalManager limita o historico', async () => {
  const home = tempHome();
  const tm = new TerminalManager(fakeAgent(home), 16);
  let exited = false;
  tm.on('exit', () => (exited = true));
  const s = tm.open({ projectPath: home, agent: 'shell', title: 't', cols: 80, rows: 24 });
  tm.write(s.id, 'uma linha bem comprida\r');
  await waitFor(() => exited);
  assert.ok((tm.history(s.id) ?? '').length <= 16);
  tm.closeAll();
});

test('TerminalManager: screen() mostra a tela atual, sem o que ja foi apagado', async () => {
  const home = tempHome();
  // Como o Claude Code: escreve o indicador de trabalho e depois o apaga no lugar (\r + apagar linha).
  const bin = join(home, 'fake-claude');
  write(bin, "#!/usr/bin/env bash\nprintf 'Pensando · esc to interrupt'\nsleep 0.1\nprintf '\\r\\033[K● pronto\\n> '\nIFS= read -r line\n");
  chmodSync(bin, 0o755);
  const tm = new TerminalManager(bin);
  const s = tm.open({ projectPath: home, agent: 'claude', title: 't', cols: 80, rows: 24 });
  await waitFor(() => (tm.screen(s.id) ?? '').includes('pronto'));
  assert.ok(tm.history(s.id)?.includes('esc to interrupt'), 'os bytes brutos ainda tem o indicador');
  assert.equal(tm.screen(s.id), '● pronto\n>');
  tm.resize(s.id, 100, 30);
  assert.equal(tm.screen(s.id), '● pronto\n>');
  tm.close(s.id);
  assert.equal(tm.screen(s.id), null);
});

async function connect(port: number, opts: { token?: string; origin?: string } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${opts.token ?? 'tok'}`, opts.origin ? { origin: opts.origin } : {});
  const messages: any[] = [];
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
  await new Promise<void>((ok, fail) => {
    ws.once('open', () => ok());
    ws.once('unexpected-response', (_req, res) => fail(new Error(`HTTP ${res.statusCode}`)));
    ws.once('error', fail);
  });
  return { ws, messages, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

test('WebSocket recusa token errado e Origin estranho', async () => {
  const fx = buildFixture();
  const { app, port } = await startApp(fx.home);
  try {
    await assert.rejects(connect(port, { token: 'errado' }), /HTTP 403/);
    await assert.rejects(connect(port, { origin: 'http://evil.com' }), /HTTP 403/);
  } finally {
    await app.close();
  }
});

test('WebSocket abre, retoma, anexa e encerra sessoes', async () => {
  const fx = buildFixture();
  const { app, port } = await startApp(fx.home, { bin: fakeAgent(fx.home) });
  const c = await connect(port);
  try {
    await waitFor(() => c.messages.find((m) => m.type === 'sessions'));
    const errorWith = (text: string) => waitFor(() => c.messages.find((m) => m.type === 'error' && m.message.includes(text)));

    c.send({ type: 'open', projectPath: '/nao/existe', agent: 'claude', cols: 80, rows: 24 });
    await errorWith('projeto desconhecido');
    c.send({ type: 'open', projectPath: fx.p1, agent: 'claude', resume: '--evil', cols: 80, rows: 24 });
    await errorWith('conversa desconhecida');
    c.send({ type: 'open', projectPath: fx.p1, agent: 'codex', resume: 'aaa', cols: 80, rows: 24 });
    await waitFor(() => c.messages.filter((m) => m.type === 'error' && m.message.includes('conversa desconhecida')).length === 2);
    c.send({ type: 'open', projectPath: fx.p1, agent: 'banana', cols: 80, rows: 24 });
    await errorWith('agente inválido');

    c.send({ type: 'open', projectPath: fx.p1, agent: 'claude', resume: 'aaa', cols: 80, rows: 24 });
    const opened = await waitFor(() => c.messages.find((m) => m.type === 'opened'));
    const id = opened.session.id;
    assert.equal(opened.session.title, 'Titulo novo');
    await waitFor(() => c.messages.some((m) => m.type === 'output' && m.id === id && m.data.includes('WORKDIR:')));

    c.send({ type: 'attach', id });
    const hist = await waitFor(() => c.messages.find((m) => m.type === 'history' && m.id === id));
    assert.ok(hist.data.includes('ARGS:claude --dangerously-skip-permissions --resume aaa'));

    c.send({ type: 'input', id, data: 'oi\r' });
    await waitFor(() => c.messages.find((m) => m.type === 'exit' && m.id === id && m.code === 3));
    await waitFor(() => c.messages.some((m) => m.type === 'sessions' && m.sessions.some((s: any) => s.id === id && !s.alive)));

    c.send({ type: 'close', id });
    await waitFor(() => c.messages.at(-1)?.type === 'sessions' && c.messages.at(-1).sessions.length === 0);
  } finally {
    c.ws.close();
    await app.close();
  }
});

test('WebSocket: tarefas abrem o Claude na pasta de trabalho com a instrucao', async () => {
  const fx = buildFixture();
  const workspace = join(fx.home, 'workspace');
  const { app, port } = await startApp(fx.home, { bin: fakeAgent(fx.home) });
  const c = await connect(port);
  try {
    c.send({ type: 'task', task: 'toString', cols: 80, rows: 24 });
    await waitFor(() => c.messages.find((m) => m.type === 'error' && m.message.includes('tarefa desconhecida')));

    c.send({ type: 'task', task: 'new-skill', cols: 80, rows: 24 });
    const opened = await waitFor(() => c.messages.find((m) => m.type === 'opened'));
    assert.equal(opened.session.title, 'nova skill');
    assert.equal(opened.session.projectPath, workspace);
    assert.ok(existsSync(workspace));
    await waitFor(() =>
      c.messages.some((m) => m.type === 'output' && m.data.includes('ARGS:claude --dangerously-skip-permissions Quero criar uma skill')),
    );

    // Reabrir uma sessao de tarefa: a pasta de trabalho e aceita.
    c.send({ type: 'open', projectPath: workspace, agent: 'claude', cols: 80, rows: 24 });
    await waitFor(() => c.messages.filter((m) => m.type === 'opened').length === 2);
  } finally {
    c.ws.close();
    await app.close();
  }
});

test('WebSocket: create-project cria a pasta na pasta-base e abre o Claude', async () => {
  const fx = buildFixture();
  const { app, port } = await startApp(fx.home, { bin: fakeAgent(fx.home) });
  const c = await connect(port);
  try {
    c.send({ type: 'create-project', name: '../fora', cols: 80, rows: 24 });
    await waitFor(() => c.messages.find((m) => m.type === 'error' && m.message.includes('nome de projeto inválido')));

    c.send({ type: 'create-project', name: 'novo-app', cols: 80, rows: 24 });
    const opened = await waitFor(() => c.messages.find((m) => m.type === 'opened'));
    const path = join(fx.home, 'dev', 'novo-app');
    assert.equal(opened.session.projectPath, path);
    assert.ok(existsSync(path));
    await waitFor(() => c.messages.some((m) => m.type === 'output' && m.data.includes('Este é um projeto novo')));

    c.send({ type: 'create-project', name: 'novo-app', cols: 80, rows: 24 });
    await waitFor(() => c.messages.find((m) => m.type === 'error' && m.message.includes('já existe')));
  } finally {
    c.ws.close();
    await app.close();
  }
});
