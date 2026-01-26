import { useBlocksStore } from "../state/useBlocksStore";

const Inspector = () => {
  const selectedBlockId = useBlocksStore((s) => s.selectedBlockId);
  const blocks = useBlocksStore((s) => s.blocks);
  
  const mode = useBlocksStore((s) => s.mode);

  const transformMode = useBlocksStore((s) => s.transformMode);
  const setTransformMode = useBlocksStore((s) => s.setTransformMode);

  const moveBlock = useBlocksStore((s) => s.moveBlock);
  const rotateBlock = useBlocksStore((s) => s.rotateBlock);

  const block = blocks.find((b) => b.id === selectedBlockId);

  if (!block) {
    return (
      <div className="inspector">
        <div className="inspector-content">
          <h3>No selection</h3>
          <p>Vyber blok v seznamu nebo ve scéně</p>
        </div>
      </div>
    );
  }

  return (
    <div className="inspector">
      <div className="inspector-content">
        <h3>Inspector</h3>

        <p>
          <strong>Type:</strong> {block.type}
        </p>

        <p>
          <strong>Position</strong>
          <br />
          X: {block.position.x}
          <br />
          Y: {block.position.y}
          <br />
          Z: {block.position.z}
        </p>

        <p>
          <strong>Rotation Y</strong>
          <br />
          {block.rotationY}°
        </p>

        {mode === "edit" && (
          <>
            <h4>Transform</h4>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button
                onClick={() => setTransformMode("none")}
                style={{
                  background: transformMode === "none" ? "#333" : undefined,
                }}
              >
                None
              </button>

              <button
                onClick={() => setTransformMode("move")}
                style={{
                  background: transformMode === "move" ? "#333" : undefined,
                }}
              >
                Move
              </button>

              <button
                onClick={() => setTransformMode("rotate")}
                style={{
                  background: transformMode === "rotate" ? "#333" : undefined,
                }}
              >
                Rotate
              </button>
            </div>

            {transformMode === "move" && (
              <>
                <h4>Move</h4>

                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <button onClick={() => moveBlock(block.id, { x: -1 })}>
                    X −
                  </button>
                  <button onClick={() => moveBlock(block.id, { x: +1 })}>
                    X +
                  </button>
                </div>

                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <button onClick={() => moveBlock(block.id, { z: -1 })}>
                    Z −
                  </button>
                  <button onClick={() => moveBlock(block.id, { z: +1 })}>
                    Z +
                  </button>
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => moveBlock(block.id, { y: -1 })}>
                    Y −
                  </button>
                  <button onClick={() => moveBlock(block.id, { y: +1 })}>
                    Y +
                  </button>
                </div>
              </>
            )}

            {transformMode === "rotate" && (
              <>
                <h4>Rotate</h4>

                <button onClick={() => rotateBlock(block.id, 90)}>
                  Rotate +90°
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Inspector;
