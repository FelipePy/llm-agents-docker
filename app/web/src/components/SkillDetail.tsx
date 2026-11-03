import type { Skill } from '../types.ts';

export function SkillDetail({ skill }: { skill: Skill }) {
  return (
    <section className="panel">
      <h1>{skill.name}</h1>
      <p>
        <span className="tag">{skill.origin}</span>
      </p>
      <p>{skill.description || 'Sem descrição.'}</p>
      <p>
        <code>{skill.path}</code>
      </p>
    </section>
  );
}
