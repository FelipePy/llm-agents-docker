import { describe, expect, it } from 'vitest';
import { voiceStatus } from '../src/voice/client.ts';
import { DEFAULT_HOTKEY, HotkeyCapture, MOUSE_MIDDLE, hotkeyHasMouse, isHotkeyModifier, matchesHotkey, parseHotkey, sameHotkey, usableHotkey, type Hotkey } from '../src/voice/hotkey.ts';

const key = (code: string, k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; repeat?: boolean } = {}) => ({
  code,
  key: k,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: !!mods.meta,
  repeat: !!mods.repeat,
});
const mouse = (button: number, mods: { ctrl?: boolean; shift?: boolean } = {}) => ({ button, ...key('', '', mods) });

function capture(hasMouse = true) {
  const log: string[] = [];
  const picked: Hotkey[] = [];
  const previews: string[] = [];
  const c = new HotkeyCapture(
    (h) => {
      log.push(h.label);
      picked.push(h);
    },
    () => log.push('fim'),
    (label) => previews.push(label),
    hasMouse,
  );
  return { log, picked, previews, c };
}

/** Grava uma tecla com seus modificadores, apertando e soltando. */
function record(e: ReturnType<typeof key>): Hotkey {
  const { picked, c } = capture();
  c.keydown(e);
  c.keyup(e);
  return picked[0];
}

const COMBO = record(key('KeyJ', 'J', { ctrl: true, shift: true }));

describe('nome na tela', () => {
  it('monta a combinacao e o nome', () => {
    expect(record(key('Space', ' ', { ctrl: true }))).toEqual(DEFAULT_HOTKEY);
    expect(COMBO.label).toBe('Ctrl+Shift+J');
    expect(record(key('Digit1', '!', { shift: true })).label).toBe('Shift+1');
    expect(record(key('F9', 'F9')).label).toBe('F9');
    expect(record(key('Numpad0', '0', { alt: true })).label).toBe('Alt+Num 0');
    expect(record(key('ArrowUp', 'ArrowUp', { meta: true })).label).toBe('Win+Seta para cima');
  });

  it('pontuacao mostra o que a tecla escreve no teclado do usuario', () => {
    expect(record(key('Semicolon', 'ç', { ctrl: true })).label).toBe('Ctrl+Ç');
    expect(record(key('BracketLeft', 'Dead')).label).toBe('BracketLeft');
  });
});

describe('combinacao', () => {
  it('confere a tecla fisica e exatamente os modificadores', () => {
    expect(matchesHotkey(key('KeyJ', 'j', { ctrl: true, shift: true }), COMBO)).toBe(true);
    expect(matchesHotkey(key('KeyJ', 'j', { ctrl: true }), COMBO)).toBe(false);
    expect(matchesHotkey(key('KeyJ', 'j', { ctrl: true, shift: true, alt: true }), COMBO)).toBe(false);
    expect(matchesHotkey(key('KeyK', 'k', { ctrl: true, shift: true }), COMBO)).toBe(false);
  });

  it('reconhece os modificadores que fazem parte dela', () => {
    expect(isHotkeyModifier('Control', COMBO)).toBe(true);
    expect(isHotkeyModifier('Shift', COMBO)).toBe(true);
    expect(isHotkeyModifier('Alt', COMBO)).toBe(false);
    expect(isHotkeyModifier('j', COMBO)).toBe(false);
  });

  it('nem o nome na tela nem a ordem das teclas entram na comparacao', () => {
    expect(sameHotkey(DEFAULT_HOTKEY, { ...DEFAULT_HOTKEY, label: 'outro' })).toBe(true);
    expect(sameHotkey(DEFAULT_HOTKEY, COMBO)).toBe(false);
    const ab = { ...DEFAULT_HOTKEY, ctrl: false, codes: ['KeyA', 'KeyB'] };
    expect(sameHotkey(ab, { ...ab, codes: ['KeyB', 'KeyA'] })).toBe(true);
    expect(sameHotkey(ab, { ...ab, codes: ['KeyA'] })).toBe(false);
  });
});

describe('sem mouse no aparelho', () => {
  const middle = { ...DEFAULT_HOTKEY, ctrl: false, codes: [MOUSE_MIDDLE], label: 'Botão do meio' };

  it('um atalho com o botao do meio volta ao padrao; com mouse, continua', () => {
    expect(usableHotkey(middle, false)).toBe(DEFAULT_HOTKEY);
    expect(usableHotkey(middle, true)).toBe(middle);
  });

  it('um atalho so de teclas continua', () => {
    expect(usableHotkey(COMBO, false)).toBe(COMBO);
  });
});

