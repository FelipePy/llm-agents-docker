import { useEffect, useRef, useState } from 'react';
import { DEFAULT_HOTKEY, HotkeyCapture, sameHotkey, type Hotkey } from '../voice/hotkey.ts';

interface Props {
  hotkey: Hotkey;
  onChange: (h: Hotkey) => void;
  /** Enquanto espera a combinacao, os atalhos do app nao podem reagir as teclas. */
  onCapturing: (on: boolean) => void;
}

/** Atalho de falar: mostra o atual, captura outro direto do teclado e volta ao padrao. */
export function HotkeyField({ hotkey, onChange, onCapturing }: Props) {
  const [capturing, setCapturing] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!capturing) return;
    const stop = () => setCapturing(false);
    const capture = new HotkeyCapture(onChange, stop);
    const consume = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const down = (e: KeyboardEvent) => {
      consume(e);
      capture.keydown(e);
    };
    const up = (e: KeyboardEvent) => {
      consume(e);
      capture.keyup(e);
    };
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) stop();
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', stop);
    window.addEventListener('pointerdown', outside, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', stop);
      window.removeEventListener('pointerdown', outside, true);
      onCapturing(false);
      // Com o foco no botao, Espaco (o atalho antigo, por habito) abriria outra captura.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && root.current?.contains(focused)) focused.blur();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  return (
    <div className="field hotkey-field" ref={root} title="Combinação que você segura para falar com o Jarvis">
      <span>Atalho para falar</span>
      <div className="hotkey-row">
        <kbd className={capturing ? 'hotkey-current capturing' : 'hotkey-current'} aria-live="polite">
          {capturing ? 'Aperte a combinação…' : hotkey.label}
        </kbd>
        <button
          onClick={() => {
            // Junto com a tela: entre o clique e a captura, nenhum atalho pode reagir.
            if (!capturing) onCapturing(true);
            setCapturing(!capturing);
          }}
        >
          {capturing ? 'Cancelar' : 'Redefinir'}
        </button>
      </div>
      <button
        className="link"
        disabled={sameHotkey(hotkey, DEFAULT_HOTKEY)}
        onClick={() => {
          setCapturing(false);
          onChange(DEFAULT_HOTKEY);
        }}
      >
        Voltar ao padrão ({DEFAULT_HOTKEY.label})
      </button>
    </div>
  );
}
