import { useEffect, useRef, useState, type ReactNode } from 'react';
import { copyText, selectionIn } from '../clipboard.ts';

type Feedback = 'copied' | 'failed' | null;

/**
 * Secao de painel com um botao de copiar o trecho selecionado, discreto, no canto superior direito.
 * So aparece com texto selecionado dentro da secao; nao copia a secao inteira.
 */
export function CopySection({ className = 'panel', children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  useEffect(() => {
    const update = () => setSelected(selectionIn(ref.current, document.getSelection()));
    document.addEventListener('selectionchange', update);
    return () => document.removeEventListener('selectionchange', update);
  }, []);
  useEffect(() => {
    if (!feedback) return;
    const id = setTimeout(() => setFeedback(null), feedback === 'copied' ? 1500 : 3000);
    return () => clearTimeout(id);
  }, [feedback]);
  const copy = async () => setFeedback((await copyText(selected)) ? 'copied' : 'failed');
  return (
    <section ref={ref} className={`${className} copy-section`}>
      {(selected || feedback) && (
        <CopyButton feedback={feedback} onCopy={() => void copy()} />
      )}
      {children}
    </section>
  );
}

export function CopyButton({ feedback, onCopy }: { feedback: Feedback; onCopy: () => void }) {
  const label = feedback === 'copied' ? 'Copiado' : feedback === 'failed' ? 'Não consegui copiar' : 'Copiar seleção';
  return (
    <button
      className={`copy-selection${feedback ? ` ${feedback}` : ''}`}
      title={label}
      aria-label={label}
      // Sem roubar o foco: a selecao continua la.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onCopy}
    >
      {feedback === 'copied' ? '✓' : feedback === 'failed' ? '!' : (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      )}
      {feedback && <span className="copy-feedback" role="status">{label}</span>}
    </button>
  );
}
