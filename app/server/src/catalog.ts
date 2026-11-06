import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Agent, Conversation, Overview, Profile, ProjectDetail, ProjectSummary, Skill, TextFile } from './types.ts';
import { scanConversations } from './conversations.ts';
import { isDir, listDir, mtimeIso, parseFrontmatter, readTextFile } from './files.ts';

const execFileAsync = promisify(execFile);

export const projectId = (path: string): string => Buffer.from(path).toString('base64url');
export const projectPathFromId = (id: string): string => Buffer.from(id, 'base64url').toString('utf8');

const present = <T>(x: T | null): x is T => x !== null;

/** Conversas por projeto, sem a home, a raiz e as pastas ocultas (com o que houver dentro delas). */
function groupByProject(home: string, convs: Conversation[], hidden: string[]): Map<string, Conversation[]> {
  const excluded = new Set([resolve(home), '/']);
  // Pastas ocultas (e tudo dentro delas, como os clones de desenvolvimento do Jarvis).
  const inside = hidden.map((h) => resolve(h));
  const groups = new Map<string, Conversation[]>();
  for (const c of convs) {
    if (excluded.has(c.cwd) || inside.some((h) => c.cwd === h || c.cwd.startsWith(h + '/'))) continue;
    const list = groups.get(c.cwd) ?? [];
    list.push(c);
    groups.set(c.cwd, list);
  }
  return groups;
}

function summarize(path: string, list: Conversation[]): ProjectSummary {
  const agents = [...new Set(list.map((c) => c.agent))].sort() as Agent[];
  const updatedAt = list.map((c) => c.updatedAt).sort().at(-1) ?? '';
  return { id: projectId(path), name: basename(path), path, updatedAt, conversations: list.length, agents };
}

/** Repositorios git na pasta de projetos: filhos diretos e um nivel abaixo (ex.: trabalho/api). */
async function discoverRepos(home: string, base: string, hidden: string[]): Promise<string[]> {
  // Na home ou na raiz, a busca sairia pelos arquivos pessoais: o projeto precisa de uma pasta propria.
  if (base === resolve(home) || base === '/') return [];
  const inside = hidden.map((h) => resolve(h));
  const children = async (dir: string): Promise<string[]> => {
    const names = (await listDir(dir)).filter((n) => !n.startsWith('.') && n !== 'node_modules');
    const paths = names.map((n) => join(dir, n)).filter((p) => !inside.some((h) => p === h || p.startsWith(h + '/')));
    const dirs = await Promise.all(paths.map(async (p) => ((await isDir(p)) ? p : null)));
    return dirs.filter(present);
  };
  const isRepo = async (dir: string) => (await mtimeIso(join(dir, '.git'))) !== null;
  const found = await Promise.all(
    (await children(base)).map(async (dir) => {
      if (await isRepo(dir)) return [dir];
      const nested = await children(dir);
      const repos = await Promise.all(nested.map(async (p) => ((await isRepo(p)) ? p : null)));
      return repos.filter(present);
    }),
  );
  return found.flat();
}

export async function listProjects(
  home: string,
  convs: Conversation[],
  hidden: string[] = [],
  projectsDir?: string,
): Promise<ProjectSummary[]> {
  const out: ProjectSummary[] = [];
  for (const [path, list] of groupByProject(home, convs, hidden)) {
    if (await isDir(path)) out.push(summarize(path, list));
  }
  const known = new Set(out.map((p) => p.path));
  for (const path of await discoverRepos(home, projectsBase(home, out, projectsDir), hidden)) {
    if (known.has(path)) continue;
    // Sem conversas: a ultima atividade conhecida e a do repositorio.
    out.push({ ...summarize(path, []), updatedAt: (await mtimeIso(join(path, '.git'))) ?? '' });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Pasta onde "+ Novo projeto" cria pastas: a configurada ou a pasta-mae mais comum. So contam os
 * projetos com conversas: os repositorios achados nao mudam a pasta (e ela nao muda a propria busca).
 */
export function projectsBase(home: string, projects: ProjectSummary[], configured?: string): string {
  if (configured) return resolve(configured);
  const counts = new Map<string, number>();
  for (const p of projects) {
    if (p.conversations > 0) counts.set(dirname(p.path), (counts.get(dirname(p.path)) ?? 0) + 1);
  }
  let best = '';
  let most = 0;
  for (const [dir, n] of counts) {
    if (n > most) {
      best = dir;
      most = n;
    }
  }
  return best || join(home, 'projetos');
}

/** Linhas da saida de um comando git no projeto (vazio se falhar). */
export async function gitLines(path: string, args: string[]): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', path, ...args], { timeout: 3000 });
    return stdout.split('\n').filter((l) => l.trim());
  } catch {
    return [];
  }
}

