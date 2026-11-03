import type { SessionAgent } from './types.ts';

export const LABEL: Record<SessionAgent, string> = { claude: 'Claude', codex: 'Codex', shell: 'Shell' };

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
