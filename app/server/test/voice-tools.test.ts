import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findProject, jarvisHandlers, stripAnsi, type JarvisContext } from '../src/voice/tools.ts';
import { COMMANDS } from '../src/voice/commands.ts';
import type { ProjectDetail, ProjectSummary, SessionInfo, UiCommand } from '../src/types.ts';

const p = (name: string, path = `/w/${name}`): ProjectSummary => ({
  id: `id-${name}`, name, path, updatedAt: '2026-10-01T00:00:00Z', conversations: 1, agents: ['claude'],
});
const projects = [p('meu-app'), p('nowcasting-api'), p('Nowcasting'), p('agendarse')];

function ctx(over: Partial<JarvisContext> = {}) {
  const ui: UiCommand[] = [];
  const opened: { path: string; agent: string; prompt?: string }[] = [];
  const sent: { id: string; text: string }[] = [];
  const relays: ({ id: string; label: string } | null)[] = [];
  const session = (id: string, projectPath: string, alive = true): SessionInfo => ({
    id, projectPath, agent: 'claude', title: 't', startedAt: '2026-11-02T10:00:00Z', alive,
  });
  const c: JarvisContext = {
    projects: async () => projects,
    projectDetail: async (path) =>
      path === '/w/meu-app'
        ? ({
            ...projects[0],
            git: { branch: 'main', dirty: true },
            instructions: [{ path: '/w/meu-app/CLAUDE.md', content: '# Regras', truncated: false }],
            memory: [],
            conversationList: [
              { agent: 'claude', id: 'c1', cwd: '/w/meu-app', title: 'Corrigir login', updatedAt: '2026-11-01T10:00:00Z', prompts: 4 },
            ],
          } satisfies ProjectDetail)
        : null,
    gitLog: async () => ['a1b2c3 há 2 horas Arruma o login', 'd4e5f6 há 1 dia Primeiro commit'],
    gitChanges: async () => [' M src/login.ts', '?? notas.md'],
    sessions: () => [session('s1', '/w/meu-app'), session('s2', '/w/agendarse', false)],
    sessionOutput: (id) => (id === 's1' ? '\x1b[32m● Rodando os testes\x1b[0m\r\nTodos os 12 testes passaram.' : null),
    openSession: (path, agent, prompt) => {
      opened.push({ path, agent, prompt });
      return session('novo', path);
    },
    runTask: async (task) => session(`task-${task}`, '/ws'),
    createProject: async (name) => session(`proj-${name}`, `/w/${name}`),
    ui: (cmd) => ui.push(cmd),
    manual: async () => '# Manual',
    sendToSession: (id, text) => {
      sent.push({ id, text });
      return id === 's1';
    },
    relay: (target) => relays.push(target),
    ...over,
  };
  return { c, ui, opened, sent, relays, h: jarvisHandlers(c) };
}

test('findProject: exato, prefixo, parte do nome e sem acento/caixa', () => {
  assert.equal(findProject(projects, 'Meu App')?.name, 'meu-app');
  assert.equal(findProject(projects, 'nowcasting')?.name, 'Nowcasting', 'exato vence prefixo');
  assert.equal(findProject(projects, 'agenda')?.name, 'agendarse');
  assert.equal(findProject(projects, 'api do nowcasting')?.name, 'nowcasting-api');
  assert.equal(findProject(projects, 'banana'), null);
});

test('stripAnsi limpa cores e controles do terminal', () => {
  assert.equal(stripAnsi('\x1b[32mok\x1b[0m\r\n\x1b]0;titulo\x07fim'), 'ok\nfim');
});

test('abrir_projeto navega na interface e avisa quando nao acha', async () => {
  const { h, ui } = ctx();
  assert.match(await h.abrir_projeto({ nome: 'meu app' }), /meu-app/);
  assert.deepEqual(ui, [{ kind: 'nav', node: { kind: 'project', id: 'id-meu-app' } }]);
  assert.match(await h.abrir_projeto({ nome: 'banana' }), /Não encontrei.*meu-app/);
});

test('abrir_area, abrir_conversas e voltar', async () => {
  const { h, ui } = ctx();
  await h.abrir_area({ area: 'skills' });
  await h.abrir_conversas({ projeto: 'agendarse' });
  await h.voltar({});
  assert.deepEqual(ui, [
    { kind: 'nav', node: { kind: 'skills' } },
    { kind: 'nav', node: { kind: 'conversations', projectId: 'id-agendarse' } },
    { kind: 'back' },
  ]);
});

