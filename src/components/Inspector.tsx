import { useBlocksStore } from "../state/useBlocksStore";

const Inspector = () => {
  const round = (v: number) => Math.round(v);
  const selectedBlockId = useBlocksStore((s) => s.selectedBlockId);
  const blocks = useBlocksStore((s) => s.blocks);
  
  const mode = useBlocksStore((s) => s.mode);

  const transformMode = useBlocksStore((s) => s.transformMode);

  const gizmo = useBlocksStore((s) => s.gizmo);
  const setGizmoAxis = useBlocksStore((s) => s.setGizmoAxis);

  const setTransformMode = useBlocksStore((s) => s.setTransformMode);

  const moveBlock = useBlocksStore((s) => s.moveBlock);

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
          <strong>Rotation</strong>
          <br />
          X: {round(block.rotation.x)}°
          <br />
          Y: {round(block.rotation.y)}°
          <br />
          Z: {round(block.rotation.z)}°
        </p>
        
        <h4>Gizmo debug</h4>
        <p>
          <strong>Mode:</strong> {gizmo.mode}
          <br />
          <strong>Axis:</strong>{" "}
          <span
            style={{
              color:
                gizmo.axis === "x"
                  ? "red"
                  : gizmo.axis === "y"
                  ? "lime"
                  : gizmo.axis === "z"
                  ? "dodgerblue"
                  : "#888",
              fontWeight: 600,
            }}
          >
            {gizmo.axis ?? "—"}
          </span>
        </p>

        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <button onClick={() => setGizmoAxis("x")}>X</button>
          <button onClick={() => setGizmoAxis("y")}>Y</button>
          <button onClick={() => setGizmoAxis("z")}>Z</button>
          <button onClick={() => setGizmoAxis(null)}>Clear</button>
        </div>

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
                    X -
                  </button>
                  <button onClick={() => moveBlock(block.id, { x: +1 })}>
                    X +
                  </button>
                </div>

                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <button onClick={() => moveBlock(block.id, { z: -1 })}>
                    Z -
                  </button>
                  <button onClick={() => moveBlock(block.id, { z: +1 })}>
                    Z +
                  </button>
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => moveBlock(block.id, { y: -1 })}>
                    Y -
                  </button>
                  <button onClick={() => moveBlock(block.id, { y: +1 })}>
                    Y +
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Inspector;
