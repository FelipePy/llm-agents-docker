import type { SessionInfo } from '../types.ts';

// Sessoes que o usuario pediu para acompanhar: o Jarvis le o terminal em
// segundo plano e avisa por voz uma vez, quando a tarefa termina ou da erro.
// Depois do aviso a sessao sai da lista, mas fica lembrada: um recado novo
// para ela (rewatch) volta a acompanha-la, ate o usuario pedir para parar.

export type WatchOutcome = 'done' | 'error';

export interface WatchReport {
  id: string;
  label: string;
  outcome: WatchOutcome;
  /** Ultimas linhas do terminal (sem cores), para o resumo. */
  tail: string;
  /** Linha de erro encontrada, se houver. */
  error?: string;
  /** Quando a tela parou de mudar (ausente se o processo encerrou). */
  stoppedAt?: number;
}

/** Resume o fim da sessao em poucas frases para falar; pode falhar (usa-se o texto simples). */
export type WatchSummarizer = (r: WatchReport) => Promise<string>;

export interface SessionWatcherOptions {
  sessions: () => SessionInfo[];
  output: (id: string) => string | null;
  now?: () => number;
  /** Tempo sem saida nova para considerar a tarefa terminada, sem indicador de trabalho (o shell, por exemplo). */
  quietMs?: number;
  /** O mesmo, depois de o agente mostrar o indicador de trabalho: tela parada e sem indicador e o fim da tarefa. */
  idleMs?: number;
  summarize?: WatchSummarizer;
  /** Registro dos tempos de cada aviso. */
  log?: (line: string) => void;
}

interface Watched {
  label: string;
  last: string;
  changedAt: number;
  /** O agente ja mostrou o indicador de trabalho desde que o acompanhamento comecou. */
  sawWorking: boolean;
}

/** Aviso em andamento: o curto sai na hora, o resumo quando ficar pronto. */
interface PendingNotice {
  report: WatchReport;
  detectedAt: number;
  quickAt?: number;
  summary?: string;
  summaryAt?: number;
}

/** Depois do aviso: se o agente voltar a trabalhar neste prazo, o "terminou" era so uma pausa entre etapas. */
const REARM_MS = 60_000;

export function stripTerminal(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    // Movimentos do cursor viram quebra de linha (ou espaco), para as telas redesenhadas nao grudarem.
    .replace(/\x1b\[[0-9;?]*[ -/]*([@-~])/g, (_m, f: string) => ('ABEFHfd'.includes(f) ? '\n' : f === 'C' ? ' ' : ''))
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\r/g, '');
}

