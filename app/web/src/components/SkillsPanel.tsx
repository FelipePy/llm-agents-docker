import { useEffect, useState } from 'react';
import type { Skill } from '../types.ts';
import { CopySection } from './CopySection.tsx';

export function SkillsPanel({ skills, focus }: { skills: Skill[]; focus?: string }) {
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState('todas');
  const [open, setOpen] = useState<string | undefined>(focus);
  useEffect(() => setOpen(focus), [focus]);

  const origins = ['todas', ...new Set(skills.map((s) => s.origin))];
  const q = query.trim().toLowerCase();
  const shown = skills.filter(
    (s) =>
      (origin === 'todas' || s.origin === origin) &&
      (s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)),
  );
  return (
    <CopySection>
      <h1>Skills</h1>
      <div className="toolbar">
        <input placeholder="Buscar skill" value={query} onChange={(e) => setQuery(e.target.value)} />
        {origins.map((o) => (
          <button key={o} className={o === origin ? 'chip active' : 'chip'} onClick={() => setOrigin(o)}>
            {o}
          </button>
        ))}
      </div>
      <ul className="list">
        {shown.map((s) => (
          <li key={s.path} className="row" onClick={() => setOpen(open === s.path ? undefined : s.path)}>
            <div className="row-title">
              <strong className="grow">{s.name}</strong>
              <span className="tag">{s.origin}</span>
            </div>
            {open === s.path && (
              <p className="desc">
                {s.description || 'Sem descrição.'}
                <br />
                <code>{s.path}</code>
              </p>
            )}
          </li>
        ))}
      </ul>
    </CopySection>
  );
}
