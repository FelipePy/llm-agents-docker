import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { LiveSocket } from '../api.ts';
import { bus } from '../bus.ts';
import { shortcut } from '../tabs.ts';

/** Um xterm por sessao, criado uma vez e mantido enquanto a aba existir. */
export function TerminalView({ id, active, focusKey, socket }: { id: string; active: boolean; focusKey?: number; socket: LiveSocket }) {
  const ref = useRef<HTMLDivElement>(null);
  const fitRef = useRef<{ term: Terminal; fit: FitAddon } | null>(null);

  useEffect(() => {
    const el = ref.current!;
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#0c0f18' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // Atalhos das abas passam direto para a janela.
    term.attachCustomKeyEventHandler((e) => shortcut(e) === null);
    const input = term.onData((data) => socket.send({ type: 'input', id, data }));
    const resize = term.onResize(({ cols, rows }) => socket.send({ type: 'resize', id, cols, rows }));
    const off = bus.on(id, (data, reset) => {
      if (reset) term.reset();
      term.write(data);
    });
    const observer = new ResizeObserver(() => {
      if (el.offsetParent) fit.fit();
    });
    observer.observe(el);
    fitRef.current = { term, fit };
    return () => {
      observer.disconnect();
      off();
      input.dispose();
      resize.dispose();
      term.dispose();
    };
  }, [id, socket]);

  useEffect(() => {
    if (!active || !fitRef.current) return;
    fitRef.current.fit.fit();
    fitRef.current.term.focus();
  }, [active, focusKey]);

  return <div className="terminal" ref={ref} />;
}
