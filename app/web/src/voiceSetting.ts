// Configuracoes mudadas pela voz (ferramenta mudar_configuracao): o servidor manda o comando
// de UI "setting" e a interface aplica na hora, do mesmo jeito que o clique nas configuracoes.
import { isGlobeColor, isGlobeStyle, type GlobeColor, type GlobeStyle } from './scene/globe.ts';
import type { UiCommand } from './types.ts';

export type SettingCommand = Extract<UiCommand, { kind: 'setting' }>;

export interface SettingSetters {
  captionUser(on: boolean): void;
  captionJarvis(on: boolean): void;
  voiceOn(on: boolean): void;
  holdKey(on: boolean): void;
  mode3d(on: boolean): void;
  reduceMotion(on: boolean): void;
  voiceDemo(on: boolean): void;
  sounds(on: boolean): void;
  globeColor(c: GlobeColor): void;
  globeStyle(s: GlobeStyle): void;
}

/** Escuta e atalho reiniciam a voz: so depois que a resposta que confirma a troca terminar. */
export const afterReply = (c: SettingCommand): boolean => c.key === 'escuta' || c.key === 'atalho';

/** Aplica a mudanca; falso se o valor nao serve para a opcao (nada muda). */
export function applySetting(c: SettingCommand, set: SettingSetters): boolean {
  const v = c.value;
  if (c.key === 'cor') return isGlobeColor(v) && (set.globeColor(v), true);
  if (c.key === 'estilo') return isGlobeStyle(v) && (set.globeStyle(v), true);
  if (typeof v !== 'boolean') return false;
  switch (c.key) {
    case 'legendas':
      set.captionUser(v);
      set.captionJarvis(v);
      return true;
    case 'legendaUsuario':
      return set.captionUser(v), true;
    case 'legendaJarvis':
      return set.captionJarvis(v), true;
    case 'escuta':
      // Escuta ativa e falar com o atalho nao andam juntas (a tela tambem desliga uma pela outra).
      set.voiceOn(v);
      if (v) set.holdKey(false);
      return true;
    case 'atalho':
      set.holdKey(v);
      // Sem o atalho, a escuta volta: senao o Jarvis ficaria sem ouvir nada.
      if (!v) set.voiceOn(true);
      return true;
    case 'modo3d':
      return set.mode3d(v), true;
    case 'reduzirMovimento':
      return set.reduceMotion(v), true;
    case 'demonstracao':
      return set.voiceDemo(v), true;
    case 'sons':
      return set.sounds(v), true;
  }
  return false;
}
