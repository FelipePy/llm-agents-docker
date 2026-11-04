import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { EventEmitter } from 'node:events';
import { startApp } from './app.ts';
import type { VoiceWorker, WorkerCommand } from '../src/voice/session.ts';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempHome } from './helpers.ts';
import { SpeakerProfileStore, average, cosine, emailHint, hashPassword, passwordMatches, type Mailer } from '../src/voice/speaker.ts';
import { buildMessage, parseSmtpUrl, plainAllowed, sendMail } from '../src/mail.ts';

const ME = [1, 0, 0];
const OTHER = [0, 1, 0];
/** As chamadas curtas do usuario: a mesma voz, mas um vetor um pouco diferente do das frases. */
const ME_CALL = [0.6, 0, 0.8];
/** Audio falso: o "conteudo" diz de quem e a voz (o embed falso le isso). */
const clip = (who: 'me' | 'other' | 'short') => Buffer.alloc(who === 'short' ? 1000 : 40_000, who).toString('base64');
const whoIs = (audio: string) => Buffer.from(audio, 'base64').toString('latin1', 0, 2);

function setup(opts: { mailer?: Mailer; now?: () => number } = {}) {
  const file = join(tempHome(), 'ui', 'voice-profile.json');
  const clips = new Map<number, number[] | null>();
  const logs: string[] = [];
  const trims: boolean[] = [];
  const make = () =>
    new SpeakerProfileStore({
      file,
      embed: async (audio, o) => (trims.push(Boolean(o?.trim)), audio.map((a) => (whoIs(a) === 'me' ? (o?.trim ? ME_CALL : ME) : whoIs(a) === 'ot' ? OTHER : null))),
      embedClip: async (c) => clips.get(c) ?? null,
      mailer: opts.mailer,
      now: opts.now,
      log: (line) => logs.push(line),
    });
  return { file, clips, logs, trims, store: make(), make };
}

const four = (who: 'me' | 'other' = 'me') => [clip(who), clip(who), clip(who), clip(who)];
const three = (who: 'me' | 'other' = 'me') => [clip(who), clip(who), clip(who)];

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

test('primeiro cadastro: 4 frases e senha so de numeros, de 4 a 6 digitos; arquivo 0600 sem a senha', async () => {
  const s = setup();
  assert.deepEqual(s.store.view(), { enrolled: false, enrolledAt: null, emailHint: null, emailRecovery: false, calls: false, access: 'both', legacyPassword: false });
  assert.equal(await s.store.verify(1), true, 'sem perfil, qualquer voz vale');
  assert.match(JSON.stringify(await s.store.enroll({ audio: four(), calls: three() })), /Defina uma senha/);
  assert.match(JSON.stringify(await s.store.enroll({ audio: four(), calls: three(), password: 'abc12345' })), /só números/);
  assert.match(JSON.stringify(await s.store.enroll({ audio: four().slice(1), password: '482193' })), /Grave as 4 frases/);
  assert.match(JSON.stringify(await s.store.enroll({ audio: [clip('me'), clip('short'), clip('me'), clip('me')], password: '482193' })), /frase 2 ficou curta/);
  assert.match(JSON.stringify(await s.store.enroll({ audio: [clip('me'), clip('me'), clip('other'), clip('me')], calls: three(), password: '482193' })), /frase 3 não parece da mesma voz/);
  assert.match(JSON.stringify(await s.store.enroll({ audio: four(), calls: three(), password: '482193', email: 'nada' })), /não parece válido/);
  assert.equal(s.store.enrolled(), false);

  const ok = await s.store.enroll({ audio: four(), calls: three(), password: '482193', email: 'felipe@example.com' });
  assert.ok('view' in ok && ok.view.enrolled && ok.view.emailHint === 'f…@example.com');
  assert.equal(statSync(s.file).mode & 0o777, 0o600);
  assert.ok(!readFileSync(s.file, 'utf8').includes('482193'));
  for (const bad of ['12a456', '12 345', '12.345', '１２３４', '1234567', '123'])
    assert.match(JSON.stringify(await s.make().enroll({ audio: four(), calls: three(), currentPassword: '482193', password: bad })), /só números|de 4 a 6 dígitos/, bad);
  assert.equal(s.make().enrolled(), true, 'perfil sobrevive ao reinicio');
});

