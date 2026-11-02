import { useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line, Trail } from '@react-three/drei';
import { Color, type Group, type Mesh } from 'three';
import type { Line2 } from 'three-stdlib';
import {
  MODE_COLORS, NEUTRON_COLOR, PROTON_COLOR, electronSpeed, jitterAmplitude, smoothHeat, targetHeat, wobble, type CoreSignal,
} from './core.ts';

interface Orbit {
  a: number;
  b: number;
  rotation: [number, number, number];
  phase: number;
  /** Numero de ondas da deformacao. */
  waves: number;
}

const ORBITS: Orbit[] = [
  { a: 2.8, b: 1.4, rotation: [1.2, 0, 0.25], phase: 0, waves: 3 },
  { a: 3.0, b: 1.3, rotation: [-0.55, 1.05, 0.4], phase: 2.1, waves: 5 },
  { a: 2.6, b: 1.6, rotation: [0.35, -0.95, -0.9], phase: 4.2, waves: 4 },
];
const SEGMENTS = 180;

/** Protons e neutrons numa esfera de Fibonacci, mais um no centro. */
const NUCLEONS = [[0, 0, 0], ...Array.from({ length: 13 }, (_, i) => {
  const y = 1 - (i / 12) * 2;
  const r = Math.sqrt(1 - y * y);
  const theta = i * 2.39996;
  return [Math.cos(theta) * r * 0.52, y * 0.52, Math.sin(theta) * r * 0.52];
})].map((p, i) => ({ base: p as [number, number, number], proton: i % 2 === 0, seed: i * 1.618 }));

/** Ponto da orbita deformada (calor = tremor e ondulacao). */
function orbitPoint(o: Orbit, theta: number, t: number, w: number, out: number[], k: number): void {
  const r = 1 + w * Math.sin(o.waves * theta + t * 3.1 + o.phase) + w * 0.5 * Math.sin((o.waves + 2) * theta - t * 4.7);
  out[k] = Math.cos(theta) * o.a * r;
  out[k + 1] = Math.sin(theta) * o.b * r;
  out[k + 2] = w * 1.4 * Math.sin(o.waves * 0.5 * theta + t * 2.3);
}

interface Props {
  signal: MutableRefObject<CoreSignal>;
  reducedMotion: boolean;
  /** Segmentos das esferas. */
  detail: number;
}

export function Atom({ signal, reducedMotion, detail }: Props) {
  const nucleus = useRef<Group>(null);
  const nucleons = useRef<(Mesh | null)[]>([]);
  const orbitGroups = useRef<(Group | null)[]>([]);
  const lines = useRef<(Line2 | null)[]>([]);
  const electrons = useRef<(Mesh | null)[]>([]);
  const angles = useRef(ORBITS.map((o) => o.phase));
  const heat = useRef(0.05);
  const time = useRef(0);
  const ringColor = useMemo(() => new Color(MODE_COLORS.idle.ring), []);
  const target = useMemo(() => new Color(), []);
  const buffers = useMemo(() => ORBITS.map(() => new Array<number>((SEGMENTS + 1) * 3).fill(0)), []);
  const point = useMemo(() => [0, 0, 0], []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const s = signal.current;
    heat.current = smoothHeat(heat.current, targetHeat(s.mode, s.level), dt);
    // "Reduzir movimento": quase sem agitacao e nada girando.
    const h = reducedMotion ? heat.current * 0.25 : heat.current;
    const motion = reducedMotion ? 0 : 1;
    time.current += dt * (0.6 + 2.4 * h) * motion;
    const t = time.current;

    // Protons e neutrons vibram em torno da posicao de repouso.
    const amp = jitterAmplitude(h);
    NUCLEONS.forEach((n, i) => {
      const m = nucleons.current[i];
      if (!m) return;
      m.position.set(
        n.base[0] + Math.sin(t * 9.1 + n.seed * 12.9) * amp,
        n.base[1] + Math.sin(t * 11.3 + n.seed * 7.1) * amp,
        n.base[2] + Math.sin(t * 8.7 + n.seed * 3.3) * amp,
      );
    });
    if (nucleus.current && motion) {
      nucleus.current.rotation.y += dt * (0.15 + 1.8 * h);
      nucleus.current.rotation.x += dt * 0.6 * h;
    }

    target.set(MODE_COLORS[s.mode].ring);
    ringColor.lerp(target, 1 - Math.exp(-dt * 4));
    const w = wobble(h);
    const speed = electronSpeed(h) * motion;
    ORBITS.forEach((o, i) => {
      const buf = buffers[i];
      for (let j = 0; j <= SEGMENTS; j++) orbitPoint(o, (j / SEGMENTS) * Math.PI * 2, t, w, buf, j * 3);
      const line = lines.current[i];
      if (line) {
        line.geometry.setPositions(buf);
        line.material.color.copy(ringColor);
      }
      angles.current[i] += dt * speed * (1 + i * 0.15);
      orbitPoint(o, angles.current[i], t, w, point, 0);
      electrons.current[i]?.position.set(point[0], point[1], point[2]);
      // Com calor, os planos das orbitas precessionam.
      const g = orbitGroups.current[i];
      if (g && motion) g.rotation.z += dt * (0.03 + 0.7 * h) * (i % 2 ? 1 : -1);
    });
  });

  return (
    <group>
      <group ref={nucleus}>
        {NUCLEONS.map((n, i) => (
          <mesh
            key={i}
            ref={(m) => {
              nucleons.current[i] = m;
            }}
            position={n.base}
          >
            <sphereGeometry args={[0.3, detail, detail]} />
            <meshStandardMaterial
              color={n.proton ? PROTON_COLOR : NEUTRON_COLOR}
              emissive={n.proton ? PROTON_COLOR : NEUTRON_COLOR}
              emissiveIntensity={n.proton ? 0.35 : 0.12}
              roughness={0.35}
              metalness={0.3}
            />
          </mesh>
        ))}
      </group>
      {ORBITS.map((o, i) => (
        <group key={i} rotation={o.rotation}>
          <group
            ref={(g) => {
              orbitGroups.current[i] = g;
            }}
          >
            <Line
              ref={(l) => {
                lines.current[i] = l as unknown as Line2 | null;
              }}
              points={Array.from({ length: SEGMENTS + 1 }, (_, j) => {
                const th = (j / SEGMENTS) * Math.PI * 2;
                return [Math.cos(th) * o.a, Math.sin(th) * o.b, 0] as [number, number, number];
              })}
              color={MODE_COLORS.idle.ring}
              lineWidth={1.2}
              transparent
              opacity={0.75}
            />
            <Trail width={0.7} length={4} color={MODE_COLORS.idle.electron} attenuation={(x) => x * x}>
              <mesh
                ref={(m) => {
                  electrons.current[i] = m;
                }}
              >
                <sphereGeometry args={[0.085, 16, 16]} />
                <meshBasicMaterial color={MODE_COLORS.speaking.electron} toneMapped={false} />
              </mesh>
            </Trail>
          </group>
        </group>
      ))}
    </group>
  );
}
