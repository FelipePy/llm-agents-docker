// Quem responde por voz: o provedor (Claude ou Codex) e o modelo, escolhidos nas configuracoes.
// Vale so para as respostas do Jarvis (o juiz de interrupcoes, o resumo das sessoes e as
// sessoes dos projetos seguem como estao). A troca vale na proxima fala, sem reiniciar.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Brain, BrainHooks } from './brain.ts';

export type BrainProvider = 'claude' | 'codex';
export const BRAIN_PROVIDERS: BrainProvider[] = ['claude', 'codex'];
export const PROVIDER_LABEL: Record<BrainProvider, string> = { claude: 'Claude', codex: 'Codex' };

export interface BrainChoice {
  provider: BrainProvider;
  model: string;
}

export interface BrainModel {
  id: string;
  label: string;
}

/** O que a tela ve: a escolha e os modelos de cada provedor, consultados na hora. */
export interface BrainChoiceView extends BrainChoice {
  models: Record<BrainProvider, BrainModel[]>;
  /** Provedor cuja lista nao veio (sem login, CLI ausente...), com o motivo. */
  errors: Partial<Record<BrainProvider, string>>;
}

/** Lista os modelos de um provedor (Claude: Agent SDK; Codex: "codex debug models"). */
export type ModelLister = (provider: BrainProvider) => Promise<BrainModel[]>;

const MODEL_ID = /^[\w.:@\-[\]/]{1,100}$/;
/** Lista consultada ha pouco vale para conferir uma escolha (a tela pede uma nova ao abrir). */
const LIST_TTL_MS = 60_000;

export interface BrainChoiceApi {
  get(): BrainChoice;
  /** Modelos de um provedor; `fresh` consulta de novo em vez de usar a ultima lista. */
  models(provider: BrainProvider, fresh?: boolean): Promise<BrainModel[]>;
  view(): Promise<BrainChoiceView>;
  set(input: { provider?: unknown; model?: unknown }): Promise<{ choice: BrainChoice } | { error: string }>;
}

export class BrainChoiceStore implements BrainChoiceApi {
  private choice: BrainChoice;
  private readonly file: string;
  private readonly list: ModelLister;
  private readonly onChange: (c: BrainChoice) => void;
  private readonly cache = new Map<BrainProvider, { at: number; models: BrainModel[] }>();
  private readonly now: () => number;

  constructor(file: string, opts: { list: ModelLister; fallback: BrainChoice; onChange?: (c: BrainChoice) => void; now?: () => number }) {
    this.file = file;
    this.list = opts.list;
    this.onChange = opts.onChange ?? (() => {});
    this.now = opts.now ?? Date.now;
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // sem escolha salva: o padrao
    }
    const provider = BRAIN_PROVIDERS.includes(raw.provider as BrainProvider) ? (raw.provider as BrainProvider) : undefined;
    const model = typeof raw.model === 'string' && MODEL_ID.test(raw.model) ? raw.model : undefined;
    this.choice = provider && model ? { provider, model } : { ...opts.fallback };
  }

  get(): BrainChoice {
    return { ...this.choice };
  }

  async models(provider: BrainProvider, fresh = false): Promise<BrainModel[]> {
    const hit = this.cache.get(provider);
    if (!fresh && hit && this.now() - hit.at < LIST_TTL_MS) return hit.models;
    const models = await this.list(provider);
    this.cache.set(provider, { at: this.now(), models });
    return models;
  }

  async view(): Promise<BrainChoiceView> {
    const models = { claude: [], codex: [] } as Record<BrainProvider, BrainModel[]>;
    const errors: Partial<Record<BrainProvider, string>> = {};
    await Promise.all(
      BRAIN_PROVIDERS.map(async (p) => {
        try {
          models[p] = await this.models(p, true);
        } catch (err) {
          errors[p] = String((err as Error)?.message ?? err);
        }
      }),
    );
    return { ...this.get(), models, errors };
  }

  /** Confere o modelo na lista do provedor e salva. Sem modelo, o primeiro da lista. */
  async set(input: { provider?: unknown; model?: unknown }): Promise<{ choice: BrainChoice } | { error: string }> {
    const provider = input.provider === undefined ? this.choice.provider : input.provider;
    if (!BRAIN_PROVIDERS.includes(provider as BrainProvider)) return { error: 'provedor inválido: use "claude" ou "codex"' };
    const p = provider as BrainProvider;
    if (input.model !== undefined && (typeof input.model !== 'string' || !MODEL_ID.test(input.model))) return { error: 'modelo inválido' };
    let models: BrainModel[];
    try {
      models = await this.models(p);
    } catch (err) {
      return { error: `Não consegui consultar os modelos do ${PROVIDER_LABEL[p]} (${String((err as Error)?.message ?? err)}).` };
    }
    const wanted = (input.model as string | undefined) ?? (p === this.choice.provider ? this.choice.model : preferred(p, models));
    if (!wanted || !models.some((m) => m.id === wanted)) return { error: `O ${PROVIDER_LABEL[p]} não tem o modelo "${wanted ?? ''}" no seu plano.` };
    const next = { provider: p, model: wanted };
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    const changed = next.provider !== this.choice.provider || next.model !== this.choice.model;
    this.choice = next;
    if (changed) this.onChange(this.get());
    return { choice: this.get() };
  }
}

