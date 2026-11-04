import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempHome } from './helpers.ts';
import { appendIssue, IssueLog } from '../src/voice/issues.ts';
import type { RunResult } from '../src/evolution.ts';

const exec = (cmd: string, args: string[], { cwd }: { cwd: string }) =>
  new Promise<RunResult>((resolve) => {
    execFile(cmd, args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }, (err, stdout, stderr) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` }),
    );
  });

const BASE = '# Issues\n\nIntro.\n\n## Pendentes\n\n### 2. Mais cores\nTexto.\n\n**Situação:** pendente.\n';

async function repo(issues: string | null = BASE) {
  const dir = tempHome();
  const git = async (...args: string[]) => (await exec('git', args, { cwd: dir })).out.trim();
  await git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), '# App\n');
  if (issues !== null) writeFileSync(join(dir, 'ISSUES.md'), issues);
  await git('add', '.');
  await git('commit', '-q', '-m', 'inicio');
  return { dir, git, log: new IssueLog({ repoDir: dir, run: exec }), read: () => readFileSync(join(dir, 'ISSUES.md'), 'utf8') };
}

test('appendIssue: entra no fim de Pendentes, com o proximo numero e a situacao', () => {
  const { number, markdown } = appendIssue(BASE, 'Modo escuro', 'Tema escuro no painel.');
  assert.equal(number, 3);
  assert.equal(markdown, `${BASE}\n### 3. Modo escuro\nTema escuro no painel.\n\n**Situação:** pendente.\n`);
});

test('appendIssue: comeca do 1 numa lista vazia e para antes da secao seguinte', () => {
  const empty = appendIssue('# Issues\n\n## Pendentes\n\n## Depois\n\n### 9. Outra\nX.\n', 'Nova', 'Y.');
  assert.equal(empty.number, 10, 'o numero olha o arquivo inteiro');
  assert.equal(empty.markdown, '# Issues\n\n## Pendentes\n\n### 10. Nova\nY.\n\n**Situação:** pendente.\n\n## Depois\n\n### 9. Outra\nX.\n');
  assert.equal(appendIssue('# Issues\n\n## Pendentes\n', 'Nova', 'Y.').number, 1);
});

test('appendIssue: texto ditado nao cria titulos nem quebra a linha do titulo', () => {
  const { markdown, title } = appendIssue(BASE, '  ## Titulo\n em duas linhas ', 'Antes\n### 99. Falsa\n## Outra secao');
  assert.equal(title, 'Titulo em duas linhas');
  assert.match(markdown, /^### 3\. Titulo em duas linhas\nAntes\n99\. Falsa\nOutra secao\n/m);
  assert.equal(appendIssue(markdown, 'Depois', 'Z.').number, 4);
});

test('appendIssue: recusa texto vazio e arquivo sem Pendentes', () => {
  assert.throws(() => appendIssue(BASE, ' ', 'x'), /faltou/);
  assert.throws(() => appendIssue(BASE, 'x', '\n'), /faltou/);
  assert.throws(() => appendIssue('# Issues\n', 'x', 'y'), /Pendentes/);
});

test('create: grava, faz o commit e deixa o repositorio pronto para aplicar uma evolucao', async () => {
  const { log, git, read } = await repo();
  assert.equal(await log.create('Modo escuro', 'Tema escuro no painel.'), 3);
  assert.match(read(), /### 3\. Modo escuro/);
  assert.equal(await git('log', '-1', '--format=%s'), 'docs: add issue 3: Modo escuro');
  // A mesma conferencia de EvolutionManager.apply.
  assert.equal(await git('status', '--porcelain', '--untracked-files=no'), '');
});

test('create: o commit leva so o ISSUES.md; o que o usuario tinha no stage continua la', async () => {
  const { dir, log, git } = await repo();
  writeFileSync(join(dir, 'README.md'), '# App novo\n');
  await git('add', 'README.md');
  await log.create('Nova', 'Texto.');
  assert.equal(await git('show', '--name-only', '--format=', 'HEAD'), 'ISSUES.md');
  assert.equal(await git('status', '--porcelain'), 'M  README.md');
});

test('create: pedidos ao mesmo tempo ganham numeros diferentes', async () => {
  const { log, read } = await repo();
  assert.deepEqual(await Promise.all([log.create('A', 'a.'), log.create('B', 'b.'), log.create('C', 'c.')]), [3, 4, 5]);
  assert.match(read(), /### 3\. A[\s\S]*### 4\. B[\s\S]*### 5\. C/);
});

test('create: commit recusado devolve o arquivo ao que era e avisa; o proximo pedido funciona', async () => {
  const { dir, log, git, read } = await repo();
  const hook = join(dir, '.git', 'hooks', 'pre-commit');
  writeFileSync(hook, '#!/bin/sh\necho hook recusou >&2\nexit 1\n');
  chmodSync(hook, 0o755);
  await assert.rejects(log.create('Nova', 'Texto.'), /o commit falhou.*hook recusou/);
  assert.equal(read(), BASE);
  assert.equal(await git('status', '--porcelain', '--untracked-files=no'), '');
  assert.equal(await git('log', '--format=%s'), 'inicio');
  writeFileSync(hook, '#!/bin/sh\nexit 0\n');
  assert.equal(await log.create('Nova', 'Texto.'), 3);
});

test('create: commit no meio de um merge falha sem deixar o arquivo alterado', async () => {
  const { dir, log, git, read } = await repo();
  await git('switch', '-q', '-c', 'outra');
  writeFileSync(join(dir, 'README.md'), '# Outra\n');
  await git('commit', '-q', '-am', 'outra');
  await git('switch', '-q', 'main');
  writeFileSync(join(dir, 'README.md'), '# Main\n');
  await git('commit', '-q', '-am', 'main');
  await git('merge', 'outra');
  await assert.rejects(log.create('Nova', 'Texto.'), /o commit falhou/);
  assert.equal(read(), BASE);
});

test('create: sem o ISSUES.md ou sem Pendentes, nada e criado', async () => {
  const missing = await repo(null);
  await assert.rejects(missing.log.create('Nova', 'Texto.'), /não encontrei o ISSUES.md/);
  assert.equal(await missing.git('status', '--porcelain'), '');
  const noSection = await repo('# Issues\n');
  await assert.rejects(noSection.log.create('Nova', 'Texto.'), /Pendentes/);
  assert.equal(noSection.read(), '# Issues\n');
});
