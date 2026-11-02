// Texto falado: despedidas, limpeza de markdown e divisao em frases.

const GOODBYES = new Set(['tchau', 'tchau jarvis', 'ate mais', 'ate logo', 'ate mais jarvis', 'obrigado tchau', 'valeu tchau']);

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const isGoodbye = (text: string): boolean => GOODBYES.has(normalize(text));

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
    return out;
  }

  flush(): string | null {
    const rest = this.buf.trim();
    this.buf = '';
    return rest || null;
  }
}
