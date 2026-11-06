import { useEffect, useState } from 'react';
import type { Api, BrainChoiceView, BrainProvider } from '../api.ts';
import { SettingsCard } from './SettingsCard.tsx';

const PROVIDERS: { id: BrainProvider; label: string; hint: string }[] = [
  { id: 'claude', label: 'Claude', hint: 'No login do seu plano do Claude' },
  { id: 'codex', label: 'Codex', hint: 'No login do seu plano do ChatGPT' },
];

type Notice = { kind: 'ok' | 'error' | 'busy'; text: string } | null;

/** Quem responde por voz: o provedor e o modelo (a lista vem do plano, consultada ao abrir a tela). */
export function BrainSettings({ api }: { api: Api }) {
  const [view, setView] = useState<BrainChoiceView | null>(null);
  const [provider, setProvider] = useState<BrainProvider>('claude');
  const [model, setModel] = useState('');
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    setNotice({ kind: 'busy', text: 'Consultando os modelos do seu plano…' });
    api.voiceBrain().then(
      (v) => {
        setView(v);
        setProvider(v.provider);
        setModel(v.model);
        setNotice(null);
      },
      () => setNotice({ kind: 'error', text: 'Não consegui ler quem responde por voz (servidor antigo? reinicie o llm-agent ui).' }),
    );
  }, [api]);

  if (!view) return notice ? <p className={`stt-notice ${notice.kind}`}>{notice.text}</p> : null;
  return <BrainForm view={view} provider={provider} model={model} notice={notice} onProvider={(p) => {
    setProvider(p);
    // Outro provedor: o modelo salvo dele, ou o primeiro da lista.
    setModel(p === view.provider ? view.model : (view.models[p].find((m) => m.id === 'haiku') ?? view.models[p][0])?.id ?? '');
  }} onModel={setModel} onSave={async () => {
    setNotice({ kind: 'busy', text: 'Salvando…' });
    try {
      const saved = await api.saveVoiceBrain({ provider, model });
      setView({ ...view, ...saved });
      setNotice({ kind: 'ok', text: 'Pronto: vale a partir da próxima fala.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  }} />;
}

interface FormProps {
  view: BrainChoiceView;
  provider: BrainProvider;
  model: string;
  notice: Notice;
  onProvider: (p: BrainProvider) => void;
  onModel: (m: string) => void;
  onSave: () => void;
}

export function BrainForm({ view, provider, model, notice, onProvider, onModel, onSave }: FormProps) {
  const models = view.models[provider];
  const error = view.errors[provider];
  const dirty = provider !== view.provider || model !== view.model;
  return (
    <SettingsCard title="Quem responde por voz">
      {PROVIDERS.map((p) => (
        <label key={p.id} title={p.hint}>
          <input type="radio" name="brain-provider" checked={provider === p.id} onChange={() => onProvider(p.id)} />
          {p.label}
        </label>
      ))}
      <label className="field">
        <span>Modelo</span>
        <select value={model} disabled={!models.length} onChange={(e) => onModel(e.target.value)}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="stt-notice error">Não consegui listar os modelos do {provider === 'codex' ? 'Codex' : 'Claude'}: {error}</p>}
      <p className="muted">Vale só para as respostas do Jarvis; as sessões dos projetos continuam como estão. Trocar de agente começa uma conversa nova.</p>
      <div className="stt-actions">
        <button disabled={!dirty || !model || notice?.kind === 'busy'} onClick={onSave}>
          Salvar
        </button>
      </div>
      {notice && <p className={`stt-notice ${notice.kind}`}>{notice.text}</p>}
    </SettingsCard>
  );
}
