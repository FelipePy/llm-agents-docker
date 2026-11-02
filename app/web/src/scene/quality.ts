export interface Quality {
  bloom: boolean;
  /** Segmentos das esferas de protons e neutrons. */
  detail: number;
  lowStreak: number;
}

export const HIGH_QUALITY: Quality = { bloom: true, detail: 32, lowStreak: 0 };
export const LOW_DETAIL = 14;

/**
 * Recebe uma amostra de FPS por segundo. Tres amostras seguidas abaixo de 30
 * desligam o bloom; mais tres reduzem a malha. Nunca volta a subir.
 * Devolve o mesmo objeto quando nada muda (evita re-render).
 */
export function nextQuality(q: Quality, fps: number): Quality {
  const lowStreak = fps < 30 ? q.lowStreak + 1 : 0;
  if (lowStreak < 3) return lowStreak === q.lowStreak ? q : { ...q, lowStreak };
  if (q.bloom) return { ...q, bloom: false, lowStreak: 0 };
  if (q.detail > LOW_DETAIL) return { ...q, detail: LOW_DETAIL, lowStreak: 0 };
  return q.lowStreak === 0 ? q : { ...q, lowStreak: 0 };
}
