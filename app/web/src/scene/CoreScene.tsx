import { useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import type { Vector3 } from 'three';
import type { Conversation, Overview, SessionInfo } from '../types.ts';
import { BlackHole } from './BlackHole.tsx';
import { Projects } from './Projects.tsx';
import { SkillBelt } from './SkillBelt.tsx';
import type { CoreSignal } from './core.ts';
import { beltRadius, layoutProjects } from './layout.ts';
import { HIGH_QUALITY, nextQuality, type Quality } from './quality.ts';

export interface CoreSceneProps {
  signal: MutableRefObject<CoreSignal>;
  reducedMotion: boolean;
  /** Escurece a cena (gaveta de terminais aberta). */
  dimmed: boolean;
  overview: Overview | null;
  sessions: SessionInfo[];
  /** Projeto em foco (destacado, com as conversas como luas). */
  focusId: string | null;
  /** Mostrar projetos e skills como planetas e estrelas. */
  planets: boolean;
  onSelectProject: (id: string) => void;
  onSelectProfile: () => void;
  onSelectSkill: (path: string) => void;
  onResume: (c: Conversation) => void;
}

/**
 * Buraco negro no centro (a voz do Jarvis), com os projetos em orbita e as
 * skills no cinturao. A camera fica sempre apontada para o centro.
 */
export function CoreScene(props: CoreSceneProps) {
  const { signal, reducedMotion, dimmed, overview, sessions, focusId, planets } = props;
  const positions = useRef(new Map<string, Vector3>());
  const [quality, setQuality] = useState<Quality>(HIGH_QUALITY);
  const innerBelt = useMemo(() => beltRadius(layoutProjects(overview?.projects ?? [], [])), [overview?.projects]);

  return (
    <div className={dimmed ? 'galaxy dimmed' : 'galaxy'}>
      <Canvas camera={{ position: [0, 16, 46], fov: 50, near: 0.1, far: 1000 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <ambientLight intensity={0.4} />
        <pointLight position={[0, 0, 0]} intensity={120} decay={1} color="#ffb070" />
        <BlackHole signal={signal} steps={quality.steps} reducedMotion={reducedMotion} onSelect={props.onSelectProfile} />
        {planets && overview && (
          <>
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
          </>
        )}
        <OrbitControls target={[0, 0, 0]} enablePan={false} minDistance={22} maxDistance={80} rotateSpeed={0.4} />
        <FpsMonitor onSample={(fps) => setQuality((q) => nextQuality(q, fps))} />
        {quality.bloom && (
          <EffectComposer>
            <Bloom mipmapBlur intensity={1.0} luminanceThreshold={0.35} luminanceSmoothing={0.2} />
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
