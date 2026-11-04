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

const GREETINGS = new Set(['hey', 'hei', 'ei', 'oi', 'ola', 'fala', 'ok', 'okay', 'alo', 'rei']);
// Grafias que o whisper costuma produzir para "Jarvis".
const JARVIS = new Set(['jarvis', 'javis', 'jarvas', 'jarves', 'jarbas', 'jarviz', 'djarvis', 'jarvi', 'garvis']);

/** Distancia de edicao (insercoes, remocoes e trocas de letra). */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/**
 * Palavra que o whisper escreveu no lugar de "Jarvis" ("Charvis", "Jervis", "Jarbis"...):
 * troca os sons parecidos (ch/dj/g/y -> j, b/w -> v, z -> s) e aceita uma letra de diferenca.
 */
export function isJarvisWord(word: string): boolean {
  const w = normalize(word).replace(/\s/g, '');
  if (JARVIS.has(w)) return true;
  if (w.length < 5 || w.length > 8) return false;
  const sound = w.replace(/^(dj|ch|sh|g|y)/, 'j').replace(/[bw]/g, 'v').replace(/z/g, 's').replace(/y/g, 'i');
  return editDistance(sound, 'jarvis') <= 1;
}

/**
 * Fala que comeca chamando o Jarvis ("Jarvis", "Ei, Jarvis, abre o meu-app").
 * Devolve o pedido que veio junto (vazio se foi so o chamado), ou null.
 * O nome pode vir mal escrito pelo whisper, ou partido em dois ("Jar vis").
 */
export function matchWake(text: string): { rest: string } | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  if (words.length > 1 && normalize(words[0]) === 'e' && normalize(words[1]) === 'ai') i = 2;
  else if (words.length && GREETINGS.has(normalize(words[0]))) i = 1;
  if (i >= words.length) return null;
  let next = i + 1;
  if (!isJarvisWord(words[i])) {
    const head = normalize(words[i]);
    const split = i + 1 < words.length && head.length >= 2 && head.length <= 3 && /^(j|g|ch|dj|y)/.test(head) && isJarvisWord(words[i] + words[i + 1]);
    if (!split) return null;
    next = i + 2;
  }
  return { rest: words.slice(next).join(' ').replace(/^[\s,.:;!?-]+/, '').trim() };
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

/** Começos que corrigem ou desdizem o que a pessoa acabou de falar. */
const CORRECTIONS = [
  'nao', 'na verdade', 'quer dizer', 'digo', 'melhor', 'esquece', 'ao inves', 'em vez', 'mudei de ideia',
  'pensando bem', 'corrigindo', 'ops', 'opa', 'pera', 'espera',
];

/** A fala nova corrige ou contradiz a anterior ("não, abre o outro", "na verdade...")? */
export function isCorrection(text: string): boolean {
  const n = normalize(text);
  return CORRECTIONS.some((c) => n === c || n.startsWith(`${c} `));
}

/**
 * A pessoa fez uma pausa e continuou: junta as duas falas numa so. Se a nova
 * corrige a anterior, vale so a nova.
 */
export function mergeUtterances(first: string, second: string): string {
  if (isCorrection(second)) return second.trim();
  return `${first.trim().replace(/[.!?…]+$/, '')} ${second.trim()}`.trim();
}

// Sons sem conteudo: hesitacoes e interjeicoes que o whisper transcreve de ruido ou respiracao.
const FILLERS = new Set([
  'a', 'ah', 'aah', 'ahn', 'an', 'e', 'eh', 'ehh', 'er', 'hum', 'humm', 'hmm', 'hm', 'mm', 'mmm', 'uh', 'uhh', 'uhm', 'um',
  'hein', 'ha', 'hah', 'he', 'hehe', 'haha', 'kk', 'kkk', 'o', 'oh', 'ooh', 'u', 'ue', 'ufa', 'psiu', 'tsc', 'ai',
]);
// Palavras de uma ou duas letras que sozinhas ainda sao uma resposta.
const SHORT_OK = new Set(['ok', 'oi', 'ja', 'la', 'eu', 'so', 'tu', 'vc']);
// Frases que o whisper inventa em silencio/ruido (vem dos dados de treino com legendas).
const HALLUCINATIONS = [
  /\blegenda(s|do)? (pela|por) /,
  /\bamara org\b/,
  /\b(obrigad[oa]|valeu) (por|pela) (assistir|atencao|ver)\b/,
  /\binscrev(a|e) se\b/,
  /\b(se inscreva|ative o sininho|deixe (o )?seu like)\b/,
  /^(musica|aplausos|risos|silencio|ruido|som|barulho|inaudivel)$/,
];

