import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line, Trail } from '@react-three/drei';
import { AdditiveBlending, BackSide, Color, EllipseCurve, ShaderMaterial, Vector3, type Group, type Mesh } from 'three';
import { MODE_COLORS, electronSpeed, smoothLevel, type CoreSignal } from './core.ts';
import { coreFragment, coreVertex, haloFragment, haloVertex } from './atomShader.ts';

interface Orbit {
  a: number;
  b: number;
  rotation: [number, number, number];
  phase: number;
}

const ORBITS: Orbit[] = [
  { a: 2.7, b: 1.5, rotation: [1.15, 0, 0.2], phase: 0 },
  { a: 2.9, b: 1.3, rotation: [-0.5, 1.0, 0.4], phase: 2.1 },
  { a: 2.5, b: 1.7, rotation: [0.3, -0.9, -0.9], phase: 4.2 },
];

interface Props {
  signal: MutableRefObject<CoreSignal>;
  reducedMotion: boolean;
  /** Subdivisoes da malha do nucleo. */
  detail: number;
}

export function Atom({ signal, reducedMotion, detail }: Props) {
  const group = useRef<Group>(null);
  const nucleus = useRef<Mesh>(null);
  const electrons = useRef<(Mesh | null)[]>([]);
  const lines = useRef<({ material: { color: Color } } | null)[]>([]);
  const angles = useRef(ORBITS.map((o) => o.phase));
  const level = useRef(0);
  const time = useRef(0);

  const colors = useMemo(
    () => ({
      core: new Color(MODE_COLORS.idle.core),
      hot: new Color(MODE_COLORS.idle.hot),
      ring: new Color(MODE_COLORS.idle.ring),
      target: new Color(),
    }),
    [],
  );
  const core = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: coreVertex,
        fragmentShader: coreFragment,
        uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uColor: { value: colors.core }, uHot: { value: colors.hot } },
      }),
    [colors],
  );
  const halo = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
        uniforms: { uColor: { value: colors.core }, uLevel: { value: 0 } },
        side: BackSide,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    [colors],
  );
  useEffect(
    () => () => {
      core.dispose();
      halo.dispose();
    },
    [core, halo],
  );
  const curves = useMemo(
    () => ORBITS.map((o) => new EllipseCurve(0, 0, o.a, o.b).getPoints(160).map((p) => new Vector3(p.x, p.y, 0))),
    [],
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const s = signal.current;
    level.current = smoothLevel(level.current, s.mode === 'speaking' ? s.level : 0, dt);
    // Com "reduzir movimento", a reacao a voz fica atenuada e nada gira.
    const lv = reducedMotion ? level.current * 0.3 : level.current;
    if (!reducedMotion) time.current += dt;

    const k = 1 - Math.exp(-dt * 4);
    const palette = MODE_COLORS[s.mode];
    colors.core.lerp(colors.target.set(palette.core), k);
    colors.hot.lerp(colors.target.set(palette.hot), k);
    colors.ring.lerp(colors.target.set(palette.ring), k);

    core.uniforms.uTime.value = time.current;
    core.uniforms.uLevel.value = lv;
    halo.uniforms.uLevel.value = lv;
    const breathe = reducedMotion ? 1 : 1 + Math.sin(time.current * 1.2) * 0.02;
    nucleus.current?.scale.setScalar(breathe + lv * 0.12);

    const speed = reducedMotion ? 0 : electronSpeed(s.mode, level.current);
    ORBITS.forEach((o, i) => {
      angles.current[i] += dt * speed * (1 + i * 0.12);
      electrons.current[i]?.position.set(Math.cos(angles.current[i]) * o.a, Math.sin(angles.current[i]) * o.b, 0);
      lines.current[i]?.material.color.copy(colors.ring);
    });
    if (group.current && !reducedMotion) group.current.rotation.y += dt * 0.08;
  });

  return (
    <group ref={group}>
      <mesh ref={nucleus} material={core}>
        <icosahedronGeometry args={[1.15, detail]} />
      </mesh>
      <mesh material={halo} raycast={() => null}>
        <sphereGeometry args={[2.1, 48, 48]} />
      </mesh>
      {ORBITS.map((o, i) => (
        <group key={i} rotation={o.rotation}>
          <Line
            ref={(l) => {
              lines.current[i] = l as unknown as { material: { color: Color } } | null;
            }}
            points={curves[i]}
            color={MODE_COLORS.idle.ring}
            lineWidth={1}
            transparent
            opacity={0.55}
          />
          <Trail width={0.9} length={5} color="#bfe3ff" attenuation={(w) => w * w}>
            <mesh
              ref={(m) => {
                electrons.current[i] = m;
              }}
            >
              <sphereGeometry args={[0.09, 16, 16]} />
              <meshBasicMaterial color="#e8f4ff" toneMapped={false} />
            </mesh>
          </Trail>
        </group>
      ))}
    </group>
  );
}
