type Listener = (data: string, reset: boolean) => void;

/**
 * Leva a saida das sessoes ate os terminais. Guarda o que chega antes do
 * terminal montar; "history" substitui o pendente e pede para limpar a tela.
 */
export function createBus() {
  const listeners = new Map<string, Listener>();
  const pending = new Map<string, { reset: boolean; chunks: string[] }>();
  return {
    data(id: string, data: string): void {
      const listener = listeners.get(id);
      if (listener) return listener(data, false);
      const p = pending.get(id) ?? { reset: false, chunks: [] };
      p.chunks.push(data);
      pending.set(id, p);
    },
    history(id: string, data: string): void {
      const listener = listeners.get(id);
      if (listener) return listener(data, true);
      pending.set(id, { reset: true, chunks: [data] });
    },
    on(id: string, listener: Listener): () => void {
      listeners.set(id, listener);
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        p.chunks.forEach((chunk, i) => listener(chunk, p.reset && i === 0));
      }
      return () => {
        if (listeners.get(id) === listener) listeners.delete(id);
      };
    },
  };
}

export const bus = createBus();