test('verify compara o audio da ativacao com o perfil', async () => {
  const s = setup();
  await s.store.enroll({ audio: four(), calls: three(), password: '482193' });
  s.clips.set(1, [0.9, 0.1, 0]);
  s.clips.set(2, OTHER);
  assert.equal(await s.store.verify(1), true);
  assert.equal(await s.store.verify(2), false);
  assert.equal(await s.store.verify(3), false, 'trecho perdido ou curto demais nao passa');
  await assert.rejects(s.store.verify(undefined));
  // Cada verificacao fica no log com a semelhanca, para calibrar o limiar.
  assert.match(s.logs[0], /^voz \(ativação \(\d+ ms\)\): semelhança 0\.99 \(chamadas 0\.60, frases 0\.99\), mínimo 0\.50 → aceita$/);
  assert.match(s.logs[1], /semelhança 0\.00 \(chamadas 0\.00, frases 0\.00\), mínimo 0\.50 → recusada/);
  assert.match(s.logs[2], /pouca fala no áudio para conferir → recusada/);
});

test('cadastro exige as 3 chamadas, sem o silencio, da mesma voz', async () => {
  const s = setup();
  const base = { audio: four(), password: '482193' };
  assert.match(JSON.stringify(await s.store.enroll(base)), /Grave as 3 chamadas/);
  assert.match(JSON.stringify(await s.store.enroll({ ...base, calls: three().slice(1) })), /Grave as 3 chamadas/);
  assert.match(JSON.stringify(await s.store.enroll({ ...base, calls: [clip('me'), clip('short'), clip('me')] })), /chamada 2 ficou curta/);
  assert.match(JSON.stringify(await s.store.enroll({ ...base, calls: [clip('me'), clip('me'), clip('other')] })), /chamada 3 não parece da mesma voz/);
  assert.equal(s.store.enrolled(), false);
  const ok = await s.store.enroll({ ...base, calls: three() });
  assert.ok('view' in ok && ok.view.calls);
  assert.deepEqual(s.trims.slice(-2), [false, true], 'frases inteiras; chamadas cortadas');
  assert.equal(s.make().view().calls, true, 'as chamadas ficam salvas no perfil');
});

test('ativacao parecida com as chamadas passa mesmo longe das frases', async () => {
  const s = setup();
  await s.store.enroll({ audio: four(), calls: three(), password: '482193' });
  // Perto das chamadas (0,6 / 0 / 0,8) e longe das frases (1 / 0 / 0): passa pelas chamadas.
  s.clips.set(1, [0.5, 0.1, 0.85]);
  assert.equal(await s.store.verify(1), true);
  assert.match(s.logs[0], /semelhança 0\.99 \(chamadas 0\.99, frases 0\.50\)/);
});

test('perfil antigo, sem chamadas: continua valendo so pelas frases', async () => {
  const s = setup();
  await s.store.enroll({ audio: four(), calls: three(), password: '482193' });
  const old = JSON.parse(readFileSync(s.file, 'utf8'));
  delete old.calls;
  writeFileSync(s.file, JSON.stringify(old));
  const store = s.make();
  assert.equal(store.view().calls, false, 'a tela sugere refazer a voz');
  s.clips.set(1, ME);
  assert.equal(await store.verify(1), true);
  assert.match(s.logs.at(-1)!, /semelhança 1\.00 \(perfil sem chamadas\)/);
});

test('refazer a voz exige a senha atual; 5 erros bloqueiam', async () => {
  let now = 0;
  const s = setup({ now: () => now });
  await s.store.enroll({ audio: four(), calls: three(), password: '482193' });
  assert.match(JSON.stringify(await s.store.enroll({ audio: four(), calls: three() })), /Senha incorreta/);
  const ok = await s.store.enroll({ audio: four(), calls: three(), currentPassword: '482193', password: '9137' });
  assert.ok('view' in ok);
  for (let i = 0; i < 4; i++) await s.store.enroll({ audio: four(), calls: three(), currentPassword: '000000' });
  assert.match(JSON.stringify(await s.store.enroll({ audio: four(), calls: three(), currentPassword: '000000' })), /espere 5 minutos/);
  assert.match(JSON.stringify(await s.store.enroll({ audio: four(), calls: three(), currentPassword: '9137' })), /Muitas tentativas/);
  now += 5 * 60_000;
  assert.ok('view' in (await s.store.enroll({ audio: four(), calls: three(), currentPassword: '9137' })));
});

test('recuperar a senha pela voz cadastrada', async () => {
  const s = setup();
  await s.store.enroll({ audio: four(), calls: three(), password: '482193' });
  assert.match(JSON.stringify(await s.store.recoverByVoice({ audio: clip('other'), password: '55501' })), /Não reconheci/);
  assert.match(JSON.stringify(await s.store.recoverByVoice({ audio: clip('me'), password: '123' })), /de 4 a 6 dígitos/);
  assert.ok('view' in (await s.store.recoverByVoice({ audio: clip('me'), password: '55501' })));
  assert.ok('view' in (await s.store.enroll({ audio: four(), calls: three(), currentPassword: '55501' })));
});

