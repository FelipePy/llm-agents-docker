// Texto falado: despedidas, limpeza de markdown e divisao em frases.

// Despedidas: uma fala curta (ate 7 palavras) que contenha uma destas.
const GOODBYE = /\b(tchau|xau|ate mais|ate logo|ate amanha|ate depois|ate a proxima|por hoje e so|e so isso|pode descansar|pode dormir|boa noite jarvis|falou jarvis)\b/;

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isGoodbye(text: string): boolean {
  const n = normalize(text);
  return n.split(' ').length <= 7 && GOODBYE.test(n);
}

/** Ditado na sessao: "envia", "manda", "play"... (a fala inteira e so o comando). */
export const isSubmit = (text: string): boolean =>
  /^(envia|enviar|envie|manda|mandar|pode enviar|pode mandar|play|da play|da o play|envia ai|manda ai|manda ver)$/.test(normalize(text));

/** Ditado: "apaga" desfaz o ultimo trecho; "limpa" apaga tudo o que foi ditado. */
export const isErase = (text: string): boolean => /^(apaga|apaga isso|desfaz|desfaz isso|apaga o ultimo)$/.test(normalize(text));
export const isClear = (text: string): boolean => /^(limpa|limpa tudo|apaga tudo|limpar)$/.test(normalize(text));

/** Pedido para o Jarvis parar de falar, dito por cima da fala dele. */
export const isStopRequest = (text: string): boolean =>
  /\b(jarvis|javis|jarbas|para|pare|parar|espera|espere|chega|silencio|cala)\b/.test(normalize(text));

const GREETINGS = new Set(['hey', 'hei', 'ei', 'oi', 'ola', 'fala', 'ok', 'okay', 'alo']);
// Grafias que o whisper costuma produzir para "Jarvis".
const JARVIS = new Set(['jarvis', 'javis', 'jarvas', 'jarves', 'jarbas', 'jarviz', 'djarvis', 'jarvi', 'garvis']);

/**
 * Fala que comeca chamando o Jarvis ("Jarvis", "Ei, Jarvis, abre o meu-app").
 * Devolve o pedido que veio junto (vazio se foi so o chamado), ou null.
 */
export function matchWake(text: string): { rest: string } | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  if (words.length > 1 && normalize(words[0]) === 'e' && normalize(words[1]) === 'ai') i = 2;
  else if (words.length && GREETINGS.has(normalize(words[0]))) i = 1;
  if (i >= words.length || !JARVIS.has(normalize(words[i]))) return null;
  return { rest: words.slice(i + 1).join(' ').replace(/^[\s,.:;!?-]+/, '').trim() };
}

/** "volta", "voltar", "sair": pedido para sair da conversa direta com uma sessao. */
export const isReturn = (text: string): boolean => /^(volta|voltar|volte|sai|sair|pode voltar|para)\b/.test(normalize(text));

export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Corta o texto em streaming em frases: pontuacao final seguida de espaco, ou
 * quebra de linha. O primeiro trecho de cada resposta sai mais cedo, na
 * primeira virgula (ou ";" / ":") depois de `firstMin` caracteres, para a voz
 * comecar logo.
 */
const FIRST_MAX = 48;

export class SentenceSplitter {
  private buf = '';
  private emitted = false;
  private readonly firstMin: number;

  constructor(firstMin = 20) {
    this.firstMin = firstMin;
  }

  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    let last = 0;
    const re = /[.!?…]+\s+|\n+|[,;:]\s+/g;
    for (let m = re.exec(this.buf); m; m = re.exec(this.buf)) {
      const end = m.index + m[0].length;
      const clause = /^[,;:]/.test(m[0]);
      if (clause && (this.emitted || end - last < this.firstMin)) continue;
      const piece = this.buf.slice(last, end).trim();
      if (piece) {
        out.push(piece);
        this.emitted = true;
      }
      last = end;
    }
    this.buf = this.buf.slice(last);
    // Primeiro trecho sem pontuacao ate agora: depois de ~8 palavras, corta no ultimo espaco
    // para a voz comecar (o resto segue no proximo trecho).
    if (!this.emitted && this.buf.length >= FIRST_MAX) {
      const cut = this.buf.lastIndexOf(' ');
      if (cut > this.firstMin) {
        out.push(this.buf.slice(0, cut).trim());
        this.buf = this.buf.slice(cut + 1);
        this.emitted = true;
      }
    }
    return out;
  }

  flush(): string | null {
    const rest = this.buf.trim();
    this.buf = '';
    return rest || null;
  }
}
