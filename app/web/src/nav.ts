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
