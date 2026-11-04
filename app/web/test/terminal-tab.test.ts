import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TerminalTab } from '../src/components/TerminalTab.tsx';
import type { SessionInfo } from '../src/types.ts';

const session = { id: 'a', projectPath: '/p/jarvis', agent: 'claude', title: 'Sessão 1', alive: true } as SessionInfo;

const render = (props: { active?: boolean; index?: number } = {}) =>
  renderToStaticMarkup(
    createElement(TerminalTab, {
      session,
      label: 'Claude',
      projectName: 'jarvis',
      index: 0,
      active: false,
      onActivate: () => {},
      onClose: () => {},
      ...props,
    }),
  );

describe('aba do terminal', () => {
  it('mostra a bolinha so na aba ativa, a esquerda do nome', () => {
    expect(render()).not.toContain('dot');
    const html = render({ active: true });
    expect(html).toContain('class="tab active"');
    expect(html.indexOf('class="dot claude"')).toBeGreaterThan(-1);
    expect(html.indexOf('class="dot claude"')).toBeLessThan(html.indexOf('tab-name'));
  });
  it('mostra o nome curto na aba e o completo na dica', () => {
    expect(render()).toContain('title="jarvis · Claude · Sessão 1"');
    expect(render()).toContain('<span class="tab-name">Claude</span>');
  });
  it('marca a aba de sessao encerrada', () => {
    expect(render()).not.toContain('ended');
    const html = renderToStaticMarkup(
      createElement(TerminalTab, { session: { ...session, alive: false }, label: 'Claude', index: 0, active: false, onActivate: () => {}, onClose: () => {} }),
    );
    expect(html).toContain('class="tab tab-ended"');
  });
  it('numera so as abas com atalho (Ctrl+1 a Ctrl+9)', () => {
    expect(render({ index: 8 })).toContain('<kbd>9</kbd>');
    expect(render({ index: 9 })).not.toContain('<kbd>');
  });
});
