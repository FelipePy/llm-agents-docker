import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Modal, focusableIn, wrapFocus } from '../src/components/Modal.tsx';

const render = (props: { open: boolean; wide?: boolean }) =>
  renderToStaticMarkup(createElement(Modal, { label: 'Notícias', onClose: () => {}, children: createElement('p', null, 'conteudo'), ...props }));

describe('Modal', () => {
  it('fechado, esconde o overlay sem desmontar o conteudo', () => {
    const html = render({ open: false });
    expect(html).toContain('hidden');
    expect(html).toContain('conteudo');
  });
  it('aberto, e um dialogo com nome e botao de fechar', () => {
    const html = render({ open: true });
    expect(html).not.toContain('hidden');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Notícias"');
    expect(html).toContain('aria-label="Fechar"');
  });
  it('so fica largo quando pedido', () => {
    expect(render({ open: true })).toContain('class="modal"');
    expect(render({ open: true, wide: true })).toContain('class="modal wide"');
  });
});

describe('focusableIn', () => {
  it('deixa de fora o que esta num grupo recolhido', () => {
    const visible = { getClientRects: () => [{}] };
    const hidden = { getClientRects: () => [] };
    const root = { querySelectorAll: () => [visible, hidden] } as unknown as ParentNode;
    expect(focusableIn(root)).toEqual([visible]);
  });
});

describe('wrapFocus', () => {
  const items = ['a', 'b', 'c'];
  it('do ultimo, o Tab volta ao primeiro', () => expect(wrapFocus(items, 'c', false)).toBe('a'));
  it('do primeiro, o Shift+Tab vai ao ultimo', () => expect(wrapFocus(items, 'a', true)).toBe('c'));
  it('com o foco na propria janela, o Shift+Tab nao sai dela', () => expect(wrapFocus(items, 'janela', true)).toBe('c'));
  it('no meio, segue a ordem normal', () => {
    expect(wrapFocus(items, 'b', false)).toBeNull();
    expect(wrapFocus(items, 'b', true)).toBeNull();
    expect(wrapFocus(items, 'janela', false)).toBeNull();
  });
  it('sem nada focavel, nao faz nada', () => expect(wrapFocus([], 'x', false)).toBeNull());
});
