// Voz do usuario: o perfil cadastrado (4 frases), a senha que protege o perfil
// e a recuperacao da senha (pela propria voz ou por um codigo enviado por e-mail).
// A voz so e conferida quando o Jarvis e chamado (VoiceSession.activate).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { SpeakerCheck } from './session.ts';

export const ENROLL_PHRASES = 4;
export const MIN_PASSWORD = 8;
/** Semelhanca minima (cosseno) com o perfil para aceitar a voz. */
export const DEFAULT_THRESHOLD = 0.5;
/** Cada frase gravada: de 1 a 15 s de PCM 16 kHz, 16 bits. */
const MIN_CLIP_BYTES = 32_000;
const MAX_CLIP_BYTES = 15 * 32_000;
const CODE_TTL_MS = 15 * 60_000;
const EMAIL_EVERY_MS = 60_000;
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60_000;

export type Mailer = (to: string, subject: string, text: string) => Promise<void>;

interface Profile {
  vector: number[];
  /** "scrypt:<sal>:<hash>" (base64). */
  password: string;
  email: string;
  enrolledAt: string;
}

/** O que a tela ve: nada do vetor nem da senha; o e-mail so como dica. */
export interface SpeakerView {
  enrolled: boolean;
  enrolledAt: string | null;
  emailHint: string | null;
  /** Da para recuperar a senha por e-mail (envio configurado e e-mail cadastrado)? */
  emailRecovery: boolean;
}

export interface SpeakerDeps {
  file: string;
  /** Vetores da voz de trechos PCM (base64), um por trecho (null: curto demais). */
  embed(audio: string[]): Promise<(number[] | null)[]>;
  /** Vetor do audio de uma ativacao guardado no worker. */
  embedClip(clip: number): Promise<number[] | null>;
  mailer?: Mailer;
  threshold?: number;
  now?: () => number;
  /** Linha de log de cada verificacao (semelhanca e limiar), para calibrar o limiar. */
  log?: (line: string) => void;
}

type Result = { view: SpeakerView } | { error: string };

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const unit = (v: number[]): number[] => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
};

