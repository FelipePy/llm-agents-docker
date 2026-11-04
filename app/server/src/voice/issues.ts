// Issues pedidas por voz: entram na secao Pendentes do ISSUES.md do repositorio do
// Jarvis, com commit so desse arquivo (alteracoes nao salvas impedem aplicar uma evolucao).

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunResult } from '../evolution.ts';

export interface IssueDeps {
  /** Repositorio do Jarvis, onde fica o ISSUES.md. */
  repoDir: string;
  run(cmd: string, args: string[], opts: { cwd: string; timeoutMs?: number }): Promise<RunResult>;
}

const FILE = 'ISSUES.md';
const COMMIT_TIMEOUT_MS = 30_000;

/** O texto com a issue nova no fim de Pendentes, sob o proximo numero. Texto ditado nao cria titulos no arquivo. */
export function appendIssue(markdown: string, title: string, description: string): { number: number; title: string; markdown: string } {
  const cleanTitle = title.replace(/\s+/g, ' ').trim().replace(/^#+\s*/, '');
  const cleanDescription = description.replace(/\r/g, '').replace(/^[ \t]*#+[ \t]*/gm, '').trim();
  if (!cleanTitle || !cleanDescription) throw new Error('faltou o título ou a descrição');
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^##\s+Pendentes\s*$/.test(l));
  if (start < 0) throw new Error(`o ${FILE} não tem a seção Pendentes`);
  const next = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  const end = next < 0 ? lines.length : next;
  const number = Math.max(0, ...[...markdown.matchAll(/^###\s+(\d+)\./gm)].map((m) => Number(m[1]))) + 1;
  const entry = `### ${number}. ${cleanTitle}\n${cleanDescription}\n\n**Situação:** pendente.`;
  const rest = lines.slice(end).join('\n');
  return {
    number,
    title: cleanTitle,
    markdown: `${lines.slice(0, end).join('\n').trimEnd()}\n\n${entry}\n${rest ? `\n${rest}` : ''}`,
  };
}

export class IssueLog {
  private readonly deps: IssueDeps;
  /** Uma gravacao por vez: duas ao mesmo tempo pegariam o mesmo numero. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: IssueDeps) {
    this.deps = deps;
  }

  /** Grava e faz o commit; devolve o numero. Se o commit falhar, o arquivo volta ao que era e o erro sobe. */
  create(title: string, description: string): Promise<number> {
    const job = this.queue.then(() => this.record(title, description));
    this.queue = job.catch(() => {});
    return job;
  }

  private async record(title: string, description: string): Promise<number> {
    const { repoDir, run } = this.deps;
    const file = join(repoDir, FILE);
    const before = await readFile(file, 'utf8').catch(() => {
      throw new Error(`não encontrei o ${FILE}`);
    });
    const issue = appendIssue(before, title, description);
    await writeFile(file, issue.markdown);
    // Com o caminho no fim, o commit leva so este arquivo, mesmo com outros no stage.
    const commit = await run('git', ['commit', '--quiet', '-m', `docs: add issue ${issue.number}: ${issue.title}`, '--', FILE], {
      cwd: repoDir,
      timeoutMs: COMMIT_TIMEOUT_MS,
    });
    if (commit.code !== 0) {
      await writeFile(file, before);
      throw new Error(`o commit falhou (${commit.out.trim().split('\n').slice(-3).join(' ') || `código ${commit.code}`})`);
    }
    return issue.number;
  }
}
