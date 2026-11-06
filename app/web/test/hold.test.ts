import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoldGate, HoldKeys, frameRms, waveBars, waveLabel, waveLevel, wavePlace } from '../src/voice/hold.ts';
import { DEFAULT_GLOBE_HOTKEY, DEFAULT_HOTKEY, MOUSE_MIDDLE, type Hotkey } from '../src/voice/hotkey.ts';

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

describe('HoldKeys com o atalho de trocar o estilo', () => {
  const mouse = (mods: { ctrl?: boolean } = {}) => ({ button: 1, ...key('', '', mods) });
  const ctrlDown = key('ControlLeft', 'Control', { ctrl: true });

  function keys() {
    const presses = { count: 0 };
    return { presses, k: new HoldKeys(() => presses.count++, () => {}, DEFAULT_GLOBE_HOTKEY) };
  }

  it('cada clique com Ctrl dispara uma vez e consome o clique inteiro', () => {
    const { presses, k } = keys();
    expect(k.keydown(ctrlDown)).toBe(false);
    // O navegador manda `pointerdown` e `mousedown` para o mesmo aperto.
    expect(k.mousedown(mouse({ ctrl: true }))).toBe(true);
    expect(k.mousedown(mouse({ ctrl: true }))).toBe(true);
    expect(presses.count).toBe(1);
    expect(k.mouseup(mouse({ ctrl: true }))).toBe(true);
    expect(k.auxclick({ button: 1 })).toBe(true);
    k.mousedown(mouse({ ctrl: true }));
    k.mouseup(mouse({ ctrl: true }));
    expect(presses.count).toBe(2);
  });

  it('o clique do scroll sem o Ctrl continua sendo do navegador', () => {
    const { presses, k } = keys();
    expect(k.mousedown(mouse())).toBe(false);
    expect(k.mouseup(mouse())).toBe(false);
    expect(k.auxclick({ button: 1 })).toBe(false);
    expect(presses.count).toBe(0);
  });
});

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

describe('HoldKeys com outro atalho', () => {
  const hotkey = { codes: ['KeyJ'], ctrl: true, shift: true, alt: false, meta: false, label: 'Ctrl+Shift+J' };
  const COMBO = key('KeyJ', 'J', { ctrl: true, shift: true });

  function keys(h = hotkey) {
    const log: string[] = [];
    return { log, k: new HoldKeys(() => log.push('press'), () => log.push('release'), h) };
  }

  it('so a combinacao escolhida aperta; Ctrl+Espaco deixa de ser do Jarvis', () => {
    const { log, k } = keys();
    expect(k.keydown(CTRL_SPACE)).toBe(false);
    expect(k.keydown(key('KeyJ', 'j', { ctrl: true }))).toBe(false);
    expect(k.keydown(key('KeyJ', 'J', { ctrl: true, shift: true, alt: true }))).toBe(false);
    expect(log).toEqual([]);
    expect(k.keydown(COMBO)).toBe(true);
    expect(log).toEqual(['press']);
    expect(k.keyup(key('KeyJ', 'J'))).toBe(true);
    expect(log).toEqual(['press', 'release']);
  });

  it('soltar qualquer modificador da combinacao solta; a repeticao da tecla nao vira texto', () => {
    const { log, k } = keys();
    k.keydown(COMBO);
    expect(k.keyup(key('ShiftLeft', 'Shift'))).toBe(false);
    expect(log).toEqual(['press', 'release']);
    expect(k.keydown(key('KeyJ', 'j', { ctrl: true }))).toBe(true);
    expect(k.keyup(key('KeyJ', 'j'))).toBe(true);
    expect(k.keydown(key('KeyJ', 'j'))).toBe(false);
  });

  it('modificador fora da combinacao nao solta', () => {
    const { log, k } = keys();
    k.keydown(COMBO);
    expect(k.keyup(key('AltLeft', 'Alt'))).toBe(false);
    expect(log).toEqual(['press']);
  });

  it('uma tecla sozinha tambem serve e solta ao soltar a tecla', () => {
    const { log, k } = keys({ codes: ['F9'], ctrl: false, shift: false, alt: false, meta: false, label: 'F9' });
    expect(k.keydown(key('F9', 'F9', { ctrl: true }))).toBe(false);
    expect(k.keydown(key('F9', 'F9'))).toBe(true);
    expect(k.keyup(key('ControlLeft', 'Control'))).toBe(false);
    expect(log).toEqual(['press']);
    expect(k.keyup(key('F9', 'F9'))).toBe(true);
    expect(log).toEqual(['press', 'release']);
  });
});

