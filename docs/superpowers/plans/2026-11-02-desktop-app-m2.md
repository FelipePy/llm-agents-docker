# App desktop, marco 2 (buraco negro): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a área central da UI por uma cena 3D interativa: buraco negro com lente gravitacional (o usuário), projetos orbitando, conversas como luas e skills como cinturão de estrelas. Os painéis do marco 1 passam a flutuar sobre a cena.

**Architecture:** react-three-fiber dentro da UI existente. A cena fica num `<Canvas>` atrás de tudo. O buraco negro é um quad em tela cheia com um shader que integra raios curvos (ray marching) e desenha o disco de acreção e o céu. Projetos, luas e skills são malhas normais desenhadas por cima. Uma esfera invisível, que só escreve profundidade, esconde o que passa atrás do horizonte e recebe o clique. A posição de cada corpo vem de funções puras e testadas (`layout.ts`). A qualidade cai sozinha quando o FPS fica baixo (`quality.ts`). A cena é carregada sob demanda (`React.lazy`), então o modo sem 3D não baixa o three.js.

**Tech Stack:** three 0.187.0, @react-three/fiber 9.8.2, @react-three/drei 10.7.9 (OrbitControls, Html, useCursor), @react-three/postprocessing 3.2.2 e postprocessing 6.39.6 (Bloom), vitest.

Spec: `docs/superpowers/specs/2026-11-02-desktop-app-design.md` (seção "Marco 2").

## Global Constraints

- Plano do disco e das órbitas: XZ (y = 0). Raio de Schwarzschild na cena: 1. Disco de 2,4 a 6,5. Primeira órbita: 9.
- Cores: Claude `#e8915a`, Codex `#5ed69a`, projeto com os dois agentes `#8ab4ff`; skills: Claude `#ffd27a`, Codex `#5ed69a`, plugin `#9fc2ff`.
- No máximo 24 luas por projeto (as conversas mais recentes).
- Qualidade: 3 amostras seguidas (1 por segundo) abaixo de 30 FPS desligam o bloom; mais 3 baixam os passos do shader de 220 para 90.
- "Reduzir movimento" congela órbitas, rotação e pulsos; padrão vem de `prefers-reduced-motion`. "Modo 3D" desligado ou sem WebGL 2: interface do marco 1.
- Preferências em `localStorage`: `llm-agent-3d` e `llm-agent-reduce-motion` (`'1'`/`'0'`).
- `Esc` (fora do terminal e da busca) fecha o painel e volta a câmera para a visão geral.
- Textos de interface em português.

## Convenção

Cada bloco marcado com `file=<caminho>` é o conteúdo **completo** do arquivo (criado ou substituído).

---

### Task 1: Layout e qualidade (lógica pura)

**Files:**
- Modify: `app/web/package.json` (dependências 3D, via `npm install`)
- Create: `app/web/src/scene/layout.ts`, `app/web/src/scene/quality.ts`, `app/web/test/layout.test.ts`, `app/web/test/quality.test.ts`

**Interfaces:**
- Produces: constantes `DISK_INNER`, `DISK_OUTER`, `FIRST_ORBIT`, `MAX_MOONS`, `COLORS`; `hash01(s)`, `projectColor(p)`, `skillColor(origin)`, `layoutProjects(projects, sessions): Body[]`, `layoutMoons(conversations, planetSize): Body[]`, `layoutSkills(skills, innerRadius): Star[]`, `beltRadius(bodies): number`, `orbitPosition(body, t): [x, y, z]`; tipos `Body { id, radius, angle, speed, size, color, live }` e `Star { path, position, color }`. `Quality { bloom, steps, lowStreak }`, `HIGH_QUALITY`, `LOW_STEPS`, `nextQuality(q, fps)`.

- [ ] **Step 1: Instalar as dependências**

Run: `cd app/web && npm install three@0.187.0 @react-three/fiber@9.8.2 @react-three/drei@10.7.9 @react-three/postprocessing@3.2.2 postprocessing@6.39.6 && npm install -D @types/three@0.187.0`
Expected: `package.json` e `package-lock.json` atualizados, sem erros de peer dependency.

- [ ] **Step 2: Escrever os testes**

```ts file=app/web/test/layout.test.ts
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
```

```ts file=app/web/test/quality.test.ts
import { expect, it } from 'vitest';
import { HIGH_QUALITY, LOW_STEPS, nextQuality } from '../src/scene/quality.ts';

const feed = (samples: number[]) => samples.reduce(nextQuality, HIGH_QUALITY);

it('FPS bom nao muda nada (e devolve o mesmo objeto)', () => {
  expect(nextQuality(HIGH_QUALITY, 60)).toBe(HIGH_QUALITY);
});

it('tres amostras baixas seguidas desligam o bloom', () => {
  expect(feed([20, 20]).bloom).toBe(true);
  expect(feed([20, 20, 20])).toEqual({ bloom: false, steps: HIGH_QUALITY.steps, lowStreak: 0 });
});

it('uma amostra boa zera a sequencia', () => {
  expect(feed([20, 20, 60, 20, 20]).bloom).toBe(true);
});

it('depois do bloom, reduz os passos do shader e para ai', () => {
  expect(feed([20, 20, 20, 20, 20, 20])).toEqual({ bloom: false, steps: LOW_STEPS, lowStreak: 0 });
  expect(feed(Array(12).fill(10))).toEqual({ bloom: false, steps: LOW_STEPS, lowStreak: 0 });
});
```

- [ ] **Step 3: Ver falhar**

