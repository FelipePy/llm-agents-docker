import type { VoiceClientMessage, VoiceServerMessage, VoiceState } from '../types.ts';
import type { Brain } from './brain.ts';
import { SentenceSplitter, isGoodbye, stripMarkdown } from './text.ts';

export type WorkerCommand = { cmd: 'listen' } | { cmd: 'sleep' } | { cmd: 'cancel' } | { cmd: 'speak'; id: number; text: string };

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
 * ate a despedida. Silencio nao encerra. Ver a tabela de estados no spec.
 */
export class VoiceSession {
  state: VoiceState = 'off';
  private readonly worker: VoiceWorker;
  private readonly brain: Brain;
  private readonly send: (m: VoiceServerMessage) => void;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  /** Marcas de tempo da fala atual, para o log de latencia. */
  private timing: { heard: number; stt?: number; firstToken?: number; firstAudio?: number } | undefined;
  private readonly listener = (e: WorkerEvent) => this.onWorker(e);
  private abort: AbortController | undefined;
  private pending = new Set<number>();
  private nextSpeech = 0;
  private brainDone = true;
  private farewell = false;
  private lastRestart = -Infinity;

  constructor(
    worker: VoiceWorker,
    brain: Brain,
    send: (m: VoiceServerMessage) => void,
    now: () => number = Date.now,
    log: (line: string) => void = () => {},
  ) {
    this.log = log;
    this.worker = worker;
    this.brain = brain;
    this.send = send;
    this.now = now;
  }

  async start(): Promise<void> {
    if (this.state !== 'off') return;
    this.worker.on('event', this.listener);
    await this.boot();
  }

  stop(): void {
    if (this.state === 'off') return;
    this.cancelTurn();
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
      case 'partial':
        // Legenda ao vivo enquanto o usuario ainda fala.
        if (this.state === 'listening' && e.text.trim()) this.send({ type: 'caption', who: 'user', text: e.text.trim() });
        return;
      case 'transcript': {
        const text = e.text.trim();
        if (this.state !== 'listening' || !text) return;
        this.timing = { heard: this.now(), stt: e.ms };
        this.send({ type: 'caption', who: 'user', text });
        if (isGoodbye(text)) {
          this.farewell = true;
          this.brainDone = true;
          this.speak('Até mais!');
        } else {
          void this.think(text);
        }
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
    this.cancelTurn();
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

  private async think(text: string): Promise<void> {
    this.setState('thinking');
    this.brainDone = false;
    const abort = new AbortController();
    this.abort = abort;
    const splitter = new SentenceSplitter();
    let said = '';
    try {
      for await (const delta of this.brain.reply(text, abort.signal)) {
        if (abort.signal.aborted) return;
        if (this.timing && this.timing.firstToken === undefined) this.timing.firstToken = this.now();
        said += delta;
        this.send({ type: 'caption', who: 'jarvis', text: said });
        for (const sentence of splitter.push(delta)) this.speak(sentence);
      }
      if (abort.signal.aborted) return;
      const rest = splitter.flush();
      if (rest) this.speak(rest);
    } catch (err) {
      if (abort.signal.aborted) return;
      this.send({ type: 'caption', who: 'jarvis', text: `Erro: ${String((err as Error)?.message ?? err)}` });
      this.speak('Tive um problema para responder agora.');
    } finally {
      if (this.abort === abort) {
        this.abort = undefined;
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
      // Enquanto fala, o worker so procura a palavra de ativacao (para interromper).
      this.worker.command({ cmd: 'sleep' });
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

  private interrupt(): void {
    this.cancelTurn();
    this.send({ type: 'stop-audio' });
    this.setState('listening');
    this.worker.command({ cmd: 'listen' });
  }

  private cancelTurn(): void {
    this.abort?.abort();
    this.abort = undefined;
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
