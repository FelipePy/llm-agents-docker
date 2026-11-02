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
const token = loadOrCreateToken(stateDir);

const app = createApp({
  home,
  port: Number(process.env.LLM_AGENT_UI_PORT ?? 7777),
  token,
  webDir: join(repo, 'app', 'web', 'dist'),
  bin: process.env.LLM_AGENT_BIN ?? join(repo, 'llm-agent'),
  extraOrigins: (process.env.LLM_AGENT_UI_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
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
