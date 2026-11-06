// Issues pedidas por voz: entram na secao Pendentes do ISSUES.md na pasta do repositorio
// do Jarvis. O arquivo e local (fora do git): gravar nao gera commit nem impede aplicar uma evolucao.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface IssueDeps {
  /** Repositorio do Jarvis, onde fica o ISSUES.md. */
  repoDir: string;
}

const FILE = 'ISSUES.md';
/** Um clone novo nao traz o arquivo: a primeira issue o cria. */
const EMPTY = '# Issues\n\nTarefas do projeto, só neste arquivo local (fora do Git). Uma issue concluída é apagada desta lista.\n\n## Pendentes\n';

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

  /** Grava no arquivo e devolve o numero. Se nao conseguir, o erro sobe. */
  create(title: string, description: string): Promise<number> {
    const job = this.queue.then(() => this.record(title, description));
    this.queue = job.catch(() => {});
    return job;
  }

  private async record(title: string, description: string): Promise<number> {
    const file = join(this.deps.repoDir, FILE);
    const before = await readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return EMPTY;
      throw new Error(`não consegui ler o ${FILE}`);
    });
    const issue = appendIssue(before, title, description);
    await writeFile(file, issue.markdown).catch(() => {
      throw new Error(`não consegui gravar o ${FILE}`);
    });
    return issue.number;
  }
}
