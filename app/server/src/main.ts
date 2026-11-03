// Processo do servidor da interface. Normalmente iniciado por "llm-agent ui".
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createApp } from './server.ts';
import { loadOrCreateToken } from './auth.ts';
import { watchPaths } from './watch.ts';
import { ClaudeBrain } from './voice/brain.ts';
import { createJarvisServer } from './voice/tools.ts';
import { readProfile } from './catalog.ts';
import { WorkerProcess } from './voice/worker.ts';
import { VoiceSettingsStore, sttConfig } from './voice/settings.ts';
import { JarvisMemory } from './voice/memory.ts';

const home = process.env.HOME;
if (!home) {
  console.error('llm-agent ui: HOME nao definido');
  process.exit(1);
}

const repo = resolve(import.meta.dirname, '..', '..', '..');
const DEFAULT_GREETINGS = [
  'Estou à disposição, senhor.',
  'Às suas ordens, senhor.',
  'Pois não, senhor?',
  'Sim, senhor?',
  'Em que posso ajudar, senhor?',
  'Pronto para ajudar, senhor.',
  'Aqui, senhor. O que precisa?',
];
const stateDir =
  process.env.LLM_AGENT_UI_STATE_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'llm-agent', 'ui');
const workspaceDir = join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'llm-agent', 'workspace');
const token = loadOrCreateToken(stateDir);
// Memoria do Jarvis entre sessoes (fatos e resumos de conversa).
const memory = new JarvisMemory(join(stateDir, 'jarvis-memory.json'));
mkdirSync(workspaceDir, { recursive: true });

// Voz: o worker Python so e preparado e iniciado quando a escuta e ligada.
const voiceWorker = new WorkerProcess({
  voiceDir: join(repo, 'app', 'voice'),
  env: { ...process.env },
  log: (line) => console.error(`[voz] ${line}`),
});
// Transcricao local ou Groq, escolhida no painel de configuracoes.
const voiceSettings = new VoiceSettingsStore(join(stateDir, 'voice.json'), {
  fetch,
  onChange: (s) => voiceWorker.configureStt(sttConfig(s)),
});
voiceWorker.configureStt(sttConfig(voiceSettings.get()));
let brain: ClaudeBrain | undefined;
const makeBrain = (ctx: Parameters<typeof createJarvisServer>[0]) =>
  (brain = new ClaudeBrain({
    model: process.env.LLM_AGENT_VOICE_MODEL || 'haiku',
    cwd: workspaceDir,
    mcp: () => createJarvisServer(ctx),
    // Memorias "sobre o usuario" que os agentes ja guardaram (nome, preferencias...).
    about: async () => {
      const memories = (await readProfile(home)).memories
        .map((f) => f.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim())
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 3000);
      const projects = (await ctx.projects()).map((p) => p.name).join(', ');
      const remembered = memory.render();
      return [
        memories,
        remembered && `O que você (Jarvis) guardou nas conversas anteriores (ids entre colchetes):\n${remembered}`,
        `Projetos do usuário (nomes exatos): ${projects || 'nenhum ainda'}.`,
      ]
        .filter(Boolean)
        .join('\n\n')
        .trim();
    },
  }));

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
  voice: {
    worker: voiceWorker,
    brain: makeBrain,
    bargeIn: process.env.LLM_AGENT_VOICE_BARGE_IN !== '0',
    // Saudacoes ao ser chamado sem pedido ("|" separa; vazio desliga).
    greetings: (process.env.LLM_AGENT_VOICE_GREETINGS ?? DEFAULT_GREETINGS.join('|')).split('|'),
    announce:
      process.env.LLM_AGENT_VOICE_ANNOUNCE === '0'
        ? undefined
        : { newsEveryMin: Math.max(15, Number(process.env.LLM_AGENT_VOICE_NEWS_EVERY_MIN) || 90) },
    settings: voiceSettings,
  },
  manualPath: join(repo, 'README.md'),
  memory,
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
  brain?.close();
  rmSync(serverJson, { force: true });
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
