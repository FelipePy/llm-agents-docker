// Processo do servidor da interface. Normalmente iniciado por "jarvis ui".
import { mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createApp } from './server.ts';
import { loadOrCreateToken } from './auth.ts';
import { watchPaths } from './watch.ts';
import { ClaudeBrain, claudeJudge, claudeWatchSummary, claudeWebSearch } from './voice/brain.ts';
import { createJarvisServer } from './voice/tools.ts';
import { readProfile } from './catalog.ts';
import { WorkerProcess } from './voice/worker.ts';
import { VoiceSettingsStore, pauseConfig, sttConfig } from './voice/settings.ts';
import { JarvisMemory } from './voice/memory.ts';
import { NewsHistory } from './voice/news-history.ts';
import { AutoNewsSetting } from './voice/news-auto.ts';
import { parseSmtpUrl, sendMail } from './mail.ts';
import { DEFAULT_THRESHOLD, type Mailer } from './voice/speaker.ts';

const home = process.env.HOME;
if (!home) {
  console.error('jarvis ui: HOME nao definido');
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
// Manchetes ja apresentadas por voz (2 dias), para nao repetir.
const newsHistory = new NewsHistory(join(stateDir, 'jarvis-news.json'));
mkdirSync(workspaceDir, { recursive: true });

// Voz: o worker Python so e preparado e iniciado quando a escuta e ligada.
const voiceWorker = new WorkerProcess({
  voiceDir: join(repo, 'app', 'voice'),
  env: { ...process.env },
  log: (line) => console.error(`[voz] ${line}`),
});
// Transcricao local ou Groq e as pausas da fala, escolhidas no painel de configuracoes.
const voiceSettings = new VoiceSettingsStore(join(stateDir, 'voice.json'), {
  fetch,
  onChange: (s) => {
    voiceWorker.configureStt(sttConfig(s));
    voiceWorker.configurePauses(pauseConfig(s.pauses).endMs);
  },
});
voiceWorker.configureStt(sttConfig(voiceSettings.get()));
voiceWorker.configurePauses(pauseConfig(voiceSettings.get().pauses).endMs);
// Codigo de recuperacao da senha da voz por e-mail (opcional): smtps://usuario:senha@host:465.
let mailer: Mailer | undefined;
if (process.env.LLM_AGENT_SMTP_URL) {
  try {
    const smtp = parseSmtpUrl(process.env.LLM_AGENT_SMTP_URL, process.env.LLM_AGENT_SMTP_FROM);
    mailer = (to, subject, text) => sendMail(smtp, to, subject, text);
  } catch (err) {
    console.error(`LLM_AGENT_SMTP_URL inválida (${(err as Error).message}); recuperação da senha da voz só pela voz`);
  }
}
const speakerThreshold = Number(process.env.LLM_AGENT_VOICE_SPEAKER_THRESHOLD) || DEFAULT_THRESHOLD;
let brain: ClaudeBrain | undefined;
const voiceModel = process.env.LLM_AGENT_VOICE_MODEL || 'haiku';
const makeBrain = (ctx: Parameters<typeof createJarvisServer>[0]) =>
  (brain = new ClaudeBrain({
    model: voiceModel,
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

/** Comando com saida (stdout + stderr) e codigo, sem lancar erro. */
const run = (cmd: string, args: string[], o: { cwd: string; timeoutMs?: number }) =>
  new Promise<{ code: number; out: string }>((resolveRun) => {
    execFile(cmd, args, { cwd: o.cwd, timeout: o.timeoutMs ?? 120_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolveRun({ code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0, out: `${stdout}${stderr}` }),
    );
  });

/** Reinicio verificado depois de aplicar uma evolucao: processo separado, que sobrevive ao fim deste. */
function restartVerified(from: string): void {
  const log = openSync(join(stateDir, 'server.log'), 'a');
  spawn('setsid', ['bash', join(repo, 'app', 'restart.sh'), from], { detached: true, stdio: ['ignore', log, log], env: process.env }).unref();
}

/** O cerebro responde? (uma pergunta minima, numa sessao a parte) */
async function brainCheck(): Promise<void> {
  const check = new ClaudeBrain({ model: voiceModel, cwd: workspaceDir, systemPrompt: 'Responda apenas: ok' });
  try {
    let out = '';
    for await (const d of check.reply('Tudo certo?', AbortSignal.timeout(40_000))) out += d;
    if (!out.trim()) throw new Error('sem resposta');
  } finally {
    check.close();
  }
}

const app = createApp({
  home,
  port: Number(process.env.LLM_AGENT_UI_PORT ?? 7777),
  token,
  webDir: join(repo, 'app', 'web', 'dist'),
  bin: process.env.LLM_AGENT_BIN ?? join(repo, 'jarvis'),
  extraOrigins: (process.env.LLM_AGENT_UI_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  workspaceDir,
  projectsDir: process.env.LLM_AGENT_PROJECTS_DIR || undefined,
  city: process.env.LLM_AGENT_UI_CITY || undefined,
  newsUrl: process.env.LLM_AGENT_UI_NEWS_RSS || undefined,
  // Busca do Jarvis: DuckDuckGo + Wikipedia; se o DuckDuckGo bloquear, a busca do Claude (no plano).
  webSearchFallback: process.env.LLM_AGENT_VOICE_WEB_FALLBACK === '0' ? undefined : claudeWebSearch({ model: voiceModel, cwd: workspaceDir }),
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
    // Fala por cima da resposta que nao e clara: um segundo Claude decide se muda a resposta.
    judge: process.env.LLM_AGENT_VOICE_JUDGE === '0' ? undefined : claudeJudge({ model: voiceModel, cwd: workspaceDir }),
    // Aviso de sessao acompanhada que terminou ou deu erro, resumido por um Claude a parte.
    watchSummary: claudeWatchSummary({ model: voiceModel, cwd: workspaceDir }),
    // So a voz cadastrada ativa o Jarvis (conferida na ativacao).
    profile: { file: join(stateDir, 'voice-profile.json'), mailer, threshold: speakerThreshold },
  },
  manualPath: join(repo, 'README.md'),
  evolution: {
    repoDir: repo,
    devRoot: join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'llm-agent', 'jarvis-dev'),
    stateFile: join(stateDir, 'evolution.json'),
    updateFile: join(stateDir, 'update.json'),
    run,
    restart: restartVerified,
    voicePython: join(repo, 'app', 'voice', '.venv', 'bin', 'python'),
  },
  issues: { repoDir: repo },
  selfCheck: { brain: brainCheck },
  memory,
  newsHistory,
  autoNews: new AutoNewsSetting(join(stateDir, 'jarvis-news-auto.json')),
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
console.log(`jarvis ui ouvindo em http://127.0.0.1:${port}`);

/** Apaga o server.json so se ele for deste processo (outro servidor pode ter subido depois). */
function removeServerJson(): void {
  try {
    if (JSON.parse(readFileSync(serverJson, 'utf8')).pid === process.pid) rmSync(serverJson, { force: true });
  } catch {
    // ja nao existe
  }
}

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  // Se algo travar no encerramento, sai assim mesmo: um servidor meio-fechado segura a porta.
  setTimeout(() => {
    removeServerJson();
    process.exit(0);
  }, 3000);
  stopWatching();
  await app.close();
  voiceWorker.stop();
  brain?.close();
  removeServerJson();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
