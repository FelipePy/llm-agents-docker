import type { ClientMessage, DayInfo, Overview, ProjectDetail, ServerMessage } from './types.ts';
import type { AccessMode } from './pin.ts';

export type SttProvider = 'local' | 'groq';
export type GroqModel = 'whisper-large-v3-turbo' | 'whisper-large-v3';
/** Pausas da fala: silencio que encerra a fala, espera total por frase incompleta e as palavras que a indicam. */
export interface PauseSettings {
  silenceMs: number;
  incompleteMs: number;
  continuationWords: string[];
}
export interface VoiceSettings {
  stt: SttProvider;
  groqModel: GroqModel;
  /** "gsk_…a1b2" se houver chave salva. */
  groqKeyHint: string | null;
  pauses: PauseSettings;
  /** Padroes das pausas (para restaurar). */
  pauseDefaults: PauseSettings;
}
/** groqKey: nova chave; "" apaga; ausente mantem. */
export interface VoiceSettingsInput {
  stt?: SttProvider;
  groqModel?: GroqModel;
  groqKey?: string;
  pauses?: Partial<PauseSettings>;
}

/** Voz do usuario (so ela ativa o Jarvis, quando cadastrada). */
export interface VoiceProfile {
  enrolled: boolean;
  enrolledAt: string | null;
  /** "f…@gmail.com" se houver e-mail para recuperar a senha. */
  emailHint: string | null;
  /** Da para receber o codigo de recuperacao por e-mail. */
  emailRecovery: boolean;
  /** O perfil tem as chamadas curtas ("Jarvis")? Perfis antigos nao: vale refazer. */
  calls: boolean;
  /** Como o acesso e liberado: chamando "Jarvis", falando a senha ou dos dois jeitos. */
  access: AccessMode;
  /** Senha antiga, com letras ou simbolos: o proximo pedido da senha exige uma so com numeros. */
  legacyPassword: boolean;
}
/** Escolha do acesso: pede a senha atual (e a nova, so numeros, se a atual for antiga). */
export interface VoiceAccessInput {
  access: AccessMode;
  password: string;
  newPassword?: string;
}
/** Cadastro: 4 frases e 3 chamadas (PCM 16 kHz em base64); senha na 1a vez, senha atual para refazer. */
export interface VoiceEnrollInput {
  audio: string[];
  calls: string[];
  password?: string;
  currentPassword?: string;
  email?: string;
}
export type VoiceRecoverInput =
  | { method: 'voice'; audio: string; password: string }
  | { method: 'email' }
  | { method: 'code'; code: string; password: string };

export interface JarvisFact { id: string; about: string; project?: string; text: string; updated: string }
export interface JarvisMemoryView { facts: JarvisFact[]; conversations: { at: string; text: string }[] }

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

  /** Quem transcreve a fala (local ou Groq); a chave so volta como dica. */
  voiceSettings(): Promise<VoiceSettings> {
    return this.get('/api/voice/settings');
  }

  /** Salva; o erro do servidor (ex.: chave recusada) vira a mensagem da excecao. */
  async saveVoiceSettings(input: VoiceSettingsInput): Promise<VoiceSettings> {
    const res = await this.fetchImpl('/api/voice/settings', {
      method: 'PUT',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as VoiceSettings & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status} ao salvar`);
    return body;
  }

  /** As noticias automaticas estao ligadas? */
  async autoNews(): Promise<boolean> {
    return (await this.get<{ enabled: boolean }>('/api/news/auto')).enabled;
  }

  /** Liga ou desliga as noticias automaticas; devolve o que ficou salvo. */
  async saveAutoNews(enabled: boolean): Promise<boolean> {
    const res = await this.fetchImpl('/api/news/auto', {
      method: 'PUT',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao salvar`);
    return ((await res.json()) as { enabled: boolean }).enabled;
  }

  voiceProfile(): Promise<VoiceProfile> {
    return this.get('/api/voice/profile');
  }

  enrollVoice(input: VoiceEnrollInput): Promise<VoiceProfile> {
    return this.post('/api/voice/profile', input);
  }

  setVoiceAccess(input: VoiceAccessInput): Promise<VoiceProfile> {
    return this.post('/api/voice/profile/access', input);
  }

  /** Esqueceu a senha: pela voz, pedindo o codigo por e-mail ou com o codigo recebido. */
  recoverVoice(input: VoiceRecoverInput): Promise<VoiceProfile & { sentTo?: string }> {
    return this.post('/api/voice/profile/recover', input);
  }

  /** POST com JSON; o erro do servidor vira a mensagem da excecao. */
  private async post<T>(path: string, input: unknown): Promise<T> {
    const res = await this.fetchImpl(path, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status} em ${path}`);
    return body;
  }

  jarvisMemory(): Promise<JarvisMemoryView> {
    return this.get('/api/jarvis/memory');
  }

  async forgetFact(id: string): Promise<number> {
    const res = await this.fetchImpl(`/api/jarvis/memory/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao apagar`);
    return ((await res.json()) as { removed: number }).removed;
  }

  overview(): Promise<Overview> {
    return this.get('/api/overview');
  }

  project(id: string): Promise<ProjectDetail> {
    return this.get(`/api/projects/${id}`);
  }

  /** Clima e notícias; as coordenadas vao arredondadas (~100 m). */
  day(coords?: { lat: number; lon: number }): Promise<DayInfo> {
    const q = coords ? `?lat=${coords.lat.toFixed(3)}&lon=${coords.lon.toFixed(3)}` : '';
    return this.get(`/api/day${q}`);
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