Run: `cd app/web && npm test`
Expected: `layout.test.ts` e `quality.test.ts` falham ao carregar `../src/scene/layout.ts` e `../src/scene/quality.ts`.

- [ ] **Step 4: Implementar**

```ts file=app/web/src/scene/layout.ts
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
```

```ts file=app/web/src/scene/quality.ts
export interface Quality {
  bloom: boolean;
  /** Passos do ray marching do buraco negro. */
  steps: number;
  lowStreak: number;
}

export const HIGH_QUALITY: Quality = { bloom: true, steps: 220, lowStreak: 0 };
export const LOW_STEPS = 90;

/**
 * Recebe uma amostra de FPS por segundo. Tres amostras seguidas abaixo de 30
 * desligam o bloom; mais tres reduzem os passos do shader. Nunca volta a subir.
 * Devolve o mesmo objeto quando nada muda (evita re-render).
 */
export function nextQuality(q: Quality, fps: number): Quality {
  const lowStreak = fps < 30 ? q.lowStreak + 1 : 0;
  if (lowStreak < 3) return lowStreak === q.lowStreak ? q : { ...q, lowStreak };
  if (q.bloom) return { ...q, bloom: false, lowStreak: 0 };
  if (q.steps > LOW_STEPS) return { ...q, steps: LOW_STEPS, lowStreak: 0 };
  return q.lowStreak === 0 ? q : { ...q, lowStreak: 0 };
}
```

- [ ] **Step 5: Ver passar**

Run: `cd app/web && npm test`
Expected: todos `passed`.

- [ ] **Step 6: Commit**

```bash
git add app/web/package.json app/web/package-lock.json app/web/src/scene/layout.ts app/web/src/scene/quality.ts app/web/test/layout.test.ts app/web/test/quality.test.ts
git commit -m "Add scene layout and adaptive quality logic"
```

---

### Task 2: Componentes da cena

**Files:**
- Create: `app/web/src/scene/blackHoleShader.ts`, `app/web/src/scene/BlackHole.tsx`, `app/web/src/scene/Projects.tsx`, `app/web/src/scene/SkillBelt.tsx`, `app/web/src/scene/CameraRig.tsx`, `app/web/src/scene/Galaxy.tsx`

**Interfaces:**
- Consumes: Task 1; `LABEL`, `formatDate` (`format.ts`); tipos de `types.ts`.
- Produces: `Galaxy(props: GalaxyProps)` com `GalaxyProps = { overview: Overview; sessions: SessionInfo[]; focusId: string | null; reducedMotion: boolean; dimmed: boolean; onSelectProject(id: string): void; onSelectProfile(): void; onSelectSkill(path: string): void; onResume(c: Conversation): void }`.

- [ ] **Step 1: Shader do buraco negro**

```ts file=app/web/src/scene/blackHoleShader.ts
// Buraco negro de Schwarzschild (raio 1) com disco de acrecao no plano y = 0.
// Cada pixel lanca um raio da camera e integra a curvatura da luz
// (aceleracao -1.5 h^2 r / |r|^5); onde o raio cruza o disco, soma a cor dele;
// se cai no horizonte, fica preto; se escapa, mostra o ceu.

export const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.999, 1.0);
}
`;

export const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uCamPos;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform float uSteps;
uniform float uDiskInner;
uniform float uDiskOuter;
varying vec2 vUv;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

vec3 sky(vec3 d) {
  vec3 p = d * 220.0;
  vec3 c = floor(p);
  float h = hash(c);
  float star = step(0.992, h) * smoothstep(0.45, 0.0, length(fract(p) - 0.5));
  vec3 tint = mix(vec3(0.65, 0.75, 1.0), vec3(1.0, 0.85, 0.7), hash(c + 7.1));
  float neb = fbm(d * 2.5 + 4.0);
  vec3 nebula = mix(vec3(0.02, 0.01, 0.06), vec3(0.10, 0.04, 0.16), neb) * smoothstep(0.3, 0.9, neb);
  return tint * star * 1.6 + nebula;
}

vec4 disk(vec3 p, vec3 dir) {
  float r = length(p.xz);
  float t = clamp((r - uDiskInner) / (uDiskOuter - uDiskInner), 0.0, 1.0);
  // Rotacao diferencial: o interior gira mais rapido (Kepler).
  float spin = uTime * 1.6 / pow(r, 1.5);
  float c = cos(spin);
  float s = sin(spin);
  vec2 q = mat2(c, -s, s, c) * p.xz;
  float bands = fbm(vec3(q * 1.8, uTime * 0.05));
  float streaks = fbm(vec3(r * 6.0, q * 0.4));
  float density = (0.55 + 0.9 * bands * streaks) * smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.65, 1.0, t));
  vec3 hot = vec3(1.0, 0.93, 0.82);
  vec3 warm = vec3(1.0, 0.55, 0.18);
  vec3 cool = vec3(0.55, 0.12, 0.05);
  vec3 col = t < 0.35 ? mix(hot, warm, t / 0.35) : mix(warm, cool, (t - 0.35) / 0.65);
  // Efeito Doppler: o lado que vem na direcao da camera brilha mais.
  vec3 tangent = normalize(vec3(-p.z, 0.0, p.x));
  float doppler = 1.0 + 0.75 * dot(tangent, -dir);
  float intensity = density * pow(1.0 - t, 1.2) * 2.6 * doppler * doppler;
  return vec4(col * intensity, clamp(density * 0.95, 0.0, 1.0));
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 view = uInvProj * vec4(ndc, 1.0, 1.0);
  view /= view.w;
  vec3 pos = uCamPos;
  vec3 vel = normalize((uCamWorld * vec4(view.xyz, 0.0)).xyz);
  vec3 hv = cross(pos, vel);
  float h2 = dot(hv, hv);
  vec3 col = vec3(0.0);
  float trans = 1.0;
  bool captured = false;

  for (int i = 0; i < 400; i++) {
    if (float(i) >= uSteps) break;
    float r2 = dot(pos, pos);
    float r = sqrt(r2);
    float dt = clamp(0.06 * r, 0.015, 2.0);
    vec3 prev = pos;
    vel += -1.5 * h2 * pos / (r2 * r2 * r) * dt;
    pos += vel * dt;
    if (prev.y * pos.y < 0.0) {
      vec3 cp = mix(prev, pos, prev.y / (prev.y - pos.y));
      float cr = length(cp.xz);
      if (cr > uDiskInner && cr < uDiskOuter) {
        vec4 d = disk(cp, normalize(vel));
        col += trans * d.rgb * d.a;
        trans *= 1.0 - d.a;
      }
    }
    if (r2 < 1.0) { captured = true; break; }
    if (r2 > 4000.0 && dot(pos, vel) > 0.0) break;
    if (trans < 0.02) break;
  }

  if (!captured) col += trans * sky(normalize(vel));
  col = 1.0 - exp(-col * 1.1);
  gl_FragColor = vec4(col, 1.0);
}
`;
```

