import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findProject, jarvisHandlers, resolveConfigOption, spokenToggle, stripAnsi, type JarvisContext } from '../src/voice/tools.ts';
import type { BrainChoice, BrainChoiceApi, BrainModel, BrainProvider } from '../src/voice/brain-choice.ts';
import { COMMANDS } from '../src/voice/commands.ts';
import { JarvisMemory } from '../src/voice/memory.ts';
import { NewsHistory } from '../src/voice/news-history.ts';
import { SessionWatcher } from '../src/voice/session-watch.ts';
import { join } from 'node:path';
import { tempHome } from './helpers.ts';
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
  const closed: string[] = [];
  const ended: boolean[] = [];
  const session = (id: string, projectPath: string, alive = true): SessionInfo => ({
    id, projectPath, agent: 'claude', title: 't', startedAt: '2026-11-02T10:00:00Z', alive,
  });
  const sessions = () => [session('s1', '/w/meu-app'), session('s2', '/w/agendarse', false)];
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
    sessions,
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
    day: async () => ({
      weather: { temperature: 24, code: 2, description: 'parcialmente nublado', max: 29, min: 18, place: 'São Paulo' },
      news: [{ title: 'Chuva forte em SP', source: 'G1', link: '', published: '' }],
    }),
    webSearch: async (query) => ({
      query,
      results: [{ title: 'Fusão nuclear: o que é', url: 'https://www.exemplo.com.br/fusao', snippet: 'Processo que junta núcleos.' }],
      summary: { title: 'Fusão nuclear', extract: 'Fusão nuclear é o processo no qual dois núcleos se juntam.', url: 'https://pt.wikipedia.org/wiki/Fus%C3%A3o_nuclear' },
      errors: [],
    }),
    now: () => new Date(2026, 10, 2, 14, 5),
    closeSession: (id) => closed.push(id),
    endConversation: () => ended.push(true),
    memory: new JarvisMemory(join(tempHome(), 'm.json')),
    newsHistory: new NewsHistory(),
    watcher: new SessionWatcher({ sessions, output: () => '' }),
    ...over,
  };
  return { c, ui, opened, sent, relays, closed, ended, h: jarvisHandlers(c) };
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