test('estado_do_projeto junta git, conversas e instrucoes, e mostra o projeto', async () => {
  const { h, ui } = ctx();
  const out = await h.estado_do_projeto({ projeto: 'meu-app' });
  for (const piece of ['branch main', '2 arquivos com mudanças', 'Arruma o login', 'Corrigir login', 'CLAUDE.md']) {
    assert.ok(out.includes(piece), `faltou: ${piece}\n${out}`);
  }
  assert.deepEqual(ui, [{ kind: 'nav', node: { kind: 'project', id: 'id-meu-app' } }]);
});

test('iniciar_sessao abre o agente com a tarefa e foca a aba', async () => {
  const { h, ui, opened } = ctx();
  assert.match(await h.iniciar_sessao({ projeto: 'meu-app', agente: 'claude', tarefa: 'corrigir os testes' }), /background/);
  assert.deepEqual(opened, [{ path: '/w/meu-app', agent: 'claude', prompt: 'corrigir os testes' }]);
  assert.deepEqual(ui.at(-1), { kind: 'focus-session', id: 'novo' });
});

test('sessoes_abertas e estado_da_sessao', async () => {
  const { h } = ctx();
  const list = await h.sessoes_abertas({});
  assert.match(list, /meu-app · Claude · em execução/);
  assert.match(list, /agendarse · Claude · encerrada/);
  const status = await h.estado_da_sessao({ projeto: 'meu-app' });
  assert.match(status, /Todos os 12 testes passaram/);
  assert.ok(!status.includes('\x1b'));
  assert.match(await h.estado_da_sessao({ projeto: 'nowcasting-api' }), /Não há sessão/);
});

test('criar_skill, registrar_sobre_mim e criar_projeto usam as tarefas do "+"', async () => {
  const { h, ui } = ctx();
  assert.match(await h.criar_skill({}), /skill/);
  assert.match(await h.registrar_sobre_mim({}), /sobre você/);
  assert.match(await h.criar_projeto({ nome: 'novo-app' }), /novo-app/);
  assert.deepEqual(
    ui.map((c) => (c.kind === 'focus-session' ? c.id : c.kind)),
    ['task-new-skill', 'task-about-me', 'proj-novo-app'],
  );
  const failing = ctx({ createProject: async () => { throw new Error('já existe uma pasta'); } });
  assert.match(await failing.h.criar_projeto({ nome: 'x' }), /já existe/);
});

test('comandos lista o que o Jarvis sabe fazer e abre o painel', async () => {
  const { h, ui } = ctx();
  const out = await h.comandos({});
  for (const c of COMMANDS) assert.ok(out.includes(c.title), c.title);
  assert.deepEqual(ui, [{ kind: 'commands' }]);
  assert.deepEqual(Object.keys(jarvisHandlers(ctx().c)).sort(), COMMANDS.map((c) => c.name).sort(), 'cada comando tem uma ferramenta');
});

test('manual_do_app procura no README as secoes do assunto', async () => {
  const { searchManual } = await import('../src/voice/tools.ts');
  const md = '# App\nIntro.\n## Interface\nOs cartões ficam à direita.\n### Voz\nDiga Hey Jarvis para ativar a escuta.\n## Licença\nMIT';
  assert.match(searchManual(md, 'como ativo a escuta por voz?'), /Hey Jarvis/);
  assert.ok(!searchManual(md, 'escuta voz').includes('MIT'));
  assert.match(searchManual(md, ''), /Seções do manual: App; Interface; Voz; Licença/);
  assert.match(searchManual(md, 'banana'), /Nada no manual/);
  const { h } = ctx({ manual: async () => md });
  assert.match(await h.manual_do_app({ assunto: 'cartões' }), /à direita/);
});

test('enviar_para_sessao digita na sessao do projeto; falar_direto liga a conversa direta', async () => {
  const { h, sent, relays, ui } = ctx();
  assert.match(await h.enviar_para_sessao({ projeto: 'meu app', mensagem: 'roda os testes' }), /Enviei para o Claude de meu-app/);
  assert.deepEqual(sent, [{ id: 's1', text: 'roda os testes' }]);
  assert.match(await h.enviar_para_sessao({ projeto: 'agendarse', mensagem: 'x' }), /encerrada/);
  assert.match(await h.falar_direto_com_sessao({ projeto: 'meu-app' }), /Jarvis, volta/);
  assert.deepEqual(relays, [{ id: 's1', label: 'Claude de meu-app' }]);
  assert.deepEqual(ui.at(-1), { kind: 'focus-session', id: 's1' });
});

test('nome ambiguo: a ferramenta pede para perguntar qual projeto', async () => {
  const { h, ui } = ctx({
    projects: async () => ['Nowcasting-Geoserver', 'Nowcasting-Geoserver-API'].map((n) => p(n)),
  });
  assert.match(await h.abrir_projeto({ nome: 'geoserver' }), /mais de um projeto parecido.*Nowcasting-Geoserver.*Pergunte/);
  assert.deepEqual(ui, []);
});
