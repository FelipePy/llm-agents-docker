import type { VoiceClientMessage, VoiceServerMessage, VoiceState } from '../types.ts';
import type { Brain, InterruptJudge } from './brain.ts';
import {
  DEFAULT_CONTINUATION_WORDS, SentenceSplitter, isClear, isErase, isGoodbye, isReturn, isShortStop, isStopRequest, isSubmit, isUnintelligible, looksIncomplete, looksLikeRequest, matchWake, mergeUtterances, normalize, spokenPin, stripMarkdown,
} from './text.ts';

export type WorkerCommand =
  | { cmd: 'listen'; barge?: boolean }
  | { cmd: 'sleep' }
  /** Atalho de falar: o audio ate o "release" e uma fala so (sem palavra de ativacao nem silencio). */
  | { cmd: 'hold' }
  | { cmd: 'release' }
  | { cmd: 'cancel' }
  | { cmd: 'speak'; id: number; text: string }
  /** Palavras que o whisper deve reconhecer (nomes de projetos etc.). */
  | { cmd: 'vocab'; words: string[] }
  /** Sintetiza ja e guarda (para as saudacoes tocarem sem espera). */
  | { cmd: 'prefetch'; texts: string[] }
  /** Quem transcreve a fala: o whisper local ou o Groq (nuvem). */
  | { cmd: 'stt'; provider: 'local' | 'groq'; key?: string; model?: string }
  /** Silencio (ms) que encerra a fala do usuario. */
  | { cmd: 'pauses'; end_ms: number }
  /** Vetores da voz (reconhecer o usuario): de trechos PCM em base64 ou de um trecho guardado pelo worker. */
  | { cmd: 'embed'; id: number; audio?: string[]; trim?: boolean; clip?: number };

export type WorkerEvent =
  | { event: 'ready' }
  | { event: 'status'; message: string }
  /** clip: numero do audio da ativacao guardado no worker (para conferir a voz). */
  | { event: 'wake'; score: number; clip?: number }
  | { event: 'speech-start' }
  | { event: 'speech-drop' }
  | { event: 'transcript'; id: number; text: string; ms?: number }
  /**
   * Fala transcrita enquanto o Jarvis espera ser chamado (para "Jarvis, ..."). `id` e o
   * mesmo do "heard-start"; "heard-drop" avisa que a fala nao vai virar "heard" (ruido,
   * longa demais, transcricao vazia).
   */
  | { event: 'heard'; text: string; ms?: number; clip?: number; id?: number }
  | { event: 'heard-start'; id: number }
  | { event: 'heard-drop'; id: number }
  /** Resposta ao "embed": um vetor por trecho (null se curto demais), ou o erro. */
  | { event: 'embedding'; id: number; vectors?: (number[] | null)[]; error?: string }
  | { event: 'audio'; id: number; data: string; last: boolean }
  | { event: 'speak-error'; id: number; message: string }
  | { event: 'error'; message: string; fatal?: boolean }
  | { event: 'exit'; code: number | null };

export interface VoiceWorker {
  ensureReady(): Promise<void>;
  command(cmd: WorkerCommand): void;
  sendAudio(pcm: Buffer): void;
  on(event: 'event', listener: (e: WorkerEvent) => void): unknown;
  off(event: 'event', listener: (e: WorkerEvent) => void): unknown;
}

/** Verificacao da voz de quem chama o Jarvis (so na ativacao). */
export interface SpeakerCheck {
  /** Ha voz cadastrada? Sem ela, qualquer voz ativa o Jarvis. */
  enrolled(): boolean;
  /** O audio da ativacao (trecho guardado no worker) e a voz cadastrada? Erro: nao deu para conferir. */
  verify(clip: number | undefined): Promise<boolean>;
  /**
   * Como o acesso e liberado: chamando "Jarvis" (voz conferida), falando a senha numerica
   * ou dos dois jeitos. Sem isto, so pela voz.
   */
  access?(): 'voice' | 'pin' | 'both';
  /** A senha falada confere? 'locked': tentativas demais, nem confere. */
  verifyPin?(digits: string): boolean | 'locked';
}

export const VOICE_REFUSED = 'Acesso negado.';
/** So a senha libera o acesso e o usuario chamou "Jarvis". */
export const PIN_REQUIRED = 'Fale a senha para liberar o acesso.';
export const PIN_LOCKED = 'Muitas tentativas erradas: espere alguns minutos.';
export const VOICE_CHECK_FAILED = 'Não consegui conferir a sua voz agora; tente de novo em instantes.';

/** Terminal da sessao na conversa direta. Cada funcao devolve falso se a sessao acabou. */
export interface RelayIo {
  /** Digita sem enviar. */
  type(id: string, text: string): boolean;
  /** Envia o que foi digitado (Enter). */
  submit(id: string): boolean;
  /** Apaga `chars` caracteres digitados. */
  erase(id: string, chars: number): boolean;
}

const RESTART_WINDOW_MS = 60_000;

/**
 * Conversa por voz: palavra de ativacao -> ouvir -> pensar -> falar -> ouvir...
 * ate a despedida. Silencio nao encerra.
 *
 * Interromper (falar por cima, "Hey Jarvis" ou Esc) so cala o Jarvis: a
 * resposta em andamento continua em background (ferramentas terminam o que
 * comecaram) e a nova pergunta e respondida assim que ela acabar.
 */
