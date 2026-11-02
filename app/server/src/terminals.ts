import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import nodePty from '@lydell/node-pty';
import type { IPty } from '@lydell/node-pty';
import type { SessionAgent, SessionInfo } from './types.ts';

/** Argumentos do llm-agent para cada agente, no modo autonomo do menu. */
export function agentArgs(agent: SessionAgent, resume?: string): string[] {
  switch (agent) {
    case 'claude':
      return ['claude', '--dangerously-skip-permissions', ...(resume ? ['--resume', resume] : [])];
    case 'codex':
      return resume
        ? ['codex', 'resume', '--dangerously-bypass-approvals-and-sandbox', resume]
        : ['codex', '--dangerously-bypass-approvals-and-sandbox'];
    case 'shell':
      return ['zsh'];
  }
}

export interface OpenRequest {
  projectPath: string;
  agent: SessionAgent;
  resume?: string;
  title: string;
  cols: number;
  rows: number;
}

interface Session {
  info: SessionInfo;
  proc: IPty;
  buffer: string;
}

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
    const proc = nodePty.spawn(this.bin, agentArgs(req.agent, req.resume), {
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
    const session: Session = { info, proc, buffer: '' };
    this.sessions.set(info.id, session);
    proc.onData((data) => {
      session.buffer = (session.buffer + data).slice(-this.maxBuffer);
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

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (s?.info.alive) s.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (s?.info.alive && cols > 0 && rows > 0) s.proc.resize(cols, rows);
  }

  close(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    if (s.info.alive) s.proc.kill();
    this.emit('sessions');
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }
}
