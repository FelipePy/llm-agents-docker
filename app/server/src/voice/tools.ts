import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { NavNode, ProjectDetail, ProjectSummary, SessionAgent, SessionInfo, TaskName, UiCommand } from '../types.ts';
import { COMMANDS } from './commands.ts';
import { normalize } from './text.ts';

/** O que as ferramentas do Jarvis podem fazer. Nada alem disto: sem shell nem escrita livre. */
export interface JarvisContext {
  projects(): Promise<ProjectSummary[]>;
  projectDetail(path: string): Promise<ProjectDetail | null>;
  /** Ultimos commits ("hash quando mensagem"). */
  gitLog(path: string): Promise<string[]>;
  /** Linhas do `git status --porcelain`. */
  gitChanges(path: string): Promise<string[]>;
  sessions(): SessionInfo[];
  sessionOutput(id: string): string | null;
  openSession(projectPath: string, agent: SessionAgent, prompt?: string): SessionInfo;
  runTask(task: TaskName): Promise<SessionInfo>;
  createProject(name: string): Promise<SessionInfo>;
  ui(command: UiCommand): void;
  /** Manual do app (o README do projeto). */
  manual(): Promise<string>;
}

const LABEL: Record<SessionAgent, string> = { claude: 'Claude', codex: 'Codex', shell: 'Shell' };
const AREAS: Record<string, { node: NavNode; label: string }> = {
  inicio: { node: { kind: 'home' }, label: 'o início' },
  voce: { node: { kind: 'profile' }, label: 'o que eu sei sobre você' },
  projetos: { node: { kind: 'projects' }, label: 'os projetos' },
  skills: { node: { kind: 'skills' }, label: 'as skills' },
  sessoes: { node: { kind: 'sessions' }, label: 'as sessões abertas' },
};
const STOPWORDS = new Set(['o', 'a', 'os', 'as', 'do', 'da', 'dos', 'das', 'de', 'no', 'na', 'projeto']);

const tokens = (s: string): string[] => normalize(s).split(' ').filter((t) => t && !STOPWORDS.has(t));

/** Projeto pelo nome falado: exato > prefixo > parte do nome > palavras em comum. */
export function findProject(projects: ProjectSummary[], spoken: string): ProjectSummary | null {
  const q = tokens(spoken);
  if (!q.length) return null;
  const query = q.join(' ');
  let best: ProjectSummary | null = null;
  let bestScore = 0;
  for (const p of projects) {
    const nameTokens = tokens(p.name);
    const name = nameTokens.join(' ');
    let score = 0;
    if (name === query) score = 100;
    else if (name.startsWith(query)) score = 80;
    else if (name.includes(query)) score = 60;
    else {
      const common = q.filter((t) => nameTokens.includes(t)).length;
      if (common) score = 20 + 30 * (common / Math.max(q.length, nameTokens.length));
    }
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\r/g, '');
}

const day = (iso: string): string => iso.slice(0, 10);

