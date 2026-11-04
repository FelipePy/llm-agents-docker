import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempHome, waitFor } from './helpers.ts';
import { EvolutionManager, devPrompt, markUpdateAnnounced, readUpdate, slugify, updateNotice, updateOutcome, ROLLBACK_GRACE_MS, type RunResult, type UpdateRecord } from '../src/evolution.ts';
import type { SessionInfo } from '../src/types.ts';

const exec = (cmd: string, args: string[], cwd: string) =>
  new Promise<RunResult>((resolve) => {
    execFile(cmd, args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }, (err, stdout, stderr) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` }),
    );
  });

async function setup(opts: { npmFails?: string; noWebModules?: boolean } = {}) {
  const home = tempHome();
  const repo = join(home, 'jarvis');
  mkdirSync(join(repo, 'app', 'server', 'node_modules'), { recursive: true });
  if (!opts.noWebModules) mkdirSync(join(repo, 'app', 'web', 'node_modules'), { recursive: true });
  await exec('git', ['init', '-q', '-b', 'main'], repo);
  writeFileSync(join(repo, 'README.md'), '# Jarvis\n');
  writeFileSync(join(repo, '.gitignore'), '.jarvis/\nnode_modules/\n');
  await exec('git', ['add', '.'], repo);
  await exec('git', ['commit', '-q', '-m', 'inicio'], repo);
  const sessions: SessionInfo[] = [];
  const opened: { dir: string; prompt: string; title: string }[] = [];
  const npm: string[] = [];
  const restarts: string[] = [];
  const notices: string[] = [];
  const m = new EvolutionManager({
    repoDir: repo,
    devRoot: join(home, 'dev'),
    stateFile: join(home, 'state', 'evolution.json'),
    updateFile: join(home, 'state', 'update.json'),
    run: async (cmd, args, { cwd }) => {
      if (cmd === 'npm') {
        npm.push(`${cwd === repo ? 'repo' : 'clone'}: ${args.join(' ')}`);
        if (opts.npmFails && args.includes(opts.npmFails)) return { code: 1, out: 'FAIL 1 teste quebrou' };
        return { code: 0, out: '' };
      }
      return exec(cmd, args, cwd);
    },
    openSession: (dir, prompt, title) => {
      opened.push({ dir, prompt, title });
      const s: SessionInfo = { id: `s${sessions.length + 1}`, projectPath: dir, agent: 'claude', title, startedAt: '', alive: true };
      sessions.push(s);
      return s;
    },
    sessions: () => sessions,
    sessionOutput: () => 'Rodando os testes...\nTudo certo.',
    closeSession: (id) => {
      const s = sessions.find((x) => x.id === id);
      if (s) s.alive = false;
    },
    restart: (from) => restarts.push(from),
  });
  return { home, repo, m, sessions, opened, npm, restarts, notices, notify: (t: string) => notices.push(t) };
}

/** A sessao "trabalha" no clone: um commit e o resumo final. */
async function finishWork(dir: string, summary = 'Agora eu digo a previsão da semana.') {
  writeFileSync(join(dir, 'previsao.txt'), 'semana\n');
  await exec('git', ['add', '.'], dir);
  await exec('git', ['commit', '-q', '-m', 'previsao da semana'], dir);
  mkdirSync(join(dir, '.jarvis'), { recursive: true });
  writeFileSync(join(dir, '.jarvis', 'summary.txt'), summary);
}

test('slugify e o prompt da sessao', () => {
  assert.equal(slugify('Previsão do tempo da SEMANA!'), 'previsao-do-tempo-da-semana');
  assert.equal(slugify('???'), 'funcionalidade');
  const p = devPrompt({ title: 'X', spec: 'faz X', state: 'desenvolvendo', branch: 'jarvis/x' });
  assert.match(p, /faz X/);
  assert.match(p, /CLAUDE\.md/);
  assert.match(p, /jarvis\/x/);
  assert.match(p, /\.jarvis\/summary\.txt/);
});

test('dois OKs: so comeca depois do resumo lido e de uma resposta do usuario', async () => {
  const s = await setup();
  assert.match(await s.m.start(1), /resumir_evolucao/);
  assert.match(s.m.draft('Previsão da semana', 'Dizer a previsão dos próximos 7 dias.'), /Proposta guardada/);
  assert.match(await s.m.start(2), /Ainda não li o resumo/);
  assert.match(s.m.summarize('Vou criar a previsão da semana.', 3), /Não chame iniciar_evolucao/);
  assert.match(await s.m.start(3), /ainda não respondeu/, 'mesmo turno do resumo: recusa');
  // Mudou a definicao depois do resumo: volta a rascunho.
  s.m.draft('Previsão da semana', 'Dizer a previsão dos próximos 5 dias.');
  assert.equal(s.m.get()?.state, 'rascunho');
  s.m.summarize('Vou criar a previsão de 5 dias.', 4);
  assert.match(await s.m.start(5), /Comecei/);

  const e = s.m.get()!;
  assert.equal(e.state, 'desenvolvendo');
  assert.equal(e.branch, 'jarvis/previsao-da-semana');
  assert.ok(existsSync(join(e.dir!, 'README.md')), 'clone separado');
  assert.equal((await exec('git', ['branch', '--show-current'], e.dir!)).out.trim(), 'jarvis/previsao-da-semana');
  assert.equal((await exec('git', ['remote'], e.dir!)).out.trim(), '', 'sem remoto: nada de push');
  assert.match(readFileSync(join(e.dir!, '.jarvis', 'spec.md'), 'utf8'), /5 dias/);
  assert.equal(s.opened[0].dir, e.dir);
  assert.match(s.opened[0].prompt, /5 dias/);
  assert.match(s.m.draft('Outra', 'x'), /Já existe uma funcionalidade em andamento/);
  assert.match(await s.m.status(), /em desenvolvimento.*0 commits/s);
});

test('poll avisa quando termina (ate o aviso ser entregue) e quando a sessao para', async () => {
  const s = await setup();
  s.m.draft('Previsão', 'spec');
  s.m.summarize('resumo', 1);
  await s.m.start(2);
  assert.equal(await s.m.poll(), null, 'ainda trabalhando');
  await finishWork(s.m.get()!.dir!);
  assert.match((await s.m.poll())!, /Terminei de desenvolver "Previsão": Agora eu digo a previsão da semana\. Quer que eu aplique/);
  assert.ok(await s.m.poll(), 'repete ate ser entregue');
  s.m.markNotified();
  assert.equal(await s.m.poll(), null);
  assert.equal(s.m.get()?.state, 'pronto');

  const t = await setup();
  t.m.draft('Previsão', 'spec');
  t.m.summarize('resumo', 1);
  await t.m.start(2);
  t.sessions[0].alive = false;
  assert.match((await t.m.poll())!, /parou antes de terminar/);
  assert.equal(t.m.get()?.state, 'parado');
});

async function ready(opts?: { npmFails?: string; noWebModules?: boolean }) {
  const s = await setup(opts);
  s.m.draft('Previsão', 'spec');
  s.m.summarize('resumo', 1);
  await s.m.start(2);
  await finishWork(s.m.get()!.dir!);
  await s.m.poll();
  s.m.markNotified();
  return s;
}

test('aplicar: verifica no clone, junta no repositorio, grava o update e reinicia', async () => {
  const s = await ready();
  const base = (await exec('git', ['rev-parse', 'HEAD'], s.repo)).out.trim();
  assert.match(await s.m.apply({}, s.notify), /Comecei a verificar/);
  await waitFor(() => s.restarts.length === 1);
  assert.equal(s.restarts[0], base);
  assert.deepEqual(s.npm, [
    'clone: --prefix app/server ci --silent',
    'clone: --prefix app/web ci --silent',
    'clone: --prefix app/server test',
    'clone: --prefix app/server run typecheck',
    'clone: --prefix app/web test',
    'clone: --prefix app/web run typecheck',
    'clone: --prefix app/web run build',
    'repo: --prefix app/web run build',
  ]);
  assert.ok(existsSync(join(s.repo, 'previsao.txt')), 'codigo novo no repositorio');
  const u = readUpdate(join(s.home, 'state', 'update.json'))!;
  assert.equal(u.from, base);
  assert.equal(u.to, (await exec('git', ['rev-parse', 'HEAD'], s.repo)).out.trim());
  assert.equal(u.summary, 'Agora eu digo a previsão da semana.');
  assert.equal(u.desktop, false);
  assert.equal(u.announced, false);
  assert.equal(s.m.get()?.state, 'aplicando');
  // Novo servidor, reinicio deu certo: apaga o clone.
  const dir = s.m.get()!.dir!;
  s.m.finish();
  assert.equal(s.m.get(), undefined);
  assert.ok(!existsSync(dir));
});

test('aplicar na instalacao do app desktop (interface sem node_modules): instala antes de compilar', async () => {
  const s = await ready({ noWebModules: true });
  await s.m.apply({}, s.notify);
  await waitFor(() => s.restarts.length === 1);
  assert.deepEqual(s.npm.filter((c) => c.startsWith('repo:')), ['repo: --prefix app/web ci --silent', 'repo: --prefix app/web run build']);
});

test('aplicar recusa repositorio sujo e avisa das sessoes que serao fechadas', async () => {
  const s = await ready();
  writeFileSync(join(s.repo, 'README.md'), '# mudado\n');
  assert.match(await s.m.apply({}, s.notify), /alterações não salvas/);
  await exec('git', ['checkout', 'README.md'], s.repo);
  s.sessions.push({ id: 'outra', projectPath: '/w/app', agent: 'claude', title: 'corrigir login', startedAt: '', alive: true });
  assert.match(await s.m.apply({}, s.notify), /fecha 1 sessão\(ões\) aberta\(s\): corrigir login.*confirmar_fechar_sessoes/s);
  assert.equal(s.restarts.length, 0);
  assert.match(await s.m.apply({ closeSessions: true }, s.notify), /Comecei/);
  await waitFor(() => s.restarts.length === 1);
});

test('verificacao que falha: nada muda no repositorio e o usuario e avisado', async () => {
  const s = await ready({ npmFails: 'typecheck' });
  const before = (await exec('git', ['rev-parse', 'HEAD'], s.repo)).out.trim();
  await s.m.apply({}, s.notify);
  await waitFor(() => s.notices.length === 1);
  assert.match(s.notices[0], /Não apliquei "Previsão": a verificação "tipos do servidor" falhou:\nFAIL 1 teste quebrou/);
  assert.equal((await exec('git', ['rev-parse', 'HEAD'], s.repo)).out.trim(), before);
  assert.equal(s.restarts.length, 0);
  assert.equal(s.m.get()?.state, 'pronto');
  assert.match(await s.m.status(), /última tentativa de aplicar falhou/);
});

test('descartar fecha a sessao e apaga o clone', async () => {
  const s = await setup();
  s.m.draft('Previsão', 'spec');
  s.m.summarize('resumo', 1);
  await s.m.start(2);
  const dir = s.m.get()!.dir!;
  assert.match(await s.m.discard(), /Descartei "Previsão"/);
  assert.equal(s.sessions[0].alive, false);
  assert.ok(!existsSync(dir));
  assert.equal(s.m.get(), undefined);
});

test('estado sobrevive ao reinicio: aplicando com update a anunciar continua; sem update volta a "pronto"', async () => {
  const s = await ready();
  await s.m.apply({}, s.notify);
  await waitFor(() => s.restarts.length === 1);
  const deps = (s.m as unknown as { deps: ConstructorParameters<typeof EvolutionManager>[0] }).deps;
  assert.equal(new EvolutionManager(deps).get()?.state, 'aplicando', 'servidor novo depois do reinicio');
  markUpdateAnnounced(deps.updateFile);
  assert.equal(new EvolutionManager(deps).get()?.state, 'pronto', 'aplicacao interrompida');
});

test('updateNotice: sucesso com as verificacoes, verificacao opcional falha, rollback', () => {
  const base: UpdateRecord = { from: 'a', to: 'b', title: 'Previsão', summary: 'Agora eu digo a previsão da semana.', startedAt: '', desktop: false, announced: false };
  const check = (name: string, ok = true, essential = true, error?: string) => ({ name, ok, essential, ms: 10, error });
  assert.equal(
    updateNotice({ ...base, checks: [check('catalogo'), check('ferramentas'), check('voz'), check('cerebro', true, false), check('web')] }),
    'Atualização aplicada com sucesso: Agora eu digo a previsão da semana. Verifiquei os projetos, as ferramentas, a voz, o cérebro e a interface: está tudo funcionando.',
  );
  assert.match(
    updateNotice({ ...base, desktop: true, checks: [check('catalogo'), check('cerebro', false, false, 'sem internet')] }),
    /o essencial está funcionando\. Só o cérebro não respondeu \(sem internet\)\. A parte do app desktop só vale com um instalador novo\./,
  );
  assert.equal(
    updateNotice({ ...base, rolledBack: true, checks: [check('catalogo'), check('voz', false, true, 'worker não subiu')] }),
    'A atualização "Previsão" não passou nas verificações: a voz não funcionou (worker não subiu). Voltei para a versão anterior e está tudo funcionando como antes. Quer que eu peça a correção?',
  );
  const file = join(tempHome(), 'u.json');
  writeFileSync(file, JSON.stringify(base));
  markUpdateAnnounced(file);
  assert.equal(readUpdate(file)?.announced, true);
});

test('updateOutcome: espera o restart.sh voltar atras; sem volta, anuncia a falha', () => {
  const base: UpdateRecord = { from: 'a', to: 'b', title: 'Sessões', summary: 's', startedAt: '', desktop: false, announced: false };
  const check = (name: string, ok = true, essential = true, error?: string) => ({ name, ok, essential, ms: 10, error });
  const now = Date.parse('2026-11-03T15:00:00Z');
  const failing = { ...base, checks: [check('catalogo', false, true, 'sem resposta em 20 s'), check('web')] };
  assert.equal(updateOutcome(null, now), 'wait');
  assert.equal(updateOutcome(base, now), 'wait', 'sem verificacoes ainda');
  assert.equal(updateOutcome({ ...base, checks: [check('web'), check('cerebro', false, false)] }, now), 'ok');
  assert.equal(updateOutcome({ ...failing, rolledBack: true }, now), 'rolledBack');
  assert.equal(updateOutcome({ ...failing, checkedAt: new Date(now - 5_000).toISOString() }, now), 'wait', 'restart.sh ainda pode voltar atras');
  assert.equal(updateOutcome({ ...failing, checkedAt: new Date(now - ROLLBACK_GRACE_MS).toISOString() }, now), 'failed');
  assert.equal(updateOutcome(failing, now), 'failed', 'registro antigo, sem checkedAt');
  assert.equal(updateOutcome({ ...failing, announced: true }, now), 'wait');
  assert.equal(
    updateNotice(failing),
    'A atualização "Sessões" foi aplicada e o código novo está no ar, mas uma verificação falhou: os projetos (sem resposta em 20 s). Não consegui voltar para a versão anterior sozinho; vale conferir os projetos.',
  );
});
