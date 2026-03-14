import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  BLOCK_FACES,
  createConnectionMask,
  type BlockConnectionMask,
  type BlockDefinition,
  type BlockFace,
  type ConduitTextureProfile,
  type BlockInstance,
  type BlockType,
  type Vec3,
} from "../models/blocks";
import { MoveGizmo } from "./gizmos/MoveGizmo";
import { getBlockTypeDefinition, useBlockTypesStore } from "../state/useBlockTypesStore";
import { useBlocksStore } from "../state/useBlocksStore";
import { RotateGizmo } from "./gizmos/RotateGizmo";

export interface SceneAPI {
  cleanup: () => void;
  addBlock: (block: BlockInstance) => void;
  removeBlock: (id: string) => void;
  setSelectedBlock: (id: string | null) => void;
  setSelectedGroupBounds: (bounds: { min: Vec3; max: Vec3 } | null) => void;
  updateBlock: (block: BlockInstance) => void;
}

interface RenderedBlockEntry {
  root: THREE.Group;
  typeId: BlockType;
  shapeKey: string;
}

type ConduitAxis = "x" | "y" | "z";

const MIN_BLOCK_SCALE = 0.05;
const MAX_BLOCK_SCALE = 1;
const DEFAULT_CUBE_SCALE: Vec3 = { x: 1, y: 1, z: 1 };
const DEFAULT_CONDUIT_SCALE: Vec3 = { x: 0.375, y: 0.375, z: 0.375 };

const FACE_OFFSETS: Record<BlockFace, Vec3> = {
  right: { x: 1, y: 0, z: 0 },
  left: { x: -1, y: 0, z: 0 },
  top: { x: 0, y: 1, z: 0 },
  bottom: { x: 0, y: -1, z: 0 },
  front: { x: 0, y: 0, z: 1 },
  back: { x: 0, y: 0, z: -1 },
};

const toPositionKey = (position: Vec3) => `${position.x}:${position.y}:${position.z}`;

const isConduitDefinition = (definition: BlockDefinition) =>
  definition.renderMode === "conduit";

const getDefinitionConnectTag = (definition: BlockDefinition) =>
  definition.connectTag?.trim().toLowerCase() || definition.id.toLowerCase();

const canConduitsConnect = (a: BlockDefinition, b: BlockDefinition) =>
  isConduitDefinition(a) &&
  isConduitDefinition(b) &&
  getDefinitionConnectTag(a) === getDefinitionConnectTag(b);

const canConduitConnectToNeighbor = (
  conduitDefinition: BlockDefinition,
  neighborDefinition: BlockDefinition
) => {
  if (!isConduitDefinition(conduitDefinition)) return false;

  if (isConduitDefinition(neighborDefinition)) {
    return canConduitsConnect(conduitDefinition, neighborDefinition);
  }

  return true;
};

const normalizeConnectionMask = (mask: Partial<Record<BlockFace, boolean>> | undefined) => {
  const normalized = createConnectionMask();

  if (!mask) return normalized;

  BLOCK_FACES.forEach((face) => {
    normalized[face] = mask[face] === true;
  });

  return normalized;
};

const connectionMaskKey = (mask: BlockConnectionMask) =>
  BLOCK_FACES.map((face) => (mask[face] ? "1" : "0")).join("");

const clampScale = (value: number) =>
  THREE.MathUtils.clamp(value, MIN_BLOCK_SCALE, MAX_BLOCK_SCALE);

const resolveScale = (definition: BlockDefinition, fallback: Vec3) => {
  if (!definition.scale) {
    return fallback;
  }

  return {
    x: clampScale(definition.scale.x),
    y: clampScale(definition.scale.y),
    z: clampScale(definition.scale.z),
  };
};

