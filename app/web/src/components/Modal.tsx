import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)';

/** O que o Tab alcanca: um grupo recolhido continua no DOM, mas nao recebe foco. */
export function focusableIn(root: Pick<ParentNode, 'querySelectorAll'>): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
}

/** Para onde o Tab deve pular para nao sair do modal; null deixa o navegador seguir a ordem normal. */
export function wrapFocus<T>(items: T[], active: unknown, back: boolean): T | null {
  if (!items.length) return null;
  if (back && (active === items[0] || !items.includes(active as T))) return items[items.length - 1];
  if (!back && active === items[items.length - 1]) return items[0];
  return null;
}

interface Props {
  open: boolean;
  /** Nome do modal para leitores de tela. */
  label: string;
  /** Mais largo, para conteudo em colunas. */
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Janela flutuante no centro da tela. Fechado, o conteudo continua montado e so fica
 * escondido. O Esc fica em App.tsx, junto com os outros atalhos.
 */
export function Modal({ open, label, wide, onClose, children }: Props) {
  const box = useRef<HTMLDivElement>(null);

  // O foco entra no modal (senao o que se digita iria para o terminal atras) e volta ao fechar.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    box.current?.focus();
    return () => {
      // Sem roubar o foco de quem o pegou enquanto o modal fechava, como a busca (Ctrl+K).
      const now = document.activeElement;
      const free = !now || now === document.body || box.current?.contains(now);
      if (free && previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !box.current) return;
    const target = wrapFocus(focusableIn(box.current), document.activeElement, e.shiftKey);
    if (!target) return;
    e.preventDefault();
    target.focus();
  };

  return (
    // mousedown: arrastar uma selecao de dentro para fora do modal nao o fecha.
    <div className="modal-overlay" hidden={!open} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={onKeyDown}>
        <button className="modal-close" onClick={onClose} aria-label="Fechar">
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
