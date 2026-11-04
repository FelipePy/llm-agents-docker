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

const getItem = vi.fn((_key: string) => '1');

describe('SettingsPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
    // Nada do painel pode vir do que ficou guardado.
    getItem.mockClear();
    vi.stubGlobal('localStorage', { getItem, setItem: noop });
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
  it('todos os grupos comecam recolhidos, sem ler nada guardado', () => {
    const html = render({ floating: { open: false, toggle: noop } });
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(3);
    expect(html).not.toContain('aria-expanded="true"');
    for (const id of ['voice', 'appearance', 'system']) {
      expect(html).toContain(`aria-controls="settings-section-${id}"`);
      expect(html).toContain(`<div id="settings-section-${id}" hidden`);
    }
    expect(getItem).not.toHaveBeenCalled();
  });
  it('recolhido, o conteudo continua montado', () => {
    const html = render();
    expect(html).toContain('Como falar');
    expect(html).toContain('Sons de clique');
  });
  it('voz fica em uma coluna so', () => {
    const html = render();
    const inicio = html.indexOf('id="settings-section-voice"');
    const voz = html.slice(inicio, html.indexOf('</section>', inicio));
    expect(voz).not.toContain('settings-columns');
    expect(voz.match(/class="settings-column"/g)).toHaveLength(1);
  });
});
