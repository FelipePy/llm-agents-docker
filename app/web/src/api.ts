import type { ClientMessage, Overview, ProjectDetail, ServerMessage } from './types.ts';

const TOKEN_KEY = 'llm-agent-token';

/**
 * Token vindo de "#token=..." (impresso pelo llm-agent ui). Fica no
 * sessionStorage e sai da barra de enderecos.
 */
export function takeToken(
  loc: { hash: string; pathname: string; search: string },
  storage: { getItem(k: string): string | null; setItem(k: string, v: string): void },
  replace: (url: string) => void,
): string | null {
  const m = /(?:^#|&)token=([^&]+)/.exec(loc.hash);
  if (m) {
    const token = decodeURIComponent(m[1]);
    storage.setItem(TOKEN_KEY, token);
    replace(loc.pathname + loc.search);
    return token;
  }
  return storage.getItem(TOKEN_KEY);
}

export class Api {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(token: string, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(path, { headers: { authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`);
    return (await res.json()) as T;
  }

  overview(): Promise<Overview> {
    return this.get('/api/overview');
  }

  project(id: string): Promise<ProjectDetail> {
    return this.get(`/api/projects/${id}`);
  }
}

export type Status = 'connecting' | 'open' | 'closed';

export const backoff = (attempt: number): number => Math.min(10_000, 500 * 2 ** attempt);

export const wsUrl = (loc: { protocol: string; host: string }, token: string): string =>
  `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws?token=${encodeURIComponent(token)}`;

interface SocketDeps {
  WebSocketImpl?: typeof WebSocket;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** WebSocket que reconecta sozinho, com espera crescente ate 10 s. */
export class LiveSocket {
  private ws?: WebSocket;
  private attempt = 0;
  private stopped = false;
  private timer: unknown;
  private readonly url: string;
  private readonly onMessage: (m: ServerMessage) => void;
  private readonly onStatus: (s: Status) => void;
  private readonly WS: typeof WebSocket;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(url: string, onMessage: (m: ServerMessage) => void, onStatus: (s: Status) => void, deps: SocketDeps = {}) {
    this.url = url;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.WS = deps.WebSocketImpl ?? WebSocket;
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = deps.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.connect();
  }

  private connect(): void {
    this.onStatus('connecting');
    const ws = new this.WS(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.onStatus('open');
    };
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(String(e.data)));
      } catch {
        // mensagem invalida
      }
    };
    ws.onclose = () => {
      if (this.stopped) return;
      this.onStatus('closed');
      this.timer = this.schedule(() => this.connect(), backoff(this.attempt++));
    };
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) this.cancel(this.timer);
    this.ws?.close();
  }
}
