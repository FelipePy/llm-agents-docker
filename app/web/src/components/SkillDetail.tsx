import type { Skill } from '../types.ts';
import { CopySection } from './CopySection.tsx';

export function SkillDetail({ skill }: { skill: Skill }) {
  return (
    <CopySection>
      <h1>{skill.name}</h1>
      <p>
        <span className="tag">{skill.origin}</span>
      </p>
      <p>{skill.description || 'Sem descrição.'}</p>
      <p>
        <code>{skill.path}</code>
      </p>
    </CopySection>
  );
}
