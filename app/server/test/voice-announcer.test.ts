import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Announcer, newsPhrase, periodOf, periodPhrase, startupPhrase } from '../src/voice/announcer.ts';
import type { DayInfo } from '../src/types.ts';

const at = (h: number, m = 0) => new Date(2026, 10, 2, h, m);

test('periodos do dia', () => {
  assert.deepEqual([3, 6, 11, 12, 17, 18, 23].map((h) => periodOf(at(h))), ['madrugada', 'manha', 'manha', 'tarde', 'tarde', 'noite', 'noite']);
});

test('frases de inicio, de periodo e de noticias', () => {
  const weather = { temperature: 24, code: 2, description: 'parcialmente nublado', max: 29, min: 18, place: '' };
  assert.match(startupPhrase(at(14), weather, () => 0), /^Boa tarde, senhor\..*24 graus, parcialmente nublado/);
  assert.match(startupPhrase(at(8), null, () => 0), /^Bom dia, senhor\./);
  assert.match(periodPhrase('tarde', () => 0), /tarde/);
  assert.match(periodPhrase('noite', () => 0.99), /noite/);
  const one = newsPhrase([{ title: 'Chuva forte em SP', source: 'G1', link: '', published: '' }]);
  assert.match(one, /senhor.*G1.*Chuva forte em SP/i);
  const two = newsPhrase([
    { title: 'A', source: 'G1', link: '', published: '' },
    { title: 'B', source: '', link: '', published: '' },
  ]);
  assert.match(two, /A.*G1.*B/);
});

function setup(start: Date, news: string[][] = []) {
  let now = start.getTime();
  const said: string[] = [];
  let busy = false;
  const a = new Announcer({
    now: () => now,
    day: async (): Promise<DayInfo> => ({ weather: null, news: (news.shift() ?? []).map((title) => ({ title, source: 'G1', link: '', published: '' })) }),
    say: (text) => {
      if (busy) return false;
      said.push(text);
      return true;
    },
    newsEveryMs: 90 * 60e3,
    random: () => 0,
  });
  return {
    a,
    said,
    advance: (ms: number) => (now += ms),
    setBusy: (b: boolean) => (busy = b),
  };
}

test('anuncia ao iniciar e quando o periodo muda', async () => {
  const s = setup(at(11, 58), [['N1'], []]);
  await s.a.start();
  assert.match(s.said[0], /^Bom dia, senhor\./);
  s.advance(60e3);
  await s.a.tick();
  assert.equal(s.said.length, 1, '11:59 ainda e manha');
  s.advance(2 * 60e3);
  await s.a.tick();
  assert.match(s.said.at(-1)!, /tarde/);
  s.a.stop();
});

test('noticias: so as novas, a cada intervalo, de dia, e espera quando ocupado', async () => {
  const s = setup(at(9), [[], ['N1', 'N2'], ['N1', 'N3'], ['N3']]);
  await s.a.start(); // a busca do inicio so serve para o clima
  await s.a.tick();
  assert.ok(s.said.some((t) => t.includes('N1') && t.includes('N2')));
  const count = s.said.length;
  s.advance(30 * 60e3);
  await s.a.tick();
  assert.equal(s.said.length, count, 'antes do intervalo, nada');
  s.advance(60 * 60e3);
  s.setBusy(true);
  await s.a.tick();
  assert.equal(s.said.length, count, 'ocupado: tenta depois');
  s.setBusy(false);
  await s.a.tick();
  assert.ok(s.said.at(-1)!.includes('N3') && !s.said.at(-1)!.includes('N1'), 'so a noticia nova');
  s.a.stop();
});

test('noticias nao sao anunciadas de madrugada', async () => {
  const s = setup(at(2), [['N1']]);
  await s.a.start();
  await s.a.tick();
  assert.ok(!s.said.some((t) => t.includes('N1')));
  s.a.stop();
});