/** Fala detectada e voz acima do eco, com ate este intervalo entre elas, interrompem na hora. */
const BARGE_WINDOW_MS = 800;
/** Ate quanto tempo depois de uma pergunta uma fala nova (antes da resposta) e continuacao dela. */
const CONTINUE_MS = 8000;
/** Ate quanto tempo depois de cortar a resposta a fala seguinte ainda conta como a interrupcao. */
const CUT_IN_MS = 10_000;
/** Ouvindo em silencio ha pelo menos isto, um aviso pedido (sessao terminou) pode ser falado. */
const ANNOUNCE_QUIET_MS = 10_000;
/** Por quanto tempo o cerebro fica sabendo do ultimo aviso falado (para o "conta mais"). */
const NOTICE_CONTEXT_MS = 10 * 60_000;
/** Depois de falar "acesso negado", outros chamados recusados neste intervalo so aparecem na legenda. */
const REFUSE_REPEAT_MS = 30_000;
/**
 * "Jarvis" ... pausa ... "abre o meu-app": a fala depois do chamado (ainda ouvida no modo
 * de espera) vale como o pedido se chegar ate este tempo depois do chamado.
 */
const FOLLOW_UP_MS = 10_000;
/** Fala ouvida em espera sem transcricao nem descarte depois disto e esquecida (o worker trocou de modo). */
const HEARING_STALE_MS = 15_000;
/**
 * Fala que parou no meio da frase ("abre o projeto e"): o worker ja esperou 1 s de
 * silencio; o Jarvis espera mais isto pela continuacao (3 s no total) e entao responde.
 * Padrao sem configuracao; as configuracoes da voz trocam o tempo e as palavras.
 */
const INCOMPLETE_WAIT_MS = 2000;

/** Espera extra por uma fala incompleta e as palavras que a indicam. */
export interface PauseConfig {
  extraWaitMs: number;
  words: readonly string[];
}

export class VoiceSession {
  state: VoiceState = 'off';
  /** Falas do usuario respondidas ate agora (a evolucao exige o "pode comecar" depois do resumo). */
  userTurns = 0;
  private readonly worker: VoiceWorker;
  private readonly brain: Brain;
  private readonly send: (m: VoiceServerMessage) => void;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly bargeIn: boolean;
  private readonly relayIo: RelayIo;
  private readonly vocabulary: (() => Promise<string[]>) | undefined;
  /** Ditado na conversa direta: trechos digitados no terminal desde o ultimo envio. */
  private draft: string[] = [];
  private readonly greetings: string[];
  private lastGreeting = -1;
  private readonly random: () => number;
  private readonly onReady: (() => void) | undefined;
  /** Conversa direta: a voz do usuario vai para esta sessao, sem passar pelo cerebro. */
  private relay: { id: string; label: string } | null = null;
  private readonly listener = (e: WorkerEvent) => this.onWorker(e);
  /** Resposta que pode falar; as anteriores seguem caladas. */
  private turn = 0;
  /** As respostas rodam uma de cada vez, em ordem. */
  private chain: Promise<void> = Promise.resolve();
  private stopController = new AbortController();
  private pending = new Set<number>();
  private nextSpeech = 0;
  private brainDone = true;
  private farewell = false;
  private lastRestart = -Infinity;
  /** O que o Jarvis disse por ultimo (para reconhecer o eco da propria voz no microfone). */
  private spoken = '';
  // Interrupcao imediata: fala detectada (worker) + microfone acima do eco (cliente).
  private lastSpeechStart = -Infinity;
  private lastOverEcho = -Infinity;
  // Pausa e continuacao: a ultima pergunta e a fala que espera a continuacao.
  private lastAsk: { text: string; at: number } | undefined;
  private continuation: string | undefined;
  /** Desde quando esta ouvindo (sem fala do usuario nem resposta). */
  private listeningAt = -Infinity;
  /** O usuario esta falando agora (fala detectada, transcricao ainda nao chegou). */
  private userSpeaking = false;
  /** Ultimo aviso falado sem pedido, para o cerebro entender a resposta do usuario a ele. */
  private lastNotice: { text: string; at: number } | undefined;
  /**
   * O usuario cortou a resposta (falou por cima, chamou o nome ou Esc) e a fala
   * dele ainda nao foi transcrita. Essa transcricao passa pelo filtro de falas
   * nao entendidas: ruido, eco ou fala truncada e descartada em vez de virar pedido.
   */
  private cutInAt = -Infinity;
  /**
   * Resposta pausada porque o usuario falou por cima: o resto dela (a frase
   * cortada e as seguintes) espera a transcricao. Se o que ele disse nao fizer
   * sentido, a resposta continua de onde parou; se fizer, ele responde a isso.
   */
  private held: { turn: number; queue: string[] } | undefined;
  /** Texto de cada fala enviada ao TTS e ainda nao tocada (para retomar). */
  private readonly speechText = new Map<number, string>();
  private judgeSeq = 0;
  private judging: string | undefined;
  private readonly judge: InterruptJudge | undefined;
  private turnAbort = new AbortController();
  private readonly conversation: { start(): void; request(text: string): void; end(): void } | undefined;
  private readonly speaker: SpeakerCheck | undefined;
  /** Conferindo a voz de quem chamou: outras ativacoes esperam o resultado. */
  private checkingVoice = false;
  /**
   * Chamado em andamento: o pedido que veio junto, as falas ouvidas depois dele (que
   * completam o pedido) e o numero da ultima fala que ja fazia parte do chamado.
   * `awake`: ja acordou sem saudacao, esperando a fala que ainda estava sendo transcrita.
   */
  private call: { rest: string; parts: string[]; ms?: number; after: number; until: number; awake: boolean } | null = null;
  /** Falas que o worker comecou a ouvir em espera e ainda nao transcreveu (numero -> quando). */
  private readonly hearing = new Map<number, number>();
  private lastHeardId = 0;
  /** Falando que nao reconheceu a voz: nada interrompe nem abre a conversa. */
  private refusing = false;
  /** Quando o Jarvis falou "acesso negado" por ultimo (para nao repetir o aviso sem parar). */
  private lastRefusal = -Infinity;
  /** Fala incompleta esperando a continuacao (e o prazo para responder a ela assim mesmo). */
  private unfinished: { text: string; ms?: number; timer?: ReturnType<typeof setTimeout> } | undefined;
  private readonly pauses: () => PauseConfig;
  /**
   * Modo atalho: o usuario fala segurando uma tecla e nada mais e ouvido (o cliente pede
   * na mensagem "start"). Entre as falas o estado e "sleeping", com a conversa em aberto;
   * a voz cadastrada nao e conferida, porque quem aperta a tecla ja esta no computador.
   */
  private holdMode = false;
  /** O usuario esta segurando a tecla agora. */
  private holding = false;
  /** Falas soltas cuja transcricao ainda nao chegou. */
  private holdPending = 0;
  /** Falas ja transcritas esperando a seguinte (apertou de novo antes da resposta). */
  private holdText = '';
  private timing: { heard: number; stt?: number; firstToken?: number; firstAudio?: number; tools: string[] } | undefined;