describe('HoldKeys com combinacoes flexiveis', () => {
  const NO_MODS = { ctrl: false, shift: false, alt: false, meta: false };

  function keys(h: Hotkey) {
    const log: string[] = [];
    return { log, k: new HoldKeys(() => log.push('press'), () => log.push('release'), h) };
  }

  it('duas teclas comuns: a primeira segue para o app e a ultima aperta', () => {
    const { log, k } = keys({ ...NO_MODS, codes: ['KeyA', 'KeyS'], label: 'A+S' });
    expect(k.keydown(key('KeyA', 'a'))).toBe(false);
    expect(log).toEqual([]);
    expect(k.keydown(key('KeyS', 's'))).toBe(true);
    expect(log).toEqual(['press']);
    expect(k.keydown(key('KeyS', 's'))).toBe(true);
    expect(log).toEqual(['press']);
  });

  it('soltar uma das teclas solta; a repeticao da outra nao vira texto', () => {
    const { log, k } = keys({ ...NO_MODS, codes: ['KeyA', 'KeyS'], label: 'A+S' });
    k.keydown(key('KeyA', 'a'));
    k.keydown(key('KeyS', 's'));
    expect(k.keyup(key('KeyA', 'a'))).toBe(true);
    expect(log).toEqual(['press', 'release']);
    expect(k.keydown(key('KeyS', 's'))).toBe(true);
    expect(k.keyup(key('KeyS', 's'))).toBe(true);
    expect(k.keydown(key('KeyS', 's'))).toBe(false);
    expect(log).toEqual(['press', 'release']);
  });

  it('outra tecla apertada nao atrapalha quem digita rapido', () => {
    const { log, k } = keys({ ...NO_MODS, codes: ['F9'], label: 'F9' });
    expect(k.keydown(key('KeyX', 'x'))).toBe(false);
    expect(k.keydown(key('F9', 'F9'))).toBe(true);
    expect(k.keyup(key('KeyX', 'x'))).toBe(false);
    expect(log).toEqual(['press']);
  });

  it('so modificadores: aperta com todos eles e consome, ou o Alt abriria o menu', () => {
    const { log, k } = keys({ ctrl: true, shift: false, alt: true, meta: false, codes: [], label: 'Ctrl+Alt' });
    expect(k.keydown(key('ControlLeft', 'Control', { ctrl: true }))).toBe(false);
    expect(log).toEqual([]);
    expect(k.keydown(key('AltLeft', 'Alt', { ctrl: true, alt: true }))).toBe(true);
    expect(log).toEqual(['press']);
    expect(k.keyup(key('AltLeft', 'Alt', { ctrl: true }))).toBe(true);
    expect(log).toEqual(['press', 'release']);
    expect(k.keyup(key('ControlLeft', 'Control'))).toBe(false);
  });

  it('um modificador sozinho tambem serve', () => {
    const { log, k } = keys({ ctrl: true, shift: false, alt: false, meta: false, codes: [], label: 'Ctrl' });
    k.keydown(key('ControlLeft', 'Control', { ctrl: true }));
    expect(log).toEqual(['press']);
    k.keyup(key('ControlLeft', 'Control'));
    expect(log).toEqual(['press', 'release']);
  });
});