export default function initScene(
  mountEl: HTMLDivElement,
  initialBlocks: BlockInstance[],
  onSelectBlock?: (id: string | null) => void
): SceneAPI {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  const camera = new THREE.PerspectiveCamera(
    60,
    mountEl.clientWidth / mountEl.clientHeight,
    0.1,
    1000
  );
  camera.position.set(6, 6, 6);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(mountEl.clientWidth, mountEl.clientHeight, false);
  mountEl.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, 0, 0);

  const moveGizmo = new MoveGizmo(camera, renderer.domElement, (locked) => {
    controls.enabled = !locked;
  });
  scene.add(moveGizmo.group);

  const rotateGizmo = new RotateGizmo(camera, renderer.domElement, (locked) => {
    controls.enabled = !locked;
  });
  scene.add(rotateGizmo.group);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(5, 10, 7);
  scene.add(directional);

  const grid = new THREE.GridHelper(16, 16, 0x444444, 0x222222);
  grid.position.y = -0.5;
  scene.add(grid);

  type CachedMaterial = THREE.Material | THREE.Material[];

  // Reuse materials/textures aggressively to avoid rebuilding GPU resources on every frame.
  const materialCache = new Map<BlockType, CachedMaterial>();
  const textureCache = new Map<string, THREE.Texture>();
  const textureLoader = new THREE.TextureLoader();
  let blockTypesRevision = useBlockTypesStore.getState().revision;

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  const groupOutlineColor = new THREE.Color(0x45d1ff);
  const selectedBlockOutlineColor = new THREE.Color(0x4f8dff);
  const hoveredBlockOutlineColor = new THREE.Color(0x7cecff);
  let groupSelectionHelper: THREE.Box3Helper | null = null;
  let selectedBlockOutlineHelper: THREE.Box3Helper | null = null;
  let hoveredBlockOutlineHelper: THREE.Box3Helper | null = null;

  const renderedBlocks = new Map<string, RenderedBlockEntry>();
  let selectedBlockId: string | null = null;
  let hoveredBlockId: string | null = null;

  let blocksByPositionCacheRef: BlockInstance[] | null = null;
  let blocksByPositionCache = new Map<string, BlockInstance>();

  const disposeCachedMaterial = (material: CachedMaterial) => {
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
      return;
    }

    material.dispose();
  };

  const disposeTextureCache = () => {
    textureCache.forEach((texture) => texture.dispose());
    textureCache.clear();
  };

  const getOrCreateTexture = (source: string) => {
    let texture = textureCache.get(source);

    if (!texture) {
      texture = textureLoader.load(source);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      textureCache.set(source, texture);
    }

    return texture;
  };

  const getFaceTextureSource = (definition: BlockDefinition, face: BlockFace) => {
    const textures = definition.textures;
    if (!textures) return null;
    return textures[face] ?? textures.all ?? null;
  };

  const createFaceMaterial = (definition: BlockDefinition, face: BlockFace) => {
    const source = getFaceTextureSource(definition, face);

    const material = new THREE.MeshStandardMaterial({
      color: source ? 0xffffff : definition.color,
      metalness: 0.1,
      roughness: 0.8,
      transparent: Boolean(source),
      alphaTest: source ? 0.01 : 0,
    });

    if (source) {
      material.map = getOrCreateTexture(source);
    }

    return material;
  };

  const createBaseMaterial = (definition: BlockDefinition): CachedMaterial => {
    const hasTexturedFaces = BLOCK_FACES.some((face) =>
      getFaceTextureSource(definition, face)
    );

    if (!hasTexturedFaces) {
      return new THREE.MeshStandardMaterial({
        color: definition.color,
        metalness: 0.1,
        roughness: 0.8,
      });
    }

    return BLOCK_FACES.map((face) => createFaceMaterial(definition, face));
  };

  const getBaseMaterial = (typeId: BlockType) => {
    let material = materialCache.get(typeId);

    if (!material) {
      const definition = getBlockTypeDefinition(typeId);
      material = createBaseMaterial(definition);
      materialCache.set(typeId, material);
    }

    return material;
  };

  const createSurfaceMaterial = (definition: BlockDefinition, source?: string): THREE.MeshStandardMaterial => {
    const material = new THREE.MeshStandardMaterial({
      color: source ? 0xffffff : definition.color,
      metalness: 0.1,
      roughness: 0.8,
      transparent: Boolean(source),
      alphaTest: source ? 0.01 : 0,
    });

    if (source) {
      material.map = getOrCreateTexture(source);
    }

    return material;
  };

  const createBoxFaceMaterials = (
    definition: BlockDefinition,
    sources: Partial<Record<BlockFace, string | undefined>>
  ): CachedMaterial =>
    BLOCK_FACES.map((face) => createSurfaceMaterial(definition, sources[face]));

  const resolveConduitTextureProfile = (definition: BlockDefinition): ConduitTextureProfile => {
    const profile = definition.textureProfile ?? {};
    const textures = definition.textures;

    const coreSide =
      profile.coreSide ??
      textures?.all ??
      textures?.front ??
      textures?.right ??
      textures?.left;
    const coreTop =
      profile.coreTop ??
      textures?.top ??
      textures?.all ??
      coreSide;
    const coreBottom =
      profile.coreBottom ??
      textures?.bottom ??
      textures?.all ??
      coreSide;
    const armSide =
      profile.armSide ??
      profile.armSideHorizontal ??
      profile.armSideVertical ??
      coreSide;
    const armSideHorizontal =
      profile.armSideHorizontal ??
      armSide;
    const armSideVertical =
      profile.armSideVertical ??
      armSide;
    const armCapOpen =
      profile.armCapOpen ??
      textures?.front ??
      textures?.back ??
      coreSide;
    const armCapConnected =
      profile.armCapConnected ??
      armCapOpen;

    return {
      coreSide,
      coreTop,
      coreBottom,
      armSide,
      armSideHorizontal,
      armSideVertical,
      armCapOpen,
      armCapConnected,
    };
  };

  const createConduitCoreMaterial = (
    definition: BlockDefinition,
    profile: ConduitTextureProfile
  ): CachedMaterial =>
    createBoxFaceMaterials(definition, {
      right: profile.coreSide,
      left: profile.coreSide,
      top: profile.coreTop,
      bottom: profile.coreBottom,
      front: profile.coreSide,
      back: profile.coreSide,
    });

  const createConduitArmMaterial = (
    definition: BlockDefinition,
    profile: ConduitTextureProfile,
    axis: ConduitAxis,
    positiveDirection: boolean,
    connected: boolean
  ): CachedMaterial => {
    const sideSource =
      axis === "y"
        ? profile.armSideVertical ?? profile.armSide ?? profile.coreSide
        : profile.armSideHorizontal ?? profile.armSide ?? profile.coreSide;
    const innerCapSource = profile.armCapConnected ?? profile.armCapOpen ?? sideSource;
    const outerCapSource = connected
      ? profile.armCapConnected ?? innerCapSource
      : profile.armCapOpen ?? innerCapSource;

    const sources: Partial<Record<BlockFace, string | undefined>> = {
      right: sideSource,
      left: sideSource,
      top: sideSource,
      bottom: sideSource,
      front: sideSource,
      back: sideSource,
    };

    if (axis === "x") {
      sources.right = positiveDirection ? outerCapSource : innerCapSource;
      sources.left = positiveDirection ? innerCapSource : outerCapSource;
    } else if (axis === "y") {
      sources.top = positiveDirection ? outerCapSource : innerCapSource;
      sources.bottom = positiveDirection ? innerCapSource : outerCapSource;
    } else {
      sources.front = positiveDirection ? outerCapSource : innerCapSource;
      sources.back = positiveDirection ? innerCapSource : outerCapSource;
    }

    return createBoxFaceMaterials(definition, sources);
  };

  const getBlocksByPosition = () => {
    const currentBlocks = useBlocksStore.getState().blocks;

    if (currentBlocks !== blocksByPositionCacheRef) {
      // The store replaces the blocks array on edits, so reference checks are enough here.
      blocksByPositionCacheRef = currentBlocks;
      blocksByPositionCache = new Map(
        currentBlocks.map((block) => [toPositionKey(block.position), block])
      );
    }

    return blocksByPositionCache;
  };

  const hasCompatibleNeighborConnection = (
    instance: BlockInstance,
    definition: BlockDefinition,
    face: BlockFace
  ) => {
    const offset = FACE_OFFSETS[face];
    const positionMap = getBlocksByPosition();
    const neighbor = positionMap.get(
      toPositionKey({
        x: instance.position.x + offset.x,
        y: instance.position.y + offset.y,
        z: instance.position.z + offset.z,
      })
    );

    if (!neighbor || neighbor.id === instance.id) {
      return false;
    }

    const neighborDefinition = getBlockTypeDefinition(neighbor.type);
    return canConduitConnectToNeighbor(definition, neighborDefinition);
  };

  const resolveConnectionMask = (
    instance: BlockInstance,
    definition: BlockDefinition
  ): BlockConnectionMask => {
    const manualMask = normalizeConnectionMask(instance.connections?.mask);
    const mode = instance.connections?.mode === "manual" ? "manual" : "auto";

    if (mode === "manual" || !isConduitDefinition(definition)) {
      return manualMask;
    }

    const autoMask = createConnectionMask();

    // Auto mode derives conduit arms from compatible neighboring blocks.
    BLOCK_FACES.forEach((face) => {
      autoMask[face] = hasCompatibleNeighborConnection(instance, definition, face);
    });

    return autoMask;
  };

  const resolveBlockShape = (instance: BlockInstance) => {
    const definition = getBlockTypeDefinition(instance.type);
    const isConduit = isConduitDefinition(definition);
    const scale = resolveScale(
      definition,
      isConduit ? DEFAULT_CONDUIT_SCALE : DEFAULT_CUBE_SCALE
    );
    const mask = isConduit ? resolveConnectionMask(instance, definition) : undefined;

    const shapeKey = isConduit
      // Shape key tracks only geometry-affecting properties for cheap rebuild checks.
      ? `conduit:${scale.x.toFixed(4)}:${scale.y.toFixed(4)}:${scale.z.toFixed(4)}:${connectionMaskKey(
          mask!
        )}`
      : `cube:${scale.x.toFixed(4)}:${scale.y.toFixed(4)}:${scale.z.toFixed(4)}`;

    return {
      definition,
      scale,
      mask,
      shapeKey,
    };
  };

  const createPartMesh = (
    geometry: THREE.BoxGeometry,
    baseMaterial: CachedMaterial,
    blockId: string,
    typeId: BlockType,
    ownsBaseMaterial: boolean
  ) => {
    const mesh = new THREE.Mesh(geometry, baseMaterial);
    mesh.userData.blockId = blockId;
    mesh.userData.type = typeId;
    mesh.userData.baseMaterial = baseMaterial;
    mesh.userData.ownsBaseMaterial = ownsBaseMaterial;
    return mesh;
  };

  const disposeBlockParts = (entry: RenderedBlockEntry) => {
    entry.root.children.forEach((child) => {
      const mesh = child as THREE.Mesh;
      const baseMaterial = mesh.userData.baseMaterial as CachedMaterial | undefined;
      const ownsBaseMaterial = mesh.userData.ownsBaseMaterial === true;
      if (ownsBaseMaterial && baseMaterial) {
        disposeCachedMaterial(baseMaterial);
      }
      mesh.geometry?.dispose();
    });
    entry.root.clear();
  };

  const restoreEntryBaseMaterials = (entry: RenderedBlockEntry) => {
    entry.root.children.forEach((child) => {
      const mesh = child as THREE.Mesh;
      const baseMaterial = mesh.userData.baseMaterial as CachedMaterial | undefined;
      mesh.material = baseMaterial ?? getBaseMaterial(entry.typeId);
    });
  };

  const applyEntryVisualState = (blockId: string) => {
    const entry = renderedBlocks.get(blockId);
    if (!entry) return;

    restoreEntryBaseMaterials(entry);
  };

  const disposeBoxHelper = (helper: THREE.Box3Helper | null) => {
    if (!helper) return null;
    scene.remove(helper);
    helper.geometry.dispose();
    (helper.material as THREE.Material).dispose();
    return null;
  };

  const upsertBoxHelper = (
    helper: THREE.Box3Helper | null,
    box: THREE.Box3,
    color: THREE.Color,
    opacity: number
  ) => {
    if (!helper) {
      const created = new THREE.Box3Helper(box, color);
      const material = created.material as THREE.LineBasicMaterial;
      material.transparent = true;
      material.opacity = opacity;
      scene.add(created);
      return created;
    }

    helper.box.copy(box);
    helper.updateMatrixWorld(true);
    return helper;
  };

  const upsertBlockOutline = (
    helper: THREE.Box3Helper | null,
    blockId: string | null,
    color: THREE.Color,
    opacity: number
  ) => {
    if (!blockId) return disposeBoxHelper(helper);

    const entry = renderedBlocks.get(blockId);
    if (!entry) return disposeBoxHelper(helper);

    const box = new THREE.Box3().setFromObject(entry.root);
    return upsertBoxHelper(helper, box, color, opacity);
  };

  const syncBlockOutlines = () => {
    selectedBlockOutlineHelper = upsertBlockOutline(
      selectedBlockOutlineHelper,
      selectedBlockId,
      selectedBlockOutlineColor,
      0.95
    );

    const hoverTarget =
      hoveredBlockId && hoveredBlockId !== selectedBlockId ? hoveredBlockId : null;

    hoveredBlockOutlineHelper = upsertBlockOutline(
      hoveredBlockOutlineHelper,
      hoverTarget,
      hoveredBlockOutlineColor,
      0.85
    );
  };

  const setGroupSelectionBounds = (bounds: { min: Vec3; max: Vec3 } | null) => {
    if (!bounds) {
      groupSelectionHelper = disposeBoxHelper(groupSelectionHelper);
      return;
    }

    const box = new THREE.Box3(
      new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
      new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z)
    );

    groupSelectionHelper = upsertBoxHelper(
      groupSelectionHelper,
      box,
      groupOutlineColor,
      0.9
    );
  };

  const rebuildEntryGeometry = (
    entry: RenderedBlockEntry,
    instance: BlockInstance,
    force = false
  ) => {
    const shape = resolveBlockShape(instance);
    const typeChanged = entry.typeId !== instance.type;

    if (!force && !typeChanged && entry.shapeKey === shape.shapeKey) {
      // Skip rebuilding when the rendered shape is unchanged.
      return;
    }

    disposeBlockParts(entry);

    const parts: THREE.Mesh[] = [];

    if (shape.definition.renderMode === "conduit") {
      const profile = resolveConduitTextureProfile(shape.definition);
      const core = shape.scale;
      const mask = shape.mask ?? createConnectionMask();
      const connectedByNeighbor: BlockConnectionMask = {
        right: hasCompatibleNeighborConnection(instance, shape.definition, "right"),
        left: hasCompatibleNeighborConnection(instance, shape.definition, "left"),
        top: hasCompatibleNeighborConnection(instance, shape.definition, "top"),
        bottom: hasCompatibleNeighborConnection(instance, shape.definition, "bottom"),
        front: hasCompatibleNeighborConnection(instance, shape.definition, "front"),
        back: hasCompatibleNeighborConnection(instance, shape.definition, "back"),
      };
      const coreMaterial = createConduitCoreMaterial(shape.definition, profile);

      // Conduits are rendered as a core plus optional arms for each active direction.
      parts.push(
        createPartMesh(
          new THREE.BoxGeometry(core.x, core.y, core.z),
          coreMaterial,
          instance.id,
          instance.type,
          true
        )
      );

      const armLengthX = Math.max(0, (1 - core.x) / 2);
      const armLengthY = Math.max(0, (1 - core.y) / 2);
      const armLengthZ = Math.max(0, (1 - core.z) / 2);

      if (mask.right && armLengthX > 0) {
        const armMaterial = createConduitArmMaterial(
          shape.definition,
          profile,
          "x",
          true,
          connectedByNeighbor.right
        );
        const mesh = createPartMesh(
          new THREE.BoxGeometry(armLengthX, core.y, core.z),
          armMaterial,
          instance.id,
          instance.type,
          true
        );
        mesh.position.x = core.x / 2 + armLengthX / 2;
        parts.push(mesh);
      }

      if (mask.left && armLengthX > 0) {
        const armMaterial = createConduitArmMaterial(
          shape.definition,
          profile,
          "x",
          false,
          connectedByNeighbor.left
        );
        const mesh = createPartMesh(
          new THREE.BoxGeometry(armLengthX, core.y, core.z),
          armMaterial,
          instance.id,
          instance.type,
          true
        );
        mesh.position.x = -(core.x / 2 + armLengthX / 2);
        parts.push(mesh);
      }

      if (mask.top && armLengthY > 0) {
        const armMaterial = createConduitArmMaterial(
          shape.definition,
          profile,
          "y",
          true,
          connectedByNeighbor.top
        );
        const mesh = createPartMesh(
          new THREE.BoxGeometry(core.x, armLengthY, core.z),
          armMaterial,
          instance.id,
          instance.type,
          true
        );
        mesh.position.y = core.y / 2 + armLengthY / 2;
        parts.push(mesh);
      }

      if (mask.bottom && armLengthY > 0) {
        const armMaterial = createConduitArmMaterial(
          shape.definition,
          profile,
          "y",
          false,
          connectedByNeighbor.bottom
        );
        const mesh = createPartMesh(
          new THREE.BoxGeometry(core.x, armLengthY, core.z),
          armMaterial,
          instance.id,
          instance.type,
          true
        );
        mesh.position.y = -(core.y / 2 + armLengthY / 2);
        parts.push(mesh);
      }

      if (mask.front && armLengthZ > 0) {
        const armMaterial = createConduitArmMaterial(
          shape.definition,
          profile,
          "z",
          true,
          connectedByNeighbor.front
        );
        const mesh = createPartMesh(
          new THREE.BoxGeometry(core.x, core.y, armLengthZ),
          armMaterial,
          instance.id,
          instance.type,
          true
        );
        mesh.position.z = core.z / 2 + armLengthZ / 2;
        parts.push(mesh);
      }

      if (mask.back && armLengthZ > 0) {
        const armMaterial = createConduitArmMaterial(
          shape.definition,
          profile,
          "z",
          false,
          connectedByNeighbor.back
        );
        const mesh = createPartMesh(
          new THREE.BoxGeometry(core.x, core.y, armLengthZ),
          armMaterial,
          instance.id,
          instance.type,
          true
        );
        mesh.position.z = -(core.z / 2 + armLengthZ / 2);
        parts.push(mesh);
      }
    } else {
      const material = getBaseMaterial(instance.type);
      parts.push(
        createPartMesh(
          new THREE.BoxGeometry(shape.scale.x, shape.scale.y, shape.scale.z),
          material,
          instance.id,
          instance.type,
          false
        )
      );
    }

    parts.forEach((mesh) => entry.root.add(mesh));

    entry.typeId = instance.type;
    entry.shapeKey = shape.shapeKey;
    applyEntryVisualState(instance.id);
  };

  const refreshAllVisuals = () => {
    materialCache.forEach((material) => disposeCachedMaterial(material));
    materialCache.clear();
    disposeTextureCache();

    const blocks = useBlocksStore.getState().blocks;
    const byId = new Map(blocks.map((block) => [block.id, block]));

    renderedBlocks.forEach((entry, blockId) => {
      const instance = byId.get(blockId);
      if (!instance) return;
      rebuildEntryGeometry(entry, instance, true);
      applyEntryVisualState(blockId);
    });

    syncBlockOutlines();
  };

  const resolveBlockIdFromIntersection = (
    object: THREE.Object3D | undefined
  ): string | null => {
    let current: THREE.Object3D | null | undefined = object;

    while (current) {
      const blockId = current.userData?.blockId;
      if (typeof blockId === "string") {
        return blockId;
      }
      current = current.parent;
    }

    return null;
  };

  const createBlockRoot = (instance: BlockInstance) => {
    const root = new THREE.Group();
    root.userData.blockId = instance.id;
    root.userData.type = instance.type;

    root.position.set(
      instance.position.x,
      instance.position.y + 0.5,
      instance.position.z
    );

    root.rotation.set(
      THREE.MathUtils.degToRad(instance.rotation.x),
      THREE.MathUtils.degToRad(instance.rotation.y),
      THREE.MathUtils.degToRad(instance.rotation.z)
    );

    const entry: RenderedBlockEntry = {
      root,
      typeId: instance.type,
      shapeKey: "",
    };

    scene.add(root);
    renderedBlocks.set(instance.id, entry);
    rebuildEntryGeometry(entry, instance, true);
  };

  initialBlocks.forEach((instance) => createBlockRoot(instance));

  let frameId = 0;
  let lastWidth = 0;
  let lastHeight = 0;

  const animate = () => {
    frameId = requestAnimationFrame(animate);

    const width = mountEl.clientWidth;
    const height = mountEl.clientHeight;

    if (width !== lastWidth || height !== lastHeight) {
      lastWidth = width;
      lastHeight = height;

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }

    const currentRevision = useBlockTypesStore.getState().revision;
    if (currentRevision !== blockTypesRevision) {
      blockTypesRevision = currentRevision;
      refreshAllVisuals();
    }

    const store = useBlocksStore.getState();
    const selected =
      store.blocks.find((block): block is BlockInstance => block.id === store.selectedBlockId) ??
      null;
    const moveEnabled = store.mode === "edit" && store.transformMode === "move";
    const rotateEnabled = store.mode === "edit" && store.transformMode === "rotate";

    moveGizmo.update(selected, moveEnabled);
    rotateGizmo.update(selected, rotateEnabled);

    controls.update();
    renderer.render(scene, camera);
  };

  const handlePointerDown = (event: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(
      Array.from(renderedBlocks.values()).map((entry) => entry.root),
      true
    );

    if (intersects.length === 0) return;
    const blockId = resolveBlockIdFromIntersection(intersects[0].object);
    if (blockId) {
      // Selection is owned by React state; the scene just reports the hit block id.
      onSelectBlock?.(blockId);
    }
  };

  const updateHover = (event: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(
      Array.from(renderedBlocks.values()).map((entry) => entry.root),
      true
    );

    const previousHover = hoveredBlockId;
    const nextHoverCandidate = resolveBlockIdFromIntersection(intersects[0]?.object);
    hoveredBlockId =
      nextHoverCandidate && nextHoverCandidate !== selectedBlockId
        ? nextHoverCandidate
        : null;

    if (previousHover && previousHover !== hoveredBlockId) {
      applyEntryVisualState(previousHover);
    }

    if (hoveredBlockId) {
      applyEntryVisualState(hoveredBlockId);
    }

    syncBlockOutlines();
  };

  animate();
  renderer.domElement.addEventListener("pointerdown", handlePointerDown);
  renderer.domElement.addEventListener("pointermove", updateHover);

  return {
    cleanup: () => {
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", updateHover);
      cancelAnimationFrame(frameId);
      mountEl.removeChild(renderer.domElement);

      renderer.dispose();
      materialCache.forEach((material) => disposeCachedMaterial(material));
      materialCache.clear();
      disposeTextureCache();
      selectedBlockOutlineHelper = disposeBoxHelper(selectedBlockOutlineHelper);
      hoveredBlockOutlineHelper = disposeBoxHelper(hoveredBlockOutlineHelper);
      setGroupSelectionBounds(null);
      moveGizmo.dispose();
      rotateGizmo.dispose();

      renderedBlocks.forEach((entry) => {
        disposeBlockParts(entry);
      });
      renderedBlocks.clear();
    },

    addBlock: (instance) => {
      const existing = renderedBlocks.get(instance.id);
      if (existing) {
        scene.remove(existing.root);
        disposeBlockParts(existing);
        renderedBlocks.delete(instance.id);
      }

      createBlockRoot(instance);
      syncBlockOutlines();
    },

    removeBlock: (id) => {
      const entry = renderedBlocks.get(id);
      if (!entry) return;

      scene.remove(entry.root);
      disposeBlockParts(entry);
      renderedBlocks.delete(id);
      syncBlockOutlines();
    },

    setSelectedBlock: (id) => {
      const previousSelected = selectedBlockId;
      selectedBlockId = id;

      // Hover outline is suppressed while the same block is selected.
      if (id && id === hoveredBlockId) {
        hoveredBlockId = null;
      }

      if (previousSelected) {
        applyEntryVisualState(previousSelected);
      }

      if (selectedBlockId) {
        applyEntryVisualState(selectedBlockId);
      }

      syncBlockOutlines();
    },

    setSelectedGroupBounds: (bounds) => {
      setGroupSelectionBounds(bounds);
    },

    updateBlock: (instance) => {
      const entry = renderedBlocks.get(instance.id);
      if (!entry) return;

      entry.root.position.set(
        instance.position.x,
        instance.position.y + 0.5,
        instance.position.z
      );

      const store = useBlocksStore.getState();
      if (store.gizmo.axis === null) {
        entry.root.rotation.set(
          THREE.MathUtils.degToRad(instance.rotation.x),
          THREE.MathUtils.degToRad(instance.rotation.y),
          THREE.MathUtils.degToRad(instance.rotation.z)
        );
      }

      rebuildEntryGeometry(entry, instance);
      applyEntryVisualState(instance.id);

      if (instance.id === selectedBlockId || instance.id === hoveredBlockId) {
        syncBlockOutlines();
      }
    },
  };
}
