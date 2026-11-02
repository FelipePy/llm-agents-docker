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

/** Corta o texto em streaming em frases: pontuacao final seguida de espaco, ou quebra de linha. */
export class SentenceSplitter {
  private buf = '';

  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    const re = /[.!?…]+\s+|\n+/g;
    let last = 0;
    for (let m = re.exec(this.buf); m; m = re.exec(this.buf)) {
      const sentence = this.buf.slice(last, m.index + m[0].length).trim();
      if (sentence) out.push(sentence);
      last = m.index + m[0].length;
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
