import { useEffect, useRef, useState } from 'react';
import type { Api, VoiceProfile } from '../api.ts';
import { MIN_RECORD_S, recordPhrase } from '../voice/record.ts';
import { ACCESS_OPTIONS, MAX_PIN, MIN_PIN, pinInput, pinProblem, type AccessMode } from '../pin.ts';
import { SettingsCard } from './SettingsCard.tsx';

/** Frases do cadastro (sem "Jarvis", para a escuta ligada nao acordar enquanto voce grava). */
export const PHRASES = [
  'Bom dia, quero ver como estão os meus projetos hoje.',
  'Abre o terminal e mostra o que mudou desde ontem.',
  'Quais são as notícias mais importantes desta manhã?',
  'Me avisa quando a sessão terminar, por favor.',
];
/**
 * Chamadas curtas, como no dia a dia: comparar o chamado com chamadas da mesma pessoa
 * reconhece bem melhor do que so com as frases. Enquanto grava, o Jarvis nao ouve.
 */
export const CALLS = ['Jarvis', 'Hey Jarvis', 'Ei, Jarvis'];
/** Cada chamada grava um tempo fixo e para sozinha (o nome e curto demais para "Parar"). */
export const CALL_RECORD_S = 2.5;
type Notice = { kind: 'ok' | 'error' | 'busy'; text: string } | null;
type Mode = 'view' | 'enroll' | 'recover' | 'access';

const LEGACY_NOTE = `A sua senha atual tem letras ou símbolos. Ela ainda vale agora, mas defina uma senha nova só com números, de ${MIN_PIN} a ${MAX_PIN} dígitos.`;
const accessLabel = (a: AccessMode) => ACCESS_OPTIONS.find((o) => o.value === a)?.label ?? '';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');

/** Botao de gravar uma frase: Gravar -> Parar (com os segundos) -> Regravar. */
function Recorder({ phrase, audio, onAudio, onError, disabled, fixedS }: {
  phrase: string;
  audio: string | null;
  onAudio: (b64: string | null) => void;
  onError: (text: string) => void;
  disabled?: boolean;
  /** Grava este tempo e para sozinha (chamadas curtas). */
  fixedS?: number;
}) {
  const [secs, setSecs] = useState<number | null>(null);
  const rec = useRef<{ stop(): string; cancel(): void } | null>(null);
  const recorded = useRef(0);
  useEffect(() => () => rec.current?.cancel(), []);
  const tick = (s: number) => {
    recorded.current = s;
    setSecs(s);
  };

  const finish = () => {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    const b64 = r.stop();
    setSecs(null);
    if (recorded.current < MIN_RECORD_S) onError(fixedS ? 'Gravação interrompida: grave a chamada de novo.' : 'Gravação curta demais: leia a frase inteira.');
    else onAudio(b64);
  };
  const start = async () => {
    onAudio(null);
    tick(0);
    try {
      rec.current = await recordPhrase(tick, finish, fixedS);
    } catch (err) {
      setSecs(null);
      onError(`Não consegui abrir o microfone (${errorText(err)}).`);
    }
  };

  return (
    <div className="voice-phrase">
      <span>“{phrase}”</span>
      {secs !== null ? (
        fixedS ? (
          <button disabled>Chame agora…</button>
        ) : (
          <button onClick={finish}>Parar ({secs.toFixed(0)} s)</button>
        )
      ) : (
        <button disabled={disabled} onClick={() => void start()}>
          {audio ? 'Regravar' : 'Gravar'}
        </button>
      )}
      {audio && secs === null && <span className="voice-ok" title="Gravada">✓</span>}
    </div>
  );
}

