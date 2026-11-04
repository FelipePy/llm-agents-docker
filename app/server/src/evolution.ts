// Evolucao do Jarvis por voz: o usuario define uma funcionalidade nova
// conversando com ele, aprova o resumo (dois "ok" em turnos diferentes) e uma
// sessao do Claude a desenvolve em background, num clone separado do
// repositorio. Pronta, ela so e aplicada com o "sim" do usuario: verificacoes
// no clone, merge no repositorio, reinicio verificado (app/restart.sh) e
// volta automatica para a versao anterior se algo falhar.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionInfo } from './types.ts';
import { normalize } from './voice/text.ts';

export type EvolutionState = 'rascunho' | 'aguardando_ok' | 'desenvolvendo' | 'pronto' | 'parado' | 'aplicando';

export interface Evolution {
  title: string;
  /** Especificacao combinada na conversa: e o que a sessao de desenvolvimento recebe. */
  spec: string;
  /** Resumo lido ao usuario antes do segundo "ok". */
  summary?: string;
  state: EvolutionState;
  /** Turno do usuario em que o resumo foi lido (o "pode comecar" tem de vir depois). */
  summarizedTurn?: number;
  slug?: string;
  branch?: string;
  dir?: string;
  /** Commit do repositorio de onde o clone partiu. */
  base?: string;
  sessionId?: string;
  startedAt?: string;
  /** O que a sessao diz que fez (.jarvis/summary.txt). */
  result?: string;
  /** O aviso de "terminei" (ou de "parou") ja foi falado. */
  notified?: boolean;
  /** Ultima falha ao aplicar. */
  error?: string;
}

/** O que fica para o servidor novo anunciar depois do reinicio (app/restart.sh completa). */
export interface UpdateRecord {
  from: string;
  to: string;
  title: string;
  summary: string;
  startedAt: string;
  desktop: boolean;
  announced: boolean;
  rolledBack?: boolean;
  error?: string;
  checks?: SelfCheck[];
  /** Quando o /api/self-check gravou as verificacoes. */
  checkedAt?: string;
}

export interface SelfCheck {
  name: string;
  ok: boolean;
  ms: number;
  essential: boolean;
  error?: string;
}

export interface RunResult {
  code: number;
  out: string;
}

export interface EvolutionDeps {
  /** Repositorio do Jarvis (onde o servidor roda). */
  repoDir: string;
  /** Onde ficam os clones de desenvolvimento. */
  devRoot: string;
  stateFile: string;
  updateFile: string;
  run(cmd: string, args: string[], opts: { cwd: string; timeoutMs?: number }): Promise<RunResult>;
  openSession(dir: string, prompt: string, title: string): SessionInfo;
  sessions(): SessionInfo[];
  sessionOutput(id: string): string | null;
  closeSession(id: string): void;
  /** Dispara o reinicio verificado (processo separado); `from` e o commit para voltar se falhar. */
  restart(from: string): void;
  /** Python do ambiente de voz, para os testes do worker (se existir). */
  voicePython?: string;
  now?: () => Date;
}

const SUMMARY_FILE = join('.jarvis', 'summary.txt');
const tail = (text: string, lines = 12): string => text.trim().split('\n').slice(-lines).join('\n');

export function slugify(title: string): string {
  return (
    normalize(title)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'funcionalidade'
  );
}

export function devPrompt(e: Evolution): string {
  return [
    `Você vai implementar uma funcionalidade nova no próprio Jarvis (este repositório), em background: "${e.title}".`,
    'O usuário já aprovou a especificação abaixo. Não pare para perguntar: quando algo não estiver definido, escolha o mais simples e anote a decisão nos commits.',
    '',
    'Especificação aprovada (também em .jarvis/spec.md):',
    e.spec,
    '',
    'Como trabalhar:',
    '- Siga o CLAUDE.md da raiz: arquitetura, receita de comandos de voz, testes e regras do projeto.',
    `- Trabalhe só nesta pasta, na branch atual (${e.branch}). Faça commits pequenos, com testes. Não faça push.`,
    '- Antes de terminar, rode todas as verificações do CLAUDE.md e deixe todas passando.',
    `- Por último, com tudo commitado, escreva em ${SUMMARY_FILE} uma ou duas frases em português dizendo o que o Jarvis passou a fazer (ele vai falar isso ao usuário). Não crie esse arquivo antes de terminar.`,
  ].join('\n');
}

export class EvolutionManager {
  private current: Evolution | undefined;
  private readonly deps: EvolutionDeps;
  private readonly now: () => Date;

