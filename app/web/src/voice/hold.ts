// Atalho de falar: segurar a combinacao abre o microfone para o Jarvis; soltar encerra a fala.

import { DEFAULT_HOTKEY, isHotkeyModifier, matchesHotkey, type Hotkey } from './hotkey.ts';

/** Quadros (80 ms) anteriores ao aperto enviados junto: a fala costuma comecar com ele. */
const PREROLL_FRAMES = 3;
/** Sem novo quadro do microfone neste tempo, encerra sem o quadro final. */
const TAIL_TIMEOUT_MS = 200;

type KeyLike = { code: string; key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean };

/** Teclas do atalho, a partir dos eventos do teclado. `keydown` e `keyup`: true se o app deve consumir a tecla. */
export class HoldKeys {
  private held = false;
  /** Soltou um modificador com a tecla ainda apertada: a repeticao nao vira texto digitado. */
  private swallowKey = false;
  private readonly onPress: () => void;
  private readonly onRelease: () => void;
  private readonly hotkey: Hotkey;

  constructor(onPress: () => void, onRelease: () => void, hotkey: Hotkey = DEFAULT_HOTKEY) {
    this.onPress = onPress;
    this.onRelease = onRelease;
    this.hotkey = hotkey;
  }

  keydown(e: KeyLike): boolean {
    if (e.code !== this.hotkey.code) return false;
    if (!matchesHotkey(e, this.hotkey)) return this.swallowKey;
    if (!this.held) {
      this.held = true;
      this.onPress();
    }
    return true;
  }

  keyup(e: KeyLike): boolean {
    const main = e.code === this.hotkey.code;
    if (main && this.swallowKey) {
      this.swallowKey = false;
      return true;
    }
    if (!this.held || (!main && !isHotkeyModifier(e.key, this.hotkey))) return false;
    this.swallowKey = !main;
    this.release();
    return main;
  }

  /** A janela perdeu o foco: o "soltar" nao chegaria aqui. */
  cancel(): void {
    this.swallowKey = false;
    if (this.held) this.release();
  }

  private release(): void {
    this.held = false;
    this.onRelease();
  }
}

/**
 * Decide o que do microfone vai para o servidor: nada ate apertar; ao apertar, os ultimos
 * quadros (o comeco da fala); ao soltar, mais um quadro (o que ainda estava no caminho).
 */
export class HoldGate {
  private readonly out: { start(): void; frame(pcm: Int16Array): void; end(): void };
  private readonly recent: Int16Array[] = [];
  private held = false;
  private tail: ReturnType<typeof setTimeout> | undefined;

  constructor(out: { start(): void; frame(pcm: Int16Array): void; end(): void }) {
    this.out = out;
  }

  get holding(): boolean {
    return this.held;
  }

  /** Um quadro do microfone. */
  frame(pcm: Int16Array): void {
    if (this.held) return this.out.frame(pcm);
    if (this.tail !== undefined) {
      this.out.frame(pcm);
      this.finish();
      return;
    }
    this.recent.push(pcm);
    if (this.recent.length > PREROLL_FRAMES) this.recent.shift();
  }

  press(): void {
    if (this.held) return;
    if (this.tail !== undefined) this.finish();
    this.held = true;
    this.out.start();
    for (const pcm of this.recent.splice(0)) this.out.frame(pcm);
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    this.tail = setTimeout(() => this.finish(), TAIL_TIMEOUT_MS);
  }

  /** Conexao ou voz caiu: esquece a fala sem avisar o servidor. */
  cancel(): void {
    this.held = false;
    clearTimeout(this.tail);
    this.tail = undefined;
    this.recent.length = 0;
  }

  private finish(): void {
    clearTimeout(this.tail);
    this.tail = undefined;
    this.out.end();
  }
}

/** Volume do quadro (RMS, de 0 a 1). */
export function frameRms(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let sum = 0;
  for (const v of pcm) sum += (v / 32768) ** 2;
  return Math.sqrt(sum / pcm.length);
}

/** Volume em altura da onda (0 a 1): a raiz aproxima do que se ouve; o ruido de fundo fica em zero. */
export function waveLevel(rms: number): number {
  return Math.min(1, Math.max(0, (Math.sqrt(rms) - 0.08) * 2.2));
}

const MIN_BAR = 0.06;

/** Altura de cada barra da onda (de MIN_BAR a 1): mais alta no meio; `reduced`: sem o movimento proprio. */
export function waveBars(level: number, seconds: number, count: number, reduced = false): number[] {
  return Array.from({ length: count }, (_, i) => {
    const middle = Math.sin((Math.PI * (i + 0.5)) / count);
    const motion = reduced ? 1 : 0.65 + 0.35 * Math.sin(seconds * 11 + i * 0.8);
    return MIN_BAR + (1 - MIN_BAR) * level * middle * motion;
  });
}
