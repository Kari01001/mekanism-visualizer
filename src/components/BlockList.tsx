import { useBlocksStore } from "../state/useBlocksStore";

interface Props {
  mode: "edit" | "view";
}

const BlockList = ({ mode }: Props) => {
  const blocks = useBlocksStore((s) => s.blocks);
  const selectedBlockId = useBlocksStore((s) => s.selectedBlockId);
  const selectBlock = useBlocksStore((s) => s.selectBlock);
  const removeBlock = useBlocksStore((s) => s.removeBlock);

  if (blocks.length === 0) {
    return <p style={{ opacity: 0.6 }}>No blocks in scene</p>;
  }

  return (
    <div>
      <h3>Blocks</h3>

      {blocks.map((block) => {
        const isSelected = block.id === selectedBlockId;

        return (
          <div
            key={block.id}
            style={{
              padding: "6px",
              marginBottom: "6px",
              borderRadius: 4,
              background: isSelected ? "#2c3e50" : "#222",
              border: isSelected ? "1px solid #3498db" : "1px solid #333",
              cursor: "pointer",
            }}
            onClick={() => selectBlock(block.id)}
          >
            <div style={{ fontWeight: 600 }}>{block.type}</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              ({block.position.x}, {block.position.y}, {block.position.z})
            </div>

            {mode === "edit" && (
              <button
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  cursor: "pointer",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  removeBlock(block.id);
                }}
              >
                Delete
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default BlockList;
