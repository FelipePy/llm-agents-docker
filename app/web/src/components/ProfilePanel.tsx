import type { Profile } from '../types.ts';
import { FileCard } from './FileCard.tsx';

export function ProfilePanel({ profile }: { profile?: Profile }) {
  if (!profile) return <p className="muted">Carregando…</p>;
  return (
    <section className="panel">
      <h1>Você</h1>
      <p className="muted">O que os agentes sabem sobre você.</p>
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
    </section>
  );
}