  constructor(
    worker: VoiceWorker,
    brain: Brain,
    send: (m: VoiceServerMessage) => void,
    now: () => number = Date.now,
    log: (line: string) => void = () => {},
    opts: {
      bargeIn?: boolean;
      /** Conversa direta: digitar no terminal da sessao, enviar (Enter) e apagar. */
      relay?: RelayIo;
      vocabulary?: () => Promise<string[]>;
      /** Frases ditas quando o usuario chama sem pedir nada (vazio: so o som). */
      greetings?: string[];
      random?: () => number;
      /** Chamado quando a escuta fica pronta (para o anunciador comecar). */
      onReady?: () => void;
      /** Registro da conversa (memoria do Jarvis): inicio, cada pedido e fim. */
      conversation?: { start(): void; request(text: string): void; end(): void };
      /** Decide se a fala dita por cima da resposta muda a resposta (sem ele, sempre muda). */
      judge?: InterruptJudge;
      /** Confere a voz de quem chamou (perfil cadastrado). Sem ele, qualquer voz vale. */
      speaker?: SpeakerCheck;
      /** Pausas salvas nas configuracoes, lidas a cada fala (o que foi salvo vale na proxima). */
      pauses?: () => PauseConfig;
    } = {},
  ) {
    this.pauses = opts.pauses ?? (() => ({ extraWaitMs: INCOMPLETE_WAIT_MS, words: DEFAULT_CONTINUATION_WORDS }));
    this.onReady = opts.onReady;
    this.conversation = opts.conversation;
    this.judge = opts.judge;
    this.speaker = opts.speaker;
    this.greetings = (opts.greetings ?? []).map((g) => g.trim()).filter(Boolean);
    this.random = opts.random ?? Math.random;
    this.relayIo = opts.relay ?? { type: () => false, submit: () => false, erase: () => false };
    this.vocabulary = opts.vocabulary;
    this.worker = worker;
    this.brain = brain;
    this.send = send;
    this.now = now;
    this.log = log;
    this.bargeIn = opts.bargeIn ?? true;
  }

  async start(): Promise<void> {
    if (this.state !== 'off') return;
    this.stopController = new AbortController();
    this.worker.on('event', this.listener);
    await this.boot();
  }

  stop(): void {
    if (this.state === 'off') return;
    if (this.holdMode || (this.state !== 'sleeping' && this.state !== 'preparing')) this.conversation?.end();
    this.stopController.abort();
    this.resetHold();
    this.dropUnfinished();
    this.refusing = false;
    this.checkingVoice = false;
    this.call = null;
    this.hearing.clear();
    this.mute();
    this.setRelay(null);
    this.worker.off('event', this.listener);
    this.worker.command({ cmd: 'sleep' });
    this.send({ type: 'stop-audio' });
    this.setState('off');
  }

  audio(pcm: Buffer): void {
    if (this.holdMode && !this.holding) return;
    if (this.state !== 'off' && this.state !== 'preparing') this.worker.sendAudio(pcm);
  }

  client(msg: VoiceClientMessage): void {
    switch (msg.type) {
      case 'start':
        if (this.state === 'off') this.holdMode = msg.hold === true;
        void this.start();
        return;
      case 'hold-start':
        return this.holdStart();
      case 'hold-end':
        return this.holdEnd();
      case 'stop':
        return this.stop();
      case 'interrupt':
        if (this.refusing) return this.endRefusal();
        if (this.state === 'thinking' || this.state === 'speaking') this.interrupt();
        return;
      case 'played':
        this.pending.delete(msg.id);
        this.speechText.delete(msg.id);
        return this.maybeFinish();
      case 'relay-submit':
        return this.relayCommand('submit');
      case 'relay-clear':
        return this.relayCommand('clear');
      case 'over-echo':
        // O microfone esta bem acima do eco da voz do Jarvis. Com fala detectada
        // pelo worker logo antes (ou logo depois, em speech-start): e o usuario.
        this.lastOverEcho = this.now();
        if (this.state === 'speaking' && this.now() - this.lastSpeechStart <= BARGE_WINDOW_MS) this.pause();
        return;
      case 'relay-exit':
        if (this.relay) {
          this.setRelay(null);
          this.send({ type: 'chime' });
        }
        return;
    }
  }

  /** Encerra a conversa depois da resposta atual (ferramenta encerrar_conversa). */
  endConversation(): void {
    if (this.state === 'thinking' || this.state === 'speaking') this.farewell = true;
  }

  /** Conversa direta: envia o ditado, apaga o ultimo trecho ou apaga tudo. */
  private relayCommand(kind: 'submit' | 'erase' | 'clear'): void {
    const target = this.relay;
    if (!target) return;
    let ok = true;
    if (kind === 'submit') {
      ok = this.relayIo.submit(target.id);
      this.draft = [];
    } else if (this.draft.length) {
      const removed = kind === 'erase' ? [this.draft.pop()!] : this.draft.splice(0);
      ok = this.relayIo.erase(target.id, removed.join('').length);
    }
    if (!ok) return this.relayGone();
    this.sendRelay();
  }

  private relayGone(): void {
    this.setRelay(null);
    this.send({ type: 'error', message: 'A sessão da conversa direta foi encerrada; voltei a ouvir você.' });
  }