test('recuperar a senha por codigo enviado ao e-mail', async () => {
  let now = 0;
  const mails: { to: string; text: string }[] = [];
  const s = setup({ now: () => now, mailer: async (to, _subject, text) => void mails.push({ to, text }) });
  await s.store.enroll({ audio: four(), calls: three(), password: '482193' });
  assert.match(JSON.stringify(await s.store.sendRecoveryEmail()), /Nenhum e-mail cadastrado/);
  await s.store.enroll({ audio: four(), calls: three(), currentPassword: '482193', email: 'felipe@example.com' });
  assert.equal(s.store.view().emailRecovery, true);
  assert.match(JSON.stringify(s.store.recoverByCode({ code: '000000', password: '55501' })), /Peça um código/);
  assert.deepEqual(await s.store.sendRecoveryEmail(), { sentTo: 'f…@example.com' });
  assert.match(JSON.stringify(await s.store.sendRecoveryEmail()), /espere um minuto/);
  const code = /\b(\d{6})\b/.exec(mails[0].text)![1];
  assert.equal(mails[0].to, 'felipe@example.com');
  assert.match(JSON.stringify(s.store.recoverByCode({ code: code === '111111' ? '222222' : '111111', password: '55501' })), /Código incorreto/);
  assert.ok('view' in s.store.recoverByCode({ code, password: '55501' }));
  assert.match(JSON.stringify(s.store.recoverByCode({ code, password: '9137' })), /Peça um código/, 'codigo vale uma vez');
  // Codigo vencido.
  now += 60_000;
  await s.store.sendRecoveryEmail();
  const late = /\b(\d{6})\b/.exec(mails[1].text)![1];
  now += 16 * 60_000;
  assert.match(JSON.stringify(s.store.recoverByCode({ code: late, password: '9137' })), /Peça um código/);
});

test('sem envio de e-mail configurado, a recuperacao e pela voz', async () => {
  const s = setup();
  await s.store.enroll({ audio: four(), calls: three(), password: '482193', email: 'felipe@example.com' });
  assert.equal(s.store.view().emailRecovery, false);
  assert.match(JSON.stringify(await s.store.sendRecoveryEmail()), /não está configurado/);
});

/** Perfil salvo antes da senha numerica: senha com letras, sem `numeric` nem `access`. */
async function legacy(s: ReturnType<typeof setup>, password = 'senha-antiga!') {
  await s.store.enroll({ audio: four(), calls: three(), password: '482193' });
  const old = JSON.parse(readFileSync(s.file, 'utf8'));
  delete old.numeric;
  delete old.access;
  old.password = hashPassword(password);
  writeFileSync(s.file, JSON.stringify(old));
  return s.make();
}

test('senha falada: confere a senha numerica e conta as tentativas erradas', async () => {
  let now = 0;
  const s = setup({ now: () => now });
  assert.equal(s.store.verifyPin('123456'), false, 'sem perfil nao ha senha');
  await s.store.enroll({ audio: four(), calls: three(), password: '482193' });
  assert.equal(s.store.access(), 'both', 'padrao: voz e senha');
  assert.equal(s.store.verifyPin('482193'), true);
  for (let i = 0; i < 5; i++) assert.equal(s.store.verifyPin('111111'), false);
  assert.equal(s.store.verifyPin('482193'), 'locked', '5 erros bloqueiam, como na tela');
  assert.match(JSON.stringify(await s.store.enroll({ audio: four(), calls: three(), currentPassword: '482193' })), /Muitas tentativas/);
  now += 5 * 60_000;
  assert.equal(s.store.verifyPin('482193'), true);
  assert.ok(s.logs.includes('senha falada: aceita') && s.logs.includes('senha falada: recusada'));
  assert.ok(!s.logs.some((l) => l.includes('482193')), 'a senha nao vai para o log');
});

test('escolher o acesso: voz, senha ou os dois, com a senha atual', async () => {
  const s = setup();
  assert.match(JSON.stringify(s.store.setAccess({ access: 'pin', password: '482193' })), /Cadastre a sua voz/);
  await s.store.enroll({ audio: four(), calls: three(), password: '482193' });
  assert.match(JSON.stringify(s.store.setAccess({ access: 'pin', password: '000000' })), /Senha incorreta/);
  assert.match(JSON.stringify(s.store.setAccess({ access: 'tudo', password: '482193' })), /Escolha/);
  const ok = s.store.setAccess({ access: 'pin', password: '482193' });
  assert.ok('view' in ok && ok.view.access === 'pin');
  assert.equal(s.make().access(), 'pin', 'fica salvo');
  // Refazer a voz mantem a escolha.
  await s.store.enroll({ audio: four(), calls: three(), currentPassword: '482193' });
  assert.equal(s.make().access(), 'pin');
});

