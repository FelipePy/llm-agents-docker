import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TopActions } from '../src/components/TopActions.tsx';

const render = (filter: string | null) => renderToStaticMarkup(createElement(TopActions, { filter, onFilter: () => {}, onOpen: () => {} }));

describe('TopActions', () => {
  it('fica na ordem: filtro, notícias, configurações', () => {
    const html = render('abc');
    const filter = html.indexOf('placeholder="Filtrar"');
    const news = html.indexOf('aria-label="Notícias"');
    const gear = html.indexOf('aria-label="Configurações"');
    expect(filter).toBeGreaterThan(-1);
    expect(news).toBeGreaterThan(filter);
    expect(gear).toBeGreaterThan(news);
    expect(html).toContain('value="abc"');
  });
  it('sem filtro no nivel atual, mantem os dois botoes', () => {
    const html = render(null);
    expect(html).not.toContain('<input');
    expect(html).toContain('aria-label="Notícias"');
    expect(html).toContain('aria-label="Configurações"');
  });
  it('notícias usa o icone de jornal e configurações a engrenagem', () => {
    const html = render(null);
    expect(html.slice(html.indexOf('aria-label="Notícias"'), html.indexOf('aria-label="Configurações"'))).toContain('<svg');
    expect(html).toContain('⚙');
  });
});
