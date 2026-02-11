import { useState } from "react";
import { useBlocksStore } from "../../state/useBlocksStore";
import type { SceneTreeNode as SceneTreeNodeType } from "../../models/sceneTree";

interface Props {
  node: SceneTreeNodeType;
  depth: number;
  isRoot?: boolean;
}

const INDENT = 16;

const SceneTreeNode = ({ node, depth, isRoot }: Props) => {
  const selectBlock = useBlocksStore((s) => s.selectBlock);
  const selectedBlockId = useBlocksStore((s) => s.selectedBlockId);

  const [expanded, setExpanded] = useState(true);

  const paddingLeft = isRoot ? 4 : depth * INDENT + 8;

  if (node.type === "group") {
    return (
      <>
        <div
          className="tree-row"
          style={{
            paddingLeft,
            ["--depth" as any]: depth
          }}
          onClick={() => setExpanded((e) => !e)}
        >
          <span className="tree-caret">
            {expanded ? "▾" : "▸"}
          </span>
          <span className="tree-icon">📁</span>
          <span className="tree-label-text">{node.name}</span>
        </div>

        {expanded &&
          node.children.map((child) => (
            <SceneTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
            />
          ))}
      </>
    );
  }

  // BLOCK
  return (
    <div
      className={`tree-row ${
        selectedBlockId === node.blockId ? "selected" : ""
      }`}
      style={{
        paddingLeft,
        ["--depth" as any]: depth
      }}
      onClick={(e) => {
        e.stopPropagation();
        selectBlock(node.blockId);
      }}
    >
      <span className="tree-caret-placeholder" />
      <span className="tree-icon">🧊</span>
      <span className="tree-label-text">{node.blockId}</span>
    </div>
  );
};

export default SceneTreeNode;