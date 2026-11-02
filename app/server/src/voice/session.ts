import type { VoiceClientMessage, VoiceServerMessage, VoiceState } from '../types.ts';
import type { Brain } from './brain.ts';
import { SentenceSplitter, isGoodbye, stripMarkdown } from './text.ts';

export type WorkerCommand =
  | { cmd: 'listen'; barge?: boolean }
  | { cmd: 'sleep' }
  | { cmd: 'cancel' }
  | { cmd: 'speak'; id: number; text: string };

export type WorkerEvent =
  | { event: 'ready' }
  | { event: 'status'; message: string }
  | { event: 'wake'; score: number }
  | { event: 'speech-start' }
  | { event: 'partial'; text: string }
  | { event: 'transcript'; id: number; text: string; ms?: number }
  | { event: 'audio'; id: number; data: string; last: boolean }
  | { event: 'speak-error'; id: number; message: string }
  | { event: 'error'; message: string; fatal?: boolean }
  | { event: 'exit'; code: number | null };

export interface VoiceWorker {
  ensureReady(): Promise<void>;
  command(cmd: WorkerCommand): void;
  sendAudio(pcm: Buffer): void;
  on(event: 'event', listener: (e: WorkerEvent) => void): unknown;
  off(event: 'event', listener: (e: WorkerEvent) => void): unknown;
}

const RESTART_WINDOW_MS = 60_000;

/**
 * Conversa por voz: palavra de ativacao -> ouvir -> pensar -> falar -> ouvir...
 * ate a despedida. Silencio nao encerra.
 *
 * Interromper (falar por cima, "Hey Jarvis" ou Esc) so cala o Jarvis: a
 * resposta em andamento continua em background (ferramentas terminam o que
 * comecaram) e a nova pergunta e respondida assim que ela acabar.
 */
export class VoiceSession {
  state: VoiceState = 'off';
  private readonly worker: VoiceWorker;
  private readonly brain: Brain;
  private readonly send: (m: VoiceServerMessage) => void;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly bargeIn: boolean;
  private readonly listener = (e: WorkerEvent) => this.onWorker(e);
  /** Resposta que pode falar; as anteriores seguem caladas. */
  private turn = 0;
  /** As respostas rodam uma de cada vez, em ordem. */
  private chain: Promise<void> = Promise.resolve();
  private stopController = new AbortController();
  private pending = new Set<number>();
  private nextSpeech = 0;
  private brainDone = true;
  private farewell = false;
  private lastRestart = -Infinity;
  private timing: { heard: number; stt?: number; firstToken?: number; firstAudio?: number } | undefined;

  constructor(
    worker: VoiceWorker,
    brain: Brain,
    send: (m: VoiceServerMessage) => void,
    now: () => number = Date.now,
    log: (line: string) => void = () => {},
    opts: { bargeIn?: boolean } = {},
  ) {
    this.worker = worker;
    this.brain = brain;
    this.send = send;
    this.now = now;
    this.log = log;
    this.bargeIn = opts.bargeIn ?? true;
  }

  async start(): Promise<void> {
    if (this.state !== 'off') return;
    this.stopController = new AbortController();
    this.worker.on('event', this.listener);
    await this.boot();
  }

  stop(): void {
    if (this.state === 'off') return;
    this.stopController.abort();
    this.mute();
    this.worker.off('event', this.listener);
    this.worker.command({ cmd: 'sleep' });
    this.send({ type: 'stop-audio' });
    this.setState('off');
  }

  audio(pcm: Buffer): void {
    if (this.state !== 'off' && this.state !== 'preparing') this.worker.sendAudio(pcm);
  }

  client(msg: VoiceClientMessage): void {
    switch (msg.type) {
      case 'start':
        void this.start();
        return;
      case 'stop':
        return this.stop();
      case 'interrupt':
        if (this.state === 'thinking' || this.state === 'speaking') this.interrupt();
        return;
      case 'played':
        this.pending.delete(msg.id);
        return this.maybeFinish();
    }
  }

  private async boot(detail?: string): Promise<void> {
    this.setState('preparing', detail);
    try {
      await this.worker.ensureReady();
    } catch (err) {
      this.send({ type: 'error', message: String((err as Error)?.message ?? err) });
      this.worker.off('event', this.listener);
      this.setState('off');
      return;
    }
    if (this.state !== 'preparing') return;
    this.setState('sleeping');
    this.worker.command({ cmd: 'sleep' });
    this.brain.warm?.();
  }

