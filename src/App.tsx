import { useEffect, useRef } from "react";
import initScene from "./three/initScene";
import type { BlockInstance } from "./models/blocks";

const initialBlocks: BlockInstance[] = [
  {
    id: "block-1",
    type: "basic_block",
    position: { x: 0, y: 0, z: 0 },
    rotationY: 0,
  },
  {
    id: "block-2",
    type: "generator_basic",
    position: { x: 2, y: 0, z: 0 },
    rotationY: 90,
  },
  {
    id: "block-3",
    type: "cable_basic",
    position: { x: 1, y: 0, z: 0 },
    rotationY: 0,
  },
];

const App = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const cleanup = initScene(mountRef.current, initialBlocks);
    return () => cleanup();
  }, []);

  return (
    <div className="app-root">
      <div className="sidebar">
        <h2>Mekanism Visualizer</h2>
        <p>React + TypeScript + Three.js</p>
        <p>Bloky se teď renderují z dat (initialBlocks). Postupně vše upravím</p>
      </div>

      <div className="canvas-container" ref={mountRef} />
    </div>
  );
};

export default App;
