# App desktop, marco 1 (servidor e UI funcional): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `llm-agent ui` sobe um servidor local e imprime uma URL. Nela, uma UI web mostra perfil, skills, projetos e conversas, e abre, retoma e alterna sessões de Claude Code, Codex e shell em terminais embutidos.

**Architecture:** Servidor Node (TypeScript executado direto, sem build) em `app/server`. Ele tem leitores somente leitura de `~/.claude` e `~/.codex`, API HTTP e WebSocket protegidos por token, e um gerenciador de PTYs que executa o `llm-agent`. A UI em React, Vite e xterm.js fica em `app/web`, e o build é servido pelo próprio servidor. Um script `app/ui.sh` (chamado por `llm-agent ui`) sobe, reaproveita e encerra o servidor.

**Tech Stack:** Node ≥ 22.18 (type stripping), `ws` 8.22.1, `@lydell/node-pty` 1.2.0-beta.18 (binários prontos), `node:test`; React 19.3.1, Vite 8.3.5, vitest 5.1.0, `@xterm/xterm` 6.0.0, `react-markdown` 10.1.0; TypeScript 5.9.3 só para checagem de tipos.

Spec: `docs/superpowers/specs/2026-11-02-desktop-app-design.md`

## Global Constraints

- Servidor escuta só em `127.0.0.1`; porta `LLM_AGENT_UI_PORT`, padrão `7777`.
- Token: 32 bytes aleatórios em base64url, em `<stateDir>/token` com permissão `600`; `stateDir` = `LLM_AGENT_UI_STATE_DIR` ou `${XDG_CONFIG_HOME:-$HOME/.config}/llm-agent/ui`.
- `/api/*` (exceto `/api/health`) exige `Authorization: Bearer <token>`; WebSocket em `/ws?token=<token>`.
- `Origin` permitido: ausente, `http://127.0.0.1:<porta>`, `http://localhost:<porta>` e os de `LLM_AGENT_UI_ORIGINS` (vírgulas).
- Arquivos de texto enviados até 64 KB (`truncated: true` quando cortados).
- Títulos cortados em 80 caracteres (79 + `…`); sem título: `(sem título)`.
- Histórico por sessão: últimos 1 MB.
- Argumentos dos agentes: claude `--dangerously-skip-permissions [--resume <id>]`; codex `--dangerously-bypass-approvals-and-sandbox` ou `resume --dangerously-bypass-approvals-and-sandbox <id>`; shell `zsh`.
- Código do servidor só com sintaxe "apagável" (sem `enum`, sem parameter properties, sem `namespace`), porque o Node só remove tipos.
- Textos de interface em português.

## Convenção deste plano

Cada bloco de código marcado com `file=<caminho>` é o conteúdo **completo** do arquivo. Para criá-los, copie o bloco para o caminho indicado (ou extraia todos os blocos de uma task com um script). Alterações em arquivos existentes aparecem como "substituir X por Y".

---

### Task 1: Base do servidor e utilitários de arquivo

**Files:**
- Create: `app/server/package.json`, `app/server/tsconfig.json`, `app/server/src/types.ts`, `app/server/src/files.ts`, `app/server/test/helpers.ts`, `app/server/test/files.test.ts`
- Create: `.gitignore`

**Interfaces:**
- Produces: tipos em `types.ts` (todos os tipos compartilhados com a UI); `readJsonl(file)`, `readTextFile(path)`, `listDir(dir)`, `isDir(path)`, `isFile(path)`, `mtimeIso(path)`, `cached(file, parse)`, `parseFrontmatter(text)`, `MAX_TEXT`; helpers de teste `tempHome()`, `write()`, `jsonl()`, `waitFor()`.

- [ ] **Step 1: Pacote, tsconfig, tipos e .gitignore**

```json file=app/server/package.json
{
  "name": "llm-agent-ui-server",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.18" },
  "scripts": {
    "start": "node src/main.ts",
    "test": "node --test test/*.test.ts",
    "typecheck": "tsc -p ."
  },
  "dependencies": {
    "@lydell/node-pty": "1.2.0-beta.18",
    "ws": "8.22.1"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/ws": "8.18.2",
    "typescript": "5.9.3"
  }
}
```

```json file=app/server/tsconfig.json
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

```ts file=app/server/src/types.ts
// Tipos compartilhados entre o servidor e a UI (app/web importa este arquivo).

export type Agent = 'claude' | 'codex';
export type SessionAgent = Agent | 'shell';

export interface Conversation {
  agent: Agent;
  id: string;
  cwd: string;
  title: string;
  updatedAt: string;
  prompts: number;
  /** Pasta em ~/.claude/projects que contém a conversa (só Claude). */
  claudeDir?: string;
}

export interface TextFile {
  path: string;
  content: string;
  truncated: boolean;
}

export interface Skill {
  name: string;
  description: string;
  origin: string;
  path: string;
}

export interface Profile {
  instructions: TextFile[];
  memories: TextFile[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  path: string;
  updatedAt: string;
  conversations: number;
  agents: Agent[];
}

export interface ProjectDetail extends ProjectSummary {
  git: { branch: string; dirty: boolean } | null;
  instructions: TextFile[];
  memory: TextFile[];
  conversationList: Conversation[];
}

export interface Overview {
  profile: Profile;
  skills: Skill[];
  projects: ProjectSummary[];
  conversations: Conversation[];
}

export interface SessionInfo {
  id: string;
  projectPath: string;
  agent: SessionAgent;
  resume?: string;
  title: string;
  startedAt: string;
  alive: boolean;
  exitCode?: number;
}

export type ClientMessage =
  | { type: 'open'; projectPath: string; agent: SessionAgent; resume?: string; cols: number; rows: number }
  | { type: 'attach'; id: string }
  | { type: 'input'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'close'; id: string };

export type ServerMessage =
  | { type: 'sessions'; sessions: SessionInfo[] }
  | { type: 'opened'; session: SessionInfo }
  | { type: 'output'; id: string; data: string }
  | { type: 'history'; id: string; data: string }
  | { type: 'exit'; id: string; code: number }
  | { type: 'changed' }
  | { type: 'error'; message: string };
```

```gitignore file=.gitignore
node_modules/
app/web/dist/
```

- [ ] **Step 2: Escrever os testes**

```ts file=app/server/test/helpers.ts
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

export function tempHome(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'llm-agent-ui-')));
}

export function write(file: string, content: string, mtime?: Date): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  if (mtime) utimesSync(file, mtime, mtime);
}

export const jsonl = (...records: unknown[]): string =>
  records.map((r) => JSON.stringify(r)).join('\n') + '\n';

export async function waitFor<T>(fn: () => T | undefined | null | false, timeout = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error('timeout esperando a condicao');
    await new Promise((r) => setTimeout(r, 20));
  }
}
```

```ts file=app/server/test/files.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readJsonl, readTextFile, parseFrontmatter, cached, MAX_TEXT } from '../src/files.ts';
import { tempHome, write } from './helpers.ts';

test('readJsonl ignora linhas invalidas e vazias', async () => {
  const f = join(tempHome(), 'a.jsonl');
  write(f, '{"a":1}\nnao e json\n\n{"a":2}\n');
  const out: unknown[] = [];
  for await (const r of readJsonl(f)) out.push(r);
  assert.deepEqual(out, [{ a: 1 }, { a: 2 }]);
});

test('readTextFile trunca em 64 KB e devolve null se o arquivo nao existe', async () => {
  const dir = tempHome();
  write(join(dir, 'big.md'), 'x'.repeat(MAX_TEXT + 10));
  const t = await readTextFile(join(dir, 'big.md'));
  assert.equal(t?.content.length, MAX_TEXT);
  assert.equal(t?.truncated, true);
  assert.equal(await readTextFile(join(dir, 'nada.md')), null);
});

test('parseFrontmatter le campos simples, aspas, blocos e metadata', () => {
  const fm = parseFrontmatter(
    '---\nname: minha-skill\ndescription: "Faz algo: util"\nlong: >\n  linha um\n  linha dois\nmetadata:\n  type: user\n---\ncorpo',
  );
  assert.equal(fm.name, 'minha-skill');
  assert.equal(fm.description, 'Faz algo: util');
  assert.equal(fm.long, 'linha um linha dois');
  assert.equal(fm['metadata.type'], 'user');
  assert.deepEqual(parseFrontmatter('sem frontmatter'), {});
});

test('cached so reprocessa quando o arquivo muda', async () => {
  const f = join(tempHome(), 'c.txt');
  write(f, '1', new Date(1_000_000));
  let calls = 0;
  const parse = async () => ++calls;
  assert.equal(await cached(f, parse), 1);
  assert.equal(await cached(f, parse), 1);
  write(f, '22', new Date(2_000_000));
  assert.equal(await cached(f, parse), 2);
  assert.equal(await cached(join(f, 'nao-existe'), parse), null);
});
```

- [ ] **Step 3: Instalar dependências e ver falhar**

Run: `cd app/server && npm install && npm test`
Expected: falha com `Cannot find module '.../src/files.ts'`. O `npm install` cria `package-lock.json`, que entra no commit.

- [ ] **Step 4: Implementar**

```ts file=app/server/src/files.ts
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import type { TextFile } from './types.ts';

export const MAX_TEXT = 64 * 1024;

/** Registros de um .jsonl; linhas vazias ou invalidas sao ignoradas. */
export async function* readJsonl(file: string): AsyncGenerator<any> {
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {
      // linha corrompida: ignora
    }
  }
}

export async function readTextFile(path: string): Promise<TextFile | null> {
  try {
    const buf = await readFile(path);
    return {
      path,
      content: buf.subarray(0, MAX_TEXT).toString('utf8'),
      truncated: buf.length > MAX_TEXT,
    };
  } catch {
    return null;
  }
}

export async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

export async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function mtimeIso(path: string): Promise<string | null> {
  try {
    return (await stat(path)).mtime.toISOString();
  } catch {
    return null;
  }
}

const cache = new Map<string, { key: string; value: unknown }>();

