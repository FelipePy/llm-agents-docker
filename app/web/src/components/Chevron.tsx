const PATHS = { left: 'M7.5 2.5 4 6l3.5 3.5', right: 'M4.5 2.5 8 6l-3.5 3.5', up: 'M2.5 7.5 6 4l3.5 3.5', down: 'M2.5 4.5 6 8l3.5-3.5' };

/** Seta dos controles da barra de abas: tracejada, para combinar entre si em qualquer fonte. */
export function Chevron({ direction }: { direction: keyof typeof PATHS }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[direction]} />
    </svg>
  );
}
