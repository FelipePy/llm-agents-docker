import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceClient } from '../src/voice/client.ts';
import { startCapture } from '../src/voice/capture.ts';

vi.mock('../src/voice/capture.ts', () => ({ startCapture: vi.fn() }));
vi.mock('../src/voice/player.ts', () => ({
  Player: class {
    stop() {}
    close() {}
    outputRms() {
      return 0;
    }
  },
}));

class FakeSocket {
  static OPEN = 1;
  readyState = FakeSocket.OPEN;
  onopen?: () => void;
  constructor() {
    queueMicrotask(() => this.onopen?.());
  }
  send() {}
  close() {}
}

const LOUD = new Int16Array(10).fill(8000);

describe('VoiceClient.micLevel', () => {
  let feed: (pcm: Int16Array) => void;

  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
    vi.mocked(startCapture).mockImplementation(async (onFrame) => {
      feed = onFrame;
      return () => {};
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const client = async (hold: boolean) => {
    const c = new VoiceClient('t', () => {}, () => {}, () => {}, undefined, hold);
    await c.start();
    return c;
  };

  it('na escuta continua, acompanha o microfone sem apertar nada e zera ao parar', async () => {
    const c = await client(false);
    expect(c.micLevel()).toBe(0);
    feed(LOUD);
    expect(c.micLevel()).toBeGreaterThan(0);
    c.stop();
    expect(c.micLevel()).toBe(0);
  });

  it('no modo atalho, so durante o aperto', async () => {
    const c = await client(true);
    c.state = 'sleeping';
    feed(LOUD);
    expect(c.micLevel()).toBe(0);
    c.holdStart();
    expect(c.micLevel()).toBeGreaterThan(0);
    c.holdEnd();
    expect(c.micLevel()).toBe(0);
  });
});