  constructor(deps: EvolutionDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
    try {
      this.current = JSON.parse(readFileSync(deps.stateFile, 'utf8'));
    } catch {
      this.current = undefined;
    }
    // "aplicando" ao abrir: ou o reinicio desta aplicacao acabou de acontecer
    // (ha um update a anunciar), ou ela foi interrompida e volta a "pronto".
    if (this.current?.state === 'aplicando') {
      const u = readUpdate(deps.updateFile);
      if (!u || u.announced || u.title !== this.current.title) this.current.state = 'pronto';
    }
  }

  get(): Evolution | undefined {
    return this.current && { ...this.current };
  }

  /** Grava ou atualiza a proposta em definicao. Mudar depois do resumo exige um resumo novo. */
  draft(title: string, spec: string): string {
    const e = this.current;
    if (e && !['rascunho', 'aguardando_ok'].includes(e.state)) {
      return `Já existe uma funcionalidade em andamento ("${e.title}", ${e.state}). Ela precisa ser aplicada ou descartada antes de definir outra.`;
    }
    if (!title.trim() || !spec.trim()) throw new Error('título e especificação são obrigatórios');
    this.current = { title: title.trim(), spec: spec.trim(), state: 'rascunho' };
    this.save();
    return 'Proposta guardada. Continue a definição com o usuário; quando ele disser que está tudo certo, leia o resumo com resumir_evolucao.';
  }

  /** Primeiro "ok": o resumo vai ser lido ao usuario; o inicio so vale num turno seguinte. */
  summarize(summary: string, turn: number): string {
    const e = this.current;
    if (!e || !['rascunho', 'aguardando_ok'].includes(e.state)) return 'Não há proposta em definição. Comece com rascunhar_evolucao.';
    e.summary = summary.trim();
    e.state = 'aguardando_ok';
    e.summarizedTurn = turn;
    this.save();
    return `Leia este resumo ao usuário, com suas palavras, e pergunte se pode começar. Não chame iniciar_evolucao agora: espere a resposta dele.\n\n${e.summary}`;
  }

  /** Segundo "ok": cria o clone e abre a sessao de desenvolvimento em background. */
  async start(turn: number): Promise<string> {
    const e = this.current;
    if (!e || e.state === 'rascunho') return 'Ainda não li o resumo ao usuário. Use resumir_evolucao e espere ele aprovar.';
    if (e.state !== 'aguardando_ok') return `A funcionalidade "${e.title}" já está ${e.state}.`;
    if (e.summarizedTurn === undefined || turn <= e.summarizedTurn) {
      return 'O usuário ainda não respondeu ao resumo. Leia o resumo e espere ele dizer que pode começar.';
    }
    const { repoDir, devRoot, run } = this.deps;
    const base = (await this.git(repoDir, ['rev-parse', 'HEAD'])).trim();
    let slug = slugify(e.title);
    for (let i = 2; existsSync(join(devRoot, slug)); i++) slug = `${slugify(e.title)}-${i}`;
    const dir = join(devRoot, slug);
    const branch = `jarvis/${slug}`;
    mkdirSync(devRoot, { recursive: true });
    const cloned = await run('git', ['clone', '--quiet', '--local', repoDir, dir], { cwd: devRoot });
    if (cloned.code !== 0) throw new Error(`não consegui copiar o repositório: ${tail(cloned.out, 3)}`);
    await this.git(dir, ['checkout', '--quiet', '-b', branch, base]);
    // Sem remoto: a sessao nao tem para onde fazer push.
    await this.git(dir, ['remote', 'remove', 'origin']);
    mkdirSync(join(dir, '.jarvis'), { recursive: true });
    Object.assign(e, { slug, dir, branch, base, startedAt: this.now().toISOString(), notified: false, error: undefined });
    writeFileSync(join(dir, '.jarvis', 'spec.md'), `# ${e.title}\n\n${e.spec}\n`);
    const session = this.deps.openSession(dir, devPrompt(e), `Jarvis: ${e.title}`);
    e.sessionId = session.id;
    e.state = 'desenvolvendo';
    this.save();
    return `Comecei "${e.title}" em background, numa cópia separada do Jarvis. Diga ao usuário, em poucas palavras, que você avisa quando terminar e que ele pode continuar conversando.`;
  }

