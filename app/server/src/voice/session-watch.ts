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
}

/** Resume o fim da sessao em poucas frases para falar; pode falhar (usa-se o texto simples). */
export type WatchSummarizer = (r: WatchReport) => Promise<string>;

export interface SessionWatcherOptions {
  sessions: () => SessionInfo[];
  output: (id: string) => string | null;
  now?: () => number;
  /** Tempo sem saida nova para considerar a tarefa terminada. */
  quietMs?: number;
  summarize?: WatchSummarizer;
}

interface Watched {
  label: string;
  last: string;
  changedAt: number;
}

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

/** Ainda trabalhando? (o indicador do agente no fim da tela) */
export function looksBusy(output: string): boolean {
  return BUSY.test(stripTerminal(output.slice(-3000)));
}

// Mais estrito que o BUSY: um dialogo parado (o aviso de confianca) tambem mostra "esc to cancel".
const WORKING = /esc to interrupt|esc para interromper/i;

/** Sessoes com um agente trabalhando agora. O shell fica de fora: nao ha como saber se ele esta ocupado. */
export function countWorking(sessions: SessionInfo[], output: (id: string) => string | null): number {
  const working = (id: string) => WORKING.test(stripTerminal((output(id) ?? '').slice(-3000)));
  return sessions.filter((s) => s.alive && s.agent !== 'shell' && working(s.id)).length;
}

export const tailOf = (output: string, lines = 30, max = 2500): string => usefulLines(output).slice(-lines).join('\n').slice(-max);

/** Frase falada sem o resumo do cerebro: o essencial das ultimas linhas. */
export function plainReport(r: WatchReport): string {
  if (r.outcome === 'error') return `Senhor, a sessão do ${r.label} deu erro: ${r.error ?? 'veja o terminal'}.`;
  const last = r.tail.split('\n').slice(-2).join(' ').slice(-200);
  return `Senhor, a sessão do ${r.label} terminou${last ? `. As últimas linhas dizem: ${last}` : ''}. Quer que eu conte mais?`;
}

const TRUST_PROMPT = /Yes, I trust this folder/;

/** O Claude Code esta parado na tela de confiar na pasta. Olha so o fim: a sessao pode ter citado a frase antes. */
export function waitingForTrust(screen: string): boolean {
  return TRUST_PROMPT.test(screen.split('\n').slice(-30).join('\n'));
}

/**
 * Sessoes paradas na tela de confiar na pasta ha algum tempo. A espera poupa o aviso
 * de quem acabou de abrir o terminal e esta olhando para ela. Avisa uma vez por sessao.
 */
export class TrustWatcher {
  private readonly since = new Map<string, number>();
  private readonly warned = new Set<string>();
  private readonly sessions: () => SessionInfo[];
  private readonly output: (id: string) => string | null;
  private readonly now: () => number;
  private readonly graceMs: number;

  constructor(opts: { sessions: () => SessionInfo[]; output: (id: string) => string | null; now?: () => number; graceMs?: number }) {
    this.sessions = opts.sessions;
    this.output = opts.output;
    this.now = opts.now ?? Date.now;
    this.graceMs = opts.graceMs ?? 30_000;
  }

  /** O que falar agora. Fica pendente ate `markWarned`, e some sozinho se o usuario responder na tela. */
  pending(): { id: string; text: string }[] {
    const out: { id: string; text: string }[] = [];
    for (const s of this.sessions()) {
      if (!s.alive || s.agent !== 'claude' || this.warned.has(s.id) || !waitingForTrust(this.output(s.id) ?? '')) {
        this.since.delete(s.id);
        continue;
      }
      const since = this.since.get(s.id) ?? this.now();
      this.since.set(s.id, since);
      if (this.now() - since >= this.graceMs) {
        out.push({ id: s.id, text: `A sessão "${s.title}" ainda não começou: está parada esperando você confirmar, no terminal dela, que confia na pasta.` });
      }
    }
    return out;
  }

  markWarned(id: string): void {
    this.warned.add(id);
    this.since.delete(id);
  }
}

export class SessionWatcher {
  private readonly watched = new Map<string, Watched>();
  /** Sessoes ja acompanhadas (com o rotulo), mesmo depois do aviso. */
  private readonly followed = new Map<string, string>();
  private readonly now: () => number;
  private readonly quietMs: number;
  private checking = false;
  private readonly opts: SessionWatcherOptions;

  constructor(opts: SessionWatcherOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    this.quietMs = opts.quietMs ?? 30_000;
  }

  watch(id: string, label: string): void {
    this.followed.set(id, label);
    this.watched.set(id, { label, last: (this.opts.output(id) ?? '').slice(-4000), changedAt: this.now() });
  }

  /** Para de acompanhar e esquece a sessao (um recado novo nao a acompanha mais). */
  unwatch(id: string): boolean {
    const followed = this.followed.delete(id);
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
    for (const [id, w] of this.watched) {
      const s = sessions.get(id);
      if (!s) {
        // Fechada pelo usuario: nao ha o que avisar.
        this.unwatch(id);
        continue;
      }
      const output = this.opts.output(id) ?? '';
      const tail = tailOf(output);
      const report = (outcome: WatchOutcome, error?: string) => {
        this.watched.delete(id);
        out.push({ id, label: w.label, outcome, tail, ...(error ? { error } : {}) });
      };
      if (!s.alive) {
        const error = findError(output);
        if (s.exitCode || error) report('error', error ?? `o processo saiu com código ${s.exitCode}`);
        else report('done');
        continue;
      }
      const last = output.slice(-4000);
      if (last !== w.last) {
        w.last = last;
        w.changedAt = this.now();
        continue;
      }
      if (this.now() - w.changedAt < this.quietMs || looksBusy(output)) continue;
      const error = findError(output);
      report(error ? 'error' : 'done', error ?? undefined);
    }
    return out;
  }

  /** Avisos prontos para falar (com o resumo do cerebro, se houver). */
  async check(): Promise<string[]> {
    if (this.checking) return [];
    this.checking = true;
    try {
      const texts: string[] = [];
      for (const r of this.reports()) {
        let text = '';
        try {
          text = (await this.opts.summarize?.(r))?.trim() ?? '';
        } catch {
          // sem resumo: vai o texto simples
        }
        texts.push(text || plainReport(r));
      }
      return texts;
    } finally {
      this.checking = false;
    }
  }
}
