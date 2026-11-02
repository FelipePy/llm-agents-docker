// Dinamica do nucleo (atomo). A etapa 3 alimenta CoreSignal com a voz real.

export type CoreMode = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface CoreSignal {
  mode: CoreMode;
  /** Volume da voz do agente, de 0 a 1 (so conta em "speaking"). */
  level: number;
}

export const MODE_LABEL: Record<CoreMode, string> = {
  idle: 'aguardando',
  listening: 'ouvindo',
  thinking: 'pensando',
  speaking: 'falando',
};

export const MODE_COLORS: Record<CoreMode, { core: string; hot: string; ring: string }> = {
  idle: { core: '#4f8cff', hot: '#cfe0ff', ring: '#3a5a9a' },
  listening: { core: '#3fd5ff', hot: '#d9f8ff', ring: '#3fd5ff' },
  thinking: { core: '#9b6bff', hot: '#eadfff', ring: '#9b6bff' },
  speaking: { core: '#6aa8ff', hot: '#ffffff', ring: '#8ab4ff' },
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Suavizacao exponencial: sobe rapido (ataque) e desce devagar (soltura). */
export function smoothLevel(prev: number, target: number, dt: number): number {
  const rate = target > prev ? 18 : 5;
  const k = 1 - Math.exp(-rate * dt);
  return clamp01(prev + (target - prev) * k);
}

/** Velocidade angular dos eletrons (rad/s). */
export function electronSpeed(mode: CoreMode, level: number): number {
  switch (mode) {
    case 'idle':
      return 0.5;
    case 'listening':
      return 0.9;
    case 'thinking':
      return 3.2;
    case 'speaking':
      return 1.1 + 1.8 * clamp01(level);
  }
}

/** Envelope sintetico parecido com fala: silabas dentro de palavras, com pausas. */
export function speechEnvelope(t: number): number {
  const syllables = Math.abs(Math.sin(t * 7.3)) * 0.65 + Math.abs(Math.sin(t * 2.1 + 1)) * 0.35;
  const words = Math.sin(t * 1.7) > -0.35 ? 1 : 0.1;
  return clamp01(syllables * words);
}

const DEMO: [CoreMode, number][] = [
  ['idle', 4],
  ['listening', 3],
  ['thinking', 2],
  ['speaking', 7],
];

/** Ciclo de 16 s pelos estados, para avaliar o nucleo antes da voz real. */
export function demoSignal(t: number): CoreSignal {
  let x = ((t % 16) + 16) % 16;
  for (const [mode, duration] of DEMO) {
    if (x < duration) return { mode, level: mode === 'speaking' ? speechEnvelope(t) : 0 };
    x -= duration;
  }
  return { mode: 'idle', level: 0 };
}
