export type * from '../../server/src/types.ts';

/** 'none': so a cena 3D, sem painel aberto. */
export type View =
  | { kind: 'none' }
  | { kind: 'profile' }
  | { kind: 'skills'; focus?: string }
  | { kind: 'project'; id: string };
