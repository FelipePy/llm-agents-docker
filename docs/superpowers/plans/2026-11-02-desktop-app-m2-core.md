# App desktop, marco 2 revisado (núcleo de voz e navegação radial): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Substitui `2026-11-02-desktop-app-m2.md` (buraco negro com projetos em órbita), já implementado e avaliado pelo usuário.

**Goal:** Um átomo animado fica sempre no centro e reage ao sinal de voz `{ mode, level }`. O conteúdo (Você, projetos, conversas, skills, sessões) aparece em cartões radiais em volta dele, com trilha de navegação, filtro e paginação.

**Architecture:** Três módulos puros e testados: `nav.ts` (pilha de navegação, que a etapa 3 vai controlar por voz), `ring.ts` (cartões de cada nível, filtro, páginas e posições na elipse) e `scene/core.ts` (suavização do nível de voz, velocidade dos elétrons e sinal de demonstração). A cena 3D (`CoreScene`) desenha só o átomo e o céu. Os cartões são HTML sobre o canvas (`Ring`). Saem os componentes do buraco negro e das órbitas.

**Tech Stack:** o mesmo do marco 2 (three, @react-three/fiber, @react-three/drei, @react-three/postprocessing), vitest.

Spec: `docs/superpowers/specs/2026-11-02-desktop-app-design.md` (seção "Marco 2").

## Global Constraints

- O núcleo nunca sai do centro: câmera fixa em `(0, 0, 15)`, sem zoom e sem pan; rotação livre e lenta.
- Sinal do núcleo: `CoreSignal = { mode: 'idle' | 'listening' | 'thinking' | 'speaking'; level: number }`, `level` em [0, 1], lido por referência (sem re-render).
- Cores dos estados: idle `#4f8cff`, listening `#3fd5ff`, thinking `#9b6bff`, speaking `#6aa8ff`.
- Até 12 cartões por página. A elipse dos cartões tem raios de 36% da largura (máx. 560 px) e 36% da altura (máx. 320 px) da área central; o primeiro cartão fica no topo.
- `Esc` (fora do terminal e da busca): fecha o painel; sem painel, sobe um nível.
- Preferências em `localStorage`: `llm-agent-3d`, `llm-agent-reduce-motion`, `llm-agent-voice-demo`.
- Qualidade: 3 amostras abaixo de 30 FPS desligam o bloom; mais 3 baixam a malha do núcleo de 64 para 24 subdivisões.
- Textos de interface em português.

## Convenção

Cada bloco marcado com `file=<caminho>` é o conteúdo **completo** do arquivo (criado ou substituído).

---

### Task 1: Navegação, cartões e dinâmica do núcleo (lógica pura)

**Files:**
- Create: `app/web/src/nav.ts`, `app/web/src/ring.ts`, `app/web/src/scene/core.ts`, `app/web/test/nav.test.ts`, `app/web/test/ring.test.ts`, `app/web/test/core.test.ts`
- Modify: `app/web/src/scene/quality.ts`, `app/web/test/quality.test.ts`
- Delete: `app/web/src/scene/layout.ts`, `app/web/test/layout.test.ts`

**Interfaces:**
- Produces:
  - `nav.ts`: `NavNode`, `NavState`, `NavAction`, `initialNav`, `pathTo(node)`, `navReducer(state, action)`, `currentNode(state)`, `projectIdOf(node)`.
  - `ring.ts`: `Panel`, `Tone`, `ItemAction`, `RingItem`, `RingData`, `itemsFor(node, data)`, `crumbLabel(node, overview)`, `filterItems(items, filter)`, `PAGE_SIZE`, `paginate(items, page)`, `ringPositions(n, rx, ry)`.
  - `scene/core.ts`: `CoreMode`, `CoreSignal`, `MODE_LABEL`, `MODE_COLORS`, `smoothLevel(prev, target, dt)`, `electronSpeed(mode, level)`, `speechEnvelope(t)`, `demoSignal(t)`.
  - `scene/quality.ts`: `Quality { bloom, detail, lowStreak }`, `HIGH_QUALITY`, `LOW_DETAIL`, `nextQuality(q, fps)`.

- [ ] **Step 1: Remover o layout das órbitas**

Run: `git rm -q app/web/src/scene/layout.ts app/web/test/layout.test.ts`

- [ ] **Step 2: Escrever os testes**

```ts file=app/web/test/nav.test.ts
import { describe, expect, it } from 'vitest';
import { currentNode, initialNav, navReducer, pathTo, projectIdOf, type NavAction, type NavNode } from '../src/nav.ts';

const home: NavNode = { kind: 'home' };
const projects: NavNode = { kind: 'projects' };
const run = (...actions: NavAction[]) => actions.reduce(navReducer, initialNav);

describe('navegacao', () => {
  it('comeca no inicio', () => {
    expect(currentNode(initialNav)).toEqual(home);
  });

  it('push empilha e zera pagina e filtro', () => {
    const s = run({ type: 'filter', value: 'x' }, { type: 'page', delta: 1 }, { type: 'push', node: projects });
    expect(s).toEqual({ stack: [home, projects], page: 0, filter: '' });
  });

  it('back sobe um nivel e nao passa do inicio', () => {
    expect(run({ type: 'push', node: projects }, { type: 'back' }).stack).toEqual([home]);
    expect(navReducer(initialNav, { type: 'back' })).toBe(initialNav);
  });

  it('goto volta para um nivel da trilha', () => {
    const s = run(
      { type: 'push', node: projects },
      { type: 'push', node: { kind: 'project', id: 'a' } },
      { type: 'push', node: { kind: 'conversations', projectId: 'a' } },
    );
    expect(navReducer(s, { type: 'goto', depth: 1 }).stack).toEqual([home, projects]);
    expect(navReducer(s, { type: 'goto', depth: 3 })).toBe(s);
  });

  it('jump monta a trilha completa', () => {
    expect(navReducer(initialNav, { type: 'jump', node: { kind: 'conversations', projectId: 'p' } }).stack).toEqual([
      home,
      projects,
      { kind: 'project', id: 'p' },
      { kind: 'conversations', projectId: 'p' },
    ]);
    expect(pathTo({ kind: 'skills' })).toEqual([home, { kind: 'skills' }]);
    expect(pathTo(home)).toEqual([home]);
  });

  it('page nao fica negativa e filter volta para a pagina 0', () => {
    expect(run({ type: 'page', delta: -1 }).page).toBe(0);
    expect(run({ type: 'page', delta: 1 }, { type: 'page', delta: 1 }).page).toBe(2);
    expect(run({ type: 'page', delta: 1 }, { type: 'filter', value: 'a' })).toEqual({ stack: [home], page: 0, filter: 'a' });
  });

  it('projectIdOf', () => {
    expect(projectIdOf({ kind: 'project', id: 'a' })).toBe('a');
    expect(projectIdOf({ kind: 'conversations', projectId: 'b' })).toBe('b');
    expect(projectIdOf(projects)).toBeNull();
  });
});
```

```ts file=app/web/test/ring.test.ts
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
```

