# Memória do Jarvis entre sessões — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o Jarvis guarda fatos sobre o usuário, os projetos e o resumo de cada conversa num arquivo local, e usa isso
nas próximas sessões (mesmo depois de reiniciar o servidor).

**Architecture:**
- **Armazenamento:** um módulo `voice/memory.ts` (classe `JarvisMemory`) guarda tudo em JSON 0600 no diretório de estado da UI.
- **Ferramentas e cérebro:** novas ferramentas (`lembrar`, `esquecer`, `o_que_voce_lembra`, e `encerrar_conversa` com `resumo`) acessam a memória via `JarvisContext.memory`. O `about()` do cérebro injeta a memória no system prompt.
- **Registro da conversa:** a sessão de voz avisa o início e o fim de cada conversa e cada pedido, para um resumo automático quando o modelo não der um.
- **Tela:** a seção "O Jarvis lembra" no painel Você, alimentada por rotas autenticadas.

**Tech Stack:** Node 24 (TS por type stripping, `node:test`), Claude Agent SDK (MCP em processo, zod), React + Vitest.

## Global Constraints
- Textos para o usuário em português do Brasil.
- **Arquivo da memória:**
  - local: `<stateDir>/jarvis-memory.json` (padrão `~/.config/llm-agent/ui/jarvis-memory.json`), modo 0600;
  - no máximo 300 fatos e 20 conversas;
  - no prompt entram os fatos e as 5 últimas conversas.
- **Assuntos dos fatos:** `usuario`, `projeto`, `preferencia`, `pessoa`, `outro`.
- **Uso no prompt:** guardar sem anunciar o que for duradouro; "lembra que…" é confirmado com "Anotado.".
- **Ferramentas:** cada ferramenta nova precisa de uma entrada em `COMMANDS`, porque o teste exige uma por ferramenta.
- **Rotas novas:** passam pela mesma verificação de origem e token das outras rotas `/api/`.

**Desvio consciente do spec:** o resumo de uma conversa sem despedida (voz desligada, servidor parado) é **a lista dos
pedidos do usuário**, sem chamar o modelo. Um turno extra no cérebro só para resumir disputaria com a próxima fala. O
Jarvis não dorme por silêncio hoje, então esse caso não existe.

---

### Task 1: `JarvisMemory` (armazenamento)

**Files:**
- Create: `app/server/src/voice/memory.ts`
- Test: `app/server/test/voice-memory.test.ts`

**Interfaces:**
- Produces:
  - **Tipos:**
    - `type MemoryTopic = 'usuario' | 'projeto' | 'preferencia' | 'pessoa' | 'outro'`;
    - `interface Fact { id: string; about: MemoryTopic; project?: string; text: string; created: string; updated: string }`;
    - `interface ConversationSummary { at: string; text: string }`.
  - **Classe `JarvisMemory(file: string, now: () => Date = () => new Date())`:**
    - `facts(filter?: { about?: MemoryTopic; project?: string }): Fact[]`;
    - `remember(input: { text: string; about: MemoryTopic; project?: string; replaces?: string }): Fact`;
    - `forget(filter: { text?: string; about?: MemoryTopic; id?: string }): number`;
    - `conversations(): ConversationSummary[]`;
    - `startConversation(): void`, `noteRequest(text: string): void`, `setSummary(text: string): void`;
    - `endConversation(): void`: grava `summary` ou "Pedidos: a; b; c"; não grava nada se não houve pedido;
    - `render(): string`: texto para o system prompt (vazio se não houver nada).

