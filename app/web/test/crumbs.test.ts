import { describe, expect, it } from 'vitest';
import three from '../src/three.css?raw';

// O corpo de uma regra do CSS, pelo seletor exato.
const rule = (selector: string) => three.split('\n').find((line) => line.startsWith(`${selector} {`)) ?? '';

describe('trilha de navegacao', () => {
  it('os nomes flutuam na pagina, sem contorno nem fundo', () => {
    const button = rule('.crumbs button');
    expect(button).toContain('border: none');
    expect(button).toContain('background: transparent');
    expect(rule('.crumbs .current')).not.toContain('border');
  });

  it('continua legivel sobre o globo e mostra o foco pelo teclado', () => {
    expect(rule('.crumbs')).toContain('drop-shadow');
    expect(three).toContain('.crumbs button:focus-visible');
  });
});
