import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { DayInfo, NavNode, ProjectDetail, ProjectSummary, SessionAgent, SessionInfo, TaskName, UiCommand } from '../types.ts';
import { COMMANDS } from './commands.ts';
import { normalize } from './text.ts';
import { TOPICS, type JarvisMemory, type MemoryTopic } from './memory.ts';
import type { WebSearch } from '../search.ts';

export interface EvolutionApi {
  draft(title: string, spec: string): string;
  summarize(summary: string, turn: number): string;
  start(turn: number): Promise<string>;
  status(): Promise<string>;
  apply(opts: { closeSessions?: boolean }): Promise<string>;
  discard(): Promise<string>;
}

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
  /** Busca na web (DuckDuckGo + Wikipedia, sem chave de API). */
  webSearch(query: string): Promise<WebSearch>;
  now(): Date;
  /** Fecha o terminal de uma sessao. */
  closeSession(id: string): void;
  /** Depois da resposta atual, o Jarvis volta a esperar ser chamado. */
  endConversation(): void;
  /** Memoria do Jarvis entre sessoes (fatos e resumos de conversa). */
  memory: JarvisMemory;
  /** Funcionalidades novas para o proprio Jarvis (definir, aprovar, desenvolver, aplicar). */
  evolution?: EvolutionApi;
  /** Quantas falas do usuario ja foram respondidas (o "pode comecar" vem depois do resumo). */
  userTurn?(): number;
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

const ORDINALS: Record<string, number> = {
  um: 1, uma: 1, primeiro: 1, primeira: 1, dois: 2, duas: 2, segundo: 2, segunda: 2, tres: 3, terceiro: 3, terceira: 3,
  quatro: 4, quarto: 4, quarta: 4, cinco: 5, quinto: 5, quinta: 5, seis: 6, sexto: 6, sexta: 6, sete: 7, setimo: 7, setima: 7,
  oito: 8, oitavo: 8, oitava: 8, nove: 9, nono: 9, nona: 9, dez: 10, decimo: 10, decima: 10,
};
const SESSION_WORDS = new Set(['sessao', 'sessoes', 'terminal', 'aba', 'numero', 'n', 'no', 'num', 'do', 'da', 'de', 'o', 'a', 'que', 'esta', 'com']);
const LATEST = new Set(['ultima', 'ultimo', 'recente', 'mais', 'nova', 'novo']);
const AGENTS: Record<string, SessionAgent> = { claude: 'claude', codex: 'codex', shell: 'shell', terminal: 'shell', zsh: 'shell' };

