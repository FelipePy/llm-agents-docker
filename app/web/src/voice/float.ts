import type { CoreMode } from '../scene/core.ts';

// Janela flutuante do Jarvis no navegador (Document Picture-in-Picture): fica
// por cima das outras abas e programas. O navegador so a abre com um clique.

interface PipApi {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

export const floatSupported = (): boolean => 'documentPictureInPicture' in window;

export interface FloatingOrb {
  update(mode: CoreMode, text: string): void;
  close(): void;
}

const STYLE = `
  html, body { margin: 0; height: 100%; background: #05060a; color: #e8e2d0; font-family: 'Segoe UI', system-ui, sans-serif; overflow: hidden; }
  .wrap { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; cursor: pointer; }
  .orb { width: 64px; height: 64px; border-radius: 50%; background: #000; transition: box-shadow 0.3s;
         box-shadow: 0 0 0 6px #2a1f08, 0 0 18px 6px rgba(255, 191, 60, 0.35); }
  .orb.listening { box-shadow: 0 0 0 6px #4a3510, 0 0 26px 10px rgba(255, 211, 107, 0.6); }
  .orb.thinking { animation: spin 1.2s linear infinite; box-shadow: 0 0 0 6px #4a2e08, 0 0 26px 10px rgba(255, 179, 71, 0.6); }
  .orb.speaking { animation: pulse 0.7s ease-in-out infinite; }
  @keyframes pulse { 50% { box-shadow: 0 0 0 9px #5a3f12, 0 0 34px 14px rgba(255, 201, 74, 0.85); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  .text { max-width: 92%; font-size: 12px; text-align: center; color: #ffe7a3; line-height: 1.3; max-height: 3.9em; overflow: hidden; }
`;

/** Abre a janela flutuante (precisa ser chamado num clique). */
export async function openFloatingOrb(onClick: () => void, onClose: () => void): Promise<FloatingOrb | null> {
  const api = (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture;
  if (!api) return null;
  const pip = await api.requestWindow({ width: 180, height: 200 });
  const doc = pip.document;
  const style = doc.createElement('style');
  style.textContent = STYLE;
  doc.head.append(style);
  doc.title = 'Jarvis';
  const wrap = doc.createElement('div');
  wrap.className = 'wrap';
  const orb = doc.createElement('div');
  orb.className = 'orb';
  const text = doc.createElement('div');
  text.className = 'text';
  wrap.append(orb, text);
  doc.body.append(wrap);
  wrap.addEventListener('click', onClick);
  pip.addEventListener('pagehide', onClose);
  return {
    update(mode, said) {
      orb.className = `orb ${mode === 'idle' ? '' : mode}`;
      text.textContent = said;
    },
    close: () => pip.close(),
  };
}