/** Resultado de parse(file), reaproveitado enquanto mtime e tamanho nao mudam. */
export async function cached<T>(file: string, parse: (file: string) => Promise<T>): Promise<T | null> {
  let key: string;
  try {
    const st = await stat(file);
    key = `${st.mtimeMs}:${st.size}`;
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.value as T;
  const value = await parse(file);
  cache.set(file, { key, value });
  return value;
}

const unquote = (s: string): string => s.replace(/^(['"])(.*)\1$/, '$2');

/**
 * Frontmatter YAML simples: campos de uma linha, blocos ">" e "|" e um nivel
 * de aninhamento (ex.: metadata.type). Nao e um parser YAML completo.
 */
export function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return out;
  let parent = '';
  let block = '';
  for (const line of m[1].split(/\r?\n/)) {
    if (block) {
      if (/^\s+\S/.test(line)) {
        out[block] = out[block] ? `${out[block]} ${line.trim()}` : line.trim();
        continue;
      }
      block = '';
    }
    const kv = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, indent, key, raw] = kv;
    if (indent && !parent) continue;
    if (!indent) parent = '';
    const full = indent ? `${parent}.${key}` : key;
    const value = unquote(raw.trim());
    if (/^[>|][-+]?$/.test(value)) {
      block = full;
      out[full] = '';
    } else if (!indent && value === '') {
      parent = key;
    } else {
      out[full] = value;
    }
  }
  return out;
}
```

- [ ] **Step 5: Ver passar**

Run: `cd app/server && npm test`
Expected: 4 testes `ok`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add .gitignore app/server/package.json app/server/package-lock.json app/server/tsconfig.json app/server/src/types.ts app/server/src/files.ts app/server/test/helpers.ts app/server/test/files.test.ts
git commit -m "Add UI server scaffold and file helpers"
```

---

### Task 2: Leitores de conversas (Claude e Codex)

**Files:**
- Create: `app/server/src/conversations.ts`, `app/server/test/fixture.ts`, `app/server/test/conversations.test.ts`

**Interfaces:**
- Consumes: `readJsonl`, `cached`, `listDir`, `isDir`, `mtimeIso` (Task 1).
- Produces: `shortTitle(text): string`, `scanClaude(home): Promise<Conversation[]>`, `scanCodex(home): Promise<Conversation[]>`, `scanConversations(home): Promise<Conversation[]>` (mais recentes primeiro; `cwd` sempre normalizado com `path.resolve`); fixture `buildFixture(): Fixture` com `{ home, p1, p2, claudeDir }`.

- [ ] **Step 1: Fixture compartilhada**

```ts file=app/server/test/fixture.ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tempHome, write, jsonl } from './helpers.ts';

export interface Fixture {
  home: string;
  /** Projeto que existe, com conversas do Claude e do Codex. */
  p1: string;
  /** Projeto apagado do disco. */
  p2: string;
  /** Pasta de conversas do Claude do p1. */
  claudeDir: string;
}

const at = (iso: string) => new Date(iso);

export function buildFixture(): Fixture {
  const home = tempHome();
  const p1 = join(home, 'dev', 'meu-app');
  const p2 = join(home, 'dev', 'app-velho');
  mkdirSync(p1, { recursive: true });
  write(join(p1, 'CLAUDE.md'), '# Regras do meu-app\n');

  // Claude: nome da pasta e so uma codificacao; o projeto vem do cwd.
  const claudeDir = join(home, '.claude', 'projects', '-x-dev-meu-app');
  write(
    join(claudeDir, 'aaa.jsonl'),
    jsonl(
      { type: 'mode' },
      { type: 'user', origin: { kind: 'human' }, cwd: p1, message: { content: '<command-name>/x</command-name>' } },
      { type: 'user', origin: { kind: 'human' }, cwd: p1, message: { content: 'Primeira pergunta de verdade' } },
      { type: 'user', cwd: p1, message: { content: [{ type: 'tool_result' }] } },
      { type: 'ai-title', aiTitle: 'Titulo antigo' },
      { type: 'ai-title', aiTitle: 'Titulo novo' },
    ) + 'lixo corrompido\n',
    at('2026-10-01T00:00:00Z'),
  );
  // Formato antigo (sem origin) e prompt longo.
  write(
    join(claudeDir, 'bbb.jsonl'),
    jsonl({ type: 'user', cwd: p1 + '/', message: { content: 'x'.repeat(100) } }),
    at('2026-10-02T00:00:00Z'),
  );
  // Sem cwd: ignorada.
  write(join(claudeDir, 'ccc.jsonl'), jsonl({ type: 'mode' }), at('2026-10-02T00:00:00Z'));
  write(join(claudeDir, 'memory', 'MEMORY.md'), '- [Papel](user_role.md)\n');
  write(join(claudeDir, 'memory', 'user_role.md'), '---\nname: papel\nmetadata:\n  type: user\n---\nDev backend.\n');
  write(join(claudeDir, 'memory', 'project_x.md'), '---\nname: x\ntype: project\n---\nPrazo em dezembro.\n');

  const otherDir = join(home, '.claude', 'projects', '-x-outros');
  write(join(otherDir, 'ddd.jsonl'), jsonl({ type: 'user', cwd: p2, message: { content: 'velho' } }), at('2026-09-01T00:00:00Z'));
  write(join(otherDir, 'eee.jsonl'), jsonl({ type: 'user', cwd: home, message: { content: 'na home' } }), at('2026-09-02T00:00:00Z'));

  const codexDay = join(home, '.codex', 'sessions', '2026', '10', '03');
  write(
    join(codexDay, 'rollout-x.jsonl'),
    jsonl(
      { type: 'session_meta', payload: { id: 'cdx-1', cwd: p1 } },
      { type: 'response_item', payload: { type: 'message', role: 'user' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'Corrigir   o\nbug' } },
      { type: 'event_msg', payload: { type: 'user_message', message: 'outra' } },
    ),
    at('2026-10-03T00:00:00Z'),
  );
  write(
    join(codexDay, 'rollout-y.jsonl'),
    jsonl({ type: 'session_meta', payload: { id: 'cdx-2', cwd: p2 } }),
    at('2026-09-03T00:00:00Z'),
  );

  write(join(home, '.claude', 'CLAUDE.md'), '# Global\n');
  write(join(home, '.codex', 'memories', 'MEMORY.md'), 'Prefere respostas curtas.\n');

  write(join(home, '.claude', 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Primeira skill\n---\n');
  write(join(home, '.claude', 'skills', 'semfm', 'SKILL.md'), '# sem frontmatter\n');
  write(join(home, '.codex', 'skills', 'beta', 'SKILL.md'), '---\nname: beta\ndescription: Do Codex\n---\n');
  const pluginDir = join(home, 'plugins', 'p1');
  write(join(pluginDir, 'skills', 'gamma', 'SKILL.md'), '---\nname: gamma\ndescription: >\n  De um\n  plugin\n---\n');
  write(
    join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'p1@mercado': [{ installPath: pluginDir }] } }),
  );

  return { home, p1, p2, claudeDir };
}
```

- [ ] **Step 2: Escrever os testes**

```ts file=app/server/test/conversations.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanClaude, scanCodex, scanConversations, shortTitle } from '../src/conversations.ts';
import { buildFixture } from './fixture.ts';

test('shortTitle junta espacos e corta em 80 caracteres', () => {
  assert.equal(shortTitle('  a\n  b  '), 'a b');
  assert.equal(shortTitle('x'.repeat(100)), 'x'.repeat(79) + '…');
});

test('scanClaude le titulo, cwd, prompts e ignora conversas sem cwd', async () => {
  const fx = buildFixture();
  const convs = await scanClaude(fx.home);
  assert.deepEqual(convs.map((c) => c.id).sort(), ['aaa', 'bbb', 'ddd', 'eee']);
  const aaa = convs.find((c) => c.id === 'aaa')!;
  assert.equal(aaa.title, 'Titulo novo');
  assert.equal(aaa.cwd, fx.p1);
  assert.equal(aaa.prompts, 2);
  assert.equal(aaa.claudeDir, fx.claudeDir);
  assert.equal(aaa.updatedAt, '2026-10-01T00:00:00.000Z');
  const bbb = convs.find((c) => c.id === 'bbb')!;
  assert.equal(bbb.title, 'x'.repeat(79) + '…');
  assert.equal(bbb.cwd, fx.p1, 'cwd normalizado sem a barra final');
  assert.equal(bbb.prompts, 1);
});

test('scanCodex le id, cwd e titulo do primeiro user_message', async () => {
  const fx = buildFixture();
  const convs = await scanCodex(fx.home);
  const cdx1 = convs.find((c) => c.id === 'cdx-1')!;
  assert.equal(cdx1.agent, 'codex');
  assert.equal(cdx1.cwd, fx.p1);
  assert.equal(cdx1.title, 'Corrigir o bug');
  assert.equal(cdx1.prompts, 2);
  assert.equal(convs.find((c) => c.id === 'cdx-2')!.title, '(sem título)');
});

test('scanConversations junta os dois agentes, mais recentes primeiro', async () => {
  const fx = buildFixture();
  const ids = (await scanConversations(fx.home)).map((c) => c.id);
  assert.deepEqual(ids, ['cdx-1', 'bbb', 'aaa', 'cdx-2', 'eee', 'ddd']);
});
```

- [ ] **Step 3: Ver falhar**

Run: `cd app/server && npm test`
Expected: `conversations.test.ts` falha com `Cannot find module '.../src/conversations.ts'`.

- [ ] **Step 4: Implementar**

```ts file=app/server/src/conversations.ts
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
```

- [ ] **Step 5: Ver passar**

Run: `cd app/server && npm test`
Expected: todos `ok`, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add app/server/src/conversations.ts app/server/test/fixture.ts app/server/test/conversations.test.ts
git commit -m "Read Claude Code and Codex conversations"
```

---

### Task 3: Projetos, perfil e skills

**Files:**
- Create: `app/server/src/catalog.ts`, `app/server/test/catalog.test.ts`

**Interfaces:**
- Consumes: `Conversation` e leitores das Tasks 1 e 2.
- Produces: `projectId(path)`, `projectPathFromId(id)`, `listProjects(home, convs): Promise<ProjectSummary[]>`, `projectDetail(home, path, convs): Promise<ProjectDetail | null>`, `gitInfo(path)`, `readProfile(home): Promise<Profile>`, `listSkills(home): Promise<Skill[]>`, `buildOverview(home): Promise<Overview>`.

- [ ] **Step 1: Escrever os testes**

```ts file=app/server/test/catalog.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildOverview, gitInfo, listProjects, listSkills, projectDetail, projectId, projectPathFromId, readProfile,
} from '../src/catalog.ts';
import { scanConversations } from '../src/conversations.ts';
import { buildFixture } from './fixture.ts';
import { tempHome, write } from './helpers.ts';

test('projectId e reversivel', () => {
  assert.equal(projectPathFromId(projectId('/home/a-b/c')), '/home/a-b/c');
});

test('listProjects ignora projetos apagados e a home', async () => {
  const fx = buildFixture();
  const projects = await listProjects(fx.home, await scanConversations(fx.home));
  assert.equal(projects.length, 1);
  assert.deepEqual(projects[0], {
    id: projectId(fx.p1),
    name: 'meu-app',
    path: fx.p1,
    updatedAt: '2026-10-03T00:00:00.000Z',
    conversations: 3,
    agents: ['claude', 'codex'],
  });
});

test('projectDetail traz conversas, instrucoes e memoria', async () => {
  const fx = buildFixture();
  const convs = await scanConversations(fx.home);
  const d = await projectDetail(fx.home, fx.p1, convs);
  assert.ok(d);
  assert.deepEqual(d.conversationList.map((c) => c.id), ['cdx-1', 'bbb', 'aaa']);
  assert.deepEqual(d.instructions.map((f) => f.path), [join(fx.p1, 'CLAUDE.md')]);
  assert.deepEqual(
    d.memory.map((f) => f.path),
    ['MEMORY.md', 'project_x.md', 'user_role.md'].map((n) => join(fx.claudeDir, 'memory', n)),
  );
  assert.equal(d.git, null);
  assert.equal(await projectDetail(fx.home, fx.p2, convs), null);
});

test('gitInfo le branch e mudancas pendentes', async () => {
  const dir = join(tempHome(), 'repo');
  mkdirSync(dir);
  execFileSync('git', ['init', '-q', '-b', 'principal', dir]);
  assert.deepEqual(await gitInfo(dir), { branch: 'principal', dirty: false });
  write(join(dir, 'novo.txt'), 'x');
  assert.deepEqual(await gitInfo(dir), { branch: 'principal', dirty: true });
});

test('readProfile traz instrucoes globais e so memorias do tipo user', async () => {
  const fx = buildFixture();
  const p = await readProfile(fx.home);
  assert.deepEqual(p.instructions.map((f) => f.path), [join(fx.home, '.claude', 'CLAUDE.md')]);
  assert.deepEqual(p.memories.map((f) => f.path), [
    join(fx.home, '.codex', 'memories', 'MEMORY.md'),
    join(fx.claudeDir, 'memory', 'user_role.md'),
  ]);
});

test('listSkills junta Claude, Codex e plugins', async () => {
  const fx = buildFixture();
  const skills = await listSkills(fx.home);
  assert.deepEqual(
    skills.map((s) => [s.name, s.origin, s.description]),
    [
      ['alpha', 'claude', 'Primeira skill'],
      ['beta', 'codex', 'Do Codex'],
      ['gamma', 'plugin:p1', 'De um plugin'],
      ['semfm', 'claude', ''],
    ],
  );
});

test('buildOverview so lista conversas de projetos existentes', async () => {
  const fx = buildFixture();
  const o = await buildOverview(fx.home);
  assert.deepEqual(o.conversations.map((c) => c.id), ['cdx-1', 'bbb', 'aaa']);
  assert.equal(o.projects.length, 1);
  assert.equal(o.skills.length, 4);
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd app/server && npm test`
Expected: `catalog.test.ts` falha com `Cannot find module '.../src/catalog.ts'`.

- [ ] **Step 3: Implementar**

```ts file=app/server/src/catalog.ts
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Agent, Conversation, Overview, Profile, ProjectDetail, ProjectSummary, Skill, TextFile } from './types.ts';
import { scanConversations } from './conversations.ts';
import { isDir, listDir, parseFrontmatter, readTextFile } from './files.ts';

const execFileAsync = promisify(execFile);

export const projectId = (path: string): string => Buffer.from(path).toString('base64url');
export const projectPathFromId = (id: string): string => Buffer.from(id, 'base64url').toString('utf8');

const present = <T>(x: T | null): x is T => x !== null;

function groupByProject(home: string, convs: Conversation[]): Map<string, Conversation[]> {
  const excluded = new Set([resolve(home), '/']);
  const groups = new Map<string, Conversation[]>();
  for (const c of convs) {
    if (excluded.has(c.cwd)) continue;
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

export async function listProjects(home: string, convs: Conversation[]): Promise<ProjectSummary[]> {
  const out: ProjectSummary[] = [];
  for (const [path, list] of groupByProject(home, convs)) {
    if (await isDir(path)) out.push(summarize(path, list));
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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

export async function projectDetail(home: string, path: string, convs: Conversation[]): Promise<ProjectDetail | null> {
  const list = groupByProject(home, convs).get(path);
  if (!list || !(await isDir(path))) return null;
  const claudeDirs = [...new Set(list.map((c) => c.claudeDir).filter((d): d is string => !!d))];
  const memory = (await Promise.all(claudeDirs.map((d) => markdownFiles(join(d, 'memory'))))).flat();
  const instructions = (await Promise.all(['CLAUDE.md', 'AGENTS.md'].map((n) => readTextFile(join(path, n))))).filter(present);
  return { ...summarize(path, list), git: await gitInfo(path), instructions, memory, conversationList: list };
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

export async function buildOverview(home: string): Promise<Overview> {
  const all = await scanConversations(home);
  const [profile, skills, projects] = await Promise.all([readProfile(home), listSkills(home), listProjects(home, all)]);
  const known = new Set(projects.map((p) => p.path));
  return { profile, skills, projects, conversations: all.filter((c) => known.has(c.cwd)) };
}
```

- [ ] **Step 4: Ver passar**

Run: `cd app/server && npm test`
Expected: todos `ok`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add app/server/src/catalog.ts app/server/test/catalog.test.ts
git commit -m "Build projects, profile and skills catalog"
```

---

### Task 4: Autenticação, API HTTP e arquivos estáticos

**Files:**
- Create: `app/server/src/auth.ts`, `app/server/src/server.ts`, `app/server/test/app.ts`, `app/server/test/server.test.ts`

**Interfaces:**
- Consumes: `buildOverview`, `projectDetail`, `projectPathFromId`, `scanConversations`, `isFile`.
- Produces: `loadOrCreateToken(stateDir): string`, `tokenMatches(given, token): boolean`, `bearer(header): string | null`, `originAllowed(origin, port, extra): boolean`; helpers de teste `startApp(home, extra?)` e `httpGet(url, headers?)`; `createApp(opts: AppOptions): App` com `App = { listen(): Promise<number>; close(): Promise<void>; broadcast(msg: ServerMessage): void }` e `AppOptions = { home, port, token, webDir, bin, extraOrigins: string[] }`. A Task 5 acrescenta o WebSocket dentro de `createApp`.

- [ ] **Step 1: Escrever os testes**

```ts file=app/server/test/app.ts
import { request } from 'node:http';
import { join } from 'node:path';
import { createApp, type AppOptions } from '../src/server.ts';

export function httpGet(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body }));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function startApp(home: string, extra: Partial<AppOptions> = {}) {
  const app = createApp({
    home, port: 0, token: 'tok', webDir: join(home, 'web'), bin: '/bin/false', extraOrigins: ['http://dev:5173'], ...extra,
  });
  const port = await app.listen();
  return { app, port, base: `http://127.0.0.1:${port}` };
}
```

```ts file=app/server/test/server.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { loadOrCreateToken, originAllowed, tokenMatches } from '../src/auth.ts';
import { projectId } from '../src/catalog.ts';
import { httpGet, startApp } from './app.ts';
import { buildFixture } from './fixture.ts';
import { tempHome, write } from './helpers.ts';

const auth = { authorization: 'Bearer tok' };

test('loadOrCreateToken cria token 600 e reaproveita', () => {
  const dir = join(tempHome(), 'state');
  const t = loadOrCreateToken(dir);
  assert.match(t, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(statSync(join(dir, 'token')).mode & 0o777, 0o600);
  assert.equal(loadOrCreateToken(dir), t);
});

test('tokenMatches e originAllowed', () => {
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abd', 'abc'), false);
  assert.equal(tokenMatches(null, 'abc'), false);
  assert.equal(originAllowed(undefined, 7777, []), true);
  assert.equal(originAllowed('http://127.0.0.1:7777', 7777, []), true);
  assert.equal(originAllowed('http://localhost:7777', 7777, []), true);
  assert.equal(originAllowed('http://evil.com', 7777, []), false);
  assert.equal(originAllowed('http://dev:5173', 7777, ['http://dev:5173']), true);
});

test('API exige token e Origin permitido', async () => {
  const fx = buildFixture();
  const { app, base, port } = await startApp(fx.home);
  try {
    assert.equal((await httpGet(`${base}/api/health`)).body, '{"ok":true}');
    assert.equal((await httpGet(`${base}/api/overview`)).status, 401);
    assert.equal((await httpGet(`${base}/api/overview`, { authorization: 'Bearer errado' })).status, 401);
    assert.equal((await httpGet(`${base}/api/overview`, { ...auth, origin: 'http://evil.com' })).status, 403);
    assert.equal((await httpGet(`${base}/api/overview`, { ...auth, origin: `http://127.0.0.1:${port}` })).status, 200);
    assert.equal((await httpGet(`${base}/api/overview`, { ...auth, origin: 'http://dev:5173' })).status, 200);
    const o = JSON.parse((await httpGet(`${base}/api/overview`, auth)).body);
    assert.equal(o.projects[0].name, 'meu-app');
    assert.equal(o.conversations.length, 3);
  } finally {
    await app.close();
  }
});

test('detalhe do projeto e 404 para projeto desconhecido', async () => {
  const fx = buildFixture();
  const { app, base } = await startApp(fx.home);
  try {
    const ok = await httpGet(`${base}/api/projects/${projectId(fx.p1)}`, auth);
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).conversationList.length, 3);
    assert.equal((await httpGet(`${base}/api/projects/${projectId(fx.p2)}`, auth)).status, 404);
    assert.equal((await httpGet(`${base}/api/nada`, auth)).status, 404);
  } finally {
    await app.close();
  }
});

test('arquivos estaticos, fallback para index.html e bloqueio de ../', async () => {
  const home = tempHome();
  write(join(home, 'web', 'index.html'), 'INDEX');
  write(join(home, 'web', 'app.js'), 'JS');
  write(join(home, 'secreto.txt'), 'SEGREDO');
  const { app, base } = await startApp(home);
  try {
    const js = await httpGet(`${base}/app.js`);
    assert.equal(js.body, 'JS');
    assert.match(js.type, /javascript/);
    assert.equal((await httpGet(`${base}/projetos/qualquer`)).body, 'INDEX');
    const evil = await httpGet(`${base}/..%2fsecreto.txt`);
    assert.equal(evil.status, 403);
    assert.notEqual(evil.body, 'SEGREDO');
  } finally {
    await app.close();
  }
});

test('sem build da UI, responde 404 com instrucao', async () => {
  const { app, base } = await startApp(tempHome());
  try {
    const r = await httpGet(`${base}/`);
    assert.equal(r.status, 404);
    assert.match(r.body, /npm run build/);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd app/server && npm test`
Expected: `server.test.ts` falha com `Cannot find module '.../src/server.ts'`.

- [ ] **Step 3: Implementar**

```ts file=app/server/src/auth.ts
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Token salvo em <stateDir>/token (600); criado na primeira execucao. */
export function loadOrCreateToken(stateDir: string): string {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = join(stateDir, 'token');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // ainda nao existe
  }
  const token = randomBytes(32).toString('base64url');
  writeFileSync(file, token + '\n', { mode: 0o600 });
  return token;
}

export function tokenMatches(given: string | null | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bearer(header: string | undefined): string | null {
  const m = /^Bearer (.+)$/.exec(header ?? '');
  return m ? m[1] : null;
}

/** Sem Origin (curl, app) passa; com Origin, so a propria UI e as extras. */
export function originAllowed(origin: string | undefined, port: number, extra: string[]): boolean {
  if (!origin) return true;
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...extra].includes(origin);
}
```

```ts file=app/server/src/server.ts
import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { ServerMessage } from './types.ts';
import { bearer, originAllowed, tokenMatches } from './auth.ts';
import { buildOverview, projectDetail, projectPathFromId } from './catalog.ts';
import { scanConversations } from './conversations.ts';
import { isFile } from './files.ts';

export interface AppOptions {
  home: string;
  /** 0 escolhe uma porta livre (testes). */
  port: number;
  token: string;
  webDir: string;
  /** Caminho do llm-agent executado pelos terminais. */
  bin: string;
  extraOrigins: string[];
}

export interface App {
  listen(): Promise<number>;
  close(): Promise<void>;
  broadcast(msg: ServerMessage): void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

export function createApp(opts: AppOptions): App {
  let port = opts.port;
  const webRoot = resolve(opts.webDir);

  async function api(res: ServerResponse, pathname: string): Promise<void> {
    if (pathname === '/api/overview') return send(res, 200, await buildOverview(opts.home));
    const m = /^\/api\/projects\/([A-Za-z0-9_-]+)$/.exec(pathname);
    if (m) {
      const detail = await projectDetail(opts.home, projectPathFromId(m[1]), await scanConversations(opts.home));
      return detail ? send(res, 200, detail) : send(res, 404, { error: 'projeto não encontrado' });
    }
    send(res, 404, { error: 'rota desconhecida' });
  }

  async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
    let file = resolve(webRoot, '.' + decodeURIComponent(pathname));
    if (file !== webRoot && !file.startsWith(webRoot + sep)) return send(res, 403, 'proibido', 'text/plain; charset=utf-8');
    if (!(await isFile(file))) file = join(webRoot, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      send(res, 404, 'Interface não construída: rode "npm ci && npm run build" em app/web.', 'text/plain; charset=utf-8');
    }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/api/health') return send(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/')) {
        if (!originAllowed(req.headers.origin, port, opts.extraOrigins)) return send(res, 403, { error: 'origem não permitida' });
        if (!tokenMatches(bearer(req.headers.authorization), opts.token)) return send(res, 401, { error: 'token inválido' });
        return await api(res, url.pathname);
      }
      await serveStatic(res, url.pathname);
    } catch (err) {
      if (!res.headersSent) send(res, err instanceof URIError ? 400 : 500, { error: String(err) });
    }
  });

  return {
    listen: () =>
      new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(opts.port, '127.0.0.1', () => {
          port = (server.address() as AddressInfo).port;
          ok(port);
        });
      }),
    close: () => new Promise((ok) => server.close(() => ok())),
    broadcast: () => {},
  };
}
```

- [ ] **Step 4: Ver passar**

Run: `cd app/server && npm test`
Expected: todos `ok`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add app/server/src/auth.ts app/server/src/server.ts app/server/test/app.ts app/server/test/server.test.ts
git commit -m "Serve the UI API with token and Origin checks"
```

---

### Task 5: Terminais e WebSocket

**Files:**
- Create: `app/server/src/terminals.ts`, `app/server/test/terminals.test.ts`
- Modify: `app/server/src/server.ts` (substituir o arquivo inteiro pela versão abaixo)

**Interfaces:**
- Consumes: `createApp`, `AppOptions`, `buildFixture`, `startApp` (de `test/app.ts`).
- Produces: `agentArgs(agent, resume?): string[]`; `TerminalManager` com `open(req: OpenRequest): SessionInfo`, `list(): SessionInfo[]`, `history(id): string | null`, `write(id, data)`, `resize(id, cols, rows)`, `close(id)`, `closeAll()` e eventos `output (id, data)`, `exit (id, code)`, `sessions ()`. O protocolo WebSocket é o de `ClientMessage`/`ServerMessage`.

- [ ] **Step 1: Escrever os testes**

```ts file=app/server/test/terminals.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { TerminalManager, agentArgs } from '../src/terminals.ts';
import { buildFixture } from './fixture.ts';
import { startApp } from './app.ts';
import { tempHome, waitFor, write } from './helpers.ts';

/** llm-agent falso: mostra argumentos e projeto, le uma linha e sai com 3. */
function fakeAgent(dir: string): string {
  const bin = join(dir, 'fake-llm-agent');
  write(bin, '#!/usr/bin/env bash\necho "ARGS:$*"\necho "WORKDIR:$AGENT_WORKDIR"\nIFS= read -r line\necho "GOT:$line"\nexit 3\n');
  chmodSync(bin, 0o755);
  return bin;
}

test('agentArgs monta os comandos de cada agente', () => {
  assert.deepEqual(agentArgs('claude'), ['claude', '--dangerously-skip-permissions']);
  assert.deepEqual(agentArgs('claude', 'abc'), ['claude', '--dangerously-skip-permissions', '--resume', 'abc']);
  assert.deepEqual(agentArgs('codex'), ['codex', '--dangerously-bypass-approvals-and-sandbox']);
  assert.deepEqual(agentArgs('codex', 'xyz'), ['codex', 'resume', '--dangerously-bypass-approvals-and-sandbox', 'xyz']);
  assert.deepEqual(agentArgs('shell'), ['zsh']);
});

test('TerminalManager executa o llm-agent no projeto e guarda o historico', async () => {
  const home = tempHome();
  const proj = join(home, 'proj');
  mkdirSync(proj);
  const tm = new TerminalManager(fakeAgent(home));
  let out = '';
  let code: number | undefined;
  tm.on('output', (_id: string, d: string) => (out += d));
  tm.on('exit', (_id: string, c: number) => (code = c));
  const s = tm.open({ projectPath: proj, agent: 'claude', resume: 'abc', title: 't', cols: 80, rows: 24 });
  await waitFor(() => out.includes('WORKDIR:'));
  assert.ok(out.includes('ARGS:claude --dangerously-skip-permissions --resume abc'));
  assert.ok(out.includes(`WORKDIR:${proj}`));
  tm.write(s.id, 'oi\r');
  await waitFor(() => code !== undefined && out.includes('GOT:oi'));
  assert.equal(code, 3);
  assert.equal(tm.list()[0].alive, false);
  assert.equal(tm.list()[0].exitCode, 3);
  assert.ok(tm.history(s.id)?.includes('ARGS:'));
  tm.close(s.id);
  assert.deepEqual(tm.list(), []);
  assert.equal(tm.history(s.id), null);
});

test('TerminalManager limita o historico', async () => {
  const home = tempHome();
  const tm = new TerminalManager(fakeAgent(home), 16);
  let exited = false;
  tm.on('exit', () => (exited = true));
  const s = tm.open({ projectPath: home, agent: 'shell', title: 't', cols: 80, rows: 24 });
  tm.write(s.id, 'uma linha bem comprida\r');
  await waitFor(() => exited);
  assert.ok((tm.history(s.id) ?? '').length <= 16);
  tm.closeAll();
});

async function connect(port: number, opts: { token?: string; origin?: string } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${opts.token ?? 'tok'}`, opts.origin ? { origin: opts.origin } : {});
  const messages: any[] = [];
  ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
  await new Promise<void>((ok, fail) => {
    ws.once('open', () => ok());
    ws.once('unexpected-response', (_req, res) => fail(new Error(`HTTP ${res.statusCode}`)));
    ws.once('error', fail);
  });
  return { ws, messages, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

test('WebSocket recusa token errado e Origin estranho', async () => {
  const fx = buildFixture();
  const { app, port } = await startApp(fx.home);
  try {
    await assert.rejects(connect(port, { token: 'errado' }), /HTTP 403/);
    await assert.rejects(connect(port, { origin: 'http://evil.com' }), /HTTP 403/);
  } finally {
    await app.close();
  }
});

test('WebSocket abre, retoma, anexa e encerra sessoes', async () => {
  const fx = buildFixture();
  const { app, port } = await startApp(fx.home, { bin: fakeAgent(fx.home) });
  const c = await connect(port);
  try {
    await waitFor(() => c.messages.find((m) => m.type === 'sessions'));
    const errorWith = (text: string) => waitFor(() => c.messages.find((m) => m.type === 'error' && m.message.includes(text)));

    c.send({ type: 'open', projectPath: '/nao/existe', agent: 'claude', cols: 80, rows: 24 });
    await errorWith('projeto desconhecido');
    c.send({ type: 'open', projectPath: fx.p1, agent: 'claude', resume: '--evil', cols: 80, rows: 24 });
    await errorWith('conversa desconhecida');
    c.send({ type: 'open', projectPath: fx.p1, agent: 'codex', resume: 'aaa', cols: 80, rows: 24 });
    await waitFor(() => c.messages.filter((m) => m.type === 'error' && m.message.includes('conversa desconhecida')).length === 2);
    c.send({ type: 'open', projectPath: fx.p1, agent: 'banana', cols: 80, rows: 24 });
    await errorWith('agente inválido');

    c.send({ type: 'open', projectPath: fx.p1, agent: 'claude', resume: 'aaa', cols: 80, rows: 24 });
    const opened = await waitFor(() => c.messages.find((m) => m.type === 'opened'));
    const id = opened.session.id;
    assert.equal(opened.session.title, 'Titulo novo');
    await waitFor(() => c.messages.some((m) => m.type === 'output' && m.id === id && m.data.includes('WORKDIR:')));

    c.send({ type: 'attach', id });
    const hist = await waitFor(() => c.messages.find((m) => m.type === 'history' && m.id === id));
    assert.ok(hist.data.includes('ARGS:claude --dangerously-skip-permissions --resume aaa'));

    c.send({ type: 'input', id, data: 'oi\r' });
    await waitFor(() => c.messages.find((m) => m.type === 'exit' && m.id === id && m.code === 3));
    await waitFor(() => c.messages.some((m) => m.type === 'sessions' && m.sessions.some((s: any) => s.id === id && !s.alive)));

    c.send({ type: 'close', id });
    await waitFor(() => c.messages.at(-1)?.type === 'sessions' && c.messages.at(-1).sessions.length === 0);
  } finally {
    c.ws.close();
    await app.close();
  }
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd app/server && npm test`
Expected: `terminals.test.ts` falha com `Cannot find module '.../src/terminals.ts'`.

- [ ] **Step 3: Implementar o gerenciador de terminais**

```ts file=app/server/src/terminals.ts
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import nodePty from '@lydell/node-pty';
import type { IPty } from '@lydell/node-pty';
import type { SessionAgent, SessionInfo } from './types.ts';

/** Argumentos do llm-agent para cada agente, no modo autonomo do menu. */
export function agentArgs(agent: SessionAgent, resume?: string): string[] {
  switch (agent) {
    case 'claude':
      return ['claude', '--dangerously-skip-permissions', ...(resume ? ['--resume', resume] : [])];
    case 'codex':
      return resume
        ? ['codex', 'resume', '--dangerously-bypass-approvals-and-sandbox', resume]
        : ['codex', '--dangerously-bypass-approvals-and-sandbox'];
    case 'shell':
      return ['zsh'];
  }
}

export interface OpenRequest {
  projectPath: string;
  agent: SessionAgent;
  resume?: string;
  title: string;
  cols: number;
  rows: number;
}

interface Session {
  info: SessionInfo;
  proc: IPty;
  buffer: string;
}

export class TerminalManager extends EventEmitter {
  private readonly sessions = new Map<string, Session>();
  private readonly bin: string;
  private readonly maxBuffer: number;

  constructor(bin: string, maxBuffer = 1024 * 1024) {
    super();
    this.bin = bin;
    this.maxBuffer = maxBuffer;
  }

  open(req: OpenRequest): SessionInfo {
    const proc = nodePty.spawn(this.bin, agentArgs(req.agent, req.resume), {
      name: 'xterm-256color',
      cols: req.cols,
      rows: req.rows,
      cwd: req.projectPath,
      env: { ...process.env, AGENT_WORKDIR: req.projectPath } as Record<string, string>,
    });
    const info: SessionInfo = {
      id: randomUUID(),
      projectPath: req.projectPath,
      agent: req.agent,
      resume: req.resume,
      title: req.title,
      startedAt: new Date().toISOString(),
      alive: true,
    };
    const session: Session = { info, proc, buffer: '' };
    this.sessions.set(info.id, session);
    proc.onData((data) => {
      session.buffer = (session.buffer + data).slice(-this.maxBuffer);
      this.emit('output', info.id, data);
    });
    proc.onExit(({ exitCode }) => {
      info.alive = false;
      info.exitCode = exitCode;
      if (!this.sessions.has(info.id)) return;
      this.emit('exit', info.id, exitCode);
      this.emit('sessions');
    });
    this.emit('sessions');
    return { ...info };
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => ({ ...s.info }));
  }

  history(id: string): string | null {
    return this.sessions.get(id)?.buffer ?? null;
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (s?.info.alive) s.proc.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (s?.info.alive && cols > 0 && rows > 0) s.proc.resize(cols, rows);
  }

  close(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    if (s.info.alive) s.proc.kill();
    this.emit('sessions');
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }
}
```

- [ ] **Step 4: Ligar o WebSocket ao servidor**

Substituir `app/server/src/server.ts` inteiro por:

```ts file=app/server/src/server.ts
import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, SessionAgent } from './types.ts';
import { bearer, originAllowed, tokenMatches } from './auth.ts';
import { buildOverview, listProjects, projectDetail, projectPathFromId } from './catalog.ts';
import { scanConversations } from './conversations.ts';
import { isFile } from './files.ts';
import { TerminalManager } from './terminals.ts';

export interface AppOptions {
  home: string;
  /** 0 escolhe uma porta livre (testes). */
  port: number;
  token: string;
  webDir: string;
  /** Caminho do llm-agent executado pelos terminais. */
  bin: string;
  extraOrigins: string[];
}

export interface App {
  listen(): Promise<number>;
  close(): Promise<void>;
  broadcast(msg: ServerMessage): void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const AGENTS: SessionAgent[] = ['claude', 'codex', 'shell'];

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const size = (v: unknown, fallback: number): number =>
  Number.isInteger(v) && (v as number) > 0 && (v as number) < 1000 ? (v as number) : fallback;

export function createApp(opts: AppOptions): App {
  let port = opts.port;
  const webRoot = resolve(opts.webDir);
  const terminals = new TerminalManager(opts.bin);
  const clients = new Set<WebSocket>();

  const broadcast = (msg: ServerMessage): void => {
    const data = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
  };
  terminals.on('output', (id: string, data: string) => broadcast({ type: 'output', id, data }));
  terminals.on('exit', (id: string, code: number) => broadcast({ type: 'exit', id, code }));
  terminals.on('sessions', () => broadcast({ type: 'sessions', sessions: terminals.list() }));

  async function api(res: ServerResponse, pathname: string): Promise<void> {
    if (pathname === '/api/overview') return send(res, 200, await buildOverview(opts.home));
    const m = /^\/api\/projects\/([A-Za-z0-9_-]+)$/.exec(pathname);
    if (m) {
      const detail = await projectDetail(opts.home, projectPathFromId(m[1]), await scanConversations(opts.home));
      return detail ? send(res, 200, detail) : send(res, 404, { error: 'projeto não encontrado' });
    }
    send(res, 404, { error: 'rota desconhecida' });
  }

  async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
    let file = resolve(webRoot, '.' + decodeURIComponent(pathname));
    if (file !== webRoot && !file.startsWith(webRoot + sep)) return send(res, 403, 'proibido', 'text/plain; charset=utf-8');
    if (!(await isFile(file))) file = join(webRoot, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      send(res, 404, 'Interface não construída: rode "npm ci && npm run build" em app/web.', 'text/plain; charset=utf-8');
    }
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/api/health') return send(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/')) {
        if (!originAllowed(req.headers.origin, port, opts.extraOrigins)) return send(res, 403, { error: 'origem não permitida' });
        if (!tokenMatches(bearer(req.headers.authorization), opts.token)) return send(res, 401, { error: 'token inválido' });
        return await api(res, url.pathname);
      }
      await serveStatic(res, url.pathname);
    } catch (err) {
      if (!res.headersSent) send(res, err instanceof URIError ? 400 : 500, { error: String(err) });
    }
  });

  async function handle(ws: WebSocket, msg: ClientMessage): Promise<void> {
    const reply = (m: ServerMessage) => ws.send(JSON.stringify(m));
    switch (msg.type) {
      case 'open': {
        if (!AGENTS.includes(msg.agent)) return reply({ type: 'error', message: 'agente inválido' });
        const convs = await scanConversations(opts.home);
        const projects = await listProjects(opts.home, convs);
        if (!projects.some((p) => p.path === msg.projectPath)) {
          return reply({ type: 'error', message: `projeto desconhecido: ${msg.projectPath}` });
        }
        let title = msg.agent === 'shell' ? 'shell' : 'nova conversa';
        if (msg.resume !== undefined) {
          const conv = convs.find((c) => c.id === msg.resume && c.agent === msg.agent && c.cwd === msg.projectPath);
          if (!conv) return reply({ type: 'error', message: `conversa desconhecida: ${msg.resume}` });
          title = conv.title;
        }
        const session = terminals.open({
          projectPath: msg.projectPath,
          agent: msg.agent,
          resume: msg.resume,
          title,
          cols: size(msg.cols, 80),
          rows: size(msg.rows, 24),
        });
        return reply({ type: 'opened', session });
      }
      case 'attach': {
        const data = terminals.history(msg.id);
        if (data !== null) reply({ type: 'history', id: msg.id, data });
        return;
      }
      case 'input':
        return terminals.write(msg.id, String(msg.data ?? ''));
      case 'resize':
        return terminals.resize(msg.id, size(msg.cols, 80), size(msg.rows, 24));
      case 'close':
        return terminals.close(msg.id);
    }
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const allowed =
      url.pathname === '/ws' &&
      originAllowed(req.headers.origin, port, opts.extraOrigins) &&
      tokenMatches(url.searchParams.get('token'), opts.token);
    if (!allowed) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.send(JSON.stringify({ type: 'sessions', sessions: terminals.list() } satisfies ServerMessage));
      ws.on('message', (raw) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        handle(ws, msg).catch((err) => ws.send(JSON.stringify({ type: 'error', message: String(err?.message ?? err) })));
      });
    });
  });

  return {
    listen: () =>
      new Promise((ok, fail) => {
        server.once('error', fail);
        server.listen(opts.port, '127.0.0.1', () => {
          port = (server.address() as AddressInfo).port;
          ok(port);
        });
      }),
    close: async () => {
      terminals.closeAll();
      for (const c of clients) c.terminate();
      wss.close();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
    broadcast,
  };
}
```

- [ ] **Step 5: Ver passar**

Run: `cd app/server && npm test && npm run typecheck`
Expected: todos `ok`, `fail 0`; `tsc` sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/server/src/terminals.ts app/server/src/server.ts app/server/test/terminals.test.ts
git commit -m "Run agent sessions in PTYs over a WebSocket"
```

