import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, useCursor } from '@react-three/drei';
import {
  AdditiveBlending, Color, InstancedBufferAttribute, InstancedBufferGeometry, MeshBasicMaterial, PlaneGeometry, ShaderMaterial, type Group, type Mesh,
} from 'three';
import { smoothHeat, targetHeat, type CoreSignal } from './core.ts';
import { GLOBE_COLORS, GLOBE_RADIUS, GLOBE_STYLES, globeDynamics, type GlobeColor, type GlobeRing, type GlobeStyle } from './globe.ts';
import { globeFragmentShader, globeVertexShader } from './globeShader.ts';

interface Props {
  /** Sinal da voz (estado + volume), lido a cada quadro. */
  signal: MutableRefObject<CoreSignal>;
  color: GlobeColor;
  globeStyle: GlobeStyle;
  /** 1 = todos os fragmentos; menos em GPUs fracas. */
  detail: number;
  reducedMotion: boolean;
  onSelect: () => void;
}

/** O Jarvis: um globo que se agita e cresce enquanto ele fala, no estilo escolhido. */
export function Globe({ signal, color, globeStyle, detail, reducedMotion, onSelect }: Props) {
  const style = GLOBE_STYLES[globeStyle];
  const heat = useRef(0.05);
  const level = useRef(0);
  const time = useRef(0);
  const spinTime = useRef(0);
  const rings = useRef<Group>(null);
  const core = useRef<Mesh>(null);
  const [hover, setHover] = useState(false);
  useCursor(hover);

  const fragments = useMemo(() => style.build(Math.round(style.fragments * detail)), [style, detail]);
  const geometry = useMemo(() => {
    const base = new PlaneGeometry(1, 1, style.segments, 1);
    const g = new InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    g.setAttribute('aBand', new InstancedBufferAttribute(fragments.band, 4));
    g.setAttribute('aShape', new InstancedBufferAttribute(fragments.shape, 4));
    g.setAttribute('aTilt', new InstancedBufferAttribute(fragments.tilt, 2));
    g.instanceCount = fragments.count;
    return g;
  }, [fragments, style]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: globeVertexShader,
        fragmentShader: globeFragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uSpinTime: { value: 0 },
          uExpand: { value: 1 },
          uAgitation: { value: 0 },
          uGrow: { value: 1 },
          uGlow: { value: 0.6 },
          uBase: { value: new Color() },
          uHot: { value: new Color() },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );
  const ringMaterial = useMemo(() => new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending }), []);
  const coreMaterial = useMemo(() => new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending }), []);
  useEffect(
    () => () => {
      material.dispose();
      ringMaterial.dispose();
      coreMaterial.dispose();
    },
    [material, ringMaterial, coreMaterial],
  );
  useEffect(() => {
    const c = GLOBE_COLORS[color];
    material.uniforms.uBase.value.set(c.base);
    material.uniforms.uHot.value.set(c.hot);
    ringMaterial.color.set(c.base);
    coreMaterial.color.set(c.hot);
  }, [color, material, ringMaterial, coreMaterial]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const s = signal.current;
    heat.current = smoothHeat(heat.current, targetHeat(s.mode, s.level), dt);
    // Volume: sobe rapido e cai rapido tambem, para acompanhar as silabas.
    const target = s.mode === 'speaking' ? s.level : 0;
    level.current += (target - level.current) * (1 - Math.exp(-(target > level.current ? 25 : 9) * dt));
    const motion = reducedMotion ? 0.25 : 1;
    const d = globeDynamics(heat.current * motion, level.current * motion);
    time.current += dt;
    spinTime.current += dt * d.spin * motion;
    const u = material.uniforms;
    u.uTime.value = time.current;
    u.uSpinTime.value = spinTime.current;
    u.uExpand.value = d.expand;
    u.uAgitation.value = d.agitation;
    u.uGrow.value = d.grow;
    u.uGlow.value = d.glow;
    ringMaterial.opacity = Math.min(1, 0.35 + 0.5 * d.glow);
    coreMaterial.opacity = Math.min(1, 0.5 + 0.5 * d.glow);
    if (rings.current) {
      rings.current.scale.setScalar(d.expand);
      rings.current.children.forEach((ring, i) => {
        ring.rotation.z += dt * style.rings[i].speed * d.spin * motion;
      });
    }
    core.current?.scale.setScalar(0.8 + 0.25 * heat.current + 0.6 * level.current);
  });

  return (
    <group>
      <mesh geometry={geometry} material={material} frustumCulled={false} raycast={() => null} />
      <group ref={rings}>
        {style.rings.map((r: GlobeRing, i: number) => (
          <group key={`${globeStyle}-${i}`} rotation={[r.tilt[0], r.tilt[1], 0]}>
            <mesh material={ringMaterial} raycast={() => null}>
              <torusGeometry args={[r.radius, 0.022, 6, 160, Math.PI * 1.6]} />
            </mesh>
          </group>
        ))}
      </group>
      <mesh ref={core} material={coreMaterial} raycast={() => null}>
        <sphereGeometry key={globeStyle} args={[style.coreRadius, 32, 32]} />
      </mesh>
      {/* Area de clique (invisivel): abre "Você". */}
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
        <sphereGeometry args={[GLOBE_RADIUS * 0.75, 24, 24]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {hover && (
        <Html center position={[0, GLOBE_RADIUS + 1.6, 0]} className="label">
          <strong>Você</strong>
          <span>instruções e memórias</span>
        </Html>
      )}
    </group>
  );
}
