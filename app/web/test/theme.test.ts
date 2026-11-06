import { describe, expect, it } from 'vitest';
import { GLOBE_COLORS, type GlobeColor } from '../src/scene/globe.ts';
import { SYSTEM_TONES, applySystemColor, systemColorVars } from '../src/theme.ts';
import styles from '../src/styles.css?raw';
import three from '../src/three.css?raw';
import float from '../src/voice/float.ts?raw';
import terminal from '../src/components/TerminalView.tsx?raw';

const css = styles + three;
// Todos os dourados que a interface tinha escritos direto no CSS.
const OLD_GOLDS = /#ffc94a|#ffd36b|#ffd98a|#ffe08a|#ffe7a3|#fff3cf|#e8c877|#2a1f08|#4a3510|#4a2e08|#5a3f12|rgba\(255, (209|191|211|179|201)/i;

describe('cor do sistema', () => {
  it('toda cor do globo tem os seus tons', () => {
    expect(Object.keys(SYSTEM_TONES)).toEqual(Object.keys(GLOBE_COLORS));
  });

  it('o dourado continua com os valores de antes', () => {
    expect(SYSTEM_TONES.dourado).toEqual({ main: '#ffc94a', soft: '#ffd36b', light: '#ffd98a', pale: '#ffe7a3', hot: '#fff3cf', dim: '#e8c877', rgb: '255, 209, 102' });
  });

  it('nenhum dourado ficou escrito direto no CSS nem na janela flutuante', () => {
    expect(css).not.toMatch(OLD_GOLDS);
    expect(float).not.toMatch(OLD_GOLDS);
  });

  it('toda variavel usada existe, e o principal da contraste com o texto escuro do botao enviar', () => {
    const vars = systemColorVars('dourado');
    for (const [, name] of (css + float).matchAll(/var\((--sys-[a-z]+)\)/g)) expect(vars).toHaveProperty(name);
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const dark = luminance('#05060a');
    for (const color of Object.keys(SYSTEM_TONES) as GlobeColor[]) {
      expect((luminance(SYSTEM_TONES[color].main) + 0.05) / (dark + 0.05)).toBeGreaterThan(4.5);
    }
  });

  it('nao toca nas cores que nao sao douradas', () => {
    expect(css).toContain('--claude: #e8915a');
    expect(css).toContain('--muted: #7d879c');
    expect(css).toContain('--warn: #f2c14e');
    expect(terminal).not.toContain('--sys-');
  });

  it('aplicar troca as variaveis no documento', () => {
    const set = new Map<string, string>();
    applySystemColor({ style: { setProperty: (name: string, value: string) => void set.set(name, value) } }, 'roxo');
    expect(set.get('--sys-main')).toBe(SYSTEM_TONES.roxo.main);
    expect(set.get('--sys-rgb')).toBe(SYSTEM_TONES.roxo.rgb);
    expect(set.size).toBe(7);
  });
});
