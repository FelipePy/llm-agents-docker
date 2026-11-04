import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoldGate, HoldKeys, frameRms, waveBars, waveLevel } from '../src/voice/hold.ts';

const key = (code: string, k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}) => ({
  code,
  key: k,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: !!mods.meta,
});
const SPACE = key('Space', ' ');
const CTRL_SPACE = key('Space', ' ', { ctrl: true });
const CTRL = key('ControlLeft', 'Control');

describe('HoldKeys', () => {
  function keys() {
    const log: string[] = [];
    return { log, k: new HoldKeys(() => log.push('press'), () => log.push('release')) };
  }

  it('segurar Ctrl+Espaco aperta uma vez so (a repeticao do teclado nao conta) e soltar o espaco solta', () => {
    const { log, k } = keys();
    expect(k.keydown(CTRL_SPACE)).toBe(true);
    expect(k.keydown(CTRL_SPACE)).toBe(true);
    expect(log).toEqual(['press']);
    expect(k.keyup(SPACE)).toBe(true);
    expect(log).toEqual(['press', 'release']);
  });

  it('soltar o Ctrl primeiro tambem solta, e a repeticao do espaco nao vira texto', () => {
    const { log, k } = keys();
    k.keydown(CTRL_SPACE);
    expect(k.keyup(CTRL)).toBe(false);
    expect(log).toEqual(['press', 'release']);
    expect(k.keydown(SPACE)).toBe(true);
    expect(k.keyup(SPACE)).toBe(true);
    expect(k.keydown(SPACE)).toBe(false);
    expect(log).toEqual(['press', 'release']);
  });

  it('outras teclas e combinacoes passam direto', () => {
    const { log, k } = keys();
    expect(k.keydown(SPACE)).toBe(false);
    expect(k.keydown(key('Space', ' ', { ctrl: true, shift: true }))).toBe(false);
    expect(k.keydown(key('Space', ' ', { ctrl: true, alt: true }))).toBe(false);
    expect(k.keydown(key('KeyK', 'k', { ctrl: true }))).toBe(false);
    expect(k.keyup(SPACE)).toBe(false);
    expect(k.keyup(CTRL)).toBe(false);
    expect(log).toEqual([]);
  });

  it('outra tecla solta durante o aperto nao encerra', () => {
    const { log, k } = keys();
    k.keydown(CTRL_SPACE);
    expect(k.keyup(key('KeyA', 'a'))).toBe(false);
    expect(log).toEqual(['press']);
  });

  it('perder o foco solta, uma vez so', () => {
    const { log, k } = keys();
    k.keydown(CTRL_SPACE);
    k.cancel();
    k.cancel();
    expect(log).toEqual(['press', 'release']);
    k.keydown(CTRL_SPACE);
    expect(log).toEqual(['press', 'release', 'press']);
  });
});

describe('HoldGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const pcm = (v: number) => new Int16Array([v]);

  function gate() {
    const log: (string | number)[] = [];
    return {
      log,
      g: new HoldGate({
        start: () => log.push('start'),
        frame: (p) => log.push(p[0]),
        end: () => log.push('end'),
      }),
    };
  }

  it('sem apertar, nada sai do navegador', () => {
    const { log, g } = gate();
    for (let i = 0; i < 20; i++) g.frame(pcm(i));
    expect(log).toEqual([]);
    expect(g.holding).toBe(false);
  });

  it('ao apertar, envia so os ultimos quadros, depois o que vier, e ao soltar mais um quadro', () => {
    const { log, g } = gate();
    for (let i = 1; i <= 5; i++) g.frame(pcm(i));
    g.press();
    expect(g.holding).toBe(true);
    expect(log).toEqual(['start', 3, 4, 5]);
    g.frame(pcm(6));
    g.release();
    expect(g.holding).toBe(false);
    g.frame(pcm(7));
    g.frame(pcm(8));
    expect(log).toEqual(['start', 3, 4, 5, 6, 7, 'end']);
    vi.runAllTimers();
    expect(log.filter((x) => x === 'end')).toHaveLength(1);
  });

  it('sem quadro novo depois de soltar, encerra pelo prazo', () => {
    const { log, g } = gate();
    g.press();
    g.release();
    expect(log).toEqual(['start']);
    vi.runAllTimers();
    expect(log).toEqual(['start', 'end']);
  });

  it('apertar logo depois de soltar encerra a fala anterior antes de comecar a nova', () => {
    const { log, g } = gate();
    g.press();
    g.release();
    g.press();
    expect(log).toEqual(['start', 'end', 'start']);
    vi.runAllTimers();
    expect(log).toEqual(['start', 'end', 'start']);
  });

  it('cancelar esquece a fala sem avisar o servidor', () => {
    const { log, g } = gate();
    g.frame(pcm(1));
    g.press();
    g.release();
    g.cancel();
    vi.runAllTimers();
    g.release();
    expect(log).toEqual(['start', 1]);
  });
});

describe('onda', () => {
  it('o volume do quadro vai de 0 a 1', () => {
    expect(frameRms(new Int16Array(0))).toBe(0);
    expect(frameRms(new Int16Array(10))).toBe(0);
    expect(frameRms(new Int16Array(10).fill(-32768))).toBe(1);
  });

  it('ruido de fundo fica parado; fala normal aparece; voz alta chega ao maximo', () => {
    expect(waveLevel(0.002)).toBe(0);
    expect(waveLevel(0.05)).toBeGreaterThan(0.2);
    expect(waveLevel(0.1)).toBeGreaterThan(waveLevel(0.05));
    expect(waveLevel(1)).toBe(1);
  });

  it('em silencio as barras ficam baixas; o volume as levanta, mais no meio', () => {
    const quiet = waveBars(0, 1, 9);
    expect(new Set(quiet).size).toBe(1);
    const loud = waveBars(1, 0, 9, true);
    expect(loud[4]).toBeGreaterThan(loud[0]);
    expect(loud[4]).toBeCloseTo(1);
    expect(Math.min(...loud)).toBeGreaterThan(quiet[0]);
    for (const h of waveBars(1, 3.3, 31)) {
      expect(h).toBeGreaterThan(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });

  it('a onda se move sozinha, menos com movimento reduzido', () => {
    expect(waveBars(0.5, 0, 9)).not.toEqual(waveBars(0.5, 0.2, 9));
    expect(waveBars(0.5, 0, 9, true)).toEqual(waveBars(0.5, 0.2, 9, true));
  });
});
