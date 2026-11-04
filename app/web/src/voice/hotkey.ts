// Atalhos configuraveis (falar, trocar o estilo do globo): a combinacao escolhida, como ela e capturada e como e guardada.

export interface Hotkey {
  /**
   * O que se segura alem dos modificadores: teclas fisicas (`KeyboardEvent.code`, nao mudam com
   * Shift nem com o layout) e, se fizer parte, o botao do meio do mouse. Vazio: so modificadores.
   */
  codes: string[];
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** Como a combinacao aparece na tela, montado na captura (so ali se sabe o que a tecla escreve). */
  label: string;
}

type ModsLike = { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean };
type KeyLike = ModsLike & { code: string; key: string };
type MouseLike = ModsLike & { button: number };

/** O botao do meio do mouse (o clique do scroll) como parte da combinacao. */
export const MOUSE_MIDDLE = 'MouseMiddle';
/** `MouseEvent.button` do botao do meio; os outros botoes nao viram atalho. */
export const MIDDLE_BUTTON = 1;
const MOUSE_MIDDLE_NAME = 'Botão do meio';

/** Limite de uma combinacao, contando modificadores, teclas e o botao do meio. */
export const MAX_HOTKEY_KEYS = 3;

export const DEFAULT_HOTKEY: Hotkey = { codes: ['Space'], ctrl: true, shift: false, alt: false, meta: false, label: 'Ctrl+Espaço' };

/** Padrao do atalho que troca o estilo do globo: Ctrl mais o clique do scroll. */
export const DEFAULT_GLOBE_HOTKEY: Hotkey = { codes: [MOUSE_MIDDLE], ctrl: true, shift: false, alt: false, meta: false, label: `Ctrl+${MOUSE_MIDDLE_NAME}` };

/** Um atalho da ferramenta e o nome com que ele aparece na tela. */
export interface NamedHotkey {
  name: string;
  hotkey: Hotkey;
}

const fixed = (name: string, label: string, codes: string[], mods: Partial<Pick<Hotkey, 'shift' | 'alt'>> = {}): NamedHotkey => ({
  name,
  hotkey: { codes, ctrl: true, shift: false, alt: false, meta: false, ...mods, label },
});

/** Os atalhos fixos do app (abas e busca em App.tsx e tabs.ts; o da janela, no app desktop). */
export const APP_SHORTCUTS: NamedHotkey[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [
    fixed('Ir para uma aba', `Ctrl+${n}`, [`Digit${n}`]),
    fixed('Ir para uma aba', `Ctrl+Num ${n}`, [`Numpad${n}`]),
  ]),
  fixed('Próxima aba', 'Ctrl+Tab', ['Tab']),
  fixed('Aba anterior', 'Ctrl+Shift+Tab', ['Tab'], { shift: true }),
  fixed('Fechar a aba', 'Ctrl+Shift+W', ['KeyW'], { shift: true }),
  fixed('Abrir a busca', 'Ctrl+K', ['KeyK']),
  fixed('Mostrar ou esconder a janela', 'Ctrl+Alt+J', ['KeyJ'], { alt: true }),
];

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

/** O evento tem exatamente os modificadores da combinacao (a mais nao conta). */
export const hotkeyModsMatch = (e: ModsLike, h: Hotkey): boolean =>
  e.ctrlKey === h.ctrl && e.shiftKey === h.shift && e.altKey === h.alt && e.metaKey === h.meta;

/** O evento e uma tecla da combinacao, com exatamente os modificadores dela. */
export function matchesHotkey(e: KeyLike, h: Hotkey): boolean {
  return h.codes.includes(e.code) && hotkeyModsMatch(e, h);
}

/** A tecla solta (`KeyboardEvent.key`) e um dos modificadores da combinacao. */
export function isHotkeyModifier(key: string, h: Hotkey): boolean {
  if (key === 'Control') return h.ctrl;
  if (key === 'Shift') return h.shift;
  if (key === 'Alt' || key === 'AltGraph') return h.alt;
  if (key === 'Meta' || key === 'OS') return h.meta;
  return false;
}

export const hotkeyHasMouse = (h: Hotkey): boolean => h.codes.includes(MOUSE_MIDDLE);

/** Sem mouse no aparelho, um atalho com o botao do meio nao teria como ser apertado: vale o padrao. */
export const usableHotkey = (h: Hotkey, mouse: boolean): Hotkey => (hotkeyHasMouse(h) && !mouse ? DEFAULT_HOTKEY : h);

const keyCount = (h: Hotkey): number => h.codes.length + [h.ctrl, h.shift, h.alt, h.meta].filter(Boolean).length;

/** A ordem das teclas nao importa, e o nome na tela nao entra na comparacao. */
export const sameHotkey = (a: Hotkey, b: Hotkey): boolean =>
  a.ctrl === b.ctrl &&
  a.shift === b.shift &&
  a.alt === b.alt &&
  a.meta === b.meta &&
  a.codes.length === b.codes.length &&
  a.codes.every((c) => b.codes.includes(c));

