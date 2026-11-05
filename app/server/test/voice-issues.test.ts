import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
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
  writeFileSync(join(dir, '.gitignore'), 'ISSUES.md\n');
  if (issues !== null) writeFileSync(join(dir, 'ISSUES.md'), issues);
  await git('add', '.');
  await git('commit', '-q', '-m', 'inicio');
  return { dir, git, log: new IssueLog({ repoDir: dir }), read: () => readFileSync(join(dir, 'ISSUES.md'), 'utf8') };
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

test('create: grava no arquivo, sem commit, e deixa o repositorio pronto para aplicar uma evolucao', async () => {
  const { log, git, read } = await repo();
  assert.equal(await log.create('Modo escuro', 'Tema escuro no painel.'), 3);
  assert.match(read(), /### 3\. Modo escuro/);
  assert.equal(await git('log', '--format=%s'), 'inicio');
  // A mesma conferencia de EvolutionManager.apply.
  assert.equal(await git('status', '--porcelain', '--untracked-files=no'), '');
});

test('create: o que o usuario tinha no stage continua la, e o arquivo fica fora do git', async () => {
  const { dir, log, git } = await repo();
  writeFileSync(join(dir, 'README.md'), '# App novo\n');
  await git('add', 'README.md');
  await log.create('Nova', 'Texto.');
  assert.equal(await git('status', '--porcelain'), 'M  README.md');
  assert.equal(await git('ls-files', 'ISSUES.md'), '');
});

test('create: pedidos ao mesmo tempo ganham numeros diferentes', async () => {
  const { log, read } = await repo();
  assert.deepEqual(await Promise.all([log.create('A', 'a.'), log.create('B', 'b.'), log.create('C', 'c.')]), [3, 4, 5]);
  assert.match(read(), /### 3\. A[\s\S]*### 4\. B[\s\S]*### 5\. C/);
});

test('create: sem o ISSUES.md (clone novo), cria o arquivo com a secao Pendentes', async () => {
  const { dir, log, git, read } = await repo(null);
  assert.equal(existsSync(join(dir, 'ISSUES.md')), false);
  assert.equal(await log.create('Nova', 'Texto.'), 1);
  assert.match(read(), /^# Issues\n[\s\S]*## Pendentes\n\n### 1\. Nova\nTexto\./);
  assert.equal(await git('status', '--porcelain'), '');
});

test('create: arquivo sem Pendentes fica como estava', async () => {
  const noSection = await repo('# Issues\n');
  await assert.rejects(noSection.log.create('Nova', 'Texto.'), /Pendentes/);
  assert.equal(noSection.read(), '# Issues\n');
});

test('create: arquivo ilegivel avisa e o proximo pedido funciona', async () => {
  const dir = tempHome();
  const log = new IssueLog({ repoDir: dir });
  mkdirSync(join(dir, 'ISSUES.md'));
  await assert.rejects(log.create('Nova', 'Texto.'), /não consegui ler o ISSUES\.md/);
  rmdirSync(join(dir, 'ISSUES.md'));
  assert.equal(await log.create('Nova', 'Texto.'), 1);
});