test('criar_issue confirma com o numero so depois de gravar; se falhar, diz que nao gravou', async () => {
  const created: string[][] = [];
  const ok = ctx({ createIssue: async (title, description) => (created.push([title, description]), 7) });
  assert.match(await ok.h.criar_issue({ titulo: 'Modo escuro', descricao: 'Tema escuro.' }), /número 7 gravada/);
  assert.deepEqual(created, [['Modo escuro', 'Tema escuro.']]);
  const failing = ctx({ createIssue: async () => { throw new Error('não consegui gravar o ISSUES.md'); } });
  const out = await failing.h.criar_issue({ titulo: 'x', descricao: 'y' });
  assert.match(out, /NÃO foi gravada: não consegui gravar o ISSUES\.md/);
  assert.doesNotMatch(out, /número/);
  assert.match(await ctx().h.criar_issue({ titulo: 'x', descricao: 'y' }), /NÃO foi gravada/);
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
  assert.match(await h.falar_direto_com_sessao({ projeto: 'meu-app' }), /^Conversa direta com o Claude de meu-app \(sessão nº 1\) ligada/);
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

test('clima, noticias e hora vem das ferramentas', async () => {
  const { h } = ctx();
  assert.equal(await h.clima_agora({}), 'Agora faz 24 graus, parcialmente nublado, em São Paulo. Hoje a máxima é 29 e a mínima 18 graus.');
  assert.match(await h.noticias_do_dia({}), /Chuva forte em SP \(G1\)/);
  assert.match(await h.data_e_hora({}), /^Agora são 14:05 de segunda-feira, 2 de novembro de 2026\.$/);
  const off = ctx({ day: async () => ({ weather: null, weatherError: 'Permita a localização', news: [] }) });
  assert.match(await off.h.clima_agora({}), /Não consegui o clima agora: Permita a localização/);
});

test('noticias_do_dia: so as ainda nao apresentadas, ate 3 por vez, e avisa quando nao ha novidade', async () => {
  const item = (title: string) => ({ title, source: 'G1', link: '', published: '' });
  const history = new NewsHistory();
  history.mark([item('Ja falada')]); // por exemplo, anunciada sozinha pelo Jarvis
  const { h } = ctx({ newsHistory: history, day: async () => ({ weather: null, news: ['Ja falada', 'N1', 'N2', 'N3', 'N4'].map(item) }) });
  const first = await h.noticias_do_dia({});
  assert.match(first, /N1.*N2.*N3/s);
  assert.doesNotMatch(first, /Ja falada|N4/);
  const second = await h.noticias_do_dia({});
  assert.match(second, /N4/);
  assert.doesNotMatch(second, /N1|N2|N3|Ja falada/);
  assert.match(await h.noticias_do_dia({}), /Não há notícias novas.*sem repetir/);
});

test('fechar_sessao fecha o terminal; encerrar_conversa poe o Jarvis para esperar', async () => {
  const { h, closed, ended } = ctx();
  assert.match(await h.fechar_sessao({ projeto: 'meu app' }), /Fechei o terminal do Claude de meu-app/);
  assert.deepEqual(closed, ['s1']);
  assert.match(await h.fechar_sessao({ projeto: 'nowcasting-api' }), /Não há sessão/);
  assert.match(await h.encerrar_conversa({}), /encerrada/);
  assert.deepEqual(ended, [true]);
});

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
  await assert.rejects(h.lembrar({ fato: 'x', sobre: 'usuario', substitui: 'zzz' }), /não encontrei o fato zzz/);
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

test('pesquisar_na_web traz o resumo e os resultados com o site, pedindo resposta curta', async () => {
  const { h } = ctx();
  const out = await h.pesquisar_na_web({ assunto: 'fusão nuclear' });
  assert.match(out, /Busca na web por "fusão nuclear"/);
  assert.match(out, /Contexto da Wikipedia, artigo "Fusão nuclear".*dois núcleos se juntam/);
  assert.ok(out.indexOf('1. Fusão') < out.indexOf('Contexto da Wikipedia'), 'resultados da web antes da Wikipedia');
  assert.match(out, /1\. Fusão nuclear: o que é \(exemplo\.com\.br\): Processo que junta núcleos\./);
  assert.match(out, /uma a três frases/);
  assert.match(await h.pesquisar_na_web({ assunto: '  ' }), /o que ele quer pesquisar/);
  const none = ctx({ webSearch: async (query) => ({ query, results: [], summary: null, errors: [] }) });
  assert.match(await none.h.pesquisar_na_web({ assunto: 'xyzzy' }), /Não achei nada na web sobre "xyzzy"/);
  const down = ctx({ webSearch: async (query) => ({ query, results: [], summary: null, errors: ['DuckDuckGo: HTTP 403', 'Wikipedia: HTTP 503'] }) });
  const deep = ctx({ webSearch: async (query) => ({ query, results: [], summary: null, answer: '- Dólar a R$ 5,44 (Dólar Hoje)', errors: [] }) });
  assert.match(await deep.h.pesquisar_na_web({ assunto: 'dólar' }), /já resumida, com as fontes\):\n- Dólar a R\$ 5,44 \(Dólar Hoje\)/);
  assert.match(await down.h.pesquisar_na_web({ assunto: 'x' }), /Não consegui pesquisar agora \(DuckDuckGo: HTTP 403; Wikipedia: HTTP 503\)/);
});

test('spokenNumber e sessionActivity', async () => {
  const { spokenNumber, sessionActivity } = await import('../src/voice/tools.ts');
  assert.equal(spokenNumber('2'), 2);
  assert.equal(spokenNumber('a segunda'), 2);
  assert.equal(spokenNumber('sessão número 3'), 3);
  assert.equal(spokenNumber('nº 4'), 4);
  assert.equal(spokenNumber('a do codex'), null);
  assert.equal(
    sessionActivity('\x1b[1m╭──────╮\x1b[0m\r\nLendo src/login.ts\r\n● Rodando os testes\r\n│ >  │\r\n? for shortcuts\r\n'),
    'Lendo src/login.ts / ● Rodando os testes',
  );
  assert.equal(sessionActivity(''), '');
});

const sent: { id: string; text: string }[] = [];

/** Tres sessoes no meu-app (duas vivas) e uma encerrada no agendarse, abertas nesta ordem. */
function multi() {
  const s = (id: string, projectPath: string, agent: SessionInfo['agent'], title: string, minute: number, alive = true): SessionInfo => ({
    id, projectPath, agent, title, startedAt: `2026-11-02T10:${String(minute).padStart(2, '0')}:00Z`, alive,
  });
  const sessions = [
    s('aaaa1111-0000', '/w/meu-app', 'claude', 'corrigir o login', 1),
    s('bbbb2222-0000', '/w/agendarse', 'claude', 'nova conversa', 2, false),
    s('cccc3333-0000', '/w/meu-app', 'codex', 'escrever testes de pagamento', 3),
    s('dddd4444-0000', '/w/meu-app', 'shell', 'shell', 4, false),
  ];
  const out: Record<string, string> = {
    'aaaa1111-0000': 'Editando src/login.ts',
    'cccc3333-0000': 'Rodando npm test\r\n3 testes falharam',
  };
  // Ordem embaralhada: a numeracao segue a abertura, nao a lista.
  return ctx({ sessions: () => [sessions[2], sessions[0], sessions[3], sessions[1]], sessionOutput: (id) => out[id] ?? null, sendToSession: (id, text) => { sent.push({ id, text }); return true; } });
}

test('sessoes_abertas numera pela abertura e diz o que cada uma esta fazendo', async () => {
  const { h } = multi();
  const lines = (await h.sessoes_abertas({})).split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^nº 1 · meu-app · Claude · em execução · corrigir o login · id aaaa1111 · agora: Editando src\/login\.ts$/);
  assert.match(lines[1], /^nº 2 · agendarse · Claude · encerrada/);
  assert.match(lines[2], /^nº 3 · meu-app · Codex · .* agora: Rodando npm test \/ 3 testes falharam$/);
  const only = await h.sessoes_abertas({ projeto: 'agendarse' });
  assert.equal(only.split('\n').length, 1);
  assert.match(await h.sessoes_abertas({ projeto: 'nowcasting-api' }), /Não há sessão aberta em nowcasting-api/);
});