  async status(): Promise<string> {
    const e = this.current;
    if (!e) return 'Nenhuma funcionalidade nova em definição ou em desenvolvimento.';
    switch (e.state) {
      case 'rascunho':
        return `Em definição: "${e.title}". Especificação até agora:\n${e.spec}`;
      case 'aguardando_ok':
        return `"${e.title}" espera o usuário aprovar o resumo: ${e.summary}`;
      case 'desenvolvendo': {
        const out = e.sessionId ? this.deps.sessionOutput(e.sessionId) : null;
        const commits = await this.commits(e);
        const recent = out ? tail(out.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ''), 6) : '';
        return `"${e.title}" está em desenvolvimento desde ${e.startedAt} (${commits} commits até agora).${recent ? `\nÚltimas linhas da sessão:\n${recent}` : ''}`;
      }
      case 'pronto':
        return `"${e.title}" está pronta: ${e.result ?? ''}${e.error ? `\nA última tentativa de aplicar falhou: ${e.error}` : ''}\nPara aplicar, o usuário precisa confirmar.`;
      case 'parado':
        return `A sessão que desenvolvia "${e.title}" terminou sem concluir. Dá para descartar ou abrir outra sessão na mesma pasta (${e.dir}).`;
      case 'aplicando':
        return `"${e.title}" está sendo verificada e aplicada agora.`;
    }
  }

  /**
   * Chamado de tempos em tempos: percebe quando a sessao terminou (resumo
   * escrito e commits feitos) ou parou. Devolve o aviso a falar, ate ser entregue.
   */
  async poll(): Promise<string | null> {
    const e = this.current;
    if (!e) return null;
    if (e.state === 'desenvolvendo' && e.dir) {
      const summaryPath = join(e.dir, SUMMARY_FILE);
      const alive = this.deps.sessions().some((s) => s.id === e.sessionId && s.alive);
      if (existsSync(summaryPath) && (await this.commits(e)) > 0) {
        e.result = readFileSync(summaryPath, 'utf8').trim().slice(0, 400);
        e.state = 'pronto';
        e.notified = false;
        this.save();
      } else if (!alive) {
        e.state = 'parado';
        e.notified = false;
        this.save();
      }
    }
    if (e.notified) return null;
    if (e.state === 'pronto') return `Terminei de desenvolver "${e.title}": ${e.result} Quer que eu aplique agora?`;
    if (e.state === 'parado') return `A sessão que desenvolvia "${e.title}" parou antes de terminar. Quer que eu descarte, ou prefere olhar a sessão?`;
    return null;
  }

  markNotified(): void {
    if (this.current) {
      this.current.notified = true;
      this.save();
    }
  }

  /**
   * Terceiro "sim": confere o que impede a aplicacao e, se nada impedir,
   * verifica e aplica em background. `notify` recebe o resultado quando ele
   * nao termina num reinicio (falha nas verificacoes ou no merge).
   */
  async apply(opts: { closeSessions?: boolean }, notify: (text: string) => void): Promise<string> {
    const e = this.current;
    if (!e || e.state !== 'pronto' || !e.dir || !e.base) return e ? `"${e.title}" não está pronta para aplicar (${e.state}).` : 'Não há funcionalidade pronta para aplicar.';
    const dirty = (await this.git(this.deps.repoDir, ['status', '--porcelain', '--untracked-files=no'])).trim();
    if (dirty) return `Não apliquei: o repositório do Jarvis tem alterações não salvas (${dirty.split('\n').length} arquivo(s)). Elas precisam ser commitadas ou descartadas antes.`;
    if ((await this.commits(e)) === 0) return 'A sessão não deixou nenhum commit para aplicar.';
    const others = this.deps.sessions().filter((s) => s.alive && s.id !== e.sessionId);
    if (others.length && !opts.closeSessions) {
      return `Aplicar reinicia o Jarvis e fecha ${others.length} sessão(ões) aberta(s): ${others.map((s) => s.title).join('; ')} (as conversas continuam no histórico). Pergunte ao usuário se pode; se ele concordar, chame aplicar_evolucao com confirmar_fechar_sessoes.`;
    }
    e.state = 'aplicando';
    e.error = undefined;
    this.save();
    void this.applyInBackground(e).catch((err: Error) => {
      e.state = 'pronto';
      e.error = err.message;
      this.save();
      notify(`Não apliquei "${e.title}": ${err.message} Quer que eu peça a correção para a sessão de desenvolvimento?`);
    });
    return 'Comecei a verificar e aplicar. Leva alguns minutos; se tudo passar, eu reinicio e aviso quando voltar. Diga isso ao usuário em poucas palavras.';
  }

  private async applyInBackground(e: Evolution): Promise<void> {
    const dir = e.dir!;
    const { run, repoDir } = this.deps;
    for (const pkg of ['app/server', 'app/web']) {
      if (!existsSync(join(dir, pkg, 'node_modules'))) await this.must(dir, 'dependências', 'npm', ['--prefix', pkg, 'ci', '--silent']);
    }
    await this.must(dir, 'testes do servidor', 'npm', ['--prefix', 'app/server', 'test']);
    await this.must(dir, 'tipos do servidor', 'npm', ['--prefix', 'app/server', 'run', 'typecheck']);
    await this.must(dir, 'testes da interface', 'npm', ['--prefix', 'app/web', 'test']);
    await this.must(dir, 'tipos da interface', 'npm', ['--prefix', 'app/web', 'run', 'typecheck']);
    await this.must(dir, 'compilação da interface', 'npm', ['--prefix', 'app/web', 'run', 'build']);
    if (this.deps.voicePython && existsSync(this.deps.voicePython)) {
      await this.must(dir, 'testes do worker de voz', this.deps.voicePython, ['-m', 'unittest', 'discover', '-s', 'app/voice/tests', '-t', 'app/voice']);
    }
    const from = (await this.git(repoDir, ['rev-parse', 'HEAD'])).trim();
    await this.git(repoDir, ['fetch', '--quiet', dir, e.branch!]);
    const ff = await run('git', ['merge', '--ff-only', '--quiet', 'FETCH_HEAD'], { cwd: repoDir });
    if (ff.code !== 0) {
      const merged = await run('git', ['merge', '--no-edit', '-m', `Jarvis: ${e.title}`, 'FETCH_HEAD'], { cwd: repoDir });
      if (merged.code !== 0) {
        await run('git', ['merge', '--abort'], { cwd: repoDir });
        throw new Error('o código novo conflita com mudanças feitas no Jarvis enquanto ela era desenvolvida.');
      }
    }
    const to = (await this.git(repoDir, ['rev-parse', 'HEAD'])).trim();
    const changed = (await this.git(repoDir, ['diff', '--name-only', from, to])).split('\n');
    for (const pkg of ['app/server', 'app/web']) {
      // Na instalacao do app desktop a interface vem sem node_modules (so o dist).
      if (changed.includes(`${pkg}/package-lock.json`) || !existsSync(join(repoDir, pkg, 'node_modules'))) await this.must(repoDir, 'dependências', 'npm', ['--prefix', pkg, 'ci', '--silent']);
    }
    await this.must(repoDir, 'compilação da interface', 'npm', ['--prefix', 'app/web', 'run', 'build']);
    const update: UpdateRecord = {
      from,
      to,
      title: e.title,
      summary: e.result ?? '',
      startedAt: this.now().toISOString(),
      desktop: changed.some((f) => f.startsWith('app/desktop/')),
      announced: false,
    };
    writeFileSync(this.deps.updateFile, JSON.stringify(update, null, 2) + '\n', { mode: 0o600 });
    this.deps.restart(from);
  }

  /** Depois do reinicio que deu certo: apaga o clone e encerra a evolucao. */
  finish(): void {
    const e = this.current;
    if (!e || e.state !== 'aplicando') return;
    if (e.dir) rmSync(e.dir, { recursive: true, force: true });
    this.current = undefined;
    this.save();
  }

  /** Depois de um reinicio que voltou atras: a funcionalidade continua pronta para corrigir. */
  rolledBack(error: string): void {
    const e = this.current;
    if (!e || e.state !== 'aplicando') return;
    e.state = 'pronto';
    e.error = error;
    e.notified = true;
    this.save();
  }

  async discard(): Promise<string> {
    const e = this.current;
    if (!e) return 'Não há nada para descartar.';
    if (e.state === 'aplicando') return 'Ela está sendo aplicada agora; espere o resultado.';
    if (e.sessionId && this.deps.sessions().some((s) => s.id === e.sessionId && s.alive)) this.deps.closeSession(e.sessionId);
    if (e.dir) rmSync(e.dir, { recursive: true, force: true });
    this.current = undefined;
    this.save();
    return `Descartei "${e.title}".`;
  }

  private async commits(e: Evolution): Promise<number> {
    if (!e.dir || !e.base || !existsSync(e.dir)) return 0;
    const r = await this.deps.run('git', ['rev-list', '--count', `${e.base}..HEAD`], { cwd: e.dir });
    return r.code === 0 ? Number(r.out.trim()) || 0 : 0;
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    const r = await this.deps.run('git', args, { cwd });
    if (r.code !== 0) throw new Error(`git ${args[0]} falhou: ${tail(r.out, 3)}`);
    return r.out;
  }

  private async must(cwd: string, name: string, cmd: string, args: string[]): Promise<void> {
    const r = await this.deps.run(cmd, args, { cwd, timeoutMs: 10 * 60e3 });
    if (r.code !== 0) throw new Error(`a verificação "${name}" falhou:\n${tail(r.out)}`);
  }

  private save(): void {
    mkdirSync(join(this.deps.stateFile, '..'), { recursive: true });
    if (this.current) writeFileSync(this.deps.stateFile, JSON.stringify(this.current, null, 2) + '\n', { mode: 0o600 });
    else rmSync(this.deps.stateFile, { force: true });
  }
}