  private sendRelay(): void {
    this.send({ type: 'relay', target: this.relay?.label ?? null, draft: this.draft.join('').trim() });
  }

  private async boot(detail?: string): Promise<void> {
    this.setState('preparing', detail);
    try {
      await this.worker.ensureReady();
    } catch (err) {
      this.send({ type: 'error', message: String((err as Error)?.message ?? err) });
      this.worker.off('event', this.listener);
      this.setState('off');
      return;
    }
    if (this.state !== 'preparing') return;
    this.setState('sleeping');
    this.worker.command({ cmd: 'sleep' });
    this.brain.warm?.();
    this.judge?.warm?.();
    void this.sendVocabulary();
    if (this.greetings.length) this.worker.command({ cmd: 'prefetch', texts: this.greetings });
    this.onReady?.();
  }

  /**
   * Fala espontanea (anuncios: hora do dia, notícias). So fala se o Jarvis
   * estiver esperando ser chamado; depois volta a esperar. Falso se ocupado.
   * Com whileListening (avisos que o usuario pediu, como "me avisa quando
   * terminar"), fala tambem no meio da conversa, se ele estiver ouvindo em
   * silencio ha um tempo; depois continua ouvindo.
   */
  announce(text: string, opts: { whileListening?: boolean } = {}): boolean {
    if (this.relay) return false;
    const idle =
      this.state === 'listening' &&
      opts.whileListening &&
      !this.userSpeaking &&
      !this.held &&
      this.continuation === undefined &&
      this.now() - this.listeningAt >= ANNOUNCE_QUIET_MS;
    if (this.state !== 'sleeping' && !idle) return false;
    this.turn++;
    this.brainDone = true;
    this.farewell = this.state === 'sleeping';
    this.lastNotice = { text, at: this.now() };
    this.send({ type: 'caption', who: 'jarvis', text });
    this.speak(text);
    return true;
  }

  /** Liga ou desliga a conversa direta com uma sessao. */
  setRelay(target: { id: string; label: string } | null): void {
    if (this.relay?.id === target?.id) return;
    this.relay = target;
    this.draft = [];
    this.sendRelay();
  }

  private async sendVocabulary(): Promise<void> {
    if (!this.vocabulary) return;
    try {
      const words = await this.vocabulary();
      if (this.state !== 'off') this.worker.command({ cmd: 'vocab', words });
    } catch {
      // sem vocabulario: o whisper segue sem dicas
    }
  }

  /**
   * Chamado enquanto esperava: com voz cadastrada, so acorda se a voz de quem
   * chamou for a do usuario; se nao for, avisa e continua esperando.
   * `rest`: o pedido que veio junto do nome; `after`: numero da fala do chamado
   * (as seguintes podem ser a continuacao: "Jarvis" ... pausa ... "abre o meu-app").
   */
  private activate(clip: number | undefined, rest: string, after: number, ms?: number, heard?: string): void {
    if (this.checkingVoice) return;
    if (this.speaker?.enrolled() && this.speaker.access?.() === 'pin') {
      // So a senha libera: o chamado nao abre a conversa (nem o pedido que veio junto).
      this.call = null;
      return this.deny(heard, PIN_REQUIRED);
    }
    this.call = { rest, parts: [], ms, after, until: this.now() + FOLLOW_UP_MS, awake: false };
    if (!this.speaker?.enrolled()) return this.answerCall();
    this.checkingVoice = true;
    const stopped = this.stopController.signal;
    void this.speaker
      .verify(clip)
      .catch((err) => {
        this.log(`verificação da voz falhou: ${String((err as Error)?.message ?? err)}`);
        return null;
      })
      .then((ok) => {
        this.checkingVoice = false;
        if (stopped.aborted || this.state !== 'sleeping') return;
        if (ok) return this.answerCall();
        // A continuacao ouvida durante a verificacao tambem aparece como ignorada.
        const ignored = [heard, ...(this.call?.parts ?? [])].filter(Boolean).join(' ') || undefined;
        this.call = null;
        if (ok === null) return this.refuse(VOICE_CHECK_FAILED, ignored);
        this.deny(ignored);
      });
  }

  /**
   * Voz conferida: acorda. O pedido e o que veio com o nome mais o que foi ouvido
   * depois (durante a verificacao). So o nome, sem pedido: se o usuario ja voltou a
   * falar (a fala ainda esta sendo ouvida ou transcrita), acorda sem saudacao para
   * nao falar por cima e espera essa fala; se nao, cumprimenta.
   */
  private answerCall(): void {
    const call = this.call;
    if (!call) return this.wakeUp(true);
    const request = [call.rest, ...call.parts].filter(Boolean).join(' ');
    if (request) {
      this.call = null;
      this.wakeUp(false);
      this.utterance(request, call.ms);
      return;
    }
    if (this.stillHearing(call.after)) {
      this.log('chamado sem pedido, mas o usuário continuou falando: espera o pedido sem saudação');
      call.awake = true;
      this.wakeUp(false);
      return;
    }
    this.call = null;
    this.wakeUp(true);
  }

  /** Alguma fala depois da `after` ainda esta sendo ouvida ou transcrita no modo de espera? */
  private stillHearing(after: number): boolean {
    const now = this.now();
    for (const [id, at] of this.hearing) {
      if (now - at > HEARING_STALE_MS) this.hearing.delete(id);
      else if (id > after) return true;
    }
    return false;
  }

  /**
   * Fala ouvida em espera logo depois de um chamado: completa o pedido. Durante a
   * verificacao, junta ao chamado; ja acordado (sem saudacao, esperando), vira o pedido.
   * Devolve se a fala foi usada (um "Jarvis" repetido e so descartado).
   */
  private followUp(text: string, ms?: number): boolean {
    const call = this.call;
    if (!call) return false;
    if (this.now() > call.until) {
      this.call = null;
      return false;
    }
    if (this.state === 'sleeping' && this.checkingVoice) {
      if (text) call.parts.push(text);
      if (ms !== undefined) call.ms = ms;
      return true;
    }
    if (call.awake && this.state === 'listening') {
      if (!text) return true;
      this.call = null;
      this.utterance(text, ms);
      return true;
    }
    return false;
  }