```ts file=app/web/test/core.test.ts
import { expect, it } from 'vitest';
import { demoSignal, electronSpeed, smoothLevel, speechEnvelope } from '../src/scene/core.ts';

it('smoothLevel sobe rapido, desce devagar e fica em [0, 1]', () => {
  const up = smoothLevel(0, 1, 0.05);
  const down = 1 - smoothLevel(1, 0, 0.05);
  expect(up).toBeGreaterThan(down);
  expect(smoothLevel(0.5, 2, 10)).toBe(1);
  expect(smoothLevel(0.5, -1, 10)).toBe(0);
});

it('electronSpeed: pensando e o mais rapido; falar alto acelera', () => {
  expect(electronSpeed('thinking', 0)).toBeGreaterThan(electronSpeed('speaking', 0.5));
  expect(electronSpeed('speaking', 1)).toBeGreaterThan(electronSpeed('speaking', 0));
  expect(electronSpeed('listening', 0)).toBeGreaterThan(electronSpeed('idle', 0));
});

it('demoSignal percorre os estados a cada 16 s', () => {
  expect(demoSignal(1)).toEqual({ mode: 'idle', level: 0 });
  expect(demoSignal(5)).toEqual({ mode: 'listening', level: 0 });
  expect(demoSignal(8).mode).toBe('thinking');
  expect(demoSignal(10).mode).toBe('speaking');
  expect(demoSignal(17).mode).toBe('idle');
});

it('speechEnvelope varia entre silencio e pico, dentro de [0, 1]', () => {
  const v = Array.from({ length: 400 }, (_, i) => speechEnvelope(i * 0.02));
  expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...v)).toBeLessThanOrEqual(1);
  expect(Math.max(...v)).toBeGreaterThan(0.6);
  expect(Math.min(...v)).toBeLessThan(0.2);
});
```

```ts file=app/web/test/quality.test.ts
import { expect, it } from 'vitest';
import { HIGH_QUALITY, LOW_DETAIL, nextQuality } from '../src/scene/quality.ts';

const feed = (samples: number[]) => samples.reduce(nextQuality, HIGH_QUALITY);

it('FPS bom nao muda nada (e devolve o mesmo objeto)', () => {
  expect(nextQuality(HIGH_QUALITY, 60)).toBe(HIGH_QUALITY);
});

it('tres amostras baixas seguidas desligam o bloom', () => {
  expect(feed([20, 20]).bloom).toBe(true);
  expect(feed([20, 20, 20])).toEqual({ bloom: false, detail: HIGH_QUALITY.detail, lowStreak: 0 });
});

it('uma amostra boa zera a sequencia', () => {
  expect(feed([20, 20, 60, 20, 20]).bloom).toBe(true);
});

it('depois do bloom, reduz a malha do nucleo e para ai', () => {
  expect(feed([20, 20, 20, 20, 20, 20])).toEqual({ bloom: false, detail: LOW_DETAIL, lowStreak: 0 });
  expect(feed(Array(12).fill(10))).toEqual({ bloom: false, detail: LOW_DETAIL, lowStreak: 0 });
});
```

- [ ] **Step 3: Ver falhar**

Run: `cd app/web && npm test`
Expected: `nav.test.ts`, `ring.test.ts` e `core.test.ts` falham ao carregar os módulos; `quality.test.ts` falha porque `LOW_DETAIL` não existe.

- [ ] **Step 4: Implementar**

```ts file=app/web/src/nav.ts
// Navegacao radial: uma pilha de niveis. A etapa 3 (voz) usa as mesmas acoes.

export type NavNode =
  | { kind: 'home' }
  | { kind: 'projects' }
  | { kind: 'project'; id: string }
  | { kind: 'conversations'; projectId: string }
  | { kind: 'skills' }
  | { kind: 'sessions' };

export interface NavState {
  stack: NavNode[];
  page: number;
  filter: string;
}

export type NavAction =
  | { type: 'push'; node: NavNode }
  | { type: 'goto'; depth: number }
  | { type: 'back' }
  | { type: 'jump'; node: NavNode }
  | { type: 'page'; delta: 1 | -1 }
  | { type: 'filter'; value: string };

export const initialNav: NavState = { stack: [{ kind: 'home' }], page: 0, filter: '' };

/** Trilha completa ate um nivel (usada por "jump", busca e voz). */
export function pathTo(node: NavNode): NavNode[] {
  const home: NavNode = { kind: 'home' };
  switch (node.kind) {
    case 'home':
      return [home];
    case 'projects':
    case 'skills':
    case 'sessions':
      return [home, node];
    case 'project':
      return [home, { kind: 'projects' }, node];
    case 'conversations':
      return [...pathTo({ kind: 'project', id: node.projectId }), node];
  }
}

const fresh = (stack: NavNode[]): NavState => ({ stack, page: 0, filter: '' });

export function navReducer(s: NavState, a: NavAction): NavState {
  switch (a.type) {
    case 'push':
      return fresh([...s.stack, a.node]);
    case 'goto':
      return a.depth >= s.stack.length - 1 ? s : fresh(s.stack.slice(0, Math.max(a.depth, 0) + 1));
    case 'back':
      return s.stack.length > 1 ? fresh(s.stack.slice(0, -1)) : s;
    case 'jump':
      return fresh(pathTo(a.node));
    case 'page':
      return { ...s, page: Math.max(0, s.page + a.delta) };
    case 'filter':
      return { ...s, filter: a.value, page: 0 };
  }
}

export const currentNode = (s: NavState): NavNode => s.stack[s.stack.length - 1];

export function projectIdOf(node: NavNode): string | null {
  if (node.kind === 'project') return node.id;
  if (node.kind === 'conversations') return node.projectId;
  return null;
}
```

