import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { arcPositions, pageSizeFor, paginate, CARD_SPACING, type RingItem } from '../ring.ts';

interface Props {
  /** Todos os itens do nivel (ja filtrados); a paginacao e feita aqui. */
  items: RingItem[];
  page: number;
  /** Muda a cada nivel/pagina para refazer a animacao de entrada. */
  animationKey: string;
  loading: boolean;
  onPage: (delta: 1 | -1) => void;
  onActivate: (item: RingItem) => void;
}

/** Centro do atomo: 38% da largura da area central (ver .galaxy no CSS). */
const CENTER_X = 0.38;

/** Coluna de cartoes em arco a direita do nucleo, de cima para baixo. */
export function Ring({ items, page, animationKey, loading, onPage, onActivate }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ry = Math.min(size.h * 0.42, 380);
  const rx = Math.min(size.w * 0.2, 300);
  const shown = paginate(items, page, pageSizeFor(ry));
  const positions = arcPositions(shown.items.length, rx, ry);
  const cx = size.w * CENTER_X;
  const lastY = positions.length ? positions[positions.length - 1].y : 0;

  return (
    <div className="ring" ref={ref}>
      <div key={animationKey}>
        {shown.items.map((item, i) => (
          <button
            key={item.key}
            className={`ring-card tone-${item.tone}`}
            style={{ left: cx, '--x': `${positions[i].x}px`, '--y': `${positions[i].y}px`, animationDelay: `${i * 25}ms` } as CSSProperties}
            disabled={!item.action}
            title={item.subtitle ? `${item.title}\n${item.subtitle}` : item.title}
            onClick={() => onActivate(item)}
          >
            <span className={item.live ? 'card-dot live' : 'card-dot'} />
            <span className="card-title">{item.title}</span>
            {item.badge && <span className="card-badge">{item.badge}</span>}
          </button>
        ))}
      </div>
      {loading && <div className="ring-status">Carregando…</div>}
      {!loading && !items.length && <div className="ring-status">Nada por aqui.</div>}
      {shown.pages > 1 && (
        <div className="ring-pager" style={{ left: cx + rx * 0.6, top: `calc(50% + ${lastY + CARD_SPACING}px)` }}>
          <button onClick={() => onPage(-1)} disabled={shown.page === 0} aria-label="Página anterior">
            ‹
          </button>
          <span>
            {shown.page + 1} / {shown.pages}
          </span>
          <button onClick={() => onPage(1)} disabled={shown.page === shown.pages - 1} aria-label="Próxima página">
            ›
          </button>
        </div>
      )}
    </div>
  );
}
