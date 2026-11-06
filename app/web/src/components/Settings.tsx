import type { GlobeColor, GlobeStyle } from '../scene/globe.ts';
import type { Hotkey } from '../voice/hotkey.ts';
import { TalkHotkeyField } from './HotkeyField.tsx';

export interface SettingsState {
  webgl: boolean;
  mode3d: boolean;
  reduceMotion: boolean;
  voiceDemo: boolean;
  voice: boolean;
  /** Fala-se segurando o atalho (a escuta continua fica desligada). */
  holdKey: boolean;
  /** Combinacao do atalho de falar. */
  hotkey: Hotkey;
  /** Cor do globo do Jarvis e da interface. */
  globeColor: GlobeColor;
  /** Estilo do globo do Jarvis. */
  globeStyle: GlobeStyle;
  /** Combinacao do atalho que troca o estilo do globo. */
  globeHotkey: Hotkey;
  sounds: boolean;
  /** Legenda da fala do usuario e da fala do Jarvis (independentes). */
  captionUser: boolean;
  captionJarvis: boolean;
}

export interface SettingsToggles {
  on3d: () => void;
  onReduceMotion: () => void;
  onVoiceDemo: () => void;
  onVoice: () => void;
  onHoldKey: () => void;
  onHotkey: (h: Hotkey) => void;
  onHotkeyCapturing: (on: boolean) => void;
  onGlobeColor: (c: GlobeColor) => void;
  onGlobeStyle: (s: GlobeStyle) => void;
  onGlobeHotkey: (h: Hotkey) => void;
  onSounds: () => void;
  onCaptionUser: () => void;
  onCaptionJarvis: () => void;
}

export function Settings({ settings, toggles, voiceStatus }: { settings: SettingsState; toggles: SettingsToggles; voiceStatus?: string }) {
  const use3d = settings.webgl && settings.mode3d;
  return (
    <div className="settings">
      <label title={settings.holdKey ? `Desligada enquanto o atalho ${settings.hotkey.label} estiver ativado` : 'Escuta o microfone esperando “Hey Jarvis”'}>
        <input type="checkbox" checked={settings.voice} disabled={settings.holdKey} onChange={toggles.onVoice} />
        Escuta ativa
      </label>
      <label title={`Segure ${settings.hotkey.label} para falar; ao soltar, o Jarvis responde. A escuta por “Jarvis” fica desligada.`}>
        <input type="checkbox" checked={settings.holdKey} onChange={toggles.onHoldKey} />
        Falar com {settings.hotkey.label}
      </label>
      <TalkHotkeyField hotkey={settings.hotkey} globeHotkey={settings.globeHotkey} onChange={toggles.onHotkey} onCapturing={toggles.onHotkeyCapturing} />
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
