import type { Conversation, ProjectSummary, SessionInfo, Skill } from '../types.ts';

// Unidades da cena: o raio de Schwarzschild vale 1.
export const DISK_INNER = 2.4;
export const DISK_OUTER = 6.5;
export const FIRST_ORBIT = 9;
const MAX_SPREAD = 28;
const MAX_GAP = 2.2;
export const MAX_MOONS = 24;

export const COLORS = { claude: '#e8915a', codex: '#5ed69a', both: '#8ab4ff' } as const;
const SKILL_COLORS = { claude: '#ffd27a', codex: '#5ed69a', plugin: '#9fc2ff' } as const;

export interface Body {
  id: string;
  radius: number;
  /** Angulo inicial (rad). */
  angle: number;
  /** Velocidade angular (rad/s). */
  speed: number;
  size: number;
  color: string;
  live: boolean;
}

export interface Star {
  path: string;
  position: [number, number, number];
  color: string;
}

/** Hash FNV-1a em [0, 1): posicoes estaveis entre recargas. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

export function projectColor(p: ProjectSummary): string {
  if (p.agents.length > 1) return COLORS.both;
  return p.agents[0] === 'codex' ? COLORS.codex : COLORS.claude;
}

export function skillColor(origin: string): string {
  if (origin.startsWith('plugin:')) return SKILL_COLORS.plugin;
  return origin === 'codex' ? SKILL_COLORS.codex : SKILL_COLORS.claude;
}

/** Mais recentes mais perto; orbitas mais externas giram mais devagar. */
export function layoutProjects(projects: ProjectSummary[], sessions: SessionInfo[]): Body[] {
  const live = new Set(sessions.filter((s) => s.alive).map((s) => s.projectPath));
  const sorted = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const gap = sorted.length > 1 ? Math.min(MAX_GAP, MAX_SPREAD / (sorted.length - 1)) : 0;
  return sorted.map((p, i) => {
    const radius = FIRST_ORBIT + i * gap;
    return {
      id: p.id,
      radius,
      angle: hash01(p.path) * Math.PI * 2,
      speed: 0.6 / Math.pow(radius, 1.5),
      size: Math.min(0.35 + 0.18 * Math.log2(1 + p.conversations), 1.2),
      color: projectColor(p),
      live: live.has(p.path),
    };
  });
}

/** Ate 24 luas, 8 por anel. */
export function layoutMoons(conversations: Conversation[], planetSize: number): Body[] {
  return conversations.slice(0, MAX_MOONS).map((c, i) => {
    const ring = Math.floor(i / 8);
    return {
      id: `${c.agent}:${c.id}`,
      radius: planetSize * 1.8 + 0.5 + ring * 0.55,
      angle: ((i % 8) / 8) * Math.PI * 2 + ring * 0.4,
      speed: 0.5 / (1 + ring),
      size: 0.11,
      color: COLORS[c.agent],
      live: false,
    };
  });
}

/** Raio interno do cinturao de skills: depois da ultima orbita. */
export function beltRadius(bodies: Body[]): number {
  return Math.max(FIRST_ORBIT, ...bodies.map((b) => b.radius)) + 4;
}

export function layoutSkills(skills: Skill[], innerRadius: number): Star[] {
  const n = Math.max(skills.length, 1);
  return skills.map((s, i) => {
    const angle = (i / n) * Math.PI * 2 + (hash01(s.path) - 0.5) * 0.3;
    const r = innerRadius + 2 + hash01(s.path + 'r') * 3;
    const y = (hash01(s.path + 'y') - 0.5) * 1.2;
    return { path: s.path, position: [Math.cos(angle) * r, y, Math.sin(angle) * r], color: skillColor(s.origin) };
  });
}

export function orbitPosition(b: { radius: number; angle: number; speed: number }, t: number): [number, number, number] {
  const a = b.angle + b.speed * t;
  return [Math.cos(a) * b.radius, 0, Math.sin(a) * b.radius];
}