- [ ] **Step 2: Componentes**

```tsx file=app/web/src/scene/BlackHole.tsx
import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useCursor } from '@react-three/drei';
import { Matrix4, ShaderMaterial, Vector3 } from 'three';
import { DISK_INNER, DISK_OUTER } from './layout.ts';
import { fragmentShader, vertexShader } from './blackHoleShader.ts';

interface Props {
  steps: number;
  reducedMotion: boolean;
  onSelect: () => void;
}

/** Fundo com lente gravitacional + esfera invisivel que oculta e recebe o clique. */
export function BlackHole({ steps, reducedMotion, onSelect }: Props) {
  const [hover, setHover] = useState(false);
  useCursor(hover);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uCamPos: { value: new Vector3() },
          uInvProj: { value: new Matrix4() },
          uCamWorld: { value: new Matrix4() },
          uSteps: { value: steps },
          uDiskInner: { value: DISK_INNER },
          uDiskOuter: { value: DISK_OUTER },
        },
        depthTest: false,
        depthWrite: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera, clock }) => {
    const u = material.uniforms;
    if (!reducedMotion) u.uTime.value = clock.elapsedTime;
    u.uCamPos.value.copy(camera.position);
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uSteps.value = steps;
  });

  return (
    <>
      <mesh frustumCulled={false} renderOrder={-1} material={material} raycast={() => null}>
        <planeGeometry args={[2, 2]} />
      </mesh>
      {/* Sombra aparente (~2,6 raios): so escreve profundidade. */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
      >
        <sphereGeometry args={[2.5, 48, 48]} />
        <meshBasicMaterial colorWrite={false} />
      </mesh>
      {hover && (
        <Html center position={[0, 3.6, 0]} className="label">
          <strong>Você</strong>
          <span>instruções e memórias</span>
        </Html>
      )}
    </>
  );
}
```

