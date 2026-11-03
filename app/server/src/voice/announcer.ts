import type { DayInfo, NewsItem, Weather } from '../types.ts';
import { NewsHistory } from './news-history.ts';

// Falas espontaneas do Jarvis enquanto ninguem esta falando com ele: ao ligar,
// na virada do periodo do dia e com notícias novas de tempos em tempos.

export type Period = 'madrugada' | 'manha' | 'tarde' | 'noite';

export function periodOf(d: Date): Period {
  const h = d.getHours();
  if (h < 5) return 'madrugada';
  if (h < 12) return 'manha';
  if (h < 18) return 'tarde';
  return 'noite';
}

const pick = <T>(list: T[], random: () => number): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))];

const GREETING: Record<Period, string> = {
  madrugada: 'Boa noite',
  manha: 'Bom dia',
  tarde: 'Boa tarde',
  noite: 'Boa noite',
};

export function startupPhrase(d: Date, weather: Weather | null, random: () => number = Math.random): string {
  const parts = [`${GREETING[periodOf(d)]}, senhor.`];
  if (weather) parts.push(`Agora faz ${weather.temperature} graus, ${weather.description}.`);
  parts.push(pick(['Estou à disposição.', 'Tudo pronto por aqui.', 'Sistemas no ar, é só chamar.'], random));
  return parts.join(' ');
}

const PERIOD_PHRASES: Record<Period, string[]> = {
  manha: ['Bom dia, senhor. Já amanheceu.', 'Já é de manhã, senhor.'],
  tarde: ['Já está à tarde, senhor.', 'Boa tarde, senhor. Já passou do meio-dia.'],
  noite: ['Já está ficando a noite, senhor.', 'Boa noite, senhor. O dia já virou noite.'],
  madrugada: ['Já é madrugada, senhor. Talvez seja hora de descansar.', 'Já passou da meia-noite, senhor.'],
};

export const periodPhrase = (p: Period, random: () => number = Math.random): string => pick(PERIOD_PHRASES[p], random);

const from = (n: NewsItem): string => (n.source ? `, segundo ${n.source === 'G1' ? 'o G1' : n.source}` : '');

export function newsPhrase(items: NewsItem[]): string {
  if (items.length === 1) return `Senhor, uma novidade${items[0].source ? ` do ${items[0].source}` : ''}: ${items[0].title}.`;
  return `Senhor, ${items.length === 2 ? 'duas notícias' : 'algumas notícias'}: ${items.map((n) => `${n.title}${from(n)}`).join('; e ')}.`;
}

export interface AnnouncerOptions {
  now?: () => number;
  /** Clima e notícias (o mesmo servico do painel do dia). */
  day: () => Promise<DayInfo>;
  /** Fala, se o Jarvis estiver livre; falso para tentar de novo depois. */
  say: (text: string) => boolean;
  newsEveryMs?: number;
  /** Notícias so entre estas horas (inclusive a primeira, exclusive a ultima). */
  newsHours?: [number, number];
  random?: () => number;
  tickMs?: number;
  /** Manchetes ja apresentadas (o mesmo historico da ferramenta de noticias). */
  history?: NewsHistory;
}

export class Announcer {
  private readonly opts: Required<Omit<AnnouncerOptions, 'tickMs' | 'history'>> & { tickMs: number };
  private period: Period | undefined;
  private pendingPeriod: string | undefined;
  private lastNews = -Infinity;
  private readonly history: NewsHistory;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: AnnouncerOptions) {
    this.opts = {
      now: Date.now,
      newsEveryMs: 90 * 60e3,
      newsHours: [8, 22],
      random: Math.random,
      tickMs: 60e3,
      ...opts,
    };
    this.history = opts.history ?? new NewsHistory(undefined, this.opts.now);
  }

  /** Saudacao inicial e primeira rodada; depois verifica uma vez por minuto. */
  async start(): Promise<void> {
    const d = new Date(this.opts.now());
    this.period = periodOf(d);
    const info = await this.opts.day().catch(() => null);
    this.opts.say(startupPhrase(d, info?.weather ?? null, this.opts.random));
    this.timer = setInterval(() => void this.tick(), this.opts.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    const d = new Date(this.opts.now());
    const p = periodOf(d);
    if (p !== this.period) {
      this.period = p;
      this.pendingPeriod = periodPhrase(p, this.opts.random);
    }
    if (this.pendingPeriod && this.opts.say(this.pendingPeriod)) this.pendingPeriod = undefined;

    const [from, to] = this.opts.newsHours;
    const h = d.getHours();
    if (h < from || h >= to || this.opts.now() - this.lastNews < this.opts.newsEveryMs) return;
    const info = await this.opts.day().catch(() => null);
    const fresh = this.history.fresh(info?.news ?? []).slice(0, 2);
    if (!fresh.length) {
      this.lastNews = this.opts.now();
      return;
    }
    if (!this.opts.say(newsPhrase(fresh))) return; // ocupado: tenta no proximo minuto
    this.history.mark(fresh);
    this.lastNews = this.opts.now();
  }
}