  /**
   * Chamado por outra voz: "acesso negado" e nada e executado. A legenda mostra a
   * fala ignorada; outro chamado recusado logo depois nao repete o aviso em voz.
   */
  private deny(heard: string | undefined, text = VOICE_REFUSED): void {
    if (this.now() - this.lastRefusal < REFUSE_REPEAT_MS) {
      this.log('ativação recusada de novo: só na legenda');
      if (heard) this.send({ type: 'caption', who: 'user', text: heard, ignored: true });
      this.send({ type: 'caption', who: 'jarvis', text });
      return;
    }
    this.lastRefusal = this.now();
    this.refuse(text, heard);
  }

  /**
   * Fala em espera que e so uma senha numerica ("123456", ou "Jarvis, 123456"), com o
   * acesso por senha ligado: se conferir, acorda e cumprimenta; se nao, "acesso negado".
   * A senha nunca aparece na legenda nem no log. Devolve se a fala era uma senha.
   */
  private unlockByPin(text: string): boolean {
    const speaker = this.speaker;
    if (!speaker?.enrolled() || !speaker.verifyPin) return false;
    const access = speaker.access?.() ?? 'voice';
    if (access === 'voice') return false;
    const called = matchWake(text);
    const digits = spokenPin(called ? called.rest : text);
    if (!digits) return false;
    this.call = null;
    const ok = speaker.verifyPin(digits);
    if (ok === true) {
      this.log('acesso liberado pela senha');
      // Falada logo depois do aviso ("fale a senha"): o aviso para e a conversa abre.
      if (this.refusing) this.endRefusal();
      this.wakeUp(true);
    } else this.deny(undefined, ok === 'locked' ? PIN_LOCKED : VOICE_REFUSED);
    return true;
  }

  /** Voz nao reconhecida: avisa e volta a esperar, sem abrir conversa nem ouvir pedidos. */
  private refuse(text: string, heard?: string): void {
    this.log(`ativação recusada: ${text}`);
    if (heard) this.send({ type: 'caption', who: 'user', text: heard, ignored: true });
    this.refusing = true;
    this.turn++;
    this.brainDone = true;
    this.farewell = true;
    this.send({ type: 'caption', who: 'jarvis', text });
    this.speak(text);
    // Nem o falar por cima vale: o worker so espera a palavra de ativacao.
    this.worker.command({ cmd: 'sleep' });
  }

  private endRefusal(): void {
    this.refusing = false;
    this.mute();
    this.send({ type: 'stop-audio' });
    this.setState('sleeping');
    this.worker.command({ cmd: 'sleep' });
  }

  /** Acordou; `greet`: chamado sem pedido, responde com uma saudacao. */
  private wakeUp(greet = false): void {
    // Chamado de novo no meio da conversa (para interromper) nao comeca outra.
    if (this.state === 'sleeping') this.conversation?.start();
    this.setState('listening');
    this.worker.command({ cmd: 'listen' });
    if (!greet || !this.greetings.length) {
      this.send({ type: 'chime' });
      return;
    }
    // Sorteia sem repetir a ultima.
    let i = Math.floor(this.random() * this.greetings.length);
    if (this.greetings.length > 1 && i === this.lastGreeting) i = (i + 1) % this.greetings.length;
    this.lastGreeting = i;
    this.turn++;
    this.brainDone = true;
    this.speak(this.greetings[i]);
  }

  /** Uma fala completa do usuario (ja sem ser silencio). */
  private utterance(text: string, ms?: number): void {
    const called = matchWake(text);
    if (this.relay) {
      if (called || isGoodbye(text)) {
        this.setRelay(null);
        this.send({ type: 'chime' });
        const rest = called?.rest ?? '';
        if (rest && !isReturn(rest)) this.ask(rest, ms);
        return;
      }
      if (isSubmit(text)) return this.relayCommand('submit');
      if (isErase(text)) return this.relayCommand('erase');
      if (isClear(text)) return this.relayCommand('clear');
      // Ditado: digita no terminal sem enviar; o envio e por "envia" ou pelo botao.
      this.send({ type: 'caption', who: 'user', text });
      const chunk = (this.draft.length ? ' ' : '') + text;
      if (!this.relayIo.type(this.relay.id, chunk)) return this.relayGone();
      this.draft.push(chunk);
      this.sendRelay();
      return;
    }
    const request = called ? called.rest : text;
    if (!request) return; // so chamou o nome de novo
    this.ask(request, ms);
  }

  /** Apertou o atalho: cala o Jarvis, se ele estiver respondendo, e passa a ouvir. */
  private holdStart(): void {
    if (!this.holdMode || this.holding || this.state === 'off' || this.state === 'preparing') return;
    this.holding = true;
    if (this.state === 'thinking' || this.state === 'speaking') {
      this.mute();
      this.send({ type: 'stop-audio' });
    }
    this.setState('listening');
    this.worker.command({ cmd: 'hold' });
  }

  /** Soltou o atalho: a fala terminou. */
  private holdEnd(): void {
    if (!this.holding) return;
    this.holding = false;
    this.holdPending++;
    this.worker.command({ cmd: 'release' });
    this.setState('thinking');
  }

  /** Transcricao de uma fala solta (vazia: nao havia voz). Com outra fala a caminho, as duas viram uma so. */
  private holdResult(text: string, ms?: number): void {
    if (!this.holdPending) return; // de antes de ligar o modo atalho
    this.holdPending--;
    const heard = this.holdText && text ? mergeUtterances(this.holdText, text) : this.holdText || text;
    if (this.holding || this.holdPending) {
      this.holdText = heard;
      return;
    }
    this.holdText = '';
    if (heard) this.utterance(heard, ms);
    this.maybeFinish();
  }

