// Processo do servidor da interface. Normalmente iniciado por "llm-agent ui".
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from './server.ts';
import { loadOrCreateToken } from './auth.ts';
import { watchPaths } from './watch.ts';
import { ClaudeBrain } from './voice/brain.ts';
import { WorkerProcess } from './voice/worker.ts';

const home = process.env.HOME;
if (!home) {
  console.error('llm-agent ui: HOME nao definido');
  process.exit(1);
}

const repo = resolve(import.meta.dirname, '..', '..', '..');
const stateDir =
  process.env.LLM_AGENT_UI_STATE_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'llm-agent', 'ui');
const workspaceDir = join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'llm-agent', 'workspace');
const token = loadOrCreateToken(stateDir);
mkdirSync(workspaceDir, { recursive: true });

// Voz: o worker Python so e preparado e iniciado quando a escuta e ligada.
const voiceWorker = new WorkerProcess({
  voiceDir: join(repo, 'app', 'voice'),
  env: { ...process.env },
  log: (line) => console.error(`[voz] ${line}`),
});
const brain = new ClaudeBrain({ model: process.env.LLM_AGENT_VOICE_MODEL || 'haiku', cwd: workspaceDir });

const app = createApp({
  home,
  port: Number(process.env.LLM_AGENT_UI_PORT ?? 7777),
  token,
  webDir: join(repo, 'app', 'web', 'dist'),
  bin: process.env.LLM_AGENT_BIN ?? join(repo, 'llm-agent'),
  extraOrigins: (process.env.LLM_AGENT_UI_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  workspaceDir,
  projectsDir: process.env.LLM_AGENT_PROJECTS_DIR || undefined,
  city: process.env.LLM_AGENT_UI_CITY || undefined,
  newsUrl: process.env.LLM_AGENT_UI_NEWS_RSS || undefined,
  voice: { worker: voiceWorker, brain },
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
  voiceWorker.stop();
  rmSync(serverJson, { force: true });
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
