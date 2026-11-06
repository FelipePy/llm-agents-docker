import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildOverview, gitInfo, listProjects, listSkills, projectDetail, projectId, projectPathFromId, projectsBase, readProfile,
} from '../src/catalog.ts';
import { scanConversations } from '../src/conversations.ts';
import { buildFixture } from './fixture.ts';
import { jsonl, tempHome, write } from './helpers.ts';

test('projectId e reversivel', () => {
  assert.equal(projectPathFromId(projectId('/home/a-b/c')), '/home/a-b/c');
});

test('listProjects ignora projetos apagados e a home', async () => {
  const fx = buildFixture();
  const projects = await listProjects(fx.home, await scanConversations(fx.home));
  assert.equal(projects.length, 1);
  assert.deepEqual(projects[0], {
    id: projectId(fx.p1),
    name: 'meu-app',
    path: fx.p1,
    updatedAt: '2026-10-03T00:00:00.000Z',
    conversations: 3,
    agents: ['claude', 'codex'],
  });
});

test('projectDetail traz conversas, instrucoes e memoria', async () => {
  const fx = buildFixture();
  const convs = await scanConversations(fx.home);
  const d = await projectDetail(fx.home, fx.p1, convs);
  assert.ok(d);
  assert.deepEqual(d.conversationList.map((c) => c.id), ['cdx-1', 'bbb', 'aaa']);
  assert.deepEqual(d.instructions.map((f) => f.path), [join(fx.p1, 'CLAUDE.md')]);
  assert.deepEqual(
    d.memory.map((f) => f.path),
    ['MEMORY.md', 'project_x.md', 'user_role.md'].map((n) => join(fx.claudeDir, 'memory', n)),
  );
  assert.equal(d.git, null);
  assert.equal(await projectDetail(fx.home, fx.p2, convs), null);
});

test('gitInfo le branch e mudancas pendentes', async () => {
  const dir = join(tempHome(), 'repo');
  mkdirSync(dir);
  execFileSync('git', ['init', '-q', '-b', 'principal', dir]);
  assert.deepEqual(await gitInfo(dir), { branch: 'principal', dirty: false });
  write(join(dir, 'novo.txt'), 'x');
  assert.deepEqual(await gitInfo(dir), { branch: 'principal', dirty: true });
});

test('readProfile traz instrucoes globais e so memorias do tipo user', async () => {
  const fx = buildFixture();
  const p = await readProfile(fx.home);
  assert.deepEqual(p.instructions.map((f) => f.path), [join(fx.home, '.claude', 'CLAUDE.md')]);
  assert.deepEqual(p.memories.map((f) => f.path), [
    join(fx.home, '.codex', 'memories', 'MEMORY.md'),
    join(fx.claudeDir, 'memory', 'user_role.md'),
  ]);
});

test('listSkills junta Claude, Codex e plugins', async () => {
  const fx = buildFixture();
  const skills = await listSkills(fx.home);
  assert.deepEqual(
    skills.map((s) => [s.name, s.origin, s.description]),
    [
      ['alpha', 'claude', 'Primeira skill'],
      ['beta', 'codex', 'Do Codex'],
      ['gamma', 'plugin:p1', 'De um plugin'],
      ['semfm', 'claude', ''],
    ],
  );
});

test('buildOverview so lista conversas de projetos existentes', async () => {
  const fx = buildFixture();
  const o = await buildOverview(fx.home);
  assert.deepEqual(o.conversations.map((c) => c.id), ['cdx-1', 'bbb', 'aaa']);
  assert.equal(o.projects.length, 1);
  assert.equal(o.skills.length, 4);
});

test('buildOverview esconde pastas ocultas e informa a pasta de projetos', async () => {
  const fx = buildFixture();
  const ws = join(fx.home, 'ws');
  mkdirSync(ws);
  write(join(fx.home, '.claude', 'projects', '-ws', 'w1.jsonl'), jsonl({ type: 'user', cwd: ws, message: { content: 'oi' } }));
  assert.equal((await buildOverview(fx.home)).projects.length, 2);
  const o = await buildOverview(fx.home, { hidden: [ws] });
  assert.deepEqual(o.projects.map((p) => p.name), ['meu-app']);
  assert.equal(o.projectsDir, join(fx.home, 'dev'));
  assert.equal((await buildOverview(fx.home, { projectsDir: '/x/y' })).projectsDir, '/x/y');
});

test('listProjects acha repositorios sem conversas na pasta de projetos', async () => {
  const fx = buildFixture();
  const dev = join(fx.home, 'dev');
  for (const dir of ['solto/.git', 'trabalho/api/.git', 'trabalho/fundo/mais/.git', 'sem-git/src', '.oculto/.git', 'node_modules/pacote/.git', 'solto/sub/.git']) {
    mkdirSync(join(dev, dir), { recursive: true });
  }
  const convs = await scanConversations(fx.home);
  const projects = await listProjects(fx.home, convs);
  assert.deepEqual(projects.map((p) => p.path).sort(), [fx.p1, join(dev, 'solto'), join(dev, 'trabalho', 'api')].sort());
  const api = projects.find((p) => p.name === 'api')!;
  assert.deepEqual([api.conversations, api.agents], [0, []]);
  assert.ok(api.updatedAt, 'usa a data do repositorio');
  // Os achados nao mudam a pasta de projetos, mesmo quando sao maioria em outra pasta-mae.
  assert.equal(projectsBase(fx.home, projects), dev);
  const hidden = await listProjects(fx.home, convs, [join(dev, 'trabalho')]);
  assert.deepEqual(hidden.map((p) => p.name).sort(), ['meu-app', 'solto']);
});

test('listProjects usa a pasta configurada e nao procura na home', async () => {
  const home = tempHome();
  mkdirSync(join(home, 'pessoal', '.git'), { recursive: true });
  mkdirSync(join(home, 'trabalho', 'api', '.git'), { recursive: true });
  const names = async (dir?: string) => (await listProjects(home, [], [], dir)).map((p) => p.name);
  assert.deepEqual(await names(home), [], 'a home nao e a pasta de projetos');
  assert.deepEqual(await names(join(home, 'trabalho')), ['api']);
  assert.deepEqual(await names(), [], '~/projetos nao existe');
});

test('projectDetail abre repositorio sem conversas e so os da pasta de projetos', async () => {
  const fx = buildFixture();
  const repo = join(fx.home, 'dev', 'novo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  write(join(repo, 'CLAUDE.md'), 'regras');
  const fora = join(fx.home, 'fora', 'repo');
  mkdirSync(join(fora, '.git'), { recursive: true });
  const convs = await scanConversations(fx.home);
  const d = await projectDetail(fx.home, repo, convs);
  assert.deepEqual([d?.name, d?.conversationList.length, d?.git?.branch, d?.instructions.length], ['novo', 0, 'main', 1]);
  assert.equal(await projectDetail(fx.home, fora, convs), null);
});

test('projectsBase sem projetos usa ~/projetos', () => {
  assert.equal(projectsBase('/h', []), '/h/projetos');
});