---

### Task 6: Processo do servidor, observador de arquivos e `llm-agent ui`

**Files:**
- Create: `app/server/src/watch.ts`, `app/server/src/main.ts`, `app/server/test/watch.test.ts`, `app/ui.sh`, `tests/ui.test.sh`
- Modify: `llm-agent` (cabeçalho de uso e despacho do subcomando `ui`)

**Interfaces:**
- Consumes: `createApp`, `loadOrCreateToken`.
- Produces: `watchPaths(paths, onChange, delay?): () => void`; comando `llm-agent ui [--stop]` (última linha da saída: a URL); `server.json` com `{"pid":N,"port":N}` em `stateDir`; variáveis `LLM_AGENT_UI_PORT`, `LLM_AGENT_UI_STATE_DIR`, `LLM_AGENT_UI_ORIGINS`, `LLM_AGENT_UI_NO_BUILD`, `LLM_AGENT_BIN`.

- [ ] **Step 1: Testes do observador e do comando**

```ts file=app/server/test/watch.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { watchPaths } from '../src/watch.ts';
import { tempHome, waitFor, write } from './helpers.ts';

test('watchPaths agrupa eventos e ignora caminhos inexistentes', async () => {
  const dir = tempHome();
  let calls = 0;
  const stop = watchPaths([dir, join(dir, 'nao-existe')], () => calls++, 100);
  try {
    write(join(dir, 'a', 'b.txt'), '1');
    write(join(dir, 'c.txt'), '2');
    await waitFor(() => calls > 0, 3000);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(calls, 1);
  } finally {
    stop();
  }
});
```

