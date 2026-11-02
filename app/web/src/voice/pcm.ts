// Conversao do audio do microfone para o formato do worker: 16 kHz, mono, PCM 16 bits.

/** Reamostragem por media, com estado entre pedacos (nao perde amostras). */
export class Resampler {
  private rest = new Float32Array(0);
  private readonly ratio: number;

  constructor(inRate: number, outRate = 16000) {
    this.ratio = inRate / outRate;
  }

  push(input: Float32Array): Float32Array {
    const buf = new Float32Array(this.rest.length + input.length);
    buf.set(this.rest);
    buf.set(input, this.rest.length);
    const n = Math.floor(buf.length / this.ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const start = Math.floor(i * this.ratio);
      const end = Math.max(start + 1, Math.floor((i + 1) * this.ratio));
      let sum = 0;
      for (let j = start; j < end; j++) sum += buf[j];
      out[i] = sum / (end - start);
    }
    this.rest = buf.slice(Math.floor(n * this.ratio));
    return out;
  }
}

export function toInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.floor(s * 0x7fff);
  }
  return out;
}

/** Junta amostras em quadros de tamanho fixo (80 ms = 1280 amostras). */
export class FrameBatcher {
  private buf: Int16Array;
  private used = 0;

  constructor(size = 1280) {
    this.buf = new Int16Array(size);
  }

  push(samples: Int16Array): Int16Array[] {
    const frames: Int16Array[] = [];
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(this.buf.length - this.used, samples.length - offset);
      this.buf.set(samples.subarray(offset, offset + take), this.used);
      this.used += take;
      offset += take;
      if (this.used === this.buf.length) {
        frames.push(this.buf);
        this.buf = new Int16Array(this.buf.length);
        this.used = 0;
      }
    }
    return frames;
  }
}

/** Nivel de 0 a 1 a partir das amostras (RMS com ganho, para a fala chegar perto de 1). */
export function rmsLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}
