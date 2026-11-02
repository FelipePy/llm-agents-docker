import { EventEmitter } from 'node:events';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { AUDIO, FrameDecoder, JSON_KIND, encodeFrame, encodeJson } from './protocol.ts';
import type { VoiceWorker, WorkerCommand, WorkerEvent } from './session.ts';

export interface WorkerOptions {
  /** Pasta app/voice (setup.sh, .venv, jarvis_voice). */
  voiceDir: string;
  env: Record<string, string | undefined>;
  log: (line: string) => void;
}

const lastLines = (text: string, n = 8): string => text.trim().split('\n').slice(-n).join('\n');

/** Processo do worker Python: prepara o ambiente, inicia e troca mensagens. */
export class WorkerProcess extends EventEmitter implements VoiceWorker {
  private readonly opts: WorkerOptions;
  private proc: ChildProcess | undefined;
  private ready: Promise<void> | undefined;

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
      env: this.opts.env,
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
