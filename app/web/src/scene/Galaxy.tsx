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