test('estado_da_sessao escolhe pela ordem, id, agente ou titulo', async () => {
  const { h } = multi();
  assert.match(await h.estado_da_sessao({ sessao: '1' }), /^Sessão nº 1, Claude em meu-app.*Editando src\/login\.ts/s);
  assert.match(await h.estado_da_sessao({ sessao: 'a terceira' }), /^Sessão nº 3, Codex/);
  assert.match(await h.estado_da_sessao({ sessao: 'cccc3333' }), /^Sessão nº 3/);
  assert.match(await h.estado_da_sessao({ sessao: 'cccc3333-0000' }), /^Sessão nº 3/);
  assert.match(await h.estado_da_sessao({ projeto: 'meu-app', sessao: 'a do codex' }), /^Sessão nº 3/);
  assert.match(await h.estado_da_sessao({ sessao: 'a do login' }), /^Sessão nº 1/);
  assert.match(await h.estado_da_sessao({ sessao: 'testes de pagamento' }), /^Sessão nº 3/);
  // Numero dentro do projeto quando o numero geral nao e dele: a 2a do meu-app e a nº 3.
  assert.match(await h.estado_da_sessao({ projeto: 'meu-app', sessao: '2' }), /^Sessão nº 3/);
  assert.match(await h.estado_da_sessao({ sessao: '9' }), /Não achei a sessão "9".*nº 1.*nº 4.*Pergunte/s);
  assert.match(await h.estado_da_sessao({ sessao: 'banana' }), /Não achei a sessão "banana"/);
  // Sem seletor: a mais recente em execucao, avisando das outras.
  const def = await h.estado_da_sessao({ projeto: 'meu-app' });
  assert.match(def, /^Sessão nº 3/);
  assert.match(def, /também estão abertas: nº 1 Claude "corrigir o login"/);
});