- [ ] **Step 1: Write the failing test** — `app/server/test/voice-memory.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tempHome } from './helpers.ts';
import { JarvisMemory } from '../src/voice/memory.ts';

const clock = () => {
  let t = Date.UTC(2026, 10, 3, 12, 0);
  return () => new Date((t += 60_000));
};

test('lembrar, substituir, esquecer e reabrir do arquivo (0600)', () => {
  const file = join(tempHome(), 'ui', 'jarvis-memory.json');
  const m = new JarvisMemory(file, clock());
  const nome = m.remember({ text: 'Chama-se Felipe', about: 'usuario' });
  m.remember({ text: 'meu-app usa Postgres', about: 'projeto', project: 'meu-app' });
  const cafe = m.remember({ text: 'Prefere café sem açúcar', about: 'preferencia' });
  assert.equal(statSync(file).mode & 0o777, 0o600);

  const novo = m.remember({ text: 'Prefere café com leite', about: 'preferencia', replaces: cafe.id });
  assert.equal(novo.id, cafe.id, 'substituir mantem o id');
  assert.equal(m.facts({ about: 'preferencia' }).map((f) => f.text).join(), 'Prefere café com leite');
  assert.deepEqual(m.facts({ project: 'MEU-APP' }).map((f) => f.text), ['meu-app usa Postgres']);

  assert.equal(m.forget({ text: 'postgres' }), 1);
  assert.equal(m.forget({ id: 'nao-existe' }), 0);
  const reopened = new JarvisMemory(file);
  assert.deepEqual(reopened.facts().map((f) => f.id), [nome.id, cafe.id]);
  assert.equal(reopened.forget({ about: 'usuario' }), 1);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).facts.length, 1);
});

test('limite de 300 fatos: saem os menos atualizados', () => {
  const m = new JarvisMemory(join(tempHome(), 'm.json'), clock());
  const first = m.remember({ text: 'fato 0', about: 'outro' });
  for (let i = 1; i < 300; i++) m.remember({ text: `fato ${i}`, about: 'outro' });
  m.remember({ text: 'fato 0 atualizado', about: 'outro', replaces: first.id });
  m.remember({ text: 'fato 300', about: 'outro' });
  const texts = m.facts().map((f) => f.text);
  assert.equal(texts.length, 300);
  assert.ok(texts.includes('fato 0 atualizado'));
  assert.ok(!texts.includes('fato 1'));
});

test('conversas: resumo do modelo, ou a lista de pedidos; no maximo 20', () => {
  const m = new JarvisMemory(join(tempHome(), 'm.json'), clock());
  m.startConversation();
  m.endConversation();
  assert.equal(m.conversations().length, 0, 'sem pedidos nao registra');

  m.startConversation();
  m.noteRequest('abre o meu-app');
  m.noteRequest('como estão os testes?');
  m.endConversation();
  m.startConversation();
  m.noteRequest('qualquer coisa');
  m.setSummary('Revisamos os testes do meu-app.');
  m.endConversation();
  m.endConversation(); // repetido: nao duplica
  assert.deepEqual(m.conversations().map((c) => c.text), [
    'Pedidos: abre o meu-app; como estão os testes?',
    'Revisamos os testes do meu-app.',
  ]);
  for (let i = 0; i < 25; i++) {
    m.startConversation();
    m.noteRequest(`p${i}`);
    m.endConversation();
  }
  assert.equal(m.conversations().length, 20);
});

test('render agrupa os fatos com id e mostra as 5 ultimas conversas', () => {
  const m = new JarvisMemory(join(tempHome(), 'm.json'), clock());
  assert.equal(m.render(), '');
  const f = m.remember({ text: 'Chama-se Felipe', about: 'usuario' });
  m.remember({ text: 'usa Postgres', about: 'projeto', project: 'meu-app' });
  for (let i = 0; i < 7; i++) {
    m.startConversation();
    m.setSummary(`conversa ${i}`);
    m.noteRequest('x');
    m.endConversation();
  }
  const out = m.render();
  assert.match(out, new RegExp(`Sobre o usuário:\\n- \\[${f.id}\\] Chama-se Felipe`));
  assert.match(out, /Projetos:\n- \[\w+\] \(meu-app\) usa Postgres/);
  assert.ok(!out.includes('conversa 1'), 'so as 5 ultimas');
  assert.match(out, /Últimas conversas:\n- .*conversa 2/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/server && node --test test/voice-memory.test.ts`
