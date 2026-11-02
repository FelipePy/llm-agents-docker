import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Api, LiveSocket, takeToken, wsUrl, type Status } from './api.ts';
import { bus } from './bus.ts';
import { currentNode, initialNav, navReducer, projectIdOf } from './nav.ts';
import { hasWebGL, systemReducedMotion, usePref } from './prefs.ts';
import { crumbLabel, filterItems, itemsFor, type Panel, type RingItem } from './ring.ts';
import { demoSignal, MODE_LABEL, type CoreSignal } from './scene/core.ts';
import { addTab, applyAction, closeTab, emptyTabs, shortcut, syncTabs, type TabsState } from './tabs.ts';
import type { Conversation, Overview, ProjectDetail, ServerMessage, SessionAgent, SessionInfo, TaskName, View } from './types.ts';
import { DayPanel } from './components/DayPanel.tsx';
import { FileCard } from './components/FileCard.tsx';
import { NewProjectPanel } from './components/NewProjectPanel.tsx';
import { ProfilePanel } from './components/ProfilePanel.tsx';
import { ProjectInfo } from './components/ProjectInfo.tsx';
import { ProjectPanel } from './components/ProjectPanel.tsx';
import { Ring } from './components/Ring.tsx';
import { SearchDialog } from './components/SearchDialog.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { SkillDetail } from './components/SkillDetail.tsx';
import { SkillsPanel } from './components/SkillsPanel.tsx';
import { TerminalDrawer } from './components/TerminalDrawer.tsx';

// A cena 3D (three.js) so e baixada quando o modo 3D esta ligado.
const CoreScene = lazy(() => import('./scene/CoreScene.tsx').then((m) => ({ default: m.CoreScene })));

