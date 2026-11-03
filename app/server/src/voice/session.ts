import type { VoiceClientMessage, VoiceServerMessage, VoiceState } from '../types.ts';
import type { Brain, InterruptJudge } from './brain.ts';
import {
  SentenceSplitter, isClear, isErase, isGoodbye, isReturn, isShortStop, isStopRequest, isSubmit, isUnintelligible, looksLikeRequest, matchWake, mergeUtterances, normalize, stripMarkdown,
} from './text.ts';

export type WorkerCommand =
  | { cmd: 'listen'; barge?: boolean }
  | { cmd: 'sleep' }
  | { cmd: 'cancel' }
  | { cmd: 'speak'; id: number; text: string }
  /** Palavras que o whisper deve reconhecer (nomes de projetos etc.). */
  | { cmd: 'vocab'; words: string[] }
  /** Sintetiza ja e guarda (para as saudacoes tocarem sem espera). */
  | { cmd: 'prefetch'; texts: string[] }
  /** Quem transcreve a fala: o whisper local ou o Groq (nuvem). */
  | { cmd: 'stt'; provider: 'local' | 'groq'; key?: string; model?: string };

export type WorkerEvent =
  | { event: 'ready' }
  | { event: 'status'; message: string }
  | { event: 'wake'; score: number }
  | { event: 'speech-start' }
  | { event: 'speech-drop' }
  | { event: 'transcript'; id: number; text: string; ms?: number }
  /** Fala transcrita enquanto o Jarvis espera ser chamado (para "Jarvis, ..."). */
  | { event: 'heard'; text: string; ms?: number }
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

export class VoiceSession {
  state: VoiceState = 'off';
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
    } = {},
  ) {
    this.onReady = opts.onReady;
    this.conversation = opts.conversation;
    this.judge = opts.judge;
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
    if (this.state !== 'sleeping' && this.state !== 'preparing') this.conversation?.end();
    this.stopController.abort();
    this.mute();
    this.setRelay(null);
    this.worker.off('event', this.listener);
    this.worker.command({ cmd: 'sleep' });
    this.send({ type: 'stop-audio' });
    this.setState('off');
  }

  audio(pcm: Buffer): void {
    if (this.state !== 'off' && this.state !== 'preparing') this.worker.sendAudio(pcm);
  }

  client(msg: VoiceClientMessage): void {
    switch (msg.type) {
      case 'start':
        void this.start();
        return;
      case 'stop':
        return this.stop();
      case 'interrupt':
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
   */
  announce(text: string): boolean {
    if (this.state !== 'sleeping' || this.relay) return false;
    this.turn++;
    this.brainDone = true;
    this.farewell = true;
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

  private onWorker(e: WorkerEvent): void {
    if (this.state === 'off') return;
    switch (e.event) {
      case 'status':
        if (this.state === 'preparing') this.setState('preparing', e.message);
        return;
      case 'heard': {
        // Chamado pelo nome ("Jarvis", "Jarvis, abre o meu-app") enquanto espera.
        if (this.state !== 'sleeping') return;
        const called = matchWake(e.text);
        if (!called) return;
        this.wakeUp(!called.rest);
        if (called.rest) this.utterance(called.rest, e.ms);
        return;
      }
      case 'wake':
        if (this.state === 'sleeping') {
          this.wakeUp(true);
        } else if (this.relay && this.state === 'listening') {
          this.setRelay(null);
          this.send({ type: 'chime' });
        } else if (this.state === 'thinking' || this.state === 'speaking') {
          this.interrupt();
        }
        return;
      case 'speech-start':
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
        // Era ruido: se a resposta anterior tinha sido calada por ele, pergunta de novo.
        if (this.state === 'listening') {
          this.cutInAt = -Infinity;
          if (this.held) return this.resume();
          this.resumeContinuation();
        }
        return;
      case 'transcript': {
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
        if (!text) return this.resumeContinuation();
        // Fala que cortou a resposta mas nao foi entendida: descarta. Se ela tinha
        // calado uma pergunta a meio caminho, essa pergunta e respondida de novo.
        if (cutIn && !this.relay && isUnintelligible(text)) {
          this.discard(text, 'interrupcao');
          return this.resumeContinuation();
        }
        if (this.continuation !== undefined) {
          // Continuacao da fala anterior: cancela a resposta a ela e responde a fala completa.
          const previous = this.continuation;
          this.continuation = undefined;
          this.turnAbort.abort();
          return this.utterance(mergeUtterances(previous, text), e.ms);
        }
        this.utterance(text, e.ms);
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
    this.held = undefined;
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
    this.chain = this.chain.then(() => this.think(text, turn, signal)).catch(() => {});
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
      this.worker.command(this.bargeIn ? { cmd: 'listen', barge: true } : { cmd: 'sleep' });
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
    if (this.farewell) {
      this.farewell = false;
      this.conversation?.end();
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
    this.state = state;
    this.send(detail ? { type: 'state', state, detail } : { type: 'state', state });
  }
}
