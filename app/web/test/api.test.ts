import { describe, expect, it, vi } from 'vitest';
import { Api, LiveSocket, backoff, takeToken, wsUrl, type Status } from '../src/api.ts';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe('takeToken', () => {
  it('le o token do fragmento, guarda e limpa a URL', () => {
    const storage = memoryStorage();
    const replace = vi.fn();
    expect(takeToken({ hash: '#token=abc%2D1', pathname: '/', search: '?x=1' }, storage, replace)).toBe('abc-1');
    expect(storage.getItem('llm-agent-token')).toBe('abc-1');
    expect(replace).toHaveBeenCalledWith('/?x=1');
  });
  it('sem fragmento, usa o token guardado', () => {
    const storage = memoryStorage();
    storage.setItem('llm-agent-token', 'salvo');
    expect(takeToken({ hash: '', pathname: '/', search: '' }, storage, vi.fn())).toBe('salvo');
  });
  it('sem nada, devolve null', () => {
    expect(takeToken({ hash: '', pathname: '/', search: '' }, memoryStorage(), vi.fn())).toBeNull();
  });
});

it('backoff dobra ate 10 s', () => {
  expect([0, 1, 2, 3, 4, 5, 10].map(backoff)).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000]);
});

it('wsUrl usa ws ou wss conforme o protocolo', () => {
  expect(wsUrl({ protocol: 'http:', host: '127.0.0.1:7777' }, 'a b')).toBe('ws://127.0.0.1:7777/ws?token=a%20b');
  expect(wsUrl({ protocol: 'https:', host: 'x' }, 't')).toBe('wss://x/ws?token=t');
});

it('Api manda o token no cabecalho e falha com o status', async () => {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
  );
  const api = new Api('tok', fetchImpl as unknown as typeof fetch);
  await api.overview();
  expect(fetchImpl).toHaveBeenCalledWith('/api/overview', { headers: { authorization: 'Bearer tok' } });
  const failing = new Api('tok', (async () => new Response('', { status: 401 })) as unknown as typeof fetch);
  await expect(failing.project('x')).rejects.toThrow('401');
});

class FakeWS {
  static instances: FakeWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (e: { data: string }) => void;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
}

it('LiveSocket reconecta com espera crescente e so envia aberto', () => {
  FakeWS.instances = [];
  const statuses: Status[] = [];
  const messages: unknown[] = [];
  const delays: number[] = [];
  const timers: (() => void)[] = [];
  const socket = new LiveSocket('ws://x/ws', (m) => messages.push(m), (s) => statuses.push(s), {
    WebSocketImpl: FakeWS as unknown as typeof WebSocket,
    schedule: (fn, ms) => { delays.push(ms); timers.push(fn); },
  });
  const first = FakeWS.instances[0];
  expect(socket.send({ type: 'attach', id: '1' })).toBe(false);
  first.open();
  expect(socket.send({ type: 'attach', id: '1' })).toBe(true);
  expect(first.sent).toEqual(['{"type":"attach","id":"1"}']);
  first.onmessage?.({ data: '{"type":"changed"}' });
  expect(messages).toEqual([{ type: 'changed' }]);
  first.close();
  timers.shift()!();
  FakeWS.instances[1].close();
  timers.shift()!();
  expect(delays).toEqual([500, 1000]);
  expect(FakeWS.instances).toHaveLength(3);
  FakeWS.instances[2].open();
  expect(statuses).toEqual(['connecting', 'open', 'closed', 'connecting', 'closed', 'connecting', 'open']);
  socket.stop();
  expect(timers).toHaveLength(0);
});

it('Api.day manda as coordenadas arredondadas, quando existem', async () => {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    return new Response('{"weather":null,"news":[]}', { status: 200 });
  }) as unknown as typeof fetch;
  const api = new Api('tok', fetchImpl);
  await api.day({ lat: -23.55052, lon: -46.633308 });
  await api.day();
  expect(urls).toEqual(['/api/day?lat=-23.551&lon=-46.633', '/api/day']);
});

it('timingText resume os tempos da ultima resposta', async () => {
  const { timingText } = await import('../src/voice/client.ts');
  expect(timingText({ state: 'sleeping', user: '', jarvis: '', timing: { stt: 1240, firstToken: 2100, firstAudio: 2950 } })).toBe(
    'última resposta: transcrição 1,2 s · 1ª palavra 2,1 s · voz 3,0 s',
  );
  expect(timingText({ state: 'sleeping', user: '', jarvis: '' })).toBe('');
});
