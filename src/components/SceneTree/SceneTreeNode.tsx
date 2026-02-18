import { useRef, useState } from "react";
import { useBlocksStore } from "../../state/useBlocksStore";
import type { SceneTreeNode as SceneTreeNodeType } from "../../models/sceneTree";

interface Props {
  node: SceneTreeNodeType;
  isLast: boolean;
  ancestorLines: boolean[];
  isRoot?: boolean;
  openContextMenu: (menu: {
    x: number;
    y: number;
    targetId: string;
    type: "group" | "object";
  }) => void;
  editingNodeId: string | null;
  editingValue: string;
  onEditingValueChange: (value: string) => void;
  onConfirmEditing: () => void;
  onCancelEditing: () => void;
}

const SceneTreeNode = ({
  node,
  isLast,
  ancestorLines,
  isRoot = false,
  openContextMenu,
  editingNodeId,
  editingValue,
  onEditingValueChange,
  onConfirmEditing,
  onCancelEditing,
}: Props) => {
  const selectBlock = useBlocksStore((s) => s.selectBlock);
  const selectedBlockId = useBlocksStore((s) => s.selectedBlockId);

  const blockLabel = useBlocksStore((s) => {
    if (node.type !== "block") return "";
    const block = s.blocks.find((b) => b.id === node.blockId);
    return block?.name?.trim() || block?.id || node.blockId;
  });

  const [expanded, setExpanded] = useState(true);
  const skipBlurCommitRef = useRef(false);

  const hasChildren = node.type === "group" && node.children.length > 0;
  const isEditing = editingNodeId === node.id;

  const renderPrefix = () =>
    ancestorLines.map((hasLine, i) => (
      <span
        key={i}
        className={`tree-line ${hasLine ? "active" : ""}`}
      />
    ));

  const renderConnector = () => (
    <span className={`tree-connector ${isLast ? "last" : ""}`} />
  );

  const renderInlineInput = () => (
    <input
      className="tree-inline-input"
      value={editingValue}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onEditingValueChange(e.target.value)}
      onBlur={() => {
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false;
          return;
        }
        onConfirmEditing();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onConfirmEditing();
        }

        if (e.key === "Escape") {
          e.preventDefault();
          skipBlurCommitRef.current = true;
          onCancelEditing();
        }
      }}
    />
  );

  if (node.type === "group") {
    return (
      <>
        <div
          className="tree-row"
          onClick={() => {
            if (isEditing) return;
            if (hasChildren) setExpanded((e) => !e);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();

            openContextMenu({
              x: e.clientX,
              y: e.clientY,
              targetId: node.id,
              type: "group",
            });
          }}
        >
          {renderPrefix()}
          {!isRoot ? renderConnector() : <span className="tree-spacer" />}

          <span className="tree-caret">
            {hasChildren ? (expanded ? "▼" : "▸") : ""}
          </span>

          <span className="tree-icon">📁</span>
          {isEditing ? renderInlineInput() : <span className="tree-label">{node.name}</span>}
        </div>

        {expanded &&
          node.children.map((child, index) => {
            const childIsLast = index === node.children.length - 1;

            return (
              <SceneTreeNode
                key={child.id}
                node={child}
                isLast={childIsLast}
                ancestorLines={[...ancestorLines, !isLast]}
                openContextMenu={openContextMenu}
                editingNodeId={editingNodeId}
                editingValue={editingValue}
                onEditingValueChange={onEditingValueChange}
                onConfirmEditing={onConfirmEditing}
                onCancelEditing={onCancelEditing}
              />
            );
          })}
      </>
    );
  }

  return (
    <div
      className={`tree-row ${selectedBlockId === node.blockId ? "selected" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        selectBlock(node.blockId);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();

        openContextMenu({
          x: e.clientX,
          y: e.clientY,
          targetId: node.id,
          type: "object",
        });
      }}
    >
      {renderPrefix()}
      {renderConnector()}

      <span className="tree-caret-placeholder" />
      <span className="tree-icon">🧊</span>
      {isEditing ? renderInlineInput() : <span className="tree-label">{blockLabel}</span>}
    </div>
  );
};

export default SceneTreeNode;
