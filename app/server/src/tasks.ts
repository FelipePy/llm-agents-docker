import type { TaskName } from './types.ts';

/** Instrucoes das sessoes abertas pelos botoes "+". O cliente so escolhe a tarefa. */
export const TASKS: Record<TaskName, { title: string; prompt: string }> = {
  'new-skill': {
    title: 'nova skill',
    prompt:
      'Quero criar uma skill nova para o Claude Code. Use a skill skill-creator se ela estiver disponível. ' +
      'Comece me perguntando o que a skill deve fazer; depois escreva o SKILL.md em ~/.claude/skills/<nome>/ e me mostre o resultado.',
  },
  'about-me': {
    title: 'sobre mim',
    prompt:
      'Quero registrar informações sobre mim para você lembrar nas próximas conversas. ' +
      'Pergunte o que eu quero registrar e guarde como memória do tipo user. ' +
      'Preferências gerais e duradouras também podem ir para ~/.claude/CLAUDE.md, mas confirme comigo antes.',
  },
};

export const isTask = (v: unknown): v is TaskName => typeof v === 'string' && Object.hasOwn(TASKS, v);

export const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const projectPrompt = (path: string): string =>
  `Este é um projeto novo, criado agora em ${path}. Pergunte qual é o objetivo do projeto e, com as minhas respostas, ` +
  'prepare a estrutura inicial comigo (README, git e o que mais fizer sentido).';
