import { LABEL } from './format.ts';
import type { SessionInfo } from './types.ts';

export interface TabsState {
  order: string[];
  active: string | null;
}

export const emptyTabs: TabsState = { order: [], active: null };

export type TabAction = { type: 'next' } | { type: 'prev' } | { type: 'goto'; index: number } | { type: 'close' };

export function addTab(s: TabsState, id: string): TabsState {
  return s.order.includes(id) ? { ...s, active: id } : { order: [...s.order, id], active: id };
}

export function closeTab(s: TabsState, id: string): TabsState {
  const i = s.order.indexOf(id);
  if (i < 0) return s;
  const order = s.order.filter((x) => x !== id);
  const active = s.active !== id ? s.active : (order[Math.min(i, order.length - 1)] ?? null);
  return { order, active };
}

export function cycle(s: TabsState, delta: 1 | -1): TabsState {
  if (!s.order.length) return s;
  const i = s.active ? s.order.indexOf(s.active) : -1;
  const n = (i + delta + s.order.length) % s.order.length;
  return { ...s, active: s.order[n] };
}

export function goto(s: TabsState, index: number): TabsState {
  return s.order[index] ? { ...s, active: s.order[index] } : s;
}

/** Alinha as abas com as sessoes do servidor (mantem a ordem local). */
export function syncTabs(s: TabsState, ids: string[]): TabsState {
  const known = new Set(ids);
  const kept = s.order.filter((id) => known.has(id));
  const order = [...kept, ...ids.filter((id) => !kept.includes(id))];
  const active = s.active && known.has(s.active) ? s.active : (order[0] ?? null);
  return { order, active };
}

/** Nome completo da aba: e o que a aba mostra (cortado) e o que a dica mostra (inteiro). */
export function tabName(s: Pick<SessionInfo, 'projectPath' | 'agent' | 'title' | 'alive'>, projectName?: string): string {
  const name = `${projectName ?? s.projectPath} · ${LABEL[s.agent]} · ${s.title}`;
  return s.alive ? name : `${name} (encerrada)`;
}

/** Titulos que o servidor da a toda sessao nova: nao ajudam a diferenciar uma aba da outra. */
const GENERIC_TITLES = new Set(['shell', 'nova conversa']);

/**
 * Nome curto de cada aba, com o que diferencia uma da outra primeiro: o titulo da conversa ou
 * o agente; o projeto so entra com mais de um aberto; nomes repetidos ganham numero (Shell 2).
 */
export function tabLabels(sessions: Pick<SessionInfo, 'id' | 'projectPath' | 'agent' | 'title'>[], projectNames: Map<string, string>): Map<string, string> {
  const manyProjects = new Set(sessions.map((s) => s.projectPath)).size > 1;
  const bases = sessions.map((s) => {
    const base = GENERIC_TITLES.has(s.title) ? LABEL[s.agent] : s.title;
    return manyProjects ? `${projectNames.get(s.projectPath) ?? s.projectPath} · ${base}` : base;
  });
  const seen = new Map<string, number>();
  return new Map(
    sessions.map((s, i) => {
      const base = bases[i];
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return [s.id, bases.filter((b) => b === base).length > 1 ? `${base} ${n}` : base];
    }),
  );
}

/** Novo scrollLeft da barra para a aba ficar inteira na tela (nao mexe se ela ja estiver). */
export function revealScroll(scrollLeft: number, viewWidth: number, itemLeft: number, itemWidth: number): number {
  if (itemLeft < scrollLeft) return itemLeft;
  if (itemLeft + itemWidth > scrollLeft + viewWidth) return itemLeft + itemWidth - viewWidth;
  return scrollLeft;
}

export function shortcut(e: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): TabAction | null {
  if (!e.ctrlKey || e.altKey) return null;
  if (e.key === 'Tab') return { type: e.shiftKey ? 'prev' : 'next' };
  if (!e.shiftKey && /^[1-9]$/.test(e.key)) return { type: 'goto', index: Number(e.key) - 1 };
  if (e.shiftKey && e.key.toLowerCase() === 'w') return { type: 'close' };
  return null;
}

export function applyAction(s: TabsState, a: TabAction): { state: TabsState; closed?: string } {
  switch (a.type) {
    case 'next':
      return { state: cycle(s, 1) };
    case 'prev':
      return { state: cycle(s, -1) };
    case 'goto':
      return { state: goto(s, a.index) };
    case 'close':
      return s.active ? { state: closeTab(s, s.active), closed: s.active } : { state: s };
  }
}