```tsx file=app/web/src/scene/Projects.tsx
import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useCursor } from '@react-three/drei';
import { DoubleSide, type Group, type Mesh, type Vector3 } from 'three';
import type { Conversation, Overview, ProjectSummary, SessionInfo } from '../types.ts';
import { LABEL, formatDate } from '../format.ts';
import { layoutMoons, layoutProjects, orbitPosition, type Body } from './layout.ts';

interface Props {
  overview: Overview;
  sessions: SessionInfo[];
  focusId: string | null;
  reducedMotion: boolean;
  /** Posicao atual de cada projeto (lida pela camera). */
  positions: MutableRefObject<Map<string, Vector3>>;
  onSelect: (id: string) => void;
  onResume: (c: Conversation) => void;
}

export function Projects({ overview, sessions, focusId, reducedMotion, positions, onSelect, onResume }: Props) {
  const bodies = useMemo(() => layoutProjects(overview.projects, sessions), [overview.projects, sessions]);
  const byId = useMemo(() => new Map(overview.projects.map((p) => [p.id, p])), [overview.projects]);
  return (
    <>
      {bodies.map((b) => {
        const project = byId.get(b.id)!;
        return (
          <group key={b.id}>
            <OrbitLine radius={b.radius} highlighted={b.id === focusId} />
            <Planet
              body={b}
              project={project}
              focused={b.id === focusId}
              reducedMotion={reducedMotion}
              positions={positions}
              onSelect={onSelect}
              conversations={b.id === focusId ? overview.conversations.filter((c) => c.cwd === project.path) : []}
              onResume={onResume}
            />
          </group>
        );
      })}
    </>
  );
}

function OrbitLine({ radius, highlighted }: { radius: number; highlighted: boolean }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <ringGeometry args={[radius - 0.015, radius + 0.015, 160]} />
      <meshBasicMaterial color={highlighted ? '#8ab4ff' : '#22304f'} transparent opacity={highlighted ? 0.7 : 0.35} side={DoubleSide} />
    </mesh>
  );
}

interface PlanetProps {
  body: Body;
  project: ProjectSummary;
  focused: boolean;
  reducedMotion: boolean;
  positions: MutableRefObject<Map<string, Vector3>>;
  onSelect: (id: string) => void;
  conversations: Conversation[];
  onResume: (c: Conversation) => void;
}

function Planet({ body, project, focused, reducedMotion, positions, onSelect, conversations, onResume }: PlanetProps) {
  const group = useRef<Group>(null);
  const mesh = useRef<Mesh>(null);
  const time = useRef(0);
  const [hover, setHover] = useState(false);
  useCursor(hover);

  useFrame((_, delta) => {
    if (!reducedMotion) time.current += delta;
    const [x, y, z] = orbitPosition(body, time.current);
    group.current!.position.set(x, y, z);
    positions.current.set(body.id, group.current!.position);
    const pulse = body.live && !reducedMotion ? 1 + 0.12 * Math.sin(time.current * 4) : 1;
    mesh.current!.scale.setScalar(pulse * (hover || focused ? 1.15 : 1));
  });

  return (
    <group ref={group}>
      <mesh
        ref={mesh}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(body.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
      >
        <sphereGeometry args={[body.size, 32, 32]} />
        <meshStandardMaterial color={body.color} emissive={body.color} emissiveIntensity={body.live ? 2.2 : 1.1} roughness={0.4} />
      </mesh>
      {(hover || focused) && (
        <Html center position={[0, body.size + 0.7, 0]} className="label">
          <strong>{project.name}</strong>
          <span>
            {project.conversations} conversas · {formatDate(project.updatedAt)}
          </span>
        </Html>
      )}
      {focused &&
        layoutMoons(conversations, body.size).map((m, i) => (
          <Moon key={m.id} body={m} conversation={conversations[i]} reducedMotion={reducedMotion} onResume={onResume} />
        ))}
    </group>
  );
}

interface MoonProps {
  body: Body;
  conversation: Conversation;
  reducedMotion: boolean;
  onResume: (c: Conversation) => void;
}

function Moon({ body, conversation, reducedMotion, onResume }: MoonProps) {
  const mesh = useRef<Mesh>(null);
  const time = useRef(0);
  const [hover, setHover] = useState(false);
  useCursor(hover);

  useFrame((_, delta) => {
    if (!reducedMotion) time.current += delta;
    const [x, y, z] = orbitPosition(body, time.current);
    mesh.current!.position.set(x, y, z);
  });

  return (
    <mesh
      ref={mesh}
      onClick={(e) => {
        e.stopPropagation();
        onResume(conversation);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
    >
      <sphereGeometry args={[hover ? body.size * 1.5 : body.size, 16, 16]} />
      <meshStandardMaterial color={body.color} emissive={body.color} emissiveIntensity={1.8} />
      {hover && (
        <Html center position={[0, 0.4, 0]} className="label">
          <strong>{conversation.title}</strong>
          <span>
            {LABEL[conversation.agent]} · {formatDate(conversation.updatedAt)} · clique para retomar
          </span>
        </Html>
      )}
    </mesh>
  );
}
```

```tsx file=app/web/src/scene/SkillBelt.tsx
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useCursor } from '@react-three/drei';
import { Color, Object3D, type Group, type InstancedMesh } from 'three';
import type { Skill } from '../types.ts';
import { layoutSkills } from './layout.ts';

interface Props {
  skills: Skill[];
  innerRadius: number;
  reducedMotion: boolean;
  onSelect: (path: string) => void;
}

/** Cinturao de estrelas: uma instancia por skill, com cor por origem. */
export function SkillBelt({ skills, innerRadius, reducedMotion, onSelect }: Props) {
  const stars = useMemo(() => layoutSkills(skills, innerRadius), [skills, innerRadius]);
  const mesh = useRef<InstancedMesh>(null);
  const group = useRef<Group>(null);
  const [hover, setHover] = useState<number | null>(null);
  useCursor(hover !== null);

  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new Object3D();
    const c = new Color();
    stars.forEach((s, i) => {
      o.position.set(...s.position);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
      m.setColorAt(i, c.set(s.color));
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [stars]);

  useFrame((_, delta) => {
    if (!reducedMotion && group.current) group.current.rotation.y += delta * 0.01;
  });

  if (!stars.length) return null;
  const hovered = hover !== null ? stars[hover] : null;
  return (
    <group ref={group}>
      <instancedMesh
        key={stars.length}
        ref={mesh}
        args={[undefined, undefined, stars.length]}
        onPointerMove={(e) => {
          e.stopPropagation();
          setHover(e.instanceId ?? null);
        }}
        onPointerOut={() => setHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          if (e.instanceId !== undefined) onSelect(stars[e.instanceId].path);
        }}
      >
        <sphereGeometry args={[0.16, 12, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      {hovered && hover !== null && (
        <Html center position={[hovered.position[0], hovered.position[1] + 0.6, hovered.position[2]]} className="label">
          <strong>{skills[hover].name}</strong>
          <span>skill · {skills[hover].origin}</span>
        </Html>
      )}
    </group>
  );
}
```