  private resetHold(): void {
    this.holding = false;
    this.holdPending = 0;
    this.holdText = '';
  }

  private onWorker(e: WorkerEvent): void {
    if (this.state === 'off') return;
    if (this.holdMode) {
      if (e.event === 'wake' || e.event === 'heard' || e.event === 'heard-start' || e.event === 'heard-drop' || e.event === 'speech-start') return;
      if (e.event === 'speech-drop') return this.holdResult('');
      if (e.event === 'transcript') return this.holdResult(e.text.trim(), e.ms);
    }
    // Avisando que nao reconheceu a voz: a fala de quem chamou nao vira pedido.
    if (this.refusing && (e.event === 'speech-start' || e.event === 'speech-drop' || e.event === 'transcript')) return;
    switch (e.event) {
      case 'status':
        if (this.state === 'preparing') this.setState('preparing', e.message);
        return;
      case 'heard-start':
        this.hearing.set(e.id, this.now());
        this.lastHeardId = Math.max(this.lastHeardId, e.id);
        return;
      case 'heard-drop':
        this.hearing.delete(e.id);
        return;
      case 'heard': {
        if (e.id !== undefined) this.hearing.delete(e.id);
        // Senha numerica falada no lugar do "Jarvis" (antes de tudo: nunca vira pedido).
        if ((this.state === 'sleeping' || this.refusing) && this.unlockByPin(e.text)) return;
        const called = matchWake(e.text);
        // Continuacao de um chamado: "Jarvis" ... pausa ... "abre o meu-app".
        if (this.followUp(called ? called.rest : e.text.trim(), e.ms)) return;
        // Chamado pelo nome ("Jarvis", "Jarvis, abre o meu-app") enquanto espera.
        if (this.state !== 'sleeping' || !called) return;
        return this.activate(e.clip, called.rest, e.id ?? this.lastHeardId, e.ms, e.text.trim());
      }
      case 'wake':
        if (this.refusing) return;
        if (this.state === 'sleeping') {
          // A fala que contem a palavra de ativacao ja comecou: so as seguintes sao continuacao.
          this.activate(e.clip, '', this.lastHeardId);
        } else if (this.relay && this.state === 'listening') {
          this.setRelay(null);
          this.send({ type: 'chime' });
        } else if (this.state === 'thinking' || this.state === 'speaking') {
          this.interrupt();
        }
        return;
      case 'speech-start':
        this.userSpeaking = true;
        // Continuando a fala incompleta: o prazo para de correr ate a transcricao chegar.
        if (this.unfinished) clearTimeout(this.unfinished.timer);
        // Pensando (sem audio tocando): o usuario fez uma pausa e continuou falando.
        // A resposta para (por enquanto) e a fala nova sera emendada na anterior.
        if (this.state === 'thinking') {
          if (this.lastAsk && this.now() - this.lastAsk.at <= CONTINUE_MS) this.continuation = this.lastAsk.text;
          this.interrupt(false);
        }
        // Falando, pode ser o eco da propria voz: abaixa o volume (menos eco,
        // transcricao melhor) e decide pela transcricao (abaixo).
        else if (this.state === 'speaking') {
          this.lastSpeechStart = this.now();
          // Voz acima do eco ao mesmo tempo: o usuario falou por cima, para na hora.
          if (this.now() - this.lastOverEcho <= BARGE_WINDOW_MS) this.pause();
          else this.send({ type: 'duck', on: true });
        }
        return;
      case 'speech-drop':
        this.userSpeaking = false;
        // Era ruido: se a resposta anterior tinha sido calada por ele, pergunta de novo.
        if (this.state === 'listening') {
          this.cutInAt = -Infinity;
          if (this.held) return this.resume();
          if (this.unfinished) return this.finishUnfinished();
          this.resumeContinuation();
        }
        return;
      case 'transcript': {
        this.userSpeaking = false;
        const text = e.text.trim();
        if (this.state === 'speaking') {
          if (!text || !this.isUserTalking(text)) {
            this.send({ type: 'duck', on: false }); // era eco: volume normal de novo
            return;
          }
          if (isUnintelligible(text) && !isStopRequest(text)) {
            this.discard(text, 'falando');
            this.send({ type: 'duck', on: false }); // era ruido: segue falando
            return;
          }
          this.pause();
        }
        if (this.state !== 'listening') return;
        if (this.held) return this.onCutIn(text, e.ms);
        const cutIn = this.now() - this.cutInAt <= CUT_IN_MS;
        this.cutInAt = -Infinity;
        if (!text) return this.unfinished ? this.finishUnfinished() : this.resumeContinuation();
        // Fala que cortou a resposta mas nao foi entendida: descarta. Se ela tinha
        // calado uma pergunta a meio caminho, essa pergunta e respondida de novo.
        if (cutIn && !this.relay && isUnintelligible(text)) {
          this.discard(text, 'interrupcao');
          return this.unfinished ? this.finishUnfinished() : this.resumeContinuation();
        }
        let heard = text;
        if (this.unfinished) {
          // Continuacao da fala incompleta: junta as duas.
          heard = mergeUtterances(this.unfinished.text, heard);
          this.dropUnfinished();
        }
        if (this.continuation !== undefined) {
          // Continuacao da fala anterior: cancela a resposta a ela e responde a fala completa.
          heard = mergeUtterances(this.continuation, heard);
          this.continuation = undefined;
          this.turnAbort.abort();
        }
        // Parou no meio da frase: espera a continuacao (o ditado vai direto para o terminal).
        if (!this.relay) {
          const pauses = this.pauses();
          if (pauses.extraWaitMs > 0 && looksIncomplete(heard, pauses.words)) return this.waitUnfinished(heard, pauses.extraWaitMs, e.ms);
        }
        this.utterance(heard, e.ms);
        return;
      }
      case 'audio':
        if (!this.pending.has(e.id)) return;
        if (this.timing && this.timing.firstAudio === undefined) {
          this.timing.firstAudio = this.now();
          this.logTiming();
        }
        this.send({ type: 'audio', id: e.id, data: e.data, last: e.last });
        return;
      case 'speak-error':
        if (this.pending.delete(e.id)) {
          this.send({ type: 'error', message: `Não consegui gerar a voz agora (${e.message}); a resposta está na legenda.` });
          this.maybeFinish();
        }
        return;
      case 'error':
        this.send({ type: 'error', message: e.message });
        if (e.fatal) this.stop();
        return;
      case 'exit':
        return this.onExit();
    }
  }

