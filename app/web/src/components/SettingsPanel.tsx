import type { Api } from '../api.ts';
import type { DesktopInfo } from '../desktop.ts';
import { SttSettings } from './SttSettings.tsx';
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

/** Configuracoes, na gaveta lateral (aberta pelo botao de engrenagem). */
export function SettingsPanel({ api, settings, toggles, voiceStatus, desktop, onAutostart, floating }: Props) {
  const use3d = settings.webgl && settings.mode3d;
  return (
    <aside className="day settings-panel">
      <div className="brand">Configurações</div>

      <section>
        <h2>Voz</h2>
        <label title="Escuta o microfone esperando “Jarvis”">
          <input type="checkbox" checked={settings.voice} onChange={toggles.onVoice} />
          Escuta ativa
        </label>
        {settings.voice && voiceStatus && <div className="voice-status">{voiceStatus}</div>}
        <label title="Simula a voz do agente para ver o núcleo reagir">
          <input type="checkbox" checked={settings.voiceDemo} disabled={!use3d || settings.voice} onChange={toggles.onVoiceDemo} />
          Demonstração de voz
        </label>
        <SttSettings api={api} />
      </section>

      <section>
        <h2>Visual</h2>
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
      </section>

      <section>
        <h2>Som</h2>
        <label title="Sons curtos ao clicar">
          <input type="checkbox" checked={settings.sounds} onChange={toggles.onSounds} />
          Sons de clique
        </label>
      </section>

      {(desktop || floating) && (
        <section>
          <h2>Sistema</h2>
          {desktop && (
            <label title="Abre o Jarvis minimizado na bandeja quando você entra no sistema">
              <input type="checkbox" checked={desktop.autostart} onChange={() => onAutostart(!desktop.autostart)} />
              Iniciar com o sistema
            </label>
          )}
          {desktop && <p className="muted">Ao sair do app, a bolinha do Jarvis fica na lateral da tela; clique nela para voltar.</p>}
          {floating && (
            <>
              <button onClick={floating.toggle}>{floating.open ? 'Fechar a janela flutuante' : 'Abrir janela flutuante'}</button>
              <p className="muted">Uma janelinha do Jarvis por cima das outras abas e programas.</p>
            </>
          )}
        </section>
      )}
    </aside>
  );
}
