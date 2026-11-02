import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ringPositions, type RingItem } from '../ring.ts';

interface Props {
  items: RingItem[];
  page: number;
  pages: number;
  /** Muda a cada nivel/pagina para refazer a animacao de entrada. */
  animationKey: string;
  loading: boolean;
  onPage: (delta: 1 | -1) => void;
  onActivate: (item: RingItem) => void;
}

/** Cartoes dispostos numa elipse em volta do nucleo. */
export function Ring({ items, page, pages, animationKey, loading, onPage, onActivate }: Props) {
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

  const positions = ringPositions(items.length, Math.min(size.w * 0.36, 560), Math.min(size.h * 0.36, 320));
  return (
    <div className="ring" ref={ref}>
      <div key={animationKey}>
        {items.map((item, i) => (
          <button
            key={item.key}
            className={`ring-card tone-${item.tone}`}
            style={{ '--x': `${positions[i].x}px`, '--y': `${positions[i].y}px`, animationDelay: `${i * 30}ms` } as CSSProperties}
            disabled={!item.action}
            title={item.subtitle ? `${item.title} — ${item.subtitle}` : item.title}
            onClick={() => onActivate(item)}
          >
            <span className={item.live ? 'card-dot live' : 'card-dot'} />
            <span className="card-text">
              <strong>{item.title}</strong>
              {item.subtitle && <small>{item.subtitle}</small>}
            </span>
            {item.badge && <span className="card-badge">{item.badge}</span>}
          </button>
        ))}
      </div>
      {loading && <div className="ring-status">Carregando…</div>}
      {!loading && !items.length && <div className="ring-status">Nada por aqui.</div>}
      {pages > 1 && (
        <>
          <button className="ring-page prev" onClick={() => onPage(-1)} disabled={page === 0} aria-label="Página anterior">
            ‹
          </button>
          <button className="ring-page next" onClick={() => onPage(1)} disabled={page === pages - 1} aria-label="Próxima página">
            ›
          </button>
          <div className="ring-status">
            página {page + 1} de {pages}
          </div>
        </>
      )}
    </div>
  );
}
