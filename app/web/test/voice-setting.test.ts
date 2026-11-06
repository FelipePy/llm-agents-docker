import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONFIG_OPTIONS } from '../../server/src/voice/config.ts';
import { GLOBE_COLORS, GLOBE_STYLES } from '../src/scene/globe.ts';
import { afterReply, applySetting, type SettingCommand, type SettingSetters } from '../src/voiceSetting.ts';
import { BrainForm } from '../src/components/BrainSettings.tsx';
import type { BrainChoiceView } from '../src/api.ts';

function setters() {
  const log: string[] = [];
  const rec = (name: string) => (v: unknown) => log.push(`${name}=${String(v)}`);
  const set = Object.fromEntries(
    ['captionUser', 'captionJarvis', 'voiceOn', 'holdKey', 'mode3d', 'reduceMotion', 'voiceDemo', 'sounds', 'globeColor', 'globeStyle'].map((k) => [k, rec(k)]),
  ) as unknown as SettingSetters;
  return { set, log };
}
const cmd = (key: SettingCommand['key'], value: boolean | string): SettingCommand => ({ kind: 'setting', key, value });

describe('applySetting', () => {
  it('"as legendas" mexe nas duas; cada legenda tambem muda sozinha', () => {
    const { set, log } = setters();
    applySetting(cmd('legendas', true), set);
    applySetting(cmd('legendaJarvis', false), set);
    expect(log).toEqual(['captionUser=true', 'captionJarvis=true', 'captionJarvis=false']);
  });
  it('escuta e atalho nao ficam os dois desligados nem os dois ligados', () => {
    const { set, log } = setters();
    applySetting(cmd('escuta', true), set);
    applySetting(cmd('atalho', false), set);
    expect(log).toEqual(['voiceOn=true', 'holdKey=false', 'holdKey=false', 'voiceOn=true']);
  });
  it('cor e estilo so com valores que existem', () => {
    const { set, log } = setters();
    expect(applySetting(cmd('cor', 'verde'), set)).toBe(true);
    expect(applySetting(cmd('cor', 'furta-cor'), set)).toBe(false);
    expect(applySetting(cmd('estilo', 'orbitas'), set)).toBe(true);
    expect(applySetting(cmd('sons', 'sim'), set)).toBe(false);
    expect(log).toEqual(['globeColor=verde', 'globeStyle=orbitas']);
  });
  it('so escuta e atalho esperam a resposta terminar', () => {
    expect(afterReply(cmd('escuta', false))).toBe(true);
    expect(afterReply(cmd('atalho', true))).toBe(true);
    expect(afterReply(cmd('legendas', true))).toBe(false);
  });
  it('as escolhas de cor e estilo da voz sao as mesmas da tela', () => {
    const ids = (key: string) => CONFIG_OPTIONS.find((o) => o.key === key)!.choices!.map((c) => c.id).sort();
    expect(ids('cor')).toEqual(Object.keys(GLOBE_COLORS).sort());
    expect(ids('estilo')).toEqual(Object.keys(GLOBE_STYLES).sort());
  });
  it('toda opcao da interface tem como ser aplicada', () => {
    const { set } = setters();
    for (const o of CONFIG_OPTIONS.filter((o) => o.where === 'ui')) {
      expect(applySetting(cmd(o.key as SettingCommand['key'], o.choices ? o.choices[0].id : true), set), o.key).toBe(true);
    }
  });
});

describe('BrainForm', () => {
  const view: BrainChoiceView = {
    provider: 'claude',
    model: 'haiku',
    models: { claude: [{ id: 'haiku', label: 'Haiku 5.5' }, { id: 'sonnet', label: 'Sonnet 5.5' }], codex: [] },
    errors: { codex: 'Codex não instalado' },
  };
  const render = (provider: 'claude' | 'codex', model: string) =>
    renderToStaticMarkup(createElement(BrainForm, { view, provider, model, notice: null, onProvider: () => {}, onModel: () => {}, onSave: () => {} }));
  it('mostra os provedores e os modelos do plano; salvar so com mudanca', () => {
    const html = render('claude', 'haiku');
    for (const t of ['Quem responde por voz', 'Claude', 'Codex', 'Haiku 5.5', 'Sonnet 5.5', 'sessões dos projetos']) expect(html).toContain(t);
    expect(html).toMatch(/<button disabled="">Salvar/);
    expect(render('claude', 'sonnet')).toMatch(/<button>Salvar/);
  });
  it('sem a lista de um provedor, diz o motivo', () => {
    expect(render('codex', '')).toContain('Não consegui listar os modelos do Codex: Codex não instalado');
  });
});
