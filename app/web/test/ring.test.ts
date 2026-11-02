import { describe, expect, it } from 'vitest';
import { crumbLabel, filterItems, itemsFor, paginate, ringPositions, type RingData, type RingItem } from '../src/ring.ts';
import type { Overview, ProjectDetail, SessionInfo } from '../src/types.ts';

const overview: Overview = {
  profile: { instructions: [], memories: [{ path: '/m/a.md', content: '', truncated: false }] },
  skills: [
    { name: 'alpha', description: 'd', origin: 'claude', path: '/s/alpha' },
    { name: 'beta', description: '', origin: 'plugin:x', path: '/s/beta' },
  ],
  projects: [
    { id: 'p1', name: 'meu-app', path: '/w/meu-app', updatedAt: '2026-10-02T00:00:00Z', conversations: 2, agents: ['claude', 'codex'] },
    { id: 'p2', name: 'outro', path: '/w/outro', updatedAt: '2026-09-01T00:00:00Z', conversations: 1, agents: ['codex'] },
  ],
  conversations: [],
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

describe('itemsFor', () => {
  it('inicio: Voce, Projetos, Skills e Sessoes abertas', () => {
    const items = itemsFor({ kind: 'home' }, data);
    expect(items.map((i) => [i.title, i.badge])).toEqual([
      ['Você', '1'],
      ['Projetos', '2'],
      ['Skills', '2'],
      ['Sessões abertas', '1'],
    ]);
    expect(items[0].action).toEqual({ type: 'panel', panel: { kind: 'profile' } });
    expect(items[1].action).toEqual({ type: 'nav', node: { kind: 'projects' } });
    expect(items[3].live).toBe(true);
  });

  it('projetos: cor pelos agentes, pulso com sessao aberta', () => {
    const items = itemsFor({ kind: 'projects' }, data);
    expect(items.map((i) => [i.key, i.tone, i.live])).toEqual([
      ['p1', 'both', true],
      ['p2', 'codex', false],
    ]);
    expect(items[0].action).toEqual({ type: 'nav', node: { kind: 'project', id: 'p1' } });
  });

  it('projeto: conversas, instrucoes, git e acoes (sem memoria vazia)', () => {
    const items = itemsFor({ kind: 'project', id: 'p1' }, data);
    expect(items.map((i) => i.key)).toEqual(['conversations', 'instructions', 'git', 'new-claude', 'new-codex', 'new-shell']);
    const git = items.find((i) => i.key === 'git')!;
    expect([git.title, git.tone, git.action]).toEqual(['main', 'warn', undefined]);
    expect(items.find((i) => i.key === 'new-codex')!.action).toEqual({ type: 'open', projectPath: '/w/meu-app', agent: 'codex' });
    const instructions = items.find((i) => i.key === 'instructions')!.action;
    expect(instructions).toEqual({ type: 'panel', panel: { kind: 'files', title: 'Instruções · meu-app', files: detail.instructions } });
  });

  it('projeto ainda carregando: nenhum cartao', () => {
    expect(itemsFor({ kind: 'project', id: 'p2' }, data)).toEqual([]);
    expect(itemsFor({ kind: 'project', id: 'p1' }, { ...data, detail: null })).toEqual([]);
  });

  it('conversas: clicar retoma', () => {
    const items = itemsFor({ kind: 'conversations', projectId: 'p1' }, data);
    expect(items.map((i) => [i.key, i.title, i.tone])).toEqual([['claude:c1', 'Primeira', 'claude']]);
    expect(items[0].action).toEqual({ type: 'open', projectPath: '/w/meu-app', agent: 'claude', resume: 'c1' });
  });

  it('skills: cor pela origem, abre o painel', () => {
    const items = itemsFor({ kind: 'skills' }, data);
    expect(items.map((i) => i.tone)).toEqual(['claude', 'plugin']);
    expect(items[1].action).toEqual({ type: 'panel', panel: { kind: 'skill', skill: overview.skills[1] } });
  });

  it('sessoes: nome do projeto e agente, foca a aba', () => {
    const items = itemsFor({ kind: 'sessions' }, data);
    expect(items.map((i) => [i.title, i.subtitle, i.live])).toEqual([
      ['meu-app · Claude', 'Primeira', true],
      ['outro · Shell', 'shell (encerrada)', false],
    ]);
    expect(items[1].action).toEqual({ type: 'tab', sessionId: 's2' });
  });
});

it('crumbLabel', () => {
  expect(crumbLabel({ kind: 'home' }, overview)).toBe('Início');
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
  expect(filterItems(items, ' app ').map((i) => i.key)).toEqual(['a', 'b']);
  expect(filterItems(items, '')).toBe(items);
});

it('paginate divide em paginas de 12 e limita a pagina', () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  expect(paginate(items, 0)).toEqual({ items: items.slice(0, 12), page: 0, pages: 3 });
  expect(paginate(items, 5)).toEqual({ items: [24], page: 2, pages: 3 });
  expect(paginate([], 3)).toEqual({ items: [], page: 0, pages: 1 });
});

it('ringPositions comeca no topo e segue no sentido horario', () => {
  const pos = ringPositions(4, 100, 50);
  const expected = [[0, -50], [100, 0], [0, 50], [-100, 0]];
  pos.forEach((p, i) => {
    expect(p.x).toBeCloseTo(expected[i][0]);
    expect(p.y).toBeCloseTo(expected[i][1]);
  });
  expect(ringPositions(0, 100, 50)).toEqual([]);
});