Expected: FAIL com `Cannot find module '../src/voice/memory.ts'`.

- [ ] **Step 3: Write the implementation** — `app/server/src/voice/memory.ts`:

```ts
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
    if (this.current.requests.length < MAX_REQUESTS) this.current.requests.push(text.trim().slice(0, 120));
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/server && node --test test/voice-memory.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add app/server/src/voice/memory.ts app/server/test/voice-memory.test.ts
git commit -m "Jarvis memory store: facts and conversation summaries in a local 0600 file"
```

---

### Task 2: Ferramentas de memória e instruções do cérebro

**Files:**
- Modify: `app/server/src/voice/tools.ts`:
  - interface `JarvisContext`: novo campo `memory`;
  - handlers novos e `encerrar_conversa`;
  - registros `tool(...)`.
- Modify: `app/server/src/voice/commands.ts`: 3 entradas novas.
- Modify: `app/server/src/voice/brain.ts`: duas regras novas no `JARVIS_PROMPT`.
- Test: `app/server/test/voice-tools.test.ts`: `ctx()` ganha `memory`; testes novos.

**Interfaces:**
- Consumes: `JarvisMemory`, `TOPICS` e `MemoryTopic` da Task 1.
- Produces: `JarvisContext.memory: JarvisMemory` e os handlers `lembrar`, `esquecer`, `o_que_voce_lembra`, `encerrar_conversa({ resumo? })`.

- [ ] **Step 1: Write the failing tests.** Em `test/voice-tools.test.ts`:
  - importar `JarvisMemory` e `tempHome`;
  - no objeto `c` de `ctx()`, adicionar `memory: new JarvisMemory(join(tempHome(), 'm.json')),` antes de `...over`;
  - adicionar os testes:

```ts
test('lembrar, o_que_voce_lembra e esquecer usam a memoria do Jarvis', async () => {
  const { c } = ctx();
  const h = jarvisHandlers(c);
  assert.match(await h.lembrar({ fato: 'Chama-se Felipe', sobre: 'usuario' }), /Guardado \[\w+\]/);
  await h.lembrar({ fato: 'meu-app usa Postgres', sobre: 'projeto', projeto: 'meu-app' });
  const list = await h.o_que_voce_lembra({});
  assert.match(list, /Chama-se Felipe/);
  assert.match(list, /\(meu-app\) meu-app usa Postgres/);
  assert.match(await h.o_que_voce_lembra({ sobre: 'pessoa' }), /Nada guardado/);
  const id = c.memory.facts({ about: 'usuario' })[0].id;
  await h.lembrar({ fato: 'Chama-se Felipe Sampaio', sobre: 'usuario', substitui: id });
  assert.equal(c.memory.facts({ about: 'usuario' })[0].text, 'Chama-se Felipe Sampaio');
  assert.match(await h.lembrar({ fato: 'x', sobre: 'usuario', substitui: 'zzz' }), /Erro|não encontrei/i);
  assert.match(await h.esquecer({ trecho: 'postgres' }), /Apaguei 1/);
  assert.match(await h.esquecer({ trecho: 'nada disso' }), /Não encontrei/);
  assert.match(await h.esquecer({ sobre: 'usuario' }), /Apaguei 1/);
});

test('encerrar_conversa guarda o resumo da conversa', async () => {
  const { c, ended } = ctx();
  c.memory.startConversation();
  c.memory.noteRequest('roda os testes');
  await jarvisHandlers(c).encerrar_conversa({ resumo: 'Rodamos os testes do meu-app.' });
  c.memory.endConversation();
  assert.equal(ended.length, 1);
  assert.equal(c.memory.conversations()[0].text, 'Rodamos os testes do meu-app.');
});
```

