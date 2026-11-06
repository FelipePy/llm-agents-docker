import type { SessionAgent } from './types.ts';

export const LABEL: Record<SessionAgent, string> = { claude: 'Claude', codex: 'Codex', shell: 'Shell' };

/** A frase das tarefas em background; null quando nao ha nada rodando. */
export const backgroundLabel = (count: number): string | null =>
  count > 0 ? `${count} ${count === 1 ? 'tarefa' : 'tarefas'} rodando em background...` : null;

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
