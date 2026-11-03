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

test('projectsBase sem projetos usa ~/projetos', () => {
  assert.equal(projectsBase('/h', []), '/h/projetos');
});
