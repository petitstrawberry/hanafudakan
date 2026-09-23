/// <reference types="vite/client" />
import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { WebGLRenderer } from 'three';
import type { CardSkin } from '../lib/cardSkin';

export interface SceneProps {
  intensity?: number;
  active?: boolean;
  cardSkin?: CardSkin;
  placement?: 'ambient' | 'table';
  game?: TableSceneState;
  onReady?: (backend: string) => void;
}

export type TableSceneState = {
  hyper: boolean;
  field: number[];
  hand: number[];
  opponentHandCount: number;
  deckCount: number;
  drawnCard: number | null;
  phase: string;
  turn: number;
  eventId: number;
  eventCaptured: boolean;
  eventCardId: number | null;
  eventTargetIds: number[];
  eventStage: 'reveal' | 'travel' | 'stack' | 'settle' | 'collect' | null;
  effectId: number;
};

type Backend = 'WebGPU' | 'WebGL2' | '2D';

/** Decorative GPU scenery. Gameplay never depends on the renderer being available. */
export default function Scene({ intensity = 1, active = true, placement = 'ambient', game, onReady }: SceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef({ intensity, active });
  const readyRef = useRef(onReady);
  const invalidateRef = useRef<() => void>(() => undefined);
  const wakeRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    settingsRef.current = { intensity, active };
    invalidateRef.current();
  }, [intensity, active]);
  useEffect(() => { readyRef.current = onReady; }, [onReady]);
  useEffect(() => { wakeRef.current(); }, [game?.eventId, game?.effectId, game?.phase, game?.turn]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!active) {
      host.dataset.backend = '2D';
      host.dataset.animating = 'false';
      readyRef.current?.('2D');
      return;
    }

    let disposed = false;
    let initialized = false;
    let frame = 0;
    let wakeTimer = 0;
    let previousTime = 0;
    let elapsed = 0;
    let lastActivity = performance.now();
    let renderer: THREE.WebGPURenderer | WebGLRenderer | undefined;
    let resizeObserver: ResizeObserver | undefined;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 60);
    camera.position.set(0, 0, 15);
    scene.fog = new THREE.FogExp2(0x06110e, 0.037);

    const geometry = <T extends THREE.BufferGeometry,>(value: T): T => {
      geometries.add(value);
      return value;
    };
    const material = <T extends THREE.Material,>(value: T): T => {
      materials.add(value);
      return value;
    };
    // Fixed seeds keep the composition steady across React remounts.
    const random = (seed: number) => {
      const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return value - Math.floor(value);
    };

    const dustMaterial = material(new THREE.MeshBasicMaterial({
      color: 0xd9bc75,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    const dust = new THREE.InstancedMesh(
      geometry(new THREE.IcosahedronGeometry(0.016, 0)), dustMaterial, 96,
    );
    dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    dust.frustumCulled = false;
    scene.add(dust);
    const dummy = new THREE.Object3D();

    const petalShape = new THREE.Shape();
    petalShape.moveTo(0, -0.18);
    petalShape.bezierCurveTo(-0.23, -0.015, -0.18, 0.2, -0.055, 0.2);
    petalShape.quadraticCurveTo(-0.025, 0.19, 0, 0.14);
    petalShape.quadraticCurveTo(0.025, 0.19, 0.055, 0.2);
    petalShape.bezierCurveTo(0.18, 0.2, 0.23, -0.015, 0, -0.18);
    const petalGeometry = geometry(new THREE.ShapeGeometry(petalShape, 10));
    const petalMaterials = [0xd9a483, 0xb66552, 0xc8b47a].map((color) => material(
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.26,
        side: THREE.DoubleSide, depthWrite: false }),
    ));
    const petals = Array.from({ length: 12 }, (_, i) => {
      const petal = new THREE.Mesh(petalGeometry, petalMaterials[i % petalMaterials.length]);
      petal.scale.setScalar(0.4 + random(i + 80) * 0.85);
      scene.add(petal);
      return petal;
    });

    const orbitGroup = new THREE.Group();
    orbitGroup.position.set(6.5, 1, -5);
    orbitGroup.rotation.set(0.58, 0.72, -0.35);
    const orbitMaterials: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < 7; i += 1) {
      const ringMaterial = material(new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xb79752 : 0x4b826b,
        transparent: true,
        opacity: 0.13 - i * 0.009,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      orbitMaterials.push(ringMaterial);
      const ring = new THREE.Mesh(
        geometry(new THREE.TorusGeometry(4.6 + i * 0.19, 0.008, 3, 96)), ringMaterial,
      );
      ring.scale.y = 1.24;
      ring.rotation.set(i * 0.047, i * 0.038, i * 0.02);
      orbitGroup.add(ring);
    }
    scene.add(orbitGroup);

    // A soft canvas texture adds depth without a postprocessing dependency.
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 128;
    glowCanvas.height = 128;
    const context = glowCanvas.getContext('2d');
    if (context) {
      const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(255,255,255,0.38)');
      gradient.addColorStop(0.4, 'rgba(255,255,255,0.12)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 128, 128);
      const glowTexture = new THREE.CanvasTexture(glowCanvas);
      textures.add(glowTexture);
      const glowGeometry = geometry(new THREE.PlaneGeometry(20, 20));
      const jadeGlow = new THREE.Mesh(glowGeometry, material(new THREE.MeshBasicMaterial({
        map: glowTexture, color: 0x175e43, transparent: true, opacity: 0.55,
        depthWrite: false, blending: THREE.AdditiveBlending,
      })));
      jadeGlow.position.set(-7, 2, -9);
      scene.add(jadeGlow);
      const goldGlow = new THREE.Mesh(glowGeometry, material(new THREE.MeshBasicMaterial({
        map: glowTexture, color: 0x6e4b21, transparent: true, opacity: 0.3,
        depthWrite: false, blending: THREE.AdditiveBlending,
      })));
      goldGlow.position.set(9, -3, -10);
      scene.add(goldGlow);
    }

    const announce = (backend: Backend) => {
      if (!disposed) {
        host.dataset.backend = backend;
        readyRef.current?.(backend);
      }
    };
    let sceneReleased = false;
    const releaseScene = () => {
      if (sceneReleased) return;
      sceneReleased = true;
      // Material disposal notifies WebGPU's render-object/node caches. Keep
      // those caches alive until all scene resources have been released.
      dust.dispose();
      geometries.forEach((resource) => resource.dispose());
      materials.forEach((resource) => resource.dispose());
      textures.forEach((resource) => resource.dispose());
      scene.clear();
    };
    const releaseRenderer = (target: THREE.WebGPURenderer | WebGLRenderer | undefined) => {
      if (!target) return;
      target.domElement.remove();
      // Three's dispose() calls async setAnimationLoop() internally. On a failed
      // init that would retry the rejected init and leak an unhandled rejection.
      // Candidates are only released after their init promise has settled.
      if ('hasInitialized' in target && !target.hasInitialized()) return;
      try { void Promise.resolve(target.dispose()).catch(() => undefined); } catch { /* Failed initialization. */ }
    };
    const fallback = () => {
      initialized = false;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(wakeTimer);
      frame = 0;
      wakeTimer = 0;
      releaseScene();
      releaseRenderer(renderer);
      renderer = undefined;
      announce('2D');
    };
    const frameInterval = 1000 / 12;
    const idleAfter = 10_000;
    const scheduleNext = () => {
      if (disposed || wakeTimer || frame) return;
      wakeTimer = window.setTimeout(() => {
        wakeTimer = 0;
        if (!disposed) frame = window.requestAnimationFrame(draw);
      }, frameInterval);
    };
    const draw = (time: number) => {
      frame = 0;
      if (disposed || !initialized || !renderer) return;
      const moving = settingsRef.current.active && !reducedMotion.matches && !document.hidden && time - lastActivity < idleAfter;
      host.dataset.animating = String(moving);
      const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0;
      previousTime = time;
      if (moving) elapsed += delta;
      const strength = Math.max(0, Math.min(2, settingsRef.current.intensity));
      // The scene is ambient only: drifting dust, petals and distant orbits.
      // Hyper captures are decorated on the DOM cards themselves.
      const motion = elapsed * 0.26;

      for (let i = 0; i < dust.count; i += 1) {
        const speed = 0.18 + random(i + 600) * 0.45;
        dummy.position.set(
          (random(i + 1) - 0.5) * 27 + Math.sin(motion * 0.3 + i) * 0.35,
          ((random(i + 200) * 19 + motion * speed) % 19) - 9.5,
          -9 + random(i + 400) * 12,
        );
        const scale = (0.35 + random(i + 1000) * 0.8) * (0.85 + Math.sin(motion + i) * 0.15);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        dust.setMatrixAt(i, dummy.matrix);
      }
      dust.instanceMatrix.needsUpdate = true;
      dustMaterial.opacity = 0.4 * strength;

      petals.forEach((petal, i) => {
        petal.position.set(
          (random(i + 40) - 0.5) * 26 + Math.sin(motion * 0.35 + i) * 0.65,
          8 - ((random(i + 70) * 16 + motion * (0.26 + random(i + 91) * 0.32)) % 16),
          -6 + random(i + 150) * 6,
        );
        petal.rotation.set(motion * 0.22 + i, Math.sin(motion * 0.15 + i), motion * 0.18 + i * 1.9);
      });
      petalMaterials.forEach((petalMaterial) => { petalMaterial.opacity = 0.25 * strength; });
      orbitGroup.rotation.z = -0.35 + Math.sin(motion * 0.09) * 0.045;
      orbitMaterials.forEach((ringMaterial, i) => { ringMaterial.opacity = (0.13 - i * 0.009) * strength; });
      try {
        renderer.render(scene, camera);
        if (import.meta.env.DEV) host.dataset.renderCount = String(Number(host.dataset.renderCount || 0) + 1);
      } catch (error) {
        console.error('[hanafudakan] ambient scene render failed', error);
        fallback();
        return;
      }
      if (moving) scheduleNext();
    };
    const invalidate = () => {
      if (disposed || !initialized) return;
      window.clearTimeout(wakeTimer);
      wakeTimer = 0;
      if (!frame) frame = window.requestAnimationFrame(draw);
    };
    invalidateRef.current = invalidate;
    const wake = () => { lastActivity = performance.now(); previousTime = 0; invalidate(); };
    wakeRef.current = wake;
    document.addEventListener('pointerdown', wake, { passive: true });
    document.addEventListener('keydown', wake);
    const resize = () => {
      if (disposed || !renderer) return;
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.position.z = camera.aspect < 0.75 ? 20 : 15;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1));
      renderer.setSize(width, height, false);
      invalidate();
    };
    const onMotionPreference = () => wake();
    const onVisibility = () => {
      previousTime = 0;
      if (document.hidden) {
        window.cancelAnimationFrame(frame);
        window.clearTimeout(wakeTimer);
        frame = 0;
        wakeTimer = 0;
      } else wake();
    };
    reducedMotion.addEventListener('change', onMotionPreference);
    document.addEventListener('visibilitychange', onVisibility);

    const initialize = async () => {
      let candidate: THREE.WebGPURenderer | WebGLRenderer | undefined;
      let hasWebGPU = false;
      try {
        hasWebGPU = Boolean(await navigator.gpu?.requestAdapter());
      } catch { /* A browser may expose WebGPU while denying adapter access. */ }
      if (disposed) return;

      if (hasWebGPU) {
        try {
          const webgpu = new THREE.WebGPURenderer({ antialias: false, alpha: true });
          await webgpu.init();
          candidate = webgpu;
        } catch (error) {
          console.warn('[hanafudakan] WebGPU init failed, trying WebGL2', error);
          releaseRenderer(candidate);
          candidate = undefined;
        }
      }
      if (disposed) { releaseRenderer(candidate); return; }

      if (!candidate) {
        // Probe the same canvas that Three will use: its WebGL backend assumes
        // getContext succeeds, which is false when GPU rendering is disabled.
        const canvas = document.createElement('canvas');
        let context: WebGL2RenderingContext | null = null;
        try { context = canvas.getContext('webgl2', { antialias: false, alpha: true }); } catch { /* Unavailable. */ }
        if (!context) {
          announce('2D');
          return;
        }
        try {
          candidate = new WebGLRenderer({ canvas, antialias: false, alpha: true });
        } catch {
          releaseRenderer(candidate);
          announce('2D');
          return;
        }
      }
      if (disposed) { releaseRenderer(candidate); return; }
      renderer = candidate;
      renderer.setClearColor(0x05100c, 0);
      renderer.domElement.setAttribute('aria-hidden', 'true');
      renderer.domElement.style.cssText = 'position:absolute;inset:0;z-index:1;display:block;width:100%;height:100%;pointer-events:none;';
      host.prepend(renderer.domElement);
      initialized = true;
      resize();
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      const backend = 'backend' in renderer
        ? renderer.backend as unknown as { isWebGPUBackend?: boolean }
        : undefined;
      announce(backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2');
      invalidate();
    };
    void initialize().catch(fallback);

    return () => {
      disposed = true;
      initialized = false;
      invalidateRef.current = () => undefined;
      wakeRef.current = () => undefined;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(wakeTimer);
      resizeObserver?.disconnect();
      reducedMotion.removeEventListener('change', onMotionPreference);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerdown', wake);
      document.removeEventListener('keydown', wake);
      releaseScene();
      releaseRenderer(renderer);
    };
  }, [active]);

  return (
    <div
      ref={hostRef}
      className={`ambient-scene ${placement === 'table' ? 'table-scene' : ''}`}
      aria-hidden="true"
      style={{ position: placement === 'table' ? 'absolute' : 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: placement === 'table' ? 0 : -1,
        background: 'radial-gradient(ellipse at 18% 35%, #102b21 0%, transparent 58%), radial-gradient(ellipse at 87% 74%, #211f12 0%, transparent 49%), #07110e' }}
    >
      <div style={{ position: 'absolute', inset: 0, zIndex: 0,
        background: 'radial-gradient(ellipse at 50% 44%, transparent 25%, rgba(1,7,5,.5) 100%)' }} />
    </div>
  );
}
