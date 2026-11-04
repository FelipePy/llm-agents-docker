import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionWatcher, countWorking, findError, looksBusy, plainReport, usefulLines } from '../src/voice/session-watch.ts';
import type { SessionInfo } from '../src/types.ts';

function setup(opts: { quietMs?: number; summarize?: ConstructorParameters<typeof SessionWatcher>[0]['summarize'] } = {}) {
  let now = 0;
  const outputs = new Map<string, string>();
  const sessions = new Map<string, SessionInfo>();
  const add = (id: string, output = '') => {
    sessions.set(id, { id, projectPath: '/w/app', agent: 'claude', title: 't', startedAt: '2026-11-03T10:00:00Z', alive: true });
    outputs.set(id, output);
  };
  const w = new SessionWatcher({
    sessions: () => [...sessions.values()],
    output: (id) => outputs.get(id) ?? null,
    now: () => now,
    quietMs: opts.quietMs ?? 30_000,
    summarize: opts.summarize,
  });
  return {
    w,
    add,
    sessions,
    write: (id: string, s: string) => outputs.set(id, (outputs.get(id) ?? '') + s),
    advance: (ms: number) => (now += ms),
  };
}

test('usefulLines tira cores, molduras e dicas; movimentos do cursor separam linhas', () => {
  const lines = usefulLines('\x1b[32m● Pronto\x1b[0m: 12 testes passaram\x1b[2;1H╭────╮\r\n? for shortcuts\x1b[3;1HCommit criado');
  assert.deepEqual(lines, ['Pronto: 12 testes passaram', 'Commit criado']);
});

test('findError acha linhas de erro de verdade, mas nao frases que citam erro', () => {
  assert.equal(findError('rodando\n⎿ API Error: 529 Overloaded\n'), 'API Error: 529 Overloaded');
  assert.match(findError('Traceback (most recent call last):\n  File "x.py"\nValueError: ruim\n') ?? '', /ValueError: ruim/);
  assert.equal(findError('Corrigi o erro de login e os testes passaram.\nNenhum error encontrado.'), null);
  assert.equal(findError('fatal: not a git repository'), 'fatal: not a git repository');
});

test('looksBusy: o agente ainda mostra "esc to interrupt"', () => {
  assert.equal(looksBusy('✻ Pensando… (12s · esc to interrupt)'), true);
  assert.equal(looksBusy('Pronto.\n> '), false);
});

test('avisa que terminou depois de um tempo sem saida nova, uma vez so', () => {
  const t = setup();
  t.add('s1', 'Comecando');
  t.w.watch('s1', 'Claude de app');
  t.advance(20_000);
  t.write('s1', '\nEditando arquivos');
  assert.deepEqual(t.w.reports(), [], 'saida nova: ainda trabalhando');
  t.advance(20_000);
  assert.deepEqual(t.w.reports(), [], 'pouco tempo quieto');
  t.write('s1', '\nTodos os testes passaram e fiz o commit.');
  t.w.reports();
  t.advance(31_000);
  const [r] = t.w.reports();
  assert.equal(r.outcome, 'done');
  assert.equal(r.label, 'Claude de app');
  assert.match(r.tail, /fiz o commit/);
  assert.equal(t.w.isWatching('s1'), false);
  t.advance(60_000);
  assert.deepEqual(t.w.reports(), []);
});

test('nao avisa enquanto o agente mostra que esta trabalhando', () => {
  const t = setup();
  t.add('s1', 'Rodando (esc to interrupt)');
  t.w.watch('s1', 'Claude de app');
  t.advance(120_000);
  assert.deepEqual(t.w.reports(), []);
});

test('avisa erro quando a sessao para com uma linha de erro no fim', () => {
  const t = setup();
  t.add('s1', 'Trabalhando\n● API Error: 401 invalid api key');
  t.w.watch('s1', 'Claude de app');
  t.advance(31_000);
  const [r] = t.w.reports();
  assert.equal(r.outcome, 'error');
  assert.equal(r.error, 'API Error: 401 invalid api key');
});

