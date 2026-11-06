import { useEffect, useState } from 'react';
import type { Api } from '../api.ts';
import type { ProjectDetail, SessionAgent } from '../types.ts';
import { LABEL, formatDate } from '../format.ts';
import { FileCard } from './FileCard.tsx';
import { CopySection } from './CopySection.tsx';

interface Props {
  api: Api;
  id: string;
  revision: number;
  onOpen: (projectPath: string, agent: SessionAgent, resume?: string) => void;
}

export function ProjectPanel({ api, id, revision, onOpen }: Props) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    api.project(id).then(
      (d) => current && (setDetail(d), setError(null)),
      (e: Error) => current && setError(e.message),
    );
    return () => {
      current = false;
    };
  }, [api, id, revision]);

  if (error) return <p className="error">{error}</p>;
  if (!detail || detail.id !== id) return <p className="muted">Carregando…</p>;
  return (
    <CopySection>
      <h1>{detail.name}</h1>
      <p className="muted">
        <code>{detail.path}</code>
        {detail.git && <span className="tag">{detail.git.branch}</span>}
        {detail.git?.dirty && <span className="tag warn">mudanças pendentes</span>}
      </p>
      <div className="toolbar">
        {(['claude', 'codex', 'shell'] as const).map((a) => (
          <button key={a} className={`launch ${a}`} onClick={() => onOpen(detail.path, a)}>
            + {LABEL[a]}
          </button>
        ))}
      </div>
      <h2>Conversas</h2>
      {detail.conversationList.length ? (
        <ul className="list">
          {detail.conversationList.map((c) => (
            <li key={c.agent + c.id} className="row">
              <div className="row-title">
                <span className={`dot ${c.agent}`} title={LABEL[c.agent]} />
                <span className="grow" title={c.title}>{c.title}</span>
                <span className="muted">
                  {formatDate(c.updatedAt)} · {c.prompts} msg
                </span>
                <button onClick={() => onOpen(detail.path, c.agent, c.id)}>Retomar</button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nenhuma conversa.</p>
      )}
      {detail.instructions.length > 0 && (
        <>
          <h2>Instruções do projeto</h2>
          {detail.instructions.map((f) => <FileCard key={f.path} file={f} />)}
        </>
      )}
      {detail.memory.length > 0 && (
        <>
          <h2>Memória</h2>
          {detail.memory.map((f) => <FileCard key={f.path} file={f} />)}
        </>
      )}
    </CopySection>
  );
}