/** Secoes do manual (markdown) mais ligadas ao assunto; sem assunto, o sumario. */
export function searchManual(markdown: string, subject: string): string {
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of markdown.split('\n')) {
    if (/^#{1,4}\s/.test(line) && current.length) {
      sections.push(current.join('\n').trim());
      current = [];
    }
    current.push(line);
  }
  if (current.length) sections.push(current.join('\n').trim());
  const headings = sections.map((s) => s.split('\n')[0].replace(/^#+\s*/, '')).filter(Boolean);
  const words = tokens(subject).filter((w) => w.length >= 3);
  if (!words.length) return `Seções do manual: ${headings.join('; ')}.`;
  const scored = sections
    .map((text) => {
      const norm = normalize(text);
      const head = normalize(text.split('\n')[0]);
      const score = words.reduce((n, w) => n + (norm.split(w).length - 1) + (head.includes(w) ? 3 : 0), 0);
      return { text, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (!scored.length) return `Nada no manual sobre "${subject}". Seções: ${headings.join('; ')}.`;
  return scored.map((s) => s.text.slice(0, 2500)).join('\n\n---\n\n');
}

/** Implementacao dos comandos; cada um devolve o texto que o cerebro le (e resume em voz). */
export function jarvisHandlers(ctx: JarvisContext) {
  async function pick(spoken: string) {
    const list = await ctx.projects();
    return { list, project: findProject(list, spoken) };
  }
  const notFound = (spoken: string, list: ProjectSummary[]) =>
    `Não encontrei o projeto "${spoken}". Projetos recentes: ${list.slice(0, 6).map((p) => p.name).join(', ') || 'nenhum'}.`;
  const projectName = (path: string, list: ProjectSummary[]) => list.find((p) => p.path === path)?.name ?? path.split('/').pop() ?? path;

  return {
    async abrir_area({ area }: { area: string }) {
      const a = AREAS[area];
      if (!a) return `Área desconhecida: ${area}.`;
      ctx.ui({ kind: 'nav', node: a.node });
      return `Mostrando ${a.label}.`;
    },
    async abrir_projeto({ nome }: { nome: string }) {
      const { list, project } = await pick(nome);
      if (!project) return notFound(nome, list);
      ctx.ui({ kind: 'nav', node: { kind: 'project', id: project.id } });
      return `Abri o projeto ${project.name} (${project.path}).`;
    },
    async abrir_conversas({ projeto }: { projeto: string }) {
      const { list, project } = await pick(projeto);
      if (!project) return notFound(projeto, list);
      ctx.ui({ kind: 'nav', node: { kind: 'conversations', projectId: project.id } });
      return `Mostrando as conversas de ${project.name}.`;
    },
    async voltar(_args: Record<string, never>) {
      ctx.ui({ kind: 'back' });
      return 'Voltei um nível.';
    },
    async estado_do_projeto({ projeto }: { projeto: string }) {
      const { list, project } = await pick(projeto);
      if (!project) return notFound(projeto, list);
      ctx.ui({ kind: 'nav', node: { kind: 'project', id: project.id } });
      const detail = await ctx.projectDetail(project.path);
      const lines = [`Projeto ${project.name}, em ${project.path}.`];
      if (detail?.git) {
        const changes = await ctx.gitChanges(project.path);
        lines.push(
          `Git: branch ${detail.git.branch}; ` +
            (changes.length
              ? `${changes.length} arquivos com mudanças (${changes.slice(0, 8).map((c) => c.trim()).join(', ')}).`
              : 'sem mudanças pendentes.'),
        );
        const log = await ctx.gitLog(project.path);
        if (log.length) lines.push(`Últimos commits: ${log.join(' | ')}.`);
      } else {
        lines.push('Não é um repositório git.');
      }
      const convs = detail?.conversationList ?? [];
      if (convs.length) {
        lines.push(`Últimas conversas: ${convs.slice(0, 3).map((c) => `${c.title} (${LABEL[c.agent]}, ${day(c.updatedAt)})`).join('; ')}.`);
      }
      if (detail?.instructions.length) {
        const first = detail.instructions[0];
        lines.push(`Instruções: ${detail.instructions.map((f) => f.path.split('/').pop()).join(', ')}. Início: ${first.content.slice(0, 300)}`);
      }
      if (detail?.memory.length) lines.push(`Memória: ${detail.memory.map((f) => f.path.split('/').pop()).join(', ')}.`);
      return lines.join('\n');
    },
    async iniciar_sessao({ projeto, agente, tarefa }: { projeto: string; agente: SessionAgent; tarefa?: string }) {
      const { list, project } = await pick(projeto);
      if (!project) return notFound(projeto, list);
      const task = tarefa?.trim() || undefined;
      const s = ctx.openSession(project.path, agente, agente === 'shell' ? undefined : task);
      ctx.ui({ kind: 'focus-session', id: s.id });
      return task
        ? `Abri o ${LABEL[agente]} em ${project.name} com a tarefa; ele está trabalhando em background na gaveta de terminais.`
        : `Abri o ${LABEL[agente]} em ${project.name}, em background na gaveta de terminais.`;
    },
    async sessoes_abertas(_args: Record<string, never>) {
      const sessions = ctx.sessions();
      if (!sessions.length) return 'Nenhuma sessão aberta.';
      const list = await ctx.projects();
      return sessions
        .map((s) => `${projectName(s.projectPath, list)} · ${LABEL[s.agent]} · ${s.alive ? 'em execução' : 'encerrada'} · ${s.title}`)
        .join('\n');
    },
    async estado_da_sessao({ projeto }: { projeto?: string }) {
      const list = await ctx.projects();
      const project = projeto ? findProject(list, projeto) : null;
      if (projeto && !project) return notFound(projeto, list);
      const candidates = ctx
        .sessions()
        .filter((s) => !project || s.projectPath === project.path)
        .sort((a, b) => Number(b.alive) - Number(a.alive) || b.startedAt.localeCompare(a.startedAt));
      const s = candidates[0];
      if (!s) return `Não há sessão aberta${project ? ` em ${project.name}` : ''}.`;
      const tail = stripAnsi(ctx.sessionOutput(s.id) ?? '')
        .split('\n')
        .map((l) => l.trimEnd())
        .filter(Boolean)
        .slice(-40)
        .join('\n')
        .slice(-2500);
      return `Sessão ${LABEL[s.agent]} em ${projectName(s.projectPath, list)} (${s.alive ? 'em execução' : 'encerrada'}). Últimas linhas do terminal:\n${tail || '(sem saída ainda)'}`;
    },
    async criar_skill(_args: Record<string, never>) {
      const s = await ctx.runTask('new-skill');
      ctx.ui({ kind: 'focus-session', id: s.id });
      return 'Abri uma sessão do Claude para criar a skill com você; continue a conversa por lá.';
    },
    async registrar_sobre_mim(_args: Record<string, never>) {
      const s = await ctx.runTask('about-me');
      ctx.ui({ kind: 'focus-session', id: s.id });
      return 'Abri uma sessão do Claude para registrar informações sobre você; continue por lá.';
    },
    async criar_projeto({ nome }: { nome: string }) {
      let s: SessionInfo;
      try {
        s = await ctx.createProject(nome);
      } catch (err) {
        return `Não consegui criar o projeto: ${(err as Error).message}`;
      }
      ctx.ui({ kind: 'focus-session', id: s.id });
      return `Criei a pasta do projeto ${nome} e abri o Claude nela para prepará-lo com você.`;
    },
    async manual_do_app({ assunto }: { assunto?: string }) {
      return searchManual(await ctx.manual(), assunto ?? '');
    },
    async comandos(_args: Record<string, never>) {
      ctx.ui({ kind: 'commands' });
      return COMMANDS.map((c) => `${c.title}: por exemplo, "${c.examples[0]}"`).join('\n');
    },
  };
}

export const JARVIS_TOOL_NAMES = COMMANDS.map((c) => `mcp__jarvis__${c.name}`);

/** Servidor MCP em processo com as ferramentas do Jarvis. */
export function createJarvisServer(ctx: JarvisContext) {
  const h = jarvisHandlers(ctx);
  const result = (text: string, isError = false) => ({ content: [{ type: 'text' as const, text }], ...(isError ? { isError } : {}) });
  const run =
    <A>(fn: (args: A) => Promise<string>) =>
    async (args: A) => {
      try {
        return result(await fn(args));
      } catch (err) {
        return result(`Erro: ${(err as Error)?.message ?? err}`, true);
      }
    };
  const nome = z.string().describe('Nome do projeto como o usuário falou (pode ser aproximado).');
  return createSdkMcpServer({
    name: 'jarvis',
    version: '1.0.0',
    tools: [
      tool(
        'abrir_area',
        'Mostra uma área da interface ao redor do buraco negro: inicio, voce (instruções e memórias do usuário), projetos, skills ou sessoes (sessões abertas).',
        { area: z.enum(['inicio', 'voce', 'projetos', 'skills', 'sessoes']) },
        run(h.abrir_area),
      ),
      tool('abrir_projeto', 'Abre um projeto na interface.', { nome }, run(h.abrir_projeto)),
      tool('abrir_conversas', 'Mostra as conversas de um projeto na interface.', { projeto: nome }, run(h.abrir_conversas)),
      tool('voltar', 'Volta um nível na interface.', {}, run(h.voltar)),
      tool(
        'estado_do_projeto',
        'Lê o estado atual de um projeto (git, últimos commits, conversas recentes, instruções e memória) e o mostra na interface. Resuma o resultado em voz, em poucas frases.',
        { projeto: nome },
        run(h.estado_do_projeto),
      ),
      tool(
        'iniciar_sessao',
        'Abre uma sessão de um agente num projeto, rodando em background na gaveta de terminais. Use "tarefa" para o que o agente deve fazer (vai como primeira mensagem); sem tarefa, só abre.',
        {
          projeto: nome,
          agente: z.enum(['claude', 'codex', 'shell']).describe('claude por padrão'),
          tarefa: z.string().optional().describe('Pedido para o agente, em português, completo e claro.'),
        },
        run(h.iniciar_sessao),
      ),
      tool('sessoes_abertas', 'Lista as sessões abertas (projeto, agente, situação, título).', {}, run(h.sessoes_abertas)),
      tool(
        'estado_da_sessao',
        'Lê as últimas linhas do terminal de uma sessão (a mais recente do projeto, ou a mais recente de todas) para contar o progresso.',
        { projeto: z.string().optional().describe('Nome do projeto da sessão.') },
        run(h.estado_da_sessao),
      ),
      tool('criar_skill', 'Abre uma sessão do Claude dedicada a criar uma skill nova com o usuário.', {}, run(h.criar_skill)),
      tool('registrar_sobre_mim', 'Abre uma sessão do Claude dedicada a registrar informações sobre o usuário na memória.', {}, run(h.registrar_sobre_mim)),
      tool(
        'criar_projeto',
        'Cria a pasta de um projeto novo e abre o Claude nela para prepará-lo com o usuário.',
        { nome: z.string().describe('Nome da pasta: letras, números, ".", "_" ou "-".') },
        run(h.criar_projeto),
      ),
      tool(
        'manual_do_app',
        'Procura no manual do llm-agent (o app em que você vive: interface, buraco negro, cartões, planetas, painel do dia, terminais, voz, botões "+", atalhos, configurações) como fazer algo ou para que serve algo. Consulte antes de responder dúvidas sobre o app.',
        { assunto: z.string().optional().describe('Assunto da dúvida, com palavras-chave.') },
        run(h.manual_do_app),
      ),
      tool('comandos', 'Lista os comandos de voz e abre o painel de comandos na interface.', {}, run(h.comandos)),
    ],
  });
}