test('processo encerrado: codigo 0 terminou; outro codigo e erro; fechada some sem aviso', () => {
  const t = setup();
  t.add('ok', 'feito');
  t.add('ruim', 'algo');
  t.add('fechada');
  for (const id of ['ok', 'ruim', 'fechada']) t.w.watch(id, id);
  Object.assign(t.sessions.get('ok')!, { alive: false, exitCode: 0 });
  Object.assign(t.sessions.get('ruim')!, { alive: false, exitCode: 2 });
  t.sessions.delete('fechada');
  const rs = t.w.reports();
  assert.deepEqual(rs.map((r) => [r.id, r.outcome]), [['ok', 'done'], ['ruim', 'error']]);
  assert.match(rs[1].error ?? '', /código 2/);
  assert.deepEqual(t.w.list(), []);
});

test('check usa o resumo do cerebro e, se ele falhar, o texto simples', async () => {
  const t = setup({ summarize: async (r) => (r.id === 'a' ? 'Senhor, o Claude terminou: testes passando. Quer que eu conte mais?' : Promise.reject(new Error('x'))) });
  t.add('a', 'fim a');
  t.add('b', 'fim b');
  t.w.watch('a', 'Claude de app');
  t.w.watch('b', 'Codex de api');
  t.advance(31_000);
  const texts = await t.w.check();
  assert.equal(texts[0], 'Senhor, o Claude terminou: testes passando. Quer que eu conte mais?');
  assert.match(texts[1], /Codex de api terminou.*fim b.*conte mais/);
});

test('plainReport de erro diz o erro', () => {
  assert.equal(plainReport({ id: 'x', label: 'Claude de app', outcome: 'error', tail: '', error: 'fatal: boom' }), 'Senhor, a sessão do Claude de app deu erro: fatal: boom.');
});

test('unwatch para de acompanhar', () => {
  const t = setup();
  t.add('s1', 'x');
  t.w.watch('s1', 'a');
  assert.equal(t.w.unwatch('s1'), true);
  assert.equal(t.w.unwatch('s1'), false);
  t.advance(60_000);
  assert.deepEqual(t.w.reports(), []);
});

test('rewatch volta a acompanhar so sessoes ja acompanhadas; unwatch e sessao fechada esquecem', () => {
  const t = setup();
  t.add('s1', 'inicio');
  t.add('s2', 'x');
  assert.equal(t.w.rewatch('s1'), false, 'nunca acompanhada');
  t.w.watch('s1', 'Claude de app');
  t.advance(31_000);
  assert.equal(t.w.reports().length, 1);
  assert.equal(t.w.isWatching('s1'), false);
  t.write('s1', '\nnovo recado');
  assert.equal(t.w.rewatch('s1'), true);
  assert.deepEqual(t.w.list(), [{ id: 's1', label: 'Claude de app' }]);
  t.advance(10_000);
  assert.deepEqual(t.w.reports(), [], 'o tempo quieto recomeca no recado novo');
  t.advance(31_000);
  assert.equal(t.w.reports()[0].label, 'Claude de app');
  assert.equal(t.w.unwatch('s1'), true, 'parar de acompanhar uma sessao ja avisada');
  assert.equal(t.w.rewatch('s1'), false);
  t.w.watch('s2', 'Codex');
  t.sessions.delete('s2');
  t.w.reports();
  assert.equal(t.w.rewatch('s2'), false, 'fechada: esquecida');
});

test('countWorking conta so os agentes vivos trabalhando', () => {
  const session = (id: string, agent: SessionInfo['agent'], alive = true): SessionInfo => ({
    id, projectPath: '/w/app', agent, title: 't', startedAt: '2026-11-03T10:00:00Z', alive,
  });
  const screens: Record<string, string> = {
    claude: 'Lendo arquivos (esc to interrupt)',
    codex: 'Working (esc to interrupt)',
    parado: 'Pronto.\n> ',
    dialogo: 'Yes, I trust this folder\nEnter to confirm · Esc to cancel',
    morto: 'Lendo arquivos (esc to interrupt)',
    shell: 'grep "esc to interrupt" README.md',
  };
  const count = (sessions: SessionInfo[]) => countWorking(sessions, (id) => screens[id] ?? null);
  assert.equal(count([]), 0);
  assert.equal(count([session('parado', 'claude')]), 0);
  assert.equal(count([session('dialogo', 'claude')]), 0, 'esperando o usuario num dialogo: nao trabalha');
  assert.equal(count([session('morto', 'claude', false)]), 0);
  assert.equal(count([session('shell', 'shell')]), 0);
  assert.equal(count([session('sumiu', 'claude')]), 0, 'sem tela: nao trabalha');
  assert.equal(count([session('claude', 'claude'), session('codex', 'codex'), session('parado', 'claude'), session('shell', 'shell')]), 2);
});
