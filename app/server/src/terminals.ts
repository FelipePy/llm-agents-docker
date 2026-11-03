import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import nodePty from '@lydell/node-pty';
import type { IPty } from '@lydell/node-pty';
import headless from '@xterm/headless';
import type { SessionAgent, SessionInfo } from './types.ts';

/**
 * Argumentos do llm-agent para cada agente, no modo autonomo do menu. A
 * instrucao inicial (prompt) vai como ultimo argumento; o shell a ignora.
 */
export function agentArgs(agent: SessionAgent, resume?: string, prompt?: string): string[] {
  const tail = prompt ? [prompt] : [];
  switch (agent) {
    case 'claude':
      return ['claude', '--dangerously-skip-permissions', ...(resume ? ['--resume', resume] : []), ...tail];
    case 'codex':
      return resume
        ? ['codex', 'resume', '--dangerously-bypass-approvals-and-sandbox', resume]
        : ['codex', '--dangerously-bypass-approvals-and-sandbox', ...tail];
    case 'shell':
      return ['zsh'];
  }
}

export interface OpenRequest {
  projectPath: string;
  agent: SessionAgent;
  resume?: string;
  prompt?: string;
  title: string;
  cols: number;
  rows: number;
}

interface Session {
  info: SessionInfo;
  proc: IPty;
  buffer: string;
  /** Terminal emulado no servidor: a tela como o usuario a ve (sem redesenhos antigos). */
  screen: headless.Terminal;
}

/** Linhas guardadas alem da tela, para o resumo do fim da tarefa. */
const SCREEN_SCROLLBACK = 500;

export class TerminalManager extends EventEmitter {
  private readonly sessions = new Map<string, Session>();
  private readonly bin: string;
  private readonly maxBuffer: number;

  constructor(bin: string, maxBuffer = 1024 * 1024) {
    super();
    this.bin = bin;
    this.maxBuffer = maxBuffer;
  }

  open(req: OpenRequest): SessionInfo {
    const proc = nodePty.spawn(this.bin, agentArgs(req.agent, req.resume, req.prompt), {
      name: 'xterm-256color',
      cols: req.cols,
      rows: req.rows,
      cwd: req.projectPath,
      env: { ...process.env, AGENT_WORKDIR: req.projectPath } as Record<string, string>,
    });
    const info: SessionInfo = {
      id: randomUUID(),
      projectPath: req.projectPath,
      agent: req.agent,
      resume: req.resume,
      title: req.title,
      startedAt: new Date().toISOString(),
      alive: true,
    };
    const screen = new headless.Terminal({ cols: req.cols, rows: req.rows, scrollback: SCREEN_SCROLLBACK, allowProposedApi: true });
    const session: Session = { info, proc, buffer: '', screen };
    this.sessions.set(info.id, session);
    proc.onData((data) => {
      session.buffer = (session.buffer + data).slice(-this.maxBuffer);
      screen.write(data);
      this.emit('output', info.id, data);
    });
    proc.onExit(({ exitCode }) => {
      info.alive = false;
      info.exitCode = exitCode;
      if (!this.sessions.has(info.id)) return;
      this.emit('exit', info.id, exitCode);
      this.emit('sessions');
    });
    this.emit('sessions');
    return { ...info };
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }));
  }

  history(id: string): string | null {
    return this.sessions.get(id)?.buffer ?? null;
  }

  /**
   * O texto na tela da sessao (com o historico rolado acima), como o usuario o ve. Diferente do
   * history(), que guarda os bytes brutos: o Claude Code redesenha so o que muda, entao um
   * "esc to interrupt" ja apagado da tela continua nos bytes.
   */
  screen(id: string): string | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    const b = s.screen.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < b.length; i++) lines.push((b.getLine(i)?.translateToString(true) ?? '').trimEnd());
    return lines.join('\n').replace(/\n+$/, '');
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (s?.info.alive) s.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s?.info.alive || cols <= 0 || rows <= 0) return;
    s.proc.resize(cols, rows);
    s.screen.resize(cols, rows);
  }

  close(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    if (s.info.alive) s.proc.kill();
    s.screen.dispose();
    this.emit('sessions');
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }
}