(`ended` já é devolvido por `ctx()`; conferir o `return` de `ctx()` e incluí-lo se faltar.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd app/server && node --test test/voice-tools.test.ts`
Expected: FAIL. `h.lembrar is not a function`, e erro de tipo em `memory`.

- [ ] **Step 3: Implement**

`tools.ts`:
- **Imports:** `import { TOPICS, type JarvisMemory, type MemoryTopic } from './memory.ts';`.
- **Contexto:** em `JarvisContext`, adicionar:

```ts
  /** Memoria do Jarvis entre sessoes (fatos e resumos de conversa). */
  memory: JarvisMemory;
```

- **Handlers:** em `jarvisHandlers`, trocar `encerrar_conversa` e adicionar:

```ts
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
```

- **Registros:** em `createJarvisServer`, trocar o `tool('encerrar_conversa', …)` e adicionar:

```ts
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
```

`commands.ts`: depois de `registrar_sobre_mim`, adicionar:

```ts
  { name: 'lembrar', title: 'Guardar algo na memória', examples: ['lembra que eu prefiro respostas curtas', 'anota que o meu-app entra em produção sexta'] },
  { name: 'o_que_voce_lembra', title: 'Ver o que o Jarvis lembra', examples: ['o que você lembra sobre mim?', 'o que você sabe do meu-app?'] },
  { name: 'esquecer', title: 'Apagar algo da memória', examples: ['esquece que eu tomo café sem açúcar'] },
```

`brain.ts`: no `JARVIS_PROMPT`, antes da linha `` `Comandos disponíveis: … ` ``, adicionar:

```ts
  'Memória: guarde com lembrar, sem anunciar, o que for duradouro e útil depois (nome, preferências, rotina, pessoas, metas, decisões, stack e prazos dos projetos); não guarde o passageiro (clima, hora, pedidos únicos). Se ele pedir para você lembrar de algo, guarde e confirme só com "Anotado.". Se um fato guardado mudou, use substitui com o id dele em vez de duplicar.',
  'Use o que você lembra com naturalidade, quando ajudar (ex.: retomar o que ficou da última conversa), sem recitar a lista. Ao encerrar a conversa, passe em resumo uma frase do que foi feito.',
```

- [ ] **Step 4: Run the tests**

Run: `cd app/server && node --test test/voice-tools.test.ts test/voice-brain.test.ts && npm run typecheck`
Expected: PASS. O typecheck acusa `server.ts` (falta `memory` no contexto): é a Task 3.

- [ ] **Step 5: Commit** — vai junto com a Task 3, porque `server.ts` só compila com as duas.

---

### Task 3: Ligar a memória no servidor, na sessão de voz e no cérebro

**Files:**
- Modify: `app/server/src/voice/session.ts`:
  - opção `conversation`;
  - chamadas em `wakeUp`, `ask` e `maybeFinish` (dormir após despedida);
  - chamada em `stop`.
- Modify: `app/server/src/server.ts`:
  - `AppOptions.memory?: JarvisMemory`;
  - `memory` no contexto `jarvis`;
  - `conversation` na `VoiceSession`;
  - rotas `GET /api/jarvis/memory` e `DELETE /api/jarvis/memory/:id`.
- Modify: `app/server/src/main.ts`: cria a `JarvisMemory`, passa para `createApp` e inclui `render()` no `about()`.
- Modify: `app/server/test/app.ts`: nada (as opções passam por `extra`).
- Test: `app/server/test/voice-session.test.ts`, `app/server/test/voice-memory.test.ts` (a rota).

**Interfaces:**
- Consumes: `JarvisMemory` (Task 1); `JarvisContext.memory` (Task 2).
- Produces:
  - opção da `VoiceSession`: `conversation?: { start(): void; request(text: string): void; end(): void }`;
  - rotas que devolvem `{ facts: Fact[]; conversations: ConversationSummary[] }` e `DELETE` → `{ removed: number }`.

- [ ] **Step 1: Write the failing tests.**

Em `test/voice-session.test.ts`, um teste novo que usa os mesmos ajudantes dos testes existentes de despedida. Copiar a
montagem de `setup()`/`FakeWorker`/`FakeBrain` do teste "despedida…" do arquivo e passar a opção
`conversation: { start: () => log.push('start'), request: (t) => log.push(`req:${t}`), end: () => log.push('end') }`.

Roteiro:
1. acordar;
2. transcrição "abre o meu-app";
3. resposta;
4. transcrição "obrigado, tchau", com a resposta terminando;
5. esperar o estado `sleeping`.

Asserção esperada:

```ts
assert.deepEqual(log, ['start', 'req:abre o meu-app', 'req:obrigado, tchau', 'end']);
```

E em `test/voice-memory.test.ts`, a rota:

```ts
test('/api/jarvis/memory: lista e apaga com token', async () => {
  const memory = new JarvisMemory(join(tempHome(), 'm.json'));
  const f = memory.remember({ text: 'Chama-se Felipe', about: 'usuario' });
  const { app, base } = await startApp(tempHome(), { memory });
  try {
    const auth = { authorization: 'Bearer tok' };
    assert.equal((await fetch(`${base}/api/jarvis/memory`)).status, 401);
    const list = await (await fetch(`${base}/api/jarvis/memory`, { headers: auth })).json();
    assert.equal(list.facts[0].text, 'Chama-se Felipe');
    const del = await fetch(`${base}/api/jarvis/memory/${f.id}`, { method: 'DELETE', headers: auth });
    assert.deepEqual(await del.json(), { removed: 1 });
    assert.equal(memory.facts().length, 0);
  } finally {
    await app.close();
  }
});
```

(importar `startApp` de `./app.ts`.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd app/server && node --test test/voice-memory.test.ts test/voice-session.test.ts`
Expected: FAIL. A rota responde 404, e o log fica vazio.

- [ ] **Step 3: Implement**

`session.ts`:
- **Opções:** junto das outras opções do construtor, adicionar
  `conversation?: { start(): void; request(text: string): void; end(): void };`
  e guardar em `private readonly conversation`.
- **Inicializar:** no construtor, `this.conversation = opts.conversation;`.
- **`wakeUp()`:** no início, `this.conversation?.start();`.
- **`ask(text, ms)`:** logo no começo, `this.conversation?.request(text);`.
- **`maybeFinish()`:** no ramo `if (this.farewell)`, antes de `this.setState('sleeping')`, `this.conversation?.end();`.
- **`stop()`:** antes de trocar o estado para `off`, `if (this.state !== 'off' && this.state !== 'sleeping') this.conversation?.end();`.
  Se a sessão já estava dormindo, a conversa já foi encerrada; `endConversation()` sem conversa aberta não faz nada.

`server.ts`:
- **Opções:** `import type { JarvisMemory } from './voice/memory.ts';` e, em `AppOptions`:
  `/** Memoria do Jarvis entre sessoes (sem ela, uma em memoria descartavel). */ memory?: JarvisMemory;`.
- **Memória padrão:** em `createApp`,
  `const memory = opts.memory ?? new JarvisMemory(join(workspace, '.jarvis-memory.json'));`.
  Importar a classe (não só o tipo). Isso mantém os testes antigos funcionando sem passar `memory`.
- **Contexto e sessão:**
  - no objeto `jarvis`, `memory,`;
  - nas opções da `VoiceSession`: `conversation: { start: () => memory.startConversation(), request: (t) => memory.noteRequest(t), end: () => memory.endConversation() },`.
- **Rotas:** em `api()`, antes do `if (req.method !== 'GET')`:

```ts
    if (url.pathname === '/api/jarvis/memory' && req.method === 'GET') {
      return send(res, 200, { facts: memory.facts(), conversations: memory.conversations() });
    }
    const mem = /^\/api\/jarvis\/memory\/([0-9a-f]{6})$/.exec(url.pathname);
    if (mem && req.method === 'DELETE') return send(res, 200, { removed: memory.forget({ id: mem[1] }) });
```

`main.ts`:
- **Criar a memória:** `import { JarvisMemory } from './voice/memory.ts';` e, depois de `token`,
  `const memory = new JarvisMemory(join(stateDir, 'jarvis-memory.json'));`.
- **Repassar:** em `createApp({...})`, `memory,`.
- **Prompt:** em `about`, trocar o `return` por:

```ts
      const remembered = memory.render();
      return [
        memories,
        remembered && `O que você (Jarvis) guardou nas conversas anteriores (ids entre colchetes):\n${remembered}`,
        `Projetos do usuário (nomes exatos): ${projects || 'nenhum ainda'}.`,
      ].filter(Boolean).join('\n\n').trim();
```

- [ ] **Step 4: Run everything**

Run: `cd app/server && npm test && npm run typecheck`
Expected: todos os testes passam e o typecheck fica limpo.

- [ ] **Step 5: Commit (Tasks 2 e 3)**

```bash
git add app/server
git commit -m "Jarvis remembers facts and conversation summaries across sessions (tools lembrar/esquecer/o_que_voce_lembra, prompt, API)"
```

---

### Task 4: Seção "O Jarvis lembra" no painel Você + README

**Files:**
- Modify: `app/web/src/api.ts` (tipos e métodos `jarvisMemory()`, `forgetFact(id)`).
- Modify: `app/web/src/components/ProfilePanel.tsx` (prop `api`, seção nova).
- Modify: `app/web/src/App.tsx:391` (passar `api`).
- Modify: `app/web/src/three.css` (estilo da lista).
- Modify: `README.md` (parágrafo sobre a memória).
- Test: `app/web/test/api.test.ts`.

**Interfaces:**
- Consumes: as rotas da Task 3.
- Produces: `Api.jarvisMemory(): Promise<JarvisMemoryView>` e `Api.forgetFact(id: string): Promise<number>`.

- [ ] **Step 1: Failing test** em `app/web/test/api.test.ts`:

```ts
it('jarvisMemory lista e forgetFact apaga com DELETE', async () => {
  const calls: { url: string; method?: string }[] = [];
  const api = new Api('tok', (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method });
    return new Response(init?.method === 'DELETE' ? '{"removed":1}' : '{"facts":[],"conversations":[]}', { status: 200 });
  }) as unknown as typeof fetch);
  expect(await api.jarvisMemory()).toEqual({ facts: [], conversations: [] });
  expect(await api.forgetFact('a1b2c3')).toBe(1);
  expect(calls).toEqual([{ url: '/api/jarvis/memory', method: undefined }, { url: '/api/jarvis/memory/a1b2c3', method: 'DELETE' }]);
});
```

- [ ] **Step 2:** Run: `cd app/web && npx vitest run test/api.test.ts`. Expected: FAIL (`api.jarvisMemory is not a function`).

- [ ] **Step 3: Implement**

`api.ts` (tipos no topo e métodos na classe `Api`):

```ts
export interface JarvisFact { id: string; about: string; project?: string; text: string; updated: string }
export interface JarvisMemoryView { facts: JarvisFact[]; conversations: { at: string; text: string }[] }
```

```ts
  jarvisMemory(): Promise<JarvisMemoryView> {
    return this.get('/api/jarvis/memory');
  }

  async forgetFact(id: string): Promise<number> {
    const res = await this.fetchImpl(`/api/jarvis/memory/${id}`, { method: 'DELETE', headers: { authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao apagar`);
    return ((await res.json()) as { removed: number }).removed;
  }