/**
 * A transcricao nao e uma fala entendida: vazia, so hesitacoes ("hmm", "ahn"),
 * so anotacoes ("[Música]"), alfabeto estranho (ruido virando japones), uma
 * palavra repetida, um fragmento de letra ou uma frase que o whisper inventa no
 * silencio ("Legendas pela comunidade Amara.org"). Usado nas falas captadas
 * enquanto o Jarvis responde: nesse momento ruido e eco viram "fala" com
 * facilidade, e nao devem virar pedido.
 */
export function isUnintelligible(text: string): boolean {
  // Anotacoes entre colchetes/parenteses e notas musicais nao sao fala.
  const spoken = text.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]/g, ' ');
  const n = normalize(spoken);
  if (!n) return true;
  // Muitas letras fora do alfabeto latino (o normalize as remove): ruido "transcrito" em outra lingua.
  const letters = (spoken.match(/\p{L}/gu) ?? []).length;
  const latin = n.replace(/[^a-z]/g, '').length;
  if (letters >= 4 && latin / letters < 0.5) return true;
  if (HALLUCINATIONS.some((re) => re.test(n))) return true;
  const words = n.split(' ');
  if (words.every((w) => FILLERS.has(w) || /^(h+|m+|a+h*|e+h*|u+h*|hu+m+)$/.test(w))) return true;
  // Uma palavra so, de uma ou duas letras (fala cortada: "de", "pr").
  if (words.length === 1 && words[0].length <= 2 && !SHORT_OK.has(words[0]) && !/^\d+$/.test(words[0])) return true;
  // A mesma palavra 4+ vezes e nada mais ("a a a a", "não não não não não"): o whisper em loop.
  if (words.length >= 4 && new Set(words).size === 1) return true;
  return false;
}

// Verbos de comando no inicio da fala ("abre o meu-app", "pesquisa o dolar").
const COMMAND_VERBS = new Set([
  'abre', 'abra', 'abrir', 'fecha', 'feche', 'mostra', 'mostre', 'pesquisa', 'pesquise', 'procura', 'procure', 'busca', 'busque',
  'manda', 'mande', 'envia', 'envie', 'cria', 'crie', 'liga', 'ligue', 'desliga', 'desligue', 'conta', 'conte', 'fala', 'fale',
  'diz', 'diga', 'explica', 'explique', 'repete', 'repita', 'volta', 'continua', 'continue', 'lembra', 'anota', 'esquece', 'roda', 'rode',
  'muda', 'mude', 'troca', 'troque', 'resume', 'resuma', 'traduz', 'traduza', 'calcula', 'calcule', 'qual', 'quais', 'quanto', 'quantos',
  'quanta', 'quantas', 'quando', 'onde', 'como', 'quem', 'porque', 'por que', 'e se',
]);

/**
 * Fala que claramente e um pedido ao Jarvis: pergunta (o whisper poe "?"),
 * correcao ("nao...", "na verdade...") ou comando/pergunta no inicio.
 * Usado nas interrupcoes: o que nao for claro passa pelo juiz.
 */
export function looksLikeRequest(text: string): boolean {
  if (/\?\s*$/.test(text)) return true;
  if (isCorrection(text)) return true;
  const n = normalize(text);
  const [first = '', second = ''] = n.split(' ');
  return COMMAND_VERBS.has(first) || COMMAND_VERBS.has(`${first} ${second}`);
}

// Palavras de uma fala que so pede para parar ("para", "espera ai", "chega, Jarvis, por favor").
const STOP_ONLY = new Set([
  'para', 'pare', 'parar', 'espera', 'espere', 'pera', 'chega', 'cala', 'calar', 'boca', 'silencio', 'ai', 'ei', 'ok', 'por', 'favor',
  'um', 'pouco', 'momento', 'segundo', 'so', 'agora', 'ja', 'a', 'jarvis', 'javis', 'jarbas',
]);

