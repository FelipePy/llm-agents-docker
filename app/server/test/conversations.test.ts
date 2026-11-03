import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanClaude, scanCodex, scanConversations, shortTitle } from '../src/conversations.ts';
import { buildFixture } from './fixture.ts';

test('shortTitle junta espacos e corta em 80 caracteres', () => {
  assert.equal(shortTitle('  a\n  b  '), 'a b');
  assert.equal(shortTitle('x'.repeat(100)), 'x'.repeat(79) + '…');
});

test('scanClaude le titulo, cwd, prompts e ignora conversas sem cwd', async () => {
  const fx = buildFixture();
  const convs = await scanClaude(fx.home);
  assert.deepEqual(convs.map((c) => c.id).sort(), ['aaa', 'bbb', 'ddd', 'eee']);
  const aaa = convs.find((c) => c.id === 'aaa')!;
  assert.equal(aaa.title, 'Titulo novo');
  assert.equal(aaa.cwd, fx.p1);
  assert.equal(aaa.prompts, 2);
  assert.equal(aaa.claudeDir, fx.claudeDir);
  assert.equal(aaa.updatedAt, '2026-10-01T00:00:00.000Z');
  const bbb = convs.find((c) => c.id === 'bbb')!;
  assert.equal(bbb.title, 'x'.repeat(79) + '…');
  assert.equal(bbb.cwd, fx.p1, 'cwd normalizado sem a barra final');
  assert.equal(bbb.prompts, 1);
});

test('scanCodex le id, cwd e titulo do primeiro user_message', async () => {
  const fx = buildFixture();
  const convs = await scanCodex(fx.home);
  const cdx1 = convs.find((c) => c.id === 'cdx-1')!;
  assert.equal(cdx1.agent, 'codex');
  assert.equal(cdx1.cwd, fx.p1);
  assert.equal(cdx1.title, 'Corrigir o bug');
  assert.equal(cdx1.prompts, 2);
  assert.equal(convs.find((c) => c.id === 'cdx-2')!.title, '(sem título)');
});

test('scanConversations junta os dois agentes, mais recentes primeiro', async () => {
  const fx = buildFixture();
  const ids = (await scanConversations(fx.home)).map((c) => c.id);
  assert.deepEqual(ids, ['cdx-1', 'bbb', 'aaa', 'cdx-2', 'eee', 'ddd']);
});
