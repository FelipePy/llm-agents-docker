import { useCallback, useEffect, useState } from 'react';
import type { Api, JarvisMemoryView } from '../api.ts';
import type { Profile } from '../types.ts';
import { FileCard } from './FileCard.tsx';
import { CopySection } from './CopySection.tsx';

export function ProfilePanel({ profile, api }: { profile?: Profile; api: Api }) {
  if (!profile) return <p className="muted">Carregando…</p>;
  return (
    <CopySection>
      <h1>Você</h1>
      <p className="muted">O que os agentes e o Jarvis sabem sobre você.</p>
      <h2>Instruções globais</h2>
      {profile.instructions.length ? (
        profile.instructions.map((f) => <FileCard key={f.path} file={f} open />)
      ) : (
        <p className="muted">Nenhum CLAUDE.md ou AGENTS.md global.</p>
      )}
      <h2>Memórias</h2>
      {profile.memories.length ? (
        profile.memories.map((f) => <FileCard key={f.path} file={f} />)
      ) : (
        <p className="muted">Nenhuma memória sobre você ainda.</p>
      )}
      <JarvisMemorySection api={api} />
    </CopySection>
  );
}

const TOPIC_LABEL: Record<string, string> = { usuario: 'Sobre você', preferencia: 'Preferências', pessoa: 'Pessoas', projeto: 'Projetos', outro: 'Outros' };

function JarvisMemorySection({ api }: { api: Api }) {
  const [data, setData] = useState<JarvisMemoryView | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => api.jarvisMemory().then(setData, () => setError('Não consegui ler a memória do Jarvis.')), [api]);
  useEffect(() => void load(), [load]);
  const forget = async (id: string) => {
    await api.forgetFact(id).catch(() => setError('Não consegui apagar.'));
    void load();
  };
  return (
    <>
      <h2>O Jarvis lembra</h2>
      {error && <p className="muted">{error}</p>}
      {data && !data.facts.length && <p className="muted">Nada ainda. Conte algo ao Jarvis, ou diga “lembra que…”.</p>}
      {data &&
        Object.keys(TOPIC_LABEL).map((topic) => {
          const facts = data.facts.filter((f) => f.about === topic);
          if (!facts.length) return null;
          return (
            <div key={topic} className="jarvis-facts">
              <h3>{TOPIC_LABEL[topic]}</h3>
              <ul>
                {facts.map((f) => (
                  <li key={f.id}>
                    <span>{f.project ? <b>{f.project}: </b> : null}{f.text}</span>
                    <button className="link" title="Apagar da memória do Jarvis" onClick={() => void forget(f.id)}>apagar</button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      {data && data.conversations.length > 0 && (
        <div className="jarvis-facts">
          <h3>Últimas conversas</h3>
          <ul>
            {data.conversations.slice(-5).reverse().map((c) => (
              <li key={c.at}><span>{new Date(c.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}: {c.text}</span></li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
