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
