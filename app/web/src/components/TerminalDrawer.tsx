import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { LiveSocket } from '../api.ts';
import type { ProjectSummary, SessionInfo } from '../types.ts';
import type { TabsState } from '../tabs.ts';
import { Chevron } from './Chevron.tsx';
import { TabStrip } from './TabStrip.tsx';
import { TerminalView } from './TerminalView.tsx';

interface Props {
  tabs: TabsState;
  sessions: SessionInfo[];
  projects: ProjectSummary[];
  socket: LiveSocket | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onReopen: (s: SessionInfo) => void;
}

export function TerminalDrawer(props: Props) {
  const { tabs, sessions, projects, socket, collapsed, onCollapsedChange, onActivate, onClose, onReopen } = props;
  const [height, setHeight] = useState(340);
  const [focusKey, setFocusKey] = useState(0);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const names = new Map(projects.map((p) => [p.path, p.name]));
  const openSessions = tabs.order.flatMap((id) => byId.get(id) ?? []);
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
        <TabStrip
          tabs={tabs}
          sessions={openSessions}
          projectNames={names}
          onActivate={(id) => {
            onActivate(id);
            onCollapsedChange(false);
          }}
          onClose={onClose}
          onPickerClosed={() => setFocusKey((k) => k + 1)}
        />
        <button className="collapse" onClick={() => onCollapsedChange(!collapsed)} aria-label={collapsed ? 'Expandir' : 'Recolher'}>
          <Chevron direction={collapsed ? 'up' : 'down'} />
        </button>
      </div>
      {/* Recolher so esconde: desmontar perderia o conteudo dos terminais. */}
      <div className="terms" style={{ display: collapsed ? 'none' : undefined }}>
        {tabs.order.map((id) => {
          const s = byId.get(id);
          if (!s) return null;
          return (
            <div key={id} className="term-wrap" style={{ display: id === tabs.active ? 'block' : 'none' }}>
              <TerminalView id={id} active={id === tabs.active && !collapsed} focusKey={focusKey} socket={socket} />
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
