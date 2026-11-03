export const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Chuva forte em SP - G1]]></title><link>https://g1.example/a</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><source url="https://g1.example">G1</source></item>
<item><title>Bolsa &amp; dólar hoje - Valor</title><link>javascript:alert(1)</link><source url="x">Valor</source></item>
</channel></rss>`;

/** fetch falso: geocodificacao, previsao e RSS. Conta as chamadas. */
export function fakeFetch(opts: { failNews?: boolean } = {}) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('geocoding-api')) {
      return Response.json({ results: [{ latitude: -23.5, longitude: -46.6, name: 'São Paulo' }] });
    }
    if (url.includes('api.open-meteo.com')) {
      return Response.json({
        current: { temperature_2m: 24.6, weather_code: 2 },
        daily: { temperature_2m_max: [29.2], temperature_2m_min: [18.4] },
      });
    }
    if (url.includes('news')) return opts.failNews ? new Response('', { status: 503 }) : new Response(RSS);
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { impl, calls };
}