/** Voz do usuario: cadastrar, refazer (com a senha), escolher o acesso (voz/senha) e recuperar a senha. */
export function VoiceProfileSettings({ api }: { api: Api }) {
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [notice, setNotice] = useState<Notice>(null);
  const [audio, setAudio] = useState<(string | null)[]>(PHRASES.map(() => null));
  const [calls, setCalls] = useState<(string | null)[]>(CALLS.map(() => null));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [current, setCurrent] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [access, setAccess] = useState<AccessMode>('both');

  useEffect(() => {
    api.voiceProfile().then(setProfile, () => setNotice({ kind: 'error', text: 'Não consegui ler a voz cadastrada (servidor antigo? reinicie o llm-agent ui).' }));
  }, [api]);

  const open = (next: Mode) => {
    setMode(next);
    setNotice(null);
    setAudio(PHRASES.map(() => null));
    setCalls(CALLS.map(() => null));
    setPassword('');
    setConfirm('');
    setCurrent('');
    setEmail('');
    setCode('');
    setCodeSent(false);
    if (profile) setAccess(profile.access);
  };
  const run = async (busy: string, fn: () => Promise<VoiceProfile>, done: string) => {
    setNotice({ kind: 'busy', text: busy });
    try {
      setProfile(await fn());
      open('view');
      setNotice({ kind: 'ok', text: done });
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err) });
    }
  };

  if (!profile) return notice ? <p className={`stt-notice ${notice.kind}`}>{notice.text}</p> : null;
  const busy = notice?.kind === 'busy';
  const fail = (text: string) => setNotice({ kind: 'error', text });
  const setPhrase = (i: number) => (b64: string | null) => setAudio((a) => a.map((v, j) => (j === i ? b64 : v)));
  const setCall = (i: number) => (b64: string | null) => setCalls((a) => a.map((v, j) => (j === i ? b64 : v)));
  const newPasswordOk = !pinProblem(password) && password === confirm;
  const legacy = profile.legacyPassword;

  const notes = notice && <p className={`stt-notice ${notice.kind}`}>{notice.text}</p>;
  const passwordFields = (label: string) => (
    <>
      <label className="field">
        <span>{label}</span>
        <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={MAX_PIN} autoComplete="new-password" value={password} onChange={(e) => setPassword(pinInput(e.target.value))} />
      </label>
      <label className="field">
        <span>Repita a senha</span>
        <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={MAX_PIN} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(pinInput(e.target.value))} />
      </label>
      {password && pinProblem(password) && <p className="muted">{pinProblem(password)}</p>}
      {confirm && password !== confirm && <p className="muted">As senhas não são iguais.</p>}
    </>
  );

  if (mode === 'enroll') {
    const redo = profile.enrolled;
    // Senha antiga (com letras): vale como senha atual, mas a nova e obrigatoria.
    const passwordOk = redo ? current.length > 0 && (legacy ? newPasswordOk : !password || newPasswordOk) : newPasswordOk;
    const ready = audio.every(Boolean) && calls.every(Boolean) && passwordOk && !busy;
    const submit = () =>
      void run(
        'Analisando a sua voz (na primeira vez o modelo é baixado, ~26 MB)…',
        () =>
          api.enrollVoice({
            audio: audio as string[],
            calls: calls as string[],
            ...(password ? { password } : {}),
            ...(redo ? { currentPassword: current } : {}),
            ...(email.trim() || !redo ? { email: email.trim() } : {}),
          }),
        'Pronto: agora só a sua voz (ou a sua senha) ativa o Jarvis.',
      );
    return (
      <SettingsCard title={redo ? 'Refazer a voz' : 'Cadastrar a sua voz'}>
        <p className="muted">Num lugar silencioso, grave cada frase com a sua voz normal, como fala com o Jarvis.</p>
        {PHRASES.map((phrase, i) => (
          <Recorder key={i} phrase={phrase} audio={audio[i]} onAudio={setPhrase(i)} onError={fail} disabled={busy} />
        ))}
        <p className="muted">
          Agora chame o Jarvis 3 vezes, do jeito e do lugar de onde você costuma chamar. Cada gravação dura{' '}
          {CALL_RECORD_S.toLocaleString('pt-BR')} s e para sozinha; enquanto grava, ele não ouve.
        </p>
        {CALLS.map((call, i) => (
          <Recorder key={`c${i}`} phrase={call} audio={calls[i]} onAudio={setCall(i)} onError={fail} disabled={busy} fixedS={CALL_RECORD_S} />
        ))}
        {redo && (
          <label className="field">
            <span>Senha atual</span>
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
        )}
        {redo && legacy && <p className="stt-notice error">{LEGACY_NOTE}</p>}
        {passwordFields(
          redo ? (legacy ? 'Senha nova (só números)' : 'Senha nova (opcional)') : `Senha só com números, de ${MIN_PIN} a ${MAX_PIN} dígitos (também libera o acesso falada)`,
        )}
        <label className="field">
          <span>E-mail para recuperar a senha{redo ? '' : ' (opcional)'}</span>
          <input
            type="email"
            autoComplete="email"
            placeholder={profile.emailHint ? `atual: ${profile.emailHint} (deixe vazio para manter)` : 'voce@exemplo.com'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <div className="stt-actions">
          <button disabled={!ready} onClick={submit}>
            Salvar voz
          </button>
          <button className="link" disabled={busy} onClick={() => open('view')}>
            Cancelar
          </button>
        </div>
        {notes}
      </SettingsCard>
    );
  }

  if (mode === 'access') {
    const ready = current.length > 0 && (!legacy || newPasswordOk) && !busy;
    return (
      <SettingsCard title="Como liberar o acesso">
        <p className="muted">
          A senha é a mesma da voz: fale os {MIN_PIN} a {MAX_PIN} dígitos no lugar do “Jarvis”, por exemplo na primeira vez do dia.
        </p>
        {ACCESS_OPTIONS.map((o) => (
          <label key={o.value} title={o.hint}>
            <input type="radio" name="voice-access" checked={access === o.value} onChange={() => setAccess(o.value)} disabled={busy} />
            {o.label}
          </label>
        ))}
        <p className="muted">{ACCESS_OPTIONS.find((o) => o.value === access)?.hint}</p>
        <label className="field">
          <span>Senha atual</span>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        {legacy && (
          <>
            <p className="stt-notice error">{LEGACY_NOTE}</p>
            {passwordFields('Senha nova (só números)')}
          </>
        )}
        <div className="stt-actions">
          <button
            disabled={!ready}
            onClick={() =>
              void run(
                'Salvando…',
                () => api.setVoiceAccess({ access, password: current, ...(legacy ? { newPassword: password } : {}) }),
                `Pronto: acesso por ${accessLabel(access).toLowerCase()}.`,
              )
            }
          >
            Salvar
          </button>
          <button className="link" disabled={busy} onClick={() => open('view')}>
            Cancelar
          </button>
        </div>
        {notes}
      </SettingsCard>
    );
  }

  if (mode === 'recover') {
    return (
      <SettingsCard title="Esqueci a senha">
        <p className="muted">Pela sua voz: grave a frase abaixo e defina a senha nova.</p>
        <Recorder phrase={PHRASES[0]} audio={audio[0]} onAudio={setPhrase(0)} onError={fail} disabled={busy} />
        {profile.emailRecovery && (
          <>
            <p className="muted">Ou por e-mail: receba um código em {profile.emailHint}.</p>
            {codeSent ? (
              <label className="field">
                <span>Código recebido</span>
                <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              </label>
            ) : (
              <div className="stt-actions">
                <button
                  disabled={busy}
                  onClick={async () => {
                    setNotice({ kind: 'busy', text: 'Enviando o código…' });
                    try {
                      const r = await api.recoverVoice({ method: 'email' });
                      setCodeSent(true);
                      setNotice({ kind: 'ok', text: `Código enviado para ${r.sentTo ?? profile.emailHint}.` });
                    } catch (err) {
                      fail(errorText(err));
                    }
                  }}
                >
                  Enviar código por e-mail
                </button>
              </div>
            )}
          </>
        )}
        {passwordFields('Senha nova')}
        <div className="stt-actions">
          <button
            disabled={busy || !newPasswordOk || !(audio[0] || code.length === 6)}
            onClick={() =>
              void run(
                'Conferindo…',
                () =>
                  code.length === 6
                    ? api.recoverVoice({ method: 'code', code, password })
                    : api.recoverVoice({ method: 'voice', audio: audio[0]!, password }),
                'Senha nova salva.',
              )
            }
          >
            Salvar senha nova
          </button>
          <button className="link" disabled={busy} onClick={() => open('view')}>
            Cancelar
          </button>
        </div>
        {notes}
      </SettingsCard>
    );
  }

  return (
    <SettingsCard title="Sua voz">
      <p className={profile.enrolled ? 'voice-enrolled' : 'muted'}>
        {profile.enrolled
          ? `✓ Voz cadastrada${profile.enrolledAt ? ` em ${date(profile.enrolledAt)}` : ''}. Acesso: ${legacy ? 'só a voz' : accessLabel(profile.access).toLowerCase()}.`
          : 'Nenhuma voz cadastrada: qualquer voz ativa o Jarvis.'}
      </p>
      {profile.enrolled && legacy && (
        <p className="muted">
          A sua senha tem letras ou símbolos: ela vale até a próxima vez em que for pedida, e aí você define uma senha nova só com números
          (que também libera o acesso falada).
        </p>
      )}
      {profile.enrolled && !profile.calls && (
        <p className="muted">Cadastro antigo, sem as chamadas ("Jarvis"): refaça a voz para ele reconhecer você melhor quando chamar.</p>
      )}
      <div className="stt-actions">
        <button onClick={() => open('enroll')}>{profile.enrolled ? 'Refazer voz' : 'Cadastrar voz'}</button>
        {profile.enrolled && <button onClick={() => open('access')}>Mudar o acesso</button>}
        {profile.enrolled && (
          <button className="link" onClick={() => open('recover')}>
            Esqueci a senha
          </button>
        )}
      </div>
      {notes}
    </SettingsCard>
  );
}
