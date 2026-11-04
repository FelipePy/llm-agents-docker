import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionWatcher, TrustWatcher, waitingForTrust, countWorking, findError, looksBusy, plainReport, quickReport, usefulLines } from '../src/voice/session-watch.ts';
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
    set: (id: string, s: string) => outputs.set(id, s),
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

test('looksBusy so olha o fim da tela: citar a frase numa resposta antiga nao conta', () => {
  assert.equal(looksBusy(`O indicador "esc to interrupt" sumiu.\n${'linha\n'.repeat(12)}> `), false);
});

const WORKING_LINE = '\n✻ Pensando… (esc to interrupt)';
const IDLE_SCREEN = '\nTestes passaram e fiz o commit.\n> ';

test('agente que mostrou o indicador: avisa logo depois de ele sumir e a tela parar', () => {
  const t = setup();
  t.add('s1', 'Comecando');
  t.w.watch('s1', 'Claude de app');
  t.write('s1', WORKING_LINE);
  assert.deepEqual(t.w.reports(), [], 'trabalhando');
  t.set('s1', `Comecando${IDLE_SCREEN}`);
  assert.deepEqual(t.w.reports(), [], 'a tela acabou de mudar');
  t.advance(2_000);
  assert.deepEqual(t.w.reports(), [], 'ainda dentro da espera curta');
  t.advance(1_000);
  const [r] = t.w.reports();
  assert.equal(r.outcome, 'done');
  assert.match(r.tail, /fiz o commit/);
});

test('indicador sumido com a tela ainda mudando nao e o fim', () => {
  const t = setup();
  t.add('s1', `x${WORKING_LINE}`);
  t.w.watch('s1', 'Claude de app');
  t.w.reports();
  for (let i = 0; i < 5; i++) {
    t.set('s1', `linha ${i}`);
    assert.deepEqual(t.w.reports(), []);
    t.advance(2_000);
  }
});

test('shell nao usa a espera curta, mesmo mostrando a frase do indicador', () => {
  const t = setup();
  t.add('s1', 'grep "esc to interrupt" README.md');
  t.sessions.get('s1')!.agent = 'shell';
  t.w.watch('s1', 'Shell de app');
  t.w.reports();
  t.set('s1', 'pronto');
  t.w.reports();
  t.advance(10_000);
  assert.deepEqual(t.w.reports(), []);
  t.advance(21_000);
  assert.equal(t.w.reports().length, 1);
});

test('rewatch recomeca sem o indicador visto antes: vale de novo a espera longa ate ele aparecer', () => {
  const t = setup();
  t.add('s1', `x${WORKING_LINE}`);
  t.w.watch('s1', 'Claude de app');
  t.w.reports();
  t.set('s1', 'parou');
  t.w.reports();
  t.advance(3_000);
  assert.equal(t.w.reports().length, 1);
  assert.equal(t.w.rewatch('s1'), true);
  t.advance(10_000);
  assert.deepEqual(t.w.reports(), []);
});

test('agente que volta a trabalhar logo depois do aviso volta a ser acompanhado, sem falar nada', () => {
  const t = setup();
  t.add('s1', `x${WORKING_LINE}`);
  t.w.watch('s1', 'Claude de app');
  t.w.reports();
  t.set('s1', 'pausa');
  t.w.reports();
  t.advance(3_000);
  assert.equal(t.w.reports().length, 1);
  t.set('s1', `pausa${WORKING_LINE}`);
  assert.deepEqual(t.w.reports(), []);
  assert.equal(t.w.isWatching('s1'), true);
  t.set('s1', 'fim de verdade');
  t.w.reports();
  t.advance(3_000);
  assert.match(t.w.reports()[0].tail, /fim de verdade/);
});

