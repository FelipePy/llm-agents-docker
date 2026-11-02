import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WorkerProcess } from '../src/voice/worker.ts';
import type { WorkerEvent } from '../src/voice/session.ts';
import { tempHome, waitFor, write } from './helpers.ts';

// "Python" falso, em Node, que fala o mesmo protocolo do worker.
const FAKE_PYTHON = `#!/usr/bin/env node
const send = (o) => { const p = Buffer.from(JSON.stringify(o)); const h = Buffer.alloc(5); h.write('J', 0); h.writeUInt32BE(p.length, 1); process.stdout.write(Buffer.concat([h, p])); };
let buf = Buffer.alloc(0), audio = 0;
send({ event: 'ready' });
process.stdin.on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  while (buf.length >= 5) {
    const size = buf.readUInt32BE(1);
    if (buf.length < 5 + size) break;
    const kind = String.fromCharCode(buf[0]), payload = buf.subarray(5, 5 + size);
    buf = buf.subarray(5 + size);
    if (kind === 'A') { audio += payload.length; if (audio >= 2560) { send({ event: 'wake', score: 1 }); audio = 0; } }
    else { const cmd = JSON.parse(payload); if (cmd.cmd === 'speak') send({ event: 'audio', id: cmd.id, data: 'QQ==', last: true }); if (cmd.cmd === 'die') process.exit(7); }
  }
});
`;

function voiceDir(setupScript = '#!/usr/bin/env bash\nexit 0\n'): string {
  const dir = join(tempHome(), 'voice');
  mkdirSync(join(dir, '.venv', 'bin'), { recursive: true });
  write(join(dir, '.venv', 'bin', 'python'), FAKE_PYTHON);
  chmodSync(join(dir, '.venv', 'bin', 'python'), 0o755);
  write(join(dir, 'setup.sh'), setupScript);
  chmodSync(join(dir, 'setup.sh'), 0o755);
  return dir;
}

test('WorkerProcess prepara, inicia e troca mensagens com o worker', async () => {
  const w = new WorkerProcess({ voiceDir: voiceDir(), env: { ...process.env }, log: () => {} });
  const events: WorkerEvent[] = [];
  w.on('event', (e: WorkerEvent) => events.push(e));
  try {
    await w.ensureReady();
    await w.ensureReady();
    w.command({ cmd: 'speak', id: 3, text: 'oi' });
    await waitFor(() => events.some((e) => e.event === 'audio'));
    assert.deepEqual(events.find((e) => e.event === 'audio'), { event: 'audio', id: 3, data: 'QQ==', last: true });
    w.sendAudio(Buffer.alloc(2560));
    await waitFor(() => events.some((e) => e.event === 'wake'));
    w.command({ cmd: 'die' } as never);
    await waitFor(() => events.some((e) => e.event === 'exit'));
    assert.deepEqual(events.find((e) => e.event === 'exit'), { event: 'exit', code: 7 });
  } finally {
    w.stop();
  }
});

test('WorkerProcess repassa a mensagem quando a preparacao falha', async () => {
  const dir = voiceDir('#!/usr/bin/env bash\necho "A voz precisa de Python 3.10 ou mais novo" >&2\nexit 2\n');
  const w = new WorkerProcess({ voiceDir: dir, env: { ...process.env }, log: () => {} });
  await assert.rejects(w.ensureReady(), /Python 3.10/);
  w.stop();
});
