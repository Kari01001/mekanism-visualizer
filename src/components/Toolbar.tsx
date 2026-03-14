import { useBlocksStore } from "../state/useBlocksStore";

const Toolbar = () => {
  const transformMode = useBlocksStore(s => s.transformMode);
  const setTransformMode = useBlocksStore(s => s.setTransformMode);
  const mode = useBlocksStore(s => s.mode);

  // View mode intentionally hides transform controls.
  if (mode !== "edit") return null;

  return (
    <div className="toolbar">
      <button
        className={transformMode === "none" ? "active" : ""}
        onClick={() => setTransformMode("none")}
      >
        Cursor
      </button>

      <button
        className={transformMode === "move" ? "active" : ""}
        onClick={() => setTransformMode("move")}
      >
        Move
      </button>

      <button
        className={transformMode === "rotate" ? "active" : ""}
        onClick={() => setTransformMode("rotate")}
      >
        Rotate
      </button>
    </div>
  );
};

export default Toolbar;