/**
 * Nome do atalho da ferramenta que ja usa exatamente esta combinacao (`others`: os outros atalhos
 * configuraveis). Parte de uma combinacao nao conta: `Ctrl+Alt` continua valendo, mesmo com `Ctrl+Alt+J`.
 */
export function hotkeyConflict(h: Hotkey, others: NamedHotkey[]): string | null {
  return [...others, ...APP_SHORTCUTS].find((o) => sameHotkey(h, o.hotkey))?.name ?? null;
}

/** Le o que foi guardado no localStorage; null se nao ha nada ou esta invalido. */
export function parseHotkey(saved: string | null): Hotkey | null {
  if (!saved) return null;
  try {
    // `code`: o formato antigo, de uma tecla so. Com mais de tres teclas, volta ao padrao como qualquer invalido.
    const h = JSON.parse(saved) as (Partial<Hotkey> & { code?: unknown }) | null;
    if (!h || typeof h.label !== 'string' || !h.label) return null;
    if (typeof h.ctrl !== 'boolean' || typeof h.shift !== 'boolean' || typeof h.alt !== 'boolean' || typeof h.meta !== 'boolean') return null;
    const codes: unknown = h.codes ?? (h.code === undefined ? undefined : [h.code]);
    if (!Array.isArray(codes) || !codes.every((c) => typeof c === 'string' && c)) return null;
    const hotkey: Hotkey = { codes: codes as string[], ctrl: h.ctrl, shift: h.shift, alt: h.alt, meta: h.meta, label: h.label };
    const count = keyCount(hotkey);
    return count >= 1 && count <= MAX_HOTKEY_KEYS ? hotkey : null;
  } catch {
    return null;
  }
}

/**
 * Grava o atalho: junta o que o usuario aperta, ate o limite, e guarda ao soltar a primeira
 * das teclas (quem solta ja mostrou tudo o que queria). Assim uma tecla so, modificadores sozinhos
 * e o botao do meio do mouse entram do mesmo jeito. Esc sozinho cancela (por isso nao pode ser o
 * atalho; numa combinacao, pode). `mouse`: se o botao do meio pode fazer parte.
 */
export class HotkeyCapture {
  private readonly draft: Hotkey = { codes: [], ctrl: false, shift: false, alt: false, meta: false, label: '' };
  private readonly names: string[] = [];
  private finished = false;
  private readonly onPick: (h: Hotkey) => void;
  private readonly onEnd: () => void;
  private readonly onPreview: (label: string) => void;
  private readonly mouse: boolean;

  constructor(onPick: (h: Hotkey) => void, onEnd: () => void, onPreview: (label: string) => void = () => {}, mouse = true) {
    this.onPick = onPick;
    this.onEnd = onEnd;
    this.onPreview = onPreview;
    this.mouse = mouse;
  }

  keydown(e: KeyLike & { repeat?: boolean }): void {
    if (this.finished || e.repeat) return;
    if (MODIFIER_KEYS.has(e.key)) return this.add(e);
    if (!e.code || e.code === 'Unidentified') return;
    if (e.code === 'Escape' && !keyCount(this.draft) && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      this.finished = true;
      return this.onEnd();
    }
    this.add(e, e.code, keyName(e.code, e.key));
  }

  keyup(e: KeyLike): void {
    if (this.draft.codes.includes(e.code) || isHotkeyModifier(e.key, this.draft)) this.finish();
  }

  mousedown(e: MouseLike): void {
    if (!this.finished && this.mouse && e.button === MIDDLE_BUTTON) this.add(e, MOUSE_MIDDLE, MOUSE_MIDDLE_NAME);
  }

  mouseup(e: MouseLike): void {
    if (e.button === MIDDLE_BUTTON && hotkeyHasMouse(this.draft)) this.finish();
  }

  /** Modificadores vem das marcas do evento: valem mesmo apertados antes de a gravacao comecar. */
  private add(e: ModsLike, code?: string, name?: string): void {
    const d = this.draft;
    for (const [on, mod] of [[e.ctrlKey, 'ctrl'], [e.shiftKey, 'shift'], [e.altKey, 'alt'], [e.metaKey, 'meta']] as const) {
      if (on && !d[mod] && keyCount(d) < MAX_HOTKEY_KEYS) d[mod] = true;
    }
    if (code && name && !d.codes.includes(code) && keyCount(d) < MAX_HOTKEY_KEYS) {
      d.codes.push(code);
      this.names.push(name);
    }
    d.label = [d.ctrl && 'Ctrl', d.shift && 'Shift', d.alt && 'Alt', d.meta && 'Win', ...this.names].filter(Boolean).join('+');
    if (d.label) this.onPreview(d.label);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.onPick({ ...this.draft, codes: [...this.draft.codes] });
    this.onEnd();
  }
}
