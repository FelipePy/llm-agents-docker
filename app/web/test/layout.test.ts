import { describe, expect, it } from 'vitest';
import {
  COLORS, FIRST_ORBIT, MAX_MOONS, beltRadius, hash01, layoutMoons, layoutProjects, layoutSkills, orbitPosition,
} from '../src/scene/layout.ts';
import type { Conversation, ProjectSummary, SessionInfo, Skill } from '../src/types.ts';

const project = (name: string, updatedAt: string, conversations: number, agents: ('claude' | 'codex')[]): ProjectSummary => ({
  id: name, name, path: `/p/${name}`, updatedAt, conversations, agents,
});
const session = (projectPath: string, alive: boolean): SessionInfo => ({
  id: projectPath, projectPath, agent: 'claude', title: '', startedAt: '', alive,
});
const conversation = (i: number, agent: 'claude' | 'codex' = 'claude'): Conversation => ({
  agent, id: `c${i}`, cwd: '/p', title: `t${i}`, updatedAt: '', prompts: 1,
});

describe('hash01', () => {
  it('e deterministico e fica em [0, 1)', () => {
    expect(hash01('abc')).toBe(hash01('abc'));
    expect(hash01('abc')).not.toBe(hash01('abd'));
    for (const s of ['', 'a', '/home/x/projeto', 'ç']) {
      expect(hash01(s)).toBeGreaterThanOrEqual(0);
      expect(hash01(s)).toBeLessThan(1);
    }
  });
});

describe('layoutProjects', () => {
  const projects = [
    project('velho', '2026-01-01', 1, ['codex']),
    project('novo', '2026-10-01', 40, ['claude', 'codex']),
    project('meio', '2026-05-01', 3, ['claude']),
  ];

  it('os mais recentes ficam mais perto do centro', () => {
    const bodies = layoutProjects(projects, []);
    expect(bodies.map((b) => b.id)).toEqual(['novo', 'meio', 'velho']);
    expect(bodies[0].radius).toBe(FIRST_ORBIT);
    expect(bodies[1].radius).toBeGreaterThan(bodies[0].radius);
    expect(bodies[2].radius).toBeGreaterThan(bodies[1].radius);
  });

  it('cor por agente, tamanho pelas conversas (com limite) e sessao aberta', () => {
    const bodies = layoutProjects(projects, [session('/p/meio', true), session('/p/velho', false)]);
    const byId = new Map(bodies.map((b) => [b.id, b]));
    expect(byId.get('novo')!.color).toBe(COLORS.both);
    expect(byId.get('meio')!.color).toBe(COLORS.claude);
    expect(byId.get('velho')!.color).toBe(COLORS.codex);
    expect(byId.get('novo')!.size).toBeGreaterThan(byId.get('meio')!.size);
    expect(byId.get('novo')!.size).toBeLessThanOrEqual(1.2);
    expect(byId.get('meio')!.live).toBe(true);
    expect(byId.get('velho')!.live).toBe(false);
  });

  it('muitos projetos ficam dentro de um raio limitado', () => {
    const many = Array.from({ length: 60 }, (_, i) => project(`p${i}`, `2026-01-${String(i + 1).padStart(2, '0')}`, 1, ['claude']));
    const bodies = layoutProjects(many, []);
    expect(Math.max(...bodies.map((b) => b.radius))).toBeLessThanOrEqual(FIRST_ORBIT + 28 + 1e-9);
    expect(beltRadius(bodies)).toBeGreaterThan(Math.max(...bodies.map((b) => b.radius)));
  });

  it('orbitas internas giram mais rapido', () => {
    const [a, b] = layoutProjects(projects, []);
    expect(a.speed).toBeGreaterThan(b.speed);
  });
});

describe('layoutMoons', () => {
  it('limita a 24 luas em aneis crescentes, com a cor do agente', () => {
    const moons = layoutMoons(Array.from({ length: 30 }, (_, i) => conversation(i, i % 2 ? 'codex' : 'claude')), 0.5);
    expect(moons).toHaveLength(MAX_MOONS);
    expect(moons[0].id).toBe('claude:c0');
    expect(moons[1].color).toBe(COLORS.codex);
    expect(moons[8].radius).toBeGreaterThan(moons[0].radius);
    expect(moons[0].radius).toBeGreaterThan(0.5);
  });
});

describe('layoutSkills', () => {
  const skills: Skill[] = [
    { name: 'a', description: '', origin: 'claude', path: '/s/a' },
    { name: 'b', description: '', origin: 'plugin:x', path: '/s/b' },
    { name: 'c', description: '', origin: 'codex', path: '/s/c' },
  ];
  it('distribui as skills num anel depois do raio interno, de forma estavel', () => {
    const stars = layoutSkills(skills, 20);
    expect(stars).toHaveLength(3);
    for (const s of stars) {
      const r = Math.hypot(s.position[0], s.position[2]);
      expect(r).toBeGreaterThanOrEqual(22);
      expect(r).toBeLessThanOrEqual(25);
    }
    expect(layoutSkills(skills, 20)).toEqual(stars);
    expect(stars.map((s) => s.color)).toEqual(['#ffd27a', '#9fc2ff', '#5ed69a']);
  });
});

describe('orbitPosition', () => {
  it('fica no plano XZ, no raio da orbita', () => {
    const body = { radius: 10, angle: 0, speed: 0.5 };
    expect(orbitPosition(body, 0)).toEqual([10, 0, 0]);
    const [x, y, z] = orbitPosition(body, Math.PI);
    expect(y).toBe(0);
    expect(Math.hypot(x, z)).toBeCloseTo(10);
  });
});
