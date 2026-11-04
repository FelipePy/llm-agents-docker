import type { Api } from '../api.ts';
import type { DesktopInfo } from '../desktop.ts';
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

/** Configuracoes, na gaveta lateral (aberta pelo botao de engrenagem). */
export function SettingsPanel({ api, settings, toggles, voiceStatus, desktop, onAutostart, floating }: Props) {
  const use3d = settings.webgl && settings.mode3d;
  return (
    <aside className="day settings-panel">
      <div className="brand">Configurações</div>

      <section>
        <h2>Voz</h2>
        <label title={settings.holdKey ? 'Desligada enquanto o atalho Ctrl+Espaço estiver ativado' : 'Escuta o microfone esperando “Jarvis”'}>
          <input type="checkbox" checked={settings.voice} disabled={settings.holdKey} onChange={toggles.onVoice} />
          Escuta ativa
        </label>
        <label title="Segure Ctrl+Espaço para falar; ao soltar, o Jarvis responde">
          <input type="checkbox" checked={settings.holdKey} onChange={toggles.onHoldKey} />
          Falar com Ctrl+Espaço
        </label>
        {settings.holdKey && (
          <p className="muted">Segure para falar e solte para o Jarvis responder. Ele não fica esperando ser chamado: o que o microfone capta só vai para ele enquanto você segura.</p>
        )}
        {(settings.voice || settings.holdKey) && voiceStatus && <div className="voice-status">{voiceStatus}</div>}
        <label title="Simula a voz do agente para ver o núcleo reagir">
          <input type="checkbox" checked={settings.voiceDemo} disabled={!use3d || settings.voice || settings.holdKey} onChange={toggles.onVoiceDemo} />
          Demonstração de voz
        </label>
        <PauseSettings api={api} />
        <SttSettings api={api} />
        <VoiceProfileSettings api={api} />
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
