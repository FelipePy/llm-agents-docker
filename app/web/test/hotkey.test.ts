import { describe, expect, it } from 'vitest';
import { DEFAULT_HOTKEY, HotkeyCapture, hotkeyFrom, isHotkeyModifier, matchesHotkey, parseHotkey, sameHotkey, type Hotkey } from '../src/voice/hotkey.ts';

const key = (code: string, k: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean; repeat?: boolean } = {}) => ({
  code,
  key: k,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: !!mods.meta,
  repeat: !!mods.repeat,
});

describe('hotkeyFrom', () => {
  it('monta a combinacao e o nome na tela', () => {
    expect(hotkeyFrom(key('Space', ' ', { ctrl: true }))).toEqual(DEFAULT_HOTKEY);
    expect(hotkeyFrom(key('KeyJ', 'J', { ctrl: true, shift: true }))?.label).toBe('Ctrl+Shift+J');
    expect(hotkeyFrom(key('Digit1', '!', { shift: true }))?.label).toBe('Shift+1');
    expect(hotkeyFrom(key('F9', 'F9'))?.label).toBe('F9');
    expect(hotkeyFrom(key('Numpad0', '0', { alt: true }))?.label).toBe('Alt+Num 0');
    expect(hotkeyFrom(key('ArrowUp', 'ArrowUp', { meta: true }))?.label).toBe('Win+Seta para cima');
  });

  it('pontuacao mostra o que a tecla escreve no teclado do usuario', () => {
    expect(hotkeyFrom(key('Semicolon', 'ç', { ctrl: true }))?.label).toBe('Ctrl+Ç');
    expect(hotkeyFrom(key('BracketLeft', 'Dead'))?.label).toBe('BracketLeft');
  });

  it('so modificadores ainda nao e uma combinacao', () => {
    expect(hotkeyFrom(key('ControlLeft', 'Control', { ctrl: true }))).toBeNull();
    expect(hotkeyFrom(key('ShiftLeft', 'Shift', { shift: true }))).toBeNull();
    expect(hotkeyFrom(key('AltRight', 'AltGraph'))).toBeNull();
    expect(hotkeyFrom(key('MetaLeft', 'Meta', { meta: true }))).toBeNull();
    expect(hotkeyFrom(key('', 'a'))).toBeNull();
  });
});

describe('combinacao', () => {
  const combo = hotkeyFrom(key('KeyJ', 'J', { ctrl: true, shift: true })) as Hotkey;

  it('confere a tecla fisica e exatamente os modificadores', () => {
    expect(matchesHotkey(key('KeyJ', 'j', { ctrl: true, shift: true }), combo)).toBe(true);
    expect(matchesHotkey(key('KeyJ', 'j', { ctrl: true }), combo)).toBe(false);
    expect(matchesHotkey(key('KeyJ', 'j', { ctrl: true, shift: true, alt: true }), combo)).toBe(false);
    expect(matchesHotkey(key('KeyK', 'k', { ctrl: true, shift: true }), combo)).toBe(false);
  });

  it('reconhece os modificadores que fazem parte dela', () => {
    expect(isHotkeyModifier('Control', combo)).toBe(true);
    expect(isHotkeyModifier('Shift', combo)).toBe(true);
    expect(isHotkeyModifier('Alt', combo)).toBe(false);
    expect(isHotkeyModifier('j', combo)).toBe(false);
  });

  it('o nome na tela nao entra na comparacao', () => {
    expect(sameHotkey(DEFAULT_HOTKEY, { ...DEFAULT_HOTKEY, label: 'outro' })).toBe(true);
    expect(sameHotkey(DEFAULT_HOTKEY, combo)).toBe(false);
  });
});

describe('parseHotkey', () => {
  it('le de volta o que foi guardado', () => {
    const combo = hotkeyFrom(key('KeyJ', 'J', { ctrl: true, shift: true })) as Hotkey;
    expect(parseHotkey(JSON.stringify(combo))).toEqual(combo);
  });

  it('nada guardado ou guardado invalido nao vira atalho', () => {
    for (const saved of [null, '', 'x{', 'null', '1', '{}', '{"code":"KeyJ"}', '{"code":"","label":"x","ctrl":true,"shift":false,"alt":false,"meta":false}', '{"code":"KeyJ","label":"J","ctrl":"sim","shift":false,"alt":false,"meta":false}']) {
      expect(parseHotkey(saved)).toBeNull();
    }
  });
});

describe('HotkeyCapture', () => {
  function capture() {
    const log: string[] = [];
    return { log, c: new HotkeyCapture((h) => log.push(h.label), () => log.push('fim')) };
  }

  it('espera a tecla depois dos modificadores, guarda no aperto e termina ao soltar a tecla', () => {
    const { log, c } = capture();
    c.keydown(key('ControlLeft', 'Control', { ctrl: true }));
    c.keydown(key('ShiftLeft', 'Shift', { ctrl: true, shift: true }));
    expect(log).toEqual([]);
    c.keydown(key('KeyJ', 'J', { ctrl: true, shift: true }));
    expect(log).toEqual(['Ctrl+Shift+J']);
    c.keyup(key('ControlLeft', 'Control', { shift: true }));
    expect(log).toEqual(['Ctrl+Shift+J']);
    c.keyup(key('KeyJ', 'J'));
    expect(log).toEqual(['Ctrl+Shift+J', 'fim']);
  });

  it('a repeticao e outras teclas depois de escolher nao mudam a escolha', () => {
    const { log, c } = capture();
    c.keydown(key('KeyJ', 'j'));
    c.keydown(key('KeyJ', 'j', { repeat: true }));
    c.keydown(key('KeyK', 'k'));
    expect(log).toEqual(['J']);
  });

  it('a repeticao de uma tecla apertada antes de comecar nao conta', () => {
    const { log, c } = capture();
    c.keydown(key('Enter', 'Enter', { repeat: true }));
    c.keyup(key('Enter', 'Enter'));
    expect(log).toEqual([]);
  });

  it('Esc sozinho cancela; com modificador, e uma combinacao', () => {
    const { log, c } = capture();
    c.keydown(key('Escape', 'Escape'));
    expect(log).toEqual(['fim']);
    const other = capture();
    other.c.keydown(key('Escape', 'Escape', { ctrl: true }));
    expect(other.log).toEqual(['Ctrl+Esc']);
  });

  it('aceita combinacoes que o navegador ou o sistema ja usam', () => {
    const { log, c } = capture();
    c.keydown(key('KeyW', 'w', { ctrl: true }));
    expect(log).toEqual(['Ctrl+W']);
  });
});
