import { useEffect, useRef } from 'react';
import { HoldKeys } from './hold.ts';
import type { Hotkey } from './hotkey.ts';

/** Liga um atalho a toda a pagina, inclusive com o foco num terminal. `hotkey` null: desligado. */
export function useHoldKeys(hotkey: Hotkey | null, onPress: () => void, onRelease: () => void = () => {}): void {
  // As acoes mudam a cada render; religar os escutadores soltaria um atalho que esta sendo segurado.
  const actions = useRef({ onPress, onRelease });
  actions.current = { onPress, onRelease };

  useEffect(() => {
    if (!hotkey) return;
    const keys = new HoldKeys(
      () => actions.current.onPress(),
      () => actions.current.onRelease(),
      hotkey,
    );
    const consume = (taken: boolean, e: Event) => {
      if (!taken) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const down = (e: KeyboardEvent) => consume(keys.keydown(e), e);
    const up = (e: KeyboardEvent) => consume(keys.keyup(e), e);
    // Botao do meio: `mousedown` impede a rolagem automatica; `mouseup`, colar no Linux; `auxclick`, abrir link.
    const mouseDown = (e: MouseEvent) => consume(keys.mousedown(e), e);
    const mouseUp = (e: MouseEvent) => consume(keys.mouseup(e), e);
    const aux = (e: MouseEvent) => consume(keys.auxclick(e), e);
    const mouseMove = (e: MouseEvent) => keys.mousemove(e);
    // Vem antes do `mousedown` e so nao chega ao zoom da cena; cancelar aqui sumiria com o `mouseup`.
    const pointerDown = (e: PointerEvent) => {
      if (keys.mousedown(e)) e.stopPropagation();
    };
    const lost = () => keys.cancel();
    const hidden = () => document.hidden && keys.cancel();
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('mousedown', mouseDown, true);
    window.addEventListener('mouseup', mouseUp, true);
    window.addEventListener('auxclick', aux, true);
    window.addEventListener('mousemove', mouseMove, true);
    window.addEventListener('blur', lost);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('mousedown', mouseDown, true);
      window.removeEventListener('mouseup', mouseUp, true);
      window.removeEventListener('auxclick', aux, true);
      window.removeEventListener('mousemove', mouseMove, true);
      window.removeEventListener('blur', lost);
      document.removeEventListener('visibilitychange', hidden);
      keys.cancel();
    };
  }, [hotkey]);
}
