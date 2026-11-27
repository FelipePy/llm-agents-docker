// Acesso pelo celular: o "tailscale serve" publica a interface em https://<pc>.<tailnet>.ts.net,
// so dentro da tailnet (sem porta aberta no roteador), repassando para 127.0.0.1:<porta>.
import { existsSync } from 'node:fs';

export interface RunResult {
  code: number;
  out: string;
}

export interface RemoteDeps {
  /** Roda um comando e devolve codigo e saida (stdout + stderr), sem lancar erro; 127 se o comando nao existe. */
  run: (cmd: string, args: string[]) => Promise<RunResult>;
  /** Porta em que a interface ouve. */
  port: () => number;
  /** Token da interface (vai no link de conexao). */
  token: string;
  /** Executaveis do tailscale, em ordem de preferencia (padrao: o do Windows, no WSL, e o do PATH). */
  bins?: string[];
  exists?: (path: string) => boolean;
}

export interface RemoteStatus {
  /** Tailscale instalado neste PC. */
  installed: boolean;
  /** Conectado a tailnet. */
  running: boolean;
  /** Nome do PC na tailnet (ex.: "pc.tailnet.ts.net"). */
  host: string | null;
  /** HTTPS ligado na tailnet (necessario para o microfone no celular). */
  https: boolean;
  /** O "tailscale serve" publica esta interface. */
  serving: boolean;
  /** Link para o celular (com o token): so com o acesso ligado. */
  link: string | null;
  /** O que impede o acesso, em portugues. */
  problem: string | null;
}

const WINDOWS_BIN = '/mnt/c/Program Files/Tailscale/tailscale.exe';

/** Nome do PC e se o HTTPS esta ligado, a partir de "tailscale status --json". */
export function parseStatus(out: string): { running: boolean; host: string | null; https: boolean } {
  try {
    const s = JSON.parse(out) as { BackendState?: string; Self?: { DNSName?: string }; CertDomains?: string[] | null };
    const host = (s.Self?.DNSName ?? '').replace(/\.$/, '') || null;
    return { running: s.BackendState === 'Running', host, https: (s.CertDomains ?? []).length > 0 };
  } catch {
    return { running: false, host: null, https: false };
  }
}

/** O "tailscale serve status --json" repassa algum caminho para esta porta? */
export function servesPort(out: string, port: number): boolean {
  try {
    const s = JSON.parse(out || '{}') as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> };
    const targets = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, `127.0.0.1:${port}`, `localhost:${port}`, String(port)]);
    return Object.entries(s.Web ?? {}).some(
      ([hostPort, web]) => hostPort.endsWith(':443') && targets.has((web.Handlers?.['/']?.Proxy ?? '').replace(/\/$/, '')),
    );
  } catch {
    return false;
  }
}

export class TailscaleRemote {
  private readonly deps: RemoteDeps;
  /** Ultimo nome visto: a origem https://<nome> e aceita mesmo entre consultas. */
  private host: string | null = null;

  constructor(deps: RemoteDeps) {
    this.deps = deps;
  }

  /** Origens aceitas alem das locais (a pagina aberta pelo celular). */
  origins(): string[] {
    return this.host ? [`https://${this.host}`] : [];
  }

  private bin(): string | null {
    const exists = this.deps.exists ?? existsSync;
    const bins = this.deps.bins ?? [WINDOWS_BIN, 'tailscale'];
    // Caminho absoluto: tem que existir; nome solto: fica para o PATH (o run diz se falta).
    return bins.find((b) => !b.includes('/') || exists(b)) ?? null;
  }

  async status(): Promise<RemoteStatus> {
    const off: RemoteStatus = { installed: false, running: false, host: null, https: false, serving: false, link: null, problem: null };
    const bin = this.bin();
    if (!bin) return { ...off, problem: 'Tailscale não instalado neste PC.' };
    const st = await this.deps.run(bin, ['status', '--json']);
    if (st.code === 127) return { ...off, problem: 'Tailscale não instalado neste PC.' };
    const { running, host, https } = parseStatus(st.out);
    if (host) this.host = host;
    const base = { ...off, installed: true, running, host, https };
    if (!running) return { ...base, problem: 'O Tailscale está instalado, mas desconectado. Entre na sua conta nele.' };
    if (!https) return { ...base, problem: 'Ligue o HTTPS no painel do Tailscale (DNS → HTTPS Certificates); sem ele o microfone não funciona no celular.' };
    const serving = servesPort((await this.deps.run(bin, ['serve', 'status', '--json'])).out, this.deps.port());
    return { ...base, serving, link: serving && host ? `https://${host}/#token=${encodeURIComponent(this.deps.token)}` : null };
  }

  /** Liga ou desliga o "tailscale serve" desta interface e devolve o estado novo. */
  async set(on: boolean): Promise<RemoteStatus> {
    const before = await this.status();
    if (!before.installed || !before.running) throw new Error(before.problem ?? 'Tailscale indisponível.');
    const bin = this.bin()!;
    const args = on ? ['serve', '--bg', '--https=443', `http://127.0.0.1:${this.deps.port()}`] : ['serve', '--https=443', 'off'];
    const r = await this.deps.run(bin, args);
    if (r.code !== 0) throw new Error(firstLines(r.out) || `tailscale saiu com código ${r.code}`);
    return this.status();
  }
}

const firstLines = (s: string) => s.trim().split('\n').slice(0, 4).join('\n');
