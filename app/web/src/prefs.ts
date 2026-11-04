import { useState } from 'react';
import { DEFAULT_HOTKEY, parseHotkey, usableHotkey, type Hotkey } from './voice/hotkey.ts';

export function hasWebGL(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export const systemReducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Ha um mouse (ou trackpad) no aparelho. O navegador nao conta quantos botoes ele tem: um mouse
 * sem o botao do meio so nunca manda o aperto, e por isso a gravacao nunca o registra.
 */
export const hasMouse = (): boolean => window.matchMedia?.('(any-pointer: fine)').matches ?? true;

/** Preferencia booleana guardada no localStorage ('1' / '0'). */
export function usePref(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    const saved = localStorage.getItem(key);
    return saved === null ? initial : saved === '1';
  });
  const set = (v: boolean) => {
    localStorage.setItem(key, v ? '1' : '0');
    setValue(v);
  };
  return [value, set];
}

/** Preferencia de uma lista fixa de opcoes, guardada no localStorage. */
export function useChoice<T extends string>(key: string, initial: T, valid: (v: unknown) => v is T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const saved = localStorage.getItem(key);
    return valid(saved) ? saved : initial;
  });
  const set = (v: T) => {
    localStorage.setItem(key, v);
    setValue(v);
  };
  return [value, set];
}

/**
 * Atalho de falar, guardado no localStorage; o que estiver invalido volta ao padrao.
 * Com o botao do meio e sem mouse, vale o padrao, mas a escolha fica guardada para quando o mouse voltar.
 */
export function useHotkey(key: string): [Hotkey, (h: Hotkey) => void] {
  const [value, setValue] = useState<Hotkey>(() => parseHotkey(localStorage.getItem(key)) ?? DEFAULT_HOTKEY);
  const set = (h: Hotkey) => {
    localStorage.setItem(key, JSON.stringify(h));
    setValue(h);
  };
  return [usableHotkey(value, hasMouse()), set];
}
