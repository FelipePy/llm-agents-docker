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
