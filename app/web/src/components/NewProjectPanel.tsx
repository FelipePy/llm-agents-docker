import { useState } from 'react';

const VALID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function NewProjectPanel({ base, onCreate }: { base: string; onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  const valid = VALID.test(name);
  return (
    <section className="panel">
      <h1>Novo projeto</h1>
      <p className="muted">
        A pasta será criada em <code>{`${base}/${name || '<nome>'}`}</code>, e o Claude abre nela para preparar o projeto com você.
      </p>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onCreate(name);
        }}
      >
        <input autoFocus placeholder="nome-do-projeto" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={!valid}>
          Criar e abrir no Claude
        </button>
      </form>
      {name && !valid && <p className="warn">Use letras, números, ".", "_" ou "-", começando por letra ou número.</p>}
    </section>
  );
}
