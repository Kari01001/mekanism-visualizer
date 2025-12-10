// src/App.tsx
import { useEffect, useRef, useState } from "react";
import initScene, { type SceneAPI } from "./three/initScene";
import type { BlockInstance, BlockType } from "./models/blocks";
import { useBlocksStore } from "./state/useBlocksStore";

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

type UIMode = "view" | "edit";

const App = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneAPI | null>(null);
  const renderedIdsRef = useRef<Set<string>>(new Set());

  const [mode, setMode] = useState<UIMode>("edit");

  const blocks = useBlocksStore((s) => s.blocks);
  const addBlockToStore = useBlocksStore((s) => s.addBlock);
  const clearBlocks = useBlocksStore((s) => s.clearBlocks);

  // UI state pro formulář
  const [selectedType, setSelectedType] = useState<BlockType>("basic_block");
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  const [posZ, setPosZ] = useState(0);

  // 1) naplníme store počátečními bloky
  useEffect(() => {
    clearBlocks();
    initialBlocks.forEach((b) =>
      addBlockToStore(b.type, b.position, b.rotationY)
    );
  }, [addBlockToStore, clearBlocks]);

  // 2) jednou vytvoříme scénu (prázdnou)
  useEffect(() => {
    if (!mountRef.current) return;

    const api = initScene(mountRef.current, []);
    sceneRef.current = api;

    return () => {
      api.cleanup();
      sceneRef.current = null;
      renderedIdsRef.current.clear();
    };
  }, []);

  // 3) synchronizace store -> Three.js scéna
  useEffect(() => {
    if (!sceneRef.current) return;

    const renderedIds = renderedIdsRef.current;
    const api = sceneRef.current;

    const currentIds = new Set(blocks.map((b) => b.id));

    // odstranit bloky, které už nejsou ve store
    renderedIds.forEach((id) => {
      if (!currentIds.has(id)) {
        api.removeBlock(id);
        renderedIds.delete(id);
      }
    });

    // přidat bloky, které ještě nejsou ve scéně
    blocks.forEach((b) => {
      if (!renderedIds.has(b.id)) {
        api.addBlock(b);
        renderedIds.add(b.id);
      }
    });
  }, [blocks]);

  // handler pro tlačítko "Add block"
  const handleAddBlock = () => {
    if (mode !== "edit") return; // v read módu neumožníme editaci

    addBlockToStore(selectedType, { x: posX, y: posY, z: posZ }, 0);
  };

  const toggleMode = () => {
    setMode((prev) => (prev === "edit" ? "view" : "edit"));
  };

  return (
    <div className="app-root">
      <div className="sidebar">
        <h2>Mekanism Visualizer</h2>
        <p>React + TypeScript + Three.js + Zustand</p>

        <hr style={{ borderColor: "#333", margin: "12px 0" }} />

        {/* REŽIM VIEW / EDIT */}
        <div style={{ marginBottom: 12 }}>
          <strong>Mode:</strong>{" "}
          <span
            style={{
              color: mode === "edit" ? "#2ecc71" : "#3498db",
              fontWeight: 600,
            }}
          >
            {mode === "edit" ? "EDIT" : "VIEW"}
          </span>
          <br />
          <button
            onClick={toggleMode}
            style={{ marginTop: 6, padding: "4px 10px", cursor: "pointer" }}
          >
            Přepnout na {mode === "edit" ? "VIEW" : "EDIT"}
          </button>
        </div>

        <hr style={{ borderColor: "#333", margin: "12px 0" }} />

        {/* FORMULÁŘ PRO PŘIDÁNÍ BLOKU */}
        <h3>New block</h3>

        <div style={{ marginBottom: 8 }}>
          <label>
            Type:&nbsp;
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as BlockType)}
              disabled={mode !== "edit"}
            >
              <option value="basic_block">Basic Block (green)</option>
              <option value="generator_basic">Generator (yellow)</option>
              <option value="cable_basic">Cable (blue)</option>
            </select>
          </label>
        </div>

        <div style={{ marginBottom: 4 }}>
          <label>
            X:&nbsp;
            <input
              type="number"
              value={posX}
              onChange={(e) => setPosX(Number(e.target.value))}
              style={{ width: 60 }}
              disabled={mode !== "edit"}
            />
          </label>
        </div>
        <div style={{ marginBottom: 4 }}>
          <label>
            Y:&nbsp;
            <input
              type="number"
              value={posY}
              onChange={(e) => setPosY(Number(e.target.value))}
              style={{ width: 60 }}
              disabled={mode !== "edit"}
            />
          </label>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label>
            Z:&nbsp;
            <input
              type="number"
              value={posZ}
              onChange={(e) => setPosZ(Number(e.target.value))}
              style={{ width: 60 }}
              disabled={mode !== "edit"}
            />
          </label>
        </div>

        <button
          onClick={handleAddBlock}
          disabled={mode !== "edit"}
          style={{
            padding: "6px 12px",
            cursor: mode === "edit" ? "pointer" : "not-allowed",
            opacity: mode === "edit" ? 1 : 0.6,
          }}
        >
          Add block
        </button>
      </div>

      <div className="canvas-container" ref={mountRef} />
    </div>
  );
};

export default App;
