import type { ProjectDetail } from '../types.ts';
import { LABEL, formatDate } from '../format.ts';

export function ProjectInfo({ detail }: { detail: ProjectDetail }) {
  return (
    <section className="panel">
      <h1>{detail.name}</h1>
      <p>
        <code>{detail.path}</code>
      </p>
      <ul className="facts">
        <li>
          <span className="muted">Agentes</span> {detail.agents.map((a) => LABEL[a]).join(' e ')}
        </li>
        <li>
          <span className="muted">Conversas</span> {detail.conversationList.length}
        </li>
        <li>
          <span className="muted">Última atividade</span> {formatDate(detail.updatedAt)}
        </li>
        <li>
          <span className="muted">Git</span>{' '}
          {detail.git ? `${detail.git.branch}${detail.git.dirty ? ' · mudanças pendentes' : ' · sem mudanças'}` : 'não é um repositório'}
        </li>
        <li>
          <span className="muted">Memória</span> {detail.memory.length} arquivo(s)
        </li>
        <li>
          <span className="muted">Instruções</span>{' '}
          {detail.instructions.length ? detail.instructions.map((f) => f.path.split('/').pop()).join(', ') : 'nenhuma'}
        </li>
      </ul>
    </section>
  );
}
