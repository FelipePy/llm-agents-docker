import { rmsLevel } from './pcm.ts';

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const STREAMING = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg');

/** Uma frase: o MP3 chega em pedacos e comeca a tocar com o primeiro. */
class Utterance {
  readonly id: number;
  readonly audio = new Audio();
  private readonly chunks: Uint8Array<ArrayBuffer>[] = [];
  private source: MediaSource | undefined;
  private buffer: SourceBuffer | undefined;
  private ended = false;
  private url = '';

  constructor(id: number) {
    this.id = id;
    if (STREAMING) {
      const source = new MediaSource();
      this.source = source;
      this.url = URL.createObjectURL(source);
      this.audio.src = this.url;
      source.addEventListener('sourceopen', () => {
        this.buffer = source.addSourceBuffer('audio/mpeg');
        this.buffer.addEventListener('updateend', () => this.pump());
        this.pump();
      });
    }
  }

  push(bytes: Uint8Array<ArrayBuffer>, last: boolean): void {
    if (bytes.length) this.chunks.push(bytes);
    if (last) this.ended = true;
    if (STREAMING) this.pump();
    else if (last) {
      // Sem MediaSource para MP3: toca quando a frase chegar inteira.
      this.url = URL.createObjectURL(new Blob(this.chunks, { type: 'audio/mpeg' }));
      this.audio.src = this.url;
    }
  }

  private pump(): void {
    const sb = this.buffer;
    if (!sb || sb.updating || this.source?.readyState !== 'open') return;
    const next = this.chunks.shift();
    if (next) sb.appendBuffer(next);
    else if (this.ended) this.source.endOfStream();
  }

  dispose(): void {
    this.audio.pause();
    this.audio.removeAttribute('src');
    if (this.url) URL.revokeObjectURL(this.url);
  }
}

/** Toca as frases do Jarvis em ordem, ja enquanto chegam, e mede o volume para o nucleo. */
export class Player {
  private readonly ctx = new AudioContext();
  private readonly analyser: AnalyserNode;
  private readonly samples: Float32Array<ArrayBuffer>;
  private readonly onPlayed: (id: number) => void;
  private readonly queue: Utterance[] = [];
  private readonly byId = new Map<number, Utterance>();
  private current: Utterance | undefined;

  constructor(onPlayed: (id: number) => void) {
    this.onPlayed = onPlayed;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.connect(this.ctx.destination);
    this.samples = new Float32Array(this.analyser.fftSize);
    // Sem gesto do usuario o navegador pode deixar o audio suspenso: retoma no proximo clique.
    if (this.ctx.state === 'suspended') {
      document.addEventListener('pointerdown', () => void this.ctx.resume(), { once: true });
    }
  }

  resume(): Promise<void> {
    return this.ctx.resume();
  }

  /** Pedaco de MP3 da frase `id`; `last` marca o fim dela. */
  append(id: number, base64Mp3: string, last: boolean): void {
    let u = this.byId.get(id);
    if (!u) {
      u = new Utterance(id);
      this.ctx.createMediaElementSource(u.audio).connect(this.analyser);
      this.byId.set(id, u);
      this.queue.push(u);
    }
    u.push(base64ToBytes(base64Mp3), last);
    if (!this.current) this.playNext();
  }

  private playNext(): void {
    const u = this.queue.shift();
    this.current = u;
    if (!u) return;
    const finish = () => {
      if (this.current !== u) return;
      this.byId.delete(u.id);
      u.dispose();
      this.onPlayed(u.id);
      this.playNext();
    };
    u.audio.onended = finish;
    u.audio.onerror = finish;
    void u.audio.play().catch(finish);
  }

  /** Corta a fala atual e descarta a fila. */
  stop(): void {
    const all = [...this.queue, ...(this.current ? [this.current] : [])];
    this.current = undefined;
    this.queue.length = 0;
    this.byId.clear();
    for (const u of all) u.dispose();
  }

  level(): number {
    this.analyser.getFloatTimeDomainData(this.samples);
    return rmsLevel(this.samples);
  }

  /** Som curto de ativacao. */
  chime(): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.linearRampToValueAtTime(990, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  close(): void {
    this.stop();
    void this.ctx.close();
  }
}
