import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { cardImage } from '../lib/cards';
import type { CardSkin } from '../lib/cardSkin';

export interface SceneProps {
  intensity?: number;
  active?: boolean;
  cardSkin?: CardSkin;
  onReady?: (backend: string) => void;
}

type Backend = 'WebGPU' | 'WebGL2' | '2D';

/** Decorative GPU scenery. Gameplay never depends on the renderer being available. */
export default function Scene({ intensity = 1, active = true, cardSkin = 'recolored', onReady }: SceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef({ intensity, active, cardSkin });
  const readyRef = useRef(onReady);
  const invalidateRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    settingsRef.current = { intensity, active, cardSkin };
    readyRef.current = onReady;
    invalidateRef.current();
  }, [intensity, active, onReady]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let initialized = false;
    let frame = 0;
    let previousTime = 0;
    let elapsed = 0;
    let renderer: THREE.WebGPURenderer | undefined;
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
      geometry(new THREE.IcosahedronGeometry(0.016, 0)), dustMaterial, 160,
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
    const petals = Array.from({ length: 22 }, (_, i) => {
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
        geometry(new THREE.TorusGeometry(4.6 + i * 0.19, 0.008, 3, 220)), ringMaterial,
      );
      ring.scale.y = 1.24;
      ring.rotation.set(i * 0.047, i * 0.038, i * 0.02);
      orbitGroup.add(ring);
    }
    scene.add(orbitGroup);

    // Hyper rooms bring the cards out of the flat table as a small 3D stage.
    // The group stays hidden at normal intensity, so ordinary rooms keep the
    // quiet ambient composition and do not pay for extra visual noise. The
    // faces are generated locally instead of loading another asset: that gives
    // the cards a readable identity in WebGL/WebGPU and keeps the self-hosted
    // build completely deterministic.
    const hyperCardGroup = new THREE.Group();
    hyperCardGroup.position.set(0, 0.1, -3.5);
    const hyperCards: THREE.Mesh[] = [];
    const hyperCardMaterials: THREE.MeshBasicMaterial[] = [];
    const hyperCardIds = [8, 20, 28, 36, 44, 12, 32, 0];
    for (let i = 0; i < hyperCardIds.length; i += 1) {
      const cardCanvas = document.createElement('canvas');
      cardCanvas.width = 256;
      cardCanvas.height = 400;
      const cardContext = cardCanvas.getContext('2d');
      if (cardContext) {
        const cardGradient = cardContext.createLinearGradient(0, 0, 256, 400);
        cardGradient.addColorStop(0, i % 2 ? '#7e2e2a' : '#1d604b');
        cardGradient.addColorStop(0.55, i % 2 ? '#c38b3d' : '#b18a3d');
        cardGradient.addColorStop(1, '#111b19');
        cardContext.fillStyle = cardGradient;
        cardContext.fillRect(0, 0, 256, 400);
        cardContext.strokeStyle = '#ffe5a2';
        cardContext.lineWidth = 8;
        cardContext.strokeRect(12, 12, 232, 376);
        cardContext.strokeStyle = 'rgba(255, 233, 165, .45)';
        cardContext.lineWidth = 2;
        cardContext.strokeRect(24, 24, 208, 352);
        cardContext.textAlign = 'center';
        cardContext.textBaseline = 'middle';
        cardContext.shadowColor = 'rgba(255, 222, 130, .9)';
        cardContext.shadowBlur = 22;
        cardContext.fillStyle = '#fff0bd';
        cardContext.font = '700 122px serif';
        cardContext.fillText(['桜', '蝶', '月', '鹿', '鳳', '鳥', '盃', '鶴'][i], 128, 190);
        cardContext.shadowBlur = 0;
        cardContext.font = '600 18px sans-serif';
        cardContext.letterSpacing = '3px';
        cardContext.fillText('HYPER CONTRACT', 128, 330);
        cardContext.font = '500 14px sans-serif';
        cardContext.fillStyle = 'rgba(255, 241, 190, .72)';
        cardContext.fillText(`0${i + 1} / 08`, 128, 355);
      }
      const cardTexture = new THREE.CanvasTexture(cardCanvas);
      textures.add(cardTexture);
      const front = material(new THREE.MeshBasicMaterial({
        map: cardTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.NormalBlending,
      }));
      const edge = material(new THREE.MeshBasicMaterial({
        color: 0xf9e1a0,
        transparent: true,
        opacity: 0,
        wireframe: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      hyperCardMaterials.push(front, edge);
      const card = new THREE.Mesh(
        geometry(new THREE.BoxGeometry(1.08, 1.64, 0.075)),
        [edge, edge, edge, edge, front, front],
      );
      const slot = i % 4;
      const row = Math.floor(i / 4);
      card.position.set((slot - 1.5) * 1.58, row === 0 ? 1.02 : -1.02, -row * 0.46);
      card.rotation.set((i - 3) * 0.09, (i % 2 ? -1 : 1) * 0.16, (i - 3) * 0.11);
      hyperCards.push(card);
      hyperCardGroup.add(card);
    }
    hyperCardGroup.visible = false;
    scene.add(hyperCardGroup);

    // Use the same OSS card art as the playable table. The generated face above
    // remains a deterministic fallback while an SVG texture is loading.
    const textureLoader = new THREE.TextureLoader();
    let loadedSkin = '';
    const loadHyperCardTextures = (skin: CardSkin) => {
      if (loadedSkin === skin) return;
      loadedSkin = skin;
      hyperCardIds.forEach((id, index) => {
        textureLoader.load(
          cardImage(id, skin),
          (texture) => {
            if (disposed) {
              texture.dispose();
              return;
            }
            texture.colorSpace = THREE.SRGBColorSpace;
            textures.add(texture);
            const front = hyperCardMaterials[index * 2];
            if (!front) return;
            front.map = texture;
            front.color.set(0xffffff);
            front.needsUpdate = true;
          },
          undefined,
          () => undefined,
        );
      });
    };
    loadHyperCardTextures(cardSkin);

    const hyperSparkMaterial = material(new THREE.MeshBasicMaterial({
      color: 0xffd36f,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    const hyperSparks = new THREE.InstancedMesh(
      geometry(new THREE.TetrahedronGeometry(0.045, 0)),
      hyperSparkMaterial,
      96,
    );
    hyperSparks.frustumCulled = false;
    scene.add(hyperSparks);

    const hyperRingGroup = new THREE.Group();
    hyperRingGroup.position.set(0, 0.25, -4.4);
    const hyperRingMaterials: THREE.MeshBasicMaterial[] = [];
    for (let i = 0; i < 4; i += 1) {
      const ringMaterial = material(new THREE.MeshBasicMaterial({
        color: i % 2 ? 0xe65a3b : 0xf5ca6e,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      hyperRingMaterials.push(ringMaterial);
      const ring = new THREE.Mesh(
        geometry(new THREE.TorusGeometry(3.1 + i * 0.43, 0.018 + i * 0.006, 5, 180)),
        ringMaterial,
      );
      ring.rotation.set(Math.PI / 2 + i * 0.12, i * 0.18, i * 0.33);
      hyperRingGroup.add(ring);
    }
    hyperRingGroup.visible = false;
    scene.add(hyperRingGroup);

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
    const releaseRenderer = (target: THREE.WebGPURenderer | undefined) => {
      if (!target) return;
      target.domElement.remove();
      // Three's dispose() calls async setAnimationLoop() internally. On a failed
      // init that would retry the rejected init and leak an unhandled rejection.
      // Candidates are only released after their init promise has settled.
      if (!target.hasInitialized()) return;
      try { void Promise.resolve(target.dispose()).catch(() => undefined); } catch { /* Failed initialization. */ }
    };
    const fallback = () => {
      initialized = false;
      window.cancelAnimationFrame(frame);
      frame = 0;
      releaseRenderer(renderer);
      renderer = undefined;
      announce('2D');
    };
    const draw = (time: number) => {
      frame = 0;
      if (disposed || !initialized || !renderer) return;
      const moving = settingsRef.current.active && !reducedMotion.matches && !document.hidden;
      const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0;
      previousTime = time;
      if (moving) elapsed += delta;
      const strength = Math.max(0, Math.min(2, settingsRef.current.intensity));
      const motion = elapsed * 0.26;
      const hyperActive = strength > 1.08;
      loadHyperCardTextures(settingsRef.current.cardSkin);

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
      hyperCardGroup.visible = hyperActive;
      hyperCardMaterials.forEach((cardMaterial, i) => {
        cardMaterial.opacity = hyperActive
          ? (i % 2 ? 0.86 : 0.82) * Math.min(1, (strength - 1) * 2.1)
          : 0;
      });
      hyperCards.forEach((card, i) => {
        const phase = motion * (0.65 + i * 0.025) + i * 1.7;
        const slot = i % 4;
        const row = Math.floor(i / 4);
        card.position.y = (row === 0 ? 1.02 : -1.02) + Math.sin(phase) * 0.34;
        card.position.x = (slot - 1.5) * 1.58 + Math.sin(phase * 0.7) * 0.24;
        card.position.z = -row * 0.46 + Math.cos(phase * 0.5) * 0.16;
        card.rotation.x = Math.sin(phase * 0.8) * 0.42;
        card.rotation.y = Math.cos(phase * 0.63) * 0.72;
        card.rotation.z = (slot - 1.5) * 0.11 + Math.sin(phase * 0.5) * 0.12;
      });
      hyperCardGroup.rotation.x = Math.sin(motion * 0.22) * 0.09;
      hyperCardGroup.rotation.y = Math.cos(motion * 0.18) * 0.14;
      hyperCardGroup.position.y = 0.1 + Math.sin(motion * 0.31) * 0.14;
      hyperSparks.visible = hyperActive;
      hyperSparkMaterial.opacity = hyperActive ? 0.44 * Math.min(1, (strength - 1) * 2) : 0;
      for (let i = 0; i < hyperSparks.count; i += 1) {
        const phase = motion * (0.55 + random(i + 1200) * 0.8) + i * 0.83;
        const radius = 3.4 + random(i + 1300) * 3.2;
        dummy.position.set(
          Math.cos(phase) * radius,
          Math.sin(phase * 1.27) * 2.6,
          -3.6 + Math.sin(phase * 0.8) * 1.6,
        );
        const scale = 0.45 + 0.8 * (0.5 + 0.5 * Math.sin(phase * 2.1));
        dummy.scale.setScalar(scale);
        dummy.rotation.set(phase, phase * 0.7, phase * 1.3);
        dummy.updateMatrix();
        hyperSparks.setMatrixAt(i, dummy.matrix);
      }
      hyperSparks.instanceMatrix.needsUpdate = true;
      hyperRingGroup.visible = hyperActive;
      hyperRingGroup.rotation.z = motion * 0.17;
      hyperRingGroup.rotation.y = Math.sin(motion * 0.4) * 0.18;
      hyperRingMaterials.forEach((ringMaterial, i) => {
        ringMaterial.opacity = hyperActive
          ? (0.2 - i * 0.025) * Math.min(1, (strength - 1) * 2)
          : 0;
      });
      try { renderer.render(scene, camera); } catch { fallback(); return; }
      if (moving) frame = window.requestAnimationFrame(draw);
    };
    const invalidate = () => {
      if (!disposed && initialized && !frame) frame = window.requestAnimationFrame(draw);
    };
    invalidateRef.current = invalidate;
    const resize = () => {
      if (disposed || !renderer) return;
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      camera.aspect = width / height;
      camera.position.z = camera.aspect < 0.75 ? 20 : 15;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(width, height, false);
      invalidate();
    };
    const onMotionPreference = () => { previousTime = 0; invalidate(); };
    const onVisibility = () => {
      previousTime = 0;
      if (document.hidden) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      } else invalidate();
    };
    reducedMotion.addEventListener('change', onMotionPreference);
    document.addEventListener('visibilitychange', onVisibility);

    const initialize = async () => {
      let candidate: THREE.WebGPURenderer | undefined;
      let hasWebGPU = false;
      try {
        hasWebGPU = Boolean(await navigator.gpu?.requestAdapter());
      } catch { /* A browser may expose WebGPU while denying adapter access. */ }
      if (disposed) return;

      if (hasWebGPU) {
        try {
          candidate = new THREE.WebGPURenderer({ antialias: true, alpha: true });
          await candidate.init();
        } catch {
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
        try { context = canvas.getContext('webgl2', { antialias: true, alpha: true }); } catch { /* Unavailable. */ }
        if (!context) {
          announce('2D');
          return;
        }
        try {
          candidate = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true, forceWebGL: true });
          await candidate.init();
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
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;';
      host.prepend(renderer.domElement);
      initialized = true;
      resize();
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(host);
      const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean };
      announce(backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2');
      invalidate();
    };
    void initialize().catch(fallback);

    return () => {
      disposed = true;
      initialized = false;
      invalidateRef.current = () => undefined;
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      reducedMotion.removeEventListener('change', onMotionPreference);
      document.removeEventListener('visibilitychange', onVisibility);
      releaseRenderer(renderer);
      dust.dispose();
      geometries.forEach((resource) => resource.dispose());
      materials.forEach((resource) => resource.dispose());
      textures.forEach((resource) => resource.dispose());
      scene.clear();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="ambient-scene"
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none',
        background: 'radial-gradient(ellipse at 18% 35%, #102b21 0%, transparent 58%), radial-gradient(ellipse at 87% 74%, #211f12 0%, transparent 49%), #07110e' }}
    >
      <div style={{ position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 50% 44%, transparent 25%, rgba(1,7,5,.5) 100%)' }} />
    </div>
  );
}