/** Le o registro do ultimo update (escrito antes do reinicio e completado pelo restart.sh). */
export function readUpdate(file: string): UpdateRecord | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as UpdateRecord;
  } catch {
    return null;
  }
}

export function markUpdateAnnounced(file: string): void {
  const u = readUpdate(file);
  if (u) writeFileSync(file, JSON.stringify({ ...u, announced: true }, null, 2) + '\n', { mode: 0o600 });
}

const CHECK_LABEL: Record<string, string> = {
  catalogo: 'os projetos',
  ferramentas: 'as ferramentas',
  voz: 'a voz',
  cerebro: 'o cérebro',
  web: 'a interface',
};

/** Tempo que o restart.sh tem para voltar a versao anterior depois de uma verificacao falhar. */
export const ROLLBACK_GRACE_MS = 120_000;

/**
 * O que fazer com o update ao abrir/periodicamente: esperar, anunciar o sucesso, anunciar a volta a
 * versao anterior ou, se uma verificacao essencial falhou e ninguem voltou atras, anunciar a falha.
 */
export function updateOutcome(u: UpdateRecord | null, now = Date.now()): 'wait' | 'ok' | 'rolledBack' | 'failed' {
  if (!u || u.announced) return 'wait';
  if (u.rolledBack) return 'rolledBack';
  if (!u.checks?.length) return 'wait';
  if (u.checks.every((c) => c.ok || !c.essential)) return 'ok';
  const at = u.checkedAt ? Date.parse(u.checkedAt) : NaN;
  return Number.isFinite(at) && now - at < ROLLBACK_GRACE_MS ? 'wait' : 'failed';
}

