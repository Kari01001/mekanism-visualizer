import { useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { useBlocksStore } from "../../state/useBlocksStore";
import type { SceneTreeNode as SceneTreeNodeType } from "../../models/sceneTree";

export type SceneTreeDropPosition = "before" | "after" | "inside";

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
  draggingNodeId: string | null;
  dragOver: {
    targetId: string;
    position: SceneTreeDropPosition;
  } | null;
  onTreeDragStart: (nodeId: string) => void;
  onTreeDragOver: (event: ReactDragEvent, targetId: string, position: SceneTreeDropPosition) => void;
  onTreeDrop: (event: ReactDragEvent, targetId: string, position: SceneTreeDropPosition) => void;
  onTreeDragEnd: () => void;
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
  draggingNodeId,
  dragOver,
  onTreeDragStart,
  onTreeDragOver,
  onTreeDrop,
  onTreeDragEnd,
}: Props) => {
  const selectSceneNode = useBlocksStore((s) => s.selectSceneNode);
  const selectedBlockId = useBlocksStore((s) => s.selectedBlockId);
  const selectedSceneNodeId = useBlocksStore((s) => s.selectedSceneNodeId);

  const blockLabel = useBlocksStore((s) => {
    if (node.type !== "block") return "";
    const block = s.blocks.find((b) => b.id === node.blockId);
    return block?.name?.trim() || block?.id || node.blockId;
  });

  const [expanded, setExpanded] = useState(true);
  const skipBlurCommitRef = useRef(false);

  const hasChildren = node.type === "group" && node.children.length > 0;
  const isEditing = editingNodeId === node.id;
  const isDragOverTarget = dragOver?.targetId === node.id;
  const dropClass = isDragOverTarget ? `drag-over-${dragOver.position}` : "";
  const isDragging = draggingNodeId === node.id;

  const resolveDropPosition = (event: ReactDragEvent): SceneTreeDropPosition => {
    const currentTarget = event.currentTarget as HTMLDivElement;
    const rect = currentTarget.getBoundingClientRect();
    const relativeY = event.clientY - rect.top;
    const ratio = rect.height > 0 ? relativeY / rect.height : 0.5;

    if (node.type === "group") {
      // Groups accept drops before, after, or inside; blocks only before/after.
      if (isRoot) return "inside";
      if (ratio < 0.25) return "before";
      if (ratio > 0.75) return "after";
      return "inside";
    }

    return ratio < 0.5 ? "before" : "after";
  };

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
        // Escape sets a one-shot flag so blur does not immediately re-confirm the edit.
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
          className={[
            "tree-row",
            selectedSceneNodeId === node.id && "selected",
            dropClass,
            isDragging && "dragging",
          ]
            .filter(Boolean)
            .join(" ")}
          draggable={!isRoot}
          onDragStart={(event) => {
            if (isRoot || isEditing) {
              event.preventDefault();
              return;
            }

            event.dataTransfer.setData("text/x-scene-node-id", node.id);
            event.dataTransfer.effectAllowed = "move";
            onTreeDragStart(node.id);
          }}
          onDragOver={(event) => {
            if (isEditing) return;
            onTreeDragOver(event, node.id, resolveDropPosition(event));
          }}
          onDrop={(event) => {
            if (isEditing) return;
            onTreeDrop(event, node.id, resolveDropPosition(event));
          }}
          onDragEnd={() => onTreeDragEnd()}
          onClick={() => {
            if (isEditing) return;
            selectSceneNode(node.id);
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

          {hasChildren ? (
            <button
              type="button"
              className="tree-caret tree-caret-button"
              aria-label={expanded ? "Collapse group" : "Expand group"}
              disabled={isEditing}
              onClick={() => {
                if (isEditing) return;
                setExpanded((current) => !current);
              }}
            >
              {expanded ? "▼" : "▸"}
            </button>
          ) : (
            <span className="tree-caret-placeholder" />
          )}

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
                draggingNodeId={draggingNodeId}
                dragOver={dragOver}
                onTreeDragStart={onTreeDragStart}
                onTreeDragOver={onTreeDragOver}
                onTreeDrop={onTreeDrop}
                onTreeDragEnd={onTreeDragEnd}
              />
            );
          })}
      </>
    );
  }

  return (
    <div
      className={[
        "tree-row",
        selectedBlockId === node.blockId && "selected",
        dropClass,
        isDragging && "dragging",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable={!isEditing}
      onDragStart={(event) => {
        if (isEditing) {
          event.preventDefault();
          return;
        }

        event.dataTransfer.setData("text/x-scene-node-id", node.id);
        event.dataTransfer.effectAllowed = "move";
        onTreeDragStart(node.id);
      }}
      onDragOver={(event) => onTreeDragOver(event, node.id, resolveDropPosition(event))}
      onDrop={(event) => onTreeDrop(event, node.id, resolveDropPosition(event))}
      onDragEnd={() => onTreeDragEnd()}
      onClick={(e) => {
        e.stopPropagation();
        selectSceneNode(node.id);
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

