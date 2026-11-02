import ReactMarkdown from 'react-markdown';
import type { TextFile } from '../types.ts';

const stripFrontmatter = (s: string): string => s.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

/** Arquivo markdown recolhivel. O react-markdown nao renderiza HTML bruto. */
export function FileCard({ file, open = false }: { file: TextFile; open?: boolean }) {
  return (
    <details className="card" open={open}>
      <summary>{file.path}</summary>
      {file.truncated && <p className="warn markdown">Arquivo grande: mostrando os primeiros 64 KB.</p>}
      <div className="markdown">
        <ReactMarkdown>{stripFrontmatter(file.content)}</ReactMarkdown>
      </div>
    </details>
  );
}