describe('parseHotkey', () => {
  const base = { label: 'x', ctrl: false, shift: false, alt: false, meta: false };

  it('le de volta o que foi guardado', () => {
    expect(parseHotkey(JSON.stringify(COMBO))).toEqual(COMBO);
    const middle = { ...base, ctrl: true, codes: [MOUSE_MIDDLE] };
    expect(parseHotkey(JSON.stringify(middle))).toEqual(middle);
  });

  it('le o formato antigo, de uma tecla so', () => {
    const old = { code: 'KeyJ', ctrl: true, shift: true, alt: false, meta: false, label: 'Ctrl+Shift+J' };
    expect(parseHotkey(JSON.stringify(old))).toEqual(COMBO);
  });

  it('modificadores sozinhos valem', () => {
    const mods = { ...base, ctrl: true, alt: true, codes: [] };
    expect(parseHotkey(JSON.stringify(mods))).toEqual(mods);
  });

  it('nada guardado ou guardado invalido nao vira atalho', () => {
    for (const saved of [
      null,
      '',
      'x{',
      'null',
      '1',
      '{}',
      '{"code":"KeyJ"}',
      JSON.stringify({ ...base, code: '' }),
      JSON.stringify({ ...base, code: 'KeyJ', ctrl: 'sim' }),
      JSON.stringify({ ...base, codes: 'KeyJ' }),
      JSON.stringify({ ...base, codes: [1] }),
      JSON.stringify({ ...base, codes: [] }),
      JSON.stringify({ ...base, codes: ['KeyA', 'KeyB', 'KeyC', 'KeyD'] }),
      JSON.stringify({ ...base, ctrl: true, shift: true, alt: true, codes: ['KeyJ'] }),
    ]) {
      expect(parseHotkey(saved)).toBeNull();
    }
  });
});

