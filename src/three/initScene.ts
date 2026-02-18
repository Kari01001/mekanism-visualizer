import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BlockInstance, BlockType } from "../models/blocks";
import { MoveGizmo } from "./gizmos/MoveGizmo";
import { getBlockTypeDefinition, useBlockTypesStore } from "../state/useBlockTypesStore";
import { useBlocksStore } from "../state/useBlocksStore";
import { RotateGizmo } from "./gizmos/RotateGizmo";

export interface SceneAPI {
  cleanup: () => void;
  addBlock: (block: BlockInstance) => void;
  removeBlock: (id: string) => void;
  setSelectedBlock: (id: string | null) => void;
  updateBlock: (block: BlockInstance) => void;
}

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

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(mountEl.clientWidth, mountEl.clientHeight, false);

  mountEl.appendChild(renderer.domElement);

  const moveGizmo = new MoveGizmo(camera, renderer.domElement, 
    (locked) => {
      controls.enabled = !locked;
    }
  );
  scene.add(moveGizmo.group);

  const rotateGizmo = new RotateGizmo(
    camera,
    renderer.domElement,
    (locked) => {
      controls.enabled = !locked;
    }
  );
  scene.add(rotateGizmo.group);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 7);
  scene.add(dir);

  const grid = new THREE.GridHelper(16, 16, 0x444444, 0x222222);
  grid.position.y = -0.5;
  scene.add(grid);
  const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
  const materialCache = new Map<BlockType, THREE.MeshStandardMaterial>();
  let blockTypesRevision = useBlockTypesStore.getState().revision;

  const highlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x4444ff,
    emissiveIntensity: 0.6,
  });
  const hoverMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x00ffff,
    emissiveIntensity: 0.35,
  });

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  const blockMeshes = new Map<string, THREE.Mesh>();
  let selectedBlockId: string | null = null;
  let hoveredBlockId: string | null = null;

  const getBaseMaterial = (typeId: BlockType) => {
    let material = materialCache.get(typeId);

    if (!material) {
      const definition = getBlockTypeDefinition(typeId);
      material = new THREE.MeshStandardMaterial({
        color: definition.color,
        metalness: 0.1,
        roughness: 0.8,
      });

      materialCache.set(typeId, material);
    }

    return material;
  };

  const applyBaseMaterial = (mesh: THREE.Mesh, typeId: BlockType) => {
    mesh.material = getBaseMaterial(typeId);
  };

  const disposeMarkerChildren = (mesh: THREE.Mesh) => {
    mesh.children.forEach((child) => {
      const childMesh = child as THREE.Mesh;
      childMesh.geometry?.dispose();

      if (Array.isArray(childMesh.material)) {
        childMesh.material.forEach((material) => material.dispose());
      } else {
        childMesh.material?.dispose();
      }
    });
  };

  const refreshAllBaseMaterials = () => {
    materialCache.forEach((material) => material.dispose());
    materialCache.clear();

    blockMeshes.forEach((mesh, id) => {
      const type = mesh.userData.type as BlockType | undefined;
      if (!type) return;

      if (id === selectedBlockId) {
        mesh.material = highlightMaterial;
        return;
      }

      if (id === hoveredBlockId) {
        mesh.material = hoverMaterial;
        return;
      }

      applyBaseMaterial(mesh, type);
    });
  };

  const createBlockMesh = (instance: BlockInstance) => {
    const material = getBaseMaterial(instance.type);
    const mesh = new THREE.Mesh(blockGeometry, material);
    const markerGeometry = new THREE.BoxGeometry(0.2, 0.05, 0.6);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff });
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);

    marker.position.set(0, 0.55, 0.35);

    mesh.add(marker);

    mesh.position.set(
      instance.position.x,
      instance.position.y + 0.5,
      instance.position.z
    );
    mesh.userData.blockId = instance.id;
    mesh.userData.type = instance.type;

    mesh.rotation.set(
      (instance.rotation.x * Math.PI) / 180,
      (instance.rotation.y * Math.PI) / 180,
      (instance.rotation.z * Math.PI) / 180
    );

    scene.add(mesh);
    blockMeshes.set(instance.id, mesh);
  };

  initialBlocks.forEach(createBlockMesh);

  let frameId: number;
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
      refreshAllBaseMaterials();
    }

    const store = useBlocksStore.getState();
    const selected = store.blocks.find((b): b is BlockInstance => b.id === store.selectedBlockId) ?? null;

    const gizmoEnabled =
      store.mode === "edit" && store.transformMode === "move";

    moveGizmo.update(selected, gizmoEnabled);
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
      Array.from(blockMeshes.values()),
      false
    );

    if (intersects.length === 0) return;

    const mesh = intersects[0].object as THREE.Mesh;
    const blockId = mesh.userData.blockId as string | undefined;

    if (blockId) {
      onSelectBlock?.(blockId);
    }
  };
  const updateHover = (event: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();

    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(
      Array.from(blockMeshes.values()),
      false
    );

    const hit = intersects[0]?.object as THREE.Mesh | undefined;
    const blockId = hit?.userData.blockId as string | undefined;

    if (hoveredBlockId && hoveredBlockId !== selectedBlockId) {
      const prev = blockMeshes.get(hoveredBlockId);
      if (prev && hoveredBlockId !== selectedBlockId) {
        const type = prev.userData.type as BlockType;
        applyBaseMaterial(prev, type);
      }
    }

    hoveredBlockId = null;

    if (blockId && blockId !== selectedBlockId) {
      hoveredBlockId = blockId;
      hit!.material = hoverMaterial;
    }
  };

  animate();
  renderer.domElement.addEventListener("pointerdown", handlePointerDown);
  renderer.domElement.addEventListener("pointermove", updateHover);


  const api: SceneAPI = {
    cleanup: () => {
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", updateHover);

      cancelAnimationFrame(frameId);
      mountEl.removeChild(renderer.domElement);

      renderer.dispose();
      blockGeometry.dispose();
      materialCache.forEach((material) => material.dispose());
      materialCache.clear();
      highlightMaterial.dispose();
      hoverMaterial.dispose();
      moveGizmo.dispose();
      rotateGizmo.dispose();

      blockMeshes.forEach((mesh) => {
        disposeMarkerChildren(mesh);
      });
      blockMeshes.clear();
      
    },

    addBlock: (instance: BlockInstance) => {
      const existing = blockMeshes.get(instance.id);
      if (existing) {
        scene.remove(existing);
        disposeMarkerChildren(existing);
        blockMeshes.delete(instance.id);
      }

      createBlockMesh(instance);
    },

    removeBlock: (id: string) => {
      const mesh = blockMeshes.get(id);
      if (!mesh) return;

      scene.remove(mesh);
      disposeMarkerChildren(mesh);
      blockMeshes.delete(id);
    },
    setSelectedBlock: (id: string | null) => {
      if (selectedBlockId) {
        const prevMesh = blockMeshes.get(selectedBlockId);
        if (prevMesh) {
          const prevType = (prevMesh.userData.type as BlockType) || null;
          if (prevType) {
            applyBaseMaterial(prevMesh, prevType);
          }
        }
      }

      selectedBlockId = id;

      if (id) {
        const mesh = blockMeshes.get(id);
        if (mesh) {
          mesh.material = highlightMaterial;
        }
      }
    },
    updateBlock: (instance: BlockInstance) => {
      const mesh = blockMeshes.get(instance.id);
      if (!mesh) return;

      mesh.position.set(
        instance.position.x,
        instance.position.y + 0.5,
        instance.position.z
      );

      const store = useBlocksStore.getState();

      if (store.gizmo.axis === null) {
        mesh.rotation.set(
          THREE.MathUtils.degToRad(instance.rotation.x),
          THREE.MathUtils.degToRad(instance.rotation.y),
          THREE.MathUtils.degToRad(instance.rotation.z)
        );
      }
    },
  };

  return api;
}
