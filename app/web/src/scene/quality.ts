export interface Quality {
  bloom: boolean;
  /** Passos do ray marching do buraco negro. */
  steps: number;
  lowStreak: number;
}

export const HIGH_QUALITY: Quality = { bloom: true, steps: 220, lowStreak: 0 };
export const LOW_STEPS = 90;

/**
 * Recebe uma amostra de FPS por segundo. Tres amostras seguidas abaixo de 30
 * desligam o bloom; mais tres reduzem os passos do shader. Nunca volta a subir.
 * Devolve o mesmo objeto quando nada muda (evita re-render).
 */
export function nextQuality(q: Quality, fps: number): Quality {
  const lowStreak = fps < 30 ? q.lowStreak + 1 : 0;
  if (lowStreak < 3) return lowStreak === q.lowStreak ? q : { ...q, lowStreak };
  if (q.bloom) return { ...q, bloom: false, lowStreak: 0 };
  if (q.steps > LOW_STEPS) return { ...q, steps: LOW_STEPS, lowStreak: 0 };
  return q.lowStreak === 0 ? q : { ...q, lowStreak: 0 };
}
