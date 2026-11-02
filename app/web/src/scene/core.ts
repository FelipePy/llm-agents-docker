// Dinamica do nucleo (atomo). A etapa 3 alimenta CoreSignal com a voz real.
// A voz vira "calor": frio = parado; quente = particulas e orbitas agitadas.

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

export const PROTON_COLOR = '#ffbf3c';
export const NEUTRON_COLOR = '#f3e2b0';

export const MODE_COLORS: Record<CoreMode, { ring: string; electron: string }> = {
  idle: { ring: '#b8913a', electron: '#ffe7a3' },
  listening: { ring: '#ffd36b', electron: '#fff3c4' },
  thinking: { ring: '#ffb347', electron: '#ffe0a8' },
  speaking: { ring: '#ffc94a', electron: '#fff6d6' },
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Calor alvo de cada estado (0 = frio, 1 = muito quente). */
export function targetHeat(mode: CoreMode, level: number): number {
  switch (mode) {
    case 'idle':
      return 0.05;
    case 'listening':
      return 0.2;
    case 'thinking':
      return 0.5;
    case 'speaking':
      return 0.3 + 0.7 * clamp01(level);
  }
}

/** Esquenta rapido e esfria devagar. */
export function smoothHeat(prev: number, target: number, dt: number): number {
  const rate = target > prev ? 14 : 2.5;
  const k = 1 - Math.exp(-rate * dt);
  return clamp01(prev + (target - prev) * k);
}

/** Velocidade angular dos eletrons (rad/s). */
export const electronSpeed = (heat: number): number => 0.35 + 4.2 * heat;

/** Amplitude da vibracao de protons e neutrons (unidades da cena). */
export const jitterAmplitude = (heat: number): number => 0.006 + 0.2 * heat * heat + 0.04 * heat;

/** Deformacao relativa das orbitas. */
export const wobble = (heat: number): number => 0.004 + 0.16 * heat;

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
