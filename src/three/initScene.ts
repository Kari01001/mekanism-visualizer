import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { BLOCK_DEFINITIONS } from "../models/blocks";
import type { BlockInstance } from "../models/blocks";

export interface SceneAPI {
  cleanup: () => void;
  addBlock: (block: BlockInstance) => void;
  removeBlock: (id: string) => void;
}

export default function initScene(
  mountEl: HTMLDivElement,
  initialBlocks: BlockInstance[]
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

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, 0, 0);

  // světla
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 7);
  scene.add(dir);

  // grid
  const grid = new THREE.GridHelper(16, 16, 0x444444, 0x222222);
  grid.position.y = -0.5;
  scene.add(grid);

  // společná geometrie pro všechny bloky (kostka 1×1×1)
  const blockGeometry = new THREE.BoxGeometry(1, 1, 1);

  // mapování id -> mesh
  const blockMeshes = new Map<string, THREE.Mesh>();

  const createBlockMesh = (instance: BlockInstance) => {
    const def = BLOCK_DEFINITIONS[instance.type];

    const material = new THREE.MeshStandardMaterial({
      color: def.color,
      metalness: 0.1,
      roughness: 0.8,
    });

    const mesh = new THREE.Mesh(blockGeometry, material);

    mesh.position.set(
      instance.position.x,
      instance.position.y + 0.5, // ať sedí na gridu
      instance.position.z
    );

    mesh.rotation.y = (instance.rotationY * Math.PI) / 180;

    scene.add(mesh);
    blockMeshes.set(instance.id, mesh);
  };

  // vytvořit počáteční bloky
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
    controls.update();
    renderer.render(scene, camera);
  };

  animate();

  // === API, které vracíme Reactu ===
  const api: SceneAPI = {
    cleanup: () => {
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
      // kdyby náhodou blok se stejným id už existoval, nejdřív ho smažeme
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
  };

  return api;
}