test('seletor ambiguo pede para perguntar', async () => {
  const amb = ctx({
    sessions: () => [
      { id: 'x1', projectPath: '/w/meu-app', agent: 'claude', title: 'testes A', startedAt: '2026-11-02T10:00:00Z', alive: true },
      { id: 'x2', projectPath: '/w/meu-app', agent: 'claude', title: 'testes B', startedAt: '2026-11-02T10:01:00Z', alive: true },
    ],
  });
  assert.match(await amb.h.enviar_para_sessao({ sessao: 'claude', mensagem: 'oi' }), /Mais de uma sessão combina com "claude".*nº 1.*nº 2.*Pergunte/s);
  assert.deepEqual(amb.sent, []);
  assert.match(await amb.h.estado_da_sessao({ sessao: 'o claude mais recente' }), /^Sessão nº 2/);
});

test('enviar, falar direto e fechar aceitam a sessao especifica', async () => {
  const { h, relays, closed, ui } = multi();
  sent.length = 0;
  assert.match(await h.enviar_para_sessao({ sessao: 'a primeira', mensagem: 'roda os testes' }), /Enviei para o Claude de meu-app \(sessão nº 1, "corrigir o login"\)\.$/);
  assert.deepEqual(sent, [{ id: 'aaaa1111-0000', text: 'roda os testes' }]);
  assert.deepEqual(ui.at(-1), { kind: 'focus-session', id: 'aaaa1111-0000' });
  assert.match(await h.enviar_para_sessao({ sessao: '2', mensagem: 'x' }), /nº 2 já foi encerrada/);
  assert.match(await h.falar_direto_com_sessao({ sessao: 'codex' }), /Codex de meu-app \(sessão nº 3\) ligada/);
  assert.deepEqual(relays, [{ id: 'cccc3333-0000', label: 'Codex de meu-app' }]);
  assert.match(await h.fechar_sessao({ sessao: 'dddd4444' }), /Shell de meu-app \(sessão nº 4\)/);
  assert.deepEqual(closed, ['dddd4444-0000']);
});

test('ferramentas da evolucao passam o turno do usuario ao gerenciador', async () => {
  const calls: string[] = [];
  let turn = 3;
  const { h } = ctx({
    userTurn: () => turn,
    evolution: {
      draft: (t, s) => (calls.push(`draft ${t}: ${s}`), 'ok'),
      summarize: (s, n) => (calls.push(`summarize ${s} @${n}`), 'ok'),
      start: async (n) => (calls.push(`start @${n}`), 'ok'),
      status: async () => 'status',
      apply: async (o) => (calls.push(`apply ${JSON.stringify(o)}`), 'ok'),
      discard: async () => (calls.push('discard'), 'ok'),
    },
  });
  await h.rascunhar_evolucao({ titulo: 'Previsão', especificacao: '7 dias' });
  await h.resumir_evolucao({ resumo: 'Vou criar a previsão.' });
  turn = 4;
  await h.iniciar_evolucao({});
  await h.aplicar_evolucao({ confirmar_fechar_sessoes: true });
  await h.aplicar_evolucao({});
  await h.descartar_evolucao({});
  assert.deepEqual(calls, [
    'draft Previsão: 7 dias',
    'summarize Vou criar a previsão. @3',
    'start @4',
    'apply {"closeSessions":true}',
    'apply {"closeSessions":false}',
    'discard',
  ]);
  await assert.rejects(ctx().h.status_evolucao({}), /não está disponível/);
});