```ts file=app/web/src/ring.ts
import type { NavNode } from './nav.ts';
import type { Overview, ProjectDetail, SessionAgent, SessionInfo, Skill, TextFile } from './types.ts';
import { LABEL, formatDate } from './format.ts';

/** Conteudo do painel lateral de leitura. */
export type Panel =
  | { kind: 'profile' }
  | { kind: 'skill'; skill: Skill }
  | { kind: 'files'; title: string; files: TextFile[] };

export type Tone = 'claude' | 'codex' | 'both' | 'shell' | 'plugin' | 'accent' | 'warn' | 'muted';

export type ItemAction =
  | { type: 'nav'; node: NavNode }
  | { type: 'panel'; panel: Panel }
  | { type: 'open'; projectPath: string; agent: SessionAgent; resume?: string }
  | { type: 'tab'; sessionId: string };

export interface RingItem {
  key: string;
  title: string;
  subtitle?: string;
  badge?: string;
  tone: Tone;
  live?: boolean;
  /** Sem acao: cartao so informativo (ex.: git). */
  action?: ItemAction;
}

export interface RingData {
  overview: Overview;
  sessions: SessionInfo[];
  /** Detalhe do projeto do nivel atual (null enquanto carrega). */
  detail: ProjectDetail | null;
}

const agentsTone = (agents: string[]): Tone => (agents.length > 1 ? 'both' : agents[0] === 'codex' ? 'codex' : 'claude');
const skillTone = (origin: string): Tone => (origin.startsWith('plugin:') ? 'plugin' : origin === 'codex' ? 'codex' : 'claude');
const fileName = (f: TextFile): string => f.path.split('/').pop() ?? f.path;

export function itemsFor(node: NavNode, { overview, sessions, detail }: RingData): RingItem[] {
  const alive = sessions.filter((s) => s.alive);
  switch (node.kind) {
    case 'home':
      return [
        {
          key: 'profile', title: 'Você', subtitle: 'instruções e memórias', badge: String(overview.profile.memories.length),
          tone: 'accent', action: { type: 'panel', panel: { kind: 'profile' } },
        },
        {
          key: 'projects', title: 'Projetos', subtitle: 'conversas, memória e git', badge: String(overview.projects.length),
          tone: 'both', action: { type: 'nav', node: { kind: 'projects' } },
        },
        {
          key: 'skills', title: 'Skills', subtitle: 'Claude, Codex e plugins', badge: String(overview.skills.length),
          tone: 'plugin', action: { type: 'nav', node: { kind: 'skills' } },
        },
        {
          key: 'sessions', title: 'Sessões abertas', subtitle: alive.length ? 'em execução agora' : 'nenhuma em execução',
          badge: String(alive.length), tone: 'shell', live: alive.length > 0, action: { type: 'nav', node: { kind: 'sessions' } },
        },
      ];
    case 'projects': {
      const live = new Set(alive.map((s) => s.projectPath));
      return overview.projects.map((p) => ({
        key: p.id, title: p.name, subtitle: formatDate(p.updatedAt), badge: String(p.conversations),
        tone: agentsTone(p.agents), live: live.has(p.path), action: { type: 'nav', node: { kind: 'project', id: p.id } },
      }));
    }
    case 'project': {
      if (!detail || detail.id !== node.id) return [];
      const items: RingItem[] = [
        {
          key: 'conversations', title: 'Conversas', subtitle: 'retomar uma conversa', badge: String(detail.conversationList.length),
          tone: agentsTone(detail.agents), action: { type: 'nav', node: { kind: 'conversations', projectId: node.id } },
        },
      ];
      if (detail.memory.length) {
        items.push({
          key: 'memory', title: 'Memória', subtitle: 'o que o Claude guardou', badge: String(detail.memory.length), tone: 'accent',
          action: { type: 'panel', panel: { kind: 'files', title: `Memória · ${detail.name}`, files: detail.memory } },
        });
      }
      if (detail.instructions.length) {
        items.push({
          key: 'instructions', title: 'Instruções', subtitle: detail.instructions.map(fileName).join(' · '), tone: 'accent',
          action: { type: 'panel', panel: { kind: 'files', title: `Instruções · ${detail.name}`, files: detail.instructions } },
        });
      }
      if (detail.git) {
        items.push({
          key: 'git', title: detail.git.branch, subtitle: detail.git.dirty ? 'mudanças pendentes' : 'sem mudanças',
          tone: detail.git.dirty ? 'warn' : 'muted',
        });
      }
      for (const agent of ['claude', 'codex', 'shell'] as const) {
        items.push({
          key: `new-${agent}`, title: `+ ${LABEL[agent]}`, subtitle: 'nova sessão', tone: agent,
          action: { type: 'open', projectPath: detail.path, agent },
        });
      }
      return items;
    }
    case 'conversations':
      if (!detail || detail.id !== node.projectId) return [];
      return detail.conversationList.map((c) => ({
        key: `${c.agent}:${c.id}`, title: c.title, subtitle: `${LABEL[c.agent]} · ${formatDate(c.updatedAt)} · ${c.prompts} msg`,
        tone: c.agent, action: { type: 'open', projectPath: detail.path, agent: c.agent, resume: c.id },
      }));
    case 'skills':
      return overview.skills.map((s) => ({
        key: s.path, title: s.name, subtitle: s.origin, tone: skillTone(s.origin),
        action: { type: 'panel', panel: { kind: 'skill', skill: s } },
      }));
    case 'sessions': {
      const names = new Map(overview.projects.map((p) => [p.path, p.name]));
      return sessions.map((s) => ({
        key: s.id, title: `${names.get(s.projectPath) ?? s.projectPath} · ${LABEL[s.agent]}`,
        subtitle: s.alive ? s.title : `${s.title} (encerrada)`, tone: s.agent, live: s.alive,
        action: { type: 'tab', sessionId: s.id },
      }));
    }
  }
}

export function crumbLabel(node: NavNode, overview: Overview | null): string {
  switch (node.kind) {
    case 'home':
      return 'Início';
    case 'projects':
      return 'Projetos';
    case 'project':
      return overview?.projects.find((p) => p.id === node.id)?.name ?? 'Projeto';
    case 'conversations':
      return 'Conversas';
    case 'skills':
      return 'Skills';
    case 'sessions':
      return 'Sessões';
  }
}

export function filterItems(items: RingItem[], filter: string): RingItem[] {
  const q = filter.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.title.toLowerCase().includes(q) || (i.subtitle ?? '').toLowerCase().includes(q));
}

export const PAGE_SIZE = 12;

export function paginate<T>(items: T[], page: number, size = PAGE_SIZE): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(page, 0), pages - 1);
  return { items: items.slice(p * size, p * size + size), page: p, pages };
}

/** Pontos numa elipse, comecando no topo, no sentido horario (y para baixo). */
export function ringPositions(n: number, rx: number, ry: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return { x: Math.cos(a) * rx, y: Math.sin(a) * ry };
  });
}
```

```ts file=app/web/src/scene/core.ts
// Dinamica do nucleo (atomo). A etapa 3 alimenta CoreSignal com a voz real.

export type CoreMode = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface CoreSignal {
  mode: CoreMode;
  /** Volume da voz do agente, de 0 a 1 (so conta em "speaking"). */
  level: number;
}

export const MODE_LABEL: Record<CoreMode, string> = {
  idle: 'aguardando',
  listening: 'ouvindo',
  thinking: 'pensando',
  speaking: 'falando',
};

export const MODE_COLORS: Record<CoreMode, { core: string; hot: string; ring: string }> = {
  idle: { core: '#4f8cff', hot: '#cfe0ff', ring: '#3a5a9a' },
  listening: { core: '#3fd5ff', hot: '#d9f8ff', ring: '#3fd5ff' },
  thinking: { core: '#9b6bff', hot: '#eadfff', ring: '#9b6bff' },
  speaking: { core: '#6aa8ff', hot: '#ffffff', ring: '#8ab4ff' },
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Suavizacao exponencial: sobe rapido (ataque) e desce devagar (soltura). */
export function smoothLevel(prev: number, target: number, dt: number): number {
  const rate = target > prev ? 18 : 5;
  const k = 1 - Math.exp(-rate * dt);
  return clamp01(prev + (target - prev) * k);
}

/** Velocidade angular dos eletrons (rad/s). */
export function electronSpeed(mode: CoreMode, level: number): number {
  switch (mode) {
    case 'idle':
      return 0.5;
    case 'listening':
      return 0.9;
    case 'thinking':
      return 3.2;
    case 'speaking':
      return 1.1 + 1.8 * clamp01(level);
  }
}

/** Envelope sintetico parecido com fala: silabas dentro de palavras, com pausas. */
export function speechEnvelope(t: number): number {
  const syllables = Math.abs(Math.sin(t * 7.3)) * 0.65 + Math.abs(Math.sin(t * 2.1 + 1)) * 0.35;
  const words = Math.sin(t * 1.7) > -0.35 ? 1 : 0.1;
  return clamp01(syllables * words);
}

const DEMO: [CoreMode, number][] = [
  ['idle', 4],
  ['listening', 3],
  ['thinking', 2],
  ['speaking', 7],
];

/** Ciclo de 16 s pelos estados, para avaliar o nucleo antes da voz real. */
export function demoSignal(t: number): CoreSignal {
  let x = ((t % 16) + 16) % 16;
  for (const [mode, duration] of DEMO) {
    if (x < duration) return { mode, level: mode === 'speaking' ? speechEnvelope(t) : 0 };
    x -= duration;
  }
  return { mode: 'idle', level: 0 };
}
```

