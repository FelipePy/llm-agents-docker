import { useState, type KeyboardEvent } from 'react';
import type { Conversation, Overview } from '../types.ts';
import { LABEL } from '../format.ts';

interface Props {
  overview: Overview;
  onClose: () => void;
  onProject: (id: string) => void;
  onSkill: (path: string) => void;
  onConversation: (c: Conversation) => void;
}

interface Item {
  key: string;
  label: string;
  hint: string;
  run: () => void;
}

export function SearchDialog({ overview, onClose, onProject, onSkill, onConversation }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const q = query.trim().toLowerCase();
  const projectName = new Map(overview.projects.map((p) => [p.path, p.name]));
  const items: Item[] = q
    ? [
        ...overview.projects
          .filter((p) => p.name.toLowerCase().includes(q))
          .map((p) => ({ key: `p${p.id}`, label: p.name, hint: 'projeto', run: () => onProject(p.id) })),
        ...overview.conversations
          .filter((c) => c.title.toLowerCase().includes(q))
          .map((c) => ({
            key: `c${c.agent}${c.id}`,
            label: c.title,
            hint: `${LABEL[c.agent]} · ${projectName.get(c.cwd) ?? c.cwd}`,
            run: () => onConversation(c),
          })),
        ...overview.skills
          .filter((s) => s.name.toLowerCase().includes(q))
          .map((s) => ({ key: `s${s.path}`, label: s.name, hint: `skill · ${s.origin}`, run: () => onSkill(s.path) })),
      ].slice(0, 30)
    : [];

  const pick = (item: Item | undefined) => {
    if (!item) return;
    item.run();
    onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, items.length - 1));
    else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
    else if (e.key === 'Enter') pick(items[index]);
    else return;
    e.preventDefault();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="search" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Buscar projetos, conversas e skills"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKey}
        />
        <ul>
          {items.map((it, i) => (
            <li key={it.key} className={i === index ? 'active' : ''} onMouseEnter={() => setIndex(i)} onClick={() => pick(it)}>
              <span className="grow">{it.label}</span>
              <span className="muted">{it.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
