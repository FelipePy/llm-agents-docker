import { useState } from 'react';
import type { Overview, SessionInfo, View } from '../types.ts';

interface Props {
  overview: Overview | null;
  view: View;
  sessions: SessionInfo[];
  onSelect: (v: View) => void;
}

export function Sidebar({ overview, view, sessions, onSelect }: Props) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const projects = (overview?.projects ?? []).filter((p) => p.name.toLowerCase().includes(q));
  const live = new Set(sessions.filter((s) => s.alive).map((s) => s.projectPath));
  const cls = (active: boolean) => (active ? 'nav active' : 'nav');
  return (
    <nav className="sidebar">
      <div className="brand">llm-agent</div>
      <button className={cls(view.kind === 'profile')} onClick={() => onSelect({ kind: 'profile' })}>
        Você
      </button>
      <button className={cls(view.kind === 'skills')} onClick={() => onSelect({ kind: 'skills' })}>
        Skills <span className="count">{overview?.skills.length ?? 0}</span>
      </button>
      <input className="filter" placeholder="Filtrar projetos" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <ul className="projects">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              className={cls(view.kind === 'project' && view.id === p.id)}
              title={p.path}
              onClick={() => onSelect({ kind: 'project', id: p.id })}
            >
              {live.has(p.path) && <span className="pulse" aria-label="sessão aberta" />}
              {p.name}
              <span className="count">{p.conversations}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="hint">Ctrl+K busca · Ctrl+Tab alterna terminais</div>
    </nav>
  );
}
