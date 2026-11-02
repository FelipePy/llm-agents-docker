import type { CoreMode, CoreSignal } from '../scene/core.ts';
import type { UiCommand, VoiceClientMessage, VoiceServerMessage, VoiceState } from '../types.ts';
import { startCapture } from './capture.ts';
import { Player } from './player.ts';

export interface VoiceView {
  state: VoiceState;
  detail?: string;
  user: string;
  jarvis: string;
  /** Conversa direta com uma sessao (nome dela), ou null. */
  relay?: string | null;
}

export const OFF_VIEW: VoiceView = { state: 'off', user: '', jarvis: '' };

const MODE: Record<VoiceState, CoreMode> = {
  off: 'idle',
  preparing: 'idle',
  sleeping: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
};

export function voiceStatus(v: VoiceView): string {
  if (v.relay && v.state !== 'off') return `falando direto com o ${v.relay} — diga “Jarvis, volta”`;
  switch (v.state) {
    case 'off':
      return '';
    case 'preparing':
      return v.detail ? `${v.detail}…` : 'preparando a voz…';
    case 'sleeping':
      return 'diga “Jarvis”';
    case 'listening':
      return 'ouvindo…';
    case 'thinking':
      return 'pensando…';
    case 'speaking':
      return 'falando…';
  }
}

/** Conversa por voz com o servidor: microfone, reprodução, estado e legendas. */
export class VoiceClient {
  state: VoiceState = 'off';
  private readonly token: string;
  private readonly onView: (patch: Partial<VoiceView>) => void;
  private readonly onError: (message: string) => void;
  private readonly onUi: (command: UiCommand) => void;
  private ws: WebSocket | undefined;
  private player: Player | undefined;
  private stopCapture: (() => void) | undefined;
  private stopped = false;

  constructor(
    token: string,
    onView: (patch: Partial<VoiceView>) => void,
    onError: (message: string) => void,
    onUi: (command: UiCommand) => void,
  ) {
    this.onUi = onUi;
    this.token = token;
    this.onView = onView;
    this.onError = onError;
  }

  async start(): Promise<void> {
    this.player = new Player((id) => this.send({ type: 'played', id }));
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/voice?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;
    await new Promise<void>((ok, fail) => {
      ws.onopen = () => ok();
      ws.onerror = () => fail(new Error('Não consegui conectar ao servidor de voz.'));
    });
    ws.onmessage = (e) => {
      try {
        this.handle(JSON.parse(String(e.data)));
      } catch {
        // mensagem invalida
      }
    };
    ws.onclose = () => {
      if (this.stopped) return;
      this.onError('A conexão de voz caiu.');
      this.cleanup();
      this.setState('off');
    };
    try {
      this.stopCapture = await startCapture((pcm) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(pcm.buffer as ArrayBuffer);
      });
    } catch (err) {
      this.stop();
      throw new Error(`Não consegui usar o microfone: ${(err as Error).message ?? err}`);
    }
    const coords = await new Promise<GeolocationCoordinates | null>((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition((p) => resolve(p.coords), () => resolve(null), { timeout: 3000, maximumAge: 3600e3 });
    });
    // A localizacao (se permitida) serve para o clima da saudacao inicial.
    this.send(coords ? { type: 'start', lat: coords.latitude, lon: coords.longitude } : { type: 'start' });
  }

  stop(): void {
    this.stopped = true;
    this.send({ type: 'stop' });
    this.cleanup();
    this.state = 'off';
  }

  interrupt(): void {
    this.player?.stop();
    this.send({ type: 'interrupt' });
  }

  signal(): CoreSignal {
    return { mode: MODE[this.state], level: this.state === 'speaking' ? (this.player?.level() ?? 0) : 0 };
  }

  private handle(m: VoiceServerMessage): void {
    switch (m.type) {
      case 'state':
        this.setState(m.state, m.detail);
        return;
      case 'caption':
        this.onView(m.who === 'user' ? { user: m.text, jarvis: '' } : { jarvis: m.text });
        return;
      case 'audio':
        this.player?.append(m.id, m.data, m.last);
        return;
      case 'stop-audio':
        this.player?.stop();
        return;
      case 'chime':
        this.player?.chime();
        return;
      case 'error':
        this.onError(m.message);
        return;
      case 'ui':
        this.onUi(m.command);
        return;
      case 'relay':
        this.onView({ relay: m.target });
        return;
    }
  }

  private setState(state: VoiceState, detail?: string): void {
    this.state = state;
    this.onView({ state, detail });
  }

  private send(m: VoiceClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private cleanup(): void {
    this.stopCapture?.();
    this.stopCapture = undefined;
    this.player?.close();
    this.player = undefined;
    this.ws?.close();
    this.ws = undefined;
  }
}
