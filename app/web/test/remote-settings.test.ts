import { describe, expect, it } from 'vitest';
import type { RemoteStatus } from '../src/api.ts';
import { qrSvg, remoteSteps } from '../src/components/RemoteSettings.tsx';

const base: RemoteStatus = { installed: true, running: true, host: 'pc.t.ts.net', https: true, serving: false, link: null, problem: null };

describe('acesso pelo celular', () => {
  it('marca os passos prontos ate ligar o acesso', () => {
    expect(remoteSteps(base).map((s) => s.done)).toEqual([true, true, true, false, false]);
    expect(remoteSteps({ ...base, installed: false, running: false, https: false }).map((s) => s.done)).toEqual([false, false, false, false, false]);
    expect(remoteSteps({ ...base, serving: true })[3].done).toBe(true);
  });

  it('gera o QR code em SVG', () => {
    const svg = qrSvg('https://pc.t.ts.net/#token=abc');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('#000000');
  });
});
