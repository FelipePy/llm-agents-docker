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
