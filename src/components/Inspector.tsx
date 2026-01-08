import { useBlocksStore } from "../state/useBlocksStore";

const Inspector = () => {
    const selectedBlockId = useBlocksStore((s) => s.selectedBlockId);
    const blocks = useBlocksStore((s) => s.blocks);
    const moveBlock = useBlocksStore((s) => s.moveBlock);
    const mode = useBlocksStore((s) => s.mode);

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

            {mode === "edit" && (
                <>
                <h4>Move</h4>

                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <button onClick={() => moveBlock(block.id, { x: -1 })}>X −</button>
                    <button onClick={() => moveBlock(block.id, { x: +1 })}>X +</button>
                </div>

                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <button onClick={() => moveBlock(block.id, { z: -1 })}>Z −</button>
                    <button onClick={() => moveBlock(block.id, { z: +1 })}>Z +</button>
                </div>

                <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => moveBlock(block.id, { y: -1 })}>Y −</button>
                    <button onClick={() => moveBlock(block.id, { y: +1 })}>Y +</button>
                </div>
                </>
            )}
            </div>
        </div>
    );
};

export default Inspector;