import { describe, expect, it } from 'vitest';
import {
  arcPositions, crumbLabel, filterItems, itemsFor, memoryTitle, pageSizeFor, paginate, type RingData, type RingItem,
} from '../src/ring.ts';
import type { Overview, ProjectDetail, SessionInfo } from '../src/types.ts';

const overview: Overview = {
  profile: {
    instructions: [{ path: '/h/.claude/CLAUDE.md', content: '# Global', truncated: false }],
    memories: [{ path: '/m/user_role.md', content: '---\nname: Papel do usuário\ntype: user\n---\nDev.', truncated: false }],
  },
  skills: [
    { name: 'alpha', description: 'd', origin: 'claude', path: '/s/alpha' },
    { name: 'beta', description: '', origin: 'plugin:x', path: '/s/beta' },
  ],
  projects: [
    { id: 'p1', name: 'meu-app', path: '/w/meu-app', updatedAt: '2026-10-02T00:00:00Z', conversations: 2, agents: ['claude', 'codex'] },
    { id: 'p2', name: 'outro', path: '/w/outro', updatedAt: '2026-09-01T00:00:00Z', conversations: 1, agents: ['codex'] },
  ],
  conversations: [],
  projectsDir: '/w',
};
const detail: ProjectDetail = {
  ...overview.projects[0],
  git: { branch: 'main', dirty: true },
  instructions: [{ path: '/w/meu-app/CLAUDE.md', content: '#', truncated: false }],
  memory: [],
  conversationList: [{ agent: 'claude', id: 'c1', cwd: '/w/meu-app', title: 'Primeira', updatedAt: '2026-10-02T00:00:00Z', prompts: 3 }],
};
const sessions: SessionInfo[] = [
  { id: 's1', projectPath: '/w/meu-app', agent: 'claude', title: 'Primeira', startedAt: '', alive: true },
  { id: 's2', projectPath: '/w/outro', agent: 'shell', title: 'shell', startedAt: '', alive: false },
];
const data: RingData = { overview, sessions, detail };
const keys = (items: RingItem[]) => items.map((i) => i.key);

describe('itemsFor', () => {
  it('inicio: Voce, Projetos, Skills e Sessoes abertas', () => {
    const items = itemsFor({ kind: 'home' }, data);
    expect(items.map((i) => [i.title, i.badge])).toEqual([
      ['Você', '2'],
      ['Projetos', '2'],
      ['Skills', '2'],
      ['Sessões abertas', '1'],
      ['Comandos de voz', undefined],
    ]);
    expect(items[4].action).toEqual({ type: 'panel', panel: { kind: 'commands' } });
    expect(items[0].action).toEqual({ type: 'nav', node: { kind: 'profile' } });
    expect(items[3].live).toBe(true);
  });

  it('voce: + Sobre mim, instrucoes e memorias', () => {
    const items = itemsFor({ kind: 'profile' }, data);
    expect(items.map((i) => [i.title, i.tone])).toEqual([
      ['+ Sobre mim', 'add'],
      ['CLAUDE.md', 'accent'],
      ['Papel do usuário', 'claude'],
    ]);
    expect(items[0].action).toEqual({ type: 'task', task: 'about-me' });
    expect(items[2].action).toEqual({
      type: 'panel',
      panel: { kind: 'files', title: 'Papel do usuário', files: [overview.profile.memories[0]] },
    });
  });

  it('projetos: + Novo projeto e um cartao por projeto', () => {
    const items = itemsFor({ kind: 'projects' }, data);
    expect(items.map((i) => [i.key, i.tone, i.live ?? false])).toEqual([
      ['new-project', 'add', false],
      ['p1', 'both', true],
      ['p2', 'codex', false],
    ]);
    expect(items[0].action).toEqual({ type: 'panel', panel: { kind: 'new-project' } });
    expect(items[1].action).toEqual({ type: 'nav', node: { kind: 'project', id: 'p1' } });
  });

  it('projeto: sobre, conversas, instrucoes, git e novas sessoes', () => {
    const items = itemsFor({ kind: 'project', id: 'p1' }, data);
    expect(keys(items)).toEqual(['info', 'conversations', 'instructions', 'git', 'new-claude', 'new-codex', 'new-shell']);
    expect(items[0].action).toEqual({ type: 'panel', panel: { kind: 'project', detail } });
    const git = items.find((i) => i.key === 'git')!;
    expect([git.title, git.tone, git.action]).toEqual(['git · main', 'warn', undefined]);
    expect(items.find((i) => i.key === 'new-codex')!.action).toEqual({ type: 'open', projectPath: '/w/meu-app', agent: 'codex' });
  });

  it('projeto ainda carregando: nenhum cartao', () => {
    expect(itemsFor({ kind: 'project', id: 'p2' }, data)).toEqual([]);
    expect(itemsFor({ kind: 'conversations', projectId: 'p1' }, { ...data, detail: null })).toEqual([]);
  });

  it('conversas: clicar retoma', () => {
    const items = itemsFor({ kind: 'conversations', projectId: 'p1' }, data);
    expect(items.map((i) => [i.key, i.title, i.tone])).toEqual([['claude:c1', 'Primeira', 'claude']]);
    expect(items[0].action).toEqual({ type: 'open', projectPath: '/w/meu-app', agent: 'claude', resume: 'c1' });
  });

  it('skills: + Nova skill e cor pela origem', () => {
    const items = itemsFor({ kind: 'skills' }, data);
    expect(items.map((i) => i.tone)).toEqual(['add', 'claude', 'plugin']);
    expect(items[0].action).toEqual({ type: 'task', task: 'new-skill' });
    expect(items[2].action).toEqual({ type: 'panel', panel: { kind: 'skill', skill: overview.skills[1] } });
  });

  it('sessoes: + Nova sessao leva aos projetos; as outras focam a aba', () => {
    const items = itemsFor({ kind: 'sessions' }, data);
    expect(items.map((i) => i.title)).toEqual(['+ Nova sessão', 'meu-app · Claude', 'outro · Shell (encerrada)']);
    expect(items[0].action).toEqual({ type: 'nav', node: { kind: 'projects' } });
    expect(items[2].action).toEqual({ type: 'tab', sessionId: 's2' });
  });
});

