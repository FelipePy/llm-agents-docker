// Memoria do Jarvis entre sessoes: fatos sobre o usuario e os projetos e um
// resumo de cada conversa. Arquivo local do usuario (0600).
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalize } from './text.ts';

export const TOPICS = ['usuario', 'projeto', 'preferencia', 'pessoa', 'outro'] as const;
export type MemoryTopic = (typeof TOPICS)[number];

export interface Fact {
  id: string;
  about: MemoryTopic;
  project?: string;
  text: string;
  created: string;
  updated: string;
}

export interface ConversationSummary {
  at: string;
  text: string;
}

const MAX_FACTS = 300;
const MAX_CONVERSATIONS = 20;
const PROMPT_CONVERSATIONS = 5;
const MAX_REQUESTS = 8;

const HEADINGS: Record<MemoryTopic, string> = {
  usuario: 'Sobre o usuário',
  preferencia: 'Preferências',
  pessoa: 'Pessoas',
  projeto: 'Projetos',
  outro: 'Outros',
};

export class JarvisMemory {
  private data: { facts: Fact[]; conversations: ConversationSummary[] };
  private current: { requests: string[]; summary?: string } | undefined;
  private readonly file: string;
  private readonly now: () => Date;

  constructor(file: string, now: () => Date = () => new Date()) {
    this.file = file;
    this.now = now;
    let raw: any;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      raw = {};
    }
    this.data = {
      facts: Array.isArray(raw.facts) ? raw.facts.filter((f: Fact) => f && typeof f.text === 'string' && TOPICS.includes(f.about)) : [],
      conversations: Array.isArray(raw.conversations) ? raw.conversations.filter((c: ConversationSummary) => c && typeof c.text === 'string') : [],
    };
  }

  facts(filter: { about?: MemoryTopic; project?: string } = {}): Fact[] {
    const project = filter.project && normalize(filter.project);
    return this.data.facts.filter(
      (f) => (!filter.about || f.about === filter.about) && (!project || (f.project && normalize(f.project) === project)),
    );
  }

  remember(input: { text: string; about: MemoryTopic; project?: string; replaces?: string }): Fact {
    const text = input.text.trim().slice(0, 500);
    if (!text) throw new Error('fato vazio');
    const at = this.now().toISOString();
    const project = input.project?.trim() || undefined;
    const old = input.replaces ? this.data.facts.find((f) => f.id === input.replaces) : undefined;
    let fact: Fact;
    if (old) {
      Object.assign(old, { text, about: input.about, project, updated: at });
      fact = old;
    } else {
      fact = { id: randomBytes(3).toString('hex'), about: input.about, project, text, created: at, updated: at };
      this.data.facts.push(fact);
      if (this.data.facts.length > MAX_FACTS) {
        const oldest = [...this.data.facts].sort((a, b) => a.updated.localeCompare(b.updated))[0];
        this.data.facts = this.data.facts.filter((f) => f !== oldest);
      }
    }
    this.save();
    return { ...fact };
  }

  forget(filter: { text?: string; about?: MemoryTopic; id?: string }): number {
    const needle = filter.text ? normalize(filter.text) : '';
    if (!needle && !filter.about && !filter.id) return 0;
    const keep = this.data.facts.filter(
      (f) =>
        !(
          (!filter.id || f.id === filter.id) &&
          (!filter.about || f.about === filter.about) &&
          (!needle || normalize(`${f.project ?? ''} ${f.text}`).includes(needle))
        ),
    );
    const removed = this.data.facts.length - keep.length;
    if (removed) {
      this.data.facts = keep;
      this.save();
    }
    return removed;
  }

  conversations(): ConversationSummary[] {
    return this.data.conversations.map((c) => ({ ...c }));
  }

  startConversation(): void {
    this.current = { requests: [] };
  }

  noteRequest(text: string): void {
    this.current ??= { requests: [] };
    const req = text.trim().slice(0, 120);
    // Fala continuada depois de uma pausa: o pedido emendado substitui o pedaco anterior.
    const last = this.current.requests.at(-1);
    if (last && normalize(req).startsWith(normalize(last))) this.current.requests[this.current.requests.length - 1] = req;
    else if (this.current.requests.length < MAX_REQUESTS) this.current.requests.push(req);
  }

  setSummary(text: string): void {
    this.current ??= { requests: [] };
    this.current.summary = text.trim().slice(0, 300);
  }

  endConversation(): void {
    const c = this.current;
    this.current = undefined;
    if (!c || !c.requests.length) return;
    const text = c.summary || `Pedidos: ${c.requests.join('; ')}`;
    this.data.conversations.push({ at: this.now().toISOString(), text });
    this.data.conversations = this.data.conversations.slice(-MAX_CONVERSATIONS);
    this.save();
  }

  /** Texto para o system prompt do cerebro. */
  render(): string {
    const parts: string[] = [];
    for (const about of ['usuario', 'preferencia', 'pessoa', 'projeto', 'outro'] as MemoryTopic[]) {
      const facts = this.facts({ about });
      if (!facts.length) continue;
      const lines = facts.map((f) => `- [${f.id}] ${f.project ? `(${f.project}) ` : ''}${f.text}`);
      parts.push(`${HEADINGS[about]}:\n${lines.join('\n')}`);
    }
    const recent = this.data.conversations.slice(-PROMPT_CONVERSATIONS);
    if (recent.length) {
      const fmt = (at: string) => new Date(at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      parts.push(`Últimas conversas:\n${recent.map((c) => `- ${fmt(c.at)}: ${c.text}`).join('\n')}`);
    }
    return parts.join('\n\n');
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 });
  }
}