  private onExit(): void {
    this.resetHold();
    this.mute();
    this.send({ type: 'stop-audio' });
    if (this.now() - this.lastRestart < RESTART_WINDOW_MS) {
      this.send({ type: 'error', message: 'O worker de voz parou de novo; a escuta foi desligada. Veja o log do servidor.' });
      this.worker.off('event', this.listener);
      this.setState('off');
      return;
    }
    this.lastRestart = this.now();
    void this.boot('reiniciando a voz');
  }

  /** Nova pergunta: ela passa a ser a que fala; roda depois das anteriores. */
  private ask(text: string, ms?: number): void {
    this.dropUnfinished();
    this.held = undefined;
    this.userTurns++;
    this.cutInAt = -Infinity;
    this.conversation?.request(text);
    this.timing = { heard: this.now(), stt: ms, tools: [] };
    this.lastAsk = { text, at: this.now() };
    this.continuation = undefined;
    this.turnAbort.abort();
    const turnAbort = (this.turnAbort = new AbortController());
    const signal = AbortSignal.any([this.stopController.signal, turnAbort.signal]);
    this.send({ type: 'caption', who: 'user', text });
    this.farewell = isGoodbye(text);
    const turn = ++this.turn;
    this.brainDone = false;
    this.setState('thinking');
    // O usuario pode estar respondendo a um aviso ("conta mais"): o cerebro precisa saber qual.
    const notice = this.lastNotice && this.now() - this.lastNotice.at <= NOTICE_CONTEXT_MS ? this.lastNotice.text : undefined;
    this.lastNotice = undefined;
    const brainText = notice ? `[você avisou o usuário, sem ele pedir agora: "${notice}"]\n${text}` : text;
    this.chain = this.chain.then(() => this.think(brainText, turn, signal)).catch(() => {});
  }

  private async think(text: string, turn: number, signal: AbortSignal): Promise<void> {
    const splitter = new SentenceSplitter();
    let said = '';
    const live = () => turn === this.turn && this.state !== 'off';
    try {
      const timing = this.timing;
      const hooks = { onTool: (name: string) => timing?.tools.push(name) };
      for await (const delta of this.brain.reply(text, signal, hooks)) {
        if (!live()) continue; // calada: segue ate o fim, em background
        if (this.timing && this.timing.firstToken === undefined) this.timing.firstToken = this.now();
        said += delta;
        this.send({ type: 'caption', who: 'jarvis', text: said });
        for (const sentence of splitter.push(delta)) this.speak(sentence);
      }
      if (!live()) return;
      const rest = splitter.flush();
      if (rest) this.speak(rest);
    } catch (err) {
      if (!live()) return;
      this.send({ type: 'caption', who: 'jarvis', text: `Erro: ${String((err as Error)?.message ?? err)}` });
      this.send({ type: 'error', message: 'Tive um problema para responder; o detalhe está na legenda.' });
    } finally {
      if (turn === this.turn) {
        this.brainDone = true;
        this.maybeFinish();
      }
    }
  }

  private logTiming(): void {
    const t = this.timing;
    if (!t) return;
    const since = (v?: number) => (v === undefined ? '?' : `${v - t.heard} ms`);
    const tools = t.tools.length ? ` · ferramentas: ${t.tools.join(', ')}` : '';
    this.log(`latência: transcrição ${t.stt ?? '?'} ms · 1º token ${since(t.firstToken)} · 1º áudio ${since(t.firstAudio)}${tools}`);
    this.send({
      type: 'timing',
      stt: t.stt ?? null,
      firstToken: t.firstToken === undefined ? null : t.firstToken - t.heard,
      firstAudio: t.firstAudio === undefined ? null : t.firstAudio - t.heard,
      tools: [...t.tools],
    });
  }

  /** O texto captado e basicamente o que o proprio Jarvis esta falando (eco)? */
  /**
   * Enquanto o Jarvis fala: o texto captado e o usuario (e nao o eco da voz dele)?
   * Sim se for um pedido de parada ("Jarvis", "para", "espera"...) ou tiver ao
   * menos duas palavras que ele nao disse (o eco mistura as palavras dele).
   */
  private isUserTalking(text: string): boolean {
    if (isStopRequest(text)) return true;
    const said = new Set(normalize(this.spoken).split(' '));
    const novel = normalize(text)
      .split(' ')
      .filter((w) => w.length > 2 && !said.has(w));
    return novel.length >= 2;
  }

  private speak(text: string): void {
    const clean = stripMarkdown(text);
    if (!clean) return;
    if (this.state !== 'speaking') {
      this.setState('speaking');
      // Falando, o worker continua ouvindo (mais exigente) para o usuario poder interromper.
      this.worker.command(this.bargeIn && !this.holdMode ? { cmd: 'listen', barge: true } : { cmd: 'sleep' });
    }
    // Resposta pausada (o usuario falou por cima): o resto espera a decisao.
    if (this.held) {
      this.held.queue.push(clean);
      return;
    }
    const id = ++this.nextSpeech;
    this.pending.add(id);
    this.speechText.set(id, clean);
    this.spoken = `${this.spoken} ${clean}`.slice(-600);
    this.worker.command({ cmd: 'speak', id, text: clean });
  }

