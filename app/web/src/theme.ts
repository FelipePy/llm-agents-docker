import type { GlobeColor } from './scene/globe.ts';

// Cor do sistema: o que era dourado na interface vem destas variaveis CSS, e a cor escolhida nas
// configuracoes as troca na hora. Fica fora o que nao e dourado (cinzas, avisos, agentes) e o terminal.

/** Os tons de uma cor, do mais forte ao mais claro; `rgb` serve as bordas e brilhos com transparencia. */
export interface SystemTones {
  main: string;
  soft: string;
  light: string;
  pale: string;
  hot: string;
  dim: string;
  rgb: string;
}

/** O dourado guarda os valores que a interface sempre teve. */
export const SYSTEM_TONES: Record<GlobeColor, SystemTones> = {
  dourado: { main: '#ffc94a', soft: '#ffd36b', light: '#ffd98a', pale: '#ffe7a3', hot: '#fff3cf', dim: '#e8c877', rgb: '255, 209, 102' },
  ciano: { main: '#4fd6ff', soft: '#6fdeff', light: '#93e7ff', pale: '#b5efff', hot: '#dcf8ff', dim: '#7cc9e0', rgb: '102, 219, 255' },
  branco: { main: '#d6deea', soft: '#e0e6f0', light: '#e8edf4', pale: '#f0f3f8', hot: '#ffffff', dim: '#c0c8d6', rgb: '220, 226, 236' },
  vermelho: { main: '#ff6b6b', soft: '#ff8585', light: '#ff9f9f', pale: '#ffbdbd', hot: '#ffe0e0', dim: '#e08c8c', rgb: '255, 118, 118' },
  verde: { main: '#5fe08a', soft: '#7ae69f', light: '#97ecb4', pale: '#b6f2cb', hot: '#dcfae6', dim: '#86cf9f', rgb: '112, 228, 150' },
  roxo: { main: '#b794ff', soft: '#c5a8ff', light: '#d2bbff', pale: '#e0d0ff', hot: '#f0e8ff', dim: '#b8a3e0', rgb: '190, 160, 255' },
};

/** Variaveis CSS de uma cor; o que nao mudar de cor nao passa por aqui. */
export function systemColorVars(color: GlobeColor): Record<string, string> {
  const t = SYSTEM_TONES[color];
  return {
    '--sys-main': t.main,
    '--sys-soft': t.soft,
    '--sys-light': t.light,
    '--sys-pale': t.pale,
    '--sys-hot': t.hot,
    '--sys-dim': t.dim,
    '--sys-rgb': t.rgb,
  };
}

/** Aplica a cor num documento: a pagina e, quando aberta, a janela flutuante. */
export function applySystemColor(root: { style: Pick<CSSStyleDeclaration, 'setProperty'> }, color: GlobeColor): void {
  for (const [name, value] of Object.entries(systemColorVars(color))) root.style.setProperty(name, value);
}
