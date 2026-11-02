export interface SettingsState {
  webgl: boolean;
  mode3d: boolean;
  reduceMotion: boolean;
  voiceDemo: boolean;
  voice: boolean;
}

export interface SettingsToggles {
  on3d: () => void;
  onReduceMotion: () => void;
  onVoiceDemo: () => void;
  onVoice: () => void;
}

export function Settings({ settings, toggles, voiceStatus }: { settings: SettingsState; toggles: SettingsToggles; voiceStatus?: string }) {
  const use3d = settings.webgl && settings.mode3d;
  return (
    <div className="settings">
      <label title="Escuta o microfone esperando “Hey Jarvis”">
        <input type="checkbox" checked={settings.voice} onChange={toggles.onVoice} />
        Escuta ativa
      </label>
      {settings.voice && voiceStatus && <div className="voice-status">{voiceStatus}</div>}
      <label title={settings.webgl ? '' : 'Este navegador não tem WebGL 2'}>
        <input type="checkbox" checked={use3d} disabled={!settings.webgl} onChange={toggles.on3d} />
        Modo 3D
      </label>
      <label>
        <input type="checkbox" checked={settings.reduceMotion} onChange={toggles.onReduceMotion} />
        Reduzir movimento
      </label>
      <label title="Simula a voz do agente para ver o núcleo reagir">
        <input
          type="checkbox"
          checked={settings.voiceDemo}
          disabled={!use3d || settings.voice}
          onChange={toggles.onVoiceDemo}
        />
        Demonstração de voz
      </label>
    </div>
  );
}
