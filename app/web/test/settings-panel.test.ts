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

const saved = new Map<string, string>();

describe('SettingsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
    saved.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => saved.set(k, v) });
  });

  it('agrupa em voz e depois aparencia e som', () => {
    const html = render();
    expect(html.indexOf('Voz</button>')).toBeGreaterThan(-1);
    expect(html.indexOf('Como falar')).toBeGreaterThan(html.indexOf('Voz</button>'));
    expect(html.indexOf('Aparência e som</button>')).toBeGreaterThan(html.indexOf('Como falar'));
  });
  it('mantem todos os itens de cada grupo', () => {
    const html = render();
    const voz = html.slice(0, html.indexOf('Aparência e som</button>'));
    const visual = html.slice(html.indexOf('Aparência e som</button>'));
    for (const item of ['Escuta ativa', 'Falar com', 'Atalho para falar', 'ouvindo']) expect(voz).toContain(item);
    for (const item of ['Modo 3D', 'Cor do Jarvis', 'Reduzir movimento', 'Demonstração de voz', 'Sons de clique']) expect(visual).toContain(item);
  });
  it('so mostra Sistema com algo para configurar', () => {
    expect(render()).not.toContain('Sistema');
    expect(render({ floating: { open: false, toggle: noop } })).toContain('Abrir janela flutuante');
    expect(render({ desktop: { autostart: true } as DesktopInfo })).toContain('Iniciar com o sistema');
  });
  it('de inicio, todos os grupos ficam abertos', () => {
    const html = render({ floating: { open: false, toggle: noop } });
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(3);
    expect(html).not.toContain('aria-expanded="false"');
    expect(html).not.toMatch(/<div id="settings-section-[a-z]+" hidden/);
  });
  it('recolhido fica guardado por grupo, e o conteudo continua montado', () => {
    saved.set('llm-agent-settings-appearance-open', '0');
    const html = render();
    expect(html).toContain('aria-controls="settings-section-voice"');
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(1);
    expect(html).toContain('<div id="settings-section-appearance" hidden');
    expect(html).not.toContain('<div id="settings-section-voice" hidden');
    expect(html).toContain('Sons de clique');
  });
});
