// Envio de e-mail minimo (SMTP), so para o codigo de recuperacao da senha da voz.
// Configurado por LLM_AGENT_SMTP_URL: smtps://usuario:senha@smtp.gmail.com:465 (TLS direto)
// ou smtp://usuario:senha@host:587 (STARTTLS; sem TLS so para o proprio PC).
import { connect as tcpConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';

export interface SmtpConfig {
  secure: boolean;
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export function parseSmtpUrl(raw: string, from?: string): SmtpConfig {
  const url = new URL(raw);
  if (url.protocol !== 'smtps:' && url.protocol !== 'smtp:') throw new Error('use smtps://... ou smtp://...');
  const secure = url.protocol === 'smtps:';
  const user = decodeURIComponent(url.username);
  return {
    secure,
    host: url.hostname,
    port: Number(url.port) || (secure ? 465 : 587),
    user,
    pass: decodeURIComponent(url.password),
    from: from || (user.includes('@') ? user : `jarvis@${url.hostname}`),
  };
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
/** SMTP sem criptografia so para um servidor no proprio PC. */
export const plainAllowed = (host: string): boolean => LOOPBACK.has(host);

/** Leitor de respostas SMTP ("250-..." continua, "250 ..." termina). */
class Replies {
  private buf = '';
  private lines: string[] = [];
  private waiting: (() => void) | undefined;
  private error: Error | undefined;

  attach(socket: Socket | TLSSocket): void {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buf += chunk;
      let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        this.lines.push(this.buf.slice(0, i).replace(/\r$/, ''));
        this.buf = this.buf.slice(i + 1);
      }
      this.waiting?.();
    });
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => this.fail(new Error('o servidor de e-mail fechou a conexão')));
  }

  private fail(err: Error): void {
    this.error ??= err;
    this.waiting?.();
  }

  async next(): Promise<{ code: number; text: string }> {
    const text: string[] = [];
    for (;;) {
      while (!this.lines.length) {
        if (this.error) throw this.error;
        await new Promise<void>((ok) => (this.waiting = ok));
        this.waiting = undefined;
      }
      const line = this.lines.shift()!;
      text.push(line.slice(4));
      if (line[3] !== '-') return { code: Number(line.slice(0, 3)), text: text.join('\n') };
    }
  }
}

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

export function buildMessage(cfg: SmtpConfig, to: string, subject: string, text: string, date = new Date()): string {
  const body = b64(text).replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: Jarvis <${cfg.from}>`,
    `To: <${to}>`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${date.toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

/** Envia uma mensagem de texto. Falha com a resposta do servidor quando ele recusa. */
export async function sendMail(cfg: SmtpConfig, to: string, subject: string, text: string, timeoutMs = 20_000): Promise<void> {
  if (/[\r\n<>]/.test(to) || /[\r\n<>]/.test(cfg.from)) throw new Error('endereço inválido');
  let socket: Socket | TLSSocket = cfg.secure
    ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host })
    : tcpConnect({ host: cfg.host, port: cfg.port });
  let replies = new Replies();
  replies.attach(socket);
  const timer = setTimeout(() => socket.destroy(new Error('o servidor de e-mail não respondeu')), timeoutMs);
  const expect = async (want: number) => {
    const r = await replies.next();
    if (r.code !== want) throw new Error(`servidor de e-mail: ${r.code} ${r.text}`.slice(0, 200));
    return r.text;
  };
  const cmd = async (line: string, want: number) => {
    socket.write(line + '\r\n');
    return expect(want);
  };
  try {
    await expect(220);
    let caps = await cmd('EHLO jarvis', 250);
    if (!cfg.secure) {
      if (/^STARTTLS\b/im.test(caps)) {
        await cmd('STARTTLS', 220);
        socket.removeAllListeners('data').removeAllListeners('error').removeAllListeners('close');
        socket = tlsConnect({ socket, servername: cfg.host });
        replies = new Replies();
        replies.attach(socket);
        caps = await cmd('EHLO jarvis', 250);
      } else if (!plainAllowed(cfg.host)) {
        throw new Error('o servidor de e-mail não oferece STARTTLS; use smtps://');
      }
    }
    if (cfg.user) await cmd(`AUTH PLAIN ${b64(`\0${cfg.user}\0${cfg.pass}`)}`, 235);
    await cmd(`MAIL FROM:<${cfg.from}>`, 250);
    await cmd(`RCPT TO:<${to}>`, 250);
    await cmd('DATA', 354);
    await cmd(`${buildMessage(cfg, to, subject, text)}\r\n.`, 250);
    socket.write('QUIT\r\n');
  } finally {
    clearTimeout(timer);
    socket.end();
  }
}
