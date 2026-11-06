import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { copyText, selectionIn } from '../src/clipboard.ts';
import { CopyButton, CopySection } from '../src/components/CopySection.tsx';

/** Documento falso so com o que a copia antiga usa. */
function fakeDoc(execOk: boolean) {
  const area = { value: '', style: {} as Record<string, string>, setAttribute: vi.fn(), select: vi.fn(), remove: vi.fn() };
  const sel = { rangeCount: 1, getRangeAt: () => 'r', removeAllRanges: vi.fn(), addRange: vi.fn() };
  const doc = {
    createElement: () => area,
    body: { appendChild: vi.fn() },
    getSelection: () => sel,
    execCommand: vi.fn(() => execOk),
  } as unknown as Document;
  return { doc, area, sel };
}

describe('copyText', () => {
  it('usa a area de transferencia do navegador quando ela existe', async () => {
    const writeText = vi.fn(async () => {});
    const { doc } = fakeDoc(false);
    expect(await copyText('trecho', doc, { clipboard: { writeText } } as unknown as Navigator)).toBe(true);
    expect(writeText).toHaveBeenCalledWith('trecho');
  });
  it('se a API falhar (Windows), copia pelo campo escondido e devolve a selecao do usuario', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('negado');
    });
    const { doc, area, sel } = fakeDoc(true);
    expect(await copyText('trecho', doc, { clipboard: { writeText } } as unknown as Navigator)).toBe(true);
    expect(area.value).toBe('trecho');
    expect(area.remove).toHaveBeenCalled();
    expect(sel.addRange).toHaveBeenCalledWith('r');
  });
  it('sem API e sem "copy", avisa que falhou', async () => {
    const { doc } = fakeDoc(false);
    expect(await copyText('trecho', doc, {} as Navigator)).toBe(false);
  });
  it('nada para copiar: falha sem tocar em nada', async () => {
    const { doc } = fakeDoc(true);
    expect(await copyText('', doc, {} as Navigator)).toBe(false);
    expect(doc.execCommand).not.toHaveBeenCalled();
  });
});

describe('selectionIn', () => {
  const inside = {};
  const outside = {};
  const root = { contains: (n: unknown) => n === inside } as unknown as Node;
  const sel = (o: Partial<Selection>) => ({ isCollapsed: false, rangeCount: 1, anchorNode: inside, focusNode: inside, toString: () => 'Atualmente: trabalho', ...o }) as unknown as Selection;
  it('o texto selecionado dentro da secao', () => {
    expect(selectionIn(root, sel({}))).toBe('Atualmente: trabalho');
  });
  it('nada quando a selecao esta vazia, fora ou sai da secao', () => {
    expect(selectionIn(root, sel({ isCollapsed: true }))).toBe('');
    expect(selectionIn(root, sel({ anchorNode: outside as Node }))).toBe('');
    expect(selectionIn(root, sel({ focusNode: outside as Node }))).toBe('');
    expect(selectionIn(root, sel({ toString: () => '   ' }))).toBe('');
    expect(selectionIn(null, sel({}))).toBe('');
  });
});

describe('CopySection', () => {
  it('sem texto selecionado nao ha botao (nem para copiar a secao inteira)', () => {
    const html = renderToStaticMarkup(createElement(CopySection, null, createElement('p', null, 'Atualmente')));
    expect(html).toContain('class="panel copy-section"');
    expect(html).not.toContain('copy-selection');
  });
  it('o botao avisa quando copiou e quando falhou', () => {
    const render = (feedback: 'copied' | 'failed' | null) => renderToStaticMarkup(createElement(CopyButton, { feedback, onCopy: () => {} }));
    expect(render(null)).toContain('aria-label="Copiar seleção"');
    expect(render('copied')).toContain('Copiado');
    expect(render('failed')).toContain('Não consegui copiar');
  });
});
