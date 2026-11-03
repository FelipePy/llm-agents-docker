import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tempHome } from './helpers.ts';
import { SpeakerProfileStore, average, cosine, emailHint, hashPassword, passwordMatches, type Mailer } from '../src/voice/speaker.ts';
import { buildMessage, parseSmtpUrl, plainAllowed, sendMail } from '../src/mail.ts';

const ME = [1, 0, 0];
const OTHER = [0, 1, 0];
/** Audio falso: o "conteudo" diz de quem e a voz (o embed falso le isso). */
const clip = (who: 'me' | 'other' | 'short') => Buffer.alloc(who === 'short' ? 1000 : 40_000, who).toString('base64');
const whoIs = (audio: string) => Buffer.from(audio, 'base64').toString('latin1', 0, 2);

function setup(opts: { mailer?: Mailer; now?: () => number } = {}) {
  const file = join(tempHome(), 'ui', 'voice-profile.json');
  const clips = new Map<number, number[] | null>();
  const make = () =>
    new SpeakerProfileStore({
      file,
      embed: async (audio) => audio.map((a) => (whoIs(a) === 'me' ? ME : whoIs(a) === 'ot' ? OTHER : null)),
      embedClip: async (c) => clips.get(c) ?? null,
      mailer: opts.mailer,
      now: opts.now,
    });
  return { file, clips, store: make(), make };
}

const four = (who: 'me' | 'other' = 'me') => [clip(who), clip(who), clip(who), clip(who)];

test('cosseno, media e senha', () => {
  assert.equal(cosine([1, 0], [2, 0]), 1);
  assert.equal(cosine([1, 0], [0, 3]), 0);
  assert.deepEqual(average([[2, 0], [0, 2]]).map((x) => +x.toFixed(4)), [0.7071, 0.7071]);
  const h = hashPassword('segredo123');
  assert.ok(!h.includes('segredo123'));
  assert.ok(passwordMatches('segredo123', h));
  assert.ok(!passwordMatches('segredo124', h));
  assert.equal(emailHint('felipe@example.com'), 'f…@example.com');
});

test('primeiro cadastro: 4 frases e senha de no minimo 8; arquivo 0600 sem a senha', async () => {
  const s = setup();
  assert.deepEqual(s.store.view(), { enrolled: false, enrolledAt: null, emailHint: null, emailRecovery: false });
  assert.equal(await s.store.verify(1), true, 'sem perfil, qualquer voz vale');
  assert.match(JSON.stringify(await s.store.enroll({ audio: four() })), /Defina uma senha/);
  assert.match(JSON.stringify(await s.store.enroll({ audio: four(), password: 'curta' })), /mínimo 8/);
  assert.match(JSON.stringify(await s.store.enroll({ audio: four().slice(1), password: 'senha-boa' })), /Grave as 4 frases/);
  assert.match(JSON.stringify(await s.store.enroll({ audio: [clip('me'), clip('short'), clip('me'), clip('me')], password: 'senha-boa' })), /frase 2 ficou curta/);
  assert.match(JSON.stringify(await s.store.enroll({ audio: [clip('me'), clip('me'), clip('other'), clip('me')], password: 'senha-boa' })), /frase 3 não parece da mesma voz/);
  assert.match(JSON.stringify(await s.store.enroll({ audio: four(), password: 'senha-boa', email: 'nada' })), /não parece válido/);
  assert.equal(s.store.enrolled(), false);

  const ok = await s.store.enroll({ audio: four(), password: 'senha-boa', email: 'felipe@example.com' });
  assert.ok('view' in ok && ok.view.enrolled && ok.view.emailHint === 'f…@example.com');
  assert.equal(statSync(s.file).mode & 0o777, 0o600);
  assert.ok(!readFileSync(s.file, 'utf8').includes('senha-boa'));
  assert.equal(s.make().enrolled(), true, 'perfil sobrevive ao reinicio');
});

test('verify compara o audio da ativacao com o perfil', async () => {
  const s = setup();
  await s.store.enroll({ audio: four(), password: 'senha-boa' });
  s.clips.set(1, [0.9, 0.1, 0]);
  s.clips.set(2, OTHER);
  assert.equal(await s.store.verify(1), true);
  assert.equal(await s.store.verify(2), false);
  assert.equal(await s.store.verify(3), false, 'trecho perdido ou curto demais nao passa');
  await assert.rejects(s.store.verify(undefined));
});

test('refazer a voz exige a senha atual; 5 erros bloqueiam', async () => {
  let now = 0;
  const s = setup({ now: () => now });
  await s.store.enroll({ audio: four(), password: 'senha-boa' });
  assert.match(JSON.stringify(await s.store.enroll({ audio: four() })), /Senha incorreta/);
  const ok = await s.store.enroll({ audio: four(), currentPassword: 'senha-boa', password: 'outra-senha' });
  assert.ok('view' in ok);
  for (let i = 0; i < 4; i++) await s.store.enroll({ audio: four(), currentPassword: 'errada!!' });
  assert.match(JSON.stringify(await s.store.enroll({ audio: four(), currentPassword: 'errada!!' })), /espere 5 minutos/);
  assert.match(JSON.stringify(await s.store.enroll({ audio: four(), currentPassword: 'outra-senha' })), /Muitas tentativas/);
  now += 5 * 60_000;
  assert.ok('view' in (await s.store.enroll({ audio: four(), currentPassword: 'outra-senha' })));
});

