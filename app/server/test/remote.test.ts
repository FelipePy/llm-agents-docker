import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TailscaleRemote, parseStatus, servesPort, type RunResult } from '../src/remote.ts';

const STATUS = JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'pc.tail1.ts.net.' }, CertDomains: ['pc.tail1.ts.net'] });
const SERVING = JSON.stringify({ TCP: { '443': { HTTPS: true } }, Web: { 'pc.tail1.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:7777' } } } } });

function fake(responses: Record<string, RunResult>, bins = ['tailscale']) {
  const calls: string[] = [];
  const remote = new TailscaleRemote({
    run: async (cmd, args) => {
      const key = args.join(' ');
      calls.push(`${cmd} ${key}`);
      return responses[key] ?? { code: 0, out: '' };
    },
    port: () => 7777,
    token: 'a/b',
    bins,
    exists: () => false,
  });
  return { remote, calls };
}

test('parseStatus: nome sem o ponto final e HTTPS pelos dominios de certificado', () => {
  assert.deepEqual(parseStatus(STATUS), { running: true, host: 'pc.tail1.ts.net', https: true });
  assert.deepEqual(parseStatus(JSON.stringify({ BackendState: 'NeedsLogin', Self: {}, CertDomains: null })), { running: false, host: null, https: false });
  assert.deepEqual(parseStatus('lixo'), { running: false, host: null, https: false });
});

test('servesPort: so o proxy da raiz em :443 para esta porta', () => {
  assert.equal(servesPort(SERVING, 7777), true);
  assert.equal(servesPort(SERVING, 8888), false);
  assert.equal(servesPort('{}', 7777), false);
  assert.equal(servesPort('', 7777), false);
  const other = JSON.stringify({ Web: { 'pc.tail1.ts.net:8443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:7777' } } } } });
  assert.equal(servesPort(other, 7777), false);
});

test('status: servindo, com o link e a origem do celular', async () => {
  const { remote } = fake({ 'status --json': { code: 0, out: STATUS }, 'serve status --json': { code: 0, out: SERVING } });
  assert.deepEqual(remote.origins(), []);
  const s = await remote.status();
  assert.equal(s.serving, true);
  assert.equal(s.link, 'https://pc.tail1.ts.net/#token=a%2Fb');
  assert.equal(s.problem, null);
  assert.deepEqual(remote.origins(), ['https://pc.tail1.ts.net']);
});

test('status: sem servir, sem link', async () => {
  const { remote } = fake({ 'status --json': { code: 0, out: STATUS }, 'serve status --json': { code: 0, out: '{}' } });
  const s = await remote.status();
  assert.equal(s.serving, false);
  assert.equal(s.link, null);
});

test('status: nao instalado, desconectado e sem HTTPS viram um problema explicado', async () => {
  assert.match((await fake({ 'status --json': { code: 127, out: 'spawn tailscale ENOENT' } }).remote.status()).problem!, /não instalado/);
  assert.match((await fake({}, ['/opt/tailscale']).remote.status()).problem!, /não instalado/);
  const off = JSON.stringify({ BackendState: 'Stopped', Self: { DNSName: 'pc.tail1.ts.net.' } });
  assert.match((await fake({ 'status --json': { code: 1, out: off } }).remote.status()).problem!, /desconectado/);
  const noHttps = JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'pc.tail1.ts.net.' }, CertDomains: [] });
  const s = await fake({ 'status --json': { code: 0, out: noHttps } }).remote.status();
  assert.match(s.problem!, /HTTPS/);
  assert.equal(s.link, null);
});

test('set: liga e desliga o serve desta porta', async () => {
  const { remote, calls } = fake({ 'status --json': { code: 0, out: STATUS } });
  await remote.set(true);
  assert.ok(calls.includes('tailscale serve --bg --https=443 http://127.0.0.1:7777'));
  await remote.set(false);
  assert.ok(calls.includes('tailscale serve --https=443 off'));
});

test('set: erro do tailscale vira a mensagem', async () => {
  const { remote } = fake({
    'status --json': { code: 0, out: STATUS },
    'serve --bg --https=443 http://127.0.0.1:7777': { code: 1, out: 'Serve is not enabled on your tailnet.\nTo enable, visit: https://login.tailscale.com/f/serve' },
  });
  await assert.rejects(remote.set(true), /Serve is not enabled/);
  await assert.rejects(fake({ 'status --json': { code: 127, out: '' } }).remote.set(true), /não instalado/);
});

test('o tailscale.exe do Windows tem preferencia quando existe', async () => {
  const calls: string[] = [];
  const remote = new TailscaleRemote({
    run: async (cmd) => (calls.push(cmd), { code: 0, out: STATUS }),
    port: () => 7777,
    token: 't',
    bins: ['/mnt/c/Tailscale/tailscale.exe', 'tailscale'],
    exists: (p) => p === '/mnt/c/Tailscale/tailscale.exe',
  });
  await remote.status();
  assert.equal(calls[0], '/mnt/c/Tailscale/tailscale.exe');
});
