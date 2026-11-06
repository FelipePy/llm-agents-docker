import { useEffect, useRef } from 'react';
import { waveBars, type WavePlace } from '../voice/hold.ts';

const BARS = 31;
/** Sobe rapido com a voz e desce devagar (o volume so muda a cada quadro de 80 ms). */
const RISE = 0.5;
const FALL = 0.14;

/** Onda sonora ao segurar o atalho ou na escuta continua; acompanha o volume captado. */
export function HoldWave({ level, reduced, label, place }: { level: () => number; reduced: boolean; label: string; place: WavePlace }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bars = Array.from(root.current?.children ?? []) as HTMLElement[];
    let current = 0;
    let frame = 0;
    const tick = (now: number) => {
      const target = level();
      current += (target - current) * (target > current ? RISE : FALL);
      waveBars(current, now / 1000, BARS, reduced).forEach((h, i) => {
        bars[i].style.transform = `scaleY(${h.toFixed(3)})`;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [level, reduced]);

  return (
    <div className={`hold-wave ${place}`.trim()} ref={root} role="status" aria-label={label}>
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}
