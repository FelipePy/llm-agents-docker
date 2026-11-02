// Diagnostico da localizacao do navegador (para o clima): diz por que nao veio.

export interface GeoSituation {
  /** window.isSecureContext: 127.0.0.1, localhost ou https. */
  secure: boolean;
  supported: boolean;
  /** GeolocationPositionError.code: 1 negada, 2 indisponivel, 3 tempo esgotado. */
  errorCode?: number;
}

export function geoProblem(g: GeoSituation): string | null {
  if (!g.secure) return 'O navegador só libera a localização em http://127.0.0.1, localhost ou https. Abra a interface pela URL do “llm-agent ui”.';
  if (!g.supported) return 'Este navegador não oferece localização.';
  switch (g.errorCode) {
    case undefined:
      return null;
    case 1:
      return 'A localização está bloqueada para este endereço. Libere no ícone ao lado do endereço (cadeado ou alfinete) e tente de novo.';
    case 2:
      return 'O navegador não conseguiu a localização. No Windows, confira Configurações › Privacidade e segurança › Localização.';
    default:
      return 'A localização demorou demais para responder. Tente de novo.';
  }
}

/** Pede a localizacao. Chamado por um clique, o navegador mostra o pedido de permissao. */
export function requestPosition(timeout = 10000): Promise<{ lat: number; lon: number } | { errorCode: number }> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (err) => resolve({ errorCode: err.code }),
      { timeout, maximumAge: 3600e3 },
    );
  });
}
