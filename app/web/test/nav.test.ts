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
    expect(pathTo({ kind: 'profile' })).toEqual([home, { kind: 'profile' }]);
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