```bash file=tests/ui.test.sh
#!/usr/bin/env bash
# Testa o "llm-agent ui": sobe o servidor, reaproveita, protege a API e encerra.
# Requer Node >= 22.18 e "npm ci" ja executado em app/server.
set -uo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
if [ ! -d "$repo/app/server/node_modules" ]; then
  echo "rode antes: npm --prefix app/server ci" >&2
  exit 1
fi

work="$(mktemp -d)"
export HOME="$work/home" XDG_CONFIG_HOME="$work/home/.config" LLM_AGENT_UI_NO_BUILD=1
LLM_AGENT_UI_PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
export LLM_AGENT_UI_PORT
mkdir -p "$HOME"
state="$XDG_CONFIG_HOME/llm-agent/ui"
base="http://127.0.0.1:$LLM_AGENT_UI_PORT"
cleanup() {
  "$repo/llm-agent" ui --stop >/dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT

failures=0
check() { # descricao esperado obtido
  if [ "$3" = "$2" ]; then
    echo "ok - $1"
  else
    echo "FAIL - $1"
    echo "  esperado: $2"
    echo "  obtido:   $3"
    failures=$((failures + 1))
  fi
}
server_pid() { grep -o '"pid":[0-9]*' "$state/server.json" 2>/dev/null | cut -d: -f2; }

url="$("$repo/llm-agent" ui | tail -n 1)"
token="$(cat "$state/token" 2>/dev/null)"
check "imprime a URL com o token" "$base/#token=$token" "$url"
check "token tem permissao 600" "600" "$(stat -c %a "$state/token" 2>/dev/null)"
check "health responde" '{"ok":true}' "$(curl -fsS "$base/api/health")"
check "API sem token: 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$base/api/overview")"
check "API com token: 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" "$base/api/overview")"

pid1="$(server_pid)"
"$repo/llm-agent" ui >/dev/null
check "reaproveita o servidor" "$pid1" "$(server_pid)"

"$repo/llm-agent" ui --stop >/dev/null
check "--stop encerra" "parado" "$(curl -fsS --max-time 1 "$base/api/health" >/dev/null 2>&1 && echo rodando || echo parado)"
check "--stop remove o server.json" "nao" "$([ -e "$state/server.json" ] && echo sim || echo nao)"

[ "$failures" -eq 0 ] && echo "todos os testes passaram" || { echo "$failures falha(s)"; exit 1; }
```

