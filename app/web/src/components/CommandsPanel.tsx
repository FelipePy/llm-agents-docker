import { COMMANDS } from '../../../server/src/voice/commands.ts';

/** Lista dos comandos de voz, gerada da mesma lista que o Jarvis usa. */
export function CommandsPanel() {
  return (
    <section className="panel">
      <h1>Comandos de voz</h1>
      <p className="muted">
        Diga “Hey Jarvis” e peça com suas palavras; não precisa decorar as frases. Alguns exemplos:
      </p>
      <ul className="commands">
        {COMMANDS.map((c) => (
          <li key={c.name}>
            <strong>{c.title}</strong>
            {c.examples.map((e) => (
              <span key={e} className="example">
                “{e}”
              </span>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
