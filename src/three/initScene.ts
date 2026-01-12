import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { BLOCK_DEFINITIONS } from "../models/blocks";
import type { BlockInstance, BlockType } from "../models/blocks";
import { MoveGizmo } from "./gizmos/MoveGizmo";
import { useBlocksStore } from "../state/useBlocksStore";

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
  renderer.setSize(mountEl.clientWidth, mountEl.clientHeight);
  mountEl.appendChild(renderer.domElement);

  const moveGizmo = new MoveGizmo(camera, renderer.domElement, 
    (locked) => {
      controls.enabled = !locked;
    }
  );
  scene.add(moveGizmo.group);

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

  const createBlockMesh = (instance: BlockInstance) => {
    const def = BLOCK_DEFINITIONS[instance.type];

    let material = materialCache.get(instance.type);
    
    if (!material) {
      material = new THREE.MeshStandardMaterial({
      color: def.color,
      metalness: 0.1,
      roughness: 0.8,
      });

      materialCache.set(instance.type, material);
    }


    const mesh = new THREE.Mesh(blockGeometry, material);

    mesh.position.set(
      instance.position.x,
      instance.position.y + 0.5,
      instance.position.z
    );
    mesh.userData.blockId = instance.id;
    mesh.userData.type = instance.type;

    mesh.rotation.y = (instance.rotationY * Math.PI) / 180;

    scene.add(mesh);
    blockMeshes.set(instance.id, mesh);
  };

  initialBlocks.forEach(createBlockMesh);

  const handleResize = () => {
    const { clientWidth, clientHeight } = mountEl;
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight);
  };

  window.addEventListener("resize", handleResize);

  let frameId: number;

  const animate = () => {
    frameId = requestAnimationFrame(animate);

    const store = useBlocksStore.getState();
    const selected = store.blocks.find((b): b is BlockInstance => b.id === store.selectedBlockId) ?? null;

    moveGizmo.update(selected, store.transformMode === "move");

    controls.update();
    renderer.render(scene, camera);
  };
  let hoveredBlockId: string | null = null;

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
        prev.material = materialCache.get(type)!;
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
      renderer.domElement.addEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", updateHover);

      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      mountEl.removeChild(renderer.domElement);

      renderer.dispose();
      blockGeometry.dispose();

      blockMeshes.forEach((mesh) => {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
      });
      blockMeshes.clear();
      
    },

    addBlock: (instance: BlockInstance) => {
      const existing = blockMeshes.get(instance.id);
      if (existing) {
        scene.remove(existing);
        if (Array.isArray(existing.material)) {
          existing.material.forEach((m) => m.dispose());
        } else {
          existing.material.dispose();
        }
        blockMeshes.delete(instance.id);
      }

      createBlockMesh(instance);
    },

    removeBlock: (id: string) => {
      const mesh = blockMeshes.get(id);
      if (!mesh) return;

      scene.remove(mesh);
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else {
        mesh.material.dispose();
      }
      blockMeshes.delete(id);
    },
    setSelectedBlock: (id: string | null) => {
      if (selectedBlockId) {
        const prevMesh = blockMeshes.get(selectedBlockId);
        if (prevMesh) {
          const prevType = (prevMesh.userData.type as BlockType) || null;
          if (prevType) {
          prevMesh.material = materialCache.get(prevType)!;
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

      mesh.rotation.y = (instance.rotationY * Math.PI) / 180;
    }
  };

  return api;
}