/** Sessoes em ordem de abertura (a mesma das abas da gaveta), com o numero de cada uma (1, 2, ...). */
export function numberSessions(sessions: SessionInfo[]): { n: number; session: SessionInfo }[] {
  return [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((session, i) => ({ n: i + 1, session }));
}

/** Numero de abertura falado ("2", "a segunda", "sessão número 3"), ou null. */
export function spokenNumber(spoken: string): number | null {
  const words = normalize(spoken).split(' ').filter((w) => w && !SESSION_WORDS.has(w));
  if (words.length !== 1) return null;
  const w = words[0].replace(/^n?(\d+)[ao]?$/, '$1');
  if (/^\d+$/.test(w)) return Number(w);
  return ORDINALS[w] ?? null;
}

/** O que a sessao esta fazendo: as ultimas linhas com texto de verdade do terminal. */
export function sessionActivity(output: string, lines = 2, max = 160): string {
  const useful = stripAnsi(output)
    .split('\n')
    .map((l) => l.replace(/[─-▟⠀-⣿]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((l) => /[\p{L}\p{N}]{2}/u.test(l))
    .filter((l) => !/^(\? for shortcuts|bypass permissions|esc to interrupt|>\s*$)/i.test(l));
  const text = useful.slice(-lines).join(' / ');
  return text.length > max ? `…${text.slice(-max)}` : text;
}

type Numbered = { n: number; session: SessionInfo };

/**
 * A sessao escolhida pelo usuario entre `pool` (ja filtrado por projeto): pelo
 * numero de abertura, id (ou comeco dele), agente ou titulo. Sem seletor, a
 * mais relevante (em execucao e mais recente). `all` traz a numeracao global.
 */
export function resolveSession(pool: Numbered[], spoken: string | undefined, all: Numbered[] = pool): { pick?: Numbered; candidates: Numbered[] } {
  const latest = (list: Numbered[]) =>
    [...list].sort((a, b) => Number(b.session.alive) - Number(a.session.alive) || b.session.startedAt.localeCompare(a.session.startedAt))[0];
  const raw = spoken?.trim() ?? '';
  const words = normalize(raw).split(' ').filter((w) => w && !SESSION_WORDS.has(w));
  if (!words.length || words.every((w) => LATEST.has(w))) {
    const pick = latest(pool);
    return { pick, candidates: pick ? [pick] : [] };
  }
  // Id completo ou o comeco dele (o que sessoes_abertas mostra).
  const id = raw.toLowerCase().replace(/^#/, '');
  if (/^[0-9a-f-]{4,}$/.test(id)) {
    const byId = all.filter((x) => x.session.id === id || x.session.id.startsWith(id));
    if (byId.length === 1) return { pick: byId[0], candidates: byId };
  }
  // Numero de abertura: o da lista geral; se ele nao for do projeto, o n-esimo do projeto.
  const n = spokenNumber(raw);
  if (n !== null) {
    const pick = pool.find((x) => x.n === n) ?? (pool !== all ? pool[n - 1] : undefined);
    return { pick, candidates: pick ? [pick] : [] };
  }
  // Agente ("a do codex") e/ou palavras do titulo ("a que corrige o login").
  const agent = words.map((w) => AGENTS[w]).find(Boolean);
  const rest = words.filter((w) => !AGENTS[w] && !LATEST.has(w));
  let list = agent ? pool.filter((x) => x.session.agent === agent) : pool;
  if (rest.length) {
    const q = rest.join('');
    const scored = list
      .map((x) => {
        const title = tokens(x.session.title);
        const common = rest.filter((w) => title.some((t) => t === w || (w.length >= 4 && t.startsWith(w.slice(0, -1))))).length;
        return { x, score: Math.max(common / rest.length, similarity(title.join(''), q)) };
      })
      .filter((r) => r.score >= 0.34)
      .sort((a, b) => b.score - a.score);
    if (!scored.length) return { candidates: [] };
    const close = scored.filter((r) => scored[0].score - r.score < 0.1).map((r) => r.x);
    if (close.length > 1) return { candidates: close };
    return { pick: close[0], candidates: close };
  }
  if (!list.length) return { candidates: [] };
  if (words.some((w) => LATEST.has(w)) || list.length === 1) {
    const pick = latest(list);
    return { pick, candidates: [pick] };
  }
  return { candidates: list };
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

const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Texto que o cerebro le de uma busca: resumo da Wikipedia e os primeiros resultados, com o site. */
export function formatWebSearch(r: WebSearch): string {
  if (!r.results.length && !r.summary && !r.answer) {
    return r.errors.length
      ? `Não consegui pesquisar agora (${r.errors.join('; ')}). Diga isso ao usuário em poucas palavras.`
      : `Não achei nada na web sobre "${r.query}". Diga isso ao usuário e sugira outras palavras.`;
  }
  const lines = [`Busca na web por "${r.query}".`];
  if (r.answer) lines.push(`Pesquisa na web (já resumida, com as fontes):\n${r.answer.slice(0, 3000)}`);
  if (r.results.length) {
    lines.push('Resultados:');
    r.results.forEach((x, i) => lines.push(`${i + 1}. ${x.title} (${host(x.url)})${x.snippet ? `: ${x.snippet.slice(0, 300)}` : ''}`));
  }
  // A Wikipedia vem por ultimo: e o artigo mais proximo, que pode ser de outro assunto ou antigo.
  if (r.summary) {
    lines.push(
      `Contexto da Wikipedia, artigo "${r.summary.title}" (pode ser outro assunto ou estar desatualizado; para fatos recentes, valem os resultados acima): ${r.summary.extract.slice(0, 900)}`,
    );
  }
  if (r.errors.length) lines.push(`Fontes indisponíveis: ${r.errors.join('; ')}.`);
  lines.push(
    'Responda em voz em uma a três frases com os pontos principais, dizendo de qual site veio a informação; se os resultados divergirem ou parecerem desatualizados, avise. Ofereça contar mais em vez de ler tudo.',
  );
  return lines.join('\n');
}

/** Implementacao dos comandos; cada um devolve o texto que o cerebro le (e resume em voz). */
export function jarvisHandlers(ctx: JarvisContext) {
  const evolution = (): EvolutionApi => {
    if (!ctx.evolution) throw new Error('a evolução do Jarvis não está disponível neste servidor');
    return ctx.evolution;
  };
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
  const projectName = (path: string, list: ProjectSummary[]) => list.find((p) => p.path === path)?.name ?? path.split('/').pop() ?? path;
  const status = (s: SessionInfo) => (s.alive ? 'em execução' : 'encerrada');
  const describe = (x: Numbered, list: ProjectSummary[]) =>
    `nº ${x.n} · ${projectName(x.session.projectPath, list)} · ${LABEL[x.session.agent]} · ${status(x.session)} · ${x.session.title} · id ${x.session.id.slice(0, 8)}`;
  /**
   * A sessao pedida: de um projeto e/ou por seletor (numero, id, titulo, agente).
   * Sem seletor, a mais relevante; `others` sao as outras em execucao no mesmo
   * filtro, para o cerebro saber que havia escolha.
   */
  async function pickSession(projeto?: string, sessao?: string) {
    const list = await ctx.projects();
    const r = projeto?.trim() ? await pick(projeto) : null;
    if (projeto?.trim() && !r?.project) return { list, error: notFound(projeto, list, r?.candidates) };
    const project = r?.project ?? null;
    const all = numberSessions(ctx.sessions());
    const pool = all.filter((x) => !project || x.session.projectPath === project.path);
    const where = project ? ` em ${project.name}` : '';
    if (!pool.length) return { list, error: `Não há sessão aberta${where}.` };
    const { pick: chosen, candidates } = resolveSession(pool, sessao, all);
    if (!chosen) {
      const options = (candidates.length > 1 ? candidates : pool).map((x) => describe(x, list)).join('\n');
      return {
        list,
        error: candidates.length > 1
          ? `Mais de uma sessão${where} combina com "${sessao}":\n${options}\nPergunte ao usuário qual delas (pelo número).`
          : `Não achei a sessão "${sessao}"${where}. Sessões:\n${options}\nPergunte ao usuário qual delas.`,
      };
    }
    const others = sessao?.trim() ? [] : pool.filter((x) => x !== chosen && x.session.alive);
    return { list, session: chosen.session, n: chosen.n, others };
  }
  /** Aviso de que havia outras sessoes e qual foi escolhida. */
  const alsoOpen = (others: Numbered[] | undefined) =>
    others?.length ? `\n(Usei a mais recente; também estão abertas: ${others.map((x) => `nº ${x.n} ${LABEL[x.session.agent]} "${x.session.title}"`).join(', ')}. Se o usuário quis outra, use o parâmetro sessao.)` : '';

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
      return `Projeto ${project.name} aberto na tela.`;
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
    async sessoes_abertas({ projeto }: { projeto?: string }) {
      const list = await ctx.projects();
      let all = numberSessions(ctx.sessions());
      if (projeto?.trim()) {
        const r = await pick(projeto);
        if (!r.project) return notFound(projeto, list, r.candidates);
        all = all.filter((x) => x.session.projectPath === r.project!.path);
        if (!all.length) return `Não há sessão aberta em ${r.project.name}.`;
      }
      if (!all.length) return 'Nenhuma sessão aberta.';
      return all
        .map((x) => {
          const doing = x.session.alive ? sessionActivity(ctx.sessionOutput(x.session.id) ?? '') : '';
          return `${describe(x, list)}${doing ? ` · agora: ${doing}` : ''}`;
        })
        .join('\n');
    },
    async estado_da_sessao({ projeto, sessao }: { projeto?: string; sessao?: string }) {
      const { list, session: s, n, others, error } = await pickSession(projeto, sessao);
      if (!s) return error;
      const tail = stripAnsi(ctx.sessionOutput(s.id) ?? '')
        .split('\n')
        .map((l) => l.trimEnd())
        .filter(Boolean)
        .slice(-40)
        .join('\n')
        .slice(-2500);
      return `Sessão nº ${n}, ${LABEL[s.agent]} em ${projectName(s.projectPath, list)}, "${s.title}" (${status(s)}). Últimas linhas do terminal:\n${tail || '(sem saída ainda)'}${alsoOpen(others)}`;
    },
    async enviar_para_sessao({ projeto, sessao, mensagem }: { projeto?: string; sessao?: string; mensagem: string }) {
      const { list, session: s, n, others, error } = await pickSession(projeto, sessao);
      if (!s) return error;
      if (!s.alive || !ctx.sendToSession(s.id, mensagem)) return `A sessão nº ${n} já foi encerrada.`;
      ctx.ui({ kind: 'focus-session', id: s.id });
      return `Enviei para o ${LABEL[s.agent]} de ${projectName(s.projectPath, list)} (sessão nº ${n}, "${s.title}").${alsoOpen(others)}`;
    },
    async falar_direto_com_sessao({ projeto, sessao }: { projeto?: string; sessao?: string }) {
      const { list, session: s, n, error } = await pickSession(projeto, sessao);
      if (!s) return error;
      if (!s.alive) return `A sessão nº ${n} já foi encerrada.`;
      const label = `${LABEL[s.agent]} de ${projectName(s.projectPath, list)}`;
      ctx.relay({ id: s.id, label });
      ctx.ui({ kind: 'focus-session', id: s.id });
      return `Conversa direta com o ${label} (sessão nº ${n}) ligada; a tela já mostra como enviar e sair. Confirme em poucas palavras que o usuário pode falar.`;
    },
    async fechar_sessao({ projeto, sessao }: { projeto?: string; sessao?: string }) {
      const { list, session: s, n, error } = await pickSession(projeto, sessao);
      if (!s) return error;
      ctx.closeSession(s.id);
      return `Fechei o terminal do ${LABEL[s.agent]} de ${projectName(s.projectPath, list)} (sessão nº ${n}).`;
    },
    async encerrar_conversa({ resumo }: { resumo?: string }) {
      if (resumo?.trim()) ctx.memory.setSummary(resumo);
      ctx.endConversation();
      return 'Conversa encerrada: depois desta resposta, você volta a esperar ser chamado pelo nome.';
    },
    async lembrar({ fato, sobre, projeto, substitui }: { fato: string; sobre: MemoryTopic; projeto?: string; substitui?: string }) {
      if (substitui && !ctx.memory.facts().some((f) => f.id === substitui)) {
        throw new Error(`não encontrei o fato ${substitui} para substituir`);
      }
      const f = ctx.memory.remember({ text: fato, about: sobre, project: projeto, replaces: substitui });
      return `Guardado [${f.id}].`;
    },
    async esquecer({ trecho, sobre }: { trecho?: string; sobre?: MemoryTopic }) {
      const n = ctx.memory.forget({ text: trecho, about: sobre });
      return n ? `Apaguei ${n} ${n === 1 ? 'fato' : 'fatos'}.` : 'Não encontrei nada guardado com isso.';
    },
    async o_que_voce_lembra({ sobre, projeto }: { sobre?: MemoryTopic; projeto?: string }) {
      const facts = ctx.memory.facts({ about: sobre, project: projeto });
      if (!facts.length) return 'Nada guardado sobre isso ainda.';
      return facts.map((f) => `[${f.id}] ${f.project ? `(${f.project}) ` : ''}${f.text}`).join('\n');
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
    async pesquisar_na_web({ assunto }: { assunto: string }) {
      if (!assunto?.trim()) return 'Pergunte ao usuário o que ele quer pesquisar.';
      return formatWebSearch(await ctx.webSearch(assunto));
    },
    async rascunhar_evolucao({ titulo, especificacao }: { titulo: string; especificacao: string }) {
      return evolution().draft(titulo, especificacao);
    },
    async resumir_evolucao({ resumo }: { resumo: string }) {
      return evolution().summarize(resumo, ctx.userTurn?.() ?? 0);
    },
    async iniciar_evolucao(_args: Record<string, never>) {
      return evolution().start(ctx.userTurn?.() ?? 0);
    },
    async status_evolucao(_args: Record<string, never>) {
      return evolution().status();
    },
    async aplicar_evolucao({ confirmar_fechar_sessoes }: { confirmar_fechar_sessoes?: boolean }) {
      return evolution().apply({ closeSessions: confirmar_fechar_sessoes === true });
    },
    async descartar_evolucao(_args: Record<string, never>) {
      return evolution().discard();
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
  const sessao = z
    .string()
    .optional()
    .describe('Qual sessão: o número de abertura de sessoes_abertas ("2", "a segunda"), o id (ou o começo dele), o agente ("codex") ou palavras do título. Vazio: a mais recente.');
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
      tool(
        'sessoes_abertas',
        'Lista as sessões abertas, numeradas pela ordem de abertura (a mesma das abas da gaveta), com projeto, agente, situação, título, id curto e o que cada uma está fazendo agora (últimas linhas do terminal).',
        { projeto: z.string().optional().describe('Só as sessões deste projeto.') },
        run(h.sessoes_abertas),
      ),
      tool(
        'estado_da_sessao',
        'Lê as últimas linhas do terminal de uma sessão para contar o progresso. Escolha a sessão por projeto e/ou sessao; sem sessao, usa a mais recente (do projeto, ou de todas).',
        { projeto: z.string().optional().describe('Nome do projeto da sessão.'), sessao },
        run(h.estado_da_sessao),
      ),
      tool(
        'enviar_para_sessao',
        'Digita uma mensagem numa sessão aberta e envia, como se o usuário tivesse digitado. Escolha a sessão por projeto e/ou sessao; sem sessao, vai para a mais recente. Repasse o pedido do usuário fiel ao que ele disse.',
        { projeto: z.string().optional().describe('Projeto da sessão.'), sessao, mensagem: z.string().describe('Texto a enviar para o agente da sessão.') },
        run(h.enviar_para_sessao),
      ),
      tool(
        'falar_direto_com_sessao',
        'Liga a conversa direta por voz com uma sessão: as próximas falas do usuário vão direto para o agente dela, sem passar por você, até ele dizer "Jarvis, volta".',
        { projeto: z.string().optional().describe('Projeto da sessão.'), sessao },
        run(h.falar_direto_com_sessao),
      ),
      tool(
        'fechar_sessao',
        'Fecha o terminal de uma sessão aberta (a escolhida por projeto e/ou sessao; sem sessao, a mais recente), encerrando o agente dela.',
        { projeto: z.string().optional().describe('Projeto da sessão.'), sessao },
        run(h.fechar_sessao),
      ),
      tool(
        'encerrar_conversa',
        'Encerra a conversa por voz: depois da sua resposta, você volta a esperar o usuário chamar "Jarvis". Use quando ele se despedir ou disser que é só isso. Passe em resumo uma frase sobre o que foi feito ou decidido nesta conversa.',
        { resumo: z.string().optional().describe('Uma frase: o que foi feito ou decidido nesta conversa.') },
        run(h.encerrar_conversa),
      ),
      tool(
        'lembrar',
        'Guarda um fato duradouro para as próximas conversas: sobre o usuário, preferências, pessoas, projetos (metas, decisões, stack, prazos). Para corrigir um fato que mudou, passe o id dele em substitui.',
        {
          fato: z.string().describe('O fato, numa frase curta e autossuficiente.'),
          sobre: z.enum(TOPICS),
          projeto: z.string().optional().describe('Nome do projeto, se o fato for de um projeto.'),
          substitui: z.string().optional().describe('Id ([abc123]) do fato antigo que este corrige.'),
        },
        run(h.lembrar),
      ),
      tool(
        'esquecer',
        'Apaga fatos guardados que contêm um trecho, ou todos de um assunto. Antes de apagar um assunto inteiro, confirme com o usuário.',
        { trecho: z.string().optional(), sobre: z.enum(TOPICS).optional() },
        run(h.esquecer),
      ),
      tool(
        'o_que_voce_lembra',
        'Lista o que você guardou (de um assunto ou projeto, ou tudo). Use quando o usuário perguntar o que você sabe ou lembra.',
        { sobre: z.enum(TOPICS).optional(), projeto: z.string().optional() },
        run(h.o_que_voce_lembra),
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
      tool(
        'pesquisar_na_web',
        'Pesquisa um assunto na web (DuckDuckGo e Wikipedia) e devolve os principais resultados com o site de cada um. Use para fatos atuais, preços, pessoas, lugares, definições ou qualquer coisa que você não saiba com certeza ou que pode ter mudado. Resuma em voz, em poucas frases, citando a fonte.',
        { assunto: z.string().describe('O que pesquisar: palavras-chave claras, em português (ou na língua do assunto).') },
        run(h.pesquisar_na_web),
      ),
      tool(
        'rascunhar_evolucao',
        'Guarda ou atualiza a proposta de uma funcionalidade nova para você mesmo (o Jarvis), enquanto a define com o usuário. Chame a cada resposta dele, com a especificação completa até agora.',
        {
          titulo: z.string().describe('Nome curto da funcionalidade.'),
          especificacao: z
            .string()
            .describe('Texto completo: objetivo, o que dispara, o que você faz ou diz, onde aparece na tela, casos especiais e o que fica de fora.'),
        },
        run(h.rascunhar_evolucao),
      ),
      tool(
        'resumir_evolucao',
        'Primeiro OK: quando o usuário disser que a definição está certa, registre o resumo do que será desenvolvido (3 a 5 frases) e leia-o para ele, perguntando se pode começar.',
        { resumo: z.string() },
        run(h.resumir_evolucao),
      ),
      tool(
        'iniciar_evolucao',
        'Segundo OK: começa o desenvolvimento em background. Só chame depois que o usuário ouviu o resumo e aprovou, numa fala seguinte.',
        {},
        run(h.iniciar_evolucao),
      ),
      tool('status_evolucao', 'Como está a funcionalidade nova (em definição, em desenvolvimento, pronta).', {}, run(h.status_evolucao)),
      tool(
        'aplicar_evolucao',
        'Aplica a funcionalidade nova pronta: verifica, instala e reinicia o Jarvis. Só quando o usuário pedir ou aceitar. Se a resposta pedir confirmação para fechar sessões, pergunte a ele e chame de novo com confirmar_fechar_sessoes.',
        { confirmar_fechar_sessoes: z.boolean().optional() },
        run(h.aplicar_evolucao),
      ),
      tool('descartar_evolucao', 'Descarta a funcionalidade nova (proposta, desenvolvimento ou pronta, ainda não aplicada).', {}, run(h.descartar_evolucao)),
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
