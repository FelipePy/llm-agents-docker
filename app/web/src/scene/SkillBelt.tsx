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
