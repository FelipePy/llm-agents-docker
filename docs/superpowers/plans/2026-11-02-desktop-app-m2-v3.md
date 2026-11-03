# App desktop, marco 2 (terceira versão): átomo dourado, cartões à direita, painel do dia e ações "+"

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Substitui `2026-11-02-desktop-app-m2-core.md`, já implementado e avaliado pelo usuário.

**Goal:** Átomo dourado (prótons, nêutrons, órbitas) que "esquenta" com a voz; conteúdo em cartões compactos numa coluna em arco à direita; painel do dia (hora, clima, notícias) à esquerda; botões "+" que abrem sessões do Claude instruídas para criar skill, registrar informações do usuário ou preparar um projeto novo.

**Architecture:** Servidor ganha `day.ts` (Open-Meteo e RSS, com cache e `fetch` injetável), `tasks.ts` (instruções das tarefas), a rota `/api/day` e as mensagens `task` e `create-project`; a pasta de trabalho do Jarvis fica fora da lista de projetos. Na UI, `scene/core.ts` passa a modelar "calor" (agitação) em vez de brilho; `ring.ts` ganha o nível "Você", os itens "+", os painéis novos e o arco à direita com espaçamento vertical uniforme; `DayPanel` substitui o menu no modo 3D.

**Tech Stack:** o mesmo dos marcos anteriores; nenhuma dependência nova.

Spec: `docs/superpowers/specs/2026-11-02-desktop-app-design.md` (seção "Marco 2").

## Global Constraints

- Paleta do átomo: prótons `#ffbf3c`, nêutrons `#f3e2b0`; órbitas por estado: idle `#b8913a`, listening `#ffd36b`, thinking `#ffb347`, speaking `#ffc94a`.
- Calor alvo: idle 0,05; listening 0,2; thinking 0,5; speaking 0,3 + 0,7 × nível. Sem halo e sem aumento de brilho ao falar.
- Cartões: espaçamento vertical de 40 px; de 6 a 18 por página (`pageSizeFor`).
- Nome de projeto novo: `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`.
- Pasta de trabalho: `${XDG_DATA_HOME:-$HOME/.local/share}/llm-agent/workspace`. Pasta-base de projetos: `LLM_AGENT_PROJECTS_DIR` ou a pasta-mãe mais comum dos projetos; sem projetos, `~/projetos`.
- `/api/day`: clima com cache de 15 min, notícias de 30 min, tempo limite de 5 s, até 8 notícias, só links `http(s)`.
- Variáveis novas: `LLM_AGENT_UI_CITY`, `LLM_AGENT_UI_NEWS_RSS`, `LLM_AGENT_PROJECTS_DIR`.
- Textos de interface em português.

## Convenção

Cada bloco marcado com `file=<caminho>` é o conteúdo **completo** do arquivo (criado ou substituído).

---

### Task 1: Servidor: painel do dia, tarefas e projeto novo

**Files:**
- Create: `app/server/src/day.ts`, `app/server/src/tasks.ts`, `app/server/test/fakes.ts`, `app/server/test/day.test.ts`
- Modify (substituir inteiros): `app/server/src/types.ts`, `app/server/src/catalog.ts`, `app/server/src/terminals.ts`, `app/server/src/server.ts`, `app/server/src/main.ts`, `app/server/test/app.ts`, `app/server/test/catalog.test.ts`, `app/server/test/terminals.test.ts`, `app/server/test/server.test.ts`

**Interfaces:**
- Produces: tipos `Weather`, `NewsItem`, `DayInfo`, `TaskName`; `Overview.projectsDir`; `ClientMessage` com `task` e `create-project`; `describeWeather(code)`, `parseRss(xml, limit?)`, `createDayService({ fetch, city?, newsUrl, now? })` → `{ day(lat?, lon?) }`, `NEWS_DEFAULT`; `TASKS`, `projectPrompt(path)`, `PROJECT_NAME`; `projectsBase(home, projects, configured?)`; `listProjects`/`projectDetail`/`buildOverview` com pastas ocultas; `agentArgs(agent, resume?, prompt?)`; `OpenRequest.prompt?`; `AppOptions` com `workspaceDir`, `projectsDir?`, `city?`, `newsUrl?`, `fetch?`.

- [ ] **Step 1: Tipos**

```ts file=app/server/src/types.ts
// Tipos compartilhados entre o servidor e a UI (app/web importa este arquivo).

export type Agent = 'claude' | 'codex';
export type SessionAgent = Agent | 'shell';
export type TaskName = 'new-skill' | 'about-me';

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
  /** Onde "+ Novo projeto" cria a pasta. */
  projectsDir: string;
}

export interface Weather {
  temperature: number;
  code: number;
  description: string;
  max: number;
  min: number;
  /** Nome da cidade (vazio quando veio da geolocalização). */
  place: string;
}

export interface NewsItem {
  title: string;
  source: string;
  link: string;
  published: string;
}

export interface DayInfo {
  weather: Weather | null;
  weatherError?: string;
  news: NewsItem[];
  newsError?: string;
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
  | { type: 'task'; task: TaskName; cols: number; rows: number }
  | { type: 'create-project'; name: string; cols: number; rows: number }
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

- [ ] **Step 2: Escrever os testes**

```ts file=app/server/test/fakes.ts
export const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Chuva forte em SP - G1]]></title><link>https://g1.example/a</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><source url="https://g1.example">G1</source></item>
<item><title>Bolsa &amp; dólar hoje - Valor</title><link>javascript:alert(1)</link><source url="x">Valor</source></item>
</channel></rss>`;

/** fetch falso: geocodificacao, previsao e RSS. Conta as chamadas. */
export function fakeFetch(opts: { failNews?: boolean } = {}) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('geocoding-api')) {
      return Response.json({ results: [{ latitude: -23.5, longitude: -46.6, name: 'São Paulo' }] });
    }
    if (url.includes('api.open-meteo.com')) {
      return Response.json({
        current: { temperature_2m: 24.6, weather_code: 2 },
        daily: { temperature_2m_max: [29.2], temperature_2m_min: [18.4] },
      });
    }
    if (url.includes('news')) return opts.failNews ? new Response('', { status: 503 }) : new Response(RSS);
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}
```

```ts file=app/server/test/day.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDayService, describeWeather, parseRss } from '../src/day.ts';
import { RSS, fakeFetch } from './fakes.ts';

test('describeWeather traduz os codigos WMO', () => {
  assert.equal(describeWeather(0), 'céu limpo');
  assert.equal(describeWeather(63), 'chuva');
  assert.equal(describeWeather(999), 'tempo indefinido');
});

test('parseRss le titulo, fonte e link, e descarta links que nao sao http(s)', () => {
  assert.deepEqual(parseRss(RSS), [
    { title: 'Chuva forte em SP', source: 'G1', link: 'https://g1.example/a', published: 'Mon, 02 Nov 2026 10:00:00 GMT' },
    { title: 'Bolsa & dólar hoje', source: 'Valor', link: '', published: '' },
  ]);
  assert.equal(parseRss(RSS, 1).length, 1);
});

test('day com coordenadas: clima e noticias, com cache', async () => {
  const f = fakeFetch();
  let now = 0;
  const service = createDayService({ fetch: f.impl, newsUrl: 'https://news.example/rss', now: () => now });
  const d = await service.day(-23.5, -46.6);
  assert.deepEqual(d.weather, { temperature: 25, code: 2, description: 'parcialmente nublado', max: 29, min: 18, place: '' });
  assert.equal(d.news.length, 2);
  await service.day(-23.5, -46.6);
  assert.equal(f.calls.length, 2, 'segunda chamada usa o cache');
  now = 16 * 60e3;
  await service.day(-23.5, -46.6);
  assert.equal(f.calls.filter((u) => u.includes('api.open-meteo.com')).length, 2, 'clima expira em 15 min');
  assert.equal(f.calls.filter((u) => u.includes('news')).length, 1, 'noticias ainda no cache');
});

test('day sem coordenadas usa a cidade configurada', async () => {
  const f = fakeFetch();
  const service = createDayService({ fetch: f.impl, city: 'São Paulo', newsUrl: 'https://news.example/rss' });
  const d = await service.day();
  assert.equal(d.weather?.place, 'São Paulo');
  assert.ok(f.calls[0].includes('name=S%C3%A3o%20Paulo'));
});

test('day sem localizacao e com noticias fora do ar: erros separados', async () => {
  const service = createDayService({ fetch: fakeFetch({ failNews: true }).impl, newsUrl: 'https://news.example/rss' });
  const d = await service.day();
  assert.equal(d.weather, null);
  assert.match(d.weatherError ?? '', /LLM_AGENT_UI_CITY/);
  assert.deepEqual(d.news, []);
  assert.match(d.newsError ?? '', /503/);
});
```

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
    home,
    port: 0,
    token: 'tok',
    webDir: join(home, 'web'),
    bin: '/bin/false',
    extraOrigins: ['http://dev:5173'],
    workspaceDir: join(home, 'workspace'),
    ...extra,
  });
  const port = await app.listen();
  return { app, port, base: `http://127.0.0.1:${port}` };
}
```

```ts file=app/server/test/catalog.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildOverview, gitInfo, listProjects, listSkills, projectDetail, projectId, projectPathFromId, projectsBase, readProfile,
} from '../src/catalog.ts';
import { scanConversations } from '../src/conversations.ts';
import { buildFixture } from './fixture.ts';
import { jsonl, tempHome, write } from './helpers.ts';

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

test('buildOverview esconde pastas ocultas e informa a pasta de projetos', async () => {
  const fx = buildFixture();
  const ws = join(fx.home, 'ws');
  mkdirSync(ws);
  write(join(fx.home, '.claude', 'projects', '-ws', 'w1.jsonl'), jsonl({ type: 'user', cwd: ws, message: { content: 'oi' } }));
  assert.equal((await buildOverview(fx.home)).projects.length, 2);
  const o = await buildOverview(fx.home, { hidden: [ws] });
  assert.deepEqual(o.projects.map((p) => p.name), ['meu-app']);
  assert.equal(o.projectsDir, join(fx.home, 'dev'));
  assert.equal((await buildOverview(fx.home, { projectsDir: '/x/y' })).projectsDir, '/x/y');
});

test('projectsBase sem projetos usa ~/projetos', () => {
  assert.equal(projectsBase('/h', []), '/h/projetos');
});
```

```ts file=app/server/test/terminals.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
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
  assert.deepEqual(agentArgs('claude', undefined, 'oi'), ['claude', '--dangerously-skip-permissions', 'oi']);
  assert.deepEqual(agentArgs('codex'), ['codex', '--dangerously-bypass-approvals-and-sandbox']);
  assert.deepEqual(agentArgs('codex', 'xyz'), ['codex', 'resume', '--dangerously-bypass-approvals-and-sandbox', 'xyz']);
  assert.deepEqual(agentArgs('codex', undefined, 'oi'), ['codex', '--dangerously-bypass-approvals-and-sandbox', 'oi']);
  assert.deepEqual(agentArgs('shell', undefined, 'oi'), ['zsh']);
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

test('WebSocket: tarefas abrem o Claude na pasta de trabalho com a instrucao', async () => {
  const fx = buildFixture();
  const workspace = join(fx.home, 'workspace');
  const { app, port } = await startApp(fx.home, { bin: fakeAgent(fx.home) });
  const c = await connect(port);
  try {
    c.send({ type: 'task', task: 'toString', cols: 80, rows: 24 });
    await waitFor(() => c.messages.find((m) => m.type === 'error' && m.message.includes('tarefa desconhecida')));

    c.send({ type: 'task', task: 'new-skill', cols: 80, rows: 24 });
    const opened = await waitFor(() => c.messages.find((m) => m.type === 'opened'));
    assert.equal(opened.session.title, 'nova skill');
    assert.equal(opened.session.projectPath, workspace);
    assert.ok(existsSync(workspace));
    await waitFor(() =>
      c.messages.some((m) => m.type === 'output' && m.data.includes('ARGS:claude --dangerously-skip-permissions Quero criar uma skill')),
    );

    // Reabrir uma sessao de tarefa: a pasta de trabalho e aceita.
    c.send({ type: 'open', projectPath: workspace, agent: 'claude', cols: 80, rows: 24 });
    await waitFor(() => c.messages.filter((m) => m.type === 'opened').length === 2);
  } finally {
    c.ws.close();
    await app.close();
  }
});

