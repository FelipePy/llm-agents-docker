// Tipos compartilhados entre o servidor e a UI (app/web importa este arquivo).

export type Agent = 'claude' | 'codex';
export type SessionAgent = Agent | 'shell';
export type TaskName = 'new-skill' | 'about-me';

export interface Conversation {
  agent: Agent;
  id: string;
  cwd: string;
  title: string;
  updatedAt: string;
  prompts: number;
  /** Pasta em ~/.claude/projects que contém a conversa (só Claude). */
  claudeDir?: string;
}

export interface TextFile {
  path: string;
  content: string;
  truncated: boolean;
}

export interface Skill {
  name: string;
  description: string;
  origin: string;
  path: string;
}

export interface Profile {
  instructions: TextFile[];
  memories: TextFile[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  updatedAt: string;
  conversations: number;
  agents: Agent[];
}

export interface ProjectDetail extends ProjectSummary {
  git: { branch: string; dirty: boolean } | null;
  instructions: TextFile[];
  memory: TextFile[];
  conversationList: Conversation[];
}

export interface Overview {
  profile: Profile;
  skills: Skill[];
  projects: ProjectSummary[];
  conversations: Conversation[];
  /** Onde "+ Novo projeto" cria a pasta. */
  projectsDir: string;
}

export interface Weather {
  temperature: number;
  code: number;
  description: string;
  max: number;
  min: number;
  /** Nome da cidade (vazio quando veio da geolocalização). */
  place: string;
}

export interface NewsItem {
  title: string;
  source: string;
  link: string;
  published: string;
}

export interface DayInfo {
  weather: Weather | null;
  weatherError?: string;
  news: NewsItem[];
  newsError?: string;
}

export interface SessionInfo {
  id: string;
  projectPath: string;
  agent: SessionAgent;
  resume?: string;
  title: string;
  startedAt: string;
  alive: boolean;
  exitCode?: number;
}

export type ClientMessage =
  | { type: 'open'; projectPath: string; agent: SessionAgent; resume?: string; cols: number; rows: number }
  | { type: 'task'; task: TaskName; cols: number; rows: number }
  | { type: 'create-project'; name: string; cols: number; rows: number }
  | { type: 'attach'; id: string }
  | { type: 'input'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'close'; id: string };

export type ServerMessage =
  | { type: 'sessions'; sessions: SessionInfo[] }
  | { type: 'opened'; session: SessionInfo }
  | { type: 'output'; id: string; data: string }
  | { type: 'history'; id: string; data: string }
  | { type: 'exit'; id: string; code: number }
  | { type: 'changed' }
  /** Estado da voz e ultima fala do Jarvis (para a bolinha flutuante do app desktop). */
  | { type: 'voice'; state: VoiceState; text?: string }
  | { type: 'error'; message: string };

// Voz (etapa 3a). "off": escuta desligada; "preparing": instalando/carregando.
export type VoiceState = 'off' | 'preparing' | 'sleeping' | 'listening' | 'thinking' | 'speaking';

export type VoiceServerMessage =
  | { type: 'state'; state: VoiceState; detail?: string }
  | { type: 'caption'; who: 'user' | 'jarvis'; text: string }
  | { type: 'audio'; id: number; data: string; last: boolean }
  | { type: 'stop-audio' }
  | { type: 'chime' }
  | { type: 'ui'; command: UiCommand }
  /** Tempos da ultima resposta, em ms desde o fim da fala (null: nao medido), e as ferramentas usadas. */
  | { type: 'timing'; stt: number | null; firstToken: number | null; firstAudio: number | null; tools: string[] }
  /** Conversa direta com uma sessao (null: de volta ao Jarvis) e o texto ditado ainda nao enviado. */
  | { type: 'relay'; target: string | null; draft: string }
  /** Abaixa (on) ou restaura a voz do Jarvis enquanto decide se o usuario esta interrompendo. */
  | { type: 'duck'; on: boolean }
  | { type: 'error'; message: string };

export type VoiceClientMessage =
  | { type: 'start'; lat?: number; lon?: number }
  | { type: 'stop' }
  | { type: 'interrupt' }
  | { type: 'played'; id: number }
  /** Conversa direta: envia o texto ditado, apaga o ditado ou sai da conversa direta. */
  | { type: 'relay-submit' }
  | { type: 'relay-clear' }
  | { type: 'relay-exit' };

/** Nivel da navegacao radial da interface (a voz usa os mesmos niveis). */
export type NavNode =
  | { kind: 'home' }
  | { kind: 'profile' }
  | { kind: 'projects' }
  | { kind: 'project'; id: string }
  | { kind: 'conversations'; projectId: string }
  | { kind: 'skills' }
  | { kind: 'sessions' };

/** Ordem do Jarvis para a interface (etapa 3b). */
export type UiCommand =
  | { kind: 'nav'; node: NavNode }
  | { kind: 'back' }
  | { kind: 'focus-session'; id: string }
  | { kind: 'commands' };
