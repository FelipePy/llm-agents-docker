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
