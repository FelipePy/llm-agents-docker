import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSearchService, htmlText, parseDuckDuckGoLite, parseWikipedia } from '../src/search.ts';

const row = (href: string, title: string, snippet?: string) => `
  <tr><td valign="top">1.&nbsp;</td><td><a rel="nofollow" href="${href}" class='result-link'>${title}</a></td></tr>
  ${snippet === undefined ? '' : `<tr><td>&nbsp;</td><td class='result-snippet'>
      ${snippet}
  </td></tr>`}
  <tr><td>&nbsp;</td><td><span class='link-text'>site</span></td></tr>`;

const DDG_HTML = `<html><body><table>
${row('https://duckduckgo.com/y.js?ad_domain=anuncio.com&amp;u3=x', 'Anúncio', 'Compre já')}
${row('https://www.binance.com/pt-BR/price/bitcoin', 'Preço de Bitcoin hoje | Binance', '1 <b>Bitcoin</b> custa US$ 77.271,59 &amp; cai 0,84%.')}
${row('//duckduckgo.com/l/?uddg=https%3A%2F%2Fcoinmarketcap.com%2Fpt-br%2F&amp;rut=abc', 'Bitcoin (BTC) &#8211; CoinMarketCap', '1 BTC = R$ 424.829,02.')}
${row('https://www.binance.com/pt-BR/price/bitcoin', 'Repetido', 'x')}
${row('javascript:alert(1)', 'Ruim', 'x')}
${row('https://semresumo.example/', 'Sem resumo')}
</table></body></html>`;

test('htmlText tira tags e decodifica entidades', () => {
  assert.equal(htmlText('  <b>A</b> &amp; B&nbsp;&#8211; &#x43;\n  d &foo; '), 'A & B – C d &foo;');
});

test('parseDuckDuckGoLite: na ordem, sem anuncios, repetidos nem links invalidos', () => {
  assert.deepEqual(parseDuckDuckGoLite(DDG_HTML), [
    { title: 'Preço de Bitcoin hoje | Binance', url: 'https://www.binance.com/pt-BR/price/bitcoin', snippet: '1 Bitcoin custa US$ 77.271,59 & cai 0,84%.' },
    { title: 'Bitcoin (BTC) – CoinMarketCap', url: 'https://coinmarketcap.com/pt-br/', snippet: '1 BTC = R$ 424.829,02.' },
    { title: 'Sem resumo', url: 'https://semresumo.example/', snippet: '' },
  ]);
  assert.equal(parseDuckDuckGoLite(DDG_HTML, 1).length, 1);
  assert.deepEqual(parseDuckDuckGoLite('<html>nada</html>'), []);
});

const WIKI = {
  query: {
    pages: [{ pageid: 1, title: 'Fusão nuclear', index: 1, extract: 'Fusão nuclear é o processo\n no qual núcleos se juntam.', fullurl: 'https://pt.wikipedia.org/wiki/Fus%C3%A3o_nuclear' }],
  },
};

test('parseWikipedia pega o primeiro artigo; sem artigo, null', () => {
  assert.deepEqual(parseWikipedia(WIKI), {
    title: 'Fusão nuclear',
    extract: 'Fusão nuclear é o processo no qual núcleos se juntam.',
    url: 'https://pt.wikipedia.org/wiki/Fus%C3%A3o_nuclear',
  });
  assert.equal(parseWikipedia({ batchcomplete: true }), null);
  assert.equal(parseWikipedia({ query: { pages: [{ title: 'X', extract: '' }] } }), null);
});

function fake(opts: { ddg?: number | string; wiki?: number } = {}) {
  const calls: { url: string; method: string; body: string }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? '') });
    if (url.includes('duckduckgo')) {
      if (typeof opts.ddg === 'number') return new Response('', { status: opts.ddg });
      return new Response(opts.ddg ?? DDG_HTML);
    }
    if (url.includes('wikipedia')) return opts.wiki ? new Response('', { status: opts.wiki }) : Response.json(WIKI);
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}

test('search junta DuckDuckGo e Wikipedia e guarda em cache por 10 minutos', async () => {
  let t = 0;
  const f = fake();
  const s = createSearchService({ fetch: f.impl, now: () => t });
  const r = await s.search('  preço   do bitcoin ');
  assert.equal(r.query, 'preço do bitcoin');
  assert.equal(r.results.length, 3);
  assert.equal(r.summary?.title, 'Fusão nuclear');
  assert.deepEqual(r.errors, []);
  const ddg = new URL(f.calls.find((c) => c.url.includes('duckduckgo'))!.url);
  assert.equal(ddg.searchParams.get('q'), 'preço do bitcoin');
  assert.equal(ddg.searchParams.get('kl'), 'br-pt');
  assert.equal(new URL(f.calls.find((c) => c.url.includes('wikipedia'))!.url).searchParams.get('gsrsearch'), 'preço do bitcoin');
  await s.search('Preço do Bitcoin');
  assert.equal(f.calls.length, 2, 'mesma busca vem do cache');
  t = 11 * 60e3;
  await s.search('preço do bitcoin');
  assert.equal(f.calls.length, 4, 'cache expirou');
  await assert.rejects(s.search('   '), /assunto vazio/);
});

test('search: uma fonte falhando nao derruba a outra, e falhas nao ficam em cache', async () => {
  const f = fake({ ddg: 403 });
  const s = createSearchService({ fetch: f.impl });
  const r = await s.search('fusão nuclear');
  assert.deepEqual(r.results, []);
  assert.equal(r.summary?.title, 'Fusão nuclear');
  assert.deepEqual(r.errors, ['DuckDuckGo: HTTP 403']);
  await s.search('fusão nuclear');
  assert.equal(f.calls.length, 4);
  const blocked = await createSearchService({ fetch: fake({ ddg: '<html>anomaly detected</html>', wiki: 503 }).impl }).search('x');
  assert.deepEqual(blocked.errors, ['DuckDuckGo: bloqueou a busca automática', 'Wikipedia: HTTP 503']);
});

test('search: sem resultados do DuckDuckGo, usa a reserva e esconde a falha coberta', async () => {
  const asked: string[] = [];
  const fallback = async (q: string) => {
    asked.push(q);
    return '  - Dólar a R$ 5,44 (Dólar Hoje)  ';
  };
  const f = fake({ ddg: 403 });
  const s = createSearchService({ fetch: f.impl, fallback });
  const r = await s.search('cotação do dólar');
  assert.equal(r.answer, '- Dólar a R$ 5,44 (Dólar Hoje)');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(asked, ['cotação do dólar']);
  await s.search('cotação do dólar');
  assert.equal(asked.length, 1, 'resposta da reserva fica em cache');
  // Com resultados do DuckDuckGo a reserva nao roda.
  await createSearchService({ fetch: fake().impl, fallback }).search('outra');
  assert.equal(asked.length, 1);
  // Reserva falhando: a falha aparece junto das outras.
  const broken = await createSearchService({ fetch: fake({ ddg: 403 }).impl, fallback: async () => { throw new Error('demorou demais'); } }).search('x');
  assert.deepEqual(broken.errors, ['DuckDuckGo: HTTP 403', 'busca do Claude: demorou demais']);
  assert.equal(broken.summary?.title, 'Fusão nuclear');
});