describe('HotkeyCapture', () => {
  it('junta o que e apertado e so guarda ao soltar a primeira tecla', () => {
    const { log, previews, c } = capture();
    c.keydown(key('ControlLeft', 'Control', { ctrl: true }));
    c.keydown(key('ShiftLeft', 'Shift', { ctrl: true, shift: true }));
    c.keydown(key('KeyJ', 'J', { ctrl: true, shift: true }));
    expect(log).toEqual([]);
    expect(previews).toEqual(['Ctrl', 'Ctrl+Shift', 'Ctrl+Shift+J']);
    c.keyup(key('KeyJ', 'J', { ctrl: true, shift: true }));
    expect(log).toEqual(['Ctrl+Shift+J', 'fim']);
  });

  it('soltar um modificador primeiro tambem grava, e uma vez so', () => {
    const { log, c } = capture();
    c.keydown(key('ControlLeft', 'Control', { ctrl: true }));
    c.keydown(key('KeyJ', 'j', { ctrl: true }));
    c.keyup(key('ControlLeft', 'Control'));
    c.keyup(key('KeyJ', 'j'));
    expect(log).toEqual(['Ctrl+J', 'fim']);
  });

  it('uma tecla so', () => {
    const { log, picked, c } = capture();
    c.keydown(key('F9', 'F9'));
    c.keyup(key('F9', 'F9'));
    expect(log).toEqual(['F9', 'fim']);
    expect(picked[0]).toMatchObject({ codes: ['F9'], ctrl: false, shift: false, alt: false, meta: false });
  });

  it('um modificador sozinho e modificadores sem tecla viram atalho', () => {
    const one = capture();
    one.c.keydown(key('ControlLeft', 'Control', { ctrl: true }));
    one.c.keyup(key('ControlLeft', 'Control'));
    expect(one.log).toEqual(['Ctrl', 'fim']);
    expect(one.picked[0].codes).toEqual([]);

    const two = capture();
    two.c.keydown(key('ControlLeft', 'Control', { ctrl: true }));
    two.c.keydown(key('AltLeft', 'Alt', { ctrl: true, alt: true }));
    two.c.keyup(key('AltLeft', 'Alt', { ctrl: true }));
    expect(two.log).toEqual(['Ctrl+Alt', 'fim']);
  });

  it('tres teclas comuns', () => {
    const { log, picked, c } = capture();
    c.keydown(key('KeyA', 'a'));
    c.keydown(key('KeyS', 's'));
    c.keydown(key('KeyD', 'd'));
    c.keyup(key('KeyS', 's'));
    expect(log).toEqual(['A+S+D', 'fim']);
    expect(picked[0].codes).toEqual(['KeyA', 'KeyS', 'KeyD']);
  });

  it('a quarta tecla fica de fora, seja comum ou modificador', () => {
    const { log, picked, c } = capture();
    c.keydown(key('KeyA', 'a'));
    c.keydown(key('KeyS', 's'));
    c.keydown(key('KeyD', 'd'));
    c.keydown(key('KeyF', 'f'));
    c.keydown(key('ControlLeft', 'Control', { ctrl: true }));
    c.keyup(key('KeyF', 'f'));
    c.keyup(key('ControlLeft', 'Control'));
    expect(log).toEqual([]);
    c.keyup(key('KeyA', 'a'));
    expect(log).toEqual(['A+S+D', 'fim']);
    expect(picked[0].ctrl).toBe(false);

    const mods = capture();
    mods.c.keydown(key('KeyJ', 'j', { ctrl: true, shift: true, alt: true }));
    mods.c.keyup(key('AltLeft', 'Alt', { ctrl: true, shift: true }));
    expect(mods.log).toEqual(['Ctrl+Shift+Alt', 'fim']);
    expect(mods.picked[0].codes).toEqual([]);
  });

  it('o botao do meio sozinho', () => {
    const { log, picked, previews, c } = capture();
    c.mousedown(mouse(1));
    expect(previews).toEqual(['Botão do meio']);
    expect(log).toEqual([]);
    c.mouseup(mouse(1));
    expect(log).toEqual(['Botão do meio', 'fim']);
    expect(hotkeyHasMouse(picked[0])).toBe(true);
  });

  it('o botao do meio com teclas, em qualquer ordem', () => {
    const first = capture();
    first.c.keydown(key('ControlLeft', 'Control', { ctrl: true }));
    first.c.mousedown(mouse(1, { ctrl: true }));
    first.c.mouseup(mouse(1, { ctrl: true }));
    expect(first.log).toEqual(['Ctrl+Botão do meio', 'fim']);

    const last = capture();
    last.c.mousedown(mouse(1));
    last.c.keydown(key('KeyJ', 'j'));
    last.c.keyup(key('KeyJ', 'j'));
    expect(last.log).toEqual(['Botão do meio+J', 'fim']);
  });

  it('os outros botoes do mouse nao entram', () => {
    const { log, previews, c } = capture();
    for (const button of [0, 2, 3, 4]) {
      c.mousedown(mouse(button));
      c.mouseup(mouse(button));
    }
    expect(log).toEqual([]);
    expect(previews).toEqual([]);
  });

  it('sem mouse no aparelho, o botao do meio fica indisponivel', () => {
    const { log, previews, c } = capture(false);
    c.mousedown(mouse(1));
    c.mouseup(mouse(1));
    expect(log).toEqual([]);
    expect(previews).toEqual([]);
    c.keydown(key('F9', 'F9'));
    c.keyup(key('F9', 'F9'));
    expect(log).toEqual(['F9', 'fim']);
  });

  it('a repeticao e o que vem depois de gravar nao mudam a escolha', () => {
    const { log, c } = capture();
    c.keydown(key('KeyJ', 'j'));
    c.keydown(key('KeyJ', 'j', { repeat: true }));
    c.keyup(key('KeyJ', 'j'));
    c.keydown(key('KeyK', 'k'));
    c.keyup(key('KeyK', 'k'));
    c.mousedown(mouse(1));
    c.mouseup(mouse(1));
    expect(log).toEqual(['J', 'fim']);
  });

  it('a repeticao de uma tecla apertada antes de comecar nao conta', () => {
    const { log, c } = capture();
    c.keydown(key('Enter', 'Enter', { repeat: true }));
    c.keyup(key('Enter', 'Enter'));
    expect(log).toEqual([]);
  });

  it('Esc sozinho cancela; numa combinacao, faz parte dela', () => {
    const { log, c } = capture();
    c.keydown(key('Escape', 'Escape'));
    expect(log).toEqual(['fim']);

    const ctrl = capture();
    ctrl.c.keydown(key('Escape', 'Escape', { ctrl: true }));
    ctrl.c.keyup(key('Escape', 'Escape', { ctrl: true }));
    expect(ctrl.log).toEqual(['Ctrl+Esc', 'fim']);

    const other = capture();
    other.c.keydown(key('KeyA', 'a'));
    other.c.keydown(key('Escape', 'Escape'));
    other.c.keyup(key('KeyA', 'a'));
    expect(other.log).toEqual(['A+Esc', 'fim']);
  });

  it('aceita combinacoes que o navegador ou o sistema ja usam', () => {
    const { log, c } = capture();
    c.keydown(key('KeyW', 'w', { ctrl: true }));
    c.keyup(key('KeyW', 'w', { ctrl: true }));
    expect(log).toEqual(['Ctrl+W', 'fim']);
  });
});

describe('voiceStatus', () => {
  const view = (state: 'sleeping' | 'listening', relay = '') => ({ state, relay }) as Parameters<typeof voiceStatus>[0];

  it('as mensagens citam o atalho escolhido', () => {
    expect(voiceStatus(view('sleeping'), 'Ctrl+Shift+J')).toBe('segure Ctrl+Shift+J para falar');
    expect(voiceStatus(view('listening', 'claude'), 'F9')).toContain('segure F9 e diga');
  });

  it('sem o atalho ligado, continua esperando o nome', () => {
    expect(voiceStatus(view('sleeping'))).toBe('diga “Jarvis”');
  });
});