/** Modelo ao trocar so de provedor: o mais rapido do Claude (respostas faladas), ou o primeiro da lista. */
export function preferred(provider: BrainProvider, models: BrainModel[]): string | undefined {
  return (provider === 'claude' ? models.find((m) => m.id === 'haiku') : undefined)?.id ?? models[0]?.id;
}

/** Modelos do Claude pelo Agent SDK ("default" sai: ele e um dos outros). */
export function claudeModels(info: { value: string; displayName: string; description: string }[]): BrainModel[] {
  return info
    .filter((m) => m.value !== 'default')
    .map((m) => ({ id: m.value, label: m.description.split('·')[0].trim() || m.displayName }));
}

/** Modelos do Codex no plano: o catalogo de "codex debug models", so os listaveis. */
export function codexModels(json: string): BrainModel[] {
  const raw = JSON.parse(json) as unknown;
  const list = (Array.isArray(raw) ? raw : ((raw as { models?: unknown })?.models ?? [])) as Record<string, unknown>[];
  return list
    .filter((m) => typeof m.slug === 'string' && (m.visibility === undefined || m.visibility === 'list'))
    .map((m) => ({ id: m.slug as string, label: typeof m.display_name === 'string' && m.display_name ? m.display_name : (m.slug as string) }));
}

/** Um cerebro que fecha: o Claude mantem um processo aberto, o Codex um por resposta. */
export interface ClosableBrain extends Brain {
  close(): void;
}

/**
 * O cerebro escolhido. Uma troca pedida no meio de uma resposta (pela propria voz) so vale
 * na fala seguinte: fechar o cerebro agora cortaria a resposta que confirma a troca.
 */
export class SwitchingBrain implements Brain {
  private current: { choice: BrainChoice; brain: ClosableBrain } | undefined;
  private pending: BrainChoice | undefined;
  private readonly make: (c: BrainChoice) => ClosableBrain;
  /** Troca de modelo no mesmo provedor sem perder a conversa (o Claude retoma a sessao). */
  private readonly retarget?: (brain: ClosableBrain, c: BrainChoice) => boolean;

  constructor(choice: BrainChoice, make: (c: BrainChoice) => ClosableBrain, retarget?: (brain: ClosableBrain, c: BrainChoice) => boolean) {
    this.pending = choice;
    this.make = make;
    this.retarget = retarget;
  }

  /** Nova escolha: vale a partir da proxima fala. */
  choose(choice: BrainChoice): void {
    this.pending = { ...choice };
  }

  private brain(): ClosableBrain {
    const next = this.pending;
    if (next) {
      this.pending = undefined;
      const cur = this.current;
      if (!cur || cur.choice.provider !== next.provider || cur.choice.model !== next.model) {
        if (cur && cur.choice.provider === next.provider && this.retarget?.(cur.brain, next)) {
          this.current = { choice: next, brain: cur.brain };
        } else {
          cur?.brain.close();
          this.current = { choice: next, brain: this.make(next) };
        }
      }
    }
    return this.current!.brain;
  }

  warm(): void {
    this.brain().warm?.();
  }

  reply(text: string, signal: AbortSignal, hooks?: BrainHooks): AsyncIterable<string> {
    return this.brain().reply(text, signal, hooks);
  }

  close(): void {
    this.current?.brain.close();
    this.current = undefined;
  }
}