```bash
chmod +x tests/ui.test.sh
```

- [ ] **Step 2: Ver falhar**

Run: `(cd app/server && npm test) ; tests/ui.test.sh`
Expected: `watch.test.ts` falha com `Cannot find module '.../src/watch.ts'`; `tests/ui.test.sh` falha em "imprime a URL com o token" (o `llm-agent` ainda não conhece `ui`).

- [ ] **Step 3: Implementar o observador e o processo do servidor**

```ts file=app/server/src/watch.ts
import { watch, type FSWatcher } from 'node:fs';

/**
 * Observa as pastas (recursivo) e chama onChange uma vez por rajada de
 * eventos. Pastas que nao existem sao ignoradas. Devolve a funcao de parar.
 */
export function watchPaths(paths: string[], onChange: () => void, delay = 500): () => void {
  let timer: NodeJS.Timeout | undefined;
  const watchers: FSWatcher[] = [];
  for (const path of paths) {
    try {
      const w = watch(path, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(onChange, delay);
      });
      w.on('error', () => w.close());
      watchers.push(w);
    } catch {
      // pasta inexistente
    }
  }
  return () => {
    clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}
```

```ts file=app/server/src/main.ts
// Processo do servidor da interface. Normalmente iniciado por "llm-agent ui".
import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from './server.ts';
import { loadOrCreateToken } from './auth.ts';
import { watchPaths } from './watch.ts';

const home = process.env.HOME;
if (!home) {
  console.error('llm-agent ui: HOME nao definido');
  process.exit(1);
}

const repo = resolve(import.meta.dirname, '..', '..', '..');
const stateDir =
  process.env.LLM_AGENT_UI_STATE_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'llm-agent', 'ui');
const token = loadOrCreateToken(stateDir);

const app = createApp({
  home,
  port: Number(process.env.LLM_AGENT_UI_PORT ?? 7777),
  token,
  webDir: join(repo, 'app', 'web', 'dist'),
  bin: process.env.LLM_AGENT_BIN ?? join(repo, 'llm-agent'),
  extraOrigins: (process.env.LLM_AGENT_UI_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
});

const port = await app.listen();
const serverJson = join(stateDir, 'server.json');
writeFileSync(serverJson, JSON.stringify({ pid: process.pid, port }) + '\n', { mode: 0o600 });

const stopWatching = watchPaths(
  [
    join(home, '.claude', 'projects'),
    join(home, '.codex', 'sessions'),
    join(home, '.claude', 'skills'),
    join(home, '.codex', 'skills'),
  ],
  () => app.broadcast({ type: 'changed' }),
);
console.log(`llm-agent ui ouvindo em http://127.0.0.1:${port}`);

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  stopWatching();
  await app.close();
  rmSync(serverJson, { force: true });
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
```

- [ ] **Step 4: Implementar o comando**

```bash file=app/ui.sh
#!/usr/bin/env bash
# Sobe (ou reaproveita) o servidor da interface e imprime a URL de acesso na
# ultima linha. Chamado por "llm-agent ui".
#
# Uso:
#   llm-agent ui          sobe ou reaproveita o servidor e imprime a URL
#   llm-agent ui --stop   encerra o servidor e as sessoes abertas nele
#
# Variaveis:
#   LLM_AGENT_UI_PORT      porta (padrao: 7777)
#   LLM_AGENT_UI_ORIGINS   origens extras aceitas, separadas por virgula
#                          (ex.: http://localhost:5173 para o "npm run dev")
#   LLM_AGENT_UI_NO_BUILD=1  nao instala dependencias nem constroi a UI
set -euo pipefail

app_dir="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd -P)"
state_dir="${XDG_CONFIG_HOME:-$HOME/.config}/llm-agent/ui"
server_json="$state_dir/server.json"
log="$state_dir/server.log"
port="${LLM_AGENT_UI_PORT:-7777}"
mkdir -p "$state_dir"
chmod 700 "$state_dir"

json_field() { grep -o "\"$1\":[0-9]*" "$server_json" 2>/dev/null | cut -d: -f2; }
running_pid() {
  local pid
  pid="$(json_field pid)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && echo "$pid"
}
healthy() { curl -fsS --max-time 2 "http://127.0.0.1:$1/api/health" >/dev/null 2>&1; }

if [ "${1:-}" = "--stop" ]; then
  if pid="$(running_pid)"; then
    kill "$pid"
    for _ in $(seq 1 50); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.1
    done
    rm -f "$server_json"
    echo "Servidor encerrado."
  else
    rm -f "$server_json"
    echo "O servidor nao esta rodando."
  fi
  exit 0
fi

for cmd in node curl; do
  command -v "$cmd" >/dev/null || { echo "llm-agent ui: '$cmd' nao encontrado." >&2; exit 1; }
done

if running_pid >/dev/null && healthy "$(json_field port)"; then
  port="$(json_field port)"
else
  if [ -z "${LLM_AGENT_UI_NO_BUILD:-}" ]; then
    if [ ! -d "$app_dir/server/node_modules" ]; then
      echo "Instalando dependencias do servidor..." >&2
      npm --prefix "$app_dir/server" ci --silent >&2
    fi
    if [ ! -f "$app_dir/web/dist/index.html" ]; then
      echo "Construindo a interface (so na primeira vez)..." >&2
      npm --prefix "$app_dir/web" ci --silent >&2
      npm --prefix "$app_dir/web" run build --silent >&2
    fi
  fi
  LLM_AGENT_UI_PORT="$port" LLM_AGENT_UI_STATE_DIR="$state_dir" \
    setsid nohup node "$app_dir/server/src/main.ts" >>"$log" 2>&1 </dev/null &
  server=$!
  for _ in $(seq 1 50); do
    healthy "$port" && break
    kill -0 "$server" 2>/dev/null || break
    sleep 0.2
  done
  if ! healthy "$port"; then
    echo "llm-agent ui: o servidor nao subiu. Ultimas linhas de $log:" >&2
    tail -n 20 "$log" >&2
    echo "Se a porta $port estiver ocupada, use LLM_AGENT_UI_PORT=<outra porta>." >&2
    exit 1
  fi
fi

echo "http://127.0.0.1:$port/#token=$(cat "$state_dir/token")"
```

```bash
chmod +x app/ui.sh
```

Em `llm-agent`, no cabeçalho de uso, depois da linha `#   llm-agent zsh             abre um shell no container`, inserir:

```bash
#   llm-agent ui [--stop]     abre a interface (imprime a URL) ou a encerra
```

e, depois da linha `#   LLM_AGENT_NO_UPDATE_CHECK=1          nao procura versoes novas ao abrir`, inserir:

```bash
#   LLM_AGENT_UI_PORT         porta da interface (padrao: 7777)
```

Logo depois do bloco do `--help` (o `fi` que segue `exit 0`), inserir:

```bash
# A interface roda no host, sem Docker, e nao depende do diretorio atual.
if [ "${1:-}" = "ui" ]; then
  shift
  exec "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/app/ui.sh" "$@"
fi
```

- [ ] **Step 5: Ver passar**

Run: `(cd app/server && npm test && npm run typecheck) && tests/ui.test.sh && tests/remote-control.test.sh 2>/dev/null; bash -n llm-agent app/ui.sh`
Expected: testes do servidor `fail 0`; `tests/ui.test.sh` com 8 `ok` e `todos os testes passaram`; nenhum erro de sintaxe. (`tests/remote-control.test.sh` só existe depois do merge da etapa 1.)

- [ ] **Step 6: Commit**

```bash
git add app/server/src/watch.ts app/server/src/main.ts app/server/test/watch.test.ts app/ui.sh tests/ui.test.sh llm-agent
git commit -m "Add llm-agent ui to start, reuse and stop the UI server"
```

---

### Task 7: Base da UI web: cliente da API, abas e barramento de saída

**Files:**
- Create: `app/web/package.json`, `app/web/tsconfig.json`, `app/web/vite.config.ts`, `app/web/index.html`, `app/web/src/types.ts`, `app/web/src/api.ts`, `app/web/src/tabs.ts`, `app/web/src/bus.ts`, `app/web/test/api.test.ts`, `app/web/test/tabs.test.ts`, `app/web/test/bus.test.ts`

**Interfaces:**
- Consumes: tipos de `app/server/src/types.ts`.
- Produces: `takeToken(loc, storage, replace): string | null`; `Api` (`overview()`, `project(id)`); `LiveSocket` (`send(msg): boolean`, `stop()`); `backoff(attempt)`; `wsUrl(loc, token)`; `Status`; tabs: `TabsState`, `emptyTabs`, `addTab`, `closeTab`, `cycle`, `goto`, `syncTabs`, `shortcut(e): TabAction | null`, `applyAction(s, a): { state; closed?: string }`; `createBus()`/`bus` com `data(id, d)`, `history(id, d)`, `on(id, listener): () => void`; `View`.

- [ ] **Step 1: Pacote e configuração**

```json file=app/web/package.json
{
  "name": "llm-agent-ui-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc -p .",
    "test": "vitest run"
  },
  "dependencies": {
    "@xterm/addon-fit": "0.11.0",
    "@xterm/xterm": "6.0.0",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "react-markdown": "10.1.0"
  },
  "devDependencies": {
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.2.1",
    "typescript": "5.9.3",
    "vite": "8.3.5",
    "vitest": "5.1.0"
  }
}
```

```json file=app/web/tsconfig.json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2023", "dom", "dom.iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src", "test", "../server/src/types.ts"]
}
```

```ts file=app/web/vite.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Em "npm run dev", /api e /ws vao para o servidor do llm-agent ui. Rode o
// servidor com LLM_AGENT_UI_ORIGINS=http://localhost:5173.
const target = `http://127.0.0.1:${process.env.LLM_AGENT_UI_PORT ?? 7777}`;

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': target, '/ws': { target, ws: true } } },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

```html file=app/web/index.html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="referrer" content="no-referrer" />
    <title>llm-agent</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```ts file=app/web/src/types.ts
export type * from '../../server/src/types.ts';

export type View = { kind: 'profile' } | { kind: 'skills'; focus?: string } | { kind: 'project'; id: string };
```

- [ ] **Step 2: Escrever os testes**

```ts file=app/web/test/api.test.ts
import { describe, expect, it, vi } from 'vitest';
import { Api, LiveSocket, backoff, takeToken, wsUrl, type Status } from '../src/api.ts';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe('takeToken', () => {
  it('le o token do fragmento, guarda e limpa a URL', () => {
    const storage = memoryStorage();
    const replace = vi.fn();
    expect(takeToken({ hash: '#token=abc%2D1', pathname: '/', search: '?x=1' }, storage, replace)).toBe('abc-1');
    expect(storage.getItem('llm-agent-token')).toBe('abc-1');
    expect(replace).toHaveBeenCalledWith('/?x=1');
  });
  it('sem fragmento, usa o token guardado', () => {
    const storage = memoryStorage();
    storage.setItem('llm-agent-token', 'salvo');
    expect(takeToken({ hash: '', pathname: '/', search: '' }, storage, vi.fn())).toBe('salvo');
  });
  it('sem nada, devolve null', () => {
    expect(takeToken({ hash: '', pathname: '/', search: '' }, memoryStorage(), vi.fn())).toBeNull();
  });
});

it('backoff dobra ate 10 s', () => {
  expect([0, 1, 2, 3, 4, 5, 10].map(backoff)).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000]);
});

it('wsUrl usa ws ou wss conforme o protocolo', () => {
  expect(wsUrl({ protocol: 'http:', host: '127.0.0.1:7777' }, 'a b')).toBe('ws://127.0.0.1:7777/ws?token=a%20b');
  expect(wsUrl({ protocol: 'https:', host: 'x' }, 't')).toBe('wss://x/ws?token=t');
});

it('Api manda o token no cabecalho e falha com o status', async () => {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
  );
  const api = new Api('tok', fetchImpl as unknown as typeof fetch);
  await api.overview();
  expect(fetchImpl).toHaveBeenCalledWith('/api/overview', { headers: { authorization: 'Bearer tok' } });
  const failing = new Api('tok', (async () => new Response('', { status: 401 })) as unknown as typeof fetch);
  await expect(failing.project('x')).rejects.toThrow('401');
});

class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (e: { data: string }) => void;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
}