test('acompanhar_sessao e parar_de_acompanhar', async () => {
  const { c, h } = ctx();
  assert.match(await h.parar_de_acompanhar({}), /Nenhuma sessão/);
  assert.match(await h.acompanhar_sessao({ projeto: 'meu-app' }), /Acompanhando o Claude de meu-app \(sessão nº 1/);
  assert.deepEqual(c.watcher.list(), [{ id: 's1', label: 'Claude de meu-app' }]);
  assert.match(await h.sessoes_abertas({}), /nº 1 .* acompanhando/);
  assert.match(await h.acompanhar_sessao({ projeto: 'agendarse' }), /já foi encerrada/);
  assert.equal(c.watcher.isWatching('s2'), false);
  assert.match(await h.parar_de_acompanhar({}), /Parei de acompanhar o Claude de meu-app/);
  assert.deepEqual(c.watcher.list(), []);
});

test('parar_de_acompanhar escolhe a sessao quando ha mais de uma acompanhada', async () => {
  const { c, h } = ctx();
  c.watcher.watch('s1', 'Claude de meu-app');
  c.watcher.watch('outra', 'Codex de x');
  assert.match(await h.parar_de_acompanhar({ projeto: 'meu-app' }), /Parei de acompanhar o Claude de meu-app/);
  assert.deepEqual(c.watcher.list(), [{ id: 'outra', label: 'Codex de x' }]);
});

test('iniciar_sessao com tarefa acompanha sozinho; sem tarefa ou no shell, nao', async () => {
  const { c, h } = ctx();
  assert.match(await h.iniciar_sessao({ projeto: 'meu-app', agente: 'claude', tarefa: 'rode os testes' }), /aviso quando terminar ou der erro/);
  assert.deepEqual(c.watcher.list(), [{ id: 'novo', label: 'Claude de meu-app' }]);
  c.watcher.unwatch('novo');
  assert.doesNotMatch(await h.iniciar_sessao({ projeto: 'meu-app', agente: 'claude' }), /acompanhar/);
  assert.doesNotMatch(await h.iniciar_sessao({ projeto: 'meu-app', agente: 'claude', tarefa: '  ' }), /acompanhar/);
  assert.doesNotMatch(await h.iniciar_sessao({ projeto: 'meu-app', agente: 'shell', tarefa: 'ls' }), /acompanhar/);
  assert.deepEqual(c.watcher.list(), []);
});

test('enviar_para_sessao volta a acompanhar uma sessao ja acompanhada, mas nao outras', async () => {
  let now = 0;
  const alive: SessionInfo = { id: 's1', projectPath: '/w/meu-app', agent: 'claude', title: 't', startedAt: '2026-11-02T10:00:00Z', alive: true };
  const watcher = new SessionWatcher({ sessions: () => [alive], output: () => 'Pronto.', now: () => now });
  const { c, h } = ctx({ watcher });
  assert.doesNotMatch(await h.enviar_para_sessao({ projeto: 'meu-app', mensagem: 'oi' }), /acompanhando/);
  assert.deepEqual(c.watcher.list(), [], 'sessao nunca acompanhada continua sem acompanhamento');
  c.watcher.watch('s1', 'Claude de meu-app');
  // Ja avisou que terminou: sai da lista, mas fica lembrada.
  now += 31_000;
  assert.equal(c.watcher.reports().length, 1);
  assert.deepEqual(c.watcher.list(), []);
  assert.match(await h.enviar_para_sessao({ projeto: 'meu-app', mensagem: 'agora roda os testes' }), /Continuo acompanhando/);
  assert.deepEqual(c.watcher.list(), [{ id: 's1', label: 'Claude de meu-app' }]);
  // Depois de parar de acompanhar, um recado novo nao acompanha mais.
  assert.match(await h.parar_de_acompanhar({ projeto: 'meu-app' }), /Parei de acompanhar/);
  assert.doesNotMatch(await h.enviar_para_sessao({ projeto: 'meu-app', mensagem: 'mais uma' }), /acompanhando/);
  assert.deepEqual(c.watcher.list(), []);
});

// Configuracoes por voz (mudar_configuracao).
const MODELS: Record<BrainProvider, BrainModel[]> = {
  claude: [{ id: 'opus', label: 'Opus 5.5' }, { id: 'sonnet', label: 'Sonnet 5.5' }, { id: 'haiku', label: 'Haiku 5.5' }, { id: 'claude-fable-5-1[1m]', label: 'Fable 5.1' }],
  codex: [{ id: 'gpt-6-sol', label: 'GPT-6-Sol' }, { id: 'gpt-6-luna', label: 'GPT-6-Luna' }],
};
function configCtx() {
  let choice: BrainChoice = { provider: 'claude', model: 'haiku' };
  let stt: 'local' | 'groq' = 'local';
  let groqModel = 'whisper-large-v3-turbo';
  let news = true;
  const updates: unknown[] = [];
  const brainChoice: BrainChoiceApi = {
    get: () => ({ ...choice }),
    models: async (p) => MODELS[p],
    view: async () => ({ ...choice, models: MODELS, errors: {} }),
    set: async (i) => {
      const provider = (i.provider ?? choice.provider) as BrainProvider;
      choice = { provider, model: (i.model as string | undefined) ?? (provider === 'claude' ? 'haiku' : MODELS[provider][0].id) };
      return { choice };
    },
  };
  const voiceSettings = {
    view: () => ({ stt, groqModel, groqKeyHint: null, pauses: {}, pauseDefaults: {} }) as never,
    update: async (i: { stt?: unknown; groqModel?: unknown }) => {
      updates.push(i);
      if (i.stt === 'groq') return { error: 'Cole a chave de API do Groq para usar a transcrição na nuvem.' };
      if (i.stt) stt = i.stt as 'local';
      if (i.groqModel) groqModel = i.groqModel as string;
      return { view: voiceSettings.view() };
    },
  };
  const autoNews = { enabled: () => news, set: (on: boolean) => void (news = on) };
  const c = ctx({ brainChoice, voiceSettings, autoNews });
  return { ...c, choice: () => choice, news: () => news, updates };
}

test('resolveConfigOption: acha a opcao pelo jeito de falar e avisa o que ficou ambiguo', () => {
  assert.equal(resolveConfigOption('as legendas').pick?.key, 'legendas');
  assert.equal(resolveConfigOption('legenda do jarvis').pick?.key, 'legendaJarvis');
  assert.equal(resolveConfigOption('a minha legenda').pick?.key, 'legendaUsuario');
  assert.equal(resolveConfigOption('o 3D').pick?.key, 'modo3d');
  assert.equal(resolveConfigOption('o modelo').pick?.key, 'modeloVoz');
  assert.equal(resolveConfigOption('modelo do groq').pick?.key, 'modeloTranscricao');
  assert.equal(resolveConfigOption('sons de clique').pick?.key, 'sons');
  assert.equal(resolveConfigOption('lengendas').pick?.key, 'legendas', 'tolera erro de transcricao');
  assert.equal(resolveConfigOption('papel de parede').pick, undefined);
  const voz = resolveConfigOption('voz');
  assert.equal(voz.pick, undefined);
  assert.ok(voz.candidates.length > 1, 'voz sozinha serve para varias opcoes');
});

test('spokenToggle: ligar, desligar e o que nao da para saber', () => {
  assert.equal(spokenToggle('ativa'), true);
  assert.equal(spokenToggle('ligar'), true);
  assert.equal(spokenToggle('desativar'), false);
  assert.equal(spokenToggle('não'), false);
  assert.equal(spokenToggle('tanto faz'), null);
});

test('mudar_configuracao: opcao simples da interface muda direto e confirma curto', async () => {
  const { h, ui } = configCtx();
  assert.match(await h.mudar_configuracao({ opcao: 'as legendas', valor: 'ativa' }), /Feito: liguei as legendas/);
  assert.match(await h.mudar_configuracao({ opcao: 'sons', valor: 'desliga' }), /desliguei os sons/);
  assert.match(await h.mudar_configuracao({ opcao: 'cor do jarvis', valor: 'azul' }), /ciano/);
  assert.deepEqual(ui, [
    { kind: 'setting', key: 'legendas', value: true },
    { kind: 'setting', key: 'sons', value: false },
    { kind: 'setting', key: 'cor', value: 'ciano' },
  ]);
});

test('mudar_configuracao: opcao inexistente ou ambigua pergunta e nao muda nada', async () => {
  const { h, ui } = configCtx();
  assert.match(await h.mudar_configuracao({ opcao: 'papel de parede', valor: 'liga' }), /Não há nas configurações.*Pergunte/);
  assert.match(await h.mudar_configuracao({ opcao: 'voz', valor: 'liga' }), /ambíguo.* ou .*Pergunte/);
  assert.match(await h.mudar_configuracao({ opcao: 'legendas', valor: 'talvez' }), /ligar ou desligar.*Pergunte/);
  assert.match(await h.mudar_configuracao({ opcao: 'cor', valor: 'furta-cor' }), /escolhas são: dourado, ciano/);
  assert.deepEqual(ui, []);
});

test('mudar_configuracao: agente e modelo da voz pedem confirmacao antes de mudar', async () => {
  const t = configCtx();
  assert.match(await t.h.mudar_configuracao({ opcao: 'agente', valor: 'Codex' }), /confirme com o usuário: trocar o agente que responde por voz para Codex\?.*recomeça do zero/);
  assert.deepEqual(t.choice(), { provider: 'claude', model: 'haiku' }, 'sem confirmar, nada muda');
  assert.match(await t.h.mudar_configuracao({ opcao: 'agente', valor: 'Codex', confirmado: true }), /quem responde é o Codex, com o modelo GPT-6-Sol/);
  assert.deepEqual(t.choice(), { provider: 'codex', model: 'gpt-6-sol' });
  // Modelo do outro provedor: troca os dois.
  assert.match(await t.h.mudar_configuracao({ opcao: 'modelo', valor: 'sonnet' }), /confirme.*Sonnet 5\.5 \(Claude\)/);
  assert.match(await t.h.mudar_configuracao({ opcao: 'modelo', valor: 'sonnet', confirmado: true }), /Claude, com o modelo Sonnet/);
  assert.deepEqual(t.choice(), { provider: 'claude', model: 'sonnet' });
  assert.match(await t.h.mudar_configuracao({ opcao: 'modelo', valor: 'fable', confirmado: true }), /Fable 5\.1/);
  assert.equal(t.choice().model, 'claude-fable-5-1[1m]');
  assert.match(await t.h.mudar_configuracao({ opcao: 'modelo', valor: 'fable' }), /Nada mudou: .*já está assim/);
  assert.match(await t.h.mudar_configuracao({ opcao: 'modelo', valor: 'gpt-9000' }), /Não achei o modelo.*Claude: Opus 5\.5.*Codex: GPT-6-Sol/);
  assert.match(await t.h.mudar_configuracao({ opcao: 'modelo' }), /modelos do plano são/);
});

test('mudar_configuracao: transcricao confirma, e o erro do servidor volta para o Jarvis explicar', async () => {
  const t = configCtx();
  assert.match(await t.h.mudar_configuracao({ opcao: 'transcrição', valor: 'nuvem' }), /confirme/);
  assert.deepEqual(t.updates, []);
  assert.match(await t.h.mudar_configuracao({ opcao: 'transcrição', valor: 'nuvem', confirmado: true }), /Não mudei .*chave de API do Groq/);
  assert.match(await t.h.mudar_configuracao({ opcao: 'modelo do groq', valor: 'mais preciso', confirmado: true }), /large v3 .*vale quando a transcrição estiver no Groq/);
  assert.match(await t.h.mudar_configuracao({ opcao: 'transcrição', valor: 'local' }), /já está assim/);
});

test('mudar_configuracao: noticias automaticas mudam direto no servidor', async () => {
  const t = configCtx();
  assert.match(await t.h.mudar_configuracao({ opcao: 'notícias automáticas', valor: 'desativa' }), /desliguei as notícias automáticas/);
  assert.equal(t.news(), false);
  assert.match(await t.h.mudar_configuracao({ opcao: 'notícias automáticas', valor: 'desliga' }), /já está assim/);
});

test('mudar_configuracao: escuta e atalho confirmam e so valem depois da resposta', async () => {
  const { h, ui } = configCtx();
  assert.match(await h.mudar_configuracao({ opcao: 'escuta ativa', valor: 'desliga' }), /confirme.*sem a escuta/);
  assert.deepEqual(ui, []);
  assert.match(await h.mudar_configuracao({ opcao: 'escuta ativa', valor: 'desliga', confirmado: true }), /assim que esta resposta terminar/);
  assert.deepEqual(ui, [{ kind: 'setting', key: 'escuta', value: false }]);
});

test('mudar_configuracao: sem o servico no servidor, avisa que nao da', async () => {
  const { h } = ctx();
  assert.match(await h.mudar_configuracao({ opcao: 'notícias automáticas', valor: 'liga' }), /não pode ser mudado por voz/);
  assert.match(await h.mudar_configuracao({ opcao: 'modelo', valor: 'sonnet' }), /não pode ser mudado por voz/);
});
