export type * from '../../server/src/types.ts';

export type View = { kind: 'profile' } | { kind: 'skills'; focus?: string } | { kind: 'project'; id: string };