const STOP_TRIGGERS = new Set(['para', 'pare', 'parar', 'espera', 'espere', 'pera', 'chega', 'cala', 'calar', 'silencio', 'jarvis', 'javis', 'jarbas']);

/** Fala que so pede para o Jarvis parar ("para", "espera ai"): "para" no meio de uma frase nao conta. */
export function isShortStop(text: string): boolean {
  const words = normalize(text).split(' ').filter(Boolean);
  return words.length > 0 && words.length <= 5 && words.some((w) => STOP_TRIGGERS.has(w)) && words.every((w) => STOP_ONLY.has(w));
}

// Palavras que nao fecham uma frase: conjuncoes, preposicoes, artigos, possessivos e hesitacoes.
// Comparadas com acento ("é" e verbo e fecha a frase; "e" e ligacao). O usuario pode trocar a lista.
export const DEFAULT_CONTINUATION_WORDS: readonly string[] = [
  'e', 'ou', 'mas', 'nem', 'que', 'porque', 'pois', 'quando', 'como', 'se', 'então', 'entao', 'tipo',
  'pra', 'pro', 'pras', 'pros', 'para', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'num', 'numa', 'com', 'sem', 'por', 'pelo', 'pela', 'pelos', 'pelas', 'sobre', 'entre', 'até', 'ate', 'ao', 'aos',
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'seus', 'suas', 'nosso', 'nossa', 'esse', 'essa', 'este', 'esta',
  'o meu', 'a minha', 'hum', 'hmm', 'ahn', 'eh', 'tipo assim',
];

/** Palavras de uma fala, minusculas, sem pontuacao (o acento fica). */
const spokenWords = (text: string): string[] => text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);

/** Uma entrada da lista de palavras de continuacao como sera comparada ("O meu," -> "o meu"); vazia se nao sobrar nada. */
export const continuationWord = (word: string): string => spokenWords(word).join(' ');

/**
 * A fala parou no meio da frase? Termina numa das palavras de continuacao ("abre o projeto e",
 * "qual o tempo em"; uma entrada pode ter varias palavras, como "o meu"), em virgula ou
 * reticencias. Pergunta e exclamacao fecham a frase. Com a lista vazia, nenhuma fala e
 * tratada como incompleta.
 */
export function looksIncomplete(text: string, words: readonly string[] = DEFAULT_CONTINUATION_WORDS): boolean {
  const t = text.trim();
  if (!t || !words.length || /[?!]\s*$/.test(t)) return false;
  if (/(\.\.\.|…|[,;:—-])\s*$/.test(t)) return true;
  const tail = ` ${spokenWords(t).join(' ')}`;
  return words.some((w) => {
    const entry = continuationWord(w);
    return entry !== '' && tail.endsWith(` ${entry}`);
  });
}

/** Digitos falados por extenso ("meia" e o seis falado em telefones e senhas). */
const DIGIT_WORDS: Record<string, string> = {
  zero: '0', um: '1', uma: '1', dois: '2', duas: '2', tres: '3', quatro: '4', cinco: '5', seis: '6', meia: '6', sete: '7', oito: '8', nove: '9',
};

/**
 * Fala que e so uma senha numerica ("123456", "1 2 3 4 5 6", "um dois tres quatro",
 * "a senha e 4321"): devolve os digitos, ou null. Qualquer outra palavra no meio faz
 * nao ser senha (uma conversa com numeros nao vira tentativa). Numeros compostos por
 * extenso ("doze") nao contam: a senha se fala digito por digito.
 */
export function spokenPin(text: string, min = 4, max = 6): string | null {
  const words = normalize(text).replace(/^(a |minha )?(senha|codigo)( e)?\b/, '').split(' ').filter(Boolean);
  let digits = '';
  for (const w of words) {
    if (/^[0-9]+$/.test(w)) digits += w;
    else if (DIGIT_WORDS[w]) digits += DIGIT_WORDS[w];
    else return null;
  }
  return digits.length >= min && digits.length <= max ? digits : null;
}
