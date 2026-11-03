import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { DayInfo, NavNode, ProjectDetail, ProjectSummary, SessionAgent, SessionInfo, TaskName, UiCommand } from '../types.ts';
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
  /** Digita um texto na sessao e aperta Enter; falso se a sessao nao existe mais. */
  sendToSession(id: string, text: string): boolean;
  /** Liga (ou desliga, com null) a conversa direta: a voz do usuario vai para a sessao. */
  relay(target: { id: string; label: string } | null): void;
  /** Clima e notícias (o mesmo servico do painel do dia, na localizacao do usuario). */
  day(): Promise<DayInfo>;
  now(): Date;
  /** Fecha o terminal de uma sessao. */
  closeSession(id: string): void;
  /** Depois da resposta atual, o Jarvis volta a esperar ser chamado. */
  endConversation(): void;
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

const compact = (s: string): string => tokens(s).join('');

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Semelhanca (Dice) entre trigramas: tolera erros de transcricao ("nowcast" ~ "nowcasting"). */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (2 * common) / (ta.size + tb.size);
}

/** Projetos ordenados pela chance de serem o que o usuario falou (0 a 100). */
export function rankProjects(projects: ProjectSummary[], spoken: string): { project: ProjectSummary; score: number }[] {
  const q = tokens(spoken);
  if (!q.length) return [];
  const query = q.join(' ');
  const qc = q.join('');
  return projects
    .map((project) => {
      const nameTokens = tokens(project.name);
      const name = nameTokens.join(' ');
      const nc = nameTokens.join('');
      let score = 0;
      if (name === query || nc === qc) score = 100;
      else if (name.startsWith(query) || nc.startsWith(qc)) score = 80;
      else if (nc.includes(qc)) score = 65;
      // Mesmas palavras em outra ordem ("api do nowcasting" ~ "nowcasting-api").
      if ([...q].sort().join(' ') === [...nameTokens].sort().join(' ')) score = Math.max(score, 95);
      const common = q.filter((t) => nameTokens.includes(t)).length;
      if (common) score = Math.max(score, 20 + 30 * (common / Math.max(q.length, nameTokens.length)));
      score = Math.max(score, 70 * similarity(nc, qc));
      return { project, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

const MIN_SCORE = 30;
const AMBIGUOUS_MARGIN = 8;

/** O projeto falado; ou, se ficar em duvida, os candidatos para perguntar ao usuario. */
export function resolveProject(projects: ProjectSummary[], spoken: string): { project?: ProjectSummary; candidates: ProjectSummary[] } {
  const ranked = rankProjects(projects, spoken);
  const top = ranked[0];
  if (!top || top.score < MIN_SCORE) return { candidates: ranked.filter((r) => r.score >= 15).slice(0, 3).map((r) => r.project) };
  const close = ranked.filter((r) => top.score - r.score < AMBIGUOUS_MARGIN);
  if (top.score < 100 && close.length > 1) return { candidates: close.slice(0, 4).map((r) => r.project) };
  return { project: top.project, candidates: [top.project] };
}

/** Projeto pelo nome falado (sem perguntar): o mais provavel, ou null. */
export function findProject(projects: ProjectSummary[], spoken: string): ProjectSummary | null {
  const top = rankProjects(projects, spoken)[0];
  return top && top.score >= MIN_SCORE ? top.project : null;
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
    const { project, candidates } = resolveProject(list, spoken);
    return { list, project: project ?? null, candidates };
  }
  /** Sem projeto certo: pergunta entre os candidatos ou lista os recentes. */
  const notFound = (spoken: string, list: ProjectSummary[], candidates: ProjectSummary[] = []) =>
    candidates.length > 1
      ? `Achei mais de um projeto parecido com "${spoken}": ${candidates.map((p) => p.name).join(', ')}. Pergunte ao usuário qual deles antes de seguir.`
      : `Não encontrei o projeto "${spoken}". Projetos: ${list.slice(0, 12).map((p) => p.name).join(', ') || 'nenhum'}. Pergunte ao usuário qual deles.`;
  /** A sessao mais relevante (em execucao e mais recente), opcionalmente de um projeto. */
  async function pickSession(projeto?: string) {
    const list = await ctx.projects();
    const r = projeto ? await pick(projeto) : null;
    if (projeto && !r?.project) return { list, error: notFound(projeto, list, r?.candidates) };
    const project = r?.project ?? null;
    const session = ctx
      .sessions()
      .filter((s) => !project || s.projectPath === project.path)
      .sort((a, b) => Number(b.alive) - Number(a.alive) || b.startedAt.localeCompare(a.startedAt))[0];
    if (!session) return { list, error: `Não há sessão aberta${project ? ` em ${project.name}` : ''}.` };
    return { list, session };
  }
  const projectName = (path: string, list: ProjectSummary[]) => list.find((p) => p.path === path)?.name ?? path.split('/').pop() ?? path;

  return {
    async abrir_area({ area }: { area: string }) {
      const a = AREAS[area];
      if (!a) return `Área desconhecida: ${area}.`;
      ctx.ui({ kind: 'nav', node: a.node });
      return `Mostrando ${a.label}.`;
    },
    async abrir_projeto({ nome }: { nome: string }) {
      const { list, project, candidates } = await pick(nome);
      if (!project) return notFound(nome, list, candidates);
      ctx.ui({ kind: 'nav', node: { kind: 'project', id: project.id } });
      return `Abri o projeto ${project.name} (${project.path}).`;
    },
    async abrir_conversas({ projeto }: { projeto: string }) {
      const { list, project, candidates } = await pick(projeto);
      if (!project) return notFound(projeto, list, candidates);
      ctx.ui({ kind: 'nav', node: { kind: 'conversations', projectId: project.id } });
      return `Mostrando as conversas de ${project.name}.`;
    },
    async voltar(_args: Record<string, never>) {
      ctx.ui({ kind: 'back' });
      return 'Voltei um nível.';
    },
    async estado_do_projeto({ projeto }: { projeto: string }) {
      const { list, project, candidates } = await pick(projeto);
      if (!project) return notFound(projeto, list, candidates);
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
      const { list, project, candidates } = await pick(projeto);
      if (!project) return notFound(projeto, list, candidates);
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
      const { list, session: s, error } = await pickSession(projeto);
      if (!s) return error;
      const tail = stripAnsi(ctx.sessionOutput(s.id) ?? '')
        .split('\n')
        .map((l) => l.trimEnd())
        .filter(Boolean)
        .slice(-40)
        .join('\n')
        .slice(-2500);
      return `Sessão ${LABEL[s.agent]} em ${projectName(s.projectPath, list)} (${s.alive ? 'em execução' : 'encerrada'}). Últimas linhas do terminal:\n${tail || '(sem saída ainda)'}`;
    },
    async enviar_para_sessao({ projeto, mensagem }: { projeto?: string; mensagem: string }) {
      const { list, session: s, error } = await pickSession(projeto);
      if (!s) return error;
      if (!s.alive || !ctx.sendToSession(s.id, mensagem)) return 'Essa sessão já foi encerrada.';
      ctx.ui({ kind: 'focus-session', id: s.id });
      return `Enviei para o ${LABEL[s.agent]} de ${projectName(s.projectPath, list)}.`;
    },
    async falar_direto_com_sessao({ projeto }: { projeto?: string }) {
      const { list, session: s, error } = await pickSession(projeto);
      if (!s) return error;
      if (!s.alive) return 'Essa sessão já foi encerrada.';
      const label = `${LABEL[s.agent]} de ${projectName(s.projectPath, list)}`;
      ctx.relay({ id: s.id, label });
      ctx.ui({ kind: 'focus-session', id: s.id });
      return `Pronto para a conversa direta com o ${label}: depois que você responder, tudo o que o usuário falar vai direto para lá. Avise que, para voltar a falar com você, é só dizer "Jarvis, volta".`;
    },
    async fechar_sessao({ projeto }: { projeto?: string }) {
      const { list, session: s, error } = await pickSession(projeto);
      if (!s) return error;
      ctx.closeSession(s.id);
      return `Fechei o terminal do ${LABEL[s.agent]} de ${projectName(s.projectPath, list)}.`;
    },
    async encerrar_conversa(_args: Record<string, never>) {
      ctx.endConversation();
      return 'Conversa encerrada: depois desta resposta, você volta a esperar ser chamado pelo nome.';
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
    async clima_agora(_args: Record<string, never>) {
      const d = await ctx.day();
      const w = d.weather;
      if (!w) return `Não consegui o clima agora: ${d.weatherError ?? 'sem localização'}.`;
      return `Agora faz ${w.temperature} graus, ${w.description}${w.place ? `, em ${w.place}` : ''}. Hoje a máxima é ${w.max} e a mínima ${w.min} graus.`;
    },
    async noticias_do_dia(_args: Record<string, never>) {
      const d = await ctx.day();
      if (!d.news.length) return `Não consegui as notícias agora${d.newsError ? `: ${d.newsError}` : ''}.`;
      return `Principais notícias de agora:\n${d.news.map((n) => `- ${n.title}${n.source ? ` (${n.source})` : ''}`).join('\n')}`;
    },
    async data_e_hora(_args: Record<string, never>) {
      const now = ctx.now();
      const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return `Agora são ${time} de ${date}.`;
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
      tool(
        'enviar_para_sessao',
        'Digita uma mensagem numa sessão aberta (a mais recente do projeto, ou a mais recente de todas) e envia, como se o usuário tivesse digitado. Repasse o pedido do usuário fiel ao que ele disse.',
        { projeto: z.string().optional().describe('Projeto da sessão.'), mensagem: z.string().describe('Texto a enviar para o agente da sessão.') },
        run(h.enviar_para_sessao),
      ),
      tool(
        'falar_direto_com_sessao',
        'Liga a conversa direta por voz com uma sessão: as próximas falas do usuário vão direto para o agente dela, sem passar por você, até ele dizer "Jarvis, volta".',
        { projeto: z.string().optional().describe('Projeto da sessão.') },
        run(h.falar_direto_com_sessao),
      ),
      tool(
        'fechar_sessao',
        'Fecha o terminal de uma sessão aberta (a mais recente do projeto, ou a mais recente de todas), encerrando o agente dela.',
        { projeto: z.string().optional().describe('Projeto da sessão.') },
        run(h.fechar_sessao),
      ),
      tool(
        'encerrar_conversa',
        'Encerra a conversa por voz: depois da sua resposta, você volta a esperar o usuário chamar "Jarvis". Use quando ele se despedir ou disser que é só isso.',
        {},
        run(h.encerrar_conversa),
      ),
      tool('criar_skill', 'Abre uma sessão do Claude dedicada a criar uma skill nova com o usuário.', {}, run(h.criar_skill)),
      tool('registrar_sobre_mim', 'Abre uma sessão do Claude dedicada a registrar informações sobre o usuário na memória.', {}, run(h.registrar_sobre_mim)),
      tool(
        'criar_projeto',
        'Cria a pasta de um projeto novo e abre o Claude nela para prepará-lo com o usuário.',
        { nome: z.string().describe('Nome da pasta: letras, números, ".", "_" ou "-".') },
        run(h.criar_projeto),
      ),
      tool('clima_agora', 'Temperatura e condição do tempo agora, com máxima e mínima de hoje, na localização do usuário.', {}, run(h.clima_agora)),
      tool('noticias_do_dia', 'Principais manchetes de agora (Google Notícias). Conte as mais relevantes em poucas frases.', {}, run(h.noticias_do_dia)),
      tool('data_e_hora', 'Data e hora atuais do usuário. Use sempre que precisar saber que dia ou que horas são.', {}, run(h.data_e_hora)),
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
