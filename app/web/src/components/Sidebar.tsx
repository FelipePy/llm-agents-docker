import { useState } from 'react';
import type { Overview, SessionInfo, View } from '../types.ts';

interface Props {
  overview: Overview | null;
  view: View;
  sessions: SessionInfo[];
  settings: { webgl: boolean; mode3d: boolean; reduceMotion: boolean };
  onSelect: (v: View) => void;
  onToggle3d: () => void;
  onToggleReduceMotion: () => void;
}

export function Sidebar({ overview, view, sessions, settings, onSelect, onToggle3d, onToggleReduceMotion }: Props) {
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
      <div className="settings">
        <label title={settings.webgl ? '' : 'Este navegador não tem WebGL 2'}>
          <input type="checkbox" checked={settings.webgl && settings.mode3d} disabled={!settings.webgl} onChange={onToggle3d} />
          Modo 3D
        </label>
        <label>
          <input type="checkbox" checked={settings.reduceMotion} onChange={onToggleReduceMotion} />
          Reduzir movimento
        </label>
      </div>
      <div className="hint">Ctrl+K busca · Esc volta · Ctrl+Tab alterna terminais</div>
    </nav>
  );
}
