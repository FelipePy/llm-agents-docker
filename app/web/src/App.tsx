import { Fragment, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Api, LiveSocket, backoff, takeToken, wsUrl, type Status } from './api.ts';
import { bus } from './bus.ts';
import { playSound } from './sound.ts';
import { currentNode, initialNav, navReducer, projectIdOf } from './nav.ts';
import { hasWebGL, systemReducedMotion, useChoice, useHotkey, usePref, useSavedHotkey } from './prefs.ts';
import { isGlobeColor, isGlobeStyle, nextGlobeStyle, type GlobeColor, type GlobeStyle } from './scene/globe.ts';
import { applySystemColor } from './theme.ts';
import { crumbLabel, filterItems, itemsFor, type Panel, type RingItem } from './ring.ts';
import { demoSignal, MODE_LABEL, type CoreSignal } from './scene/core.ts';
import { addTab, applyAction, closeTab, emptyTabs, shortcut, syncTabs, type TabsState } from './tabs.ts';
import type { Conversation, Overview, ProjectDetail, ServerMessage, SessionAgent, SessionInfo, TaskName, UiCommand, View } from './types.ts';
import { CommandsPanel } from './components/CommandsPanel.tsx';
import { DayPanel } from './components/DayPanel.tsx';
import { FileCard } from './components/FileCard.tsx';
import { NewProjectPanel } from './components/NewProjectPanel.tsx';
import { ProfilePanel } from './components/ProfilePanel.tsx';
import { ProjectInfo } from './components/ProjectInfo.tsx';
import { ProjectPanel } from './components/ProjectPanel.tsx';
import { Modal } from './components/Modal.tsx';
import { Ring } from './components/Ring.tsx';
import { SearchDialog } from './components/SearchDialog.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { HoldWave } from './components/HoldWave.tsx';
import { SkillDetail } from './components/SkillDetail.tsx';
import { SkillsPanel } from './components/SkillsPanel.tsx';
import { TerminalDrawer } from './components/TerminalDrawer.tsx';
import { TopActions, type TopModal } from './components/TopActions.tsx';
import { backgroundLabel } from './format.ts';
import { OFF_VIEW, VoiceClient, VoiceConnectionError, timingText, voiceStatus, type VoiceView } from './voice/client.ts';
import { floatSupported, openFloatingOrb, type FloatingOrb } from './voice/float.ts';
import { useHoldKeys } from './voice/useHoldKeys.ts';
import { waveLabel, wavePlace } from './voice/hold.ts';
import { DEFAULT_GLOBE_HOTKEY, MIDDLE_BUTTON, matchesHotkey, sameHotkey } from './voice/hotkey.ts';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { setAutostart, useDesktop } from './desktop.ts';

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
  // O Jarvis ja comeca ouvindo a cada abertura do app (desligar vale so ate fechar).
  const [voiceOn, setVoiceOn] = useState(true);
  // Atalho de falar: ligado, ele e o modo de falar e a escuta continua fica desligada.
  const [holdKey, setHoldKey] = usePref('llm-agent-hold-key', false);
  const [hotkey, setHotkey] = useHotkey('llm-agent-hold-hotkey');
  // Esperando a combinacao nova nas configuracoes: nenhum atalho do app reage as teclas.
  const [hotkeyCapturing, setHotkeyCapturing] = useState(false);
  const voiceActive = voiceOn || holdKey;
  // Modal aberto pelos botoes do topo: painel do dia (clima, noticias) ou configuracoes.
  const [modal, setModal] = useState<TopModal | null>(null);
  const desktop = useDesktop();
  // Janela flutuante do navegador (Picture-in-Picture): aberta por um clique nas configuracoes.
  const [floating, setFloating] = useState<FloatingOrb | null>(null);
  const [globeColor, setGlobeColor] = useChoice<GlobeColor>('llm-agent-globe-color', 'dourado', isGlobeColor);
  // Antes de pintar: sem isto, quem escolheu outra cor veria a interface sem cor no primeiro quadro.
  useLayoutEffect(() => applySystemColor(document.documentElement, globeColor), [globeColor]);
  const [globeStyle, setGlobeStyle] = useChoice<GlobeStyle>('llm-agent-globe-style', 'holografico', isGlobeStyle);
  const [globeHotkey, setGlobeHotkey] = useSavedHotkey('llm-agent-globe-hotkey', DEFAULT_GLOBE_HOTKEY);
  const [sounds, setSounds] = usePref('llm-agent-sounds', true);
  // Legendas da conversa: a da fala do usuario e a do Jarvis, cada uma por si (desligadas por padrao).
  const [captionUser, setCaptionUser] = usePref('llm-agent-caption-user', false);
  const [captionJarvis, setCaptionJarvis] = usePref('llm-agent-caption-jarvis', false);
  const [voice, setVoice] = useState<VoiceView>(OFF_VIEW);
  const voiceRef = useRef<VoiceClient | null>(null);
  // Ordens do Jarvis para a interface; atualizada a cada render (ver mais abaixo).
  const onUiRef = useRef<(command: UiCommand) => void>(() => {});
  const use3d = webgl && mode3d;
  const settings = { webgl, mode3d, reduceMotion, voiceDemo, voice: voiceOn && !holdKey, holdKey, hotkey, globeColor, globeStyle, globeHotkey, sounds, captionUser, captionJarvis };
  const toggles = {
    on3d: () => setMode3d(!mode3d),
    onReduceMotion: () => setReduceMotion(!reduceMotion),
    onVoiceDemo: () => setVoiceDemo(!voiceDemo),
    onVoice: () => setVoiceOn(!voiceOn),
    onHoldKey: () => setHoldKey(!holdKey),
    onHotkey: setHotkey,
    onHotkeyCapturing: setHotkeyCapturing,
    onGlobeColor: (c: GlobeColor) => setGlobeColor(c),
    onGlobeStyle: (s: GlobeStyle) => setGlobeStyle(s),
    onGlobeHotkey: setGlobeHotkey,
    onSounds: () => setSounds(!sounds),
    onCaptionUser: () => setCaptionUser(!captionUser),
    onCaptionJarvis: () => setCaptionJarvis(!captionJarvis),
  };

  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [backgroundCount, setBackgroundCount] = useState(0);
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

  const talkHotkey = holdKey ? hotkey : null;
  const refs = useRef({ tabs, panel, modal, searchOpen, use3d, talkHotkey, hotkeyCapturing });
  refs.current = { tabs, panel, modal, searchOpen, use3d, talkHotkey, hotkeyCapturing };

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

  // Conversa por voz: liga e desliga o cliente junto com a "Escuta ativa" ou o atalho
  // de falar. Se o servidor cair (reinicio, atualizacao do Jarvis), reconecta sozinho.
  const [voiceEpoch, setVoiceEpoch] = useState(0);
  const voiceRetry = useRef(0);
  useEffect(() => {
    if (!voiceActive) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const reconnect = () => {
      setVoice((v) => ({ ...OFF_VIEW, timing: v.timing, state: 'preparing', detail: 'reconectando a voz' }));
      retry = setTimeout(() => setVoiceEpoch((e) => e + 1), backoff(voiceRetry.current++));
    };
    const client = new VoiceClient(
      token,
      (patch) => setVoice((v) => ({ ...v, ...patch })),
      (message) => setError(message),
      (command) => onUiRef.current(command),
      reconnect,
      holdKey,
    );
    voiceRef.current = client;
    client.start().then(
      () => {
        voiceRetry.current = 0;
      },
      (err: Error) => {
        if (err instanceof VoiceConnectionError) return reconnect();
        setError(err.message);
        // Com o atalho, a opcao continua ligada: o proximo aperto tenta de novo (ver abaixo).
        if (holdKey) voiceRef.current = null;
        else setVoiceOn(false);
      },
    );
    return () => {
      clearTimeout(retry);
      client.stop();
      voiceRef.current = null;
      setVoice(OFF_VIEW);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceActive, holdKey, token, voiceEpoch]);

  // Atalho de falar: funciona em toda a pagina, inclusive com o foco num terminal.
  useHoldKeys(
    holdKey && !hotkeyCapturing ? hotkey : null,
    () => {
      if (voiceRef.current) voiceRef.current.holdStart();
      else setVoiceEpoch((e) => e + 1); // o microfone falhou: tenta abrir de novo
    },
    () => voiceRef.current?.holdEnd(),
  );

  // Atalho de trocar o estilo: sem o globo na tela (modo lista), o select tambem fica desligado.
  // Igual ao de falar (gravado antes de existir este atalho), o de falar tem prioridade.
  const globeShortcutOn = use3d && !hotkeyCapturing && !(holdKey && sameHotkey(hotkey, globeHotkey));
  useHoldKeys(globeShortcutOn ? globeHotkey : null, () => setGlobeStyle(nextGlobeStyle(globeStyle)));
  const holdLevel = useCallback(() => voiceRef.current?.micLevel() ?? 0, []);
  const waveText = waveLabel(!!voice.holding, settings.voice, hotkey.label);

  // Legendas somem 8 s depois que a conversa volta a esperar "Hey Jarvis".
  useEffect(() => {
    if (voice.state !== 'sleeping' || (!voice.user && !voice.jarvis)) return;
    const id = setTimeout(() => setVoice((v) => ({ ...v, user: '', jarvis: '' })), 8000);
    return () => clearTimeout(id);
  }, [voice.state, voice.user, voice.jarvis]);

  // Sinal do nucleo: voz real, demonstracao ou parado.
  useEffect(() => {
    const demo = voiceDemo && use3d && !voiceActive;
    if (!voiceActive && !demo) {
      signal.current = { mode: 'idle', level: 0 };
      setCoreMode('idle');
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const s = demo ? demoSignal((now - start) / 1000) : (voiceRef.current?.signal() ?? { mode: 'idle' as const, level: 0 });
      signal.current = s;
      setCoreMode((m) => (m === s.mode ? m : s.mode));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [voiceDemo, use3d, voiceActive]);

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
          case 'background':
            setBackgroundCount(m.count);
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

  // Som de clique em botoes, cartoes e abas (fora do terminal).
  useEffect(() => {
    if (!sounds) return;
    const onDown = (e: PointerEvent) => {
      if (e.button === MIDDLE_BUTTON) return; // pode ser um dos atalhos
      const el = (e.target as HTMLElement | null)?.closest?.('button, .ring-card, .tab, a, input[type="checkbox"]');
      if (!el || el.closest('.terminal') || (el as HTMLButtonElement).disabled) return;
      playSound(el.classList.contains('ring-card') ? 'open' : 'tap');
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [sounds]);

  const fullVoiceStatus = [voiceStatus(voice, holdKey ? hotkey.label : undefined), timingText(voice)].filter(Boolean).join('\n');

  // Janela flutuante (navegador): acompanha o estado da voz e a ultima fala do Jarvis.
  const toggleFloating = useCallback(() => {
    if (floating) {
      floating.close();
      setFloating(null);
      return;
    }
    openFloatingOrb(
      globeColor,
      () => window.focus(),
      () => setFloating(null),
    ).then(
      (orb) => setFloating(orb),
      (err: Error) => setError(`Não consegui abrir a janela flutuante: ${err.message}`),
    );
  }, [floating, globeColor]);
  useEffect(() => {
    floating?.update(coreMode, (captionJarvis && voice.jarvis) || (captionUser && voice.user) || '');
  }, [floating, coreMode, voice.jarvis, voice.user, captionJarvis, captionUser]);
  useEffect(() => {
    floating?.setColor(globeColor);
  }, [floating, globeColor]);

  onUiRef.current = (command: UiCommand) => {
    // O modal cobre a tela: o que o Jarvis abrir precisa ficar a vista.
    setModal(null);
    if (command.kind === 'back') return dispatch({ type: 'back' });
    if (command.kind === 'focus-session') return focusTab(command.id);
    if (command.kind === 'commands') return setPanel({ kind: 'commands' });
    const node = command.node;
    if (refs.current.use3d) {
      setPanel(null);
      return dispatch({ type: 'jump', node });
    }
    // Modo lista: os niveis equivalentes da barra lateral.
    if (node.kind === 'project' || node.kind === 'conversations') setView({ kind: 'project', id: node.kind === 'project' ? node.id : node.projectId });
    else if (node.kind === 'skills') setView({ kind: 'skills' });
    else if (node.kind === 'profile') setView({ kind: 'profile' });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // O atalho de falar vale mais que os do app (a ordem dos dois escutadores nao e fixa).
      const { talkHotkey, hotkeyCapturing } = refs.current;
      if (hotkeyCapturing || (talkHotkey && matchesHotkey(e, talkHotkey))) return;
      const target = e.target as HTMLElement | null;
      const inTerminal = target?.closest?.('.terminal') != null;
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && !inTerminal) {
        e.preventDefault();
        setModal(null);
        setSearchOpen(true);
        return;
      }
      const talking = voiceRef.current?.state === 'thinking' || voiceRef.current?.state === 'speaking';
      if (e.key === 'Escape' && !inTerminal && talking) {
        voiceRef.current?.interrupt();
        return;
      }
      if (e.key === 'Escape' && refs.current.modal) {
        // Vale ate com o foco no terminal, que pode pega-lo sozinho ao abrir uma sessao.
        e.stopPropagation();
        setModal(null);
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
      <ProfilePanel profile={overview?.profile} api={api} />
    );

  const readingPanel =
    panel?.kind === 'skill' ? (
      <SkillDetail skill={panel.skill} />
    ) : panel?.kind === 'project' ? (
      <ProjectInfo detail={panel.detail} />
    ) : panel?.kind === 'commands' ? (
      <CommandsPanel />
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
    <div className={use3d ? 'app full' : 'app'}>
      {use3d ? (
        // Mesmo fechado, o painel do dia fica montado: mantem o clima e as noticias em dia para a abertura.
        <Modal open={modal !== null} label={modal === 'settings' ? 'Configurações' : 'Notícias'} wide={modal === 'settings'} onClose={() => setModal(null)}>
          {modal === 'settings' ? (
            <SettingsPanel
              api={api}
              settings={settings}
              toggles={toggles}
              voiceStatus={fullVoiceStatus}
              desktop={desktop}
              onAutostart={setAutostart}
              floating={floatSupported() && !desktop ? { open: !!floating, toggle: toggleFloating } : null}
            />
          ) : (
            <DayPanel api={api} voiceStatus={fullVoiceStatus} />
          )}
        </Modal>
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
              <CoreScene
                signal={signal}
                reducedMotion={reduceMotion}
                dimmed={tabs.order.length > 0 && !drawerCollapsed}
                color={globeColor}
                globeStyle={globeStyle}
                onSelectProfile={() => dispatch({ type: 'jump', node: { kind: 'profile' } })}
              />
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
              <TopActions filter={showFilter ? nav.filter : null} onFilter={(value) => dispatch({ type: 'filter', value })} onOpen={setModal} />
            </div>
            <Ring
              items={items}
              page={nav.page}
              animationKey={`${nav.stack.length}:${JSON.stringify(node)}:${nav.page}`}
              loading={ringLoading}
              onPage={(delta) => dispatch({ type: 'page', delta })}
              onActivate={activate}
            />
            {voice.relay && (
              <div className="dictation">
                <div className="dictation-head">Ditando para o {voice.relay}</div>
                <div className="dictation-text">{voice.relayDraft || `${holdKey ? `Segure ${hotkey.label} e fale` : 'Fale'}; o texto aparece aqui e no terminal, sem enviar.`}</div>
                <div className="dictation-actions">
                  <button className="send" disabled={!voice.relayDraft} onClick={() => voiceRef.current?.relaySubmit()}>
                    ▶ Enviar
                  </button>
                  <button disabled={!voice.relayDraft} onClick={() => voiceRef.current?.relayClear()}>
                    Apagar
                  </button>
                  <button onClick={() => voiceRef.current?.relayExit()}>Sair</button>
                </div>
              </div>
            )}
            {(captionUser && voice.user) || (captionJarvis && voice.jarvis) ? (
              <div className="captions">
                {captionUser && voice.user && <p className="you">você: {voice.user}</p>}
                {captionJarvis && voice.jarvis && <p className="jarvis">{voice.jarvis}</p>}
              </div>
            ) : (
              coreMode !== 'idle' && <div className="core-caption">{MODE_LABEL[coreMode]}</div>
            )}
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
      {waveText && <HoldWave level={holdLevel} reduced={reduceMotion} label={waveText} place={wavePlace(use3d, modal !== null, !!readingPanel)} />}
      {backgroundCount > 0 && (
        <div className="background-tasks" role="status">
          {backgroundLabel(backgroundCount)}
        </div>
      )}
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