```ts file=app/web/src/scene/quality.ts
export interface Quality {
  bloom: boolean;
  /** Subdivisoes da malha do nucleo. */
  detail: number;
  lowStreak: number;
}

export const HIGH_QUALITY: Quality = { bloom: true, detail: 64, lowStreak: 0 };
export const LOW_DETAIL = 24;

/**
 * Recebe uma amostra de FPS por segundo. Tres amostras seguidas abaixo de 30
 * desligam o bloom; mais tres reduzem a malha. Nunca volta a subir.
 * Devolve o mesmo objeto quando nada muda (evita re-render).
 */
export function nextQuality(q: Quality, fps: number): Quality {
  const lowStreak = fps < 30 ? q.lowStreak + 1 : 0;
  if (lowStreak < 3) return lowStreak === q.lowStreak ? q : { ...q, lowStreak };
  if (q.bloom) return { ...q, bloom: false, lowStreak: 0 };
  if (q.detail > LOW_DETAIL) return { ...q, detail: LOW_DETAIL, lowStreak: 0 };
  return q.lowStreak === 0 ? q : { ...q, lowStreak: 0 };
}
```

- [ ] **Step 5: Ver passar**

Run: `cd app/web && npm test`
Expected: todos `passed` (a cena antiga ainda importa `layout.ts`, mas os testes não carregam a cena; o typecheck é feito na Task 2).

- [ ] **Step 6: Commit**

```bash
git add -A app/web/src/nav.ts app/web/src/ring.ts app/web/src/scene/core.ts app/web/src/scene/quality.ts app/web/test
git commit -m "Add radial navigation model and voice core dynamics"
```

---

### Task 2: Cena do átomo

**Files:**
- Create: `app/web/src/scene/atomShader.ts`, `app/web/src/scene/Atom.tsx`, `app/web/src/scene/CoreScene.tsx`
- Delete: `app/web/src/scene/BlackHole.tsx`, `app/web/src/scene/blackHoleShader.ts`, `app/web/src/scene/Projects.tsx`, `app/web/src/scene/SkillBelt.tsx`, `app/web/src/scene/CameraRig.tsx`, `app/web/src/scene/Galaxy.tsx`

**Interfaces:**
- Consumes: `core.ts`, `quality.ts` (Task 1).
- Produces: `CoreScene({ signal, reducedMotion, dimmed })` com `signal: MutableRefObject<CoreSignal>`.

- [ ] **Step 1: Remover a cena antiga**

Run: `git rm -q app/web/src/scene/BlackHole.tsx app/web/src/scene/blackHoleShader.ts app/web/src/scene/Projects.tsx app/web/src/scene/SkillBelt.tsx app/web/src/scene/CameraRig.tsx app/web/src/scene/Galaxy.tsx`

- [ ] **Step 2: Shaders e componentes**

