/** Tela de toque (celular): segurar o botao e o mesmo que segurar o atalho de falar. */
export function TalkButton({ holding, onPress, onRelease }: { holding: boolean; onPress: () => void; onRelease: () => void }) {
  return (
    <button
      className={holding ? 'talk-button holding' : 'talk-button'}
      aria-label="Segure para falar"
      title="Segure para falar"
      onPointerDown={(e) => {
        // Mantem o soltar neste botao mesmo se o dedo escorregar.
        e.currentTarget.setPointerCapture?.(e.pointerId);
        onPress();
      }}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    </button>
  );
}

/** Tela de toque sem mouse (celular, tablet). */
export const touchOnly = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
