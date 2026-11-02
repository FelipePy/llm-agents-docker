import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { LiveSocket } from '../api.ts';
import type { ProjectSummary, SessionInfo } from '../types.ts';
import type { TabsState } from '../tabs.ts';
import { LABEL } from '../format.ts';
import { TerminalView } from './TerminalView.tsx';

interface Props {
  tabs: TabsState;
  sessions: SessionInfo[];
  projects: ProjectSummary[];
  socket: LiveSocket | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onReopen: (s: SessionInfo) => void;
}

export function TerminalDrawer({ tabs, sessions, projects, socket, onActivate, onClose, onReopen }: Props) {
  const [height, setHeight] = useState(340);
  const [collapsed, setCollapsed] = useState(false);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const names = new Map(projects.map((p) => [p.path, p.name]));
  if (!tabs.order.length || !socket) return null;

  const startDrag = (e: ReactMouseEvent) => {
    const startY = e.clientY;
    const startH = height;
    const move = (ev: MouseEvent) =>
      setHeight(Math.max(140, Math.min(window.innerHeight - 80, startH + startY - ev.clientY)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <section className="drawer" style={{ height: collapsed ? undefined : height }}>
      {!collapsed && <div className="drag" onMouseDown={startDrag} />}
      <div className="tabs">
        {tabs.order.map((id, i) => {
          const s = byId.get(id);
          if (!s) return null;
          return (
            <div
              key={id}
              className={id === tabs.active ? 'tab active' : 'tab'}
              title={s.projectPath}
              onClick={() => {
                onActivate(id);
                setCollapsed(false);
              }}
            >
              <span className={`dot ${s.agent}`} />
              {i < 9 && <kbd>{i + 1}</kbd>}
              {names.get(s.projectPath) ?? s.projectPath} · {LABEL[s.agent]} · {s.title}
              {!s.alive && ' (encerrada)'}
              <button
                className="x"
                aria-label="Fechar"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button className="collapse" onClick={() => setCollapsed(!collapsed)} aria-label="Recolher">
          {collapsed ? '▲' : '▼'}
        </button>
      </div>
      {/* Recolher so esconde: desmontar perderia o conteudo dos terminais. */}
      <div className="terms" style={{ display: collapsed ? 'none' : undefined }}>
        {tabs.order.map((id) => {
          const s = byId.get(id);
          if (!s) return null;
          return (
            <div key={id} className="term-wrap" style={{ display: id === tabs.active ? 'block' : 'none' }}>
              <TerminalView id={id} active={id === tabs.active && !collapsed} socket={socket} />
              {!s.alive && (
                <div className="ended">
                  Sessão encerrada{s.exitCode !== undefined && ` (código ${s.exitCode})`}.{' '}
                  <button onClick={() => onReopen(s)}>Reabrir</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
