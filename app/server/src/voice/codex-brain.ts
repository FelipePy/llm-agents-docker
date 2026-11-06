// Cerebro do Jarvis pelo Codex (no login do plano do usuario). Cada fala roda um "codex exec"
// (a primeira abre a conversa, as outras a retomam pelo id), so com as ferramentas do Jarvis,
// que chegam por MCP HTTP (voice/mcp-http.ts): sem shell, busca na web nem escrita livre.
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Brain, BrainHooks } from './brain.ts';
import { JARVIS_PROMPT } from './brain.ts';

export type SpawnFn = (cmd: string, args: string[], opts: { cwd: string; env: Record<string, string | undefined> }) => ChildProcess;

const TOKEN_ENV = 'JARVIS_MCP_TOKEN';

/** Argumentos do "codex exec" (a fala vai pela entrada padrao: "-"). */
export function codexArgs(o: { model: string; mcpUrl: string; instructions: string; thread?: string }): string[] {
  const toml = (v: string) => JSON.stringify(v);
  return [
    'exec',
    ...(o.thread ? ['resume', o.thread] : []),
    '--json',
    '--skip-git-repo-check',
    // Sem o config.toml do usuario: nada de outros MCPs, perfis ou modelos que nao o escolhido.
    '--ignore-user-config',
    '-c', 'sandbox_mode="read-only"',
    '-c', 'approval_policy="never"',
    '-c', 'web_search="disabled"',
    '-c', 'features.shell_tool=false',
    '-c', 'model_reasoning_effort="low"',
    '-c', `mcp_servers.jarvis.url=${toml(o.mcpUrl)}`,
    '-c', `mcp_servers.jarvis.bearer_token_env_var=${toml(TOKEN_ENV)}`,
    '-c', 'mcp_servers.jarvis.default_tools_approval_mode="approve"',
    '-c', `developer_instructions=${toml(o.instructions)}`,
    '-m', o.model,
    '-',
  ];
}

type CodexEvent = {
  type?: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string };
  item?: { type?: string; text?: string; tool?: string };
};

export class CodexBrain implements Brain {
  private thread: string | undefined;
  private child: ChildProcess | undefined;
  private about: Promise<string> | undefined;
  private readonly opts: {
    model: string;
    cwd: string;
    /** Endereco das ferramentas do Jarvis (o proprio servidor da interface). */
    mcpUrl: () => string;
    token: string;
    about?: () => Promise<string>;
    now?: () => Date;
    spawn?: SpawnFn;
    bin?: string;
  };

  constructor(opts: CodexBrain['opts']) {
    this.opts = opts;
  }

  private instructions(about: string): string {
    return about ? `${JARVIS_PROMPT}\n\nO que você já sabe sobre o usuário (das memórias dele):\n${about}` : JARVIS_PROMPT;
  }

  /** Le as memorias ja, para a primeira fala nao esperar por elas. */
  warm(): void {
    this.about ??= (this.opts.about?.() ?? Promise.resolve('')).catch(() => '');
  }

  close(): void {
    this.child?.kill('SIGTERM');
    this.child = undefined;
  }

  async *reply(text: string, signal: AbortSignal, hooks: BrainHooks = {}): AsyncGenerator<string> {
    if (signal.aborted) return;
    this.warm();
    const about = await this.about!;
    const now = (this.opts.now ?? (() => new Date()))();
    const content = `${text}\n\n[${now.toLocaleString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}]`;
    const args = codexArgs({ model: this.opts.model, mcpUrl: this.opts.mcpUrl(), instructions: this.instructions(about), thread: this.thread });
    const child = (this.opts.spawn ?? ((c, a, o) => nodeSpawn(c, a, { ...o, stdio: ['pipe', 'pipe', 'pipe'] })))(this.opts.bin ?? 'codex', args, {
      cwd: this.opts.cwd,
      env: { ...process.env, [TOKEN_ENV]: this.opts.token },
    });
    this.child = child;
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr = `${stderr}${d}`.slice(-2000)));
    const exited = new Promise<number | null>((resolve) => {
      child.on('exit', (code) => resolve(code));
      child.on('error', (err) => {
        stderr = `${stderr}${err.message}`;
        resolve(-1);
      });
    });
    child.stdin?.end(content);
    const onAbort = () => child.kill('SIGTERM');
    signal.addEventListener('abort', onAbort, { once: true });
    let spoke = false;
    let failure = '';
    try {
      for await (const line of createInterface({ input: child.stdout! })) {
        let e: CodexEvent;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        if (e.type === 'thread.started' && e.thread_id) this.thread = e.thread_id;
        else if (e.type === 'item.started' && e.item?.type === 'mcp_tool_call' && e.item.tool) hooks.onTool?.(e.item.tool);
        else if (e.type === 'item.completed' && e.item?.type === 'agent_message' && e.item.text && !signal.aborted) {
          // Cada mensagem chega inteira; entre duas (antes e depois de uma ferramenta), um espaco.
          yield `${spoke ? ' ' : ''}${e.item.text}`;
          spoke = true;
        } else if (e.type === 'turn.failed' || e.type === 'error') failure = e.error?.message ?? e.message ?? 'erro do Codex';
      }
      const code = await exited;
      if (signal.aborted) return;
      if (failure || code !== 0) {
        // Sem resposta nenhuma, a conversa pode ter se perdido: a proxima fala abre outra.
        if (!spoke) this.thread = undefined;
        throw new Error(`o Codex terminou com erro: ${failure || stderr.trim().split('\n').pop() || `código ${code}`}`);
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (this.child === child) this.child = undefined;
    }
  }
}
