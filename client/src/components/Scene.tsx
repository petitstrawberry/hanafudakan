import { useEffect, useRef } from 'react';
import * as THREE from 'three/webgpu';
import { cardImage } from '../lib/cards';
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
export default function Scene({
  intensity = 1,
  active = true,
  cardSkin = 'recolored',
  placement = 'ambient',
  game,
  onReady,
}: SceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef({ intensity, active, cardSkin, placement, game });
  const readyRef = useRef(onReady);
  const invalidateRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    settingsRef.current = { intensity, active, cardSkin, placement, game };
    readyRef.current = onReady;
    invalidateRef.current();
  }, [intensity, active, cardSkin, placement, game, onReady]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let initialized = false;
    let frame = 0;
    let previousTime = 0;
    let lastRenderTime = 0;
    let renderedPixelRatio = 0;
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
    const tableFill = new THREE.AmbientLight(0x8eb59f, 1.25);
    const tableKey = new THREE.DirectionalLight(0xffe3a4, 2.1);
    tableKey.position.set(-4.5, 7, 8);
    const tableRim = new THREE.PointLight(0xd95b3d, 0, 12, 2);
    tableRim.position.set(0, 0, 1.2);
    scene.add(tableFill, tableKey, tableRim);

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
    const hyperStagePositions = [
      [-6.1, 2.7, -0.2], [-4.2, -3.0, 0.1], [6.1, 2.7, -0.1], [4.2, -3.0, 0.2],
      [-1.9, 4.1, -0.5], [1.9, -4.0, -0.3], [-6.0, -0.9, 0.3], [6.0, 0.4, 0.25],
    ] as const;
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
      const stage = hyperStagePositions[i];
      card.position.set(stage[0], stage[1], stage[2]);
      card.rotation.set((i - 3) * 0.09, (i % 2 ? -1 : 1) * 0.16, (i - 3) * 0.11);
      hyperCards.push(card);
      hyperCardGroup.add(card);
    }
    hyperCardGroup.visible = false;
    scene.add(hyperCardGroup);

    // A real 3D table sits behind the HTML game controls. The camera orbit is
    // deliberately slow, so the table reads as depth instead of becoming a
    // distracting motion layer. Its geometry is intentionally small and cheap.
    const hyperBoardGroup = new THREE.Group();
    hyperBoardGroup.position.set(0, -0.35, -5.1);
    const boardFrame = new THREE.Mesh(
      geometry(new THREE.BoxGeometry(17.6, 10.6, 0.34)),
      material(new THREE.MeshBasicMaterial({
        color: 0x102e24,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })),
    );
    const boardSurface = new THREE.Mesh(
      geometry(new THREE.PlaneGeometry(17.1, 10.1)),
      material(new THREE.MeshBasicMaterial({
        color: 0x174735,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })),
    );
    boardSurface.position.z = 0.19;
    hyperBoardGroup.add(boardFrame, boardSurface);
    const boardLineMaterial = material(new THREE.LineBasicMaterial({
      color: 0xe7c56e,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    const boardLinePoints = [
      new THREE.Vector3(-8.25, -4.75, 0.23),
      new THREE.Vector3(8.25, -4.75, 0.23),
      new THREE.Vector3(8.25, 4.75, 0.23),
      new THREE.Vector3(-8.25, 4.75, 0.23),
      new THREE.Vector3(-8.25, -4.75, 0.23),
    ];
    const boardOutline = new THREE.Line(
      geometry(new THREE.BufferGeometry().setFromPoints(boardLinePoints)),
      boardLineMaterial,
    );
    hyperBoardGroup.add(boardOutline);
    hyperBoardGroup.visible = false;
    scene.add(hyperBoardGroup);

    // The live table is also represented in the WebGPU scene. HTML cards stay
    // above this layer for hit testing and accessibility, while these meshes
    // provide the actual depth, thickness, perspective and camera motion.
    const gameCardGroup = new THREE.Group();
    gameCardGroup.position.set(0, 0, -3.45);
    const gameCardGeometry = geometry(new THREE.BoxGeometry(0.9, 1.42, 0.075));
    const gameEdgeMaterial = material(new THREE.MeshStandardMaterial({
      color: 0x241d16,
      transparent: true,
      opacity: 0.94,
      depthWrite: true,
      roughness: 0.58,
      metalness: 0.18,
    }));
    const backCanvas = document.createElement('canvas');
    backCanvas.width = 128;
    backCanvas.height = 192;
    const backContext = backCanvas.getContext('2d');
    if (backContext) {
      backContext.fillStyle = '#672f33';
      backContext.fillRect(0, 0, 128, 192);
      backContext.strokeStyle = '#d8ad68';
      backContext.lineWidth = 5;
      backContext.strokeRect(8, 8, 112, 176);
      backContext.strokeStyle = 'rgba(255, 224, 153, .35)';
      backContext.lineWidth = 2;
      backContext.strokeRect(16, 16, 96, 160);
      backContext.fillStyle = 'rgba(246, 211, 126, .8)';
      backContext.font = '700 30px serif';
      backContext.textAlign = 'center';
      backContext.textBaseline = 'middle';
      backContext.fillText('花', 64, 96);
    }
    const backTexture = new THREE.CanvasTexture(backCanvas);
    textures.add(backTexture);
    // Eight field cards + both hands + a visible stock stack + the drawn card
    // fit in every normal deal, with a few spare meshes for a capture flight.
    const gameCardEntries = Array.from({ length: 40 }, () => {
      const front = material(new THREE.MeshStandardMaterial({
        map: backTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        roughness: 0.46,
        metalness: 0.08,
      }));
      const mesh = new THREE.Mesh(gameCardGeometry, [
        gameEdgeMaterial,
        gameEdgeMaterial,
        gameEdgeMaterial,
        gameEdgeMaterial,
        front,
        front,
      ]);
      mesh.visible = false;
      gameCardGroup.add(mesh);
      return { mesh, front };
    });
    gameCardGroup.visible = false;
    scene.add(gameCardGroup);

    // Use the same OSS card art as the playable table. The generated face above
    // remains a deterministic fallback while an SVG texture is loading.
    const textureLoader = new THREE.TextureLoader();
    const gameTextureCache = new Map<string, THREE.Texture>();
    const gameTexturePending = new Set<string>();
    const loadGameTexture = (id: number, skin: CardSkin, front: THREE.MeshStandardMaterial) => {
      const key = `${skin}:${id}`;
      const cached = gameTextureCache.get(key);
      if (cached) {
        front.map = cached;
        front.color.set(0xffffff);
        front.needsUpdate = true;
        return;
      }
      if (gameTexturePending.has(key)) return;
      gameTexturePending.add(key);
      textureLoader.load(
        cardImage(id, skin),
        (texture) => {
          gameTexturePending.delete(key);
          if (disposed) {
            texture.dispose();
            return;
          }
          texture.colorSpace = THREE.SRGBColorSpace;
          textures.add(texture);
          gameTextureCache.set(key, texture);
          front.map = texture;
          front.color.set(0xffffff);
          front.needsUpdate = true;
        },
        undefined,
        () => gameTexturePending.delete(key),
      );
    };
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
      48,
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
        geometry(new THREE.TorusGeometry(3.1 + i * 0.43, 0.018 + i * 0.006, 5, 72)),
        ringMaterial,
      );
      ring.rotation.set(Math.PI / 2 + i * 0.12, i * 0.18, i * 0.33);
      hyperRingGroup.add(ring);
    }
    hyperRingGroup.visible = false;
    scene.add(hyperRingGroup);

    const impactMaterial = material(new THREE.MeshBasicMaterial({
      color: 0xffdc7b,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    const impactRing = new THREE.Mesh(
      geometry(new THREE.TorusGeometry(0.72, 0.045, 8, 64)),
      impactMaterial,
    );
    impactRing.position.set(0, 0, 0.2);
    impactRing.rotation.x = Math.PI / 2;
    impactRing.visible = false;
    gameCardGroup.add(impactRing);
    const shockwaves = Array.from({ length: 3 }, (_, index) => {
      const shockMaterial = material(new THREE.MeshBasicMaterial({
        color: index === 0 ? 0xfff0a6 : index === 1 ? 0xff8a4c : 0x70d8ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      const shockwave = new THREE.Mesh(
        geometry(new THREE.TorusGeometry(0.7 + index * 0.16, 0.035 + index * 0.012, 8, 64)),
        shockMaterial,
      );
      shockwave.position.set(0, 0, 0.15 + index * 0.04);
      shockwave.rotation.x = Math.PI / 2;
      shockwave.visible = false;
      gameCardGroup.add(shockwave);
      return { shockwave, shockMaterial, index };
    });
    const lightningGroup = new THREE.Group();
    const lightningBolts = Array.from({ length: 10 }, (_, index) => {
      const points = 13;
      const positions = new Float32Array(points * 3);
      const boltGeometry = geometry(new THREE.BufferGeometry());
      boltGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const boltMaterial = material(new THREE.MeshBasicMaterial({
        color: index % 3 === 0 ? 0xfff0a6 : index % 3 === 1 ? 0x80d8ff : 0xff714d,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      const bolt = new THREE.Line(boltGeometry, boltMaterial);
      bolt.frustumCulled = false;
      lightningGroup.add(bolt);
      return { bolt, positions, points, phase: random(index + 2200) * Math.PI * 2 };
    });
    lightningGroup.position.set(0, 0, -3.3);
    lightningGroup.visible = false;
    scene.add(lightningGroup);
    let lastEffectId = 0;
    let impactStarted = -10;

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
    let resourcesDisposed = false;
    const disposeSceneResources = () => {
      if (resourcesDisposed) return;
      resourcesDisposed = true;
      // WebGPU keeps material dispose listeners on its render objects. Dispose
      // scene resources before the renderer clears those objects; reversing the
      // order makes Three try to decrement a node that no longer exists.
      try { dust.dispose(); } catch { /* Best effort during an interrupted init. */ }
      geometries.forEach((resource) => {
        try { resource.dispose(); } catch { /* Best effort during teardown. */ }
      });
      materials.forEach((resource) => {
        try { resource.dispose(); } catch { /* Best effort during teardown. */ }
      });
      textures.forEach((resource) => {
        try { resource.dispose(); } catch { /* Best effort during teardown. */ }
      });
      scene.clear();
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
      disposeSceneResources();
      releaseRenderer(renderer);
      renderer = undefined;
      announce('2D');
    };
    const draw = (time: number) => {
      frame = 0;
      if (disposed || !initialized || !renderer) return;
      const moving = settingsRef.current.active && !reducedMotion.matches && !document.hidden;
      const strength = Math.max(0, Math.min(2, settingsRef.current.intensity));
      const hyperActive = strength > 1.08;
      // Rendering a full-screen canvas at display refresh rate is needlessly
      // expensive for a decorative layer. Keep the animation time based, but
      // cap actual GPU presents to 24fps in Hyper and 18fps elsewhere.
      const frameInterval = hyperActive ? 1000 / 24 : 1000 / 18;
      if (moving && lastRenderTime && time - lastRenderTime < frameInterval) {
        frame = window.requestAnimationFrame(draw);
        return;
      }
      lastRenderTime = time;
      const targetPixelRatio = Math.min(
        window.devicePixelRatio || 1,
        hyperActive ? 0.82 : 0.68,
      );
      if (Math.abs(renderedPixelRatio - targetPixelRatio) > 0.01) {
        renderedPixelRatio = targetPixelRatio;
        renderer.setPixelRatio(targetPixelRatio);
        renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), false);
      }
      const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0;
      previousTime = time;
      if (moving) elapsed += delta;
      const motion = elapsed * 0.26;
      loadHyperCardTextures(settingsRef.current.cardSkin);

      const game = settingsRef.current.game;
      const tableActive = Boolean(game && game.phase !== 'waiting');
      const hyperVisualActive = hyperActive && tableActive;
      if (game && game.effectId !== lastEffectId) {
        lastEffectId = game.effectId;
        if (game.hyper) impactStarted = elapsed;
      }
      const impactProgress = Math.max(0, Math.min(1, (elapsed - impactStarted) / 1.5));
      const burstProgress = Math.max(0, Math.min(1, (elapsed - impactStarted) / 1.8));
      const burstPower = hyperVisualActive && game?.hyper && burstProgress < 1
        ? Math.sin(Math.PI * burstProgress)
        : 0;
      const eventCardIds = new Set([
        ...(game?.eventCardId === null || game?.eventCardId === undefined ? [] : [game.eventCardId]),
        ...(game?.eventTargetIds || []),
      ]);
      gameCardGroup.visible = tableActive;
      gameCardEntries.forEach(({ mesh }) => { mesh.visible = false; });
      let gameCardIndex = 0;
      const placeGameCard = (
        id: number,
        x: number,
        y: number,
        z: number,
        rotation: number,
        back = false,
      ) => {
        const entry = gameCardEntries[gameCardIndex++];
        if (!entry) return;
        const { mesh, front } = entry;
        const eventCard = !back && eventCardIds.has(id);
        const stackProgress = eventCard && game?.eventCaptured && (game.eventStage === 'stack' || game.eventStage === 'collect')
          ? Math.min(1, impactProgress * 1.35)
          : 0;
        mesh.visible = true;
        mesh.position.set(
          x * (1 - stackProgress),
          y * (1 - stackProgress) + (eventCard ? Math.sin(impactProgress * Math.PI) * 0.2 : 0),
          z + (eventCard ? Math.sin(impactProgress * Math.PI) * 0.65 : 0),
        );
        mesh.scale.setScalar(eventCard ? 1 + Math.sin(impactProgress * Math.PI) * 0.13 : 1);
        mesh.rotation.set(
          (hyperActive ? Math.sin(motion * 0.7 + gameCardIndex) * 0.08 : 0)
            + (eventCard ? Math.sin(impactProgress * Math.PI) * 0.42 : 0),
          back ? Math.PI : 0,
          rotation + (eventCard ? Math.sin(impactProgress * Math.PI) * (gameCardIndex % 2 ? -0.16 : 0.16) : 0),
        );
        front.opacity = back ? 0.72 : 0.92;
        if (back) {
          front.map = backTexture;
          front.color.set(0xffffff);
          front.needsUpdate = true;
        } else {
          loadGameTexture(id, settingsRef.current.cardSkin, front);
        }
      };
      if (game) {
        const fieldColumns = 4;
        game.field.forEach((id, index) => {
          const column = index % fieldColumns;
          const row = Math.floor(index / fieldColumns);
          placeGameCard(
            id,
            (column - 1.5) * 1.24,
            (0.5 - row) * 1.78,
            0.12 + row * 0.05,
            ((id * 7) % 9 - 4) * 0.018,
          );
        });
        const handGap = game.hand.length > 1 ? Math.min(1.0, 6.6 / (game.hand.length - 1)) : 0;
        game.hand.forEach((id, index) => {
          const x = (index - (game.hand.length - 1) / 2) * handGap;
          placeGameCard(id, x, -3.55, 0.35, (index - 3.5) * 0.035);
        });
        for (let index = 0; index < Math.min(8, game.opponentHandCount); index += 1) {
          const x = (index - (game.opponentHandCount - 1) / 2) * 0.8;
          placeGameCard(0, x, 3.55, 0.32 + index * 0.012, (3.5 - index) * 0.035, true);
        }
        const deckLayers = Math.min(8, Math.max(1, Math.ceil(game.deckCount / 4)));
        for (let index = 0; index < deckLayers; index += 1) {
          placeGameCard(0, -5.05 + index * 0.035, 0, -0.1 + index * 0.04, -0.08, true);
        }
        if (game.drawnCard !== null) {
          placeGameCard(game.drawnCard, 5.05, 0, 0.38, 0.04);
        }
      }
      impactRing.visible = hyperVisualActive && Boolean(game?.hyper) && impactProgress < 1;
      impactRing.scale.setScalar(0.45 + impactProgress * 4.2);
      impactMaterial.opacity = impactRing.visible ? (0.32 + burstPower) * (1 - impactProgress * 0.5) : 0;
      impactRing.rotation.z = motion * 1.4;
      shockwaves.forEach(({ shockwave, shockMaterial, index }) => {
        shockwave.visible = impactRing.visible;
        shockwave.scale.setScalar(0.55 + burstProgress * (4.6 + index * 1.6));
        shockwave.rotation.z = motion * (1.2 + index * 0.7);
        shockMaterial.opacity = impactRing.visible
          ? burstPower * (0.92 - index * 0.2)
          : 0;
      });
      gameCardGroup.rotation.x = hyperVisualActive
        ? Math.sin(motion * 0.18) * 0.04 + burstPower * Math.sin(burstProgress * 18) * 0.12
        : 0;
      gameCardGroup.rotation.y = hyperVisualActive
        ? Math.sin(motion * 0.24) * 0.05 + burstPower * 0.24
        : 0;

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
      hyperCardGroup.visible = hyperVisualActive;
      hyperCardMaterials.forEach((cardMaterial, i) => {
        cardMaterial.opacity = hyperActive
          ? (i % 2 ? 0.86 : 0.82) * Math.min(1, (strength - 1) * 2.1)
          : 0;
      });
      hyperCards.forEach((card, i) => {
        const phase = motion * (0.65 + i * 0.025) + i * 1.7;
        const stage = hyperStagePositions[i];
        card.position.y = stage[1] + Math.sin(phase) * 0.34;
        card.position.x = stage[0] + Math.sin(phase * 0.7) * 0.24;
        card.position.z = stage[2] + Math.cos(phase * 0.5) * 0.16;
        card.rotation.x = Math.sin(phase * 0.8) * 0.42;
        card.rotation.y = Math.cos(phase * 0.63) * 0.72;
        card.rotation.z = (i - 3.5) * 0.11 + Math.sin(phase * 0.5) * 0.12;
      });
      hyperCardGroup.rotation.x = Math.sin(motion * 0.22) * 0.09;
      hyperCardGroup.rotation.y = Math.cos(motion * 0.18) * 0.14;
      hyperCardGroup.position.y = 0.1 + Math.sin(motion * 0.31) * 0.14;
      hyperBoardGroup.visible = tableActive;
      const boardOpacity = tableActive
        ? hyperActive
          ? Math.min(1, (strength - 1) * 2)
          : 0.34
        : 0;
      (boardFrame.material as THREE.MeshBasicMaterial).opacity = boardOpacity * 0.32;
      (boardSurface.material as THREE.MeshBasicMaterial).opacity = boardOpacity * 0.16;
      boardLineMaterial.opacity = boardOpacity * 0.34;
      // Orbit the camera around the actual board, instead of only rotating
      // card sprites. This is the depth cue that makes Hyper feel like a 3D
      // table while the ordinary room remains still and quiet.
      const cameraAngle = motion * (hyperActive ? 0.62 : tableActive ? 0.1 : 0)
        + burstPower * 1.8;
      const cameraRadius = hyperVisualActive ? 2.1 + burstPower * 3.4 : 0.72;
      camera.position.x = tableActive ? Math.sin(cameraAngle) * cameraRadius : 0;
      camera.position.y = tableActive
        ? Math.sin(cameraAngle * 0.72) * (hyperVisualActive ? 0.82 + burstPower * 1.35 : 0.24)
        : 0;
      camera.position.z = tableActive
        ? 15 + Math.cos(cameraAngle * 0.8) * (hyperVisualActive ? 0.62 + burstPower * 0.85 : 0.18)
        : 15;
      camera.lookAt(0, -0.2, -3.9);
      camera.rotation.z = hyperVisualActive
        ? Math.sin(burstProgress * 22) * burstPower * 0.085
        : 0;
      hyperSparks.visible = hyperVisualActive;
      const impactStrength = impactRing.visible ? Math.max(burstPower, 1 - impactProgress) : 0;
      hyperSparkMaterial.opacity = hyperActive
        ? 0.44 * Math.min(1, (strength - 1) * 2) + impactStrength * 0.9
        : 0;
      for (let i = 0; i < hyperSparks.count; i += 1) {
        const phase = motion * (0.55 + random(i + 1200) * 0.8) + i * 0.83;
        const radius = impactStrength > 0
          ? 0.45 + impactProgress * (3.5 + random(i + 1300) * 3.6)
          : 3.4 + random(i + 1300) * 3.2;
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
      hyperRingGroup.visible = hyperVisualActive;
      hyperRingGroup.rotation.z = motion * 0.17;
      hyperRingGroup.rotation.y = Math.sin(motion * 0.4) * 0.18;
      hyperRingGroup.scale.setScalar(1 + impactStrength * 0.58);
      hyperRingMaterials.forEach((ringMaterial, i) => {
        ringMaterial.opacity = hyperActive
          ? (0.2 - i * 0.025) * Math.min(1, (strength - 1) * 2) + impactStrength * (0.12 - i * 0.02)
          : 0;
      });
      const lightningPower = hyperVisualActive
        ? Math.min(1, 0.18 + burstPower * 1.8)
        : 0;
      lightningGroup.visible = lightningPower > 0.01;
      lightningBolts.forEach(({ bolt, positions, points, phase }, index) => {
        const angle = phase + motion * (0.75 + index * 0.04);
        const endRadius = 2.7 + random(index + 2300) * 3.2;
        const endX = Math.cos(angle) * endRadius;
        const endY = Math.sin(angle * 1.13) * endRadius * 0.72;
        for (let point = 0; point < points; point += 1) {
          const progress = point / (points - 1);
          const jitter = point === 0 || point === points - 1
            ? 0
            : Math.sin(motion * 3.8 + phase + point * 4.7) * (0.11 + burstPower * 0.42);
          const offset = Math.sin(phase + point * 8.1) * (0.08 + burstPower * 0.22);
          positions[point * 3] = endX * progress + jitter + offset;
          positions[point * 3 + 1] = endY * progress + Math.cos(phase + point * 5.4) * (0.08 + burstPower * 0.2);
          positions[point * 3 + 2] = Math.sin(phase + point * 2.1) * 0.34 + progress * 0.5;
        }
        const position = bolt.geometry.getAttribute('position');
        position.needsUpdate = true;
        (bolt.material as THREE.MeshBasicMaterial).opacity = lightningPower
          * (0.34 + (index % 3) * 0.12);
        bolt.scale.setScalar(0.74 + burstPower * 0.7);
      });
      tableRim.intensity = hyperVisualActive ? 3 + burstPower * 25 : 0;
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
      // Keep the first frame cheap too; draw() refines this when Hyper starts.
      renderedPixelRatio = Math.min(window.devicePixelRatio || 1, 0.68);
      renderer.setPixelRatio(renderedPixelRatio);
      renderer.setSize(width, height, false);
      invalidate();
    };
    const onMotionPreference = () => { previousTime = 0; lastRenderTime = 0; invalidate(); };
    const onVisibility = () => {
      previousTime = 0;
      lastRenderTime = 0;
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
          candidate = new THREE.WebGPURenderer({ antialias: false, alpha: true });
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
        try { context = canvas.getContext('webgl2', { antialias: false, alpha: true }); } catch { /* Unavailable. */ }
        if (!context) {
          announce('2D');
          return;
        }
        try {
          candidate = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: true, forceWebGL: true });
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
      disposeSceneResources();
      releaseRenderer(renderer);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`ambient-scene ${placement === 'table' ? 'table-scene' : ''}`}
      aria-hidden="true"
      style={{ position: placement === 'table' ? 'absolute' : 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none',
        background: 'radial-gradient(ellipse at 18% 35%, #102b21 0%, transparent 58%), radial-gradient(ellipse at 87% 74%, #211f12 0%, transparent 49%), #07110e' }}
    >
      <div style={{ position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 50% 44%, transparent 25%, rgba(1,7,5,.5) 100%)' }} />
    </div>
  );
}
