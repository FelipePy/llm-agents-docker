// Busca na web para o Jarvis, sem chave de API: resultados do DuckDuckGo (versao
// "lite", HTML simples) e o resumo do artigo mais proximo da Wikipedia em
// portugues, as duas juntas (cerca de 1 s). O DuckDuckGo as vezes bloqueia
// buscas automaticas; ai entra a reserva (a busca do proprio Claude, no plano
// do usuario, mais lenta porem confiavel).

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearch {
  query: string;
  results: WebResult[];
  /** Resumo enciclopedico (Wikipedia), quando houver artigo para o assunto. */
  summary: { title: string; extract: string; url: string } | null;
  /** Resposta da busca de reserva, quando o DuckDuckGo nao trouxe resultados. */
  answer?: string;
  /** Fontes que falharam (ex.: "DuckDuckGo: HTTP 403"). */
  errors: string[];
}

export const DDG_LITE = 'https://lite.duckduckgo.com/lite/';
export const WIKI_API = 'https://pt.wikipedia.org/w/api.php';
// Um User-Agent de navegador completo, vindo do Node, e tratado como robo; o curto passa.
const USER_AGENT = 'Mozilla/5.0';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Texto de um trecho HTML: sem tags, entidades decodificadas, espacos colapsados. */
export function htmlText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Link real de um resultado (o DuckDuckGo as vezes embrulha em /l/?uddg=...); vazio se for anuncio. */
function resultUrl(href: string): string {
  const raw = htmlText(href);
  let url: URL;
  try {
    url = new URL(raw, 'https://duckduckgo.com');
  } catch {
    return '';
  }
  if (url.hostname.endsWith('duckduckgo.com')) {
    const target = url.searchParams.get('uddg');
    if (!target) return ''; // anuncio (y.js) ou link interno
    try {
      url = new URL(target);
    } catch {
      return '';
    }
  }
  return /^https?:$/.test(url.protocol) ? url.href : '';
}

/** Resultados da pagina do DuckDuckGo lite, na ordem, sem anuncios nem repetidos. */
export function parseDuckDuckGoLite(html: string, limit = 6): WebResult[] {
  const out: WebResult[] = [];
  const seen = new Set<string>();
  const links = [...html.matchAll(/<a\b[^>]*class=['"]result-link['"][^>]*>[\s\S]*?<\/a>/g)];
  links.forEach((m, i) => {
    const tag = m[0];
    const href = /href=(['"])(.*?)\1/.exec(tag)?.[2] ?? '';
    const url = resultUrl(href);
    const title = htmlText(tag);
    if (!url || !title || seen.has(url)) return;
    // O resumo vem depois do link e antes do proximo resultado.
    const end = links[i + 1]?.index ?? html.length;
    const rest = html.slice(m.index! + tag.length, end);
    const snippet = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/.exec(rest)?.[1] ?? '';
    seen.add(url);
    out.push({ title, url, snippet: htmlText(snippet) });
  });
  return out.slice(0, limit);
}

/** Primeiro artigo da busca na Wikipedia (resposta da API action=query, formatversion=2). */
export function parseWikipedia(json: unknown): WebSearch['summary'] {
  const pages = (json as { query?: { pages?: { title?: string; extract?: string; fullurl?: string; index?: number }[] } })?.query?.pages;
  if (!pages?.length) return null;
  const page = [...pages].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];
  const extract = (page.extract ?? '').replace(/\s+/g, ' ').trim();
  if (!page.title || !extract) return null;
  return { title: page.title, extract, url: page.fullurl ?? '' };
}

export interface SearchOptions {
  fetch: typeof fetch;
  now?: () => number;
  ddgUrl?: string;
  wikiUrl?: string;
  /** Busca de reserva (texto ja resumido, com as fontes), usada quando o DuckDuckGo falha ou vem vazio. */
  fallback?: (query: string) => Promise<string>;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createSearchService(opts: SearchOptions) {
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { at: number; value: WebSearch }>();
  const TTL = 10 * 60e3;

  async function get(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await opts.fetch(url, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pt-BR,pt;q=0.9', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }

  async function duckduckgo(q: string): Promise<WebResult[]> {
    // GET: o POST do formulario e bloqueado com mais frequencia.
    const res = await get(`${opts.ddgUrl ?? DDG_LITE}?${new URLSearchParams({ q, kl: 'br-pt' })}`);
    const html = await res.text();
    const results = parseDuckDuckGoLite(html);
    if (!results.length && /anomaly|captcha/i.test(html)) throw new Error('bloqueou a busca automática');
    return results;
  }

  async function wikipedia(q: string): Promise<WebSearch['summary']> {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: q,
      gsrlimit: '1',
      prop: 'extracts|info',
      exintro: '1',
      explaintext: '1',
      exsentences: '4',
      inprop: 'url',
      format: 'json',
      formatversion: '2',
    });
    return parseWikipedia(await (await get(`${opts.wikiUrl ?? WIKI_API}?${params}`)).json());
  }

  return {
    async search(query: string): Promise<WebSearch> {
      const q = query.trim().replace(/\s+/g, ' ');
      if (!q) throw new Error('assunto vazio');
      const key = q.toLowerCase();
      const hit = cache.get(key);
      if (hit && now() - hit.at < TTL) return hit.value;
      const [d, w] = await Promise.allSettled([duckduckgo(q), wikipedia(q)]);
      const errors: string[] = [];
      if (d.status === 'rejected') errors.push(`DuckDuckGo: ${message(d.reason)}`);
      if (w.status === 'rejected') errors.push(`Wikipedia: ${message(w.reason)}`);
      const value: WebSearch = {
        query: q,
        results: d.status === 'fulfilled' ? d.value : [],
        summary: w.status === 'fulfilled' ? w.value : null,
        errors,
      };
      if (!value.results.length && opts.fallback) {
        try {
          const answer = (await opts.fallback(q)).trim();
          if (answer) {
            value.answer = answer;
            value.errors = [];
          }
        } catch (err) {
          errors.push(`busca do Claude: ${message(err)}`);
        }
      }
      // So guarda quando nenhuma fonte falhou (ou a reserva cobriu a falha).
      if (!value.errors.length) cache.set(key, { at: now(), value });
      return value;
    },
  };
}
