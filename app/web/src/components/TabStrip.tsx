import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { SessionInfo } from '../types.ts';
import { revealScroll, tabLabels, tabName, type TabsState } from '../tabs.ts';
import { Chevron } from './Chevron.tsx';
import { TerminalTab } from './TerminalTab.tsx';

interface Props {
  tabs: TabsState;
  sessions: SessionInfo[];
  projectNames: Map<string, string>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  /** A lista fechou: o foco volta para o terminal. */
  onPickerClosed: () => void;
}

/** Barra de abas: encolhe ate o minimo, depois rola pelas setas ou pela roda do mouse; a lista mostra todas. */
export function TabStrip({ tabs, sessions, projectNames, onActivate, onClose, onPickerClosed }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [pickerOpen, setPickerOpen] = useState(false);
  const labels = tabLabels(sessions, projectNames);

  const updateEdges = () => {
    const el = listRef.current;
    if (!el) return;
    const left = el.scrollLeft > 0;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  };

  // Aba ativa sempre visivel, e as setas acompanham o espaco e as abas abertas ou fechadas.
  const revealActive = () => {
    const el = listRef.current;
    if (!el) return;
    const item = el.querySelector<HTMLElement>('.tab.active');
    if (item) el.scrollLeft = revealScroll(el.scrollLeft, el.clientWidth, item.offsetLeft, item.offsetWidth);
    updateEdges();
  };

  useEffect(() => {
    const observer = new ResizeObserver(revealActive);
    observer.observe(listRef.current!);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(revealActive, [tabs.active, sessions.length]);

  const page = (direction: 1 | -1) => {
    const el = listRef.current!;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const closePicker = () => {
    setPickerOpen(false);
    onPickerClosed();
  };

  return (
    <>
      {(edges.left || edges.right) && (
        <button className="tab-scroll" aria-label="Abas anteriores" disabled={!edges.left} onClick={() => page(-1)}>
          <Chevron direction="left" />
        </button>
      )}
      <div
        className="tab-list"
        ref={listRef}
        onScroll={updateEdges}
        onWheel={(e) => {
          e.currentTarget.scrollLeft += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        }}
      >
        {sessions.map((s) => (
          <TerminalTab
            key={s.id}
            session={s}
            label={labels.get(s.id) ?? s.title}
            projectName={projectNames.get(s.projectPath)}
            index={tabs.order.indexOf(s.id)}
            active={s.id === tabs.active}
            onActivate={() => onActivate(s.id)}
            onClose={() => onClose(s.id)}
          />
        ))}
      </div>
      {(edges.left || edges.right) && (
        <button className="tab-scroll" aria-label="Próximas abas" disabled={!edges.right} onClick={() => page(1)}>
          <Chevron direction="right" />
        </button>
      )}
      <button className="tab-menu" aria-label="Lista de terminais" title="Lista de terminais" aria-expanded={pickerOpen} onClick={() => (pickerOpen ? closePicker() : setPickerOpen(true))}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M1.5 3h9M1.5 6h9M1.5 9h9" />
        </svg>
        {sessions.length}
      </button>
      {pickerOpen && (
        <TabPicker
          sessions={sessions}
          labels={labels}
          projectNames={projectNames}
          active={tabs.active}
          onPick={(id) => {
            onActivate(id);
            closePicker();
          }}
          onDismiss={closePicker}
        />
      )}
    </>
  );
}

interface PickerProps {
  sessions: SessionInfo[];
  labels: Map<string, string>;
  projectNames: Map<string, string>;
  active: string | null;
  onPick: (id: string) => void;
  onDismiss: () => void;
}

function TabPicker({ sessions, labels, projectNames, active, onPick, onDismiss }: PickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const q = query.trim().toLowerCase();
  const rows = sessions
    .map((s) => ({ s, label: labels.get(s.id) ?? s.title, name: tabName(s, projectNames.get(s.projectPath)) }))
    .filter((r) => !q || `${r.label} ${r.name}`.toLowerCase().includes(q));

  // Clique fora fecha, menos no botao da lista (ele mesmo alterna).
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!ref.current?.contains(target) && !target.closest('.tab-menu')) onDismiss();
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [onDismiss]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onDismiss();
    else if (e.key === 'ArrowDown') setSelected((i) => Math.min(i + 1, rows.length - 1));
    else if (e.key === 'ArrowUp') setSelected((i) => Math.max(i - 1, 0));
    else if (e.key === 'Enter' && rows[selected]) onPick(rows[selected].s.id);
    else return;
    e.preventDefault();
  };

  return (
    <div className="tab-picker" ref={ref}>
      <input
        autoFocus
        placeholder="Buscar terminal"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
        }}
        onKeyDown={onKey}
      />
      <ul>
        {rows.map((r, i) => (
          <li
            key={r.s.id}
            className={[i === selected && 'selected', r.s.id === active && 'current', !r.s.alive && 'picker-ended'].filter(Boolean).join(' ')}
            title={r.name}
            onMouseEnter={() => setSelected(i)}
            onClick={() => onPick(r.s.id)}
          >
            <span className="picker-label">{r.label}</span>
            <span className="picker-name">{r.name}</span>
          </li>
        ))}
      </ul>
      {!rows.length && <div className="picker-empty">Nenhum terminal encontrado.</div>}
    </div>
  );
}