```tsx file=app/web/src/scene/CameraRig.tsx
import { useEffect, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Vector3 } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

export const HOME_POSITION = new Vector3(0, 14, 42);
const ORIGIN = new Vector3();
const FOCUS_OFFSET = new Vector3(0, 3, 9);

interface Props {
  focusId: string | null;
  positions: MutableRefObject<Map<string, Vector3>>;
}

/**
 * Voa ate o projeto em foco (ou de volta a visao geral) e depois o segue.
 * Arrastar interrompe o voo; o usuario continua girando em volta do alvo.
 */
export function CameraRig({ focusId, positions }: Props) {
  const controls = useRef<OrbitControlsImpl>(null);
  const flying = useRef(true);
  const lastTarget = useRef(new Vector3());

  useEffect(() => {
    flying.current = true;
  }, [focusId]);

  useFrame(({ camera }, delta) => {
    const c = controls.current;
    if (!c) return;
    const k = 1 - Math.exp(-delta * 3);
    const planet = focusId ? positions.current.get(focusId) : undefined;
    if (planet) {
      lastTarget.current.copy(c.target);
      c.target.lerp(planet, flying.current ? k : 1);
      if (flying.current) {
        const desired = planet.clone().add(FOCUS_OFFSET);
        camera.position.lerp(desired, k);
        if (camera.position.distanceTo(desired) < 0.05) flying.current = false;
      } else {
        // Segue o planeta mantendo o angulo escolhido pelo usuario.
        camera.position.add(c.target.clone().sub(lastTarget.current));
      }
    } else if (flying.current) {
      c.target.lerp(ORIGIN, k);
      camera.position.lerp(HOME_POSITION, k);
      if (camera.position.distanceTo(HOME_POSITION) < 0.05) flying.current = false;
    }
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      minDistance={4}
      maxDistance={140}
      onStart={() => {
        flying.current = false;
      }}
    />
  );
}
```

```tsx file=app/web/src/scene/Galaxy.tsx
import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import type { Vector3 } from 'three';
import type { Conversation, Overview, SessionInfo } from '../types.ts';
import { BlackHole } from './BlackHole.tsx';
import { CameraRig, HOME_POSITION } from './CameraRig.tsx';
import { Projects } from './Projects.tsx';
import { SkillBelt } from './SkillBelt.tsx';
import { beltRadius, layoutProjects } from './layout.ts';
import { HIGH_QUALITY, nextQuality, type Quality } from './quality.ts';

export interface GalaxyProps {
  overview: Overview;
  sessions: SessionInfo[];
  focusId: string | null;
  reducedMotion: boolean;
  /** Escurece a cena (gaveta de terminais aberta). */
  dimmed: boolean;
  onSelectProject: (id: string) => void;
  onSelectProfile: () => void;
  onSelectSkill: (path: string) => void;
  onResume: (c: Conversation) => void;
}

export function Galaxy(props: GalaxyProps) {
  const { overview, sessions, focusId, reducedMotion, dimmed } = props;
  const positions = useRef(new Map<string, Vector3>());
  const [quality, setQuality] = useState<Quality>(HIGH_QUALITY);
  const innerBelt = useMemo(() => beltRadius(layoutProjects(overview.projects, [])), [overview.projects]);

  return (
    <div className={dimmed ? 'galaxy dimmed' : 'galaxy'}>
      <Canvas
        camera={{ position: HOME_POSITION.toArray(), fov: 50, near: 0.1, far: 1000 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <ambientLight intensity={0.4} />
        <pointLight position={[0, 0, 0]} intensity={120} decay={1} color="#ffb070" />
        <BlackHole steps={quality.steps} reducedMotion={reducedMotion} onSelect={props.onSelectProfile} />
        <Projects
          overview={overview}
          sessions={sessions}
          focusId={focusId}
          reducedMotion={reducedMotion}
          positions={positions}
          onSelect={props.onSelectProject}
          onResume={props.onResume}
        />
        <SkillBelt skills={overview.skills} innerRadius={innerBelt} reducedMotion={reducedMotion} onSelect={props.onSelectSkill} />
        <CameraRig focusId={focusId} positions={positions} />
        <FpsMonitor onSample={(fps) => setQuality((q) => nextQuality(q, fps))} />
        {quality.bloom && (
          <EffectComposer>
            <Bloom mipmapBlur intensity={1.1} luminanceThreshold={0.35} luminanceSmoothing={0.2} />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}

/** Uma amostra de FPS por segundo. */
function FpsMonitor({ onSample }: { onSample: (fps: number) => void }) {
  const acc = useRef({ frames: 0, time: 0 });
  useFrame((_, delta) => {
    const a = acc.current;
    a.frames++;
    a.time += delta;
    if (a.time >= 1) {
      onSample(a.frames / a.time);
      a.frames = 0;
      a.time = 0;
    }
  });
  return null;
}
```

- [ ] **Step 3: Checar tipos**

Run: `cd app/web && npm run typecheck`
Expected: sem erros. (Se `three-stdlib` não resolver o tipo do `OrbitControls`, importar o tipo de `three/examples/jsm/controls/OrbitControls.js`.)

- [ ] **Step 4: Commit**

```bash
git add app/web/src/scene
git commit -m "Add black hole scene: lensing shader, projects, moons and skill belt"
```

---

### Task 3: Integrar a cena à interface

**Files:**
- Create: `app/web/src/prefs.ts`, `app/web/src/three.css`
- Modify (substituir inteiros): `app/web/src/types.ts`, `app/web/src/main.tsx`, `app/web/src/App.tsx`, `app/web/src/components/Sidebar.tsx`, `app/web/src/components/TerminalDrawer.tsx`
- Modify: `README.md` (seção "Interface")

**Interfaces:**
- Consumes: `Galaxy` (Task 2), tudo do marco 1.
- Produces: `hasWebGL()`, `systemReducedMotion()`, `usePref(key, initial): [boolean, (v: boolean) => void]`; `View` ganha `{ kind: 'none' }` (só a cena); `TerminalDrawer` passa a receber `collapsed` e `onCollapsedChange`; `Sidebar` recebe `settings` e os dois toggles.

- [ ] **Step 1: Preferências, tipos e estilos**

