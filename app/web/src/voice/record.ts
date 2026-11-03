import { startCapture } from './capture.ts';

/** Gravacao maxima de uma frase do cadastro da voz. */
export const MAX_RECORD_S = 12;
/** Menos que isso nao da para reconhecer a voz. */
export const MIN_RECORD_S = 1.5;
const RATE = 16000;

/** PCM 16 bits (little-endian) em base64, o formato que o servidor espera. */
export function pcmBase64(frames: Int16Array[]): string {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const bytes = new Uint8Array(total * 2);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const f of frames) for (const s of f) (view.setInt16(offset, s, true), (offset += 2));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const seconds = (frames: Int16Array[]): number => frames.reduce((n, f) => n + f.length, 0) / RATE;

/**
 * Grava uma frase do microfone (16 kHz). Para sozinha em MAX_RECORD_S;
 * `stop` devolve o audio em base64. `onTick` recebe os segundos gravados.
 */
export async function recordPhrase(onTick: (s: number) => void, onAutoStop: () => void): Promise<{ stop(): string; cancel(): void }> {
  const frames: Int16Array[] = [];
  let stopped = false;
  const stopCapture = await startCapture((pcm) => {
    if (stopped) return;
    frames.push(pcm.slice());
    const s = seconds(frames);
    onTick(s);
    if (s >= MAX_RECORD_S) onAutoStop();
  });
  const end = () => {
    if (!stopped) stopCapture();
    stopped = true;
  };
  return {
    stop: () => {
      end();
      return pcmBase64(frames);
    },
    cancel: end,
  };
}