test('WebSocket: create-project cria a pasta na pasta-base e abre o Claude', async () => {
  const fx = buildFixture();
  const { app, port } = await startApp(fx.home, { bin: fakeAgent(fx.home) });
  const c = await connect(port);
  try {
    c.send({ type: 'create-project', name: '../fora', cols: 80, rows: 24 });
    await waitFor(() => c.messages.find((m) => m.type === 'error' && m.message.includes('nome de projeto inválido')));

    c.send({ type: 'create-project', name: 'novo-app', cols: 80, rows: 24 });
    const opened = await waitFor(() => c.messages.find((m) => m.type === 'opened'));
    const path = join(fx.home, 'dev', 'novo-app');
    assert.equal(opened.session.projectPath, path);
    assert.ok(existsSync(path));
    await waitFor(() => c.messages.some((m) => m.type === 'output' && m.data.includes('Este é um projeto novo')));

    c.send({ type: 'create-project', name: 'novo-app', cols: 80, rows: 24 });
    await waitFor(() => c.messages.find((m) => m.type === 'error' && m.message.includes('já existe')));
  } finally {
    c.ws.close();
    await app.close();
  }
});
```

Em `app/server/test/server.test.ts`, substituir o arquivo inteiro por:

```ts file=app/server/test/server.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { loadOrCreateToken, originAllowed, tokenMatches } from '../src/auth.ts';
import { projectId } from '../src/catalog.ts';
import { httpGet, startApp } from './app.ts';
import { fakeFetch } from './fakes.ts';
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
    assert.equal(o.projectsDir, join(fx.home, 'dev'));
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

