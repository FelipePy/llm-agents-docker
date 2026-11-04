import type { CoreMode, CoreSignal } from '../scene/core.ts';
import type { UiCommand, VoiceClientMessage, VoiceServerMessage, VoiceState } from '../types.ts';
import { startCapture } from './capture.ts';
import { micHeld } from './record.ts';
import { Player } from './player.ts';
import { EchoGate } from './echo.ts';
import { HoldGate, frameRms, waveLevel } from './hold.ts';

export interface VoiceView {
  state: VoiceState;
  detail?: string;
  user: string;
  jarvis: string;
  /** Conversa direta com uma sessao (nome dela), ou null. */
  relay?: string | null;
  /** Texto ditado na conversa direta, ainda nao enviado. */
  relayDraft?: string;
  /** O usuario esta segurando o atalho de falar. */
  holding?: boolean;
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

/** `hold`: nome do atalho, se fala-se segurando ele (nao ha escuta esperando o nome). */
export function voiceStatus(v: VoiceView, hold?: string): string {
  if (v.relay && v.state !== 'off') {
    const how = hold ? `segure ${hold} e diga` : 'diga';
    return `ditando para o ${v.relay} — ${how} “envia” para enviar, “Jarvis, volta” para sair`;
  }
  switch (v.state) {
    case 'off':
      return '';
    case 'preparing':
      return v.detail ? `${v.detail}…` : 'preparando a voz…';
    case 'sleeping':
      return hold ? `segure ${hold} para falar` : 'diga “Jarvis”';
    case 'listening':
      return 'ouvindo…';
    case 'thinking':
      return 'pensando…';
    case 'speaking':
      return 'falando…';
  }
}

/** Conversa por voz com o servidor: microfone, reprodução, estado e legendas. */
/** O servidor de voz nao respondeu ou caiu (reinicio, atualizacao): vale tentar de novo. */
export class VoiceConnectionError extends Error {}

export class VoiceClient {
  state: VoiceState = 'off';
  private readonly token: string;
  private readonly onView: (patch: Partial<VoiceView>) => void;
  private readonly onError: (message: string) => void;
  private readonly onUi: (command: UiCommand) => void;
  private readonly onDrop: (() => void) | undefined;
  private ws: WebSocket | undefined;
  private player: Player | undefined;
  private stopCapture: (() => void) | undefined;
  private stopped = false;
  // Interrupcao: voz do usuario x eco da voz do Jarvis (ver echo.ts).
  private readonly echo = new EchoGate();
  private outPeak = 0;
  private outTimer: ReturnType<typeof setInterval> | undefined;
  private lastOverEcho = 0;
  /** Fala-se segurando o atalho: o microfone so vai para o servidor durante o aperto. */
  private readonly hold: boolean;
  private readonly gate = new HoldGate({
    start: () => this.send({ type: 'hold-start' }),
    frame: (pcm) => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(pcm.buffer as ArrayBuffer);
    },
    end: () => this.send({ type: 'hold-end' }),
  });
  private micVolume = 0;

  constructor(
    token: string,
    onView: (patch: Partial<VoiceView>) => void,
    onError: (message: string) => void,
    onUi: (command: UiCommand) => void,
    /** A conexao caiu depois de aberta (sem isso, vira um erro na tela). */
    onDrop?: () => void,
    hold = false,
  ) {
    this.hold = hold;
    this.onDrop = onDrop;
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
      ws.onerror = () => fail(new VoiceConnectionError('Não consegui conectar ao servidor de voz.'));
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
      if (!this.onDrop) this.onError('A conexão de voz caiu.');
      this.cleanup();
      this.setState('off');
      this.onDrop?.();
    };
    try {
      // Nivel maximo da voz do Jarvis entre um quadro do microfone e o seguinte.
      this.outTimer = setInterval(() => {
        this.outPeak = Math.max(this.outPeak, this.player?.outputRms() ?? 0);
      }, 20);
      this.stopCapture = await startCapture((pcm) => {
        if (this.hold) {
          this.micVolume = frameRms(pcm);
          // Gravando o cadastro da voz, o aperto nao comeca (ver holdStart).
          this.gate.frame(pcm);
          return;
        }
        // Gravando o cadastro da voz: o Jarvis nao ouve (ver record.ts).
        if (ws.readyState === WebSocket.OPEN && !micHeld()) ws.send(pcm.buffer as ArrayBuffer);
        this.checkEcho(pcm);
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
    const hold = this.hold ? { hold: true } : {};
    this.send(coords ? { type: 'start', lat: coords.latitude, lon: coords.longitude, ...hold } : { type: 'start', ...hold });
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

  /** Apertou o atalho de falar: se o Jarvis estiver falando, ele cala na hora. */
  holdStart(): void {
    if (!this.hold || this.gate.holding || micHeld()) return;
    if (this.state === 'off' || this.state === 'preparing') return;
    if (this.state === 'thinking' || this.state === 'speaking') this.player?.stop();
    this.gate.press();
    this.onView({ holding: true });
  }

  /** Soltou o atalho: a fala terminou. */
  holdEnd(): void {
    if (!this.gate.holding) return;
    this.gate.release();
    this.onView({ holding: false });
  }

  /** Volume captado para a onda do atalho (0 a 1). */
  micLevel(): number {
    return this.gate.holding ? waveLevel(this.micVolume) : 0;
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
        if (m.who === 'jarvis') this.onView({ jarvis: m.text });
        else this.onView({ user: m.ignored ? `${m.text} (ignorada)` : m.text, jarvis: '' });
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

  /**
   * Enquanto o Jarvis fala: o microfone esta bem acima do eco da voz dele? Entao
   * e o usuario falando por cima; o servidor junta com a deteccao de fala e para na hora.
   */
  private checkEcho(pcm: Int16Array): void {
    const out = this.outPeak;
    this.outPeak = 0;
    if (this.state !== 'speaking') {
      this.echo.resetStreak();
      return;
    }
    let sum = 0;
    for (const v of pcm) sum += (v / 32768) ** 2;
    const mic = Math.sqrt(sum / pcm.length);
    const now = performance.now();
    if (this.echo.feed(mic, out) && now - this.lastOverEcho > 300) {
      this.lastOverEcho = now;
      this.send({ type: 'over-echo' });
    }
  }

  private setState(state: VoiceState, detail?: string): void {
    this.state = state;
    if ((state === 'off' || state === 'preparing') && this.gate.holding) {
      this.gate.cancel();
      this.onView({ holding: false });
    }
    this.onView({ state, detail });
  }

  private send(m: VoiceClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private cleanup(): void {
    this.gate.cancel();
    clearInterval(this.outTimer);
    this.outTimer = undefined;
    this.stopCapture?.();
    this.stopCapture = undefined;
    this.player?.close();
    this.player = undefined;
    this.ws?.close();
    this.ws = undefined;
  }
}
