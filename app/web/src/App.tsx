import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Api, LiveSocket, takeToken, wsUrl, type Status } from './api.ts';
import { bus } from './bus.ts';
import { addTab, applyAction, closeTab, emptyTabs, shortcut, syncTabs, type TabsState } from './tabs.ts';
import type { Overview, ServerMessage, SessionAgent, SessionInfo, View } from './types.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { ProfilePanel } from './components/ProfilePanel.tsx';
import { SkillsPanel } from './components/SkillsPanel.tsx';
import { ProjectPanel } from './components/ProjectPanel.tsx';
import { TerminalDrawer } from './components/TerminalDrawer.tsx';
import { SearchDialog } from './components/SearchDialog.tsx';

export function App() {
  const token = useMemo(
    () => takeToken(window.location, window.sessionStorage, (url) => window.history.replaceState(null, '', url)),
    [],
  );
  if (!token) {
    return (
      <div className="fatal">
        Abra a interface pela URL impressa por <code>llm-agent ui</code>.
      </div>
    );
  }
  return <Connected token={token} />;
}

function Connected({ token }: { token: string }) {
  const api = useMemo(() => new Api(token), [token]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tabs, setTabs] = useState<TabsState>(emptyTabs);
  const [view, setView] = useState<View>({ kind: 'profile' });
  const [revision, setRevision] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [socket, setSocket] = useState<LiveSocket | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  useEffect(() => {
    api.overview().then(
      (o) => {
        setOverview(o);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, [api, revision]);

  useEffect(() => {
    // Depois de (re)conectar, o primeiro "sessions" pede o historico de todas.
    let needAttach = true;
    const ws = new LiveSocket(
      wsUrl(window.location, token),
      (m: ServerMessage) => {
        switch (m.type) {
          case 'sessions':
            setSessions(m.sessions);
            setTabs((t) => syncTabs(t, m.sessions.map((s) => s.id)));
            if (needAttach) {
              needAttach = false;
              for (const s of m.sessions) ws.send({ type: 'attach', id: s.id });
            }
            break;
          case 'opened':
            setTabs((t) => addTab(t, m.session.id));
            break;
          case 'output':
            bus.data(m.id, m.data);
            break;
          case 'history':
            bus.history(m.id, m.data);
            break;
          case 'changed':
            setRevision((r) => r + 1);
            break;
          case 'error':
            setError(m.message);
            break;
        }
      },
      (s) => {
        setStatus(s);
        if (s === 'open') {
          needAttach = true;
          setRevision((r) => r + 1);
        }
      },
    );
    setSocket(ws);
    return () => ws.stop();
  }, [token]);

  const openSession = useCallback(
    (projectPath: string, agent: SessionAgent, resume?: string) => {
      if (!socket?.send({ type: 'open', projectPath, agent, resume, cols: 120, rows: 30 })) {
        setError('Sem conexão com o servidor.');
      }
    },
    [socket],
  );

  const closeSession = useCallback(
    (id: string) => {
      socket?.send({ type: 'close', id });
      setTabs((t) => closeTab(t, id));
    },
    [socket],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inTerminal = (e.target as HTMLElement | null)?.closest?.('.terminal') != null;
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && !inTerminal) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      const action = shortcut(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      const { state, closed } = applyAction(tabsRef.current, action);
      if (closed) socket?.send({ type: 'close', id: closed });
      setTabs(state);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [socket]);

  return (
    <div className="app">
      <Sidebar overview={overview} view={view} sessions={sessions} onSelect={setView} />
      <main className="content">
        {status !== 'open' && <div className="banner">Reconectando ao servidor…</div>}
        {error && (
          <div className="banner error" onClick={() => setError(null)} title="Clique para fechar">
            {error}
          </div>
        )}
        {view.kind === 'profile' && <ProfilePanel profile={overview?.profile} />}
        {view.kind === 'skills' && <SkillsPanel skills={overview?.skills ?? []} focus={view.focus} />}
        {view.kind === 'project' && <ProjectPanel api={api} id={view.id} revision={revision} onOpen={openSession} />}
      </main>
      <TerminalDrawer
        tabs={tabs}
        sessions={sessions}
        projects={overview?.projects ?? []}
        socket={socket}
        onActivate={(id) => setTabs((t) => ({ ...t, active: id }))}
        onClose={closeSession}
        onReopen={(s) => {
          closeSession(s.id);
          openSession(s.projectPath, s.agent, s.resume);
        }}
      />
      {searchOpen && overview && (
        <SearchDialog
          overview={overview}
          onClose={() => setSearchOpen(false)}
          onProject={(id) => setView({ kind: 'project', id })}
          onSkill={(path) => setView({ kind: 'skills', focus: path })}
          onConversation={(c) => {
            const project = overview.projects.find((p) => p.path === c.cwd);
            if (project) setView({ kind: 'project', id: project.id });
            openSession(c.cwd, c.agent, c.id);
          }}
        />
      )}
    </div>
  );
}