const TERM = { cols: 120, rows: 30 };

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
  const [voiceDemo, setVoiceDemo] = usePref('llm-agent-voice-demo', false);
  const use3d = webgl && mode3d;
  const settings = { webgl, mode3d, reduceMotion, voiceDemo };
  const toggles = {
    on3d: () => setMode3d(!mode3d),
    onReduceMotion: () => setReduceMotion(!reduceMotion),
    onVoiceDemo: () => setVoiceDemo(!voiceDemo),
  };

  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tabs, setTabs] = useState<TabsState>(emptyTabs);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [socket, setSocket] = useState<LiveSocket | null>(null);

  // Modo 3D: navegacao radial + painel de leitura. Modo lista: "view" do marco 1.
  const [nav, dispatch] = useReducer(navReducer, initialNav);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [view, setView] = useState<View>({ kind: 'profile' });
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const node = currentNode(nav);
  const projectId = projectIdOf(node);

  // Sinal do nucleo, lido a cada quadro pela cena (sem re-render).
  const signal = useRef<CoreSignal>({ mode: 'idle', level: 0 });
  const [coreMode, setCoreMode] = useState<CoreSignal['mode']>('idle');

  const refs = useRef({ tabs, panel, searchOpen, use3d });
  refs.current = { tabs, panel, searchOpen, use3d };

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
    if (!projectId) return;
    let current = true;
    api.project(projectId).then(
      (d) => current && setDetail(d),
      (e: Error) => current && setError(e.message),
    );
    return () => {
      current = false;
    };
  }, [api, projectId, revision]);

  useEffect(() => {
    if (!voiceDemo || !use3d) {
      signal.current = { mode: 'idle', level: 0 };
      setCoreMode('idle');
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const s = demoSignal((now - start) / 1000);
      signal.current = s;
      setCoreMode((m) => (m === s.mode ? m : s.mode));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [voiceDemo, use3d]);

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

  const sendOrFail = useCallback(
    (ok: boolean | undefined) => {
      if (!ok) setError('Sem conexão com o servidor.');
    },
    [],
  );

  const openSession = useCallback(
    (projectPath: string, agent: SessionAgent, resume?: string) =>
      sendOrFail(socket?.send({ type: 'open', projectPath, agent, resume, ...TERM })),
    [socket, sendOrFail],
  );

  const runTask = useCallback(
    (task: TaskName) => sendOrFail(socket?.send({ type: 'task', task, ...TERM })),
    [socket, sendOrFail],
  );

  const createProject = useCallback(
    (name: string) => {
      sendOrFail(socket?.send({ type: 'create-project', name, ...TERM }));
      setPanel(null);
    },
    [socket, sendOrFail],
  );

  const closeSession = useCallback(
    (id: string) => {
      socket?.send({ type: 'close', id });
      setTabs((t) => closeTab(t, id));
    },
    [socket],
  );

  const focusTab = useCallback((id: string) => {
    setTabs((t) => ({ ...t, active: id }));
    setDrawerCollapsed(false);
  }, []);

  const showProject = useCallback((id: string) => {
    if (refs.current.use3d) dispatch({ type: 'jump', node: { kind: 'project', id } });
    else setView({ kind: 'project', id });
  }, []);

  const resumeConversation = useCallback(
    (c: Conversation) => {
      const project = overview?.projects.find((p) => p.path === c.cwd);
      if (project) {
        if (refs.current.use3d) dispatch({ type: 'jump', node: { kind: 'conversations', projectId: project.id } });
        else setView({ kind: 'project', id: project.id });
      }
      openSession(c.cwd, c.agent, c.id);
    },
    [overview, openSession],
  );

  const showSkill = useCallback(
    (path: string) => {
      if (!refs.current.use3d) return setView({ kind: 'skills', focus: path });
      dispatch({ type: 'jump', node: { kind: 'skills' } });
      const skill = overview?.skills.find((s) => s.path === path);
      if (skill) setPanel({ kind: 'skill', skill });
    },
    [overview],
  );

  const activate = useCallback(
    (item: RingItem) => {
      const a = item.action;
      if (!a) return;
      if (a.type === 'nav') dispatch({ type: 'push', node: a.node });
      else if (a.type === 'panel') setPanel(a.panel);
      else if (a.type === 'open') openSession(a.projectPath, a.agent, a.resume);
      else if (a.type === 'task') runTask(a.task);
      else focusTab(a.sessionId);
    },
    [openSession, runTask, focusTab],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inTerminal = target?.closest?.('.terminal') != null;
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && !inTerminal) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === 'Escape' && !inTerminal && !refs.current.searchOpen && refs.current.use3d) {
        if (refs.current.panel) setPanel(null);
        else if (target?.tagName !== 'INPUT') dispatch({ type: 'back' });
        return;
      }
      const action = shortcut(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      const { state, closed } = applyAction(refs.current.tabs, action);
      if (closed) socket?.send({ type: 'close', id: closed });
      setTabs(state);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [socket]);

  const items = useMemo(
    () => (overview ? filterItems(itemsFor(node, { overview, sessions, detail }), nav.filter) : []),
    [overview, sessions, detail, node, nav.filter],
  );
  const ringLoading = !overview || (projectId !== null && detail?.id !== projectId);
  const showFilter = node.kind !== 'home' && node.kind !== 'project';

  const listPanel =
    view.kind === 'skills' ? (
      <SkillsPanel skills={overview?.skills ?? []} focus={view.focus} />
    ) : view.kind === 'project' ? (
      <ProjectPanel api={api} id={view.id} revision={revision} onOpen={openSession} />
    ) : (
      <ProfilePanel profile={overview?.profile} />
    );

  const readingPanel =
    panel?.kind === 'skill' ? (
      <SkillDetail skill={panel.skill} />
    ) : panel?.kind === 'project' ? (
      <ProjectInfo detail={panel.detail} />
    ) : panel?.kind === 'new-project' ? (
      <NewProjectPanel base={overview?.projectsDir ?? ''} onCreate={createProject} />
    ) : panel?.kind === 'files' ? (
      <section className="panel">
        <h1>{panel.title}</h1>
        {panel.files.map((f, i) => (
          <FileCard key={f.path} file={f} open={i === 0} />
        ))}
      </section>
    ) : null;

  return (
    <div className="app">
      {use3d ? (
        <DayPanel api={api} settings={settings} toggles={toggles} />
      ) : (
        <Sidebar overview={overview} view={view} sessions={sessions} settings={settings} toggles={toggles} onSelect={setView} />
      )}
      <main className={use3d ? 'content three' : 'content'}>
        {status !== 'open' && <div className="banner">Reconectando ao servidor…</div>}
        {error && (
          <div className="banner error" onClick={() => setError(null)} title="Clique para fechar">
            {error}
          </div>
        )}
        {use3d ? (
          <>
            <Suspense fallback={null}>
              <CoreScene signal={signal} reducedMotion={reduceMotion} dimmed={tabs.order.length > 0 && !drawerCollapsed} />
            </Suspense>
            <div className="navbar">
              <div className="crumbs">
                {nav.stack.map((n, depth) => (
                  <Fragment key={depth}>
                    {depth > 0 && <span className="sep">›</span>}
                    <button
                      className={depth === nav.stack.length - 1 ? 'current' : ''}
                      onClick={() => dispatch({ type: 'goto', depth })}
                    >
                      {crumbLabel(n, overview)}
                    </button>
                  </Fragment>
                ))}
              </div>
              {showFilter && (
                <input
                  placeholder="Filtrar"
                  value={nav.filter}
                  onChange={(e) => dispatch({ type: 'filter', value: e.target.value })}
                />
              )}
            </div>
            <Ring
              items={items}
              page={nav.page}
              animationKey={`${nav.stack.length}:${JSON.stringify(node)}:${nav.page}`}
              loading={ringLoading}
              onPage={(delta) => dispatch({ type: 'page', delta })}
              onActivate={activate}
            />
            {coreMode !== 'idle' && <div className="core-caption">{MODE_LABEL[coreMode]}</div>}
            {readingPanel && (
              <aside className="panel-overlay">
                <button className="panel-close" onClick={() => setPanel(null)} aria-label="Fechar painel">
                  ×
                </button>
                {readingPanel}
              </aside>
            )}
          </>
        ) : (
          listPanel
        )}
      </main>
      <TerminalDrawer
        tabs={tabs}
        sessions={sessions}
        projects={overview?.projects ?? []}
        socket={socket}
        collapsed={drawerCollapsed}
        onCollapsedChange={setDrawerCollapsed}
        onActivate={focusTab}
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
          onProject={showProject}
          onSkill={showSkill}
          onConversation={resumeConversation}
        />
      )}
    </div>
  );
}
