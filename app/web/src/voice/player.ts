import { rmsLevel } from './pcm.ts';

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Toca as frases do Jarvis em ordem e mede o volume para o nucleo. */
export class Player {
  private readonly ctx = new AudioContext();
  private readonly analyser: AnalyserNode;
  private readonly samples: Float32Array<ArrayBuffer>;
  private readonly onPlayed: (id: number) => void;
  private queue: Promise<void> = Promise.resolve();
  private current: AudioBufferSourceNode | undefined;
  private epoch = 0;

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

  enqueue(id: number, base64Mp3: string): void {
    const epoch = this.epoch;
    const decoded = this.ctx.decodeAudioData(base64ToArrayBuffer(base64Mp3));
    this.queue = this.queue.then(async () => {
      let buffer: AudioBuffer;
      try {
        buffer = await decoded;
      } catch {
        if (epoch === this.epoch) this.onPlayed(id);
        return;
      }
      if (epoch !== this.epoch) return;
      await new Promise<void>((resolve) => {
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(this.analyser);
        src.onended = () => resolve();
        this.current = src;
        src.start();
      });
      this.current = undefined;
      if (epoch === this.epoch) this.onPlayed(id);
    });
  }

  /** Corta a fala atual e descarta a fila. */
  stop(): void {
    this.epoch++;
    try {
      this.current?.stop();
    } catch {
      // ja parado
    }
    this.current = undefined;
    this.queue = Promise.resolve();
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
