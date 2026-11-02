import { describe, expect, it } from 'vitest';
import { addTab, applyAction, closeTab, cycle, emptyTabs, goto, shortcut, syncTabs } from '../src/tabs.ts';

const three = { order: ['a', 'b', 'c'], active: 'b' };

describe('abas', () => {
  it('addTab acrescenta no fim e ativa; se ja existe, so ativa', () => {
    expect(addTab(emptyTabs, 'a')).toEqual({ order: ['a'], active: 'a' });
    expect(addTab(three, 'a')).toEqual({ order: ['a', 'b', 'c'], active: 'a' });
  });
  it('closeTab ativa a vizinha', () => {
    expect(closeTab(three, 'b')).toEqual({ order: ['a', 'c'], active: 'c' });
    expect(closeTab({ ...three, active: 'c' }, 'c')).toEqual({ order: ['a', 'b'], active: 'b' });
    expect(closeTab(three, 'a')).toEqual({ order: ['b', 'c'], active: 'b' });
    expect(closeTab({ order: ['a'], active: 'a' }, 'a')).toEqual(emptyTabs);
  });
  it('cycle da a volta', () => {
    expect(cycle(three, 1).active).toBe('c');
    expect(cycle({ ...three, active: 'c' }, 1).active).toBe('a');
    expect(cycle({ ...three, active: 'a' }, -1).active).toBe('c');
    expect(cycle(emptyTabs, 1)).toEqual(emptyTabs);
  });
  it('goto ignora indice inexistente', () => {
    expect(goto(three, 0).active).toBe('a');
    expect(goto(three, 8)).toBe(three);
  });
  it('syncTabs remove sessoes que sumiram e acrescenta as novas', () => {
    expect(syncTabs(three, ['c', 'd', 'a'])).toEqual({ order: ['a', 'c', 'd'], active: 'a' });
    expect(syncTabs(three, ['b'])).toEqual({ order: ['b'], active: 'b' });
  });
});

describe('atalhos', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
    key: k, ctrlKey: true, shiftKey: false, altKey: false, ...mods,
  });
  it('mapeia Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1..9 e Ctrl+Shift+W', () => {
    expect(shortcut(key('Tab'))).toEqual({ type: 'next' });
    expect(shortcut(key('Tab', { shiftKey: true }))).toEqual({ type: 'prev' });
    expect(shortcut(key('3'))).toEqual({ type: 'goto', index: 2 });
    expect(shortcut(key('W', { shiftKey: true }))).toEqual({ type: 'close' });
  });
  it('ignora o resto', () => {
    expect(shortcut(key('Tab', { ctrlKey: false }))).toBeNull();
    expect(shortcut(key('c'))).toBeNull();
    expect(shortcut(key('0'))).toBeNull();
    expect(shortcut(key('3', { altKey: true }))).toBeNull();
  });
  it('applyAction informa a aba fechada', () => {
    expect(applyAction(three, { type: 'close' })).toEqual({ state: { order: ['a', 'c'], active: 'c' }, closed: 'b' });
    expect(applyAction(three, { type: 'next' })).toEqual({ state: { order: ['a', 'b', 'c'], active: 'c' } });
    expect(applyAction(emptyTabs, { type: 'close' })).toEqual({ state: emptyTabs });
  });
});
