// Atalho de falar configuravel: a combinacao escolhida, como ela e capturada e como e guardada.

export interface Hotkey {
  /** Tecla fisica (`KeyboardEvent.code`): nao muda com Shift nem com o layout. */
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** Como a combinacao aparece na tela, montado na captura (so ali se sabe o que a tecla escreve). */
  label: string;
}

type KeyLike = { code: string; key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean };

export const DEFAULT_HOTKEY: Hotkey = { code: 'Space', ctrl: true, shift: false, alt: false, meta: false, label: 'Ctrl+Espaço' };

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS', 'Fn', 'FnLock', 'Hyper', 'Super', 'Symbol', 'SymbolLock']);

const KEY_NAMES: Record<string, string> = {
  Space: 'Espaço',
  Escape: 'Esc',
  ArrowUp: 'Seta para cima',
  ArrowDown: 'Seta para baixo',
  ArrowLeft: 'Seta para a esquerda',
  ArrowRight: 'Seta para a direita',
};

function keyName(code: string, key: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  // Pontuacao: o que a tecla escreve (no ABNT2, `Semicolon` e o Ç).
  if (key.length === 1 && key.trim()) return key.toUpperCase();
  return code;
}

/** A combinacao de um aperto; null se so ha modificadores (ainda falta a tecla) ou a tecla nao tem codigo. */
export function hotkeyFrom(e: KeyLike): Hotkey | null {
  if (MODIFIER_KEYS.has(e.key) || !e.code || e.code === 'Unidentified') return null;
  const mods = [e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', e.metaKey && 'Win'].filter(Boolean);
  return {
    code: e.code,
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
    label: [...mods, keyName(e.code, e.key)].join('+'),
  };
}

/** O evento e exatamente esta combinacao (modificadores a mais nao contam). */
export function matchesHotkey(e: KeyLike, h: Hotkey): boolean {
  return e.code === h.code && e.ctrlKey === h.ctrl && e.shiftKey === h.shift && e.altKey === h.alt && e.metaKey === h.meta;
}

/** A tecla solta (`KeyboardEvent.key`) e um dos modificadores da combinacao. */
export function isHotkeyModifier(key: string, h: Hotkey): boolean {
  if (key === 'Control') return h.ctrl;
  if (key === 'Shift') return h.shift;
  if (key === 'Alt' || key === 'AltGraph') return h.alt;
  if (key === 'Meta' || key === 'OS') return h.meta;
  return false;
}

export const sameHotkey = (a: Hotkey, b: Hotkey): boolean =>
  a.code === b.code && a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.meta === b.meta;

/** Le o que foi guardado no localStorage; null se nao ha nada ou esta invalido. */
export function parseHotkey(saved: string | null): Hotkey | null {
  if (!saved) return null;
  try {
    const h = JSON.parse(saved) as Partial<Hotkey> | null;
    if (!h || typeof h.code !== 'string' || !h.code || typeof h.label !== 'string' || !h.label) return null;
    if (typeof h.ctrl !== 'boolean' || typeof h.shift !== 'boolean' || typeof h.alt !== 'boolean' || typeof h.meta !== 'boolean') return null;
    return { code: h.code, ctrl: h.ctrl, shift: h.shift, alt: h.alt, meta: h.meta, label: h.label };
  } catch {
    return null;
  }
}

/**
 * Espera o usuario apertar a combinacao. Guarda ja no aperto, mas so termina ao soltar a tecla:
 * assim a repeticao do teclado nao dispara o atalho novo nem aciona o botao que tem o foco.
 * Esc sozinho cancela (por isso nao pode ser o atalho; com modificador, pode).
 */
export class HotkeyCapture {
  private picked: string | null = null;
  private readonly onPick: (h: Hotkey) => void;
  private readonly onEnd: () => void;

  constructor(onPick: (h: Hotkey) => void, onEnd: () => void) {
    this.onPick = onPick;
    this.onEnd = onEnd;
  }

  keydown(e: KeyLike & { repeat?: boolean }): void {
    if (this.picked || e.repeat) return;
    const h = hotkeyFrom(e);
    if (!h) return;
    if (e.code === 'Escape' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) return this.onEnd();
    this.picked = h.code;
    this.onPick(h);
  }

  keyup(e: KeyLike): void {
    if (e.code === this.picked) this.onEnd();
  }
}
