import { describe, expect, it } from 'vitest';
import { EchoGate } from '../src/voice/echo.ts';

/** Alimenta `n` quadros e diz se algum foi detectado como o usuario. */
function run(gate: EchoGate, n: number, mic: number, out: number): boolean {
  let hit = false;
  for (let i = 0; i < n; i++) hit = gate.feed(mic, out) || hit;
  return hit;
}

describe('EchoGate', () => {
  it('o eco da propria voz (proporcional a saida) nunca conta como o usuario', () => {
    const gate = new EchoGate();
    // Eco forte (sem cancelamento de eco), variando com a fala do Jarvis.
    for (let i = 0; i < 200; i++) {
      const out = 0.1 + 0.08 * Math.sin(i / 3);
      expect(gate.feed(out * 0.5 * (0.9 + 0.2 * ((i * 7) % 10) / 10), out)).toBe(false);
    }
  });

  it('o usuario falando por cima (bem acima do eco previsto) e detectado em ~240 ms', () => {
    const gate = new EchoGate();
    run(gate, 20, 0.02, 0.1); // aprende: eco ~0,2 da saida
    expect(gate.feed(0.15, 0.1)).toBe(false);
    expect(gate.feed(0.15, 0.1)).toBe(false);
    expect(gate.feed(0.15, 0.1)).toBe(true);
  });

  it('um pico curto (tosse, clique) nao basta', () => {
    const gate = new EchoGate();
    run(gate, 20, 0.02, 0.1);
    expect(gate.feed(0.3, 0.1)).toBe(false);
    expect(gate.feed(0.02, 0.1)).toBe(false);
    expect(gate.feed(0.3, 0.1)).toBe(false);
  });

  it('antes de aprender o eco, so decide nas pausas da fala do Jarvis', () => {
    const gate = new EchoGate();
    expect(run(gate, 4, 0.3, 0.1)).toBe(false);
    expect(run(new EchoGate(), 4, 0.05, 0)).toBe(true);
  });

  it('ruido de fundo baixo nao conta', () => {
    expect(run(new EchoGate(), 10, 0.005, 0)).toBe(false);
  });
});
