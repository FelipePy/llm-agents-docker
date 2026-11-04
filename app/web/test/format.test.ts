import { describe, expect, it } from 'vitest';
import { backgroundLabel } from '../src/format.ts';

describe('backgroundLabel', () => {
  it('nao mostra nada sem tarefas', () => {
    expect(backgroundLabel(0)).toBeNull();
  });

  it('usa o singular com uma tarefa', () => {
    expect(backgroundLabel(1)).toBe('1 tarefa rodando em background...');
  });

  it('usa o plural com varias tarefas', () => {
    expect(backgroundLabel(3)).toBe('3 tarefas rodando em background...');
  });
});
