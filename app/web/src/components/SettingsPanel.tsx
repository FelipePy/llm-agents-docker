import type { Api } from '../api.ts';
import type { DesktopInfo } from '../desktop.ts';
import { GlobeHotkeyField, TalkHotkeyField } from './HotkeyField.tsx';
import { PauseSettings } from './PauseSettings.tsx';
import { SettingsCard } from './SettingsCard.tsx';
import { SttSettings } from './SttSettings.tsx';
import { VoiceProfileSettings } from './VoiceProfileSettings.tsx';
import { GLOBE_COLORS, GLOBE_STYLES, isGlobeColor, isGlobeStyle } from '../scene/globe.ts';
import type { SettingsState, SettingsToggles } from './Settings.tsx';

interface Props {
  api: Api;
  settings: SettingsState;
  toggles: SettingsToggles;
  voiceStatus: string;
  /** App desktop (null no navegador). */
  desktop: DesktopInfo | null;
  onAutostart: (on: boolean) => void;
  /** Navegador com janela flutuante (Picture-in-Picture); null se nao houver. */
  floating: { open: boolean; toggle: () => void } | null;
}

/** Configuracoes, no modal aberto pelo botao de engrenagem. */
export function SettingsPanel({ api, settings, toggles, voiceStatus, desktop, onAutostart, floating }: Props) {
  const use3d = settings.webgl && settings.mode3d;
  return (
    <aside className="day settings-panel">
      <div className="brand">Configurações</div>

      <section>
        <h2>Voz</h2>
        <div className="settings-column">
          <SettingsCard title="Como falar">
            <label title={settings.holdKey ? `Desligada enquanto o atalho ${settings.hotkey.label} estiver ativado` : 'Escuta o microfone esperando “Jarvis”'}>
              <input type="checkbox" checked={settings.voice} disabled={settings.holdKey} onChange={toggles.onVoice} />
              Escuta ativa
            </label>
            <label title={`Segure ${settings.hotkey.label} para falar; ao soltar, o Jarvis responde`}>
              <input type="checkbox" checked={settings.holdKey} onChange={toggles.onHoldKey} />
              Falar com {settings.hotkey.label}
            </label>
            <TalkHotkeyField hotkey={settings.hotkey} globeHotkey={settings.globeHotkey} onChange={toggles.onHotkey} onCapturing={toggles.onHotkeyCapturing} />
            {settings.holdKey && (
              <p className="muted">Segure para falar e solte para o Jarvis responder. Ele não fica esperando ser chamado: o que o microfone capta só vai para ele enquanto você segura.</p>
            )}
            {(settings.voice || settings.holdKey) && voiceStatus && <div className="voice-status">{voiceStatus}</div>}
          </SettingsCard>
          <VoiceProfileSettings api={api} />
          <SttSettings api={api} />
          <PauseSettings api={api} />
        </div>
      </section>

      <section>
        <h2>Aparência e som</h2>
        <SettingsCard title="Visual e sons">
          <label title={settings.webgl ? '' : 'Este navegador não tem WebGL 2'}>
            <input type="checkbox" checked={use3d} disabled={!settings.webgl} onChange={toggles.on3d} />
            Modo 3D
          </label>
          <label className="field" title="Desenho do globo do Jarvis">
            <span>Estilo do Jarvis</span>
            <select
              value={settings.globeStyle}
              disabled={!use3d}
              onChange={(e) => isGlobeStyle(e.target.value) && toggles.onGlobeStyle(e.target.value)}
            >
              {Object.entries(GLOBE_STYLES).map(([id, s]) => (
                <option key={id} value={id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <GlobeHotkeyField hotkey={settings.hotkey} globeHotkey={settings.globeHotkey} onChange={toggles.onGlobeHotkey} onCapturing={toggles.onHotkeyCapturing} />
          <label className="field" title="Cor do globo e dos detalhes da interface (o terminal não muda)">
            <span>Cor do Jarvis</span>
            <select
              value={settings.globeColor}
              onChange={(e) => isGlobeColor(e.target.value) && toggles.onGlobeColor(e.target.value)}
            >
              {Object.entries(GLOBE_COLORS).map(([id, c]) => (
                <option key={id} value={id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={settings.reduceMotion} onChange={toggles.onReduceMotion} />
            Reduzir movimento
          </label>
          <label title="Simula a voz do agente para ver o núcleo reagir">
            <input type="checkbox" checked={settings.voiceDemo} disabled={!use3d || settings.voice || settings.holdKey} onChange={toggles.onVoiceDemo} />
            Demonstração de voz
          </label>
          <label title="Sons curtos ao clicar">
            <input type="checkbox" checked={settings.sounds} onChange={toggles.onSounds} />
            Sons de clique
          </label>
        </SettingsCard>
      </section>

      {(desktop || floating) && (
        <section>
          <h2>Sistema</h2>
          {desktop && (
            <SettingsCard title="Inicialização">
              <label title="Abre o Jarvis minimizado na bandeja quando você entra no sistema">
                <input type="checkbox" checked={desktop.autostart} onChange={() => onAutostart(!desktop.autostart)} />
                Iniciar com o sistema
              </label>
              <p className="muted">Ao sair do app, a bolinha do Jarvis fica na lateral da tela; clique nela para voltar.</p>
            </SettingsCard>
          )}
          {floating && (
            <SettingsCard title="Janela flutuante">
              <button className="settings-button" onClick={floating.toggle}>{floating.open ? 'Fechar a janela flutuante' : 'Abrir janela flutuante'}</button>
              <p className="muted">Uma janelinha do Jarvis por cima das outras abas e programas.</p>
            </SettingsCard>
          )}
        </section>
      )}
    </aside>
  );
}
