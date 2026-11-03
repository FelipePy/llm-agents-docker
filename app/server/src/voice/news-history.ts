// Manchetes que o Jarvis ja apresentou por voz (pedidas ou espontaneas), para
// nao repeti-las, mesmo em outra conversa. Cada uma vale por 2 dias; depois
// pode voltar a aparecer. Arquivo local do usuario (0600); sem arquivo, so em memoria.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { NewsItem } from '../types.ts';
import { normalize } from './text.ts';

export const NEWS_TTL_MS = 2 * 24 * 3600e3;

export class NewsHistory {
  /** Manchete normalizada -> quando foi apresentada (ms). */
  private seen = new Map<string, number>();
  private readonly file: string | undefined;
  private readonly now: () => number;

  constructor(file?: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    if (!file) return;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      for (const [key, at] of Object.entries(raw.seen ?? {})) if (typeof at === 'number') this.seen.set(key, at);
    } catch {
      // sem historico ainda
    }
  }

  /** Ja apresentada nos ultimos 2 dias? */
  has(title: string): boolean {
    const at = this.seen.get(normalize(title));
    return at !== undefined && this.now() - at < NEWS_TTL_MS;
  }

  /** So as que ainda nao foram apresentadas (ou ja expiraram). */
  fresh(items: NewsItem[]): NewsItem[] {
    return items.filter((n) => !this.has(n.title));
  }

  /** Marca como apresentadas e grava, descartando as expiradas. */
  mark(items: NewsItem[]): void {
    if (!items.length) return;
    const t = this.now();
    for (const [key, at] of this.seen) if (t - at >= NEWS_TTL_MS) this.seen.delete(key);
    for (const n of items) this.seen.set(normalize(n.title), t);
    this.save();
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify({ seen: Object.fromEntries(this.seen) }, null, 2) + '\n', { mode: 0o600 });
  }
}