test('/api/day devolve clima e noticias', async () => {
  const { app, base } = await startApp(tempHome(), { fetch: fakeFetch().impl, newsUrl: 'https://news.example/rss' });
  try {
    assert.equal((await httpGet(`${base}/api/day?lat=1&lon=2`)).status, 401);
    const d = JSON.parse((await httpGet(`${base}/api/day?lat=1&lon=2`, auth)).body);
    assert.equal(d.weather.temperature, 25);
    assert.equal(d.news.length, 2);
    const bad = JSON.parse((await httpGet(`${base}/api/day?lat=999&lon=2`, auth)).body);
    assert.equal(bad.weather, null, 'coordenada invalida conta como ausente');
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

- [ ] **Step 3: Ver falhar**

Run: `cd app/server && npm test`
Expected: `day.test.ts` falha ao carregar `../src/day.ts`; `server.test.ts` falha nos testes novos (`/api/day`, `projectsDir`); testes novos de `catalog` e `terminals` falham (`projectsBase` inexistente, prompt não passado, mensagens `task`/`create-project` sem resposta).

- [ ] **Step 4: Implementar**

```ts file=app/server/src/day.ts
import type { DayInfo, NewsItem, Weather } from './types.ts';

export const NEWS_DEFAULT = 'https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419';

const WMO: [number[], string][] = [
  [[0], 'céu limpo'],
  [[1], 'poucas nuvens'],
  [[2], 'parcialmente nublado'],
  [[3], 'nublado'],
  [[45, 48], 'neblina'],
  [[51, 53, 55], 'garoa'],
  [[56, 57], 'garoa congelante'],
  [[61, 63, 65], 'chuva'],
  [[66, 67], 'chuva congelante'],
  [[71, 73, 75, 77], 'neve'],
  [[80, 81, 82], 'pancadas de chuva'],
  [[85, 86], 'pancadas de neve'],
  [[95], 'trovoadas'],
  [[96, 99], 'trovoadas com granizo'],
];

export function describeWeather(code: number): string {
  return WMO.find(([codes]) => codes.includes(code))?.[1] ?? 'tempo indefinido';
}

const decode = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

const tag = (xml: string, name: string): string => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decode(m[1]) : '';
};

/** Itens de um RSS: titulo (sem o " - Fonte" do Google), fonte, link http(s) e data. */
export function parseRss(xml: string, limit = 8): NewsItem[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items
    .slice(0, limit)
    .map((item) => {
      const source = tag(item, 'source');
      let title = tag(item, 'title');
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      const link = tag(item, 'link');
      return { title, source, link: /^https?:\/\//.test(link) ? link : '', published: tag(item, 'pubDate') };
    })
    .filter((n) => n.title);
}

export interface DayOptions {
  fetch: typeof fetch;
  /** Cidade usada quando o navegador nao manda coordenadas. */
  city?: string;
  newsUrl: string;
  now?: () => number;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createDayService(opts: DayOptions) {
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; value: unknown }>();

  /** So guarda resultados de sucesso. */
  async function memo<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.value as T;
    const value = await load();
    cache.set(key, { at: now(), value });
    return value;
  }

  async function get(url: string): Promise<Response> {
    const res = await opts.fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${new URL(url).host}`);
    return res;
  }

  async function locate(lat?: number, lon?: number): Promise<{ lat: number; lon: number; place: string }> {
    if (lat !== undefined && lon !== undefined) return { lat, lon, place: '' };
    const city = opts.city;
    if (!city) throw new Error('Permita a localização no navegador ou defina LLM_AGENT_UI_CITY.');
    return memo(`geo:${city}`, 24 * 3600e3, async () => {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt`;
      const r = (await (await get(url)).json()).results?.[0];
      if (!r) throw new Error(`Cidade não encontrada: ${city}`);
      return { lat: r.latitude, lon: r.longitude, place: r.name };
    });
  }

  async function weather(lat?: number, lon?: number): Promise<Weather> {
    const loc = await locate(lat, lon);
    return memo(`w:${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`, 15 * 60e3, async () => {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
        '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1';
      const d = await (await get(url)).json();
      const code = Number(d.current?.weather_code);
      return {
        temperature: Math.round(d.current?.temperature_2m),
        code,
        description: describeWeather(code),
        max: Math.round(d.daily?.temperature_2m_max?.[0]),
        min: Math.round(d.daily?.temperature_2m_min?.[0]),
        place: loc.place,
      };
    });
  }

  const news = (): Promise<NewsItem[]> => memo('news', 30 * 60e3, async () => parseRss(await (await get(opts.newsUrl)).text()));

  return {
    async day(lat?: number, lon?: number): Promise<DayInfo> {
      const [w, n] = await Promise.allSettled([weather(lat, lon), news()]);
      return {
        weather: w.status === 'fulfilled' ? w.value : null,
        ...(w.status === 'rejected' ? { weatherError: message(w.reason) } : {}),
        news: n.status === 'fulfilled' ? n.value : [],
        ...(n.status === 'rejected' ? { newsError: message(n.reason) } : {}),
      };
    },
  };
}
```

```ts file=app/server/src/tasks.ts
import type { TaskName } from './types.ts';

/** Instrucoes das sessoes abertas pelos botoes "+". O cliente so escolhe a tarefa. */
export const TASKS: Record<TaskName, { title: string; prompt: string }> = {
  'new-skill': {
    title: 'nova skill',
    prompt:
      'Quero criar uma skill nova para o Claude Code. Use a skill skill-creator se ela estiver disponível. ' +
      'Comece me perguntando o que a skill deve fazer; depois escreva o SKILL.md em ~/.claude/skills/<nome>/ e me mostre o resultado.',
  },
  'about-me': {
    title: 'sobre mim',
    prompt:
      'Quero registrar informações sobre mim para você lembrar nas próximas conversas. ' +
      'Pergunte o que eu quero registrar e guarde como memória do tipo user. ' +
      'Preferências gerais e duradouras também podem ir para ~/.claude/CLAUDE.md, mas confirme comigo antes.',
  },
};

export const isTask = (v: unknown): v is TaskName => typeof v === 'string' && Object.hasOwn(TASKS, v);

export const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const projectPrompt = (path: string): string =>
  `Este é um projeto novo, criado agora em ${path}. Pergunte qual é o objetivo do projeto e, com as minhas respostas, ` +
  'prepare a estrutura inicial comigo (README, git e o que mais fizer sentido).';
```

```ts file=app/server/src/catalog.ts
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Agent, Conversation, Overview, Profile, ProjectDetail, ProjectSummary, Skill, TextFile } from './types.ts';
import { scanConversations } from './conversations.ts';
import { isDir, listDir, parseFrontmatter, readTextFile } from './files.ts';

const execFileAsync = promisify(execFile);

export const projectId = (path: string): string => Buffer.from(path).toString('base64url');
export const projectPathFromId = (id: string): string => Buffer.from(id, 'base64url').toString('utf8');

const present = <T>(x: T | null): x is T => x !== null;

/** Conversas por projeto, sem a home, a raiz e as pastas ocultas. */
function groupByProject(home: string, convs: Conversation[], hidden: string[]): Map<string, Conversation[]> {
  const excluded = new Set([resolve(home), '/', ...hidden.map((h) => resolve(h))]);
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

export async function listProjects(home: string, convs: Conversation[], hidden: string[] = []): Promise<ProjectSummary[]> {
  const out: ProjectSummary[] = [];
  for (const [path, list] of groupByProject(home, convs, hidden)) {
    if (await isDir(path)) out.push(summarize(path, list));
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Pasta onde "+ Novo projeto" cria pastas: a configurada ou a pasta-mae mais comum. */
export function projectsBase(home: string, projects: ProjectSummary[], configured?: string): string {
  if (configured) return resolve(configured);
  const counts = new Map<string, number>();
  for (const p of projects) counts.set(dirname(p.path), (counts.get(dirname(p.path)) ?? 0) + 1);
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
): Promise<ProjectDetail | null> {
  const list = groupByProject(home, convs, hidden).get(path);
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

export async function buildOverview(home: string, opts: { hidden?: string[]; projectsDir?: string } = {}): Promise<Overview> {
  const all = await scanConversations(home);
  const [profile, skills, projects] = await Promise.all([
    readProfile(home),
    listSkills(home),
    listProjects(home, all, opts.hidden),
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
```

```ts file=app/server/src/terminals.ts
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import nodePty from '@lydell/node-pty';
import type { IPty } from '@lydell/node-pty';
import type { SessionAgent, SessionInfo } from './types.ts';

/**
 * Argumentos do llm-agent para cada agente, no modo autonomo do menu. A
 * instrucao inicial (prompt) vai como ultimo argumento; o shell a ignora.
 */
export function agentArgs(agent: SessionAgent, resume?: string, prompt?: string): string[] {
  const tail = prompt ? [prompt] : [];
  switch (agent) {
    case 'claude':
      return ['claude', '--dangerously-skip-permissions', ...(resume ? ['--resume', resume] : []), ...tail];
    case 'codex':
      return resume
        ? ['codex', 'resume', '--dangerously-bypass-approvals-and-sandbox', resume]
        : ['codex', '--dangerously-bypass-approvals-and-sandbox', ...tail];
    case 'shell':
      return ['zsh'];
  }
}

export interface OpenRequest {
  projectPath: string;
  agent: SessionAgent;
  resume?: string;
  prompt?: string;
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
    const proc = nodePty.spawn(this.bin, agentArgs(req.agent, req.resume, req.prompt), {
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

```ts file=app/server/src/server.ts
import { createServer, type ServerResponse } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, SessionAgent } from './types.ts';
import { bearer, originAllowed, tokenMatches } from './auth.ts';
import { buildOverview, listProjects, projectDetail, projectPathFromId, projectsBase } from './catalog.ts';
import { scanConversations } from './conversations.ts';
import { NEWS_DEFAULT, createDayService } from './day.ts';
import { isFile } from './files.ts';
import { PROJECT_NAME, TASKS, isTask, projectPrompt } from './tasks.ts';
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
  /** Pasta das sessoes de tarefa ("+ Nova skill", "+ Sobre mim"); fica fora da lista de projetos. */
  workspaceDir: string;
  /** Onde "+ Novo projeto" cria pastas (padrao: a pasta-mae mais comum dos projetos). */
  projectsDir?: string;
  /** Cidade do clima quando o navegador nao manda coordenadas. */
  city?: string;
  newsUrl?: string;
  fetch?: typeof fetch;
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

const coord = (v: string | null, max: number): number | undefined => {
  if (v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : undefined;
};

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

export function createApp(opts: AppOptions): App {
  let port = opts.port;
  const webRoot = resolve(opts.webDir);
  const workspace = resolve(opts.workspaceDir);
  const hidden = [workspace];
  const terminals = new TerminalManager(opts.bin);
  const day = createDayService({ fetch: opts.fetch ?? fetch, city: opts.city, newsUrl: opts.newsUrl ?? NEWS_DEFAULT });
  const clients = new Set<WebSocket>();

  const broadcast = (msg: ServerMessage): void => {
    const data = JSON.stringify(msg);
    for (const c of clients) if (c.readyState === c.OPEN) c.send(data);
  };
  terminals.on('output', (id: string, data: string) => broadcast({ type: 'output', id, data }));
  terminals.on('exit', (id: string, code: number) => broadcast({ type: 'exit', id, code }));
  terminals.on('sessions', () => broadcast({ type: 'sessions', sessions: terminals.list() }));

  async function api(res: ServerResponse, url: URL): Promise<void> {
    if (url.pathname === '/api/overview') {
      return send(res, 200, await buildOverview(opts.home, { hidden, projectsDir: opts.projectsDir }));
    }
    if (url.pathname === '/api/day') {
      const lat = coord(url.searchParams.get('lat'), 90);
      const lon = coord(url.searchParams.get('lon'), 180);
      return send(res, 200, await day.day(lat !== undefined && lon !== undefined ? lat : undefined, lat !== undefined ? lon : undefined));
    }
    const m = /^\/api\/projects\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (m) {
      const detail = await projectDetail(opts.home, projectPathFromId(m[1]), await scanConversations(opts.home), hidden);
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
        return await api(res, url);
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
        const projects = await listProjects(opts.home, convs, hidden);
        const isWorkspace = msg.projectPath === workspace && msg.resume === undefined;
        if (!isWorkspace && !projects.some((p) => p.path === msg.projectPath)) {
          return reply({ type: 'error', message: `projeto desconhecido: ${msg.projectPath}` });
        }
        let title = msg.agent === 'shell' ? 'shell' : 'nova conversa';
        if (msg.resume !== undefined) {
          const conv = convs.find((c) => c.id === msg.resume && c.agent === msg.agent && c.cwd === msg.projectPath);
          if (!conv) return reply({ type: 'error', message: `conversa desconhecida: ${msg.resume}` });
          title = conv.title;
        }
        if (isWorkspace) await mkdir(workspace, { recursive: true });
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
      case 'task': {
        if (!isTask(msg.task)) return reply({ type: 'error', message: `tarefa desconhecida: ${String(msg.task)}` });
        const task = TASKS[msg.task];
        await mkdir(workspace, { recursive: true });
        const session = terminals.open({
          projectPath: workspace,
          agent: 'claude',
          prompt: task.prompt,
          title: task.title,
          cols: size(msg.cols, 80),
          rows: size(msg.rows, 24),
        });
        return reply({ type: 'opened', session });
      }
      case 'create-project': {
        if (typeof msg.name !== 'string' || !PROJECT_NAME.test(msg.name)) {
          return reply({ type: 'error', message: 'nome de projeto inválido: use letras, números, ".", "_" ou "-"' });
        }
        const projects = await listProjects(opts.home, await scanConversations(opts.home), hidden);
        const path = join(projectsBase(opts.home, projects, opts.projectsDir), msg.name);
        if (await exists(path)) return reply({ type: 'error', message: `já existe uma pasta em ${path}` });
        await mkdir(path, { recursive: true });
        const session = terminals.open({
          projectPath: path,
          agent: 'claude',
          prompt: projectPrompt(path),
          title: 'projeto novo',
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
const workspaceDir = join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'llm-agent', 'workspace');
const token = loadOrCreateToken(stateDir);

const app = createApp({
  home,
  port: Number(process.env.LLM_AGENT_UI_PORT ?? 7777),
  token,
  webDir: join(repo, 'app', 'web', 'dist'),
  bin: process.env.LLM_AGENT_BIN ?? join(repo, 'llm-agent'),
  extraOrigins: (process.env.LLM_AGENT_UI_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  workspaceDir,
  projectsDir: process.env.LLM_AGENT_PROJECTS_DIR || undefined,
  city: process.env.LLM_AGENT_UI_CITY || undefined,
  newsUrl: process.env.LLM_AGENT_UI_NEWS_RSS || undefined,
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

- [ ] **Step 5: Ver passar**

Run: `cd app/server && npm test && npm run typecheck`
Expected: todos `ok`, `fail 0`; `tsc` sem erros.

- [ ] **Step 6: Commit**

```bash
git add app/server
git commit -m "Serve day info and open agent tasks for the + actions"
```

---

### Task 2: UI: lógica (navegação, cartões, calor do núcleo, cliente)

**Files:**
- Modify (substituir inteiros): `app/web/src/nav.ts`, `app/web/src/ring.ts`, `app/web/src/scene/core.ts`, `app/web/src/scene/quality.ts`, `app/web/src/api.ts`, `app/web/test/nav.test.ts`, `app/web/test/ring.test.ts`, `app/web/test/core.test.ts`
- Modify: `app/web/test/api.test.ts` (acrescentar um teste)

**Interfaces:**
- Produces: `NavNode` ganha `{ kind: 'profile' }`; `Panel` = `skill | files | project | new-project`; `ItemAction` ganha `{ type: 'task'; task: TaskName }`; `Tone` ganha `'add'`; `memoryTitle(file)`; `CARD_SPACING`, `arcPositions(n, rx, ry, spacing?)`, `pageSizeFor(ry, spacing?)` (substituem `ringPositions`/`PAGE_SIZE`); `paginate(items, page, size)`; `core.ts`: `MODE_COLORS` (`ring`, `electron`), `PROTON_COLOR`, `NEUTRON_COLOR`, `targetHeat`, `smoothHeat`, `electronSpeed(heat)`, `jitterAmplitude(heat)`, `wobble(heat)`, `speechEnvelope`, `demoSignal`, `MODE_LABEL`; `Api.day(coords?)`.

- [ ] **Step 1: Escrever os testes**

```ts file=app/web/test/nav.test.ts
import { describe, expect, it } from 'vitest';
import { currentNode, initialNav, navReducer, pathTo, projectIdOf, type NavAction, type NavNode } from '../src/nav.ts';

const home: NavNode = { kind: 'home' };
const projects: NavNode = { kind: 'projects' };
const run = (...actions: NavAction[]) => actions.reduce(navReducer, initialNav);

describe('navegacao', () => {
  it('comeca no inicio', () => {
    expect(currentNode(initialNav)).toEqual(home);
  });

  it('push empilha e zera pagina e filtro', () => {
    const s = run({ type: 'filter', value: 'x' }, { type: 'page', delta: 1 }, { type: 'push', node: projects });
    expect(s).toEqual({ stack: [home, projects], page: 0, filter: '' });
  });

  it('back sobe um nivel e nao passa do inicio', () => {
    expect(run({ type: 'push', node: projects }, { type: 'back' }).stack).toEqual([home]);
    expect(navReducer(initialNav, { type: 'back' })).toBe(initialNav);
  });

  it('goto volta para um nivel da trilha', () => {
    const s = run(
      { type: 'push', node: projects },
      { type: 'push', node: { kind: 'project', id: 'a' } },
      { type: 'push', node: { kind: 'conversations', projectId: 'a' } },
    );
    expect(navReducer(s, { type: 'goto', depth: 1 }).stack).toEqual([home, projects]);
    expect(navReducer(s, { type: 'goto', depth: 3 })).toBe(s);
  });

  it('jump monta a trilha completa', () => {
    expect(navReducer(initialNav, { type: 'jump', node: { kind: 'conversations', projectId: 'p' } }).stack).toEqual([
      home,
      projects,
      { kind: 'project', id: 'p' },
      { kind: 'conversations', projectId: 'p' },
    ]);
    expect(pathTo({ kind: 'skills' })).toEqual([home, { kind: 'skills' }]);
    expect(pathTo({ kind: 'profile' })).toEqual([home, { kind: 'profile' }]);
    expect(pathTo(home)).toEqual([home]);
  });

  it('page nao fica negativa e filter volta para a pagina 0', () => {
    expect(run({ type: 'page', delta: -1 }).page).toBe(0);
    expect(run({ type: 'page', delta: 1 }, { type: 'page', delta: 1 }).page).toBe(2);
    expect(run({ type: 'page', delta: 1 }, { type: 'filter', value: 'a' })).toEqual({ stack: [home], page: 0, filter: 'a' });
  });

  it('projectIdOf', () => {
    expect(projectIdOf({ kind: 'project', id: 'a' })).toBe('a');
    expect(projectIdOf({ kind: 'conversations', projectId: 'b' })).toBe('b');
    expect(projectIdOf(projects)).toBeNull();
  });
});
```

```ts file=app/web/test/ring.test.ts
import { describe, expect, it } from 'vitest';
import {
  arcPositions, crumbLabel, filterItems, itemsFor, memoryTitle, pageSizeFor, paginate, type RingData, type RingItem,
} from '../src/ring.ts';
import type { Overview, ProjectDetail, SessionInfo } from '../src/types.ts';

const overview: Overview = {
  profile: {
    instructions: [{ path: '/h/.claude/CLAUDE.md', content: '# Global', truncated: false }],
    memories: [{ path: '/m/user_role.md', content: '---\nname: Papel do usuário\ntype: user\n---\nDev.', truncated: false }],
  },
  skills: [
    { name: 'alpha', description: 'd', origin: 'claude', path: '/s/alpha' },
    { name: 'beta', description: '', origin: 'plugin:x', path: '/s/beta' },
  ],
  projects: [
    { id: 'p1', name: 'meu-app', path: '/w/meu-app', updatedAt: '2026-10-02T00:00:00Z', conversations: 2, agents: ['claude', 'codex'] },
    { id: 'p2', name: 'outro', path: '/w/outro', updatedAt: '2026-09-01T00:00:00Z', conversations: 1, agents: ['codex'] },
  ],
  conversations: [],
  projectsDir: '/w',
};
const detail: ProjectDetail = {
  ...overview.projects[0],
  git: { branch: 'main', dirty: true },
  instructions: [{ path: '/w/meu-app/CLAUDE.md', content: '#', truncated: false }],
  memory: [],
  conversationList: [{ agent: 'claude', id: 'c1', cwd: '/w/meu-app', title: 'Primeira', updatedAt: '2026-10-02T00:00:00Z', prompts: 3 }],
};
const sessions: SessionInfo[] = [
  { id: 's1', projectPath: '/w/meu-app', agent: 'claude', title: 'Primeira', startedAt: '', alive: true },
  { id: 's2', projectPath: '/w/outro', agent: 'shell', title: 'shell', startedAt: '', alive: false },
];
const data: RingData = { overview, sessions, detail };
const keys = (items: RingItem[]) => items.map((i) => i.key);

describe('itemsFor', () => {
  it('inicio: Voce, Projetos, Skills e Sessoes abertas', () => {
    const items = itemsFor({ kind: 'home' }, data);
    expect(items.map((i) => [i.title, i.badge])).toEqual([
      ['Você', '2'],
      ['Projetos', '2'],
      ['Skills', '2'],
      ['Sessões abertas', '1'],
    ]);
    expect(items[0].action).toEqual({ type: 'nav', node: { kind: 'profile' } });
    expect(items[3].live).toBe(true);
  });

  it('voce: + Sobre mim, instrucoes e memorias', () => {
    const items = itemsFor({ kind: 'profile' }, data);
    expect(items.map((i) => [i.title, i.tone])).toEqual([
      ['+ Sobre mim', 'add'],
      ['CLAUDE.md', 'accent'],
      ['Papel do usuário', 'claude'],
    ]);
    expect(items[0].action).toEqual({ type: 'task', task: 'about-me' });
    expect(items[2].action).toEqual({
      type: 'panel',
      panel: { kind: 'files', title: 'Papel do usuário', files: [overview.profile.memories[0]] },
    });
  });

  it('projetos: + Novo projeto e um cartao por projeto', () => {
    const items = itemsFor({ kind: 'projects' }, data);
    expect(items.map((i) => [i.key, i.tone, i.live ?? false])).toEqual([
      ['new-project', 'add', false],
      ['p1', 'both', true],
      ['p2', 'codex', false],
    ]);
    expect(items[0].action).toEqual({ type: 'panel', panel: { kind: 'new-project' } });
    expect(items[1].action).toEqual({ type: 'nav', node: { kind: 'project', id: 'p1' } });
  });

  it('projeto: sobre, conversas, instrucoes, git e novas sessoes', () => {
    const items = itemsFor({ kind: 'project', id: 'p1' }, data);
    expect(keys(items)).toEqual(['info', 'conversations', 'instructions', 'git', 'new-claude', 'new-codex', 'new-shell']);
    expect(items[0].action).toEqual({ type: 'panel', panel: { kind: 'project', detail } });
    const git = items.find((i) => i.key === 'git')!;
    expect([git.title, git.tone, git.action]).toEqual(['git · main', 'warn', undefined]);
    expect(items.find((i) => i.key === 'new-codex')!.action).toEqual({ type: 'open', projectPath: '/w/meu-app', agent: 'codex' });
  });

  it('projeto ainda carregando: nenhum cartao', () => {
    expect(itemsFor({ kind: 'project', id: 'p2' }, data)).toEqual([]);
    expect(itemsFor({ kind: 'conversations', projectId: 'p1' }, { ...data, detail: null })).toEqual([]);
  });

  it('conversas: clicar retoma', () => {
    const items = itemsFor({ kind: 'conversations', projectId: 'p1' }, data);
    expect(items.map((i) => [i.key, i.title, i.tone])).toEqual([['claude:c1', 'Primeira', 'claude']]);
    expect(items[0].action).toEqual({ type: 'open', projectPath: '/w/meu-app', agent: 'claude', resume: 'c1' });
  });

  it('skills: + Nova skill e cor pela origem', () => {
    const items = itemsFor({ kind: 'skills' }, data);
    expect(items.map((i) => i.tone)).toEqual(['add', 'claude', 'plugin']);
    expect(items[0].action).toEqual({ type: 'task', task: 'new-skill' });
    expect(items[2].action).toEqual({ type: 'panel', panel: { kind: 'skill', skill: overview.skills[1] } });
  });

  it('sessoes: + Nova sessao leva aos projetos; as outras focam a aba', () => {
    const items = itemsFor({ kind: 'sessions' }, data);
    expect(items.map((i) => i.title)).toEqual(['+ Nova sessão', 'meu-app · Claude', 'outro · Shell (encerrada)']);
    expect(items[0].action).toEqual({ type: 'nav', node: { kind: 'projects' } });
    expect(items[2].action).toEqual({ type: 'tab', sessionId: 's2' });
  });
});

it('memoryTitle usa o name do frontmatter ou o nome do arquivo', () => {
  expect(memoryTitle(overview.profile.memories[0])).toBe('Papel do usuário');
  expect(memoryTitle({ path: '/x/notas.md', content: 'sem frontmatter', truncated: false })).toBe('notas');
});

it('crumbLabel', () => {
  expect(crumbLabel({ kind: 'home' }, overview)).toBe('Início');
  expect(crumbLabel({ kind: 'profile' }, overview)).toBe('Você');
  expect(crumbLabel({ kind: 'project', id: 'p1' }, overview)).toBe('meu-app');
  expect(crumbLabel({ kind: 'project', id: 'zz' }, overview)).toBe('Projeto');
  expect(crumbLabel({ kind: 'conversations', projectId: 'p1' }, null)).toBe('Conversas');
});

it('filterItems procura no titulo e no subtitulo, sem diferenciar maiusculas', () => {
  const items: RingItem[] = [
    { key: 'a', title: 'Meu App', tone: 'claude' },
    { key: 'b', title: 'Outro', subtitle: 'APP antigo', tone: 'codex' },
    { key: 'c', title: 'Nada', tone: 'codex' },
  ];
  expect(keys(filterItems(items, ' app '))).toEqual(['a', 'b']);
  expect(filterItems(items, '')).toBe(items);
});

it('paginate divide em paginas e limita a pagina', () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  expect(paginate(items, 0, 12)).toEqual({ items: items.slice(0, 12), page: 0, pages: 3 });
  expect(paginate(items, 5, 12)).toEqual({ items: [24], page: 2, pages: 3 });
  expect(paginate([], 3, 12)).toEqual({ items: [], page: 0, pages: 1 });
});

it('arcPositions: espacamento vertical uniforme sobre um arco a direita', () => {
  const pos = arcPositions(3, 100, 200, 40);
  expect(pos.map((p) => p.y)).toEqual([-40, 0, 40]);
  expect(pos[1].x).toBe(100);
  expect(pos[0].x).toBeCloseTo(100 * Math.sqrt(1 - 0.04));
  expect(pos[2].x).toBeCloseTo(pos[0].x);
  expect(arcPositions(1, 100, 200)).toEqual([{ x: 100, y: 0 }]);
  expect(arcPositions(0, 100, 200)).toEqual([]);
});

it('pageSizeFor cabe na altura do arco, entre 6 e 18', () => {
  expect(pageSizeFor(380)).toBe(18);
  expect(pageSizeFor(300)).toBe(15);
  expect(pageSizeFor(100)).toBe(6);
});
```

```ts file=app/web/test/core.test.ts
import { expect, it } from 'vitest';
import { demoSignal, electronSpeed, jitterAmplitude, smoothHeat, speechEnvelope, targetHeat, wobble } from '../src/scene/core.ts';

it('targetHeat: frio parado, quente falando alto', () => {
  expect(targetHeat('idle', 1)).toBe(0.05);
  expect(targetHeat('listening', 0)).toBeGreaterThan(targetHeat('idle', 0));
  expect(targetHeat('thinking', 0)).toBeGreaterThan(targetHeat('speaking', 0));
  expect(targetHeat('speaking', 1)).toBe(1);
  expect(targetHeat('speaking', 5)).toBe(1);
});

it('smoothHeat esquenta rapido, esfria devagar e fica em [0, 1]', () => {
  const up = smoothHeat(0, 1, 0.05);
  const down = 1 - smoothHeat(1, 0, 0.05);
  expect(up).toBeGreaterThan(down);
  expect(smoothHeat(0.5, 2, 10)).toBe(1);
  expect(smoothHeat(0.5, -1, 10)).toBe(0);
});

it('agitacao cresce com o calor e e quase nula no frio', () => {
  for (const f of [electronSpeed, jitterAmplitude, wobble]) expect(f(1)).toBeGreaterThan(f(0.3));
  expect(jitterAmplitude(targetHeat('idle', 0))).toBeLessThan(0.03);
  expect(wobble(targetHeat('idle', 0))).toBeLessThan(0.02);
  expect(electronSpeed(1) / electronSpeed(0.05)).toBeGreaterThan(4);
});

it('demoSignal percorre os estados a cada 16 s', () => {
  expect(demoSignal(1)).toEqual({ mode: 'idle', level: 0 });
  expect(demoSignal(5)).toEqual({ mode: 'listening', level: 0 });
  expect(demoSignal(8).mode).toBe('thinking');
  expect(demoSignal(10).mode).toBe('speaking');
  expect(demoSignal(17).mode).toBe('idle');
});

it('speechEnvelope varia entre silencio e pico, dentro de [0, 1]', () => {
  const v = Array.from({ length: 400 }, (_, i) => speechEnvelope(i * 0.02));
  expect(Math.min(...v)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...v)).toBeLessThanOrEqual(1);
  expect(Math.max(...v)).toBeGreaterThan(0.6);
  expect(Math.min(...v)).toBeLessThan(0.2);
});
```

No fim de `app/web/test/api.test.ts`, acrescentar:

```ts
it('Api.day manda as coordenadas arredondadas, quando existem', async () => {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    return new Response('{"weather":null,"news":[]}', { status: 200 });
  }) as unknown as typeof fetch;
  const api = new Api('tok', fetchImpl);
  await api.day({ lat: -23.55052, lon: -46.633308 });
  await api.day();
  expect(urls).toEqual(['/api/day?lat=-23.551&lon=-46.633', '/api/day']);
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd app/web && npm test`
Expected: falhas em `ring.test.ts` (`memoryTitle`, `arcPositions`, `pageSizeFor` inexistentes), `core.test.ts` (`targetHeat` etc.), `nav.test.ts` (nível `profile`) e `api.test.ts` (`day`).

- [ ] **Step 3: Implementar**

```ts file=app/web/src/nav.ts
// Navegacao radial: uma pilha de niveis. A etapa 3 (voz) usa as mesmas acoes.

export type NavNode =
  | { kind: 'home' }
  | { kind: 'profile' }
  | { kind: 'projects' }
  | { kind: 'project'; id: string }
  | { kind: 'conversations'; projectId: string }
  | { kind: 'skills' }
  | { kind: 'sessions' };

export interface NavState {
  stack: NavNode[];
  page: number;
  filter: string;
}

export type NavAction =
  | { type: 'push'; node: NavNode }
  | { type: 'goto'; depth: number }
  | { type: 'back' }
  | { type: 'jump'; node: NavNode }
  | { type: 'page'; delta: 1 | -1 }
  | { type: 'filter'; value: string };

export const initialNav: NavState = { stack: [{ kind: 'home' }], page: 0, filter: '' };

/** Trilha completa ate um nivel (usada por "jump", busca e voz). */
export function pathTo(node: NavNode): NavNode[] {
  const home: NavNode = { kind: 'home' };
  switch (node.kind) {
    case 'home':
      return [home];
    case 'profile':
    case 'projects':
    case 'skills':
    case 'sessions':
      return [home, node];
    case 'project':
      return [home, { kind: 'projects' }, node];
    case 'conversations':
      return [...pathTo({ kind: 'project', id: node.projectId }), node];
  }
}

const fresh = (stack: NavNode[]): NavState => ({ stack, page: 0, filter: '' });

export function navReducer(s: NavState, a: NavAction): NavState {
  switch (a.type) {
    case 'push':
      return fresh([...s.stack, a.node]);
    case 'goto':
      return a.depth >= s.stack.length - 1 ? s : fresh(s.stack.slice(0, Math.max(a.depth, 0) + 1));
    case 'back':
      return s.stack.length > 1 ? fresh(s.stack.slice(0, -1)) : s;
    case 'jump':
      return fresh(pathTo(a.node));
    case 'page':
      return { ...s, page: Math.max(0, s.page + a.delta) };
    case 'filter':
      return { ...s, filter: a.value, page: 0 };
  }
}

export const currentNode = (s: NavState): NavNode => s.stack[s.stack.length - 1];

export function projectIdOf(node: NavNode): string | null {
  if (node.kind === 'project') return node.id;
  if (node.kind === 'conversations') return node.projectId;
  return null;
}
```

```ts file=app/web/src/ring.ts
import type { NavNode } from './nav.ts';
import type { Overview, ProjectDetail, SessionAgent, SessionInfo, Skill, TaskName, TextFile } from './types.ts';
import { LABEL, formatDate } from './format.ts';

/** Conteudo do painel de leitura. */
export type Panel =
  | { kind: 'skill'; skill: Skill }
  | { kind: 'files'; title: string; files: TextFile[] }
  | { kind: 'project'; detail: ProjectDetail }
  | { kind: 'new-project' };

export type Tone = 'claude' | 'codex' | 'both' | 'shell' | 'plugin' | 'accent' | 'warn' | 'muted' | 'add';

export type ItemAction =
  | { type: 'nav'; node: NavNode }
  | { type: 'panel'; panel: Panel }
  | { type: 'open'; projectPath: string; agent: SessionAgent; resume?: string }
  | { type: 'tab'; sessionId: string }
  | { type: 'task'; task: TaskName };

export interface RingItem {
  key: string;
  title: string;
  /** Usado na busca e na dica do cartao (o cartao mostra so o titulo). */
  subtitle?: string;
  badge?: string;
  tone: Tone;
  live?: boolean;
  /** Sem acao: cartao so informativo (ex.: git). */
  action?: ItemAction;
}

export interface RingData {
  overview: Overview;
  sessions: SessionInfo[];
  /** Detalhe do projeto do nivel atual (null enquanto carrega). */
  detail: ProjectDetail | null;
}

const agentsTone = (agents: string[]): Tone => (agents.length > 1 ? 'both' : agents[0] === 'codex' ? 'codex' : 'claude');
const skillTone = (origin: string): Tone => (origin.startsWith('plugin:') ? 'plugin' : origin === 'codex' ? 'codex' : 'claude');
const fileName = (f: TextFile): string => f.path.split('/').pop() ?? f.path;

/** Nome de uma memoria: o "name" do frontmatter ou o nome do arquivo sem .md. */
export function memoryTitle(f: TextFile): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(f.content)?.[1] ?? '';
  const name = /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
  return name || fileName(f).replace(/\.md$/, '');
}

const fileItem = (f: TextFile, title: string, tone: Tone): RingItem => ({
  key: f.path, title, subtitle: f.path, tone, action: { type: 'panel', panel: { kind: 'files', title, files: [f] } },
});

export function itemsFor(node: NavNode, { overview, sessions, detail }: RingData): RingItem[] {
  const alive = sessions.filter((s) => s.alive);
  const { profile } = overview;
  switch (node.kind) {
    case 'home':
      return [
        {
          key: 'profile', title: 'Você', subtitle: 'instruções e memórias',
          badge: String(profile.instructions.length + profile.memories.length), tone: 'accent',
          action: { type: 'nav', node: { kind: 'profile' } },
        },
        {
          key: 'projects', title: 'Projetos', subtitle: 'conversas, memória e git', badge: String(overview.projects.length),
          tone: 'both', action: { type: 'nav', node: { kind: 'projects' } },
        },
        {
          key: 'skills', title: 'Skills', subtitle: 'Claude, Codex e plugins', badge: String(overview.skills.length),
          tone: 'plugin', action: { type: 'nav', node: { kind: 'skills' } },
        },
        {
          key: 'sessions', title: 'Sessões abertas', subtitle: alive.length ? 'em execução agora' : 'nenhuma em execução',
          badge: String(alive.length), tone: 'shell', live: alive.length > 0, action: { type: 'nav', node: { kind: 'sessions' } },
        },
      ];
    case 'profile':
      return [
        { key: 'about-me', title: '+ Sobre mim', subtitle: 'contar algo novo ao Claude', tone: 'add', action: { type: 'task', task: 'about-me' } },
        ...profile.instructions.map((f) => fileItem(f, fileName(f), 'accent')),
        ...profile.memories.map((f) => fileItem(f, memoryTitle(f), 'claude')),
      ];
    case 'projects': {
      const live = new Set(alive.map((s) => s.projectPath));
      return [
        { key: 'new-project', title: '+ Novo projeto', tone: 'add', action: { type: 'panel', panel: { kind: 'new-project' } } },
        ...overview.projects.map(
          (p): RingItem => ({
            key: p.id, title: p.name, subtitle: `${p.path} · ${formatDate(p.updatedAt)}`, tone: agentsTone(p.agents),
            live: live.has(p.path), action: { type: 'nav', node: { kind: 'project', id: p.id } },
          }),
        ),
      ];
    }
    case 'project': {
      if (!detail || detail.id !== node.id) return [];
      const items: RingItem[] = [
        { key: 'info', title: 'Sobre o projeto', tone: 'accent', action: { type: 'panel', panel: { kind: 'project', detail } } },
        {
          key: 'conversations', title: 'Conversas', badge: String(detail.conversationList.length), tone: agentsTone(detail.agents),
          action: { type: 'nav', node: { kind: 'conversations', projectId: node.id } },
        },
      ];
      if (detail.memory.length) {
        items.push({
          key: 'memory', title: 'Memória', badge: String(detail.memory.length), tone: 'accent',
          action: { type: 'panel', panel: { kind: 'files', title: `Memória · ${detail.name}`, files: detail.memory } },
        });
      }
      if (detail.instructions.length) {
        items.push({
          key: 'instructions', title: 'Instruções', subtitle: detail.instructions.map(fileName).join(' · '), tone: 'accent',
          action: { type: 'panel', panel: { kind: 'files', title: `Instruções · ${detail.name}`, files: detail.instructions } },
        });
      }
      if (detail.git) {
        items.push({
          key: 'git', title: `git · ${detail.git.branch}`, subtitle: detail.git.dirty ? 'mudanças pendentes' : 'sem mudanças',
          tone: detail.git.dirty ? 'warn' : 'muted',
        });
      }
      for (const agent of ['claude', 'codex', 'shell'] as const) {
        items.push({
          key: `new-${agent}`, title: `+ ${LABEL[agent]}`, subtitle: 'nova sessão', tone: agent,
          action: { type: 'open', projectPath: detail.path, agent },
        });
      }
      return items;
    }
    case 'conversations':
      if (!detail || detail.id !== node.projectId) return [];
      return detail.conversationList.map((c) => ({
        key: `${c.agent}:${c.id}`, title: c.title, subtitle: `${LABEL[c.agent]} · ${formatDate(c.updatedAt)} · ${c.prompts} msg`,
        tone: c.agent, action: { type: 'open', projectPath: detail.path, agent: c.agent, resume: c.id },
      }));
    case 'skills':
      return [
        { key: 'new-skill', title: '+ Nova skill', subtitle: 'criar com o Claude', tone: 'add', action: { type: 'task', task: 'new-skill' } },
        ...overview.skills.map(
          (s): RingItem => ({
            key: s.path, title: s.name, subtitle: `${s.origin} · ${s.description}`, tone: skillTone(s.origin),
            action: { type: 'panel', panel: { kind: 'skill', skill: s } },
          }),
        ),
      ];
    case 'sessions': {
      const names = new Map(overview.projects.map((p) => [p.path, p.name]));
      return [
        { key: 'new-session', title: '+ Nova sessão', subtitle: 'escolher o projeto', tone: 'add', action: { type: 'nav', node: { kind: 'projects' } } },
        ...sessions.map(
          (s): RingItem => ({
            key: s.id,
            title: `${names.get(s.projectPath) ?? s.projectPath.split('/').pop()} · ${LABEL[s.agent]}${s.alive ? '' : ' (encerrada)'}`,
            subtitle: s.title, tone: s.agent, live: s.alive, action: { type: 'tab', sessionId: s.id },
          }),
        ),
      ];
    }
  }
}

export function crumbLabel(node: NavNode, overview: Overview | null): string {
  switch (node.kind) {
    case 'home':
      return 'Início';
    case 'profile':
      return 'Você';
    case 'projects':
      return 'Projetos';
    case 'project':
      return overview?.projects.find((p) => p.id === node.id)?.name ?? 'Projeto';
    case 'conversations':
      return 'Conversas';
    case 'skills':
      return 'Skills';
    case 'sessions':
      return 'Sessões';
  }
}

export function filterItems(items: RingItem[], filter: string): RingItem[] {
  const q = filter.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.title.toLowerCase().includes(q) || (i.subtitle ?? '').toLowerCase().includes(q));
}

export function paginate<T>(items: T[], page: number, size: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(page, 0), pages - 1);
  return { items: items.slice(p * size, p * size + size), page: p, pages };
}

/** Distancia vertical entre cartoes (px). */
export const CARD_SPACING = 40;

/**
 * Cartoes numa coluna em arco a direita do nucleo: espacamento vertical
 * uniforme, centrado na altura do nucleo; x segue a elipse (rx, ry).
 */
export function arcPositions(n: number, rx: number, ry: number, spacing = CARD_SPACING): { x: number; y: number }[] {
  const total = (n - 1) * spacing;
  return Array.from({ length: n }, (_, i) => {
    const y = n === 1 ? 0 : -total / 2 + i * spacing;
    const t = Math.min(1, Math.abs(y) / ry);
    return { x: rx * Math.sqrt(1 - t * t), y };
  });
}

/** Quantos cartoes cabem no arco (entre 6 e 18). */
export function pageSizeFor(ry: number, spacing = CARD_SPACING): number {
  return Math.max(6, Math.min(18, Math.floor((2 * ry * 0.94) / spacing) + 1));
}
```

```ts file=app/web/src/scene/core.ts
// Dinamica do nucleo (atomo). A etapa 3 alimenta CoreSignal com a voz real.
// A voz vira "calor": frio = parado; quente = particulas e orbitas agitadas.

export type CoreMode = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface CoreSignal {
  mode: CoreMode;
  /** Volume da voz do agente, de 0 a 1 (so conta em "speaking"). */
  level: number;
}

export const MODE_LABEL: Record<CoreMode, string> = {
  idle: 'aguardando',
  listening: 'ouvindo',
  thinking: 'pensando',
  speaking: 'falando',
};

export const PROTON_COLOR = '#ffbf3c';
export const NEUTRON_COLOR = '#f3e2b0';

export const MODE_COLORS: Record<CoreMode, { ring: string; electron: string }> = {
  idle: { ring: '#b8913a', electron: '#ffe7a3' },
  listening: { ring: '#ffd36b', electron: '#fff3c4' },
  thinking: { ring: '#ffb347', electron: '#ffe0a8' },
  speaking: { ring: '#ffc94a', electron: '#fff6d6' },
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Calor alvo de cada estado (0 = frio, 1 = muito quente). */
export function targetHeat(mode: CoreMode, level: number): number {
  switch (mode) {
    case 'idle':
      return 0.05;
    case 'listening':
      return 0.2;
    case 'thinking':
      return 0.5;
    case 'speaking':
      return 0.3 + 0.7 * clamp01(level);
  }
}

/** Esquenta rapido e esfria devagar. */
export function smoothHeat(prev: number, target: number, dt: number): number {
  const rate = target > prev ? 14 : 2.5;
  const k = 1 - Math.exp(-rate * dt);
  return clamp01(prev + (target - prev) * k);
}

/** Velocidade angular dos eletrons (rad/s). */
export const electronSpeed = (heat: number): number => 0.35 + 4.2 * heat;

/** Amplitude da vibracao de protons e neutrons (unidades da cena). */
export const jitterAmplitude = (heat: number): number => 0.006 + 0.2 * heat * heat + 0.04 * heat;

/** Deformacao relativa das orbitas. */
export const wobble = (heat: number): number => 0.004 + 0.16 * heat;

/** Envelope sintetico parecido com fala: silabas dentro de palavras, com pausas. */
export function speechEnvelope(t: number): number {
  const syllables = Math.abs(Math.sin(t * 7.3)) * 0.65 + Math.abs(Math.sin(t * 2.1 + 1)) * 0.35;
  const words = Math.sin(t * 1.7) > -0.35 ? 1 : 0.1;
  return clamp01(syllables * words);
}

const DEMO: [CoreMode, number][] = [
  ['idle', 4],
  ['listening', 3],
  ['thinking', 2],
  ['speaking', 7],
];

/** Ciclo de 16 s pelos estados, para avaliar o nucleo antes da voz real. */
export function demoSignal(t: number): CoreSignal {
  let x = ((t % 16) + 16) % 16;
  for (const [mode, duration] of DEMO) {
    if (x < duration) return { mode, level: mode === 'speaking' ? speechEnvelope(t) : 0 };
    x -= duration;
  }
  return { mode: 'idle', level: 0 };
}
```

```ts file=app/web/src/scene/quality.ts
export interface Quality {
  bloom: boolean;
  /** Segmentos das esferas de protons e neutrons. */
  detail: number;
  lowStreak: number;
}

export const HIGH_QUALITY: Quality = { bloom: true, detail: 32, lowStreak: 0 };
export const LOW_DETAIL = 14;

/**
 * Recebe uma amostra de FPS por segundo. Tres amostras seguidas abaixo de 30
 * desligam o bloom; mais tres reduzem a malha. Nunca volta a subir.
 * Devolve o mesmo objeto quando nada muda (evita re-render).
 */
export function nextQuality(q: Quality, fps: number): Quality {
  const lowStreak = fps < 30 ? q.lowStreak + 1 : 0;
  if (lowStreak < 3) return lowStreak === q.lowStreak ? q : { ...q, lowStreak };
  if (q.bloom) return { ...q, bloom: false, lowStreak: 0 };
  if (q.detail > LOW_DETAIL) return { ...q, detail: LOW_DETAIL, lowStreak: 0 };
  return q.lowStreak === 0 ? q : { ...q, lowStreak: 0 };
}
```

```ts file=app/web/src/api.ts
import type { ClientMessage, DayInfo, Overview, ProjectDetail, ServerMessage } from './types.ts';

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

  /** Clima e notícias; as coordenadas vao arredondadas (~100 m). */
  day(coords?: { lat: number; lon: number }): Promise<DayInfo> {
    const q = coords ? `?lat=${coords.lat.toFixed(3)}&lon=${coords.lon.toFixed(3)}` : '';
    return this.get(`/api/day${q}`);
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

- [ ] **Step 4: Ver passar**

Run: `cd app/web && npm test`
Expected: todos `passed`.

- [ ] **Step 5: Commit**

```bash
git add app/web/src/nav.ts app/web/src/ring.ts app/web/src/scene/core.ts app/web/src/scene/quality.ts app/web/src/api.ts app/web/test
git commit -m "Model core heat, right-side card column, profile level and + actions"
```

---

### Task 3: UI: átomo dourado, cartões à direita, painel do dia e painéis

**Files:**
- Delete: `app/web/src/scene/atomShader.ts`
- Create: `app/web/src/components/DayPanel.tsx`, `app/web/src/components/Settings.tsx`, `app/web/src/components/NewProjectPanel.tsx`, `app/web/src/components/ProjectInfo.tsx`
- Modify (substituir inteiros): `app/web/src/scene/Atom.tsx`, `app/web/src/scene/CoreScene.tsx`, `app/web/src/components/Ring.tsx`, `app/web/src/components/Sidebar.tsx`, `app/web/src/App.tsx`, `app/web/src/three.css`
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1 e 2.
- Produces: `DayPanel({ api, settings, toggles })`; `Settings({ settings, toggles })` com `SettingsState = { webgl, mode3d, reduceMotion, voiceDemo }` e `SettingsToggles = { on3d, onReduceMotion, onVoiceDemo }`; `NewProjectPanel({ base, onCreate })`; `ProjectInfo({ detail })`; `Ring({ items, page, animationKey, loading, onPage, onActivate })` (pagina internamente).

- [ ] **Step 1: Átomo e cena**

Run: `git rm -q app/web/src/scene/atomShader.ts`

```tsx file=app/web/src/scene/Atom.tsx
import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line, Trail } from '@react-three/drei';
import { Color, type Group, type Mesh } from 'three';
import type { Line2 } from 'three-stdlib';
import {
  MODE_COLORS, NEUTRON_COLOR, PROTON_COLOR, electronSpeed, jitterAmplitude, smoothHeat, targetHeat, wobble, type CoreSignal,
} from './core.ts';

interface Orbit {
  a: number;
  b: number;
  rotation: [number, number, number];
  phase: number;
  /** Numero de ondas da deformacao. */
  waves: number;
}

const ORBITS: Orbit[] = [
  { a: 2.8, b: 1.4, rotation: [1.2, 0, 0.25], phase: 0, waves: 3 },
  { a: 3.0, b: 1.3, rotation: [-0.55, 1.05, 0.4], phase: 2.1, waves: 5 },
  { a: 2.6, b: 1.6, rotation: [0.35, -0.95, -0.9], phase: 4.2, waves: 4 },
];
const SEGMENTS = 180;

/** Protons e neutrons numa esfera de Fibonacci, mais um no centro. */
const NUCLEONS = [[0, 0, 0], ...Array.from({ length: 13 }, (_, i) => {
  const y = 1 - (i / 12) * 2;
  const r = Math.sqrt(1 - y * y);
  const theta = i * 2.39996;
  return [Math.cos(theta) * r * 0.52, y * 0.52, Math.sin(theta) * r * 0.52];
})].map((p, i) => ({ base: p as [number, number, number], proton: i % 2 === 0, seed: i * 1.618 }));

/** Ponto da orbita deformada (calor = tremor e ondulacao). */
function orbitPoint(o: Orbit, theta: number, t: number, w: number, out: number[], k: number): void {
  const r = 1 + w * Math.sin(o.waves * theta + t * 3.1 + o.phase) + w * 0.5 * Math.sin((o.waves + 2) * theta - t * 4.7);
  out[k] = Math.cos(theta) * o.a * r;
  out[k + 1] = Math.sin(theta) * o.b * r;
  out[k + 2] = w * 1.4 * Math.sin(o.waves * 0.5 * theta + t * 2.3);
}

interface Props {
  signal: MutableRefObject<CoreSignal>;
  reducedMotion: boolean;
  /** Segmentos das esferas. */
  detail: number;
}

export function Atom({ signal, reducedMotion, detail }: Props) {
  const nucleus = useRef<Group>(null);
  const nucleons = useRef<(Mesh | null)[]>([]);
  const orbitGroups = useRef<(Group | null)[]>([]);
  const lines = useRef<(Line2 | null)[]>([]);
  const electrons = useRef<(Mesh | null)[]>([]);
  const angles = useRef(ORBITS.map((o) => o.phase));
  const heat = useRef(0.05);
  const time = useRef(0);
  const ringColor = useMemo(() => new Color(MODE_COLORS.idle.ring), []);
  const target = useMemo(() => new Color(), []);
  const buffers = useMemo(() => ORBITS.map(() => new Array<number>((SEGMENTS + 1) * 3).fill(0)), []);
  const point = useMemo(() => [0, 0, 0], []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const s = signal.current;
    heat.current = smoothHeat(heat.current, targetHeat(s.mode, s.level), dt);
    // "Reduzir movimento": quase sem agitacao e nada girando.
    const h = reducedMotion ? heat.current * 0.25 : heat.current;
    const motion = reducedMotion ? 0 : 1;
    time.current += dt * (0.6 + 2.4 * h) * motion;
    const t = time.current;

    // Protons e neutrons vibram em torno da posicao de repouso.
    const amp = jitterAmplitude(h);
    NUCLEONS.forEach((n, i) => {
      const m = nucleons.current[i];
      if (!m) return;
      m.position.set(
        n.base[0] + Math.sin(t * 9.1 + n.seed * 12.9) * amp,
        n.base[1] + Math.sin(t * 11.3 + n.seed * 7.1) * amp,
        n.base[2] + Math.sin(t * 8.7 + n.seed * 3.3) * amp,
      );
    });
    if (nucleus.current && motion) {
      nucleus.current.rotation.y += dt * (0.15 + 1.8 * h);
      nucleus.current.rotation.x += dt * 0.6 * h;
    }

    target.set(MODE_COLORS[s.mode].ring);
    ringColor.lerp(target, 1 - Math.exp(-dt * 4));
    const w = wobble(h);
    const speed = electronSpeed(h) * motion;
    ORBITS.forEach((o, i) => {
      const buf = buffers[i];
      for (let j = 0; j <= SEGMENTS; j++) orbitPoint(o, (j / SEGMENTS) * Math.PI * 2, t, w, buf, j * 3);
      const line = lines.current[i];
      if (line) {
        line.geometry.setPositions(buf);
        line.material.color.copy(ringColor);
      }
      angles.current[i] += dt * speed * (1 + i * 0.15);
      orbitPoint(o, angles.current[i], t, w, point, 0);
      electrons.current[i]?.position.set(point[0], point[1], point[2]);
      // Com calor, os planos das orbitas precessionam.
      const g = orbitGroups.current[i];
      if (g && motion) g.rotation.z += dt * (0.03 + 0.7 * h) * (i % 2 ? 1 : -1);
    });
  });

  return (
    <group>
      <group ref={nucleus}>
        {NUCLEONS.map((n, i) => (
          <mesh
            key={i}
            ref={(m) => {
              nucleons.current[i] = m;
            }}
            position={n.base}
          >
            <sphereGeometry args={[0.3, detail, detail]} />
            <meshStandardMaterial
              color={n.proton ? PROTON_COLOR : NEUTRON_COLOR}
              emissive={n.proton ? PROTON_COLOR : NEUTRON_COLOR}
              emissiveIntensity={n.proton ? 0.35 : 0.12}
              roughness={0.35}
              metalness={0.3}
            />
          </mesh>
        ))}
      </group>
      {ORBITS.map((o, i) => (
        <group key={i} rotation={o.rotation}>
          <group
            ref={(g) => {
              orbitGroups.current[i] = g;
            }}
          >
            <Line
              ref={(l) => {
                lines.current[i] = l as unknown as Line2 | null;
              }}
              points={Array.from({ length: SEGMENTS + 1 }, (_, j) => {
                const th = (j / SEGMENTS) * Math.PI * 2;
                return [Math.cos(th) * o.a, Math.sin(th) * o.b, 0] as [number, number, number];
              })}
              color={MODE_COLORS.idle.ring}
              lineWidth={1.2}
              transparent
              opacity={0.75}
            />
            <Trail width={0.7} length={4} color={MODE_COLORS.idle.electron} attenuation={(x) => x * x}>
              <mesh
                ref={(m) => {
                  electrons.current[i] = m;
                }}
              >
                <sphereGeometry args={[0.085, 16, 16]} />
                <meshBasicMaterial color={MODE_COLORS.speaking.electron} toneMapped={false} />
              </mesh>
            </Trail>
          </group>
        </group>
      ))}
    </group>
  );
}
```

```tsx file=app/web/src/scene/CoreScene.tsx
import { useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { Atom } from './Atom.tsx';
import type { CoreSignal } from './core.ts';
import { HIGH_QUALITY, nextQuality, type Quality } from './quality.ts';

export interface CoreSceneProps {
  signal: MutableRefObject<CoreSignal>;
  reducedMotion: boolean;
  /** Escurece a cena (gaveta de terminais aberta). */
  dimmed: boolean;
}

/** O atomo, sobre um ceu estrelado. A camera nunca sai dele. */
export function CoreScene({ signal, reducedMotion, dimmed }: CoreSceneProps) {
  const [quality, setQuality] = useState<Quality>(HIGH_QUALITY);
  return (
    <div className={dimmed ? 'galaxy dimmed' : 'galaxy'}>
      <Canvas camera={{ position: [0, 0, 15], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <ambientLight intensity={0.55} color="#fff1cf" />
        <pointLight position={[5, 6, 8]} intensity={140} decay={2} color="#ffe2a0" />
        <pointLight position={[-6, -4, 6]} intensity={50} decay={2} color="#ffb15c" />
        <Stars radius={90} depth={40} count={2200} factor={3} fade speed={reducedMotion ? 0 : 0.3} />
        <Atom signal={signal} reducedMotion={reducedMotion} detail={quality.detail} />
        <OrbitControls enablePan={false} enableZoom={false} rotateSpeed={0.4} />
        <FpsMonitor onSample={(fps) => setQuality((q) => nextQuality(q, fps))} />
        {quality.bloom && (
          <EffectComposer>
            <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.65} luminanceSmoothing={0.2} />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}

/** Uma amostra de FPS por segundo. */
function FpsMonitor({ onSample }: { onSample: (fps: number) => void }) {
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, delta) => {
    const a = acc.current;
    a.frames++;
    a.time += delta;
    if (a.time >= 1) {
      onSample(a.frames / a.time);
      a.frames = 0;
      a.time = 0;
    }
  });
  return null;
}
```

- [ ] **Step 2: Componentes**

```tsx file=app/web/src/components/Ring.tsx
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { arcPositions, pageSizeFor, paginate, CARD_SPACING, type RingItem } from '../ring.ts';

interface Props {
  /** Todos os itens do nivel (ja filtrados); a paginacao e feita aqui. */
  items: RingItem[];
  page: number;
  /** Muda a cada nivel/pagina para refazer a animacao de entrada. */
  animationKey: string;
  loading: boolean;
  onPage: (delta: 1 | -1) => void;
  onActivate: (item: RingItem) => void;
}

/** Centro do atomo: 38% da largura da area central (ver .galaxy no CSS). */
const CENTER_X = 0.38;

/** Coluna de cartoes em arco a direita do nucleo, de cima para baixo. */
export function Ring({ items, page, animationKey, loading, onPage, onActivate }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const ry = Math.min(size.h * 0.42, 380);
  const rx = Math.min(size.w * 0.2, 300);
  const shown = paginate(items, page, pageSizeFor(ry));
  const positions = arcPositions(shown.items.length, rx, ry);
  const cx = size.w * CENTER_X;
  const lastY = positions.length ? positions[positions.length - 1].y : 0;

  return (
    <div className="ring" ref={ref}>
      <div key={animationKey}>
        {shown.items.map((item, i) => (
          <button
            key={item.key}
            className={`ring-card tone-${item.tone}`}
            style={{ left: cx, '--x': `${positions[i].x}px`, '--y': `${positions[i].y}px`, animationDelay: `${i * 25}ms` } as CSSProperties}
            disabled={!item.action}
            title={item.subtitle ? `${item.title}\n${item.subtitle}` : item.title}
            onClick={() => onActivate(item)}
          >
            <span className={item.live ? 'card-dot live' : 'card-dot'} />
            <span className="card-title">{item.title}</span>
            {item.badge && <span className="card-badge">{item.badge}</span>}
          </button>
        ))}
      </div>
      {loading && <div className="ring-status">Carregando…</div>}
      {!loading && !items.length && <div className="ring-status">Nada por aqui.</div>}
      {shown.pages > 1 && (
        <div className="ring-pager" style={{ left: cx + rx * 0.6, top: `calc(50% + ${lastY + CARD_SPACING}px)` }}>
          <button onClick={() => onPage(-1)} disabled={shown.page === 0} aria-label="Página anterior">
            ‹
          </button>
          <span>
            {shown.page + 1} / {shown.pages}
          </span>
          <button onClick={() => onPage(1)} disabled={shown.page === shown.pages - 1} aria-label="Próxima página">
            ›
          </button>
        </div>
      )}
    </div>
  );
}
```

```tsx file=app/web/src/components/Settings.tsx
export interface SettingsState {
  webgl: boolean;
  mode3d: boolean;
  reduceMotion: boolean;
  voiceDemo: boolean;
}

export interface SettingsToggles {
  on3d: () => void;
  onReduceMotion: () => void;
  onVoiceDemo: () => void;
}

export function Settings({ settings, toggles }: { settings: SettingsState; toggles: SettingsToggles }) {
  const use3d = settings.webgl && settings.mode3d;
  return (
    <div className="settings">
      <label title={settings.webgl ? '' : 'Este navegador não tem WebGL 2'}>
        <input type="checkbox" checked={use3d} disabled={!settings.webgl} onChange={toggles.on3d} />
        Modo 3D
      </label>
      <label>
        <input type="checkbox" checked={settings.reduceMotion} onChange={toggles.onReduceMotion} />
        Reduzir movimento
      </label>
      <label title="Simula a voz do agente para ver o núcleo reagir">
        <input type="checkbox" checked={settings.voiceDemo} disabled={!use3d} onChange={toggles.onVoiceDemo} />
        Demonstração de voz
      </label>
    </div>
  );
}
```

```tsx file=app/web/src/components/DayPanel.tsx
import { useEffect, useState } from 'react';
import type { Api } from '../api.ts';
import type { DayInfo } from '../types.ts';
import { Settings, type SettingsState, type SettingsToggles } from './Settings.tsx';

interface Props {
  api: Api;
  settings: SettingsState;
  toggles: SettingsToggles;
}

function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Coluna esquerda no modo 3D: hora, data, clima e notícias. */
export function DayPanel({ api, settings, toggles }: Props) {
  const now = useNow(1000);
  const [day, setDay] = useState<DayInfo | null>(null);
  // undefined: ainda perguntando ao navegador; null: sem localizacao.
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null | undefined>(undefined);

  useEffect(() => {
    if (!navigator.geolocation) return setCoords(null);
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => setCoords(null),
      { timeout: 8000, maximumAge: 3600e3 },
    );
  }, []);

  useEffect(() => {
    if (coords === undefined) return;
    let current = true;
    const load = () =>
      api.day(coords ?? undefined).then(
        (d) => current && setDay(d),
        () => {},
      );
    load();
    const id = setInterval(load, 15 * 60e3);
    return () => {
      current = false;
      clearInterval(id);
    };
  }, [api, coords]);

  const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const date = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const w = day?.weather;

  return (
    <aside className="day">
      <div className="brand">llm-agent</div>
      <div className="clock">
        <div className="time">
          {time}
          <span className="seconds">{seconds}</span>
        </div>
        <div className="date">{date}</div>
      </div>
      <section className="weather">
        {w ? (
          <>
            <div className="temp">{w.temperature}°</div>
            <div>
              <div className="desc">{w.description}</div>
              <div className="muted">
                máx {w.max}° · mín {w.min}°{w.place && ` · ${w.place}`}
              </div>
            </div>
          </>
        ) : (
          <p className="muted">{day?.weatherError ?? 'Carregando o clima…'}</p>
        )}
      </section>
      <section className="news">
        <h2>Notícias do dia</h2>
        {day?.news.length ? (
          <ul>
            {day.news.map((n, i) => (
              <li key={`${i}:${n.title}`}>
                {n.link ? (
                  <a href={n.link} target="_blank" rel="noopener noreferrer">
                    {n.title}
                  </a>
                ) : (
                  <span>{n.title}</span>
                )}
                {n.source && <small>{n.source}</small>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{day?.newsError ?? 'Carregando…'}</p>
        )}
      </section>
      <Settings settings={settings} toggles={toggles} />
      <div className="hint">Ctrl+K busca · Esc volta · Ctrl+Tab alterna terminais</div>
    </aside>
  );
}
```

```tsx file=app/web/src/components/NewProjectPanel.tsx
import { useState } from 'react';

const VALID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function NewProjectPanel({ base, onCreate }: { base: string; onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  const valid = VALID.test(name);
  return (
    <section className="panel">
      <h1>Novo projeto</h1>
      <p className="muted">
        A pasta será criada em <code>{`${base}/${name || '<nome>'}`}</code>, e o Claude abre nela para preparar o projeto com você.
      </p>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onCreate(name);
        }}
      >
        <input autoFocus placeholder="nome-do-projeto" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={!valid}>
          Criar e abrir no Claude
        </button>
      </form>
      {name && !valid && <p className="warn">Use letras, números, ".", "_" ou "-", começando por letra ou número.</p>}
    </section>
  );
}
```

```tsx file=app/web/src/components/ProjectInfo.tsx
import type { ProjectDetail } from '../types.ts';
import { LABEL, formatDate } from '../format.ts';

export function ProjectInfo({ detail }: { detail: ProjectDetail }) {
  return (
    <section className="panel">
      <h1>{detail.name}</h1>
      <p>
        <code>{detail.path}</code>
      </p>
      <ul className="facts">
        <li>
          <span className="muted">Agentes</span> {detail.agents.map((a) => LABEL[a]).join(' e ')}
        </li>
        <li>
          <span className="muted">Conversas</span> {detail.conversationList.length}
        </li>
        <li>
          <span className="muted">Última atividade</span> {formatDate(detail.updatedAt)}
        </li>
        <li>
          <span className="muted">Git</span>{' '}
          {detail.git ? `${detail.git.branch}${detail.git.dirty ? ' · mudanças pendentes' : ' · sem mudanças'}` : 'não é um repositório'}
        </li>
        <li>
          <span className="muted">Memória</span> {detail.memory.length} arquivo(s)
        </li>
        <li>
          <span className="muted">Instruções</span>{' '}
          {detail.instructions.length ? detail.instructions.map((f) => f.path.split('/').pop()).join(', ') : 'nenhuma'}
        </li>
      </ul>
    </section>
  );
}
```

```tsx file=app/web/src/components/Sidebar.tsx
import { useState } from 'react';
import type { Overview, SessionInfo, View } from '../types.ts';
import { Settings, type SettingsState, type SettingsToggles } from './Settings.tsx';

interface Props {
  overview: Overview | null;
  view: View;
  sessions: SessionInfo[];
  settings: SettingsState;
  toggles: SettingsToggles;
  onSelect: (v: View) => void;
}

/** Menu do modo lista (sem 3D). */
export function Sidebar({ overview, view, sessions, settings, toggles, onSelect }: Props) {
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
      <Settings settings={settings} toggles={toggles} />
      <div className="hint">Ctrl+K busca · Ctrl+Tab alterna terminais</div>
    </nav>
  );
}
```

- [ ] **Step 3: Estilos**

```css file=app/web/src/three.css
.content.three { padding: 0; overflow: hidden; }
.content.three .banner { position: absolute; top: 64px; left: 38%; transform: translateX(-50%); z-index: 5; }
/* O atomo fica centrado em 38% da largura; os cartoes ocupam a direita. */
.galaxy { position: absolute; top: 0; bottom: 0; left: 0; width: 76%; transition: filter 0.3s; }
.galaxy.dimmed { filter: brightness(0.45) saturate(0.8); }

.navbar { position: absolute; top: 16px; left: 16px; right: 16px; z-index: 4; display: flex; align-items: center; gap: 12px; pointer-events: none; }
.navbar > * { pointer-events: auto; }
.crumbs { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.crumbs button { background: rgba(10, 14, 26, 0.7); }
.crumbs .current { border-color: #ffc94a; color: #ffc94a; }
.crumbs .sep { color: var(--muted); }
.navbar input { margin-left: auto; width: 220px; background: rgba(10, 14, 26, 0.7); }
.core-caption { position: absolute; left: 38%; bottom: 56px; transform: translateX(-50%); z-index: 2; color: #e8c877; font-size: 12px; letter-spacing: 0.25em; text-transform: uppercase; pointer-events: none; }

.ring { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
.ring-card {
  position: absolute; top: 50%; max-width: 260px; height: 32px;
  display: flex; align-items: center; gap: 9px; padding: 0 12px; text-align: left;
  background: rgba(12, 12, 18, 0.72); backdrop-filter: blur(6px);
  border: 1px solid rgba(255, 209, 102, 0.14); border-radius: 16px; pointer-events: auto;
  transform: translate(var(--x), calc(var(--y) - 50%));
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
  animation: ring-in 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
}
.ring-card:hover:not(:disabled) {
  border-color: var(--c); box-shadow: 0 0 16px -4px var(--c);
  transform: translate(calc(var(--x) + 6px), calc(var(--y) - 50%));
}
.ring-card:disabled { cursor: default; color: var(--text); opacity: 0.85; }
@keyframes ring-in {
  from { opacity: 0; transform: translate(calc(var(--x) * 0.4), calc(var(--y) * 0.4 - 50%)) scale(0.7); }
  to { opacity: 1; transform: translate(var(--x), calc(var(--y) - 50%)) scale(1); }
}
.tone-claude { --c: var(--claude); }
.tone-codex { --c: var(--codex); }
.tone-both { --c: #ffc94a; }
.tone-shell { --c: var(--shell); }
.tone-plugin { --c: #9fc2ff; }
.tone-accent { --c: #ffe08a; }
.tone-warn { --c: var(--warn); }
.tone-muted { --c: var(--muted); }
.tone-add { --c: #ffc94a; border-style: dashed; color: #ffd98a; }
.card-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--c); box-shadow: 0 0 6px var(--c); }
.tone-add .card-dot { display: none; }
.card-dot.live { animation: pulse 1.6s infinite; }
.card-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.card-badge { margin-left: 4px; font-size: 11px; color: var(--c); }
.ring-pager { position: absolute; z-index: 3; display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; pointer-events: auto; transform: translateY(-50%); }
.ring-pager button { width: 28px; height: 28px; padding: 0; border-radius: 50%; background: rgba(10, 14, 26, 0.7); }
.ring-status { position: absolute; left: 38%; bottom: 24px; transform: translateX(-50%); color: var(--muted); font-size: 12px; }

.panel-overlay {
  position: absolute; top: 64px; left: 16px; bottom: 16px; z-index: 6;
  width: min(440px, 34%); overflow: auto; padding: 20px 24px;
  background: rgba(10, 10, 16, 0.9); backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 209, 102, 0.18); border-radius: 12px;
}
.panel-close { position: sticky; top: 0; float: right; border: none; background: transparent; font-size: 18px; }
.facts { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.facts .muted { display: inline-block; width: 130px; }

.day { grid-row: 1; display: flex; flex-direction: column; gap: 18px; padding: 20px 18px; border-right: 1px solid var(--line); background: rgba(10, 10, 16, 0.85); overflow: auto; }
.day .brand { color: #ffc94a; }
.clock .time { font-size: 44px; font-weight: 300; letter-spacing: 0.02em; line-height: 1; }
.clock .seconds { font-size: 16px; color: var(--muted); margin-left: 6px; }
.clock .date { margin-top: 6px; color: var(--muted); text-transform: capitalize; }
.weather { display: flex; align-items: center; gap: 14px; }
.weather .temp { font-size: 38px; font-weight: 300; color: #ffd36b; }
.weather .desc { text-transform: capitalize; }
.news h2 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); }
.news ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.news li { display: flex; flex-direction: column; gap: 2px; font-size: 13px; line-height: 1.35; }
.news a { color: var(--text); text-decoration: none; }
.news a:hover { color: #ffd36b; }
.news small { color: var(--muted); }
.day .settings, .sidebar .settings { margin-top: auto; }
.settings { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); }
.settings label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.day .hint, .sidebar .hint { margin-top: 0; }
```

- [ ] **Step 4: App**

```tsx file=app/web/src/App.tsx
import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Api, LiveSocket, takeToken, wsUrl, type Status } from './api.ts';
import { bus } from './bus.ts';
import { currentNode, initialNav, navReducer, projectIdOf } from './nav.ts';
import { hasWebGL, systemReducedMotion, usePref } from './prefs.ts';
import { crumbLabel, filterItems, itemsFor, type Panel, type RingItem } from './ring.ts';
import { demoSignal, MODE_LABEL, type CoreSignal } from './scene/core.ts';
import { addTab, applyAction, closeTab, emptyTabs, shortcut, syncTabs, type TabsState } from './tabs.ts';
import type { Conversation, Overview, ProjectDetail, ServerMessage, SessionAgent, SessionInfo, TaskName, View } from './types.ts';
import { DayPanel } from './components/DayPanel.tsx';
import { FileCard } from './components/FileCard.tsx';
import { NewProjectPanel } from './components/NewProjectPanel.tsx';
import { ProfilePanel } from './components/ProfilePanel.tsx';
import { ProjectInfo } from './components/ProjectInfo.tsx';
import { ProjectPanel } from './components/ProjectPanel.tsx';
import { Ring } from './components/Ring.tsx';
import { SearchDialog } from './components/SearchDialog.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { SkillDetail } from './components/SkillDetail.tsx';
import { SkillsPanel } from './components/SkillsPanel.tsx';
import { TerminalDrawer } from './components/TerminalDrawer.tsx';

// A cena 3D (three.js) so e baixada quando o modo 3D esta ligado.
const CoreScene = lazy(() => import('./scene/CoreScene.tsx').then((m) => ({ default: m.CoreScene })));

const TERM = { cols: 120, rows: 30 };

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
  const webgl = useMemo(hasWebGL, []);
  const [mode3d, setMode3d] = usePref('llm-agent-3d', true);
  const [reduceMotion, setReduceMotion] = usePref('llm-agent-reduce-motion', systemReducedMotion());
  const [voiceDemo, setVoiceDemo] = usePref('llm-agent-voice-demo', false);
  const use3d = webgl && mode3d;
  const settings = { webgl, mode3d, reduceMotion, voiceDemo };
  const toggles = {
    on3d: () => setMode3d(!mode3d),
    onReduceMotion: () => setReduceMotion(!reduceMotion),
    onVoiceDemo: () => setVoiceDemo(!voiceDemo),
  };

  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tabs, setTabs] = useState<TabsState>(emptyTabs);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [socket, setSocket] = useState<LiveSocket | null>(null);

  // Modo 3D: navegacao radial + painel de leitura. Modo lista: "view" do marco 1.
  const [nav, dispatch] = useReducer(navReducer, initialNav);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [view, setView] = useState<View>({ kind: 'profile' });
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const node = currentNode(nav);
  const projectId = projectIdOf(node);

  // Sinal do nucleo, lido a cada quadro pela cena (sem re-render).
  const signal = useRef<CoreSignal>({ mode: 'idle', level: 0 });
  const [coreMode, setCoreMode] = useState<CoreSignal['mode']>('idle');

  const refs = useRef({ tabs, panel, searchOpen, use3d });
  refs.current = { tabs, panel, searchOpen, use3d };

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
    if (!projectId) return;
    let current = true;
    api.project(projectId).then(
      (d) => current && setDetail(d),
      (e: Error) => current && setError(e.message),
    );
    return () => {
      current = false;
    };
  }, [api, projectId, revision]);

  useEffect(() => {
    if (!voiceDemo || !use3d) {
      signal.current = { mode: 'idle', level: 0 };
      setCoreMode('idle');
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const s = demoSignal((now - start) / 1000);
      signal.current = s;
      setCoreMode((m) => (m === s.mode ? m : s.mode));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [voiceDemo, use3d]);

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
            setDrawerCollapsed(false);
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

  const sendOrFail = useCallback(
    (ok: boolean | undefined) => {
      if (!ok) setError('Sem conexão com o servidor.');
    },
    [],
  );

  const openSession = useCallback(
    (projectPath: string, agent: SessionAgent, resume?: string) =>
      sendOrFail(socket?.send({ type: 'open', projectPath, agent, resume, ...TERM })),
    [socket, sendOrFail],
  );

  const runTask = useCallback(
    (task: TaskName) => sendOrFail(socket?.send({ type: 'task', task, ...TERM })),
    [socket, sendOrFail],
  );

  const createProject = useCallback(
    (name: string) => {
      sendOrFail(socket?.send({ type: 'create-project', name, ...TERM }));
      setPanel(null);
    },
    [socket, sendOrFail],
  );

  const closeSession = useCallback(
    (id: string) => {
      socket?.send({ type: 'close', id });
      setTabs((t) => closeTab(t, id));
    },
    [socket],
  );

  const focusTab = useCallback((id: string) => {
    setTabs((t) => ({ ...t, active: id }));
    setDrawerCollapsed(false);
  }, []);

  const showProject = useCallback((id: string) => {
    if (refs.current.use3d) dispatch({ type: 'jump', node: { kind: 'project', id } });
    else setView({ kind: 'project', id });
  }, []);

  const resumeConversation = useCallback(
    (c: Conversation) => {
      const project = overview?.projects.find((p) => p.path === c.cwd);
      if (project) {
        if (refs.current.use3d) dispatch({ type: 'jump', node: { kind: 'conversations', projectId: project.id } });
        else setView({ kind: 'project', id: project.id });
      }
      openSession(c.cwd, c.agent, c.id);
    },
    [overview, openSession],
  );

  const showSkill = useCallback(
    (path: string) => {
      if (!refs.current.use3d) return setView({ kind: 'skills', focus: path });
      dispatch({ type: 'jump', node: { kind: 'skills' } });
      const skill = overview?.skills.find((s) => s.path === path);
      if (skill) setPanel({ kind: 'skill', skill });
    },
    [overview],
  );

  const activate = useCallback(
    (item: RingItem) => {
      const a = item.action;
      if (!a) return;
      if (a.type === 'nav') dispatch({ type: 'push', node: a.node });
      else if (a.type === 'panel') setPanel(a.panel);
      else if (a.type === 'open') openSession(a.projectPath, a.agent, a.resume);
      else if (a.type === 'task') runTask(a.task);
      else focusTab(a.sessionId);
    },
    [openSession, runTask, focusTab],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inTerminal = target?.closest?.('.terminal') != null;
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && !inTerminal) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === 'Escape' && !inTerminal && !refs.current.searchOpen && refs.current.use3d) {
        if (refs.current.panel) setPanel(null);
        else if (target?.tagName !== 'INPUT') dispatch({ type: 'back' });
        return;
      }
      const action = shortcut(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      const { state, closed } = applyAction(refs.current.tabs, action);
      if (closed) socket?.send({ type: 'close', id: closed });
      setTabs(state);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [socket]);

  const items = useMemo(
    () => (overview ? filterItems(itemsFor(node, { overview, sessions, detail }), nav.filter) : []),
    [overview, sessions, detail, node, nav.filter],
  );
  const ringLoading = !overview || (projectId !== null && detail?.id !== projectId);
  const showFilter = node.kind !== 'home' && node.kind !== 'project';

  const listPanel =
    view.kind === 'skills' ? (
      <SkillsPanel skills={overview?.skills ?? []} focus={view.focus} />
    ) : view.kind === 'project' ? (
      <ProjectPanel api={api} id={view.id} revision={revision} onOpen={openSession} />
    ) : (
      <ProfilePanel profile={overview?.profile} />
    );

  const readingPanel =
    panel?.kind === 'skill' ? (
      <SkillDetail skill={panel.skill} />
    ) : panel?.kind === 'project' ? (
      <ProjectInfo detail={panel.detail} />
    ) : panel?.kind === 'new-project' ? (
      <NewProjectPanel base={overview?.projectsDir ?? ''} onCreate={createProject} />
    ) : panel?.kind === 'files' ? (
      <section className="panel">
        <h1>{panel.title}</h1>
        {panel.files.map((f, i) => (
          <FileCard key={f.path} file={f} open={i === 0} />
        ))}
      </section>
    ) : null;

  return (
    <div className="app">
      {use3d ? (
        <DayPanel api={api} settings={settings} toggles={toggles} />
      ) : (
        <Sidebar overview={overview} view={view} sessions={sessions} settings={settings} toggles={toggles} onSelect={setView} />
      )}
      <main className={use3d ? 'content three' : 'content'}>
        {status !== 'open' && <div className="banner">Reconectando ao servidor…</div>}
        {error && (
          <div className="banner error" onClick={() => setError(null)} title="Clique para fechar">
            {error}
          </div>
        )}
        {use3d ? (
          <>
            <Suspense fallback={null}>
              <CoreScene signal={signal} reducedMotion={reduceMotion} dimmed={tabs.order.length > 0 && !drawerCollapsed} />
            </Suspense>
            <div className="navbar">
              <div className="crumbs">
                {nav.stack.map((n, depth) => (
                  <Fragment key={depth}>
                    {depth > 0 && <span className="sep">›</span>}
                    <button
                      className={depth === nav.stack.length - 1 ? 'current' : ''}
                      onClick={() => dispatch({ type: 'goto', depth })}
                    >
                      {crumbLabel(n, overview)}
                    </button>
                  </Fragment>
                ))}
              </div>
              {showFilter && (
                <input
                  placeholder="Filtrar"
                  value={nav.filter}
                  onChange={(e) => dispatch({ type: 'filter', value: e.target.value })}
                />
              )}
            </div>
            <Ring
              items={items}
              page={nav.page}
              animationKey={`${nav.stack.length}:${JSON.stringify(node)}:${nav.page}`}
              loading={ringLoading}
              onPage={(delta) => dispatch({ type: 'page', delta })}
              onActivate={activate}
            />
            {coreMode !== 'idle' && <div className="core-caption">{MODE_LABEL[coreMode]}</div>}
            {readingPanel && (
              <aside className="panel-overlay">
                <button className="panel-close" onClick={() => setPanel(null)} aria-label="Fechar painel">
                  ×
                </button>
                {readingPanel}
              </aside>
            )}
          </>
        ) : (
          listPanel
        )}
      </main>
      <TerminalDrawer
        tabs={tabs}
        sessions={sessions}
        projects={overview?.projects ?? []}
        socket={socket}
        collapsed={drawerCollapsed}
        onCollapsedChange={setDrawerCollapsed}
        onActivate={focusTab}
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
          onProject={showProject}
          onSkill={showSkill}
          onConversation={resumeConversation}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: README**

Na seção `## Interface` do `README.md`, substituir o parágrafo que começa com "No centro fica o núcleo do agente" por:

```markdown
No modo 3D, o centro é o núcleo do agente: um átomo dourado, com prótons, nêutrons e elétrons. Parado, ele está "frio"; quando o agente fala (etapa de voz), ele "esquenta": as partículas vibram, as órbitas tremem e os elétrons aceleram. Ligue **Demonstração de voz** para ver. À direita, de cima para baixo, ficam os cartões da área em que você está: Você, Projetos, Skills e Sessões abertas no início; dentro de um projeto, Sobre o projeto, Conversas, Memória, Instruções, git e os botões de nova sessão. Clicar num cartão abre os detalhes ou entra no nível seguinte; a trilha no topo mostra onde você está, e `Esc` volta.

Os botões **+ Sobre mim**, **+ Nova skill** e **+ Novo projeto** abrem uma sessão do Claude já instruída para a tarefa: registrar uma informação sobre você, criar uma skill ou preparar um projeto novo. As duas primeiras rodam numa pasta de trabalho própria (`~/.local/share/llm-agent/workspace`); o projeto novo é criado ao lado dos seus outros projetos (ou em `LLM_AGENT_PROJECTS_DIR`).

À esquerda fica o painel do dia: hora, data, clima e as principais notícias. O clima vem do [Open-Meteo](https://open-meteo.com/) (sem cadastro), usando a localização do navegador; para usar uma cidade fixa, defina `LLM_AGENT_UI_CITY` (por exemplo, `LLM_AGENT_UI_CITY="São Paulo" llm-agent ui`). As notícias vêm do RSS do Google Notícias; `LLM_AGENT_UI_NEWS_RSS` troca a fonte. As coordenadas são enviadas ao Open-Meteo para buscar a previsão.

Na barra da esquerda, **Modo 3D** troca para a interface em lista e **Reduzir movimento** congela as animações. Em GPUs mais fracas, a cena reduz a qualidade sozinha.
```

- [ ] **Step 6: Checar tudo**

Run: `cd app/web && npm run typecheck && npm test && npm run build && cd ../server && npm test && cd ../.. && tests/ui.test.sh`
Expected: sem erros de tipo; testes da UI e do servidor passando; build com o chunk `CoreScene-*.js`; `tests/ui.test.sh` com `todos os testes passaram`.

- [ ] **Step 7: Verificação manual (usuário)**

Run (no host WSL): `rm -rf app/web/dist; llm-agent ui --stop; llm-agent ui` e abrir a URL (aceitar o pedido de localização).
Expected:
1. Átomo dourado com prótons, nêutrons e três órbitas; sem brilho de fundo.
2. "Demonstração de voz": parado no "aguardando"; agitação crescente em "ouvindo" e "pensando"; em "falando", partículas vibrando e órbitas tremendo conforme a voz.
3. Cartões compactos à direita, de cima para baixo; mais de uma página mostra "1 / N" com setas.
4. Painel do dia à esquerda com hora, data, clima e notícias (links abrem em nova aba).
5. "+ Nova skill" e "+ Sobre mim" abrem o Claude no terminal já com a instrução; "+ Novo projeto" pede o nome e abre o Claude na pasta nova.

- [ ] **Step 8: Commit**

```bash
git add -A app/web/src README.md
git commit -m "Golden atom core, right-side cards, day panel and + actions"
```