it('memoryTitle usa o name do frontmatter ou o nome do arquivo', () => {
  expect(memoryTitle(overview.profile.memories[0])).toBe('Papel do usuário');
  expect(memoryTitle({ path: '/x/notas.md', content: 'sem frontmatter', truncated: false })).toBe('notas');
});

it('crumbLabel', () => {
  expect(crumbLabel({ kind: 'home' }, overview)).toBe('Início');
  expect(crumbLabel({ kind: 'profile' }, overview)).toBe('Você');
  expect(crumbLabel({ kind: 'project', id: 'p1' }, overview)).toBe('meu-app');
  expect(crumbLabel({ kind: 'project', id: 'zz' }, overview)).toBe('Projeto');
  expect(crumbLabel({ kind: 'conversations', projectId: 'p1' }, null)).toBe('Conversas');
});

it('filterItems procura no titulo e no subtitulo, sem diferenciar maiusculas', () => {
  const items: RingItem[] = [
    { key: 'a', title: 'Meu App', tone: 'claude' },
    { key: 'b', title: 'Outro', subtitle: 'APP antigo', tone: 'codex' },
    { key: 'c', title: 'Nada', tone: 'codex' },
  ];
  expect(keys(filterItems(items, ' app '))).toEqual(['a', 'b']);
  expect(filterItems(items, '')).toBe(items);
});

it('paginate divide em paginas e limita a pagina', () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  expect(paginate(items, 0, 12)).toEqual({ items: items.slice(0, 12), page: 0, pages: 3 });
  expect(paginate(items, 5, 12)).toEqual({ items: [24], page: 2, pages: 3 });
  expect(paginate([], 3, 12)).toEqual({ items: [], page: 0, pages: 1 });
});

it('arcPositions: espacamento vertical uniforme sobre um arco a direita', () => {
  const pos = arcPositions(3, 100, 200, 40);
  expect(pos.map((p) => p.y)).toEqual([-40, 0, 40]);
  expect(pos[1].x).toBe(100);
  expect(pos[0].x).toBeCloseTo(100 * Math.sqrt(1 - 0.04));
  expect(pos[2].x).toBeCloseTo(pos[0].x);
  expect(arcPositions(1, 100, 200)).toEqual([{ x: 100, y: 0 }]);
  expect(arcPositions(0, 100, 200)).toEqual([]);
});

it('pageSizeFor cabe na altura do arco, entre 6 e 18', () => {
  expect(pageSizeFor(380)).toBe(18);
  expect(pageSizeFor(300)).toBe(15);
  expect(pageSizeFor(100)).toBe(6);
});