```ts file=app/web/src/scene/atomShader.ts
// Nucleo: esfera deformada por ruido (mais forte quando o agente fala),
// com brilho de borda. Halo: esfera externa, faces de tras, aditiva.

const noise = /* glsl */ `
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
`;

export const coreVertex = /* glsl */ `
uniform float uTime;
uniform float uLevel;
varying vec3 vNormal;
varying vec3 vView;
varying float vDisp;
${noise}
void main() {
  float n = noise(position * 1.6 + vec3(0.0, uTime * 0.5, uTime * 0.2)) * 0.65
          + noise(position * 4.2 - vec3(uTime * 0.9)) * 0.35;
  float disp = (n - 0.5) * (0.10 + 0.70 * uLevel);
  vDisp = disp;
  vec4 mv = modelViewMatrix * vec4(position + normal * disp, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const coreFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uLevel;
varying vec3 vNormal;
varying vec3 vView;
varying float vDisp;
void main() {
  float fres = pow(1.0 - max(dot(normalize(vNormal), normalize(vView)), 0.0), 2.0);
  vec3 col = mix(uHot, uColor, 0.35 + 0.65 * fres);
  col *= 0.55 + 1.4 * fres + 0.9 * uLevel + vDisp * 3.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

export const haloVertex = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const haloFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uLevel;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float i = pow(max(0.0, -dot(normalize(vNormal), normalize(vView))), 3.0);
  gl_FragColor = vec4(uColor * i * (0.9 + 1.5 * uLevel), i);
}
`;
```

```tsx file=app/web/src/scene/Atom.tsx
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line, Trail } from '@react-three/drei';
import { AdditiveBlending, BackSide, Color, EllipseCurve, ShaderMaterial, Vector3, type Group, type Mesh } from 'three';
import { MODE_COLORS, electronSpeed, smoothLevel, type CoreSignal } from './core.ts';
import { coreFragment, coreVertex, haloFragment, haloVertex } from './atomShader.ts';

interface Orbit {
  a: number;
  b: number;
  rotation: [number, number, number];
  phase: number;
}

const ORBITS: Orbit[] = [
  { a: 2.7, b: 1.5, rotation: [1.15, 0, 0.2], phase: 0 },
  { a: 2.9, b: 1.3, rotation: [-0.5, 1.0, 0.4], phase: 2.1 },
  { a: 2.5, b: 1.7, rotation: [0.3, -0.9, -0.9], phase: 4.2 },
];

interface Props {
  signal: MutableRefObject<CoreSignal>;
  reducedMotion: boolean;
  /** Subdivisoes da malha do nucleo. */
  detail: number;
}

export function Atom({ signal, reducedMotion, detail }: Props) {
  const group = useRef<Group>(null);
  const nucleus = useRef<Mesh>(null);
  const electrons = useRef<(Mesh | null)[]>([]);
  const lines = useRef<({ material: { color: Color } } | null)[]>([]);
  const angles = useRef(ORBITS.map((o) => o.phase));
  const level = useRef(0);
  const time = useRef(0);

  const colors = useMemo(
    () => ({
      core: new Color(MODE_COLORS.idle.core),
      hot: new Color(MODE_COLORS.idle.hot),
      ring: new Color(MODE_COLORS.idle.ring),
      target: new Color(),
    }),
    [],
  );
  const core = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: coreVertex,
        fragmentShader: coreFragment,
        uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uColor: { value: colors.core }, uHot: { value: colors.hot } },
      }),
    [colors],
  );
  const halo = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
        uniforms: { uColor: { value: colors.core }, uLevel: { value: 0 } },
        side: BackSide,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    [colors],
  );
  useEffect(
    () => () => {
      core.dispose();
      halo.dispose();
    },
    [core, halo],
  );
  const curves = useMemo(
    () => ORBITS.map((o) => new EllipseCurve(0, 0, o.a, o.b).getPoints(160).map((p) => new Vector3(p.x, p.y, 0))),
    [],
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const s = signal.current;
    level.current = smoothLevel(level.current, s.mode === 'speaking' ? s.level : 0, dt);
    // Com "reduzir movimento", a reacao a voz fica atenuada e nada gira.
    const lv = reducedMotion ? level.current * 0.3 : level.current;
    if (!reducedMotion) time.current += dt;

    const k = 1 - Math.exp(-dt * 4);
    const palette = MODE_COLORS[s.mode];
    colors.core.lerp(colors.target.set(palette.core), k);
    colors.hot.lerp(colors.target.set(palette.hot), k);
    colors.ring.lerp(colors.target.set(palette.ring), k);

    core.uniforms.uTime.value = time.current;
    core.uniforms.uLevel.value = lv;
    halo.uniforms.uLevel.value = lv;
    const breathe = reducedMotion ? 1 : 1 + Math.sin(time.current * 1.2) * 0.02;
    nucleus.current?.scale.setScalar(breathe + lv * 0.12);

    const speed = reducedMotion ? 0 : electronSpeed(s.mode, level.current);
    ORBITS.forEach((o, i) => {
      angles.current[i] += dt * speed * (1 + i * 0.12);
      electrons.current[i]?.position.set(Math.cos(angles.current[i]) * o.a, Math.sin(angles.current[i]) * o.b, 0);
      lines.current[i]?.material.color.copy(colors.ring);
    });
    if (group.current && !reducedMotion) group.current.rotation.y += dt * 0.08;
  });

  return (
    <group ref={group}>
      <mesh ref={nucleus} material={core}>
        <icosahedronGeometry args={[1.15, detail]} />
      </mesh>
      <mesh material={halo} raycast={() => null}>
        <sphereGeometry args={[2.1, 48, 48]} />
      </mesh>
      {ORBITS.map((o, i) => (
        <group key={i} rotation={o.rotation}>
          <Line
            ref={(l) => {
              lines.current[i] = l as unknown as { material: { color: Color } } | null;
            }}
            points={curves[i]}
            color={MODE_COLORS.idle.ring}
            lineWidth={1}
            transparent
            opacity={0.55}
          />
          <Trail width={0.9} length={5} color="#bfe3ff" attenuation={(w) => w * w}>
            <mesh
              ref={(m) => {
                electrons.current[i] = m;
              }}
            >
              <sphereGeometry args={[0.09, 16, 16]} />
              <meshBasicMaterial color="#e8f4ff" toneMapped={false} />
            </mesh>
          </Trail>
        </group>
      ))}
    </group>
  );
}
```

```tsx file=app/web/src/scene/CoreScene.tsx
import { useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { Atom } from './Atom.tsx';
import type { CoreSignal } from './core.ts';
import { HIGH_QUALITY, nextQuality, type Quality } from './quality.ts';

export interface CoreSceneProps {
  signal: MutableRefObject<CoreSignal>;
  reducedMotion: boolean;
  /** Escurece a cena (gaveta de terminais aberta). */
  dimmed: boolean;
}

/** O atomo no centro, sobre um ceu estrelado. A camera nunca sai dele. */
export function CoreScene({ signal, reducedMotion, dimmed }: CoreSceneProps) {
  const [quality, setQuality] = useState<Quality>(HIGH_QUALITY);
  return (
    <div className={dimmed ? 'galaxy dimmed' : 'galaxy'}>
      <Canvas camera={{ position: [0, 0, 15], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <Stars radius={90} depth={40} count={2500} factor={3} fade speed={reducedMotion ? 0 : 0.4} />
        <Atom signal={signal} reducedMotion={reducedMotion} detail={quality.detail} />
        <OrbitControls enablePan={false} enableZoom={false} rotateSpeed={0.4} />
        <FpsMonitor onSample={(fps) => setQuality((q) => nextQuality(q, fps))} />
        {quality.bloom && (
          <EffectComposer>
            <Bloom mipmapBlur intensity={1.3} luminanceThreshold={0.2} luminanceSmoothing={0.3} />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}

/** Uma amostra de FPS por segundo. */
function FpsMonitor({ onSample }: { onSample: (fps: number) => void }) {
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, delta) => {
    const a = acc.current;
    a.frames++;
    a.time += delta;
    if (a.time >= 1) {
      onSample(a.frames / a.time);
      a.frames = 0;
      a.time = 0;
    }
  });
  return null;
}
```

- [ ] **Step 3: Checar tipos da cena**

Run: `cd app/web && npx tsc -p . 2>&1 | grep -v "src/App.tsx"`
Expected: nenhum erro fora de `src/App.tsx` (que ainda importa a cena antiga e é reescrito na Task 3).

- [ ] **Step 4: Commit**

```bash
git add -A app/web/src/scene
git commit -m "Replace the black hole with an animated atom voice core"
```

---

### Task 3: Cartões radiais e integração

**Files:**
- Create: `app/web/src/components/Ring.tsx`, `app/web/src/components/SkillDetail.tsx`
- Modify (substituir inteiros): `app/web/src/App.tsx`, `app/web/src/components/Sidebar.tsx`, `app/web/src/three.css`
- Modify: `README.md` (parágrafo da cena na seção "Interface")

**Interfaces:**
- Consumes: Tasks 1 e 2; componentes do marco 1.
- Produces: `Ring({ items, page, pages, animationKey, loading, onPage, onActivate })`; `SkillDetail({ skill })`; `Sidebar` ganha `settings.voiceDemo` e `onToggleVoiceDemo`.

- [ ] **Step 1: Componentes**

```tsx file=app/web/src/components/Ring.tsx
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ringPositions, type RingItem } from '../ring.ts';

interface Props {
  items: RingItem[];
  page: number;
  pages: number;
  /** Muda a cada nivel/pagina para refazer a animacao de entrada. */
  animationKey: string;
  loading: boolean;
  onPage: (delta: 1 | -1) => void;
  onActivate: (item: RingItem) => void;
}

/** Cartoes dispostos numa elipse em volta do nucleo. */
export function Ring({ items, page, pages, animationKey, loading, onPage, onActivate }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const positions = ringPositions(items.length, Math.min(size.w * 0.36, 560), Math.min(size.h * 0.36, 320));
  return (
    <div className="ring" ref={ref}>
      <div key={animationKey}>
        {items.map((item, i) => (
          <button
            key={item.key}
            className={`ring-card tone-${item.tone}`}
            style={{ '--x': `${positions[i].x}px`, '--y': `${positions[i].y}px`, animationDelay: `${i * 30}ms` } as CSSProperties}
            disabled={!item.action}
            title={item.subtitle ? `${item.title} — ${item.subtitle}` : item.title}
            onClick={() => onActivate(item)}
          >
            <span className={item.live ? 'card-dot live' : 'card-dot'} />
            <span className="card-text">
              <strong>{item.title}</strong>
              {item.subtitle && <small>{item.subtitle}</small>}
            </span>
            {item.badge && <span className="card-badge">{item.badge}</span>}
          </button>
        ))}
      </div>
      {loading && <div className="ring-status">Carregando…</div>}
      {!loading && !items.length && <div className="ring-status">Nada por aqui.</div>}
      {pages > 1 && (
        <>
          <button className="ring-page prev" onClick={() => onPage(-1)} disabled={page === 0} aria-label="Página anterior">
            ‹
          </button>
          <button className="ring-page next" onClick={() => onPage(1)} disabled={page === pages - 1} aria-label="Próxima página">
            ›
          </button>
          <div className="ring-status">
            página {page + 1} de {pages}
          </div>
        </>
      )}
    </div>
  );
}
```

```tsx file=app/web/src/components/SkillDetail.tsx
import type { Skill } from '../types.ts';

export function SkillDetail({ skill }: { skill: Skill }) {
  return (
    <section className="panel">
      <h1>{skill.name}</h1>
      <p>
        <span className="tag">{skill.origin}</span>
      </p>
      <p>{skill.description || 'Sem descrição.'}</p>
      <p>
        <code>{skill.path}</code>
      </p>
    </section>
  );
}
```

```tsx file=app/web/src/components/Sidebar.tsx
import { useState } from 'react';
import type { Overview, SessionInfo, View } from '../types.ts';

interface Settings {
  webgl: boolean;
  mode3d: boolean;
  reduceMotion: boolean;
  voiceDemo: boolean;
}

interface Props {
  overview: Overview | null;
  view: View;
  sessions: SessionInfo[];
  settings: Settings;
  onSelect: (v: View) => void;
  onToggle3d: () => void;
  onToggleReduceMotion: () => void;
  onToggleVoiceDemo: () => void;
}

export function Sidebar(props: Props) {
  const { overview, view, sessions, settings, onSelect } = props;
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const projects = (overview?.projects ?? []).filter((p) => p.name.toLowerCase().includes(q));
  const live = new Set(sessions.filter((s) => s.alive).map((s) => s.projectPath));
  const cls = (active: boolean) => (active ? 'nav active' : 'nav');
  const use3d = settings.webgl && settings.mode3d;
  return (
    <nav className="sidebar">
      <div className="brand">llm-agent</div>
      <button className={cls(view.kind === 'profile')} onClick={() => onSelect({ kind: 'profile' })}>
        Você
      </button>
      <button className={cls(view.kind === 'skills')} onClick={() => onSelect({ kind: 'skills' })}>
        Skills <span className="count">{overview?.skills.length ?? 0}</span>
      </button>
      <input className="filter" placeholder="Filtrar projetos" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <ul className="projects">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              className={cls(view.kind === 'project' && view.id === p.id)}
              title={p.path}
              onClick={() => onSelect({ kind: 'project', id: p.id })}
            >
              {live.has(p.path) && <span className="pulse" aria-label="sessão aberta" />}
              {p.name}
              <span className="count">{p.conversations}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="settings">
        <label title={settings.webgl ? '' : 'Este navegador não tem WebGL 2'}>
          <input type="checkbox" checked={use3d} disabled={!settings.webgl} onChange={props.onToggle3d} />
          Modo 3D
        </label>
        <label>
          <input type="checkbox" checked={settings.reduceMotion} onChange={props.onToggleReduceMotion} />
          Reduzir movimento
        </label>
        <label title="Simula a voz do agente para ver o núcleo reagir">
          <input type="checkbox" checked={settings.voiceDemo} disabled={!use3d} onChange={props.onToggleVoiceDemo} />
          Demonstração de voz
        </label>
      </div>
      <div className="hint">Ctrl+K busca · Esc volta · Ctrl+Tab alterna terminais</div>
    </nav>
  );
}
```

```css file=app/web/src/three.css
.content.three { padding: 0; overflow: hidden; }
.content.three .banner { position: absolute; top: 64px; left: 50%; transform: translateX(-50%); z-index: 5; }
.galaxy { position: absolute; inset: 0; transition: filter 0.3s; }
.galaxy.dimmed { filter: brightness(0.45) saturate(0.8); }

.navbar { position: absolute; top: 16px; left: 16px; right: 16px; z-index: 4; display: flex; align-items: center; gap: 12px; pointer-events: none; }
.navbar > * { pointer-events: auto; }
.crumbs { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.crumbs button { background: rgba(10, 14, 26, 0.7); }
.crumbs .current { border-color: var(--accent); color: var(--accent); }
.crumbs .sep { color: var(--muted); }
.navbar input { margin-left: auto; width: 220px; background: rgba(10, 14, 26, 0.7); }
.core-caption { position: absolute; left: 50%; bottom: 64px; transform: translateX(-50%); z-index: 2; color: var(--muted); font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; pointer-events: none; }

.ring { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.ring-card {
  position: absolute; left: 50%; top: 50%; width: 196px;
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; text-align: left;
  background: rgba(10, 14, 26, 0.78); backdrop-filter: blur(6px);
  border: 1px solid var(--line); border-radius: 12px; pointer-events: auto;
  transform: translate(calc(var(--x) - 50%), calc(var(--y) - 50%));
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
  animation: ring-in 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
}
.ring-card:hover:not(:disabled) {
  border-color: var(--c); box-shadow: 0 0 20px -4px var(--c);
  transform: translate(calc(var(--x) - 50%), calc(var(--y) - 50%)) scale(1.05);
}
.ring-card:disabled { cursor: default; color: var(--text); opacity: 0.9; }
@keyframes ring-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
  to { opacity: 1; transform: translate(calc(var(--x) - 50%), calc(var(--y) - 50%)) scale(1); }
}
.tone-claude { --c: var(--claude); }
.tone-codex { --c: var(--codex); }
.tone-both { --c: var(--accent); }
.tone-shell { --c: var(--shell); }
.tone-plugin { --c: #9fc2ff; }
.tone-accent { --c: #7fd8ff; }
.tone-warn { --c: var(--warn); }
.tone-muted { --c: var(--muted); }
.card-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: var(--c); box-shadow: 0 0 8px var(--c); }
.card-dot.live { animation: pulse 1.6s infinite; }
.card-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.card-text strong, .card-text small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-text strong { font-weight: 600; }
.card-text small { color: var(--muted); }
.card-badge { font-size: 12px; color: var(--c); }
.ring-page { position: absolute; top: 50%; transform: translateY(-50%); width: 40px; height: 40px; border-radius: 50%; font-size: 22px; pointer-events: auto; background: rgba(10, 14, 26, 0.7); }
.ring-page.prev { left: 24px; }
.ring-page.next { right: 24px; }
.ring-status { position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); color: var(--muted); font-size: 12px; }

.panel-overlay {
  position: absolute; top: 64px; right: 16px; bottom: 16px; z-index: 6;
  width: min(460px, 45%); overflow: auto; padding: 20px 24px;
  background: rgba(8, 10, 18, 0.88); backdrop-filter: blur(8px);
  border: 1px solid var(--line); border-radius: 12px;
}
.panel-close { position: sticky; top: 0; float: right; border: none; background: transparent; font-size: 18px; }
.settings { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px solid var(--line); margin-top: 12px; font-size: 12px; color: var(--muted); }
.settings label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
```

- [ ] **Step 2: App**

```tsx file=app/web/src/App.tsx
import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Api, LiveSocket, takeToken, wsUrl, type Status } from './api.ts';
import { bus } from './bus.ts';
import { currentNode, initialNav, navReducer, projectIdOf } from './nav.ts';
import { hasWebGL, systemReducedMotion, usePref } from './prefs.ts';
import { crumbLabel, filterItems, itemsFor, paginate, type Panel, type RingItem } from './ring.ts';
import { demoSignal, MODE_LABEL, type CoreSignal } from './scene/core.ts';
import { addTab, applyAction, closeTab, emptyTabs, shortcut, syncTabs, type TabsState } from './tabs.ts';
import type { Conversation, Overview, ProjectDetail, ServerMessage, SessionAgent, SessionInfo, View } from './types.ts';
import { FileCard } from './components/FileCard.tsx';
import { ProfilePanel } from './components/ProfilePanel.tsx';
import { ProjectPanel } from './components/ProjectPanel.tsx';
import { Ring } from './components/Ring.tsx';
import { SearchDialog } from './components/SearchDialog.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { SkillDetail } from './components/SkillDetail.tsx';
import { SkillsPanel } from './components/SkillsPanel.tsx';
import { TerminalDrawer } from './components/TerminalDrawer.tsx';

// A cena 3D (three.js) so e baixada quando o modo 3D esta ligado.
const CoreScene = lazy(() => import('./scene/CoreScene.tsx').then((m) => ({ default: m.CoreScene })));

export function App() {
  const token = useMemo(
    () => takeToken(window.location, window.sessionStorage, (url) => window.history.replaceState(null, '', url)),
    [],
  );
  if (!token) {
    return (
      <div className="fatal">
        Abra a interface pela URL impressa por <code>llm-agent ui</code>.
      </div>
    );
  }
  return <Connected token={token} />;
}

function Connected({ token }: { token: string }) {
  const api = useMemo(() => new Api(token), [token]);
  const webgl = useMemo(hasWebGL, []);
  const [mode3d, setMode3d] = usePref('llm-agent-3d', true);
  const [reduceMotion, setReduceMotion] = usePref('llm-agent-reduce-motion', systemReducedMotion());
  const [voiceDemo, setVoiceDemo] = usePref('llm-agent-voice-demo', false);
  const use3d = webgl && mode3d;

  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tabs, setTabs] = useState<TabsState>(emptyTabs);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [socket, setSocket] = useState<LiveSocket | null>(null);

  // Modo 3D: navegacao radial + painel de leitura. Modo lista: "view" do marco 1.
  const [nav, dispatch] = useReducer(navReducer, initialNav);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [view, setView] = useState<View>({ kind: 'profile' });
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const node = currentNode(nav);
  const projectId = projectIdOf(node);

  // Sinal do nucleo, lido a cada quadro pela cena (sem re-render).
  const signal = useRef<CoreSignal>({ mode: 'idle', level: 0 });
  const [coreMode, setCoreMode] = useState<CoreSignal['mode']>('idle');

  const refs = useRef({ tabs, panel, searchOpen, use3d });
  refs.current = { tabs, panel, searchOpen, use3d };

  useEffect(() => {
    api.overview().then(
      (o) => {
        setOverview(o);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, [api, revision]);

  useEffect(() => {
    if (!projectId) return;
    let current = true;
    api.project(projectId).then(
      (d) => current && setDetail(d),
      (e: Error) => current && setError(e.message),
    );
    return () => {
      current = false;
    };
  }, [api, projectId, revision]);

  useEffect(() => {
    if (!voiceDemo || !use3d) {
      signal.current = { mode: 'idle', level: 0 };
      setCoreMode('idle');
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const s = demoSignal((now - start) / 1000);
      signal.current = s;
      setCoreMode((m) => (m === s.mode ? m : s.mode));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [voiceDemo, use3d]);

  useEffect(() => {
    // Depois de (re)conectar, o primeiro "sessions" pede o historico de todas.
    let needAttach = true;
    const ws = new LiveSocket(
      wsUrl(window.location, token),
      (m: ServerMessage) => {
        switch (m.type) {
          case 'sessions':
            setSessions(m.sessions);
            setTabs((t) => syncTabs(t, m.sessions.map((s) => s.id)));
            if (needAttach) {
              needAttach = false;
              for (const s of m.sessions) ws.send({ type: 'attach', id: s.id });
            }
            break;
          case 'opened':
            setTabs((t) => addTab(t, m.session.id));
            setDrawerCollapsed(false);
            break;
          case 'output':
            bus.data(m.id, m.data);
            break;
          case 'history':
            bus.history(m.id, m.data);
            break;
          case 'changed':
            setRevision((r) => r + 1);
            break;
          case 'error':
            setError(m.message);
            break;
        }
      },
      (s) => {
        setStatus(s);
        if (s === 'open') {
          needAttach = true;
          setRevision((r) => r + 1);
        }
      },
    );
    setSocket(ws);
    return () => ws.stop();
  }, [token]);

  const openSession = useCallback(
    (projectPath: string, agent: SessionAgent, resume?: string) => {
      if (!socket?.send({ type: 'open', projectPath, agent, resume, cols: 120, rows: 30 })) {
        setError('Sem conexão com o servidor.');
      }
    },
    [socket],
  );

  const closeSession = useCallback(
    (id: string) => {
      socket?.send({ type: 'close', id });
      setTabs((t) => closeTab(t, id));
    },
    [socket],
  );

  const focusTab = useCallback((id: string) => {
    setTabs((t) => ({ ...t, active: id }));
    setDrawerCollapsed(false);
  }, []);

  const showProject = useCallback((id: string) => {
    if (refs.current.use3d) dispatch({ type: 'jump', node: { kind: 'project', id } });
    else setView({ kind: 'project', id });
  }, []);

  const resumeConversation = useCallback(
    (c: Conversation) => {
      const project = overview?.projects.find((p) => p.path === c.cwd);
      if (project) {
        if (refs.current.use3d) dispatch({ type: 'jump', node: { kind: 'conversations', projectId: project.id } });
        else setView({ kind: 'project', id: project.id });
      }
      openSession(c.cwd, c.agent, c.id);
    },
    [overview, openSession],
  );

  const showSkill = useCallback(
    (path: string) => {
      if (!refs.current.use3d) return setView({ kind: 'skills', focus: path });
      dispatch({ type: 'jump', node: { kind: 'skills' } });
      const skill = overview?.skills.find((s) => s.path === path);
      if (skill) setPanel({ kind: 'skill', skill });
    },
    [overview],
  );

  const activate = useCallback(
    (item: RingItem) => {
      const a = item.action;
      if (!a) return;
      if (a.type === 'nav') dispatch({ type: 'push', node: a.node });
      else if (a.type === 'panel') setPanel(a.panel);
      else if (a.type === 'open') openSession(a.projectPath, a.agent, a.resume);
      else focusTab(a.sessionId);
    },
    [openSession, focusTab],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inTerminal = target?.closest?.('.terminal') != null;
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && !inTerminal) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === 'Escape' && !inTerminal && !refs.current.searchOpen && refs.current.use3d) {
        if (refs.current.panel) setPanel(null);
        else if (target?.tagName !== 'INPUT') dispatch({ type: 'back' });
        return;
      }
      const action = shortcut(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      const { state, closed } = applyAction(refs.current.tabs, action);
      if (closed) socket?.send({ type: 'close', id: closed });
      setTabs(state);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [socket]);

  const ring = useMemo(() => {
    if (!overview) return { items: [], page: 0, pages: 1 };
    return paginate(filterItems(itemsFor(node, { overview, sessions, detail }), nav.filter), nav.page);
  }, [overview, sessions, detail, node, nav.filter, nav.page]);
  const ringLoading = !overview || (projectId !== null && detail?.id !== projectId);
  const showFilter = node.kind !== 'home' && node.kind !== 'project';

  // Barra lateral: no modo 3D, reflete e comanda a navegacao radial.
  const sidebarView: View = !use3d
    ? view
    : projectId
      ? { kind: 'project', id: projectId }
      : node.kind === 'skills'
        ? { kind: 'skills' }
        : panel?.kind === 'profile'
          ? { kind: 'profile' }
          : { kind: 'none' };
  const selectFromSidebar = (v: View) => {
    if (!use3d) return setView(v);
    if (v.kind === 'profile') setPanel({ kind: 'profile' });
    else if (v.kind === 'skills') dispatch({ type: 'jump', node: { kind: 'skills' } });
    else if (v.kind === 'project') dispatch({ type: 'jump', node: { kind: 'project', id: v.id } });
  };

  const listPanel =
    view.kind === 'skills' ? (
      <SkillsPanel skills={overview?.skills ?? []} focus={view.focus} />
    ) : view.kind === 'project' ? (
      <ProjectPanel api={api} id={view.id} revision={revision} onOpen={openSession} />
    ) : (
      <ProfilePanel profile={overview?.profile} />
    );

  const readingPanel =
    panel?.kind === 'profile' ? (
      <ProfilePanel profile={overview?.profile} />
    ) : panel?.kind === 'skill' ? (
      <SkillDetail skill={panel.skill} />
    ) : panel?.kind === 'files' ? (
      <section className="panel">
        <h1>{panel.title}</h1>
        {panel.files.map((f, i) => (
          <FileCard key={f.path} file={f} open={i === 0} />
        ))}
      </section>
    ) : null;

  return (
    <div className="app">
      <Sidebar
        overview={overview}
        view={sidebarView}
        sessions={sessions}
        settings={{ webgl, mode3d, reduceMotion, voiceDemo }}
        onSelect={selectFromSidebar}
        onToggle3d={() => setMode3d(!mode3d)}
        onToggleReduceMotion={() => setReduceMotion(!reduceMotion)}
        onToggleVoiceDemo={() => setVoiceDemo(!voiceDemo)}
      />
      <main className={use3d ? 'content three' : 'content'}>
        {status !== 'open' && <div className="banner">Reconectando ao servidor…</div>}
        {error && (
          <div className="banner error" onClick={() => setError(null)} title="Clique para fechar">
            {error}
          </div>
        )}
        {use3d ? (
          <>
            <Suspense fallback={null}>
              <CoreScene signal={signal} reducedMotion={reduceMotion} dimmed={tabs.order.length > 0 && !drawerCollapsed} />
            </Suspense>
            <div className="navbar">
              <div className="crumbs">
                {nav.stack.map((n, depth) => (
                  <Fragment key={depth}>
                    {depth > 0 && <span className="sep">›</span>}
                    <button
                      className={depth === nav.stack.length - 1 ? 'current' : ''}
                      onClick={() => dispatch({ type: 'goto', depth })}
                    >
                      {crumbLabel(n, overview)}
                    </button>
                  </Fragment>
                ))}
              </div>
              {showFilter && (
                <input
                  placeholder="Filtrar"
                  value={nav.filter}
                  onChange={(e) => dispatch({ type: 'filter', value: e.target.value })}
                />
              )}
            </div>
            <Ring
              items={ring.items}
              page={ring.page}
              pages={ring.pages}
              animationKey={`${nav.stack.length}:${JSON.stringify(node)}:${ring.page}`}
              loading={ringLoading}
              onPage={(delta) => dispatch({ type: 'page', delta })}
              onActivate={activate}
            />
            {coreMode !== 'idle' && <div className="core-caption">{MODE_LABEL[coreMode]}</div>}
            {readingPanel && (
              <aside className="panel-overlay">
                <button className="panel-close" onClick={() => setPanel(null)} aria-label="Fechar painel">
                  ×
                </button>
                {readingPanel}
              </aside>
            )}
          </>
        ) : (
          listPanel
        )}
      </main>
      <TerminalDrawer
        tabs={tabs}
        sessions={sessions}
        projects={overview?.projects ?? []}
        socket={socket}
        collapsed={drawerCollapsed}
        onCollapsedChange={setDrawerCollapsed}
        onActivate={focusTab}
        onClose={closeSession}
        onReopen={(s) => {
          closeSession(s.id);
          openSession(s.projectPath, s.agent, s.resume);
        }}
      />
      {searchOpen && overview && (
        <SearchDialog
          overview={overview}
          onClose={() => setSearchOpen(false)}
          onProject={showProject}
          onSkill={showSkill}
          onConversation={resumeConversation}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: README**

Na seção `## Interface` do `README.md`, substituir o parágrafo que começa com "No centro fica um buraco negro" por:

```markdown
No centro fica o núcleo do agente, um átomo animado: ele respira devagar quando está ocioso e, na etapa de voz, muda de cor ao ouvir e ao pensar e pulsa enquanto o agente fala (ligue **Demonstração de voz** na barra lateral para ver). Em volta dele ficam os cartões: Você, Projetos, Skills e Sessões abertas. Abrir um projeto mostra as conversas, a memória, as instruções, o git e os botões de nova sessão; abrir as conversas mostra uma por cartão, e clicar retoma. A trilha no topo mostra onde você está, e `Esc` volta um nível. Na barra lateral, **Modo 3D** troca para a interface em lista e **Reduzir movimento** congela as animações. Em GPUs mais fracas, a cena reduz a qualidade sozinha.
```

- [ ] **Step 4: Checar tudo**

Run: `cd app/web && npm run typecheck && npm test && npm run build`
Expected: sem erros de tipo; testes `passed`; build gera o chunk `CoreScene-*.js`.

- [ ] **Step 5: Verificação manual (usuário)**

Run (no host WSL): `rm -rf app/web/dist; llm-agent ui --stop; llm-agent ui` e abrir a URL.
Expected:
1. Átomo no centro com três órbitas e elétrons com rastro; cartões Você, Projetos, Skills e Sessões abertas em volta.
2. "Demonstração de voz": o átomo fica ciano (ouvindo), violeta com elétrons rápidos (pensando) e pulsa e se deforma (falando); a legenda abaixo mostra o estado.
3. Projetos → projeto → Conversas → clicar retoma no terminal; a cena escurece; a trilha volta a qualquer nível; `Esc` sobe.
4. Skills com mais de 12 itens mostram setas e "página 1 de N"; o filtro funciona.
5. Memória/Instruções/Você/skill abrem no painel à direita; `Esc` fecha.

- [ ] **Step 6: Commit**

```bash
git add -A app/web/src README.md
git commit -m "Show content in radial cards around the voice core"
```
