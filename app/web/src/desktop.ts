import { useEffect, useState } from 'react';

// Ponte com o app desktop (Tauri). A interface e uma pagina remota e nao tem
// acesso ao app; o app injeta `window.__JARVIS_DESKTOP__` e atende pedidos
// feitos por navegacao para `jarvis://...` (que ele intercepta e cancela).

export interface DesktopInfo {
  /** Abrir o Jarvis junto com o sistema. */
  autostart: boolean;
}

declare global {
  interface Window {
    __JARVIS_DESKTOP__?: DesktopInfo;
  }
}

/** Informacoes do app desktop, ou null no navegador. */
export function useDesktop(): DesktopInfo | null {
  const [info, setInfo] = useState<DesktopInfo | null>(() => window.__JARVIS_DESKTOP__ ?? null);
  useEffect(() => {
    const update = () => setInfo(window.__JARVIS_DESKTOP__ ? { ...window.__JARVIS_DESKTOP__ } : null);
    window.addEventListener('jarvis-desktop', update);
    update();
    return () => window.removeEventListener('jarvis-desktop', update);
  }, []);
  return info;
}

export function setAutostart(on: boolean): void {
  window.location.href = `jarvis://autostart/${on ? 'on' : 'off'}`;
}
