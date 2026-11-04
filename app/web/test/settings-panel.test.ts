import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../src/api.ts';
import { SettingsPanel } from '../src/components/SettingsPanel.tsx';
import type { SettingsState, SettingsToggles } from '../src/components/Settings.tsx';
import type { DesktopInfo } from '../src/desktop.ts';
import { DEFAULT_HOTKEY } from '../src/voice/hotkey.ts';

const settings: SettingsState = {
  webgl: true,
  mode3d: true,
  reduceMotion: false,
  voiceDemo: false,
  voice: true,
  holdKey: false,
  hotkey: DEFAULT_HOTKEY,
  globeColor: 'dourado',
  sounds: true,
};
const noop = () => {};
const toggles: SettingsToggles = {
  on3d: noop,
  onReduceMotion: noop,
  onVoiceDemo: noop,
  onVoice: noop,
  onHoldKey: noop,
  onHotkey: noop,
  onHotkeyCapturing: noop,
  onGlobeColor: noop,
  onSounds: noop,
};

const render = (extra: { desktop?: DesktopInfo | null; floating?: { open: boolean; toggle: () => void } | null } = {}) =>
  renderToStaticMarkup(
    createElement(SettingsPanel, {
      api: {} as Api,
      settings,
      toggles,
      voiceStatus: 'ouvindo',
      desktop: null,
      onAutostart: noop,
      floating: null,
      ...extra,
    }),
  );

describe('SettingsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
  });

  it('agrupa em voz e depois aparencia e som', () => {
    const html = render();
    expect(html.indexOf('<h2>Voz</h2>')).toBeGreaterThan(-1);
    expect(html.indexOf('Como falar')).toBeGreaterThan(html.indexOf('<h2>Voz</h2>'));
    expect(html.indexOf('<h2>Aparência e som</h2>')).toBeGreaterThan(html.indexOf('Como falar'));
  });
  it('mantem todos os itens de cada grupo', () => {
    const html = render();
    const voz = html.slice(0, html.indexOf('<h2>Aparência e som</h2>'));
    const visual = html.slice(html.indexOf('<h2>Aparência e som</h2>'));
    for (const item of ['Escuta ativa', 'Falar com', 'Atalho para falar', 'ouvindo']) expect(voz).toContain(item);
    for (const item of ['Modo 3D', 'Cor do Jarvis', 'Reduzir movimento', 'Demonstração de voz', 'Sons de clique']) expect(visual).toContain(item);
  });
  it('so mostra Sistema com algo para configurar', () => {
    expect(render()).not.toContain('Sistema');
    expect(render({ floating: { open: false, toggle: noop } })).toContain('Abrir janela flutuante');
    expect(render({ desktop: { autostart: true } as DesktopInfo })).toContain('Iniciar com o sistema');
  });
});
