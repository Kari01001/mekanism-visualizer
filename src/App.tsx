import { useEffect, useRef} from "react";
import initScene, { type SceneAPI } from "./three/initScene";
import type { BlockInstance} from "./models/blocks"; //import type { BlockInstance, BlockType } from "./models/blocks";
import { useBlocksStore } from "./state/useBlocksStore";
import BlockList from "./components/BlockList";
import Inspector from "./components/Inspector";

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
  const sceneRef = useRef<SceneAPI | null>(null);
  const renderedIdsRef = useRef<Set<string>>(new Set());

  const mode = useBlocksStore((s) => s.mode);
  const setMode = useBlocksStore((s) => s.setMode);

  const blocks = useBlocksStore((s) => s.blocks);
  const addBlockToStore = useBlocksStore((s) => s.addBlock);
  const clearBlocks = useBlocksStore((s) => s.clearBlocks);
  const selectedBlockId = useBlocksStore((s) => s.selectedBlockId);
  const selectBlock = useBlocksStore((s) => s.selectBlock);


  useEffect(() => {
    clearBlocks();
    initialBlocks.forEach((b) =>
      addBlockToStore(b.type, b.position, b.rotationY)
    );
  }, [addBlockToStore, clearBlocks]);
  useEffect(() => {
    if (!mountRef.current) return;

    const api = initScene(
      mountRef.current,
      [],
      (id) => selectBlock(id)
    );
    sceneRef.current = api;
    return () => {
      api.cleanup();
      sceneRef.current = null;
      renderedIdsRef.current.clear();
    };
  }, []);
  useEffect(() => {
    if (!sceneRef.current) return;
    const renderedIds = renderedIdsRef.current;
    const api = sceneRef.current;
    const currentIds = new Set(blocks.map((b) => b.id));
    renderedIds.forEach((id) => {
      if (!currentIds.has(id)) {
        api.removeBlock(id);
        renderedIds.delete(id);
      }
    });
    blocks.forEach((b) => {
      if (!renderedIds.has(b.id)) {
        api.addBlock(b);
        renderedIds.add(b.id);
      } else {
        api.updateBlock(b); // ⬅️ TADY JE FIX
      }
    });

  }, [blocks]);

  useEffect(() => {
    if (!sceneRef.current) return;
    sceneRef.current.setSelectedBlock(selectedBlockId);
  }, [selectedBlockId]);

  const toggleMode = () => {
  setMode(mode === "edit" ? "view" : "edit");
  };

  return (
    <div className="app-root">
      <div className="sidebar">
        <div className="sidebar-content">
          <h2>Mekanism Visualizer</h2>
          <p>React + TypeScript + Three.js + Zustand</p>
          <hr style={{ borderColor: "#333", margin: "12px 0" }} />
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
          <h3>New block</h3>
          <hr style={{ borderColor: "#333", margin: "12px 0" }} />
          <BlockList mode={mode} />
        </div>
      </div>
      <div className="canvas-container" ref={mountRef} />
      <Inspector/>
    </div>
  );
};

export default App;
