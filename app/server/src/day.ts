import type { DayInfo, NewsItem, Weather } from './types.ts';

export const NEWS_DEFAULT = 'https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419';

const WMO: [number[], string][] = [
  [[0], 'céu limpo'],
  [[1], 'poucas nuvens'],
  [[2], 'parcialmente nublado'],
  [[3], 'nublado'],
  [[45, 48], 'neblina'],
  [[51, 53, 55], 'garoa'],
  [[56, 57], 'garoa congelante'],
  [[61, 63, 65], 'chuva'],
  [[66, 67], 'chuva congelante'],
  [[71, 73, 75, 77], 'neve'],
  [[80, 81, 82], 'pancadas de chuva'],
  [[85, 86], 'pancadas de neve'],
  [[95], 'trovoadas'],
  [[96, 99], 'trovoadas com granizo'],
];

export function describeWeather(code: number): string {
  return WMO.find(([codes]) => codes.includes(code))?.[1] ?? 'tempo indefinido';
}

const decode = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

const tag = (xml: string, name: string): string => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decode(m[1]) : '';
};

/** Itens de um RSS: titulo (sem o " - Fonte" do Google), fonte, link http(s) e data. */
export function parseRss(xml: string, limit = 8): NewsItem[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  return items
    .slice(0, limit)
    .map((item) => {
      const source = tag(item, 'source');
      let title = tag(item, 'title');
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      const link = tag(item, 'link');
      return { title, source, link: /^https?:\/\//.test(link) ? link : '', published: tag(item, 'pubDate') };
    })
    .filter((n) => n.title);
}

export interface DayOptions {
  fetch: typeof fetch;
  /** Cidade usada quando o navegador nao manda coordenadas. */
  city?: string;
  newsUrl: string;
  now?: () => number;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createDayService(opts: DayOptions) {
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; value: unknown }>();

  /** So guarda resultados de sucesso. */
  async function memo<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttl) return hit.value as T;
    const value = await load();
    cache.set(key, { at: now(), value });
    return value;
  }

  async function get(url: string): Promise<Response> {
    const res = await opts.fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${new URL(url).host}`);
    return res;
  }

  async function locate(lat?: number, lon?: number): Promise<{ lat: number; lon: number; place: string }> {
    if (lat !== undefined && lon !== undefined) return { lat, lon, place: '' };
    const city = opts.city;
    if (!city) throw new Error('Permita a localização no navegador ou defina LLM_AGENT_UI_CITY.');
    return memo(`geo:${city}`, 24 * 3600e3, async () => {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt`;
      const r = (await (await get(url)).json()).results?.[0];
      if (!r) throw new Error(`Cidade não encontrada: ${city}`);
      return { lat: r.latitude, lon: r.longitude, place: r.name };
    });
  }

  async function weather(lat?: number, lon?: number): Promise<Weather> {
    const loc = await locate(lat, lon);
    return memo(`w:${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`, 15 * 60e3, async () => {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
        '&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1';
      const d = await (await get(url)).json();
      const code = Number(d.current?.weather_code);
      return {
        temperature: Math.round(d.current?.temperature_2m),
        code,
        description: describeWeather(code),
        max: Math.round(d.daily?.temperature_2m_max?.[0]),
        min: Math.round(d.daily?.temperature_2m_min?.[0]),
        place: loc.place,
      };
    });
  }

  const news = (): Promise<NewsItem[]> => memo('news', 30 * 60e3, async () => parseRss(await (await get(opts.newsUrl)).text()));

  return {
    async day(lat?: number, lon?: number): Promise<DayInfo> {
      const [w, n] = await Promise.allSettled([weather(lat, lon), news()]);
      return {
        weather: w.status === 'fulfilled' ? w.value : null,
        ...(w.status === 'rejected' ? { weatherError: message(w.reason) } : {}),
        news: n.status === 'fulfilled' ? n.value : [],
        ...(n.status === 'rejected' ? { newsError: message(n.reason) } : {}),
      };
    },
  };
}
