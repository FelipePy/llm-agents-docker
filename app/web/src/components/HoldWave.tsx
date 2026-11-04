import { useEffect, useRef } from 'react';
import { waveBars } from '../voice/hold.ts';

const BARS = 31;
/** Sobe rapido com a voz e desce devagar (o volume so muda a cada quadro de 80 ms). */
const RISE = 0.5;
const FALL = 0.14;

/** Onda sonora enquanto o usuario segura o atalho; acompanha o volume captado. */
export function HoldWave({ level, reduced }: { level: () => number; reduced: boolean }) {
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
    <div className="hold-wave" ref={root} role="status" aria-label="Ouvindo; solte Ctrl+Espaço para o Jarvis responder">
      {Array.from({ length: BARS }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}
