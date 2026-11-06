export type TopModal = 'day' | 'settings';

interface Props {
  /** Texto do filtro; null quando o nivel atual nao tem o que filtrar. */
  filter: string | null;
  onFilter: (value: string) => void;
  onOpen: (modal: TopModal) => void;
}

/** Jornal: pagina dobrada com manchete, foto e colunas, em traco como os outros icones. */
function NewsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z" />
      <path d="M17 8h3v10.5a1.5 1.5 0 0 1-1.5 1.5" />
      <path d="M7 8h7M7 11.5h3v3H7zM12.5 11.5H14M12.5 14.5H14M7 17h7" />
    </svg>
  );
}

/** Canto direito do topo (modo 3D): filtro, notícias e configurações. */
export function TopActions({ filter, onFilter, onOpen }: Props) {
  return (
    <div className="top-actions">
      {filter !== null && <input placeholder="Filtrar" value={filter} onChange={(e) => onFilter(e.target.value)} />}
      <button className="top-action" onClick={() => onOpen('day')} aria-label="Notícias" aria-haspopup="dialog" title="Hora, clima e notícias">
        <NewsIcon />
      </button>
      <button className="top-action gear" onClick={() => onOpen('settings')} aria-label="Configurações" aria-haspopup="dialog" title="Configurações">
        ⚙&#xFE0E;
      </button>
    </div>
  );
}
