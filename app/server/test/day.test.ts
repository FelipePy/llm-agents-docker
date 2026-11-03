import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDayService, describeWeather, parseRss } from '../src/day.ts';
import { RSS, fakeFetch } from './fakes.ts';

test('describeWeather traduz os codigos WMO', () => {
  assert.equal(describeWeather(0), 'céu limpo');
  assert.equal(describeWeather(63), 'chuva');
  assert.equal(describeWeather(999), 'tempo indefinido');
});

test('parseRss le titulo, fonte e link, e descarta links que nao sao http(s)', () => {
  assert.deepEqual(parseRss(RSS), [
    { title: 'Chuva forte em SP', source: 'G1', link: 'https://g1.example/a', published: 'Mon, 02 Nov 2026 10:00:00 GMT' },
    { title: 'Bolsa & dólar hoje', source: 'Valor', link: '', published: '' },
  ]);
  assert.equal(parseRss(RSS, 1).length, 1);
});

test('day com coordenadas: clima e noticias, com cache', async () => {
  const f = fakeFetch();
  let now = 0;
  const service = createDayService({ fetch: f.impl, newsUrl: 'https://news.example/rss', now: () => now });
  const d = await service.day(-23.5, -46.6);
  assert.deepEqual(d.weather, { temperature: 25, code: 2, description: 'parcialmente nublado', max: 29, min: 18, place: '' });
  assert.equal(d.news.length, 2);
  await service.day(-23.5, -46.6);
  assert.equal(f.calls.length, 2, 'segunda chamada usa o cache');
  now = 16 * 60e3;
  await service.day(-23.5, -46.6);
  assert.equal(f.calls.filter((u) => u.includes('api.open-meteo.com')).length, 2, 'clima expira em 15 min');
  assert.equal(f.calls.filter((u) => u.includes('news')).length, 1, 'noticias ainda no cache');
});

test('day sem coordenadas usa a cidade configurada', async () => {
  const f = fakeFetch();
  const service = createDayService({ fetch: f.impl, city: 'São Paulo', newsUrl: 'https://news.example/rss' });
  const d = await service.day();
  assert.equal(d.weather?.place, 'São Paulo');
  assert.ok(f.calls[0].includes('name=S%C3%A3o%20Paulo'));
});

test('day sem localizacao e com noticias fora do ar: erros separados', async () => {
  const service = createDayService({ fetch: fakeFetch({ failNews: true }).impl, newsUrl: 'https://news.example/rss' });
  const d = await service.day();
  assert.equal(d.weather, null);
  assert.match(d.weatherError ?? '', /LLM_AGENT_UI_CITY/);
  assert.deepEqual(d.news, []);
  assert.match(d.newsError ?? '', /503/);
});