it('LiveSocket reconecta com espera crescente e so envia aberto', () => {
  FakeWS.instances = [];
  const statuses: Status[] = [];
  const messages: unknown[] = [];
  const delays: number[] = [];
  const timers: (() => void)[] = [];
  const socket = new LiveSocket('ws://x/ws', (m) => messages.push(m), (s) => statuses.push(s), {
    WebSocketImpl: FakeWS as unknown as typeof WebSocket,
    schedule: (fn, ms) => { delays.push(ms); timers.push(fn); },
  });
  const first = FakeWS.instances[0];
  expect(socket.send({ type: 'attach', id: '1' })).toBe(false);
  first.open();
  expect(socket.send({ type: 'attach', id: '1' })).toBe(true);
  expect(first.sent).toEqual(['{"type":"attach","id":"1"}']);
  first.onmessage?.({ data: '{"type":"changed"}' });
  expect(messages).toEqual([{ type: 'changed' }]);
  first.close();
  timers.shift()!();
  FakeWS.instances[1].close();
  timers.shift()!();
  expect(delays).toEqual([500, 1000]);
  expect(FakeWS.instances).toHaveLength(3);
  FakeWS.instances[2].open();
  expect(statuses).toEqual(['connecting', 'open', 'closed', 'connecting', 'closed', 'connecting', 'open']);
  socket.stop();
  expect(timers).toHaveLength(0);
});
```

```ts file=app/web/test/tabs.test.ts
import { describe, expect, it } from 'vitest';
import { addTab, applyAction, closeTab, cycle, emptyTabs, goto, shortcut, syncTabs } from '../src/tabs.ts';

const three = { order: ['a', 'b', 'c'], active: 'b' };

describe('abas', () => {
  it('addTab acrescenta no fim e ativa; se ja existe, so ativa', () => {
    expect(addTab(emptyTabs, 'a')).toEqual({ order: ['a'], active: 'a' });
    expect(addTab(three, 'a')).toEqual({ order: ['a', 'b', 'c'], active: 'a' });
  });
  it('closeTab ativa a vizinha', () => {
    expect(closeTab(three, 'b')).toEqual({ order: ['a', 'c'], active: 'c' });
    expect(closeTab({ ...three, active: 'c' }, 'c')).toEqual({ order: ['a', 'b'], active: 'b' });
    expect(closeTab(three, 'a')).toEqual({ order: ['b', 'c'], active: 'b' });
    expect(closeTab({ order: ['a'], active: 'a' }, 'a')).toEqual(emptyTabs);
  });
  it('cycle da a volta', () => {
    expect(cycle(three, 1).active).toBe('c');
    expect(cycle({ ...three, active: 'c' }, 1).active).toBe('a');
    expect(cycle({ ...three, active: 'a' }, -1).active).toBe('c');
    expect(cycle(emptyTabs, 1)).toEqual(emptyTabs);
  });
  it('goto ignora indice inexistente', () => {
    expect(goto(three, 0).active).toBe('a');
    expect(goto(three, 8)).toBe(three);
  });
  it('syncTabs remove sessoes que sumiram e acrescenta as novas', () => {
    expect(syncTabs(three, ['c', 'd', 'a'])).toEqual({ order: ['a', 'c', 'd'], active: 'a' });
    expect(syncTabs(three, ['b'])).toEqual({ order: ['b'], active: 'b' });
  });
});

describe('atalhos', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
    key: k, ctrlKey: true, shiftKey: false, altKey: false, ...mods,
  });
  it('mapeia Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1..9 e Ctrl+Shift+W', () => {
    expect(shortcut(key('Tab'))).toEqual({ type: 'next' });
    expect(shortcut(key('Tab', { shiftKey: true }))).toEqual({ type: 'prev' });
    expect(shortcut(key('3'))).toEqual({ type: 'goto', index: 2 });
    expect(shortcut(key('W', { shiftKey: true }))).toEqual({ type: 'close' });
  });
  it('ignora o resto', () => {
    expect(shortcut(key('Tab', { ctrlKey: false }))).toBeNull();
    expect(shortcut(key('c'))).toBeNull();
    expect(shortcut(key('0'))).toBeNull();
    expect(shortcut(key('3', { altKey: true }))).toBeNull();
  });
  it('applyAction informa a aba fechada', () => {
    expect(applyAction(three, { type: 'close' })).toEqual({ state: { order: ['a', 'c'], active: 'c' }, closed: 'b' });
    expect(applyAction(three, { type: 'next' })).toEqual({ state: { order: ['a', 'b', 'c'], active: 'c' } });
    expect(applyAction(emptyTabs, { type: 'close' })).toEqual({ state: emptyTabs });
  });
});
```

```ts file=app/web/test/bus.test.ts
import { expect, it } from 'vitest';
import { createBus } from '../src/bus.ts';

it('guarda a saida ate o terminal montar', () => {
  const bus = createBus();
  bus.data('a', 'um ');
  bus.data('a', 'dois');
  const got: [string, boolean][] = [];
  bus.on('a', (d, reset) => got.push([d, reset]));
  expect(got).toEqual([['um ', false], ['dois', false]]);
  bus.data('a', 'tres');
  expect(got.at(-1)).toEqual(['tres', false]);
});

it('history substitui o pendente e pede reset', () => {
  const bus = createBus();
  bus.data('a', 'velho');
  bus.history('a', 'tudo');
  const got: [string, boolean][] = [];
  const off = bus.on('a', (d, reset) => got.push([d, reset]));
  expect(got).toEqual([['tudo', true]]);
  bus.history('a', 'de novo');
  expect(got.at(-1)).toEqual(['de novo', true]);
  off();
  bus.data('a', 'depois');
  const later: string[] = [];
  bus.on('a', (d) => later.push(d));
  expect(later).toEqual(['depois']);
});
```

- [ ] **Step 3: Instalar e ver falhar**

Run: `cd app/web && npm install && npm test`
Expected: os três arquivos falham com `Failed to load url ../src/api.ts` (ou equivalente para `tabs.ts` e `bus.ts`).

- [ ] **Step 4: Implementar**

```ts file=app/web/src/api.ts
import type { ClientMessage, Overview, ProjectDetail, ServerMessage } from './types.ts';

const TOKEN_KEY = 'llm-agent-token';

/**
 * Token vindo de "#token=..." (impresso pelo llm-agent ui). Fica no
 * sessionStorage e sai da barra de enderecos.
 */