  private maybeFinish(): void {
    if ((this.state !== 'speaking' && this.state !== 'thinking') || !this.brainDone || this.pending.size) return;
    if (this.holding || this.holdPending) return;
    if (this.refusing) return this.endRefusal();
    if (this.farewell) {
      this.farewell = false;
      this.conversation?.end();
      this.setState('sleeping');
      this.worker.command({ cmd: 'sleep' });
    } else if (this.holdMode) {
      this.setState('sleeping');
      this.worker.command({ cmd: 'sleep' });
    } else {
      this.setState('listening');
      this.worker.command({ cmd: 'listen' });
    }
  }

  /** Fala nao entendida captada durante a resposta: fica so no log, nao vira pedido. */
  private discard(text: string, when: string): void {
    this.log(`fala descartada (${when}, não entendida): ${JSON.stringify(text)}`);
  }

  /** Guarda a fala incompleta; sem continuacao no prazo, responde a ela assim mesmo. */
  private waitUnfinished(text: string, waitMs: number, ms?: number): void {
    this.log(`fala incompleta, esperando a continuação: ${JSON.stringify(text)}`);
    const timer = setTimeout(() => this.finishUnfinished(), waitMs);
    timer.unref?.();
    this.unfinished = { text, ms, timer };
  }

  /** O prazo acabou (ou veio so ruido): a fala incompleta e respondida como esta. */
  private finishUnfinished(): void {
    const u = this.unfinished;
    this.dropUnfinished();
    if (!u || this.state !== 'listening') return;
    this.utterance(u.text, u.ms);
  }

  private dropUnfinished(): void {
    if (this.unfinished) clearTimeout(this.unfinished.timer);
    this.unfinished = undefined;
  }

  /** A continuacao esperada nao veio (ruido): responde a fala anterior. */
  private resumeContinuation(): void {
    const previous = this.continuation;
    if (previous === undefined) return;
    this.continuation = undefined;
    this.turnAbort.abort();
    this.ask(previous);
  }

  /** O usuario falou por cima: cala na hora, mas guarda o resto da resposta ate saber o que ele disse. */
  private pause(): void {
    if (this.held) return;
    const queue = [...this.pending].sort((a, b) => a - b).map((id) => this.speechText.get(id) ?? '').filter(Boolean);
    this.held = { turn: this.turn, queue };
    this.cutInAt = this.now();
    if (this.pending.size) {
      this.pending.clear();
      this.worker.command({ cmd: 'cancel' });
    }
    this.send({ type: 'stop-audio' });
    this.setState('listening');
  }

  /** O que o usuario disse por cima nao muda nada: continua do inicio da frase cortada. */
  private resume(): void {
    const h = this.held;
    this.held = undefined;
    this.judging = undefined;
    this.send({ type: 'duck', on: false });
    if (!h || h.turn !== this.turn || this.state !== 'listening') return;
    if (h.queue.length) for (const text of h.queue) this.speak(text);
    else if (!this.brainDone) this.setState('thinking');
  }

  /** Transcricao da fala que pausou a resposta: parar, retomar ou responder a ela. */
  private onCutIn(text: string, ms?: number): void {
    this.cutInAt = -Infinity;
    if (isShortStop(text)) {
      // "para", "chega", "Jarvis": cala de vez e fica ouvindo.
      this.log(`resposta encerrada a pedido: ${JSON.stringify(text)}`);
      this.mute();
      this.send({ type: 'duck', on: false });
      return;
    }
    if (!text || isUnintelligible(text)) {
      this.discard(text, 'interrupcao');
      return this.resume();
    }
    const heard = this.judging ? mergeUtterances(this.judging, text) : text;
    if (matchWake(heard) || looksLikeRequest(heard) || !this.judge) {
      this.mute();
      return this.utterance(heard, ms);
    }
    // Nao e claro: o juiz decide (~1 s) enquanto a resposta espera pausada.
    this.judging = heard;
    const seq = ++this.judgeSeq;
    const held = this.held;
    void this.judge
      .relevant({ asked: this.lastAsk?.text ?? '', said: this.spoken, heard })
      .catch(() => true)
      .then((relevant) => {
        if (seq !== this.judgeSeq || this.held !== held || this.state !== 'listening') return;
        if (relevant) {
          this.mute();
          this.utterance(heard, ms);
        } else {
          this.discard(heard, 'sem sentido');
          this.resume();
        }
      });
  }

  /** Cala o Jarvis e volta a ouvir; `restartListening`: falso quando o usuario ja esta falando. */
  private interrupt(restartListening = true): void {
    this.cutInAt = this.now();
    this.mute();
    this.send({ type: 'stop-audio' });
    // Modo atalho (Esc): cala e espera o proximo aperto.
    if (this.holdMode) {
      this.setState('sleeping');
      this.worker.command({ cmd: 'sleep' });
      return;
    }
    this.setState('listening');
    if (restartListening) this.worker.command({ cmd: 'listen' });
  }

  /** A resposta atual deixa de falar (mas continua rodando) e a voz pendente e descartada. */
  private mute(): void {
    this.held = undefined;
    this.judging = undefined;
    this.turn++;
    this.brainDone = true;
    this.farewell = false;
    if (this.pending.size) {
      this.pending.clear();
      this.worker.command({ cmd: 'cancel' });
    }
  }

  private setState(state: VoiceState, detail?: string): void {
    if (state === 'listening' && this.state !== 'listening') this.listeningAt = this.now();
    // O pedido depois do chamado ja chegou (ou a conversa seguiu): nada mais a completar.
    if ((state !== 'listening' && this.call?.awake) || (state === 'sleeping' && !this.checkingVoice)) this.call = null;
    this.state = state;
    this.send(detail ? { type: 'state', state, detail } : { type: 'state', state });
  }
}
