// Atalho de falar: segurar a combinacao (teclas e, se escolhido, o botao do meio do mouse) abre o microfone para o Jarvis; soltar encerra a fala.

import { DEFAULT_HOTKEY, MIDDLE_BUTTON, MOUSE_MIDDLE, hotkeyHasMouse, hotkeyModsMatch, isHotkeyModifier, type Hotkey } from './hotkey.ts';

/** Quadros (80 ms) anteriores ao aperto enviados junto: a fala costuma comecar com ele. */
const PREROLL_FRAMES = 3;
/** Sem novo quadro do microfone neste tempo, encerra sem o quadro final. */
const TAIL_TIMEOUT_MS = 200;

type ModsLike = { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean };
type KeyLike = ModsLike & { code: string; key: string };
type MouseLike = ModsLike & { button: number };

/** Bit do botao do meio em `MouseEvent.buttons`. */
const MIDDLE_BUTTONS_BIT = 4;

/**
 * Teclas e botao do meio do atalho, a partir dos eventos. `keydown`, `keyup` e os do mouse: true se
 * o app deve consumir o evento. Numa combinacao de teclas comuns, a primeira so vira atalho quando
 * a ultima chega; ate la ela segue para o app (segura-la nao pode atrasar a digitacao de ninguem).
 */
export class HoldKeys {
  private held = false;
  /** O que da combinacao, alem dos modificadores, esta apertado agora. */
  private readonly down = new Set<string>();
  /** Soltou parte da combinacao com o resto ainda apertado: a repeticao nao vira texto digitado. */
  private readonly swallow = new Set<string>();
  /** O `auxclick` vem depois do `mouseup`: abriria o link que esta sob o ponteiro. */
  private swallowAux = false;
  private readonly onPress: () => void;
  private readonly onRelease: () => void;
  private readonly hotkey: Hotkey;

  constructor(onPress: () => void, onRelease: () => void, hotkey: Hotkey = DEFAULT_HOTKEY) {
    this.onPress = onPress;
    this.onRelease = onRelease;
    this.hotkey = hotkey;
  }

  keydown(e: KeyLike): boolean {
    const own = this.hotkey.codes.includes(e.code);
    if (own) this.down.add(e.code);
    else if (!isHotkeyModifier(e.key, this.hotkey)) return false;
    const pressed = this.tryPress(e);
    // So modificadores: consome, ou o Alt sozinho abriria o menu do navegador.
    if (!own) return pressed && !this.hotkey.codes.length;
    return pressed || this.held || this.swallow.has(e.code);
  }

  keyup(e: KeyLike): boolean {
    const own = this.hotkey.codes.includes(e.code);
    if (own) {
      this.down.delete(e.code);
      if (this.swallow.delete(e.code)) return true;
    }
    if (!this.held || (!own && !isHotkeyModifier(e.key, this.hotkey))) return false;
    this.release();
    return own || !this.hotkey.codes.length;
  }

  mousedown(e: MouseLike): boolean {
    if (e.button !== MIDDLE_BUTTON || !hotkeyHasMouse(this.hotkey)) return false;
    this.swallowAux = false;
    this.down.add(MOUSE_MIDDLE);
    return this.tryPress(e) || this.swallow.has(MOUSE_MIDDLE);
  }

  mouseup(e: MouseLike): boolean {
    if (e.button !== MIDDLE_BUTTON || !hotkeyHasMouse(this.hotkey)) return false;
    this.down.delete(MOUSE_MIDDLE);
    const taken = this.swallow.delete(MOUSE_MIDDLE) || this.held;
    if (this.held) this.release();
    this.swallowAux = taken;
    return taken;
  }

  auxclick(e: { button: number }): boolean {
    if (e.button !== MIDDLE_BUTTON || !this.swallowAux) return false;
    this.swallowAux = false;
    return true;
  }

  /** O botao foi solto sem o `mouseup` chegar aqui: o microfone nao pode ficar aberto. */
  mousemove(e: { buttons: number }): void {
    if (!this.down.has(MOUSE_MIDDLE) || e.buttons & MIDDLE_BUTTONS_BIT) return;
    this.down.delete(MOUSE_MIDDLE);
    this.swallow.delete(MOUSE_MIDDLE);
    if (this.held) this.release();
  }

  /** A janela perdeu o foco: o "soltar" nao chegaria aqui. */
  cancel(): void {
    this.down.clear();
    this.swallow.clear();
    this.swallowAux = false;
    if (this.held) this.release();
  }

  private tryPress(e: ModsLike): boolean {
    if (!hotkeyModsMatch(e, this.hotkey) || this.hotkey.codes.some((c) => !this.down.has(c))) return false;
    if (!this.held) {
      this.held = true;
      this.swallow.clear();
      this.onPress();
    }
    return true;
  }

  private release(): void {
    this.held = false;
    for (const code of this.down) this.swallow.add(code);
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

/** Descricao da onda para leitores de tela; null: ela nao aparece (na escuta continua, fica sempre na tela). */
export function waveLabel(holding: boolean, listening: boolean, hotkey: string): string | null {
  if (holding) return `Ouvindo; solte ${hotkey} para o Jarvis responder`;
  return listening ? 'Microfone ligado' : null;
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
