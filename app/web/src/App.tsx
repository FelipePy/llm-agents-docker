import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Api, LiveSocket, takeToken, wsUrl, type Status } from './api.ts';
import { bus } from './bus.ts';
import { hasWebGL, systemReducedMotion, usePref } from './prefs.ts';
import { addTab, applyAction, closeTab, emptyTabs, shortcut, syncTabs, type TabsState } from './tabs.ts';
import type { Conversation, Overview, ServerMessage, SessionAgent, SessionInfo, View } from './types.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { ProfilePanel } from './components/ProfilePanel.tsx';
import { SkillsPanel } from './components/SkillsPanel.tsx';
import { ProjectPanel } from './components/ProjectPanel.tsx';
import { TerminalDrawer } from './components/TerminalDrawer.tsx';
import { SearchDialog } from './components/SearchDialog.tsx';

// A cena 3D (three.js) so e baixada quando o modo 3D esta ligado.
const Galaxy = lazy(() => import('./scene/Galaxy.tsx').then((m) => ({ default: m.Galaxy })));

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
  const webgl = useMemo(hasWebGL, []);
  const [mode3d, setMode3d] = usePref('llm-agent-3d', true);
  const [reduceMotion, setReduceMotion] = usePref('llm-agent-reduce-motion', systemReducedMotion());
  const use3d = webgl && mode3d;

  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tabs, setTabs] = useState<TabsState>(emptyTabs);
  const [view, setView] = useState<View>(use3d ? { kind: 'none' } : { kind: 'profile' });
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [socket, setSocket] = useState<LiveSocket | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const searchOpenRef = useRef(searchOpen);
  searchOpenRef.current = searchOpen;
  const use3dRef = useRef(use3d);
  use3dRef.current = use3d;

  // Sem a cena, sempre ha um painel aberto.
  useEffect(() => {
    if (!use3d && view.kind === 'none') setView({ kind: 'profile' });
  }, [use3d, view.kind]);

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
            setDrawerCollapsed(false);
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

  const resumeConversation = useCallback(
    (c: Conversation) => {
      const project = overview?.projects.find((p) => p.path === c.cwd);
      if (project) setView({ kind: 'project', id: project.id });
      openSession(c.cwd, c.agent, c.id);
    },
    [overview, openSession],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inTerminal = (e.target as HTMLElement | null)?.closest?.('.terminal') != null;
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && !inTerminal) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === 'Escape' && !inTerminal && !searchOpenRef.current && use3dRef.current) {
        setView({ kind: 'none' });
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

  const panel =
    view.kind === 'profile' ? (
      <ProfilePanel profile={overview?.profile} />
    ) : view.kind === 'skills' ? (
      <SkillsPanel skills={overview?.skills ?? []} focus={view.focus} />
    ) : view.kind === 'project' ? (
      <ProjectPanel api={api} id={view.id} revision={revision} onOpen={openSession} />
    ) : null;

  return (
    <div className="app">
      <Sidebar
        overview={overview}
        view={view}
        sessions={sessions}
        settings={{ webgl, mode3d, reduceMotion }}
        onSelect={setView}
        onToggle3d={() => setMode3d(!mode3d)}
        onToggleReduceMotion={() => setReduceMotion(!reduceMotion)}
      />
      <main className={use3d ? 'content three' : 'content'}>
        {status !== 'open' && <div className="banner">Reconectando ao servidor…</div>}
        {error && (
          <div className="banner error" onClick={() => setError(null)} title="Clique para fechar">
            {error}
          </div>
        )}
        {use3d ? (
          <>
            {overview && (
              <Suspense fallback={null}>
                <Galaxy
                  overview={overview}
                  sessions={sessions}
                  focusId={view.kind === 'project' ? view.id : null}
                  reducedMotion={reduceMotion}
                  dimmed={tabs.order.length > 0 && !drawerCollapsed}
                  onSelectProject={(id) => setView({ kind: 'project', id })}
                  onSelectProfile={() => setView({ kind: 'profile' })}
                  onSelectSkill={(path) => setView({ kind: 'skills', focus: path })}
                  onResume={resumeConversation}
                />
              </Suspense>
            )}
            {panel && (
              <aside className="panel-overlay">
                <button className="panel-close" onClick={() => setView({ kind: 'none' })} aria-label="Fechar painel">
                  ×
                </button>
                {panel}
              </aside>
            )}
          </>
        ) : (
          panel
        )}
      </main>
      <TerminalDrawer
        tabs={tabs}
        sessions={sessions}
        projects={overview?.projects ?? []}
        socket={socket}
        collapsed={drawerCollapsed}
        onCollapsedChange={setDrawerCollapsed}
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
          onConversation={resumeConversation}
        />
      )}
    </div>
  );
}
