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
  /** Texto ditado na conversa direta, ainda nao enviado. */
  relayDraft?: string;
  /** Tempos da ultima resposta (ms desde o fim da fala) e as ferramentas que ela usou. */
  timing?: { stt: number | null; firstToken: number | null; firstAudio: number | null; tools?: string[] };
}

export const OFF_VIEW: VoiceView = { state: 'off', user: '', jarvis: '' };

const seconds = (ms: number | null): string => (ms === null ? '?' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);

/** "transcrição 1,2 s · resposta 0,9 s · voz 1,6 s" da ultima fala (vazio se nao houver). */
export function timingText(v: VoiceView): string {
  const t = v.timing;
  if (!t || v.state === 'off') return '';
  const tools = t.tools?.length ? ` (usou ${t.tools.join(', ')})` : '';
  return `última resposta: transcrição ${seconds(t.stt)} · 1ª palavra ${seconds(t.firstToken)}${tools} · voz ${seconds(t.firstAudio)}`;
}

const MODE: Record<VoiceState, CoreMode> = {
  off: 'idle',
  preparing: 'idle',
  sleeping: 'idle',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
};

export function voiceStatus(v: VoiceView): string {
  if (v.relay && v.state !== 'off') return `ditando para o ${v.relay} — diga “envia” para enviar, “Jarvis, volta” para sair`;
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

  /** Conversa direta: envia o ditado, apaga o ditado, ou sai sem enviar. */
  relaySubmit(): void {
    this.send({ type: 'relay-submit' });
  }

  relayClear(): void {
    this.send({ type: 'relay-clear' });
  }

  relayExit(): void {
    this.send({ type: 'relay-exit' });
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
        this.player?.duck(false);
        return;
      case 'duck':
        this.player?.duck(m.on);
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
        this.onView({ relay: m.target, relayDraft: m.draft });
        return;
      case 'timing':
        this.onView({ timing: { stt: m.stt, firstToken: m.firstToken, firstAudio: m.firstAudio, tools: m.tools } });
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