  private onWorker(e: WorkerEvent): void {
    if (this.state === 'off') return;
    switch (e.event) {
      case 'status':
        if (this.state === 'preparing') this.setState('preparing', e.message);
        return;
      case 'wake':
        if (this.state === 'sleeping') {
          this.setState('listening');
          this.send({ type: 'chime' });
          this.worker.command({ cmd: 'listen' });
        } else if (this.state === 'thinking' || this.state === 'speaking') {
          this.interrupt();
        }
        return;
      case 'speech-start':
        // O usuario comecou a falar por cima do Jarvis.
        if (this.state === 'speaking' || this.state === 'thinking') this.interrupt(false);
        return;
      case 'partial':
        if (this.state === 'listening' && e.text.trim()) this.send({ type: 'caption', who: 'user', text: e.text.trim() });
        return;
      case 'transcript': {
        const text = e.text.trim();
        if (this.state !== 'listening' || !text) return;
        this.timing = { heard: this.now(), stt: e.ms };
        this.send({ type: 'caption', who: 'user', text });
        this.farewell = isGoodbye(text);
        this.ask(text);
        return;
      }
      case 'audio':
        if (!this.pending.has(e.id)) return;
        if (this.timing && this.timing.firstAudio === undefined) {
          this.timing.firstAudio = this.now();
          this.logTiming();
        }
        this.send({ type: 'audio', id: e.id, data: e.data, last: e.last });
        return;
      case 'speak-error':
        if (this.pending.delete(e.id)) {
          this.send({ type: 'error', message: `Não consegui gerar a voz agora (${e.message}); a resposta está na legenda.` });
          this.maybeFinish();
        }
        return;
      case 'error':
        this.send({ type: 'error', message: e.message });
        if (e.fatal) this.stop();
        return;
      case 'exit':
        return this.onExit();
    }
  }

  private onExit(): void {
    this.mute();
    this.send({ type: 'stop-audio' });
    if (this.now() - this.lastRestart < RESTART_WINDOW_MS) {
      this.send({ type: 'error', message: 'O worker de voz parou de novo; a escuta foi desligada. Veja o log do servidor.' });
      this.worker.off('event', this.listener);
      this.setState('off');
      return;
    }
    this.lastRestart = this.now();
    void this.boot('reiniciando a voz');
  }

  /** Nova pergunta: ela passa a ser a que fala; roda depois das anteriores. */
  private ask(text: string): void {
    const turn = ++this.turn;
    this.brainDone = false;
    this.setState('thinking');
    this.chain = this.chain.then(() => this.think(text, turn)).catch(() => {});
  }

  private async think(text: string, turn: number): Promise<void> {
    const splitter = new SentenceSplitter();
    let said = '';
    const live = () => turn === this.turn && this.state !== 'off';
    try {
      for await (const delta of this.brain.reply(text, this.stopController.signal)) {
        if (!live()) continue; // calada: segue ate o fim, em background
        if (this.timing && this.timing.firstToken === undefined) this.timing.firstToken = this.now();
        said += delta;
        this.send({ type: 'caption', who: 'jarvis', text: said });
        for (const sentence of splitter.push(delta)) this.speak(sentence);
      }
      if (!live()) return;
      const rest = splitter.flush();
      if (rest) this.speak(rest);
    } catch (err) {
      if (!live()) return;
      this.send({ type: 'caption', who: 'jarvis', text: `Erro: ${String((err as Error)?.message ?? err)}` });
      this.send({ type: 'error', message: 'Tive um problema para responder; o detalhe está na legenda.' });
    } finally {
      if (turn === this.turn) {
        this.brainDone = true;
        this.maybeFinish();
      }
    }
  }

  private logTiming(): void {
    const t = this.timing;
    if (!t) return;
    const since = (v?: number) => (v === undefined ? '?' : `${v - t.heard} ms`);
    this.log(`latência: transcrição ${t.stt ?? '?'} ms · 1º token ${since(t.firstToken)} · 1º áudio ${since(t.firstAudio)}`);
  }

  private speak(text: string): void {
    const clean = stripMarkdown(text);
    if (!clean) return;
    if (this.state !== 'speaking') {
      this.setState('speaking');
      // Falando, o worker continua ouvindo (mais exigente) para o usuario poder interromper.
      this.worker.command(this.bargeIn ? { cmd: 'listen', barge: true } : { cmd: 'sleep' });
    }
    const id = ++this.nextSpeech;
    this.pending.add(id);
    this.worker.command({ cmd: 'speak', id, text: clean });
  }

  private maybeFinish(): void {
    if ((this.state !== 'speaking' && this.state !== 'thinking') || !this.brainDone || this.pending.size) return;
    if (this.farewell) {
      this.farewell = false;
      this.setState('sleeping');
      this.worker.command({ cmd: 'sleep' });
    } else {
      this.setState('listening');
      this.worker.command({ cmd: 'listen' });
    }
  }

  /** Cala o Jarvis e volta a ouvir; `restartListening`: falso quando o usuario ja esta falando. */
  private interrupt(restartListening = true): void {
    this.mute();
    this.send({ type: 'stop-audio' });
    this.setState('listening');
    if (restartListening) this.worker.command({ cmd: 'listen' });
  }

  /** A resposta atual deixa de falar (mas continua rodando) e a voz pendente e descartada. */
  private mute(): void {
    this.turn++;
    this.brainDone = true;
    this.farewell = false;
    if (this.pending.size) {
      this.pending.clear();
      this.worker.command({ cmd: 'cancel' });
    }
  }

  private setState(state: VoiceState, detail?: string): void {
    this.state = state;
    this.send(detail ? { type: 'state', state, detail } : { type: 'state', state });
  }
}
