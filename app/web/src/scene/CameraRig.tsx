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