describe('HoldKeys com o botao do meio do mouse', () => {
  const mouse = (button: number, mods: { ctrl?: boolean } = {}) => ({ button, ...key('', '', mods) });
  const MIDDLE: Hotkey = { codes: [MOUSE_MIDDLE], ctrl: false, shift: false, alt: false, meta: false, label: 'Botão do meio' };
  const CTRL_MIDDLE: Hotkey = { ...MIDDLE, ctrl: true, label: 'Ctrl+Botão do meio' };

  function keys(h: Hotkey = MIDDLE) {
    const log: string[] = [];
    return { log, k: new HoldKeys(() => log.push('press'), () => log.push('release'), h) };
  }

  it('segurar aperta e soltar solta, consumindo o clique inteiro', () => {
    const { log, k } = keys();
    expect(k.mousedown(mouse(1))).toBe(true);
    expect(k.mousedown(mouse(1))).toBe(true); // `pointerdown` e `mousedown` do mesmo aperto
    expect(log).toEqual(['press']);
    expect(k.mouseup(mouse(1))).toBe(true);
    expect(k.auxclick(mouse(1))).toBe(true);
    expect(k.auxclick(mouse(1))).toBe(false);
    expect(log).toEqual(['press', 'release']);
  });

  it('os outros botoes nao contam', () => {
    const { log, k } = keys();
    for (const button of [0, 2, 3, 4]) {
      expect(k.mousedown(mouse(button))).toBe(false);
      expect(k.mouseup(mouse(button))).toBe(false);
      expect(k.auxclick(mouse(button))).toBe(false);
    }
    expect(log).toEqual([]);
  });

  it('sem o botao no atalho, o clique do meio segue para o navegador', () => {
    const { log, k } = keys(DEFAULT_HOTKEY);
    expect(k.mousedown(mouse(1, { ctrl: true }))).toBe(false);
    expect(k.mouseup(mouse(1))).toBe(false);
    expect(k.auxclick(mouse(1))).toBe(false);
    expect(log).toEqual([]);
  });

  it('com Ctrl: so o clique com o Ctrl e do Jarvis, na ordem que vier', () => {
    const plain = keys(CTRL_MIDDLE);
    expect(plain.k.mousedown(mouse(1))).toBe(false);
    expect(plain.k.mouseup(mouse(1))).toBe(false);
    expect(plain.k.auxclick(mouse(1))).toBe(false);
    expect(plain.log).toEqual([]);

    const first = keys(CTRL_MIDDLE);
    first.k.keydown(key('ControlLeft', 'Control', { ctrl: true }));
    expect(first.log).toEqual([]);
    expect(first.k.mousedown(mouse(1, { ctrl: true }))).toBe(true);
    expect(first.log).toEqual(['press']);

    const last = keys(CTRL_MIDDLE);
    last.k.mousedown(mouse(1));
    expect(last.k.keydown(key('ControlLeft', 'Control', { ctrl: true }))).toBe(false);
    expect(last.log).toEqual(['press']);
  });

  it('soltar o Ctrl primeiro solta, e o resto do clique continua consumido', () => {
    const { log, k } = keys(CTRL_MIDDLE);
    k.keydown(key('ControlLeft', 'Control', { ctrl: true }));
    k.mousedown(mouse(1, { ctrl: true }));
    k.keyup(key('ControlLeft', 'Control'));
    expect(log).toEqual(['press', 'release']);
    expect(k.mouseup(mouse(1))).toBe(true);
    expect(k.auxclick(mouse(1))).toBe(true);
    expect(log).toEqual(['press', 'release']);
  });

  it('um auxclick antigo nao come o clique seguinte', () => {
    const { k } = keys(CTRL_MIDDLE);
    k.keydown(key('ControlLeft', 'Control', { ctrl: true }));
    k.mousedown(mouse(1, { ctrl: true }));
    k.mouseup(mouse(1, { ctrl: true }));
    k.keyup(key('ControlLeft', 'Control'));
    k.mousedown(mouse(1));
    k.mouseup(mouse(1));
    expect(k.auxclick(mouse(1))).toBe(false);
  });

  it('o botao solto sem o evento chegar nao deixa o microfone aberto', () => {
    const { log, k } = keys();
    k.mousedown(mouse(1));
    k.mousemove({ buttons: 4 });
    expect(log).toEqual(['press']);
    k.mousemove({ buttons: 0 });
    expect(log).toEqual(['press', 'release']);
    k.mousemove({ buttons: 0 });
    expect(log).toEqual(['press', 'release']);
    expect(k.mouseup(mouse(1))).toBe(false);
  });

  it('perder o foco solta', () => {
    const { log, k } = keys();
    k.mousedown(mouse(1));
    k.cancel();
    expect(log).toEqual(['press', 'release']);
    expect(k.mouseup(mouse(1))).toBe(false);
    expect(k.auxclick(mouse(1))).toBe(false);
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
  it('aparece ao segurar o atalho e sempre na escuta continua; desligada, some', () => {
    expect(waveLabel(true, false, 'F9')).toBe('Ouvindo; solte F9 para o Jarvis responder');
    expect(waveLabel(false, true, 'F9')).toBe('Microfone ligado');
    expect(waveLabel(false, false, 'F9')).toBeNull();
  });

  it('sai da frente do painel e do modal do modo 3D; no modo lista, fica no canto', () => {
    expect(wavePlace(true, false, false)).toBe('');
    expect(wavePlace(true, false, true)).toBe('beside-panel');
    expect(wavePlace(true, true, true)).toBe('over-modal');
    expect(wavePlace(false, true, true)).toBe('');
  });

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
