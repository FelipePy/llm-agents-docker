import { useState, type ReactNode } from 'react';
import type { Api } from '../api.ts';
import type { DesktopInfo } from '../desktop.ts';
import { Chevron } from './Chevron.tsx';
import { HotkeyField } from './HotkeyField.tsx';
import { PauseSettings } from './PauseSettings.tsx';
import { SttSettings } from './SttSettings.tsx';
import { VoiceProfileSettings } from './VoiceProfileSettings.tsx';
import { GLOBE_COLORS, isGlobeColor } from '../scene/globe.ts';
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

/** Grupo que recolhe pelo titulo. Comeca recolhido: o painel e desmontado ao fechar o modal, e nada fica guardado. */
function SettingsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const bodyId = `settings-section-${id}`;
  return (
    <section>
      <h2>
        <button className="settings-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <Chevron direction={open ? 'down' : 'right'} />
          {title}
        </button>
      </h2>
      {/* Recolher so esconde: desmontar perderia o que esta sendo digitado ou gravado. */}
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** Configuracoes, no modal aberto pelo botao de engrenagem. */
export function SettingsPanel({ api, settings, toggles, voiceStatus, desktop, onAutostart, floating }: Props) {
  const use3d = settings.webgl && settings.mode3d;
  return (
    <aside className="day settings-panel">
      <div className="brand">Configurações</div>

      <SettingsSection id="voice" title="Voz">
        <div className="settings-column">
          <div className="settings-card">
            <div className="settings-card-title">Como falar</div>
            <label title={settings.holdKey ? `Desligada enquanto o atalho ${settings.hotkey.label} estiver ativado` : 'Escuta o microfone esperando “Jarvis”'}>
              <input type="checkbox" checked={settings.voice} disabled={settings.holdKey} onChange={toggles.onVoice} />
              Escuta ativa
            </label>
            <label title={`Segure ${settings.hotkey.label} para falar; ao soltar, o Jarvis responde`}>
              <input type="checkbox" checked={settings.holdKey} onChange={toggles.onHoldKey} />
              Falar com {settings.hotkey.label}
            </label>
            <HotkeyField hotkey={settings.hotkey} onChange={toggles.onHotkey} onCapturing={toggles.onHotkeyCapturing} />
            {settings.holdKey && (
              <p className="muted">Segure para falar e solte para o Jarvis responder. Ele não fica esperando ser chamado: o que o microfone capta só vai para ele enquanto você segura.</p>
            )}
            {(settings.voice || settings.holdKey) && voiceStatus && <div className="voice-status">{voiceStatus}</div>}
          </div>
          <VoiceProfileSettings api={api} />
          <SttSettings api={api} />
          <PauseSettings api={api} />
        </div>
      </SettingsSection>

      <div className="settings-columns">
        <SettingsSection id="appearance" title="Aparência e som">
          <div className="settings-card">
            <label title={settings.webgl ? '' : 'Este navegador não tem WebGL 2'}>
              <input type="checkbox" checked={use3d} disabled={!settings.webgl} onChange={toggles.on3d} />
              Modo 3D
            </label>
            <label className="field" title="Cor do globo holográfico do Jarvis">
              <span>Cor do Jarvis</span>
              <select
                value={settings.globeColor}
                disabled={!use3d}
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
          </div>
        </SettingsSection>

        {(desktop || floating) && (
          <SettingsSection id="system" title="Sistema">
            <div className="settings-card">
              {desktop && (
                <label title="Abre o Jarvis minimizado na bandeja quando você entra no sistema">
                  <input type="checkbox" checked={desktop.autostart} onChange={() => onAutostart(!desktop.autostart)} />
                  Iniciar com o sistema
                </label>
              )}
              {desktop && <p className="muted">Ao sair do app, a bolinha do Jarvis fica na lateral da tela; clique nela para voltar.</p>}
              {floating && (
                <>
                  <button className="settings-button" onClick={floating.toggle}>{floating.open ? 'Fechar a janela flutuante' : 'Abrir janela flutuante'}</button>
                  <p className="muted">Uma janelinha do Jarvis por cima das outras abas e programas.</p>
                </>
              )}
            </div>
          </SettingsSection>
        )}
      </div>
    </aside>
  );
}
