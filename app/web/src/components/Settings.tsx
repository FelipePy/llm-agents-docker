export interface SettingsState {
  webgl: boolean;
  mode3d: boolean;
  reduceMotion: boolean;
  voiceDemo: boolean;
}

export interface SettingsToggles {
  on3d: () => void;
  onReduceMotion: () => void;
  onVoiceDemo: () => void;
}

export function Settings({ settings, toggles }: { settings: SettingsState; toggles: SettingsToggles }) {
  const use3d = settings.webgl && settings.mode3d;
  return (
    <div className="settings">
      <label title={settings.webgl ? '' : 'Este navegador não tem WebGL 2'}>
        <input type="checkbox" checked={use3d} disabled={!settings.webgl} onChange={toggles.on3d} />
        Modo 3D
      </label>
      <label>
        <input type="checkbox" checked={settings.reduceMotion} onChange={toggles.onReduceMotion} />
        Reduzir movimento
      </label>
      <label title="Simula a voz do agente para ver o núcleo reagir">
        <input type="checkbox" checked={settings.voiceDemo} disabled={!use3d} onChange={toggles.onVoiceDemo} />
        Demonstração de voz
      </label>
    </div>
  );
}