test('depois do prazo, o agente trabalhando de novo nao reabre o acompanhamento; unwatch tambem nao', () => {
  const t = setup();
  t.add('a', 'fim');
  t.add('b', 'fim');
  t.w.watch('a', 'A');
  t.w.watch('b', 'B');
  t.advance(31_000);
  assert.equal(t.w.reports().length, 2);
  t.w.unwatch('b');
  t.set('b', `fim${WORKING_LINE}`);
  t.w.reports();
  assert.equal(t.w.isWatching('b'), false, 'parou de acompanhar');
  t.advance(61_000);
  t.set('a', `fim${WORKING_LINE}`);
  t.w.reports();
  assert.equal(t.w.isWatching('a'), false, 'passou do prazo');
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

const flush = () => new Promise<void>((ok) => setImmediate(ok));

function deferred() {
  let resolve!: (text: string) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<string>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test('deliver fala o aviso curto na hora e o resumo quando ele ficar pronto', async () => {
  const d = deferred();
  const t = setup({ summarize: () => d.promise });
  t.add('a', 'fim a');
  t.w.watch('a', 'Claude de app');
  t.advance(31_000);
  const said: string[] = [];
  const say = (text: string) => (said.push(text), true);
  t.w.deliver(say);
  assert.deepEqual(said, ['Senhor, a sessão do Claude de app terminou.']);
  t.w.deliver(say);
  assert.equal(said.length, 1, 'nao repete o aviso curto');
  d.resolve('Claude de app: testes passando. Quer que eu conte mais?');
  await flush();
  t.w.deliver(say);
  assert.equal(said[1], 'Claude de app: testes passando. Quer que eu conte mais?');
  t.w.deliver(say);
  assert.equal(said.length, 2, 'uma vez so');
});

test('deliver: resumo pronto antes de o Jarvis ficar livre vai numa fala so', async () => {
  const t = setup({ summarize: async () => 'Senhor, No Claude de app os testes passaram.' });
  t.add('a', 'fim a');
  t.w.watch('a', 'Claude de app');
  t.advance(31_000);
  t.w.deliver(() => false);
  await flush();
  const said: string[] = [];
  t.w.deliver((text) => (said.push(text), true));
  assert.deepEqual(said, ['Senhor, no Claude de app os testes passaram.']);
});

test('deliver: resumo que falha ou vem vazio cai no texto simples', async () => {
  const t = setup({ summarize: async (r) => (r.id === 'a' ? '' : Promise.reject(new Error('x'))) });
  t.add('a', 'fim a');
  t.add('b', 'fim b');
  t.w.watch('a', 'Claude de app');
  t.w.watch('b', 'Codex de api');
  t.advance(31_000);
  t.w.deliver(() => false);
  await flush();
  const said: string[] = [];
  t.w.deliver((text) => (said.push(text), true));
  assert.match(said[0], /Claude de app terminou\. As últimas linhas dizem: fim a.*conte mais/);
  assert.match(said[1], /Codex de api terminou\. As últimas linhas dizem: fim b.*conte mais/);
});

test('deliver: um resumo demorado nao segura o aviso de outra sessao', async () => {
  const lento = deferred();
  const t = setup({ summarize: (r) => (r.id === 'a' ? lento.promise : Promise.resolve('Codex de api: pronto.')) });
  t.add('a', 'fim a');
  t.add('b', 'fim b');
  t.w.watch('a', 'Claude de app');
  t.w.watch('b', 'Codex de api');
  t.advance(31_000);
  const said: string[] = [];
  const say = (text: string) => (said.push(text), true);
  t.w.deliver(say);
  await flush();
  t.w.deliver(say);
  assert.deepEqual(said, ['Senhor, a sessão do Claude de app terminou.', 'Senhor, a sessão do Codex de api terminou.', 'Codex de api: pronto.']);
});

test('deliver: parar de acompanhar descarta o resumo que ainda nao foi falado', async () => {
  const d = deferred();
  const t = setup({ summarize: () => d.promise });
  t.add('a', 'fim a');
  t.w.watch('a', 'Claude de app');
  t.advance(31_000);
  const said: string[] = [];
  const say = (text: string) => (said.push(text), true);
  t.w.deliver(say);
  t.w.unwatch('a');
  d.resolve('Claude de app: pronto.');
  await flush();
  t.w.deliver(say);
  assert.equal(said.length, 1);
});

test('deliver registra os tempos de cada etapa', async () => {
  let now = 0;
  const lines: string[] = [];
  const d = deferred();
  const session: SessionInfo = { id: 'a', projectPath: '/w/app', agent: 'claude', title: 't', startedAt: '', alive: true };
  const w = new SessionWatcher({ sessions: () => [session], output: () => 'fim', now: () => now, summarize: () => d.promise, log: (l) => lines.push(l) });
  w.watch('a', 'Claude de app');
  now += 31_000;
  w.deliver(() => true);
  now += 2_000;
  d.resolve('Claude de app: pronto.');
  await flush();
  now += 1_000;
  w.deliver(() => true);
  assert.deepEqual(lines, ['aviso de Claude de app: tela parada ha 31.0 s, aviso curto em 0.0 s, resumo pronto em 2.0 s, fala final em 3.0 s']);
});

test('sem cerebro, deliver fala tudo de uma vez', () => {
  const t = setup();
  t.add('a', 'fim a');
  t.w.watch('a', 'Claude de app');
  t.advance(31_000);
  const said: string[] = [];
  t.w.deliver((text) => (said.push(text), true));
  assert.equal(said.length, 1);
  assert.match(said[0], /^Senhor, a sessão do Claude de app terminou\. As últimas linhas dizem: fim a/);
});

test('quickReport e plainReport de erro dizem o erro', () => {
  const r = { id: 'x', label: 'Claude de app', outcome: 'error' as const, tail: '', error: 'fatal: boom' };
  assert.equal(quickReport(r), 'Senhor, a sessão do Claude de app deu erro.');
  assert.equal(plainReport(r), 'O erro foi: fatal: boom.');
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

const TRUST_SCREEN = 'Quick safety check\n❯ 1. No, exit\n  2. Yes, I trust this folder\nEnter to confirm';

test('waitingForTrust so olha o fim da tela: citar a frase antes nao conta', () => {
  assert.equal(waitingForTrust(TRUST_SCREEN), true);
  assert.equal(waitingForTrust('Rodando os testes...'), false);
  assert.equal(waitingForTrust(`${TRUST_SCREEN}\n${'trabalhando\n'.repeat(40)}`), false);
});

function trustSetup() {
  let now = 0;
  const screens = new Map<string, string>();
  const list: SessionInfo[] = [];
  const add = (id: string, screen: string, extra: Partial<SessionInfo> = {}) => {
    list.push({ id, projectPath: '/w/app', agent: 'claude', title: `sessao ${id}`, startedAt: '', alive: true, ...extra });
    screens.set(id, screen);
  };
  const w = new TrustWatcher({ sessions: () => list, output: (id) => screens.get(id) ?? null, now: () => now, graceMs: 30_000 });
  return { w, add, screens, advance: (ms: number) => (now += ms) };
}

test('TrustWatcher espera um tempo, insiste ate falar e depois avisa uma vez so', () => {
  const t = trustSetup();
  t.add('s1', TRUST_SCREEN);
  assert.deepEqual(t.w.pending(), [], 'acabou de abrir: o usuario pode estar olhando');
  t.advance(30_000);
  const [first] = t.w.pending();
  assert.equal(first.id, 's1');
  assert.match(first.text, /sessao s1.*confia na pasta/);
  assert.equal(t.w.pending().length, 1, 'nao conseguiu falar: continua pendente');
  t.w.markWarned('s1');
  t.advance(60_000);
  assert.deepEqual(t.w.pending(), []);
});

test('TrustWatcher nao avisa quem ja respondeu e recomeca a espera', () => {
  const t = trustSetup();
  t.add('s1', TRUST_SCREEN);
  t.w.pending();
  t.advance(20_000);
  t.screens.set('s1', 'Rodando os testes...');
  assert.deepEqual(t.w.pending(), []);
  t.screens.set('s1', TRUST_SCREEN);
  t.advance(20_000);
  assert.deepEqual(t.w.pending(), [], 'a espera recomecou');
});

test('TrustWatcher ignora sessoes encerradas e outros agentes', () => {
  const t = trustSetup();
  t.add('morta', TRUST_SCREEN, { alive: false });
  t.add('shell', TRUST_SCREEN, { agent: 'shell' });
  t.w.pending();
  t.advance(30_000);
  assert.deepEqual(t.w.pending(), []);
});
