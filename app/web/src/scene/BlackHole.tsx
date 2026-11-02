import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useCursor } from '@react-three/drei';
import { Matrix4, ShaderMaterial, Vector3 } from 'three';
import { DISK_INNER, DISK_OUTER } from './layout.ts';
import { smoothHeat, targetHeat, type CoreSignal } from './core.ts';
import { fragmentShader, vertexShader } from './blackHoleShader.ts';

interface Props {
  /** Sinal da voz (estado + volume), lido a cada quadro. */
  signal: MutableRefObject<CoreSignal>;
  steps: number;
  reducedMotion: boolean;
  onSelect: () => void;
}

/** Fundo com lente gravitacional + esfera invisivel que oculta e recebe o clique. */
export function BlackHole({ signal, steps, reducedMotion, onSelect }: Props) {
  const heat = useRef(0.05);
  const level = useRef(0);
  const time = useRef(0);
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
          uHeat: { value: 0 },
          uLevel: { value: 0 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ camera }, delta) => {
    const u = material.uniforms;
    const dt = Math.min(delta, 0.1);
    const s = signal.current;
    heat.current = smoothHeat(heat.current, targetHeat(s.mode, s.level), dt);
    level.current = smoothHeat(level.current, s.mode === 'speaking' ? s.level : 0, dt);
    // Quente, o disco gira mais rapido; "reduzir movimento" congela e atenua.
    const h = reducedMotion ? heat.current * 0.25 : heat.current;
    if (!reducedMotion) time.current += dt * (0.5 + 2.5 * h);
    u.uTime.value = time.current;
    u.uHeat.value = h;
    u.uLevel.value = reducedMotion ? level.current * 0.3 : level.current;
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