/** Perfil: media dos vetores normalizados das frases. */
export function average(vectors: number[][]): number[] {
  const units = vectors.map(unit);
  return unit(units[0].map((_, i) => units.reduce((s, v) => s + v[i], 0) / units.length));
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString('base64')}:${scryptSync(password, salt, 32).toString('base64')}`;
}

export function passwordMatches(password: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split(':');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = scryptSync(password, Buffer.from(salt, 'base64'), want.length);
  return timingSafeEqual(got, want);
}

export const emailHint = (email: string): string | null => {
  const at = email.indexOf('@');
  return at > 0 ? `${email[0]}…${email.slice(at)}` : null;
};

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** Trecho PCM em base64 valido para o cadastro? Devolve o problema ou null. */
function clipProblem(audio: unknown, label: string): string | null {
  if (typeof audio !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(audio)) return `${label}: áudio inválido.`;
  const bytes = Math.floor((audio.length * 3) / 4);
  if (bytes < MIN_CLIP_BYTES) return `${label} ficou curta demais: fale a frase inteira.`;
  if (bytes > MAX_CLIP_BYTES + 4) return `${label} ficou longa demais (máximo 15 s).`;
  return null;
}

function parse(raw: unknown): Profile | null {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!Array.isArray(o.vector) || !o.vector.length || !o.vector.every((x) => typeof x === 'number')) return null;
  if (typeof o.password !== 'string') return null;
  return {
    vector: o.vector,
    password: o.password,
    email: typeof o.email === 'string' ? o.email : '',
    enrolledAt: typeof o.enrolledAt === 'string' ? o.enrolledAt : '',
  };
}

export class SpeakerProfileStore implements SpeakerCheck {
  private profile: Profile | null;
  private readonly deps: SpeakerDeps;
  private readonly threshold: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private failures = 0;
  private lockedUntil = 0;
  private code: { hash: string; expires: number } | null = null;
  private lastEmail = -Infinity;

  constructor(deps: SpeakerDeps) {
    this.deps = deps;
    this.threshold = deps.threshold ?? DEFAULT_THRESHOLD;
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? (() => {});
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(deps.file, 'utf8'));
    } catch {
      raw = undefined;
    }
    this.profile = parse(raw);
  }

  enrolled(): boolean {
    return this.profile !== null;
  }

  async verify(clip: number | undefined): Promise<boolean> {
    const profile = this.profile;
    if (!profile) return true;
    if (clip === undefined) throw new Error('o worker não mandou o áudio da ativação');
    const started = this.now();
    const vector = await this.deps.embedClip(clip);
    return this.matches(vector, profile, `ativação (${this.now() - started} ms)`);
  }

  view(): SpeakerView {
    const p = this.profile;
    return {
      enrolled: p !== null,
      enrolledAt: p?.enrolledAt || null,
      emailHint: p ? emailHint(p.email) : null,
      emailRecovery: Boolean(p?.email && this.deps.mailer),
    };
  }

  /**
   * Cadastra (ou refaz) a voz com as 4 frases. Na primeira vez define a senha;
   * para refazer, pede a senha atual (e pode trocar a senha e o e-mail).
   */
  async enroll(input: { audio?: unknown; password?: unknown; currentPassword?: unknown; email?: unknown }): Promise<Result> {
    const current = this.profile;
    if (current) {
      const locked = this.lockProblem();
      if (locked) return { error: locked };
      if (typeof input.currentPassword !== 'string' || !passwordMatches(input.currentPassword, current.password)) {
        return { error: this.failed('Senha incorreta.') };
      }
    }
    const newPassword = input.password === undefined || input.password === '' ? undefined : input.password;
    if (!current && newPassword === undefined) return { error: `Defina uma senha de no mínimo ${MIN_PASSWORD} caracteres.` };
    if (newPassword !== undefined) {
      const problem = passwordProblem(newPassword);
      if (problem) return { error: problem };
    }
    let email = current?.email ?? '';
    if (input.email !== undefined) {
      if (typeof input.email !== 'string') return { error: 'E-mail inválido.' };
      email = input.email.trim();
      if (email && (email.length > 200 || !EMAIL.test(email))) return { error: 'Esse e-mail não parece válido.' };
    }
    const audio = input.audio;
    if (!Array.isArray(audio) || audio.length !== ENROLL_PHRASES) return { error: `Grave as ${ENROLL_PHRASES} frases.` };
    for (const [i, a] of audio.entries()) {
      const problem = clipProblem(a, `A frase ${i + 1}`);
      if (problem) return { error: problem };
    }

    const vectors = await this.deps.embed(audio as string[]);
    const short = vectors.findIndex((v) => !v);
    if (short >= 0 || vectors.length !== ENROLL_PHRASES) {
      return { error: `A frase ${Math.max(short, 0) + 1} ficou sem voz suficiente: grave de novo, mais perto do microfone.` };
    }
    const valid = vectors as number[][];
    const vector = average(valid);
    // As frases precisam ser da mesma voz (ninguem mais falando junto).
    const odd = valid.findIndex((v) => cosine(v, vector) < this.threshold);
    if (odd >= 0) return { error: `A frase ${odd + 1} não parece da mesma voz das outras: grave de novo, num lugar silencioso.` };

    this.save({
      vector: vector.map((x) => Math.round(x * 1e6) / 1e6),
      password: newPassword !== undefined ? hashPassword(newPassword as string) : current!.password,
      email,
      enrolledAt: new Date(this.now()).toISOString(),
    });
    return { view: this.view() };
  }

  /** Esqueceu a senha: fala uma frase; se for a voz cadastrada, define a senha nova. */
  async recoverByVoice(input: { audio?: unknown; password?: unknown }): Promise<Result> {
    const p = this.profile;
    if (!p) return { error: 'Nenhuma voz cadastrada.' };
    const locked = this.lockProblem();
    if (locked) return { error: locked };
    const problem = passwordProblem(input.password) ?? clipProblem(input.audio, 'A frase');
    if (problem) return { error: problem };
    const [vector] = await this.deps.embed([input.audio as string]);
    if (!this.matches(vector, p, 'recuperação da senha')) return { error: this.failed('Não reconheci a sua voz. Tente de novo, num lugar silencioso.') };
    this.save({ ...p, password: hashPassword(input.password as string) });
    return { view: this.view() };
  }

  /** Envia um codigo de 6 digitos ao e-mail cadastrado (no maximo um por minuto). */
  async sendRecoveryEmail(): Promise<{ sentTo: string } | { error: string }> {
    const p = this.profile;
    if (!p) return { error: 'Nenhuma voz cadastrada.' };
    if (!p.email) return { error: 'Nenhum e-mail cadastrado: recupere pela voz.' };
    if (!this.deps.mailer) return { error: 'O envio de e-mail não está configurado (LLM_AGENT_SMTP_URL): recupere pela voz.' };
    if (this.now() - this.lastEmail < EMAIL_EVERY_MS) return { error: 'Já enviei um código há pouco; espere um minuto.' };
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.lastEmail = this.now();
    try {
      await this.deps.mailer(
        p.email,
        'Jarvis: código para trocar a senha da voz',
        `Seu código para definir uma senha nova da voz do Jarvis é ${code}.\n\nEle vale por 15 minutos. Se não foi você que pediu, ignore este e-mail.\n`,
      );
    } catch (err) {
      this.lastEmail = -Infinity;
      return { error: `Não consegui enviar o e-mail (${String((err as Error)?.message ?? err)}).` };
    }
    this.code = { hash: hashPassword(code), expires: this.now() + CODE_TTL_MS };
    return { sentTo: emailHint(p.email) ?? '' };
  }

  /** Codigo recebido por e-mail + senha nova. */
  recoverByCode(input: { code?: unknown; password?: unknown }): Result {
    const p = this.profile;
    if (!p) return { error: 'Nenhuma voz cadastrada.' };
    const locked = this.lockProblem();
    if (locked) return { error: locked };
    const problem = passwordProblem(input.password);
    if (problem) return { error: problem };
    const code = this.code;
    if (!code || this.now() > code.expires) return { error: 'Peça um código novo por e-mail.' };
    if (typeof input.code !== 'string' || !passwordMatches(input.code.trim(), code.hash)) return { error: this.failed('Código incorreto.') };
    this.code = null;
    this.save({ ...p, password: hashPassword(input.password as string) });
    return { view: this.view() };
  }

  /** Compara com o perfil e registra a semelhanca (sem ela, nao da para saber onde por o limiar). */
  private matches(vector: number[] | null, profile: Profile, what: string): boolean {
    if (!vector) {
      this.log(`voz (${what}): pouca fala no áudio para conferir → recusada`);
      return false;
    }
    const score = cosine(vector, profile.vector);
    const ok = score >= this.threshold;
    this.log(`voz (${what}): semelhança ${score.toFixed(2)}, mínimo ${this.threshold.toFixed(2)} → ${ok ? 'aceita' : 'recusada'}`);
    return ok;
  }

  /** Tentativa errada: depois de 5 seguidas, bloqueia por 5 minutos. */
  private failed(message: string): string {
    if (++this.failures >= MAX_FAILURES) {
      this.failures = 0;
      this.lockedUntil = this.now() + LOCK_MS;
      return `${message} Muitas tentativas: espere 5 minutos.`;
    }
    return message;
  }

  private lockProblem(): string | null {
    return this.now() < this.lockedUntil ? 'Muitas tentativas erradas: espere alguns minutos.' : null;
  }

  private save(profile: Profile): void {
    mkdirSync(dirname(this.deps.file), { recursive: true });
    writeFileSync(this.deps.file, JSON.stringify(profile) + '\n', { mode: 0o600 });
    this.profile = profile;
    this.failures = 0;
  }
}

function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `A senha precisa ter no mínimo ${MIN_PASSWORD} caracteres.`;
  if (password.length > 200) return 'Senha longa demais.';
  return null;
}