/** Linhas com texto de verdade (sem molduras nem dicas da interface do agente). */
export function usefulLines(output: string): string[] {
  return stripTerminal(output)
    .split('\n')
    .map((l) => l.replace(/[─-▟⠀-⣿]+/g, ' ').replace(/^[\s●⎿✗✘×•·*>$#%-]+/u, '').replace(/\s+/g, ' ').trim())
    .filter((l) => /[\p{L}\p{N}]{2}/u.test(l))
    .filter((l) => !/^(\? for shortcuts|bypass permissions|esc to interrupt|accept edits|auto-accept)/i.test(l));
}

// Agente ainda trabalhando: o Claude e o Codex mostram "esc to interrupt" enquanto pensam.
const BUSY = /esc to interrupt|esc para interromper|esc to cancel/i;

// Erros de verdade: linhas que comecam como mensagem de erro, nao frases que citam "erro".
const ERROR = new RegExp(
  [
    '^API Error',
    '^(Uncaught )?\\w*Error:',
    '^error(\\[\\w+\\])?:',
    '^erro:',
    '^fatal:',
    '^panic(ked)?\\b',
    '^Traceback \\(most recent call last\\)',
    '^npm ERR!',
    '^Segmentation fault',
    '^zsh: command not found',
    '^command not found',
    'rate limit',
    'Credit balance is too low',
    'Request timed out',
    'Connection error',
    'usage limit',
  ].join('|'),
  'i',
);

/** Linha de erro entre as ultimas linhas do terminal, ou null. */
export function findError(output: string, lines = 8): string | null {
  const recent = usefulLines(output).slice(-lines);
  for (let i = recent.length - 1; i >= 0; i--) if (ERROR.test(recent[i])) return recent[i].slice(0, 200);
  return null;
}

// O indicador fica colado na caixa de texto, no fim da tela. Olhar so ali evita que o agente,
// ao citar a frase numa resposta, pareca trabalhando para sempre.
const INDICATOR_LINES = 10;
const indicatorArea = (output: string): string => stripTerminal(output.slice(-3000)).split('\n').slice(-INDICATOR_LINES).join('\n');

/** Ainda trabalhando? (o indicador do agente no fim da tela) */
export function looksBusy(output: string): boolean {
  return BUSY.test(indicatorArea(output));
}

// Mais estrito que o BUSY: um dialogo parado (o aviso de confianca) tambem mostra "esc to cancel".
const WORKING = /esc to interrupt|esc para interromper/i;

/** Sessoes com um agente trabalhando agora. O shell fica de fora: nao ha como saber se ele esta ocupado. */
export function countWorking(sessions: SessionInfo[], output: (id: string) => string | null): number {
  const working = (id: string) => WORKING.test(stripTerminal((output(id) ?? '').slice(-3000)));
  return sessions.filter((s) => s.alive && s.agent !== 'shell' && working(s.id)).length;
}

export const tailOf = (output: string, lines = 30, max = 2500): string => usefulLines(output).slice(-lines).join('\n').slice(-max);

/** Aviso curto, falado assim que a tarefa termina, antes do resumo. */
export function quickReport(r: WatchReport): string {
  return `Senhor, a sessão do ${r.label} ${r.outcome === 'error' ? 'deu erro' : 'terminou'}.`;
}

/** O que vem depois do aviso curto quando nao ha resumo do cerebro: o essencial das ultimas linhas. */
export function plainReport(r: WatchReport): string {
  if (r.outcome === 'error') return `O erro foi: ${r.error ?? 'veja o terminal'}.`;
  const last = r.tail.split('\n').slice(-2).join(' ').slice(-200);
  return `${last ? `As últimas linhas dizem: ${last}. ` : ''}Quer que eu conte mais?`;
}

const TRUST_PROMPT = /Yes, I trust this folder|Do you trust the contents of this directory/;
// Os dialogos ficam colados no fim da tela: o que rolou para cima nao esta mais esperando.
const DIALOG_LINES = 30;
const dialogArea = (screen: string): string[] => screen.split('\n').slice(-DIALOG_LINES);

/** O agente esta parado na tela de confiar na pasta. Olha so o fim: a sessao pode ter citado a frase antes. */
export function waitingForTrust(screen: string): boolean {
  return TRUST_PROMPT.test(dialogArea(screen).join('\n'));
}

// O cursor dos menus do Claude (❯) e do Codex (›). A caixa de texto usa o mesmo sinal, por isso vale so o ultimo.
const CURSOR = /^(\s*)[❯›](\s+|$)/u;
// O menu pede uma resposta: uma pergunta, ou o rodape das telas de inicio do Codex (a de atualizar nao pergunta nada).
const ASKS = /\p{L}\?(\s|$)|press enter to continue/iu;
/** Ate onde procurar a pergunta acima do cursor: as opcoes e o comando ficam entre os dois. */
const QUESTION_LINES = 15;

/** Outra opcao do menu: alinhada com o texto do cursor (ou mais para dentro, como a descricao de uma opcao). */
const isOption = (line: string | undefined, column: number): boolean =>
  line !== undefined && line.search(/\S/) >= column && /[\p{L}\p{N}]/u.test(line);

/**
 * Filtro local, sem o cerebro, para o aviso sair na hora: um menu com cursor e uma pergunta logo
 * acima dele. A caixa de texto (mesmo com rascunho) nao tem opcoes em volta, e um menu aberto pelo
 * usuario, como o /model, nao pergunta nada.
 */
export function waitingForDecision(screen: string): boolean {
  if (waitingForTrust(screen)) return true;
  const lines = dialogArea(screen);
  const at = lines.findLastIndex((l) => CURSOR.test(l));
  if (at < 0) return false;
  const cursor = CURSOR.exec(lines[at])!;
  if (cursor[0].length === lines[at].length) return false;
  const column = cursor[0].length;
  if (!isOption(lines[at - 1], column) && !isOption(lines[at + 1], column)) return false;
  return lines.slice(Math.max(0, at - QUESTION_LINES)).some((l) => ASKS.test(l));
}

/** Frase fixa e curta: o aviso nao espera o cerebro. */
export function decisionNotice(title: string, screen: string): string {
  return waitingForTrust(screen)
    ? `Senhor, a sessão "${title}" está esperando você confirmar, no terminal dela, que confia na pasta.`
    : `Senhor, a sessão "${title}" está esperando uma decisão sua no terminal.`;
}

/**
 * Sessoes de agente paradas pedindo uma resposta do usuario. A espera curta deixa de fora o dialogo
 * que o usuario responde na hora. Avisa uma vez por pergunta: responder libera o aviso da proxima.
 */
export class DecisionWatcher {
  private readonly since = new Map<string, number>();
  private readonly warned = new Set<string>();
  private readonly sessions: () => SessionInfo[];
  private readonly output: (id: string) => string | null;
  private readonly now: () => number;
  private readonly graceMs: number;
  private readonly log?: (line: string) => void;

  constructor(opts: { sessions: () => SessionInfo[]; output: (id: string) => string | null; now?: () => number; graceMs?: number; log?: (line: string) => void }) {
    this.sessions = opts.sessions;
    this.output = opts.output;
    this.now = opts.now ?? Date.now;
    this.graceMs = opts.graceMs ?? 2_000;
    this.log = opts.log;
  }

  /**
   * Fala o que puder agora. `say` devolve falso quando o Jarvis esta ocupado: o aviso fica para a
   * proxima chamada, e some sozinho se o usuario responder na tela.
   */
  deliver(say: (text: string) => boolean): void {
    for (const s of this.sessions()) {
      const screen = s.alive && s.agent !== 'shell' ? (this.output(s.id) ?? '') : '';
      if (!waitingForDecision(screen)) {
        this.since.delete(s.id);
        this.warned.delete(s.id);
        continue;
      }
      if (this.warned.has(s.id)) continue;
      const since = this.since.get(s.id) ?? this.now();
      this.since.set(s.id, since);
      if (this.now() - since < this.graceMs || !say(decisionNotice(s.title, screen))) continue;
      this.warned.add(s.id);
      this.log?.(`aviso de decisão de "${s.title}": falado ${((this.now() - since) / 1000).toFixed(1)} s depois de aparecer`);
    }
  }
}

export class SessionWatcher {
  private readonly watched = new Map<string, Watched>();
  /** Sessoes ja acompanhadas (com o rotulo), mesmo depois do aviso. */
  private readonly followed = new Map<string, string>();
  private readonly now: () => number;
  private readonly quietMs: number;
  private readonly idleMs: number;
  /** Sessoes recem-avisadas: voltam a ser acompanhadas se o agente voltar a trabalhar. */
  private readonly recent = new Map<string, { label: string; at: number }>();
  private readonly pending: PendingNotice[] = [];
  private readonly opts: SessionWatcherOptions;

  constructor(opts: SessionWatcherOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.quietMs = opts.quietMs ?? 30_000;
    this.idleMs = opts.idleMs ?? 3_000;
  }

  watch(id: string, label: string): void {
    this.followed.set(id, label);
    this.recent.delete(id);
    this.watched.set(id, { label, last: (this.opts.output(id) ?? '').slice(-4000), changedAt: this.now(), sawWorking: false });
  }

  /** Para de acompanhar e esquece a sessao (um recado novo nao a acompanha mais). */
  unwatch(id: string): boolean {
    const followed = this.followed.delete(id);
    this.recent.delete(id);
    const pending = this.pending.findIndex((p) => p.report.id === id);
    if (pending >= 0) this.pending.splice(pending, 1);
    return this.watched.delete(id) || followed;
  }

  /** Volta a acompanhar uma sessao ja acompanhada antes (recado novo); falso se ela nao era. */
  rewatch(id: string): boolean {
    const label = this.followed.get(id);
    if (label === undefined) return false;
    this.watch(id, label);
    return true;
  }

  isWatching(id: string): boolean {
    return this.watched.has(id);
  }

  list(): { id: string; label: string }[] {
    return [...this.watched].map(([id, w]) => ({ id, label: w.label }));
  }

  /** Sessoes que terminaram ou deram erro desde a ultima vez (e deixam de ser acompanhadas). */
  reports(): WatchReport[] {
    const out: WatchReport[] = [];
    const sessions = new Map(this.opts.sessions().map((s) => [s.id, s]));
    this.rearm(sessions);
    for (const [id, w] of this.watched) {
      const s = sessions.get(id);
      if (!s) {
        // Fechada pelo usuario: nao ha o que avisar.
        this.unwatch(id);
        continue;
      }
      const output = this.opts.output(id) ?? '';
      const tail = tailOf(output);
      const report = (outcome: WatchOutcome, error?: string, stoppedAt?: number) => {
        this.watched.delete(id);
        this.recent.set(id, { label: w.label, at: this.now() });
        out.push({ id, label: w.label, outcome, tail, ...(error ? { error } : {}), ...(stoppedAt === undefined ? {} : { stoppedAt }) });
      };
      if (!s.alive) {
        const error = findError(output);
        if (s.exitCode || error) report('error', error ?? `o processo saiu com código ${s.exitCode}`);
        else report('done');
        continue;
      }
      if (s.agent !== 'shell' && WORKING.test(indicatorArea(output))) w.sawWorking = true;
      const last = output.slice(-4000);
      if (last !== w.last) {
        w.last = last;
        w.changedAt = this.now();
        continue;
      }
      // O indicador de trabalho anima a tela: parada e sem ele, a tarefa acabou. Sem ter visto o indicador, so o tempo diz.
      // Parada num dialogo nao terminou: quem avisa e o DecisionWatcher, e a tela muda quando o usuario responder.
      if (this.now() - w.changedAt < (w.sawWorking ? this.idleMs : this.quietMs) || looksBusy(output) || waitingForDecision(output)) continue;
      const error = findError(output);
      report(error ? 'error' : 'done', error ?? undefined, w.changedAt);
    }
    return out;
  }

  /** O agente voltou a trabalhar logo depois do aviso: era uma pausa, entao o fim de verdade tambem sera avisado. */
  private rearm(sessions: Map<string, SessionInfo>): void {
    for (const [id, r] of this.recent) {
      const s = sessions.get(id);
      if (!s?.alive || this.now() - r.at > REARM_MS) {
        this.recent.delete(id);
      } else if (WORKING.test(indicatorArea(this.opts.output(id) ?? ''))) {
        this.watch(id, r.label);
        this.watched.get(id)!.sawWorking = true;
      }
    }
  }

  /**
   * Fala o que puder agora. Quem termina recebe o aviso curto na hora e o resumo quando ele
   * ficar pronto; se o resumo chegar antes de o Jarvis ficar livre, vai tudo numa fala so.
   * `say` devolve falso quando o Jarvis esta ocupado: o aviso fica para a proxima chamada.
   */
  deliver(say: (text: string) => boolean): void {
    for (const report of this.reports()) this.startNotice(report);
    for (const p of [...this.pending]) {
      if (p.summary === undefined) {
        if (p.quickAt === undefined && say(quickReport(p.report))) p.quickAt = this.now();
        continue;
      }
      const text = this.finalText(p);
      if (text && !say(text)) continue;
      this.pending.splice(this.pending.indexOf(p), 1);
      this.logTimes(p);
    }
  }

  private startNotice(report: WatchReport): void {
    const p: PendingNotice = { report, detectedAt: this.now() };
    this.pending.push(p);
    const finish = (text: string) => {
      p.summary = text;
      p.summaryAt = this.now();
    };
    if (!this.opts.summarize) return finish('');
    // Em paralelo: um resumo demorado nao segura o aviso de outra sessao.
    this.opts.summarize(report).then((text) => finish(text ?? ''), () => finish(''));
  }

  private finalText(p: PendingNotice): string {
    const summary = (p.summary ?? '').trim().replace(/^senhor,?\s*/i, '');
    if (p.quickAt !== undefined) return summary || plainReport(p.report);
    if (summary) return `Senhor, ${summary[0].toLowerCase()}${summary.slice(1)}`;
    return `${quickReport(p.report)} ${plainReport(p.report)}`;
  }

  private logTimes(p: PendingNotice): void {
    const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
    const parts = [
      p.report.stoppedAt === undefined ? 'processo encerrado' : `tela parada ha ${secs(p.detectedAt - p.report.stoppedAt)}`,
      p.quickAt === undefined ? 'sem aviso curto' : `aviso curto em ${secs(p.quickAt - p.detectedAt)}`,
      `resumo pronto em ${secs((p.summaryAt ?? p.detectedAt) - p.detectedAt)}`,
      `fala final em ${secs(this.now() - p.detectedAt)}`,
    ];
    this.opts.log?.(`aviso de ${p.report.label}: ${parts.join(', ')}`);
  }
}
