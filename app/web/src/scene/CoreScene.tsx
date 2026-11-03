import { useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { Globe } from './Globe.tsx';
import type { CoreSignal } from './core.ts';
import type { GlobeColor } from './globe.ts';
import { HIGH_QUALITY, nextQuality, type Quality } from './quality.ts';

export interface CoreSceneProps {
  signal: MutableRefObject<CoreSignal>;
  reducedMotion: boolean;
  /** Escurece a cena (gaveta de terminais aberta). */
  dimmed: boolean;
  color: GlobeColor;
  onSelectProfile: () => void;
}

/** O globo holografico no centro (a voz do Jarvis). A camera fica sempre apontada para ele. */
export function CoreScene({ signal, reducedMotion, dimmed, color, onSelectProfile }: CoreSceneProps) {
  const [quality, setQuality] = useState<Quality>(HIGH_QUALITY);
  return (
    <div className={dimmed ? 'galaxy dimmed' : 'galaxy'}>
      <Canvas camera={{ position: [0, 3, 25], fov: 50, near: 0.1, far: 200 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <Globe signal={signal} color={color} detail={quality.detail} reducedMotion={reducedMotion} onSelect={onSelectProfile} />
        <OrbitControls target={[0, 0, 0]} enablePan={false} minDistance={14} maxDistance={45} rotateSpeed={0.4} />
        <FpsMonitor onSample={(fps) => setQuality((q) => nextQuality(q, fps))} />
        {quality.bloom && (
          <EffectComposer>
            <Bloom mipmapBlur intensity={1.3} luminanceThreshold={0.2} luminanceSmoothing={0.25} />
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
