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
