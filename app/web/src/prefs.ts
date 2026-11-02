import { useState } from 'react';

export function hasWebGL(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export const systemReducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

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
