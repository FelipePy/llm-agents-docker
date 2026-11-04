import type { GlobeColor } from '../scene/globe.ts';

export interface SettingsState {
  webgl: boolean;
  mode3d: boolean;
  reduceMotion: boolean;
  voiceDemo: boolean;
  voice: boolean;
  /** Fala-se segurando Ctrl+Espaco (a escuta continua fica desligada). */
  holdKey: boolean;
  /** Cor do globo do Jarvis. */
  globeColor: GlobeColor;
  sounds: boolean;
}

export interface SettingsToggles {
  on3d: () => void;
  onReduceMotion: () => void;
  onVoiceDemo: () => void;
  onVoice: () => void;
  onHoldKey: () => void;
  onGlobeColor: (c: GlobeColor) => void;
  onSounds: () => void;
}

export function Settings({ settings, toggles, voiceStatus }: { settings: SettingsState; toggles: SettingsToggles; voiceStatus?: string }) {
  const use3d = settings.webgl && settings.mode3d;
  return (
    <div className="settings">
      <label title={settings.holdKey ? 'Desligada enquanto o atalho Ctrl+Espaço estiver ativado' : 'Escuta o microfone esperando “Hey Jarvis”'}>
        <input type="checkbox" checked={settings.voice} disabled={settings.holdKey} onChange={toggles.onVoice} />
        Escuta ativa
      </label>
      <label title="Segure Ctrl+Espaço para falar; ao soltar, o Jarvis responde. A escuta por “Jarvis” fica desligada.">
        <input type="checkbox" checked={settings.holdKey} onChange={toggles.onHoldKey} />
        Falar com Ctrl+Espaço
      </label>
      {(settings.voice || settings.holdKey) && voiceStatus && <div className="voice-status">{voiceStatus}</div>}
      <label title={settings.webgl ? '' : 'Este navegador não tem WebGL 2'}>
        <input type="checkbox" checked={use3d} disabled={!settings.webgl} onChange={toggles.on3d} />
        Modo 3D
      </label>
      <label title="Sons curtos ao clicar">
        <input type="checkbox" checked={settings.sounds} onChange={toggles.onSounds} />
        Sons
      </label>
      <label>
        <input type="checkbox" checked={settings.reduceMotion} onChange={toggles.onReduceMotion} />
        Reduzir movimento
      </label>
      <label title="Simula a voz do agente para ver o núcleo reagir">
        <input
          type="checkbox"
          checked={settings.voiceDemo}
          disabled={!use3d || settings.voice || settings.holdKey}
          onChange={toggles.onVoiceDemo}
        />
        Demonstração de voz
      </label>
    </div>
  );
}
