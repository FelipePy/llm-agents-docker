import { useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { Atom } from './Atom.tsx';
import type { CoreSignal } from './core.ts';
import { HIGH_QUALITY, nextQuality, type Quality } from './quality.ts';

export interface CoreSceneProps {
  signal: MutableRefObject<CoreSignal>;
  reducedMotion: boolean;
  /** Escurece a cena (gaveta de terminais aberta). */
  dimmed: boolean;
}

/** O atomo, sobre um ceu estrelado. A camera nunca sai dele. */
export function CoreScene({ signal, reducedMotion, dimmed }: CoreSceneProps) {
  const [quality, setQuality] = useState<Quality>(HIGH_QUALITY);
  return (
    <div className={dimmed ? 'galaxy dimmed' : 'galaxy'}>
      <Canvas camera={{ position: [0, 0, 15], fov: 45 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <ambientLight intensity={0.55} color="#fff1cf" />
        <pointLight position={[5, 6, 8]} intensity={140} decay={2} color="#ffe2a0" />
        <pointLight position={[-6, -4, 6]} intensity={50} decay={2} color="#ffb15c" />
        <Stars radius={90} depth={40} count={2200} factor={3} fade speed={reducedMotion ? 0 : 0.3} />
        <Atom signal={signal} reducedMotion={reducedMotion} detail={quality.detail} />
        <OrbitControls enablePan={false} enableZoom={false} rotateSpeed={0.4} />
        <FpsMonitor onSample={(fps) => setQuality((q) => nextQuality(q, fps))} />
        {quality.bloom && (
          <EffectComposer>
            <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.65} luminanceSmoothing={0.2} />
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
