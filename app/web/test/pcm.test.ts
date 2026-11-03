import { expect, it } from 'vitest';
import { FrameBatcher, Resampler, rmsLevel, toInt16 } from '../src/voice/pcm.ts';

it('Resampler reduz 48 kHz para 16 kHz entre pedacos, sem perder amostras', () => {
  const r = new Resampler(48000, 16000);
  let total = 0;
  for (let i = 0; i < 30; i++) {
    const out = r.push(new Float32Array(128).fill(0.5));
    total += out.length;
    for (const v of out) expect(v).toBeCloseTo(0.5);
  }
  expect(total).toBe(1280);
});

it('Resampler com a mesma taxa devolve o mesmo sinal', () => {
  expect([...new Resampler(16000, 16000).push(new Float32Array([0.1, 0.2]))].map((v) => +v.toFixed(3))).toEqual([0.1, 0.2]);
});

it('toInt16 converte e limita', () => {
  expect([...toInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]))]).toEqual([0, 32767, -32768, 32767, -32768, 16383]);
});

it('FrameBatcher entrega quadros de 1280 amostras', () => {
  const b = new FrameBatcher(1280);
  expect(b.push(new Int16Array(1000))).toEqual([]);
  const frames = b.push(new Int16Array(2000).fill(7));
  expect(frames.map((f) => f.length)).toEqual([1280, 1280]);
  expect(frames[1][0]).toBe(7);
  expect(b.push(new Int16Array(840)).length).toBe(1);
});

it('rmsLevel: silencio e 0, voz alta chega a 1', () => {
  expect(rmsLevel(new Float32Array(512))).toBe(0);
  const loud = Float32Array.from({ length: 512 }, (_, i) => Math.sin(i / 3));
  expect(rmsLevel(loud)).toBe(1);
  const soft = Float32Array.from({ length: 512 }, (_, i) => 0.05 * Math.sin(i / 3));
  expect(rmsLevel(soft)).toBeGreaterThan(0.05);
  expect(rmsLevel(soft)).toBeLessThan(0.3);
});

it('pcmBase64 junta os quadros em PCM 16 bits little-endian', async () => {
  const { pcmBase64, seconds } = await import('../src/voice/record.ts');
  const b64 = pcmBase64([new Int16Array([1, -2]), new Int16Array([0x1234])]);
  expect([...Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]).toEqual([1, 0, 0xfe, 0xff, 0x34, 0x12]);
  expect(seconds([new Int16Array(16000), new Int16Array(8000)])).toBe(1.5);
  expect(pcmBase64([new Int16Array(100_000)]).length).toBe(Math.ceil((200_000 / 3)) * 4);
});

it('frases do cadastro da voz: 4, sem "Jarvis" (a escuta ligada nao acorda ao gravar)', async () => {
  const { PHRASES } = await import('../src/components/VoiceProfileSettings.tsx');
  expect(PHRASES).toHaveLength(4);
  for (const p of PHRASES) expect(p.toLowerCase()).not.toContain('jarvis');
});