```

`ProfilePanel.tsx`: assinatura `ProfilePanel({ profile, api }: { profile?: Profile; api: Api })`, e um componente
`JarvisMemorySection({ api })` no mesmo arquivo, renderizado depois das "Memórias":

```tsx
const TOPIC_LABEL: Record<string, string> = { usuario: 'Sobre você', preferencia: 'Preferências', pessoa: 'Pessoas', projeto: 'Projetos', outro: 'Outros' };

function JarvisMemorySection({ api }: { api: Api }) {
  const [data, setData] = useState<JarvisMemoryView | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.jarvisMemory().then(setData, () => setError('Não consegui ler a memória do Jarvis.')), [api]);
  useEffect(() => void load(), [load]);
  const forget = async (id: string) => {
    await api.forgetFact(id).catch(() => setError('Não consegui apagar.'));
    void load();
  };
  return (
    <>
      <h2>O Jarvis lembra</h2>
      {error && <p className="muted">{error}</p>}
      {data && !data.facts.length && <p className="muted">Nada ainda. Conte algo ao Jarvis, ou diga “lembra que…”.</p>}
      {data &&
        Object.keys(TOPIC_LABEL).map((topic) => {
          const facts = data.facts.filter((f) => f.about === topic);
          if (!facts.length) return null;
          return (
            <div key={topic} className="jarvis-facts">
              <h3>{TOPIC_LABEL[topic]}</h3>
              <ul>
                {facts.map((f) => (
                  <li key={f.id}>
                    <span>{f.project ? <b>{f.project}: </b> : null}{f.text}</span>
                    <button className="link" title="Apagar da memória do Jarvis" onClick={() => void forget(f.id)}>apagar</button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      {data && data.conversations.length > 0 && (
        <div className="jarvis-facts">
          <h3>Últimas conversas</h3>
          <ul>
            {data.conversations.slice(-5).reverse().map((c) => (
              <li key={c.at}><span>{new Date(c.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}: {c.text}</span></li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
```

Imports: `import { useCallback, useEffect, useState } from 'react';` e `import type { Api, JarvisMemoryView } from '../api.ts';`.
O `<p className="muted">` do topo passa a dizer "O que os agentes e o Jarvis sabem sobre você.".

`App.tsx:391`: `<ProfilePanel profile={overview?.profile} api={api} />`.

`three.css` (no fim):

```css
.jarvis-facts h3 { margin: 10px 0 4px; font-size: 12px; color: var(--muted); font-weight: 500; }
.jarvis-facts ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.jarvis-facts li { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; }
.jarvis-facts .link { background: none; border: none; padding: 0; color: var(--muted); text-decoration: underline; cursor: pointer; font-size: 12px; flex: none; }
```

`README.md`: depois do parágrafo "O Jarvis responde também sobre o dia…", adicionar:

> **Memória:** o Jarvis guarda o que aprende nas conversas (seu nome, preferências, pessoas, metas e decisões dos projetos) e um resumo de cada conversa, e usa isso nas próximas, mesmo depois de reiniciar. Diga "lembra que…" para guardar algo na hora, "o que você lembra sobre mim?" para ouvir, e "esquece que…" para apagar. Na seção **Você**, "O Jarvis lembra" mostra tudo, com um botão para apagar cada item. Fica só no seu PC, em `~/.config/llm-agent/ui/jarvis-memory.json` (permissão 600). O conteúdo vai para o Claude junto com as instruções do Jarvis, como as memórias dos agentes.

- [ ] **Step 4: Verify**

Run: `cd app/web && npm test && npx tsc -p . && npm run build`
Expected: os testes passam e o build sai sem erro.

- [ ] **Step 5: Commit**

```bash
git add app/web README.md
git commit -m "Profile panel shows what Jarvis remembers, with delete; README"
```

---

## Verificação final
- **Servidor e worker:** `npm --prefix app/server test`, `npm --prefix app/server run typecheck` e `python3 -m unittest discover -s app/voice/tests -t app/voice`.
- **Web:** `npm --prefix app/web test` e `npm --prefix app/web run build`.
- **Cérebro real** (script de rascunho com o Haiku e um contexto falso):
  - "meu nome é Felipe e eu prefiro respostas curtas" chama `lembrar` duas vezes, sem anunciar;
  - "lembra que o meu-app entra em produção sexta" chama `lembrar` e a resposta é "Anotado.";
  - "obrigado, tchau" chama `encerrar_conversa` com `resumo`.
