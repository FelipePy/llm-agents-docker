import { watch, type FSWatcher } from 'node:fs';

/**
 * Observa as pastas (recursivo) e chama onChange uma vez por rajada de
 * eventos. Pastas que nao existem sao ignoradas. Devolve a funcao de parar.
 */
export function watchPaths(paths: string[], onChange: () => void, delay = 500): () => void {
  let timer: NodeJS.Timeout | undefined;
  const watchers: FSWatcher[] = [];
  for (const path of paths) {
    try {
      const w = watch(path, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(onChange, delay);
      });
      w.on('error', () => w.close());
      watchers.push(w);
    } catch {
      // pasta inexistente
    }
  }
  return () => {
    clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}
