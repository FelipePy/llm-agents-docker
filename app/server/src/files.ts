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