```ts file=app/web/src/prefs.ts
import { useState } from 'react';

export function hasWebGL(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

export const systemReducedMotion = (): boolean =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Preferencia booleana guardada no localStorage ('1' / '0'). */
export function usePref(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    const saved = localStorage.getItem(key);
    return saved === null ? initial : saved === '1';
  });
  const set = (v: boolean) => {
    localStorage.setItem(key, v ? '1' : '0');
    setValue(v);
  };
  return [value, set];
}
```

```ts file=app/web/src/types.ts
export type * from '../../server/src/types.ts';

/** 'none': so a cena 3D, sem painel aberto. */
export type View =
  | { kind: 'none' }
  | { kind: 'profile' }
  | { kind: 'skills'; focus?: string }
  | { kind: 'project'; id: string };
```

```css file=app/web/src/three.css
.content.three { padding: 0; overflow: hidden; }
.content.three .banner { position: absolute; top: 16px; left: 16px; z-index: 4; }
.galaxy { position: absolute; inset: 0; transition: filter 0.3s; }
.galaxy.dimmed { filter: brightness(0.45) saturate(0.8); }
.panel-overlay {
  position: absolute; top: 16px; right: 16px; bottom: 16px; z-index: 3;
  width: min(460px, 45%); overflow: auto; padding: 20px 24px;
  background: rgba(8, 10, 18, 0.82); backdrop-filter: blur(8px);
  border: 1px solid var(--line); border-radius: 12px;
}
.panel-close { position: sticky; top: 0; float: right; border: none; background: transparent; font-size: 18px; }
.label {
  display: flex; flex-direction: column; gap: 2px; padding: 4px 8px;
  background: rgba(8, 10, 18, 0.85); border: 1px solid var(--line); border-radius: 6px;
  color: var(--text); font-size: 12px; white-space: nowrap; pointer-events: none;
}
.label span { color: var(--muted); }
.settings { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px solid var(--line); margin-top: 12px; font-size: 12px; color: var(--muted); }
.settings label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
```

```tsx file=app/web/src/main.tsx
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import './three.css';
import { App } from './App.tsx';

// Sem StrictMode: ele monta os terminais duas vezes e descartaria a saida
// que chega entre as montagens.
createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 2: Barra lateral e gaveta**

```tsx file=app/web/src/components/Sidebar.tsx
import { useState } from 'react';
import type { Overview, SessionInfo, View } from '../types.ts';

interface Props {
  overview: Overview | null;
  view: View;
  sessions: SessionInfo[];
  settings: { webgl: boolean; mode3d: boolean; reduceMotion: boolean };
  onSelect: (v: View) => void;
  onToggle3d: () => void;
  onToggleReduceMotion: () => void;
}