test('senha antiga com letras: vale ate o proximo pedido, que exige uma senha so de numeros', async () => {
  const s = setup();
  const store = await legacy(s);
  assert.equal(store.view().legacyPassword, true);
  assert.equal(store.access(), 'voice', 'senha com letras nao se fala: so a voz libera');
  assert.equal(store.verifyPin('482193'), false);
  // Refazer a voz: a senha antiga confere, mas a nova (so numeros) e obrigatoria.
  assert.match(JSON.stringify(await store.enroll({ audio: four(), calls: three(), currentPassword: 'senha-antiga!' })), /letras ou símbolos: defina uma senha nova/);
  assert.match(JSON.stringify(await store.enroll({ audio: four(), calls: three(), currentPassword: 'senha-antiga!', password: 'outra-letra' })), /só números/);
  const ok = await store.enroll({ audio: four(), calls: three(), currentPassword: 'senha-antiga!', password: '7788' });
  assert.ok('view' in ok && !ok.view.legacyPassword);
  assert.equal(s.make().verifyPin('7788'), true);

  // Escolher o acesso tambem pede a senha atual: com a antiga, pede a nova junto.
  const t = setup();
  const old = await legacy(t);
  assert.match(JSON.stringify(old.setAccess({ access: 'pin', password: 'senha-antiga!' })), /defina uma senha nova/);
  const set = old.setAccess({ access: 'pin', password: 'senha-antiga!', newPassword: '246810' });
  assert.ok('view' in set && set.view.access === 'pin' && !set.view.legacyPassword);
  assert.equal(t.make().verifyPin('246810'), true);

  // Recuperar a senha tambem deixa a senha so de numeros.
  const u = setup();
  const lost = await legacy(u);
  assert.ok('view' in (await lost.recoverByVoice({ audio: clip('me'), password: '1357' })));
  assert.equal(u.make().view().legacyPassword, false);
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

test('/api/voice/profile: cadastro pelo worker, verificacao e recuperacao', async () => {
  const commands: WorkerCommand[] = [];
  const worker = Object.assign(new EventEmitter(), {
    async ensureReady() {},
    command(c: WorkerCommand) {
      commands.push(c);
      if (c.cmd !== 'embed') return;
      const vectors = c.audio ? c.audio.map((a) => (whoIs(a) === 'me' ? ME : OTHER)) : [c.clip === 1 ? ME : OTHER];
      setImmediate(() => worker.emit('event', { event: 'embedding', id: c.id, vectors }));
    },
    sendAudio() {},
  }) as unknown as VoiceWorker & EventEmitter;
  const home = tempHome();
  const file = join(home, 'ui', 'voice-profile.json');
  const { app, base } = await startApp(home, { voice: { worker, brain: { async *reply() {} }, profile: { file } } });
  const auth = { authorization: 'Bearer tok', 'content-type': 'application/json' };
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  try {
    assert.equal((await fetch(`${base}/api/voice/profile`)).status, 401);
    const view = await (await fetch(`${base}/api/voice/profile`, { headers: auth })).json();
    assert.equal(view.enrolled, false);
    const bad = await post('/api/voice/profile', { audio: four(), calls: three(), password: '1234567' });
    assert.equal(bad.status, 400);
    const ok = await post('/api/voice/profile', { audio: four(), calls: three(), password: '482193' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.enrolled, true);
    assert.ok(commands.some((c) => c.cmd === 'embed' && c.audio?.length === 4 && !c.trim));
    assert.ok(commands.some((c) => c.cmd === 'embed' && c.audio?.length === 3 && c.trim), 'chamadas sem o silencio');
    const again = await post('/api/voice/profile', { audio: four(), calls: three(), currentPassword: '000000' });
    assert.match(String(again.body.error), /Senha incorreta/);
    const rec = await post('/api/voice/profile/recover', { method: 'voice', audio: clip('me'), password: '55501' });
    assert.equal(rec.status, 200);
    assert.match(String((await post('/api/voice/profile/recover', { method: 'email' })).body.error), /Nenhum e-mail/);
    assert.equal((await post('/api/voice/profile/recover', { method: 'x' })).status, 400);
    const access = await post('/api/voice/profile/access', { access: 'pin', password: '55501' });
    assert.equal(access.status, 200);
    assert.equal(access.body.access, 'pin');
    assert.equal((await post('/api/voice/profile/access', { access: 'pin', password: '000000' })).status, 400);

    // O perfil fica salvo para os proximos inicios do servidor.
    const store = new SpeakerProfileStore({ file, embed: async () => [], embedClip: async () => null });
    assert.equal(store.enrolled(), true);
  } finally {
    await app.close();
  }
});
