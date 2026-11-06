import { useEffect, useState } from 'react';
import type { Api, PauseSettings as Pauses } from '../api.ts';
import { fromDraft, parseWords, sameDraft, toDraft, type PauseDraft } from '../pauses.ts';
import { SettingsCard } from './SettingsCard.tsx';

type Notice = { kind: 'ok' | 'error' | 'busy'; text: string } | null;

/**
 * Quanto silencio encerra a sua fala e quanto o Jarvis espera por uma frase que parou no
 * meio ("abre o projeto e"). Nada muda na voz ate clicar em Salvar; ao fechar as
 * configuracoes, o que nao foi salvo se perde (o painel e desmontado).
 */
export function PauseSettings({ api }: { api: Api }) {
  const [saved, setSaved] = useState<{ pauses: Pauses; defaults: Pauses } | null>(null);
  const [draft, setDraft] = useState<PauseDraft>({ silence: '', incomplete: '', words: '' });
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    api.voiceSettings().then(
      (s) => {
        setSaved({ pauses: s.pauses, defaults: s.pauseDefaults });
        setDraft(toDraft(s.pauses));
      },
      () => setNotice({ kind: 'error', text: 'Não consegui ler as pausas da voz (servidor antigo? reinicie o llm-agent ui).' }),
    );
  }, [api]);

  if (!saved || !saved.pauses) return notice ? <p className={`stt-notice ${notice.kind}`}>{notice.text}</p> : null;

  const dirty = !sameDraft(draft, toDraft(saved.pauses));
  const busy = notice?.kind === 'busy';
  const isDefaultList = parseWords(draft.words).join('|') === saved.defaults.continuationWords.join('|');
  const edit = (field: keyof PauseDraft) => (e: { target: { value: string } }) => {
    setDraft({ ...draft, [field]: e.target.value });
    setNotice(null);
  };

  const submit = async () => {
    const pauses = fromDraft(draft);
    if ('error' in pauses) return setNotice({ kind: 'error', text: pauses.error });
    setNotice({ kind: 'busy', text: 'Salvando…' });
    try {
      const s = await api.saveVoiceSettings({ pauses });
      setSaved({ pauses: s.pauses, defaults: s.pauseDefaults });
      setDraft(toDraft(s.pauses));
      const adjusted = s.pauses.silenceMs !== pauses.silenceMs || s.pauses.incompleteMs !== pauses.incompleteMs;
      setNotice({
        kind: 'ok',
        text: adjusted
          ? 'Salvo, com os tempos ajustados à faixa aceita (silêncio de 0,3 a 5 s; espera total até 15 s, nunca menor que o silêncio).'
          : 'Pronto: vale a partir da próxima fala.',
      });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <SettingsCard title="Pausas da fala">
      <label className="field" title="Quanto tempo calado encerra a sua fala e o Jarvis responde">
        <span>Silêncio até responder (segundos)</span>
        <input inputMode="decimal" value={draft.silence} onChange={edit('silence')} />
      </label>
      <label className="field" title="Se a fala terminar numa das palavras abaixo, o Jarvis espera até este tempo, no total, pela continuação">
        <span>Espera máxima com a frase incompleta (segundos, no total)</span>
        <input inputMode="decimal" value={draft.incomplete} onChange={edit('incomplete')} />
      </label>
      <label className="field" title="Separe por vírgula; vale também mais de uma palavra, como “o meu”">
        <span>Palavras que indicam frase incompleta</span>
        <textarea rows={4} spellCheck={false} value={draft.words} onChange={edit('words')} />
      </label>
      {!parseWords(draft.words).length && (
        <p className="muted">Lista vazia: o Jarvis responde logo depois do silêncio, sem esperar a mais.</p>
      )}
      <div className="stt-actions">
        <button disabled={!dirty || busy} onClick={() => void submit()}>
          Salvar
        </button>
        <button
          className="link"
          disabled={busy || isDefaultList}
          onClick={() => setDraft({ ...draft, words: saved.defaults.continuationWords.join(', ') })}
        >
          Restaurar palavras padrão
        </button>
      </div>
      {dirty && !notice && <p className="muted">Alterações não salvas: só valem depois de Salvar.</p>}
      {notice && <p className={`stt-notice ${notice.kind}`}>{notice.text}</p>}
    </SettingsCard>
  );
}
