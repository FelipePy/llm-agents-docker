import type { NavNode } from './nav.ts';
import type { Overview, ProjectDetail, SessionAgent, SessionInfo, Skill, TaskName, TextFile } from './types.ts';
import { LABEL, formatDate } from './format.ts';

/** Conteudo do painel de leitura. */
export type Panel =
  | { kind: 'skill'; skill: Skill }
  | { kind: 'files'; title: string; files: TextFile[] }
  | { kind: 'project'; detail: ProjectDetail }
  | { kind: 'new-project' };

export type Tone = 'claude' | 'codex' | 'both' | 'shell' | 'plugin' | 'accent' | 'warn' | 'muted' | 'add';

export type ItemAction =
  | { type: 'nav'; node: NavNode }
  | { type: 'panel'; panel: Panel }
  | { type: 'open'; projectPath: string; agent: SessionAgent; resume?: string }
  | { type: 'tab'; sessionId: string }
  | { type: 'task'; task: TaskName };

export interface RingItem {
  key: string;
  title: string;
  /** Usado na busca e na dica do cartao (o cartao mostra so o titulo). */
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

/** Nome de uma memoria: o "name" do frontmatter ou o nome do arquivo sem .md. */
export function memoryTitle(f: TextFile): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(f.content)?.[1] ?? '';
  const name = /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  return name || fileName(f).replace(/\.md$/, '');
}

const fileItem = (f: TextFile, title: string, tone: Tone): RingItem => ({
  key: f.path, title, subtitle: f.path, tone, action: { type: 'panel', panel: { kind: 'files', title, files: [f] } },
});

export function itemsFor(node: NavNode, { overview, sessions, detail }: RingData): RingItem[] {
  const alive = sessions.filter((s) => s.alive);
  const { profile } = overview;
  switch (node.kind) {
    case 'home':
      return [
        {
          key: 'profile', title: 'Você', subtitle: 'instruções e memórias',
          badge: String(profile.instructions.length + profile.memories.length), tone: 'accent',
          action: { type: 'nav', node: { kind: 'profile' } },
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
    case 'profile':
      return [
        { key: 'about-me', title: '+ Sobre mim', subtitle: 'contar algo novo ao Claude', tone: 'add', action: { type: 'task', task: 'about-me' } },
        ...profile.instructions.map((f) => fileItem(f, fileName(f), 'accent')),
        ...profile.memories.map((f) => fileItem(f, memoryTitle(f), 'claude')),
      ];
    case 'projects': {
      const live = new Set(alive.map((s) => s.projectPath));
      return [
        { key: 'new-project', title: '+ Novo projeto', tone: 'add', action: { type: 'panel', panel: { kind: 'new-project' } } },
        ...overview.projects.map(
          (p): RingItem => ({
            key: p.id, title: p.name, subtitle: `${p.path} · ${formatDate(p.updatedAt)}`, tone: agentsTone(p.agents),
            live: live.has(p.path), action: { type: 'nav', node: { kind: 'project', id: p.id } },
          }),
        ),
      ];
    }
    case 'project': {
      if (!detail || detail.id !== node.id) return [];
      const items: RingItem[] = [
        { key: 'info', title: 'Sobre o projeto', tone: 'accent', action: { type: 'panel', panel: { kind: 'project', detail } } },
        {
          key: 'conversations', title: 'Conversas', badge: String(detail.conversationList.length), tone: agentsTone(detail.agents),
          action: { type: 'nav', node: { kind: 'conversations', projectId: node.id } },
        },
      ];
      if (detail.memory.length) {
        items.push({
          key: 'memory', title: 'Memória', badge: String(detail.memory.length), tone: 'accent',
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
          key: 'git', title: `git · ${detail.git.branch}`, subtitle: detail.git.dirty ? 'mudanças pendentes' : 'sem mudanças',
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
      return [
        { key: 'new-skill', title: '+ Nova skill', subtitle: 'criar com o Claude', tone: 'add', action: { type: 'task', task: 'new-skill' } },
        ...overview.skills.map(
          (s): RingItem => ({
            key: s.path, title: s.name, subtitle: `${s.origin} · ${s.description}`, tone: skillTone(s.origin),
            action: { type: 'panel', panel: { kind: 'skill', skill: s } },
          }),
        ),
      ];
    case 'sessions': {
      const names = new Map(overview.projects.map((p) => [p.path, p.name]));
      return [
        { key: 'new-session', title: '+ Nova sessão', subtitle: 'escolher o projeto', tone: 'add', action: { type: 'nav', node: { kind: 'projects' } } },
        ...sessions.map(
          (s): RingItem => ({
            key: s.id,
            title: `${names.get(s.projectPath) ?? s.projectPath.split('/').pop()} · ${LABEL[s.agent]}${s.alive ? '' : ' (encerrada)'}`,
            subtitle: s.title, tone: s.agent, live: s.alive, action: { type: 'tab', sessionId: s.id },
          }),
        ),
      ];
    }
  }
}

export function crumbLabel(node: NavNode, overview: Overview | null): string {
  switch (node.kind) {
    case 'home':
      return 'Início';
    case 'profile':
      return 'Você';
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

export function paginate<T>(items: T[], page: number, size: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(page, 0), pages - 1);
  return { items: items.slice(p * size, p * size + size), page: p, pages };
}

/** Distancia vertical entre cartoes (px). */
export const CARD_SPACING = 40;

/**
 * Cartoes numa coluna em arco a direita do nucleo: espacamento vertical
 * uniforme, centrado na altura do nucleo; x segue a elipse (rx, ry).
 */
export function arcPositions(n: number, rx: number, ry: number, spacing = CARD_SPACING): { x: number; y: number }[] {
  const total = (n - 1) * spacing;
  return Array.from({ length: n }, (_, i) => {
    const y = n === 1 ? 0 : -total / 2 + i * spacing;
    const t = Math.min(1, Math.abs(y) / ry);
    return { x: rx * Math.sqrt(1 - t * t), y };
  });
}

/** Quantos cartoes cabem no arco (entre 6 e 18). */
export function pageSizeFor(ry: number, spacing = CARD_SPACING): number {
  return Math.max(6, Math.min(18, Math.floor((2 * ry * 0.94) / spacing) + 1));
}