test('recuperar a senha pela voz cadastrada', async () => {
  const s = setup();
  await s.store.enroll({ audio: four(), password: 'senha-boa' });
  assert.match(JSON.stringify(await s.store.recoverByVoice({ audio: clip('other'), password: 'nova-senha' })), /Não reconheci/);
  assert.match(JSON.stringify(await s.store.recoverByVoice({ audio: clip('me'), password: 'curta' })), /mínimo 8/);
  assert.ok('view' in (await s.store.recoverByVoice({ audio: clip('me'), password: 'nova-senha' })));
  assert.ok('view' in (await s.store.enroll({ audio: four(), currentPassword: 'nova-senha' })));
});

test('recuperar a senha por codigo enviado ao e-mail', async () => {
  let now = 0;
  const mails: { to: string; text: string }[] = [];
  const s = setup({ now: () => now, mailer: async (to, _subject, text) => void mails.push({ to, text }) });
  await s.store.enroll({ audio: four(), password: 'senha-boa' });
  assert.match(JSON.stringify(await s.store.sendRecoveryEmail()), /Nenhum e-mail cadastrado/);
  await s.store.enroll({ audio: four(), currentPassword: 'senha-boa', email: 'felipe@example.com' });
  assert.equal(s.store.view().emailRecovery, true);
  assert.match(JSON.stringify(s.store.recoverByCode({ code: '000000', password: 'nova-senha' })), /Peça um código/);
  assert.deepEqual(await s.store.sendRecoveryEmail(), { sentTo: 'f…@example.com' });
  assert.match(JSON.stringify(await s.store.sendRecoveryEmail()), /espere um minuto/);
  const code = /\b(\d{6})\b/.exec(mails[0].text)![1];
  assert.equal(mails[0].to, 'felipe@example.com');
  assert.match(JSON.stringify(s.store.recoverByCode({ code: code === '111111' ? '222222' : '111111', password: 'nova-senha' })), /Código incorreto/);
  assert.ok('view' in s.store.recoverByCode({ code, password: 'nova-senha' }));
  assert.match(JSON.stringify(s.store.recoverByCode({ code, password: 'outra-senha' })), /Peça um código/, 'codigo vale uma vez');
  // Codigo vencido.
  now += 60_000;
  await s.store.sendRecoveryEmail();
  const late = /\b(\d{6})\b/.exec(mails[1].text)![1];
  now += 16 * 60_000;
  assert.match(JSON.stringify(s.store.recoverByCode({ code: late, password: 'outra-senha' })), /Peça um código/);
});

test('sem envio de e-mail configurado, a recuperacao e pela voz', async () => {
  const s = setup();
  await s.store.enroll({ audio: four(), password: 'senha-boa', email: 'felipe@example.com' });
  assert.equal(s.store.view().emailRecovery, false);
  assert.match(JSON.stringify(await s.store.sendRecoveryEmail()), /não está configurado/);
});

test('parseSmtpUrl e a mensagem', () => {
  const cfg = parseSmtpUrl('smtps://eu%40gmail.com:app%20pass@smtp.gmail.com');
  assert.deepEqual(cfg, { secure: true, host: 'smtp.gmail.com', port: 465, user: 'eu@gmail.com', pass: 'app pass', from: 'eu@gmail.com' });
  assert.equal(parseSmtpUrl('smtp://h:2525').port, 2525);
  assert.throws(() => parseSmtpUrl('http://x'));
  const msg = buildMessage(cfg, 'a@b.com', 'Código', 'olá', new Date(0));
  assert.match(msg, /Subject: =\?UTF-8\?B\?/);
  assert.ok(msg.includes(Buffer.from('olá').toString('base64')));
});

test('sendMail conversa com um servidor SMTP (local, sem TLS)', async () => {
  const got: string[] = [];
  const server = createServer((sock) => {
    sock.setEncoding('utf8');
    sock.write('220 ok\r\n');
    let data = false;
    let buf = '';
    sock.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        got.push(line);
        if (data) {
          if (line === '.') {
            data = false;
            sock.write('250 queued\r\n');
          }
          continue;
        }
        if (line.startsWith('EHLO')) sock.write('250-oi\r\n250 AUTH PLAIN\r\n');
        else if (line.startsWith('AUTH')) sock.write('235 ok\r\n');
        else if (line.startsWith('RCPT') && line.includes('ruim')) sock.write('550 nao existe\r\n');
        else if (line === 'DATA') {
          data = true;
          sock.write('354 manda\r\n');
        } else if (line === 'QUIT') sock.end('221 tchau\r\n');
        else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  const cfg = parseSmtpUrl(`smtp://eu:senha@127.0.0.1:${port}`, 'jarvis@example.com');
  await sendMail(cfg, 'felipe@example.com', 'Oi', 'codigo 123456');
  assert.ok(got.includes(`AUTH PLAIN ${Buffer.from('\0eu\0senha').toString('base64')}`));
  assert.ok(got.includes('MAIL FROM:<jarvis@example.com>'));
  assert.ok(got.includes('RCPT TO:<felipe@example.com>'));
  await assert.rejects(sendMail(cfg, 'ruim@example.com', 'Oi', 'x'), /550/);
  await assert.rejects(sendMail(cfg, 'a@b.com\r\nRCPT TO:<x@y>', 'Oi', 'x'), /inválido/);
  server.close();
});

test('SMTP sem TLS so vale no proprio PC', () => {
  assert.ok(plainAllowed('127.0.0.1') && plainAllowed('localhost'));
  assert.ok(!plainAllowed('smtp.gmail.com'));
});
