import { join, resolve } from 'node:path';
import type { Conversation } from './types.ts';
import { cached, isDir, listDir, mtimeIso, readJsonl } from './files.ts';

const NO_TITLE = '(sem título)';

export function shortTitle(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 80 ? one.slice(0, 79) + '…' : one;
}

interface Parsed {
  id: string;
  cwd: string;
  title: string;
  prompts: number;
}

/** Registro digitado por uma pessoa (versoes antigas nao tem "origin"). */
function isHumanPrompt(r: any): boolean {
  if (r?.type !== 'user') return false;
  if (r.origin) return r.origin.kind === 'human';
  return typeof r.message?.content === 'string' && !r.isMeta;
}

async function parseClaude(file: string): Promise<Parsed> {
  let cwd = '';
  let aiTitle = '';
  let firstPrompt = '';
  let prompts = 0;
  for await (const r of readJsonl(file)) {
    if (!cwd && typeof r?.cwd === 'string') cwd = r.cwd;
    if (r?.type === 'ai-title' && typeof r.aiTitle === 'string') aiTitle = r.aiTitle;
    if (isHumanPrompt(r)) {
      prompts++;
      const content = r.message?.content;
      if (!firstPrompt && typeof content === 'string' && !content.trimStart().startsWith('<')) firstPrompt = content;
    }
  }
  return { id: '', cwd, title: aiTitle || (firstPrompt ? shortTitle(firstPrompt) : ''), prompts };
}

async function parseCodex(file: string): Promise<Parsed> {
  let id = '';
  let cwd = '';
  let title = '';
  let prompts = 0;
  for await (const r of readJsonl(file)) {
    if (r?.type === 'session_meta' && !id) {
      id = typeof r.payload?.id === 'string' ? r.payload.id : '';
      cwd = typeof r.payload?.cwd === 'string' ? r.payload.cwd : '';
    }
    if (r?.type === 'event_msg' && r.payload?.type === 'user_message') {
      prompts++;
      if (!title && typeof r.payload.message === 'string') title = shortTitle(r.payload.message);
    }
  }
  return { id, cwd, title, prompts };
}

export async function scanClaude(home: string): Promise<Conversation[]> {
  const root = join(home, '.claude', 'projects');
  const out: Conversation[] = [];
  for (const dirName of await listDir(root)) {
    const dir = join(root, dirName);
    for (const name of await listDir(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const file = join(dir, name);
      const parsed = await cached(file, parseClaude);
      const updatedAt = await mtimeIso(file);
      if (!parsed?.cwd || !updatedAt) continue;
      out.push({
        agent: 'claude',
        id: name.slice(0, -'.jsonl'.length),
        cwd: resolve(parsed.cwd),
        title: parsed.title || NO_TITLE,
        updatedAt,
        prompts: parsed.prompts,
        claudeDir: dir,
      });
    }
  }
  return out;
}

async function* walkJsonl(dir: string): AsyncGenerator<string> {
  for (const name of await listDir(dir)) {
    const path = join(dir, name);
    if (await isDir(path)) yield* walkJsonl(path);
    else if (name.endsWith('.jsonl')) yield path;
  }
}

export async function scanCodex(home: string): Promise<Conversation[]> {
  const out: Conversation[] = [];
  for await (const file of walkJsonl(join(home, '.codex', 'sessions'))) {
    const parsed = await cached(file, parseCodex);
    const updatedAt = await mtimeIso(file);
    if (!parsed?.id || !parsed.cwd || !updatedAt) continue;
    out.push({
      agent: 'codex',
      id: parsed.id,
      cwd: resolve(parsed.cwd),
      title: parsed.title || NO_TITLE,
      updatedAt,
      prompts: parsed.prompts,
    });
  }
  return out;
}

export async function scanConversations(home: string): Promise<Conversation[]> {
  const [claude, codex] = await Promise.all([scanClaude(home), scanCodex(home)]);
  return [...claude, ...codex].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