/** O que o Jarvis fala ao voltar de uma atualizacao (ou de uma volta a versao anterior). */
export function updateNotice(u: UpdateRecord): string {
  if (u.rolledBack) {
    const failed = u.checks?.find((c) => c.essential && !c.ok);
    const why = failed
      ? `: ${CHECK_LABEL[failed.name] ?? failed.name} não funcionou${failed.error ? ` (${failed.error})` : ''}`
      : u.error
        ? ` (${u.error})`
        : '';
    return `A atualização "${u.title}" não passou nas verificações${why}. Voltei para a versão anterior e está tudo funcionando como antes. Quer que eu peça a correção?`;
  }
  const essential = u.checks?.find((c) => c.essential && !c.ok);
  if (essential) {
    const label = CHECK_LABEL[essential.name] ?? essential.name;
    return `A atualização "${u.title}" foi aplicada e o código novo está no ar, mas uma verificação falhou: ${label}${essential.error ? ` (${essential.error})` : ''}. Não consegui voltar para a versão anterior sozinho; vale conferir ${label}.`;
  }
  const checks = u.checks ?? [];
  const ok = checks.filter((c) => c.ok).map((c) => CHECK_LABEL[c.name] ?? c.name);
  const bad = checks.filter((c) => !c.ok);
  const list = ok.length > 1 ? `${ok.slice(0, -1).join(', ')} e ${ok.at(-1)}` : ok[0] ?? '';
  let text = `Atualização aplicada com sucesso: ${u.summary || u.title}`.replace(/[.\s]*$/, '.');
  if (list) text += ` Verifiquei ${list}: ${bad.length ? 'o essencial está funcionando' : 'está tudo funcionando'}.`;
  for (const c of bad) text += ` Só ${CHECK_LABEL[c.name] ?? c.name} não respondeu${c.error ? ` (${c.error})` : ''}.`;
  if (u.desktop) text += ' A parte do app desktop só vale com um instalador novo.';
  return text;
}