export async function gitInfo(path: string): Promise<{ branch: string; dirty: boolean } | null> {
  const git = (...args: string[]) => execFileAsync('git', ['-C', path, ...args], { timeout: 3000 });
  try {
    const branch = (await git('symbolic-ref', '--short', 'HEAD')).stdout.trim();
    const dirty = (await git('status', '--porcelain')).stdout.trim() !== '';
    return { branch, dirty };
  } catch {
    return null;
  }
}

async function markdownFiles(dir: string): Promise<TextFile[]> {
  const names = (await listDir(dir)).filter((n) => n.endsWith('.md'));
  return (await Promise.all(names.map((n) => readTextFile(join(dir, n))))).filter(present);
}

export async function projectDetail(
  home: string,
  path: string,
  convs: Conversation[],
  hidden: string[] = [],
  projectsDir?: string,
): Promise<ProjectDetail | null> {
  const summary = (await listProjects(home, convs, hidden, projectsDir)).find((p) => p.path === path);
  if (!summary) return null;
  const list = groupByProject(home, convs, hidden).get(path) ?? [];
  const claudeDirs = [...new Set(list.map((c) => c.claudeDir).filter((d): d is string => !!d))];
  const memory = (await Promise.all(claudeDirs.map((d) => markdownFiles(join(d, 'memory'))))).flat();
  const instructions = (await Promise.all(['CLAUDE.md', 'AGENTS.md'].map((n) => readTextFile(join(path, n))))).filter(present);
  return { ...summary, git: await gitInfo(path), instructions, memory, conversationList: list };
}

export async function readProfile(home: string): Promise<Profile> {
  const instructions = (
    await Promise.all([join(home, '.claude', 'CLAUDE.md'), join(home, '.codex', 'AGENTS.md')].map(readTextFile))
  ).filter(present);
  const memories = (
    await Promise.all(['MEMORY.md', 'memory_summary.md'].map((n) => readTextFile(join(home, '.codex', 'memories', n))))
  ).filter(present);
  const root = join(home, '.claude', 'projects');
  for (const dir of await listDir(root)) {
    for (const file of await markdownFiles(join(root, dir, 'memory'))) {
      if (basename(file.path) === 'MEMORY.md') continue;
      const fm = parseFrontmatter(file.content);
      if ((fm.type ?? fm['metadata.type']) === 'user') memories.push(file);
    }
  }
  return { instructions, memories };
}

async function skillsIn(dir: string, origin: string): Promise<Skill[]> {
  const out: Skill[] = [];
  for (const name of await listDir(dir)) {
    const path = join(dir, name, 'SKILL.md');
    const file = await readTextFile(path);
    if (!file) continue;
    const fm = parseFrontmatter(file.content);
    out.push({ name: fm.name || name, description: fm.description ?? '', origin, path });
  }
  return out;
}

export async function listSkills(home: string): Promise<Skill[]> {
  const lists = [
    await skillsIn(join(home, '.claude', 'skills'), 'claude'),
    await skillsIn(join(home, '.codex', 'skills'), 'codex'),
  ];
  try {
    const raw = await readFile(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8');
    const plugins: Record<string, unknown> = JSON.parse(raw).plugins ?? {};
    for (const [key, installs] of Object.entries(plugins)) {
      if (!Array.isArray(installs)) continue;
      for (const install of installs) {
        if (typeof install?.installPath !== 'string') continue;
        lists.push(await skillsIn(join(install.installPath, 'skills'), `plugin:${key.split('@')[0]}`));
      }
    }
  } catch {
    // sem plugins ou arquivo ilegivel
  }
  return lists.flat().sort((a, b) => a.name.localeCompare(b.name));
}

export async function buildOverview(home: string, opts: { hidden?: string[]; projectsDir?: string } = {}): Promise<Overview> {
  const all = await scanConversations(home);
  const [profile, skills, projects] = await Promise.all([
    readProfile(home),
    listSkills(home),
    listProjects(home, all, opts.hidden, opts.projectsDir),
  ]);
  const known = new Set(projects.map((p) => p.path));
  return {
    profile,
    skills,
    projects,
    conversations: all.filter((c) => known.has(c.cwd)),
    projectsDir: projectsBase(home, projects, opts.projectsDir),
  };
}
