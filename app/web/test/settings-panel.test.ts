import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../src/api.ts';
import { SettingsCard } from '../src/components/SettingsCard.tsx';
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
    expect(render()).not.toContain('Sistema</h2>');
    expect(render({ floating: { open: false, toggle: noop } })).toContain('Abrir janela flutuante');
    expect(render({ desktop: { autostart: true } as DesktopInfo })).toContain('Iniciar com o sistema');
  });
  it('os grupos nao recolhem: sao titulos simples', () => {
    const html = render({ floating: { open: false, toggle: noop } });
    for (const grupo of ['Voz', 'Aparência e som', 'Sistema']) expect(html).toContain(`<h2>${grupo}</h2>`);
    expect(html).not.toMatch(/<h2><button/);
  });
  it('todos os blocos comecam recolhidos, sem ler nada guardado', () => {
    const html = render({ desktop: { autostart: true } as DesktopInfo, floating: { open: false, toggle: noop } });
    for (const bloco of ['Como falar', 'Visual e sons', 'Inicialização', 'Janela flutuante']) expect(html).toMatch(new RegExp(`aria-expanded="false"[^>]*>(?:(?!</button>).)*${bloco}</button>`));
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(4);
    expect(html).not.toContain('aria-expanded="true"');
    expect(getItem).not.toHaveBeenCalled();
  });
  it('voz fica em uma coluna so', () => {
    const html = render();
    const inicio = html.indexOf('<h2>Voz</h2>');
    const voz = html.slice(inicio, html.indexOf('</section>', inicio));
    expect(voz).not.toContain('settings-columns');
    expect(voz.match(/class="settings-column"/g)).toHaveLength(1);
  });
});

describe('SettingsCard', () => {
  it('recolhido, o corpo fica escondido, mas montado e ligado ao botao', () => {
    const html = renderToStaticMarkup(createElement(SettingsCard, { title: 'Bloco', children: createElement('p', null, 'conteudo') }));
    const id = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<div id="${id}" class="settings-card-body" hidden`);
    expect(html).toContain('conteudo');
  });
});
