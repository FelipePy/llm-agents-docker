import { EventEmitter } from 'node:events';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIO, FrameDecoder, JSON_KIND, encodeFrame, encodeJson } from './protocol.ts';
import type { VoiceWorker, WorkerCommand, WorkerEvent } from './session.ts';
import type { SttConfig } from './settings.ts';

export interface WorkerOptions {
  /** Pasta app/voice (setup.sh, .venv, jarvis_voice). */
  voiceDir: string;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
}

const lastLines = (text: string, n = 8): string => text.trim().split('\n').slice(-n).join('\n');

/**
 * Bibliotecas CUDA instaladas pelo setup.sh no ambiente (pacotes nvidia-*):
 * entram no LD_LIBRARY_PATH do worker para o whisper usar a GPU.
 */
export function withCudaLibraries(env: Record<string, string | undefined>, voiceDir: string): Record<string, string | undefined> {
  const libDir = join(voiceDir, '.venv', 'lib');
  const dirs: string[] = [];
  for (const python of safeList(libDir).filter((n) => n.startsWith('python3'))) {
    const nvidia = join(libDir, python, 'site-packages', 'nvidia');
    for (const pkg of safeList(nvidia)) {
      const lib = join(nvidia, pkg, 'lib');
      if (existsSync(lib)) dirs.push(lib);
    }
  }
  if (!dirs.length) return env;
  return { ...env, LD_LIBRARY_PATH: [...dirs, env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** Processo do worker Python: prepara o ambiente, inicia e troca mensagens. */
export class WorkerProcess extends EventEmitter implements VoiceWorker {
  private readonly opts: WorkerOptions;
  private proc: ChildProcess | undefined;
  private ready: Promise<void> | undefined;
  private stt: SttConfig = { provider: 'local' };
  private endMs: number | undefined;

  constructor(opts: WorkerOptions) {
    super();
    this.opts = opts;
  }

  ensureReady(): Promise<void> {
    this.ready ??= this.boot().catch((err) => {
      this.ready = undefined;
      throw err;
    });
    return this.ready;
  }

  command(cmd: WorkerCommand): void {
    this.write(encodeJson(cmd));
  }

  /** Troca quem transcreve; vale ja se o worker estiver rodando e a cada novo inicio. */
  configureStt(stt: SttConfig): void {
    this.stt = stt;
    this.command({ cmd: 'stt', ...stt });
  }

  /** Silencio que encerra a fala; vale ja se o worker estiver rodando e a cada novo inicio. */
  configurePauses(endMs: number): void {
    this.endMs = endMs;
    this.command({ cmd: 'pauses', end_ms: endMs });
  }

  sendAudio(pcm: Buffer): void {
    this.write(encodeFrame(AUDIO, pcm));
  }

  stop(): void {
    this.proc?.kill();
    this.proc = undefined;
    this.ready = undefined;
  }

  private write(data: Buffer): void {
    const stdin = this.proc?.stdin;
    if (stdin && !stdin.destroyed) stdin.write(data);
  }

  private emitEvent(e: WorkerEvent): void {
    this.emit('event', e);
  }

  private setup(): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        'bash',
        [join(this.opts.voiceDir, 'setup.sh')],
        { env: this.opts.env, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (stdout.trim()) this.opts.log(stdout.trim());
          if (stderr.trim()) this.opts.log(stderr.trim());
          if (err) reject(new Error(lastLines(stderr) || `a preparação da voz falhou (${err.message})`));
          else resolve();
        },
      );
    });
  }

  private async boot(): Promise<void> {
    this.emitEvent({ event: 'status', message: 'preparando a voz (a primeira vez demora)' });
    await this.setup();
    const proc = spawn(join(this.opts.voiceDir, '.venv', 'bin', 'python'), ['-u', '-m', 'jarvis_voice'], {
      cwd: this.opts.voiceDir,
      env: withCudaLibraries(this.opts.env, this.opts.voiceDir),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    const decoder = new FrameDecoder();
    let stderr = '';
    await new Promise<void>((resolve, reject) => {
      let isReady = false;
      proc.stdout!.on('data', (chunk: Buffer) => {
        for (const frame of decoder.push(chunk)) {
          if (frame.kind !== JSON_KIND) continue;
          let e: WorkerEvent;
          try {
            e = JSON.parse(frame.payload.toString('utf8'));
          } catch {
            continue;
          }
          if (e.event === 'ready' && !isReady) {
            isReady = true;
            this.command({ cmd: 'stt', ...this.stt });
            if (this.endMs !== undefined) this.command({ cmd: 'pauses', end_ms: this.endMs });
            resolve();
          }
          this.emitEvent(e);
        }
      });
      proc.stderr!.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stderr = (stderr + text).slice(-8000);
        this.opts.log(text.trimEnd());
      });
      proc.stdin!.on('error', () => {});
      proc.on('error', (err) => {
        if (!isReady) reject(err);
      });
      proc.on('exit', (code) => {
        if (this.proc === proc) {
          this.proc = undefined;
          this.ready = undefined;
        }
        if (!isReady) reject(new Error(lastLines(stderr) || `o worker de voz saiu com código ${code}`));
        else this.emitEvent({ event: 'exit', code });
      });
    });
  }
}
