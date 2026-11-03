import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tempHome, write, jsonl } from './helpers.ts';

export interface Fixture {
  home: string;
  /** Projeto que existe, com conversas do Claude e do Codex. */
  p1: string;
  /** Projeto apagado do disco. */
  p2: string;
  /** Pasta de conversas do Claude do p1. */
  claudeDir: string;
}

const at = (iso: string) => new Date(iso);

export function buildFixture(): Fixture {
  const home = tempHome();
  const p1 = join(home, 'dev', 'meu-app');
  const p2 = join(home, 'dev', 'app-velho');
  mkdirSync(p1, { recursive: true });
  write(join(p1, 'CLAUDE.md'), '# Regras do meu-app\n');

  // Claude: nome da pasta e so uma codificacao; o projeto vem do cwd.
  const claudeDir = join(home, '.claude', 'projects', '-x-dev-meu-app');
  write(
    join(claudeDir, 'aaa.jsonl'),
    jsonl(
      { type: 'mode' },
      { type: 'user', origin: { kind: 'human' }, cwd: p1, message: { content: '<command-name>/x</command-name>' } },
      { type: 'user', origin: { kind: 'human' }, cwd: p1, message: { content: 'Primeira pergunta de verdade' } },
      { type: 'user', cwd: p1, message: { content: [{ type: 'tool_result' }] } },
      { type: 'ai-title', aiTitle: 'Titulo antigo' },
      { type: 'ai-title', aiTitle: 'Titulo novo' },
    ) + 'lixo corrompido\n',
    at('2026-10-01T00:00:00Z'),
  );
  // Formato antigo (sem origin) e prompt longo.
  write(
    join(claudeDir, 'bbb.jsonl'),
    jsonl({ type: 'user', cwd: p1 + '/', message: { content: 'x'.repeat(100) } }),
    at('2026-10-02T00:00:00Z'),
  );
  // Sem cwd: ignorada.
  write(join(claudeDir, 'ccc.jsonl'), jsonl({ type: 'mode' }), at('2026-10-02T00:00:00Z'));
  write(join(claudeDir, 'memory', 'MEMORY.md'), '- [Papel](user_role.md)\n');
  write(join(claudeDir, 'memory', 'user_role.md'), '---\nname: papel\nmetadata:\n  type: user\n---\nDev backend.\n');
  write(join(claudeDir, 'memory', 'project_x.md'), '---\nname: x\ntype: project\n---\nPrazo em dezembro.\n');

  const otherDir = join(home, '.claude', 'projects', '-x-outros');
  write(join(otherDir, 'ddd.jsonl'), jsonl({ type: 'user', cwd: p2, message: { content: 'velho' } }), at('2026-09-01T00:00:00Z'));
  write(join(otherDir, 'eee.jsonl'), jsonl({ type: 'user', cwd: home, message: { content: 'na home' } }), at('2026-09-02T00:00:00Z'));

  const codexDay = join(home, '.codex', 'sessions', '2026', '10', '03');
  write(
    join(codexDay, 'rollout-x.jsonl'),
    jsonl(
      { type: 'session_meta', payload: { id: 'cdx-1', cwd: p1 } },
      { type: 'response_item', payload: { type: 'message', role: 'user' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Corrigir   o\nbug' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'outra' } },
    ),
    at('2026-10-03T00:00:00Z'),
  );
  write(
    join(codexDay, 'rollout-y.jsonl'),
    jsonl({ type: 'session_meta', payload: { id: 'cdx-2', cwd: p2 } }),
    at('2026-09-03T00:00:00Z'),
  );

  write(join(home, '.claude', 'CLAUDE.md'), '# Global\n');
  write(join(home, '.codex', 'memories', 'MEMORY.md'), 'Prefere respostas curtas.\n');

  write(join(home, '.claude', 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Primeira skill\n---\n');
  write(join(home, '.claude', 'skills', 'semfm', 'SKILL.md'), '# sem frontmatter\n');
  write(join(home, '.codex', 'skills', 'beta', 'SKILL.md'), '---\nname: beta\ndescription: Do Codex\n---\n');
  const pluginDir = join(home, 'plugins', 'p1');
  write(join(pluginDir, 'skills', 'gamma', 'SKILL.md'), '---\nname: gamma\ndescription: >\n  De um\n  plugin\n---\n');
  write(
    join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'p1@mercado': [{ installPath: pluginDir }] } }),
  );

  return { home, p1, p2, claudeDir };
}