export function Sidebar({ overview, view, sessions, settings, onSelect, onToggle3d, onToggleReduceMotion }: Props) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const projects = (overview?.projects ?? []).filter((p) => p.name.toLowerCase().includes(q));
  const live = new Set(sessions.filter((s) => s.alive).map((s) => s.projectPath));
  const cls = (active: boolean) => (active ? 'nav active' : 'nav');
  return (
    <nav className="sidebar">
      <div className="brand">llm-agent</div>
      <button className={cls(view.kind === 'profile')} onClick={() => onSelect({ kind: 'profile' })}>
        Você
      </button>
      <button className={cls(view.kind === 'skills')} onClick={() => onSelect({ kind: 'skills' })}>
        Skills <span className="count">{overview?.skills.length ?? 0}</span>
      </button>
      <input className="filter" placeholder="Filtrar projetos" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <ul className="projects">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              className={cls(view.kind === 'project' && view.id === p.id)}
              title={p.path}
              onClick={() => onSelect({ kind: 'project', id: p.id })}
            >
              {live.has(p.path) && <span className="pulse" aria-label="sessão aberta" />}
              {p.name}
              <span className="count">{p.conversations}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="settings">
        <label title={settings.webgl ? '' : 'Este navegador não tem WebGL 2'}>
          <input type="checkbox" checked={settings.webgl && settings.mode3d} disabled={!settings.webgl} onChange={onToggle3d} />
          Modo 3D
        </label>
        <label>
          <input type="checkbox" checked={settings.reduceMotion} onChange={onToggleReduceMotion} />
          Reduzir movimento
        </label>
      </div>
      <div className="hint">Ctrl+K busca · Esc volta · Ctrl+Tab alterna terminais</div>
    </nav>
  );
}
```

```tsx file=app/web/src/components/TerminalDrawer.tsx
import { useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { LiveSocket } from '../api.ts';
import type { ProjectSummary, SessionInfo } from '../types.ts';
import type { TabsState } from '../tabs.ts';
import { LABEL } from '../format.ts';
import { TerminalView } from './TerminalView.tsx';

interface Props {
  tabs: TabsState;
  sessions: SessionInfo[];
  projects: ProjectSummary[];
  socket: LiveSocket | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onReopen: (s: SessionInfo) => void;
}

export function TerminalDrawer(props: Props) {
  const { tabs, sessions, projects, socket, collapsed, onCollapsedChange, onActivate, onClose, onReopen } = props;
  const [height, setHeight] = useState(340);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const names = new Map(projects.map((p) => [p.path, p.name]));
  if (!tabs.order.length || !socket) return null;

  const startDrag = (e: ReactMouseEvent) => {
    const startY = e.clientY;
    const startH = height;
    const move = (ev: MouseEvent) =>
      setHeight(Math.max(140, Math.min(window.innerHeight - 80, startH + startY - ev.clientY)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <section className="drawer" style={{ height: collapsed ? undefined : height }}>
      {!collapsed && <div className="drag" onMouseDown={startDrag} />}
      <div className="tabs">
        {tabs.order.map((id, i) => {
          const s = byId.get(id);
          if (!s) return null;
          return (
            <div
              key={id}
              className={id === tabs.active ? 'tab active' : 'tab'}
              title={s.projectPath}
              onClick={() => {
                onActivate(id);
                onCollapsedChange(false);
              }}
            >
              <span className={`dot ${s.agent}`} />
              {i < 9 && <kbd>{i + 1}</kbd>}
              {names.get(s.projectPath) ?? s.projectPath} · {LABEL[s.agent]} · {s.title}
              {!s.alive && ' (encerrada)'}
              <button
                className="x"
                aria-label="Fechar"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button className="collapse" onClick={() => onCollapsedChange(!collapsed)} aria-label="Recolher">
          {collapsed ? '▲' : '▼'}
        </button>
      </div>
      {/* Recolher so esconde: desmontar perderia o conteudo dos terminais. */}
      <div className="terms" style={{ display: collapsed ? 'none' : undefined }}>
        {tabs.order.map((id) => {
          const s = byId.get(id);
          if (!s) return null;
          return (
            <div key={id} className="term-wrap" style={{ display: id === tabs.active ? 'block' : 'none' }}>
              <TerminalView id={id} active={id === tabs.active && !collapsed} socket={socket} />
              {!s.alive && (
                <div className="ended">
                  Sessão encerrada{s.exitCode !== undefined && ` (código ${s.exitCode})`}.{' '}
                  <button onClick={() => onReopen(s)}>Reabrir</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: App**

```tsx file=app/web/src/App.tsx
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Api, LiveSocket, takeToken, wsUrl, type Status } from './api.ts';
import { bus } from './bus.ts';
import { hasWebGL, systemReducedMotion, usePref } from './prefs.ts';
import { addTab, applyAction, closeTab, emptyTabs, shortcut, syncTabs, type TabsState } from './tabs.ts';
import type { Conversation, Overview, ServerMessage, SessionAgent, SessionInfo, View } from './types.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { ProfilePanel } from './components/ProfilePanel.tsx';
import { SkillsPanel } from './components/SkillsPanel.tsx';
import { ProjectPanel } from './components/ProjectPanel.tsx';
import { TerminalDrawer } from './components/TerminalDrawer.tsx';
import { SearchDialog } from './components/SearchDialog.tsx';

// A cena 3D (three.js) so e baixada quando o modo 3D esta ligado.
const Galaxy = lazy(() => import('./scene/Galaxy.tsx').then((m) => ({ default: m.Galaxy })));

export function App() {
  const token = useMemo(
    () => takeToken(window.location, window.sessionStorage, (url) => window.history.replaceState(null, '', url)),
    [],
  );
  if (!token) {
    return (
      <div className="fatal">
        Abra a interface pela URL impressa por <code>llm-agent ui</code>.
      </div>
    );
  }
  return <Connected token={token} />;
}

function Connected({ token }: { token: string }) {
  const api = useMemo(() => new Api(token), [token]);
  const webgl = useMemo(hasWebGL, []);
  const [mode3d, setMode3d] = usePref('llm-agent-3d', true);
  const [reduceMotion, setReduceMotion] = usePref('llm-agent-reduce-motion', systemReducedMotion());
  const use3d = webgl && mode3d;

  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [tabs, setTabs] = useState<TabsState>(emptyTabs);
  const [view, setView] = useState<View>(use3d ? { kind: 'none' } : { kind: 'profile' });
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [socket, setSocket] = useState<LiveSocket | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const searchOpenRef = useRef(searchOpen);
  searchOpenRef.current = searchOpen;
  const use3dRef = useRef(use3d);
  use3dRef.current = use3d;

  // Sem a cena, sempre ha um painel aberto.
  useEffect(() => {
    if (!use3d && view.kind === 'none') setView({ kind: 'profile' });
  }, [use3d, view.kind]);

  useEffect(() => {
    api.overview().then(
      (o) => {
        setOverview(o);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, [api, revision]);

  useEffect(() => {
    // Depois de (re)conectar, o primeiro "sessions" pede o historico de todas.
    let needAttach = true;
    const ws = new LiveSocket(
      wsUrl(window.location, token),
      (m: ServerMessage) => {
        switch (m.type) {
          case 'sessions':
            setSessions(m.sessions);
            setTabs((t) => syncTabs(t, m.sessions.map((s) => s.id)));
            if (needAttach) {
              needAttach = false;
              for (const s of m.sessions) ws.send({ type: 'attach', id: s.id });
            }
            break;
          case 'opened':
            setTabs((t) => addTab(t, m.session.id));
            setDrawerCollapsed(false);
            break;
          case 'output':
            bus.data(m.id, m.data);
            break;
          case 'history':
            bus.history(m.id, m.data);
            break;
          case 'changed':
            setRevision((r) => r + 1);
            break;
          case 'error':
            setError(m.message);
            break;
        }
      },
      (s) => {
        setStatus(s);
        if (s === 'open') {
          needAttach = true;
          setRevision((r) => r + 1);
        }
      },
    );
    setSocket(ws);
    return () => ws.stop();
  }, [token]);

  const openSession = useCallback(
    (projectPath: string, agent: SessionAgent, resume?: string) => {
      if (!socket?.send({ type: 'open', projectPath, agent, resume, cols: 120, rows: 30 })) {
        setError('Sem conexão com o servidor.');
      }
    },
    [socket],
  );

  const closeSession = useCallback(
    (id: string) => {
      socket?.send({ type: 'close', id });
      setTabs((t) => closeTab(t, id));
    },
    [socket],
  );

  const resumeConversation = useCallback(
    (c: Conversation) => {
      const project = overview?.projects.find((p) => p.path === c.cwd);
      if (project) setView({ kind: 'project', id: project.id });
      openSession(c.cwd, c.agent, c.id);
    },
    [overview, openSession],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inTerminal = (e.target as HTMLElement | null)?.closest?.('.terminal') != null;
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && !inTerminal) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (e.key === 'Escape' && !inTerminal && !searchOpenRef.current && use3dRef.current) {
        setView({ kind: 'none' });
        return;
      }
      const action = shortcut(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      const { state, closed } = applyAction(tabsRef.current, action);
      if (closed) socket?.send({ type: 'close', id: closed });
      setTabs(state);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [socket]);

  const panel =
    view.kind === 'profile' ? (
      <ProfilePanel profile={overview?.profile} />
    ) : view.kind === 'skills' ? (
      <SkillsPanel skills={overview?.skills ?? []} focus={view.focus} />
    ) : view.kind === 'project' ? (
      <ProjectPanel api={api} id={view.id} revision={revision} onOpen={openSession} />
    ) : null;

  return (
    <div className="app">
      <Sidebar
        overview={overview}
        view={view}
        sessions={sessions}
        settings={{ webgl, mode3d, reduceMotion }}
        onSelect={setView}
        onToggle3d={() => setMode3d(!mode3d)}
        onToggleReduceMotion={() => setReduceMotion(!reduceMotion)}
      />
      <main className={use3d ? 'content three' : 'content'}>
        {status !== 'open' && <div className="banner">Reconectando ao servidor…</div>}
        {error && (
          <div className="banner error" onClick={() => setError(null)} title="Clique para fechar">
            {error}
          </div>
        )}
        {use3d ? (
          <>
            {overview && (
              <Suspense fallback={null}>
                <Galaxy
                  overview={overview}
                  sessions={sessions}
                  focusId={view.kind === 'project' ? view.id : null}
                  reducedMotion={reduceMotion}
                  dimmed={tabs.order.length > 0 && !drawerCollapsed}
                  onSelectProject={(id) => setView({ kind: 'project', id })}
                  onSelectProfile={() => setView({ kind: 'profile' })}
                  onSelectSkill={(path) => setView({ kind: 'skills', focus: path })}
                  onResume={resumeConversation}
                />
              </Suspense>
            )}
            {panel && (
              <aside className="panel-overlay">
                <button className="panel-close" onClick={() => setView({ kind: 'none' })} aria-label="Fechar painel">
                  ×
                </button>
                {panel}
              </aside>
            )}
          </>
        ) : (
          panel
        )}
      </main>
      <TerminalDrawer
        tabs={tabs}
        sessions={sessions}
        projects={overview?.projects ?? []}
        socket={socket}
        collapsed={drawerCollapsed}
        onCollapsedChange={setDrawerCollapsed}
        onActivate={(id) => setTabs((t) => ({ ...t, active: id }))}
        onClose={closeSession}
        onReopen={(s) => {
          closeSession(s.id);
          openSession(s.projectPath, s.agent, s.resume);
        }}
      />
      {searchOpen && overview && (
        <SearchDialog
          overview={overview}
          onClose={() => setSearchOpen(false)}
          onProject={(id) => setView({ kind: 'project', id })}
          onSkill={(path) => setView({ kind: 'skills', focus: path })}
          onConversation={resumeConversation}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: README**

Em `README.md`, na seção `## Interface`, logo depois do parágrafo que começa com "Em cada projeto, os botões", inserir:

```markdown
No centro fica um buraco negro: ele representa você (clique para ver instruções e memórias). Os projetos orbitam em volta, os mais recentes mais perto, e os que têm sessão aberta pulsam. Clicar num projeto leva a câmera até ele e mostra as conversas como luas (laranja para o Claude, verde para o Codex); clicar numa lua retoma a conversa. As skills formam o cinturão de estrelas de fora. Arraste para girar, use o scroll para aproximar e `Esc` para voltar à visão geral. Na barra lateral, **Modo 3D** troca para a interface em lista e **Reduzir movimento** congela as órbitas. Em GPUs mais fracas, a cena reduz a qualidade sozinha.
```

- [ ] **Step 5: Checar tudo**

Run: `cd app/web && npm run typecheck && npm test && npm run build`
Expected: sem erros de tipo; testes `passed`; build gera um chunk separado para a cena (`Galaxy-*.js`).

- [ ] **Step 6: Verificação manual (usuário)**

Run (no host WSL): `llm-agent ui --stop; llm-agent ui` e abrir a URL.
Expected:
1. Buraco negro no centro com disco distorcido pela lente (a parte de trás do disco aparece por cima e por baixo da sombra), anel de fótons e um lado do disco mais brilhante.
2. Projetos orbitando; passar o mouse mostra nome e data; clicar voa até o projeto, abre o painel e mostra as luas.
3. Passar o mouse numa lua mostra o título; clicar abre a conversa no terminal, e a cena escurece.
4. Estrelas das skills no anel externo; clicar abre o painel de skills com ela aberta.
5. Clicar no buraco negro abre "Você"; `Esc` fecha o painel e volta à visão geral.
6. "Reduzir movimento" congela tudo; "Modo 3D" desligado volta à interface do marco 1.

- [ ] **Step 7: Commit**

```bash
git add app/web/src README.md
git commit -m "Show the black hole scene behind floating panels"
```