export function takeToken(
  loc: { hash: string; pathname: string; search: string },
  storage: { getItem(k: string): string | null; setItem(k: string, v: string): void },
  replace: (url: string) => void,
): string | null {
  const m = /(?:^#|&)token=([^&]+)/.exec(loc.hash);
  if (m) {
    const token = decodeURIComponent(m[1]);
    storage.setItem(TOKEN_KEY, token);
    replace(loc.pathname + loc.search);
    return token;
  }
  return storage.getItem(TOKEN_KEY);
}

export class Api {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(token: string, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(path, { headers: { authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${path}`);
    return (await res.json()) as T;
  }

  overview(): Promise<Overview> {
    return this.get('/api/overview');
  }

  project(id: string): Promise<ProjectDetail> {
    return this.get(`/api/projects/${id}`);
  }
}

export type Status = 'connecting' | 'open' | 'closed';

export const backoff = (attempt: number): number => Math.min(10_000, 500 * 2 ** attempt);

export const wsUrl = (loc: { protocol: string; host: string }, token: string): string =>
  `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws?token=${encodeURIComponent(token)}`;

interface SocketDeps {
  WebSocketImpl?: typeof WebSocket;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** WebSocket que reconecta sozinho, com espera crescente ate 10 s. */
export class LiveSocket {
  private ws?: WebSocket;
  private attempt = 0;
  private stopped = false;
  private timer: unknown;
  private readonly url: string;
  private readonly onMessage: (m: ServerMessage) => void;
  private readonly onStatus: (s: Status) => void;
  private readonly WS: typeof WebSocket;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(url: string, onMessage: (m: ServerMessage) => void, onStatus: (s: Status) => void, deps: SocketDeps = {}) {
    this.url = url;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.WS = deps.WebSocketImpl ?? WebSocket;
    this.schedule = deps.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = deps.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.connect();
  }

  private connect(): void {
    this.onStatus('connecting');
    const ws = new this.WS(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.onStatus('open');
    };
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(String(e.data)));
      } catch {
        // mensagem invalida
      }
    };
    ws.onclose = () => {
      if (this.stopped) return;
      this.onStatus('closed');
      this.timer = this.schedule(() => this.connect(), backoff(this.attempt++));
    };
  }

  send(msg: ClientMessage): boolean {
    if (this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) this.cancel(this.timer);
    this.ws?.close();
  }
}
```

```ts file=app/web/src/tabs.ts
export interface TabsState {
  order: string[];
  active: string | null;
}

export const emptyTabs: TabsState = { order: [], active: null };

export type TabAction = { type: 'next' } | { type: 'prev' } | { type: 'goto'; index: number } | { type: 'close' };

export function addTab(s: TabsState, id: string): TabsState {
  return s.order.includes(id) ? { ...s, active: id } : { order: [...s.order, id], active: id };
}

export function closeTab(s: TabsState, id: string): TabsState {
  const i = s.order.indexOf(id);
  if (i < 0) return s;
  const order = s.order.filter((x) => x !== id);
  const active = s.active !== id ? s.active : (order[Math.min(i, order.length - 1)] ?? null);
  return { order, active };
}

export function cycle(s: TabsState, delta: 1 | -1): TabsState {
  if (!s.order.length) return s;
  const i = s.active ? s.order.indexOf(s.active) : -1;
  const n = (i + delta + s.order.length) % s.order.length;
  return { ...s, active: s.order[n] };
}

export function goto(s: TabsState, index: number): TabsState {
  return s.order[index] ? { ...s, active: s.order[index] } : s;
}

/** Alinha as abas com as sessoes do servidor (mantem a ordem local). */
export function syncTabs(s: TabsState, ids: string[]): TabsState {
  const known = new Set(ids);
  const kept = s.order.filter((id) => known.has(id));
  const order = [...kept, ...ids.filter((id) => !kept.includes(id))];
  const active = s.active && known.has(s.active) ? s.active : (order[0] ?? null);
  return { order, active };
}

export function shortcut(e: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): TabAction | null {
  if (!e.ctrlKey || e.altKey) return null;
  if (e.key === 'Tab') return { type: e.shiftKey ? 'prev' : 'next' };
  if (!e.shiftKey && /^[1-9]$/.test(e.key)) return { type: 'goto', index: Number(e.key) - 1 };
  if (e.shiftKey && e.key.toLowerCase() === 'w') return { type: 'close' };
  return null;
}

export function applyAction(s: TabsState, a: TabAction): { state: TabsState; closed?: string } {
  switch (a.type) {
    case 'next':
      return { state: cycle(s, 1) };
    case 'prev':
      return { state: cycle(s, -1) };
    case 'goto':
      return { state: goto(s, a.index) };
    case 'close':
      return s.active ? { state: closeTab(s, s.active), closed: s.active } : { state: s };
  }
}
```

```ts file=app/web/src/bus.ts
type Listener = (data: string, reset: boolean) => void;

/**
 * Leva a saida das sessoes ate os terminais. Guarda o que chega antes do
 * terminal montar; "history" substitui o pendente e pede para limpar a tela.
 */
export function createBus() {
  const listeners = new Map<string, Listener>();
  const pending = new Map<string, { reset: boolean; chunks: string[] }>();
  return {
    data(id: string, data: string): void {
      const listener = listeners.get(id);
      if (listener) return listener(data, false);
      const p = pending.get(id) ?? { reset: false, chunks: [] };
      p.chunks.push(data);
      pending.set(id, p);
    },
    history(id: string, data: string): void {
      const listener = listeners.get(id);
      if (listener) return listener(data, true);
      pending.set(id, { reset: true, chunks: [data] });
    },
    on(id: string, listener: Listener): () => void {
      listeners.set(id, listener);
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        p.chunks.forEach((chunk, i) => listener(chunk, p.reset && i === 0));
      }
      return () => {
        if (listeners.get(id) === listener) listeners.delete(id);
      };
    },
  };
}

export const bus = createBus();
```

- [ ] **Step 5: Ver passar**

Run: `cd app/web && npm test`
Expected: todos os testes `passed`.

- [ ] **Step 6: Commit**

```bash
git add app/web/package.json app/web/package-lock.json app/web/tsconfig.json app/web/vite.config.ts app/web/index.html app/web/src/types.ts app/web/src/api.ts app/web/src/tabs.ts app/web/src/bus.ts app/web/test
git commit -m "Add web UI client, tab logic and output bus"
```

---

### Task 8: Telas da UI

**Files:**
- Create: `app/web/src/main.tsx`, `app/web/src/App.tsx`, `app/web/src/format.ts`, `app/web/src/styles.css`, `app/web/src/components/Sidebar.tsx`, `app/web/src/components/FileCard.tsx`, `app/web/src/components/ProfilePanel.tsx`, `app/web/src/components/SkillsPanel.tsx`, `app/web/src/components/ProjectPanel.tsx`, `app/web/src/components/TerminalView.tsx`, `app/web/src/components/TerminalDrawer.tsx`, `app/web/src/components/SearchDialog.tsx`

**Interfaces:**
- Consumes: tudo da Task 7.
- Produces: a aplicação montada em `#root`. Não há consumidores posteriores no marco 1; o marco 2 troca a área central pela cena 3D e reaproveita `Connected`, painéis e gaveta.

- [ ] **Step 1: Utilitários, entrada e estilos**

```ts file=app/web/src/format.ts
import type { SessionAgent } from './types.ts';

export const LABEL: Record<SessionAgent, string> = { claude: 'Claude', codex: 'Codex', shell: 'Shell' };

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
```

```tsx file=app/web/src/main.tsx
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { App } from './App.tsx';

// Sem StrictMode: ele monta os terminais duas vezes e descartaria a saida
// que chega entre as montagens.
createRoot(document.getElementById('root')!).render(<App />);
```

```css file=app/web/src/styles.css
:root {
  --bg: #05060a;
  --panel: #0c0f18;
  --line: #1c2233;
  --text: #d8deea;
  --muted: #7d879c;
  --accent: #8ab4ff;
  --claude: #e8915a;
  --codex: #5ed69a;
  --shell: #b59cff;
  --warn: #f2c14e;
  --error: #ff6b6b;
  color-scheme: dark;
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  font-size: 14px;
  color: var(--text);
  background: radial-gradient(ellipse at 60% 40%, #10142a 0%, var(--bg) 60%);
}
* { box-sizing: border-box; }
body { margin: 0; }
button { font: inherit; color: inherit; background: #141a2a; border: 1px solid var(--line); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
button:hover { border-color: var(--accent); }
input { font: inherit; color: inherit; background: #0a0d16; border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; }
input:focus { outline: none; border-color: var(--accent); }
code { font-family: 'JetBrains Mono', 'Cascadia Code', monospace; font-size: 12px; color: var(--muted); }

.app { display: grid; grid-template-columns: 280px 1fr; grid-template-rows: 1fr auto; height: 100vh; }
.sidebar { grid-row: 1; display: flex; flex-direction: column; gap: 4px; padding: 16px 12px; border-right: 1px solid var(--line); background: rgba(12, 15, 24, 0.85); overflow: auto; }
.brand { font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); margin-bottom: 12px; }
.nav { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; background: transparent; border-color: transparent; }
.nav.active { background: #141c33; border-color: var(--line); }
.count { margin-left: auto; color: var(--muted); font-size: 12px; }
.filter { margin: 12px 0 4px; }
.projects { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.hint { margin-top: auto; color: var(--muted); font-size: 12px; padding-top: 12px; }
.pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--codex); box-shadow: 0 0 8px var(--codex); animation: pulse 1.6s infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }

.content { grid-row: 1; overflow: auto; padding: 24px 32px; position: relative; }
.panel h1 { margin: 0 0 4px; font-weight: 600; }
.panel h2 { margin: 28px 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
.muted { color: var(--muted); }
.error { color: var(--error); }
.warn { color: var(--warn); }
.banner { position: sticky; top: 0; z-index: 2; margin-bottom: 12px; padding: 6px 12px; border-radius: 6px; background: #1a2238; }
.banner.error { background: #3a1820; cursor: pointer; }
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 12px 0; }
.chip.active { border-color: var(--accent); color: var(--accent); }
.tag { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 10px; background: #172036; font-size: 12px; }
.tag.warn { background: #3a3218; }
.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.row { padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; background: rgba(12, 15, 24, 0.7); cursor: default; }
.row-title { display: flex; align-items: center; gap: 10px; }
.grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.desc { margin: 8px 0 0; color: var(--muted); }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.dot.claude, .launch.claude { --c: var(--claude); }
.dot.codex, .launch.codex { --c: var(--codex); }
.dot.shell, .launch.shell { --c: var(--shell); }
.dot { background: var(--c); box-shadow: 0 0 6px var(--c); }
.launch { border-color: var(--c); color: var(--c); }
.card { border: 1px solid var(--line); border-radius: 8px; margin: 6px 0; background: rgba(12, 15, 24, 0.7); }
.card summary { padding: 8px 12px; cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted); }
.markdown { padding: 0 16px 8px; line-height: 1.5; }

.drawer { grid-column: 1 / -1; grid-row: 2; display: flex; flex-direction: column; border-top: 1px solid var(--line); background: var(--bg); min-height: 36px; }
.drag { height: 5px; cursor: ns-resize; }
.drag:hover { background: var(--accent); }
.tabs { display: flex; gap: 2px; padding: 0 8px; overflow-x: auto; flex: none; }
.tab { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 6px 6px 0 0; color: var(--muted); cursor: pointer; white-space: nowrap; font-size: 12px; }
.tab.active { background: var(--panel); color: var(--text); }
.tab kbd { font-size: 10px; color: var(--muted); }
.tab .x { padding: 0 6px; border: none; background: transparent; }
.collapse { margin-left: auto; border: none; background: transparent; }
.terms { flex: 1; min-height: 0; position: relative; background: var(--panel); }
.term-wrap { position: absolute; inset: 0; }
.terminal { position: absolute; inset: 0; padding: 6px 8px; }
.ended { position: absolute; right: 16px; bottom: 12px; padding: 8px 12px; border-radius: 8px; background: #1a2238; z-index: 5; }

.overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: flex; justify-content: center; padding-top: 12vh; z-index: 10; }
.search { width: min(640px, 90vw); background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px; height: fit-content; }
.search input { width: 100%; }
.search ul { list-style: none; margin: 8px 0 0; padding: 0; max-height: 50vh; overflow: auto; }
.search li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.search li.active { background: #141c33; }
.fatal { padding: 48px; }
```

- [ ] **Step 2: Componentes**

```tsx file=app/web/src/components/FileCard.tsx
import ReactMarkdown from 'react-markdown';
import type { TextFile } from '../types.ts';

const stripFrontmatter = (s: string): string => s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

/** Arquivo markdown recolhivel. O react-markdown nao renderiza HTML bruto. */
export function FileCard({ file, open = false }: { file: TextFile; open?: boolean }) {
  return (
    <details className="card" open={open}>
      <summary>{file.path}</summary>
      {file.truncated && <p className="warn markdown">Arquivo grande: mostrando os primeiros 64 KB.</p>}
      <div className="markdown">
        <ReactMarkdown>{stripFrontmatter(file.content)}</ReactMarkdown>
      </div>
    </details>
  );
}
```

```tsx file=app/web/src/components/Sidebar.tsx
import { useState } from 'react';
import type { Overview, SessionInfo, View } from '../types.ts';

interface Props {
  overview: Overview | null;
  view: View;
  sessions: SessionInfo[];
  onSelect: (v: View) => void;
}

export function Sidebar({ overview, view, sessions, onSelect }: Props) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const projects = (overview?.projects ?? []).filter((p) => p.name.toLowerCase().includes(q));
  const live = new Set(sessions.filter((s) => s.alive).map((s) => s.projectPath));
  const cls = (active: boolean) => (active ? 'nav active' : 'nav');
  return (
    <nav className="sidebar">
      <div className="brand">llm-agent</div>
      <button className={cls(view.kind === 'profile')} onClick={() => onSelect({ kind: 'profile' })}>
        Você
      </button>
      <button className={cls(view.kind === 'skills')} onClick={() => onSelect({ kind: 'skills' })}>
        Skills <span className="count">{overview?.skills.length ?? 0}</span>
      </button>
      <input className="filter" placeholder="Filtrar projetos" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <ul className="projects">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              className={cls(view.kind === 'project' && view.id === p.id)}
              title={p.path}
              onClick={() => onSelect({ kind: 'project', id: p.id })}
            >
              {live.has(p.path) && <span className="pulse" aria-label="sessão aberta" />}
              {p.name}
              <span className="count">{p.conversations}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="hint">Ctrl+K busca · Ctrl+Tab alterna terminais</div>
    </nav>
  );
}
```

```tsx file=app/web/src/components/ProfilePanel.tsx
import type { Profile } from '../types.ts';
import { FileCard } from './FileCard.tsx';

export function ProfilePanel({ profile }: { profile?: Profile }) {
  if (!profile) return <p className="muted">Carregando…</p>;
  return (
    <section className="panel">
      <h1>Você</h1>
      <p className="muted">O que os agentes sabem sobre você.</p>
      <h2>Instruções globais</h2>
      {profile.instructions.length ? (
        profile.instructions.map((f) => <FileCard key={f.path} file={f} open />)
      ) : (
        <p className="muted">Nenhum CLAUDE.md ou AGENTS.md global.</p>
      )}
      <h2>Memórias</h2>
      {profile.memories.length ? (
        profile.memories.map((f) => <FileCard key={f.path} file={f} />)
      ) : (
        <p className="muted">Nenhuma memória sobre você ainda.</p>
      )}
    </section>
  );
}
```

```tsx file=app/web/src/components/SkillsPanel.tsx
import { useEffect, useState } from 'react';
import type { Skill } from '../types.ts';

export function SkillsPanel({ skills, focus }: { skills: Skill[]; focus?: string }) {
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState('todas');
  const [open, setOpen] = useState<string | undefined>(focus);
  useEffect(() => setOpen(focus), [focus]);

  const origins = ['todas', ...new Set(skills.map((s) => s.origin))];
  const q = query.trim().toLowerCase();
  const shown = skills.filter(
    (s) =>
      (origin === 'todas' || s.origin === origin) &&
      (s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)),
  );
  return (
    <section className="panel">
      <h1>Skills</h1>
      <div className="toolbar">
        <input placeholder="Buscar skill" value={query} onChange={(e) => setQuery(e.target.value)} />
        {origins.map((o) => (
          <button key={o} className={o === origin ? 'chip active' : 'chip'} onClick={() => setOrigin(o)}>
            {o}
          </button>
        ))}
      </div>
      <ul className="list">
        {shown.map((s) => (
          <li key={s.path} className="row" onClick={() => setOpen(open === s.path ? undefined : s.path)}>
            <div className="row-title">
              <strong className="grow">{s.name}</strong>
              <span className="tag">{s.origin}</span>
            </div>
            {open === s.path && (
              <p className="desc">
                {s.description || 'Sem descrição.'}
                <br />
                <code>{s.path}</code>
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

```tsx file=app/web/src/components/ProjectPanel.tsx
import { useEffect, useState } from 'react';
import type { Api } from '../api.ts';
import type { ProjectDetail, SessionAgent } from '../types.ts';
import { LABEL, formatDate } from '../format.ts';
import { FileCard } from './FileCard.tsx';

interface Props {
  api: Api;
  id: string;
  revision: number;
  onOpen: (projectPath: string, agent: SessionAgent, resume?: string) => void;
}

export function ProjectPanel({ api, id, revision, onOpen }: Props) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    api.project(id).then(
      (d) => current && (setDetail(d), setError(null)),
      (e: Error) => current && setError(e.message),
    );
    return () => {
      current = false;
    };
  }, [api, id, revision]);

  if (error) return <p className="error">{error}</p>;
  if (!detail || detail.id !== id) return <p className="muted">Carregando…</p>;
  return (
    <section className="panel">
      <h1>{detail.name}</h1>
      <p className="muted">
        <code>{detail.path}</code>
        {detail.git && <span className="tag">{detail.git.branch}</span>}
        {detail.git?.dirty && <span className="tag warn">mudanças pendentes</span>}
      </p>
      <div className="toolbar">
        {(['claude', 'codex', 'shell'] as const).map((a) => (
          <button key={a} className={`launch ${a}`} onClick={() => onOpen(detail.path, a)}>
            + {LABEL[a]}
          </button>
        ))}
      </div>
      <h2>Conversas</h2>
      {detail.conversationList.length ? (
        <ul className="list">
          {detail.conversationList.map((c) => (
            <li key={c.agent + c.id} className="row">
              <div className="row-title">
                <span className={`dot ${c.agent}`} title={LABEL[c.agent]} />
                <span className="grow" title={c.title}>{c.title}</span>
                <span className="muted">
                  {formatDate(c.updatedAt)} · {c.prompts} msg
                </span>
                <button onClick={() => onOpen(detail.path, c.agent, c.id)}>Retomar</button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nenhuma conversa.</p>
      )}
      {detail.instructions.length > 0 && (
        <>
          <h2>Instruções do projeto</h2>
          {detail.instructions.map((f) => <FileCard key={f.path} file={f} />)}
        </>
      )}
      {detail.memory.length > 0 && (
        <>
          <h2>Memória</h2>
          {detail.memory.map((f) => <FileCard key={f.path} file={f} />)}
        </>
      )}
    </section>
  );
}
```

```tsx file=app/web/src/components/TerminalView.tsx
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { LiveSocket } from '../api.ts';
import { bus } from '../bus.ts';
import { shortcut } from '../tabs.ts';

/** Um xterm por sessao, criado uma vez e mantido enquanto a aba existir. */
export function TerminalView({ id, active, socket }: { id: string; active: boolean; socket: LiveSocket }) {
  const ref = useRef<HTMLDivElement>(null);
  const fitRef = useRef<{ term: Terminal; fit: FitAddon } | null>(null);

  useEffect(() => {
    const el = ref.current!;
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#0c0f18' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // Atalhos das abas passam direto para a janela.
    term.attachCustomKeyEventHandler((e) => shortcut(e) === null);
    const input = term.onData((data) => socket.send({ type: 'input', id, data }));
    const resize = term.onResize(({ cols, rows }) => socket.send({ type: 'resize', id, cols, rows }));
    const off = bus.on(id, (data, reset) => {
      if (reset) term.reset();
      term.write(data);
    });
    const observer = new ResizeObserver(() => {
      if (el.offsetParent) fit.fit();
    });
    observer.observe(el);
    fitRef.current = { term, fit };
    return () => {
      observer.disconnect();
      off();
      input.dispose();
      resize.dispose();
      term.dispose();
    };
  }, [id, socket]);

  useEffect(() => {
    if (!active || !fitRef.current) return;
    fitRef.current.fit.fit();
    fitRef.current.term.focus();
  }, [active]);

  return <div className="terminal" ref={ref} />;
}
```

```tsx file=app/web/src/components/TerminalDrawer.tsx
import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { LiveSocket } from '../api.ts';
import type { ProjectSummary, SessionInfo } from '../types.ts';
import type { TabsState } from '../tabs.ts';
import { LABEL } from '../format.ts';
import { TerminalView } from './TerminalView.tsx';

interface Props {
  tabs: TabsState;
  sessions: SessionInfo[];
  projects: ProjectSummary[];
  socket: LiveSocket | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onReopen: (s: SessionInfo) => void;
}

export function TerminalDrawer({ tabs, sessions, projects, socket, onActivate, onClose, onReopen }: Props) {
  const [height, setHeight] = useState(340);
  const [collapsed, setCollapsed] = useState(false);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const names = new Map(projects.map((p) => [p.path, p.name]));
  if (!tabs.order.length || !socket) return null;

  const startDrag = (e: ReactMouseEvent) => {
    const startY = e.clientY;
    const startH = height;
    const move = (ev: MouseEvent) =>
      setHeight(Math.max(140, Math.min(window.innerHeight - 80, startH + startY - ev.clientY)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <section className="drawer" style={{ height: collapsed ? undefined : height }}>
      {!collapsed && <div className="drag" onMouseDown={startDrag} />}
      <div className="tabs">
        {tabs.order.map((id, i) => {
          const s = byId.get(id);
          if (!s) return null;
          return (
            <div
              key={id}
              className={id === tabs.active ? 'tab active' : 'tab'}
              title={s.projectPath}
              onClick={() => {
                onActivate(id);
                setCollapsed(false);
              }}
            >
              <span className={`dot ${s.agent}`} />
              {i < 9 && <kbd>{i + 1}</kbd>}
              {names.get(s.projectPath) ?? s.projectPath} · {LABEL[s.agent]} · {s.title}
              {!s.alive && ' (encerrada)'}
              <button
                className="x"
                aria-label="Fechar"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button className="collapse" onClick={() => setCollapsed(!collapsed)} aria-label="Recolher">
          {collapsed ? '▲' : '▼'}
        </button>
      </div>
      {/* Recolher so esconde: desmontar perderia o conteudo dos terminais. */}
      <div className="terms" style={{ display: collapsed ? 'none' : undefined }}>
        {tabs.order.map((id) => {
          const s = byId.get(id);
          if (!s) return null;
          return (
            <div key={id} className="term-wrap" style={{ display: id === tabs.active ? 'block' : 'none' }}>
              <TerminalView id={id} active={id === tabs.active && !collapsed} socket={socket} />
              {!s.alive && (
                <div className="ended">
                  Sessão encerrada{s.exitCode !== undefined && ` (código ${s.exitCode})`}.{' '}
                  <button onClick={() => onReopen(s)}>Reabrir</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

```tsx file=app/web/src/components/SearchDialog.tsx
import { useState, type KeyboardEvent } from 'react';
import type { Conversation, Overview } from '../types.ts';
import { LABEL } from '../format.ts';

interface Props {
  overview: Overview;
  onClose: () => void;
  onProject: (id: string) => void;
  onSkill: (path: string) => void;
  onConversation: (c: Conversation) => void;
}

interface Item {
  key: string;
  label: string;
  hint: string;
  run: () => void;
}

export function SearchDialog({ overview, onClose, onProject, onSkill, onConversation }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const q = query.trim().toLowerCase();
  const projectName = new Map(overview.projects.map((p) => [p.path, p.name]));
  const items: Item[] = q
    ? [
        ...overview.projects
          .filter((p) => p.name.toLowerCase().includes(q))
          .map((p) => ({ key: `p${p.id}`, label: p.name, hint: 'projeto', run: () => onProject(p.id) })),
        ...overview.conversations
          .filter((c) => c.title.toLowerCase().includes(q))
          .map((c) => ({
            key: `c${c.agent}${c.id}`,
            label: c.title,
            hint: `${LABEL[c.agent]} · ${projectName.get(c.cwd) ?? c.cwd}`,
            run: () => onConversation(c),
          })),
        ...overview.skills
          .filter((s) => s.name.toLowerCase().includes(q))
          .map((s) => ({ key: `s${s.path}`, label: s.name, hint: `skill · ${s.origin}`, run: () => onSkill(s.path) })),
      ].slice(0, 30)
    : [];

  const pick = (item: Item | undefined) => {
    if (!item) return;
    item.run();
    onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, items.length - 1));
    else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
    else if (e.key === 'Enter') pick(items[index]);
    else return;
    e.preventDefault();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="search" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Buscar projetos, conversas e skills"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKey}
        />
        <ul>
          {items.map((it, i) => (
            <li key={it.key} className={i === index ? 'active' : ''} onMouseEnter={() => setIndex(i)} onClick={() => pick(it)}>
              <span className="grow">{it.label}</span>
              <span className="muted">{it.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: App**

```tsx file=app/web/src/App.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Api, LiveSocket, takeToken, wsUrl, type Status } from './api.ts';
import { bus } from './bus.ts';
import { addTab, applyAction, closeTab, emptyTabs, shortcut, syncTabs, type TabsState } from './tabs.ts';
import type { Overview, ServerMessage, SessionAgent, SessionInfo, View } from './types.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { ProfilePanel } from './components/ProfilePanel.tsx';
import { SkillsPanel } from './components/SkillsPanel.tsx';
import { ProjectPanel } from './components/ProjectPanel.tsx';
import { TerminalDrawer } from './components/TerminalDrawer.tsx';
import { SearchDialog } from './components/SearchDialog.tsx';

export function App() {
  const token = useMemo(
    () => takeToken(window.location, window.sessionStorage, (url) => window.history.replaceState(null, '', url)),
    [],
  );
  if (!token) {
    return (
      <div className="fatal">
        Abra a interface pela URL impressa por <code>llm-agent ui</code>.
      </div>
    );
  }
  return <Connected token={token} />;
}

function Connected({ token }: { token: string }) {
  const api = useMemo(() => new Api(token), [token]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tabs, setTabs] = useState<TabsState>(emptyTabs);
  const [view, setView] = useState<View>({ kind: 'profile' });
  const [revision, setRevision] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [socket, setSocket] = useState<LiveSocket | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  useEffect(() => {
    api.overview().then(
      (o) => {
        setOverview(o);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, [api, revision]);

  useEffect(() => {
    // Depois de (re)conectar, o primeiro "sessions" pede o historico de todas.
    let needAttach = true;
    const ws = new LiveSocket(
      wsUrl(window.location, token),
      (m: ServerMessage) => {
        switch (m.type) {
          case 'sessions':
            setSessions(m.sessions);
            setTabs((t) => syncTabs(t, m.sessions.map((s) => s.id)));
            if (needAttach) {
              needAttach = false;
              for (const s of m.sessions) ws.send({ type: 'attach', id: s.id });
            }
            break;
          case 'opened':
            setTabs((t) => addTab(t, m.session.id));
            break;
          case 'output':
            bus.data(m.id, m.data);
            break;
          case 'history':
            bus.history(m.id, m.data);
            break;
          case 'changed':
            setRevision((r) => r + 1);
            break;
          case 'error':
            setError(m.message);
            break;
        }
      },
      (s) => {
        setStatus(s);
        if (s === 'open') {
          needAttach = true;
          setRevision((r) => r + 1);
        }
      },
    );
    setSocket(ws);
    return () => ws.stop();
  }, [token]);

  const openSession = useCallback(
    (projectPath: string, agent: SessionAgent, resume?: string) => {
      if (!socket?.send({ type: 'open', projectPath, agent, resume, cols: 120, rows: 30 })) {
        setError('Sem conexão com o servidor.');
      }
    },
    [socket],
  );

  const closeSession = useCallback(
    (id: string) => {
      socket?.send({ type: 'close', id });
      setTabs((t) => closeTab(t, id));
    },
    [socket],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inTerminal = (e.target as HTMLElement | null)?.closest?.('.terminal') != null;
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && !inTerminal) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      const action = shortcut(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      const { state, closed } = applyAction(tabsRef.current, action);
      if (closed) socket?.send({ type: 'close', id: closed });
      setTabs(state);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [socket]);

  return (
    <div className="app">
      <Sidebar overview={overview} view={view} sessions={sessions} onSelect={setView} />
      <main className="content">
        {status !== 'open' && <div className="banner">Reconectando ao servidor…</div>}
        {error && (
          <div className="banner error" onClick={() => setError(null)} title="Clique para fechar">
            {error}
          </div>
        )}
        {view.kind === 'profile' && <ProfilePanel profile={overview?.profile} />}
        {view.kind === 'skills' && <SkillsPanel skills={overview?.skills ?? []} focus={view.focus} />}
        {view.kind === 'project' && <ProjectPanel api={api} id={view.id} revision={revision} onOpen={openSession} />}
      </main>
      <TerminalDrawer
        tabs={tabs}
        sessions={sessions}
        projects={overview?.projects ?? []}
        socket={socket}
        onActivate={(id) => setTabs((t) => ({ ...t, active: id }))}
        onClose={closeSession}
        onReopen={(s) => {
          closeSession(s.id);
          openSession(s.projectPath, s.agent, s.resume);
        }}
      />
      {searchOpen && overview && (
        <SearchDialog
          overview={overview}
          onClose={() => setSearchOpen(false)}
          onProject={(id) => setView({ kind: 'project', id })}
          onSkill={(path) => setView({ kind: 'skills', focus: path })}
          onConversation={(c) => {
            const project = overview.projects.find((p) => p.path === c.cwd);
            if (project) setView({ kind: 'project', id: project.id });
            openSession(c.cwd, c.agent, c.id);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Checar tipos, testes e build**

Run: `cd app/web && npm run typecheck && npm test && npm run build`
Expected: `tsc` sem erros; testes `passed`; `vite build` gera `app/web/dist/index.html`.

- [ ] **Step 5: Verificação manual no navegador**

Run (no host WSL): `llm-agent ui --stop; llm-agent ui`
Expected: a URL impressa abre no navegador do Windows. Conferir:
1. "Você" mostra o `~/.claude/CLAUDE.md` e as memórias.
2. "Skills" lista as skills, com filtro por origem.
3. A lista de projetos tem os projetos com conversas; clicar num deles mostra conversas, memória e branch.
4. "+ Shell" abre uma aba com o shell do container no projeto; digitar funciona.
5. "Retomar" numa conversa do Claude abre o Claude com aquela conversa, e ela aparece no celular via Remote Control.
6. Com duas abas, `Ctrl+1` e `Ctrl+2` alternam. No navegador, `Ctrl+Tab` é do próprio navegador; no app Tauri (marco 3) funciona.
7. Recarregar a página (F5): as abas voltam com o conteúdo.
8. `Ctrl+K` fora do terminal abre a busca; buscar o título de uma conversa e dar Enter retoma a conversa.
9. `llm-agent ui --stop`: a página mostra "Reconectando ao servidor…"; `llm-agent ui` de novo reconecta sozinha (as abas somem, porque as sessões morreram junto com o servidor).

- [ ] **Step 6: Commit**

```bash
git add app/web/src
git commit -m "Add web UI: profile, skills, projects, terminals and search"
```

---

### Task 9: Documentação

**Files:**
- Modify: `README.md` (lista "Recursos"; nova seção "Interface" antes de "## O que o container enxerga"; seção "Desenvolvimento")

**Interfaces:**
- Consumes: comportamento das Tasks 1 a 8.

- [ ] **Step 1: Item em "Recursos"**

Depois do último item da lista `## Recursos`, inserir:

```markdown
- **Interface gráfica** (`llm-agent ui`): perfil, skills, projetos e conversas de todos os seus projetos, com terminais embutidos para abrir, retomar e alternar sessões do Claude Code, do Codex e do shell.
```

- [ ] **Step 2: Seção "Interface"**

Logo antes de `## O que o container enxerga`, inserir:

````markdown
## Interface

```sh
llm-agent ui          # sobe a interface e imprime a URL
llm-agent ui --stop   # encerra a interface e as sessões abertas nela
```

Abra a URL impressa no navegador. No WSL2, ela funciona direto no navegador do Windows. Na primeira execução, o comando instala as dependências e constrói a interface (precisa de Node.js 22.18 ou mais novo no host).

A interface mostra:

- **Você:** o `CLAUDE.md` e o `AGENTS.md` globais e as memórias que o Claude Code e o Codex guardaram sobre você.
- **Skills:** as skills do Claude Code, dos plugins e do Codex.
- **Projetos:** todos os projetos em que você já usou o Claude Code ou o Codex, com conversas, memória, instruções e branch do git.

Em cada projeto, os botões **+ Claude**, **+ Codex** e **+ Shell** abrem uma sessão nova, e **Retomar** reabre uma conversa. As sessões rodam no `llm-agent` de sempre, dentro do container, em abas na parte de baixo da tela. Elas continuam rodando se você fechar a página; ao reabrir, as abas voltam com o conteúdo.

Atalhos: `Ctrl+1`…`Ctrl+9` vão para uma aba, `Ctrl+Tab` e `Ctrl+Shift+Tab` alternam (no navegador, esses dois são do próprio navegador), `Ctrl+Shift+W` fecha a aba e `Ctrl+K`, fora do terminal, abre a busca.

O servidor escuta só em `127.0.0.1` (porta 7777, ou `LLM_AGENT_UI_PORT`) e exige o token que vai na URL, salvo em `~/.config/llm-agent/ui/token`. Quem tem a URL pode abrir agentes autônomos nos seus projetos, então não a compartilhe.
````

- [ ] **Step 3: Seção "Desenvolvimento"**

Na seção `## Desenvolvimento` (criada pela etapa 1; se ainda não existir, criá-la antes de `## Licença`), deixar o conteúdo assim:

````markdown
## Desenvolvimento

Os testes do launcher usam um Docker falso e não precisam de Docker:

```sh
tests/remote-control.test.sh
tests/ui.test.sh                          # requer: npm --prefix app/server ci
npm --prefix app/server test              # servidor da interface
npm --prefix app/web test                 # lógica da interface
```

Para mexer na interface com recarga automática:

```sh
LLM_AGENT_UI_ORIGINS=http://localhost:5173 llm-agent ui   # copie o token da URL
npm --prefix app/web run dev                              # abra http://localhost:5173/#token=<token>
```
````

- [ ] **Step 4: Conferir**

Run: `grep -n -E "^## Interface|llm-agent ui|LLM_AGENT_UI_ORIGINS" README.md`
Expected: o título `## Interface` e as linhas dos comandos.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "Document the llm-agent ui interface"
```
