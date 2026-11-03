import { useEffect, useState } from 'react';
import type { Api, GroqModel, SttProvider, VoiceSettings, VoiceSettingsInput } from '../api.ts';

const MODELS: { id: GroqModel; label: string }[] = [
  { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo (rápido, US$ 0,04/h)' },
  { id: 'whisper-large-v3', label: 'Whisper Large v3 (mais preciso, US$ 0,11/h)' },
];

type Notice = { kind: 'ok' | 'error' | 'busy'; text: string } | null;

/** Quem transcreve a sua fala: o whisper local ou o Groq (nuvem, com chave de API). */
export function SttSettings({ api }: { api: Api }) {
  const [saved, setSaved] = useState<VoiceSettings | null>(null);
  const [provider, setProvider] = useState<SttProvider>('local');
  const [model, setModel] = useState<GroqModel>('whisper-large-v3-turbo');
  const [key, setKey] = useState('');
  const [notice, setNotice] = useState<Notice>(null);

  const apply = (s: VoiceSettings) => {
    setSaved(s);
    setProvider(s.stt);
    setModel(s.groqModel);
    setKey('');
  };

  useEffect(() => {
    api.voiceSettings().then(apply, () => setNotice({ kind: 'error', text: 'Não consegui ler as configurações da voz (servidor antigo? reinicie o llm-agent ui).' }));
  }, [api]);

  const save = async (input: VoiceSettingsInput, done: string) => {
    setNotice({ kind: 'busy', text: input.groqKey ? 'Conferindo a chave com o Groq…' : 'Salvando…' });
    try {
      apply(await api.saveVoiceSettings(input));
      setNotice({ kind: 'ok', text: done });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  if (!saved) return notice ? <p className={`stt-notice ${notice.kind}`}>{notice.text}</p> : null;

  const dirty = provider !== saved.stt || model !== saved.groqModel || key.trim() !== '';
  const busy = notice?.kind === 'busy';
  const submit = () => {
    const input: VoiceSettingsInput = { stt: provider, groqModel: model };
    if (key.trim()) input.groqKey = key.trim();
    void save(input, provider === 'groq' ? 'Pronto: sua fala agora é transcrita no Groq.' : 'Pronto: transcrição local.');
  };

  return (
    <div className="stt-settings">
      <div className="stt-title">Transcrição da fala</div>
      <label title="Whisper rodando no seu PC: nada sai da máquina">
        <input type="radio" name="stt" checked={provider === 'local'} onChange={() => setProvider('local')} />
        Local (no seu PC)
      </label>
      <label title="Whisper no Groq: mais rápido e mais preciso, precisa de internet e chave">
        <input type="radio" name="stt" checked={provider === 'groq'} onChange={() => setProvider('groq')} />
        Groq (nuvem)
      </label>

      {provider === 'groq' && (
        <div className="stt-groq">
          <label className="field">
            <span>Chave de API</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={saved.groqKeyHint ? `salva: ${saved.groqKeyHint} (cole outra para trocar)` : 'gsk_…'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && dirty && !busy && submit()}
            />
          </label>
          <label className="field">
            <span>Modelo</span>
            <select value={model} onChange={(e) => setModel(e.target.value as GroqModel)}>
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            Crie a chave em <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>. Ela fica
            guardada só no seu PC. Vai para o Groq apenas o áudio do que você fala depois de chamar o Jarvis; se o Groq falhar, o
            whisper local assume.
          </p>
        </div>
      )}

      <div className="stt-actions">
        <button disabled={!dirty || busy} onClick={submit}>
          Salvar
        </button>
        {provider === 'groq' && saved.groqKeyHint && !key && (
          <button
            className="link"
            disabled={busy}
            onClick={() => void save({ stt: 'local', groqKey: '' }, 'Chave apagada; transcrição local.')}
          >
            Apagar chave
          </button>
        )}
      </div>
      {notice && <p className={`stt-notice ${notice.kind}`}>{notice.text}</p>}
    </div>
  );
}
