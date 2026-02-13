import { useState } from "react";
import { useBlocksStore } from "../../state/useBlocksStore";
import type { SceneTreeNode as SceneTreeNodeType } from "../../models/sceneTree";

interface Props {
  node: SceneTreeNodeType;
  isLast: boolean;
  ancestorLines: boolean[];
  isRoot?: boolean;
}

const SceneTreeNode = ({
  node,
  isLast,
  ancestorLines,
  isRoot = false,
}: Props) => {
  const selectBlock = useBlocksStore((s) => s.selectBlock);
  const selectedBlockId = useBlocksStore((s) => s.selectedBlockId);

  const [expanded, setExpanded] = useState(true);

  const hasChildren =
    node.type === "group" && node.children.length > 0;

  const renderPrefix = () => ancestorLines.map((hasLine, i) => (
    <span
      key={i}
      className={`tree-line ${hasLine ? "active" : ""}`}
    />
  ));
  
  const renderConnector = () => (
    <span
      className={`tree-connector ${isLast ? "last" : ""}`}
    />
  );

  if (node.type === "group") {
    return (
      <>
        <div
          className="tree-row"
          onClick={() =>
            hasChildren && setExpanded((e) => !e)
          }
        >
          {renderPrefix()}
          {!isRoot ? renderConnector() : <span className="tree-spacer" />}

          <span className="tree-caret">
            {hasChildren ? (expanded ? "▾" : "▸") : ""}
          </span>

          <span className="tree-icon">📁</span>
          <span className="tree-label">{node.name}</span>
        </div>

        {expanded &&
          node.children.map((child, index) => {
            const childIsLast =
              index === node.children.length - 1;

            return (
              <SceneTreeNode
                key={child.id}
                node={child}
                isLast={childIsLast}
                ancestorLines={[
                  ...ancestorLines,
                  !isLast,
                ]}
              />
            );
          })}
      </>
    );
  }

  return (
    <div
      className={`tree-row ${
        selectedBlockId === node.blockId
          ? "selected"
          : ""
      }`}
      onClick={(e) => {
        e.stopPropagation();
        selectBlock(node.blockId);
      }}
    >
      {renderPrefix()}
      {renderConnector()}

      <span className="tree-caret-placeholder" />
      <span className="tree-icon">🧊</span>
      <span className="tree-label">
        {node.blockId}
      </span>
    </div>
  );
};

export default SceneTreeNode;