import { useEffect, useMemo, useRef, useState } from "react";
import { BLOCK_DEFINITIONS, type BlockType } from "../../models/blocks";
import type { SceneGroupNode } from "../../models/sceneTree";
import { useBlocksStore } from "../../state/useBlocksStore";
import SceneTreeNode from "./SceneTreeNode";
import {
  findNodeById,
  findParentGroupId,
} from "./sceneTreeUtils";

type ContextMenuState = {
  x: number;
  y: number;
  targetId: string;
  type: "group" | "object";
};

type EditingState = {
  nodeId: string;
  type: "group" | "object";
  targetId: string;
  value: string;
  fallbackValue: string;
};

type AddObjectModalState = {
  targetGroupId: string;
  type: BlockType;
  name: string;
  position: {
    x: number;
    y: number;
    z: number;
  };
  error: string | null;
};

const groupNamePattern = /^Group \((\d+)\)$/;
const objectNamePattern = /^Object \((\d+)\)$/;

const getNextGroupName = (root: SceneGroupNode) => {
  let max = 0;

  const visit = (node: SceneGroupNode) => {
    const match = node.name.match(groupNamePattern);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }

    node.children.forEach((child) => {
      if (child.type === "group") {
        visit(child);
      }
    });
  };

  visit(root);
  return `Group (${max + 1})`;
};

const getNextObjectName = (names: string[]) => {
  let max = 0;

  names.forEach((name) => {
    const match = name.match(objectNamePattern);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  });

  return `Object (${max + 1})`;
};

const findFreeSpawnPosition = (positions: { x: number; y: number; z: number }[]) => {
  const occupied = new Set(
    positions.map((pos) => `${pos.x}:${pos.y}:${pos.z}`)
  );

  let y = 0;
  while (occupied.has(`0:${y}:0`)) {
    y += 1;
  }

  return { x: 0, y, z: 0 };
};

const SceneTreeView = () => {
  const sceneTree = useBlocksStore((s) => s.sceneTree);
  const blocks = useBlocksStore((s) => s.blocks);
  const addGroup = useBlocksStore((s) => s.addGroup);
  const renameGroup = useBlocksStore((s) => s.renameGroup);
  const removeGroup = useBlocksStore((s) => s.removeGroup);
  const addBlock = useBlocksStore((s) => s.addBlock);
  const removeBlock = useBlocksStore((s) => s.removeBlock);
  const renameBlock = useBlocksStore((s) => s.renameBlock);
  const selectBlock = useBlocksStore((s) => s.selectBlock);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [addObjectModal, setAddObjectModal] = useState<AddObjectModalState | null>(null);

  const menuRef = useRef<HTMLDivElement | null>(null);

  const blockTypeOptions = useMemo(
    () => Object.keys(BLOCK_DEFINITIONS) as BlockType[],
    []
  );

  const blockDisplayNames = useMemo(
    () => blocks.map((b) => (b.name?.trim() ? b.name : b.id)),
    [blocks]
  );

  const handleOpenContextMenu = (menu: ContextMenuState) => {
    setEditing(null);
    setContextMenu(menu);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      if (addObjectModal) {
        setAddObjectModal(null);
        return;
      }

      if (contextMenu) {
        setContextMenu(null);
        return;
      }

      if (editing) {
        setEditing(null);
      }
    };

    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [addObjectModal, contextMenu, editing]);

  const resolveTargetGroupId = (menu: ContextMenuState) => {
    if (menu.type === "group") return menu.targetId;
    return findParentGroupId(sceneTree, menu.targetId) ?? "root";
  };

  const startCreateGroup = () => {
    if (!contextMenu) return;

    const groupId = resolveTargetGroupId(contextMenu);
    const defaultName = getNextGroupName(sceneTree);
    const createdGroupId = addGroup(groupId, defaultName);

    setEditing({
      nodeId: createdGroupId,
      type: "group",
      targetId: createdGroupId,
      value: defaultName,
      fallbackValue: defaultName,
    });

    setContextMenu(null);
  };

  const startRename = () => {
    if (!contextMenu) return;

    const node = findNodeById(sceneTree, contextMenu.targetId);
    if (!node) {
      setContextMenu(null);
      return;
    }

    if (node.type === "group") {
      setEditing({
        nodeId: node.id,
        type: "group",
        targetId: node.id,
        value: node.name,
        fallbackValue: node.name,
      });
      setContextMenu(null);
      return;
    }

    const block = blocks.find((b) => b.id === node.blockId);
    const currentName = block?.name?.trim() || block?.id || node.blockId;

    setEditing({
      nodeId: node.id,
      type: "object",
      targetId: node.blockId,
      value: currentName,
      fallbackValue: currentName,
    });

    setContextMenu(null);
  };

  const confirmEditing = () => {
    if (!editing) return;

    const nextValue = editing.value.trim() || editing.fallbackValue;

    if (editing.type === "group") {
      renameGroup(editing.targetId, nextValue);
    } else {
      renameBlock(editing.targetId, nextValue);
    }

    setEditing(null);
  };

  const deleteTarget = () => {
    if (!contextMenu) return;

    if (contextMenu.type === "group") {
      if (contextMenu.targetId !== "root") {
        removeGroup(contextMenu.targetId);
      }
    } else {
      const node = findNodeById(sceneTree, contextMenu.targetId);
      if (node && node.type === "block") {
        removeBlock(node.blockId);
      }
    }

    setContextMenu(null);
    setEditing(null);
  };

  const openAddObjectModal = () => {
    if (!contextMenu) return;

    const targetGroupId = resolveTargetGroupId(contextMenu);
    const defaultName = getNextObjectName(blockDisplayNames);
    const defaultPosition = findFreeSpawnPosition(blocks.map((b) => b.position));

    setAddObjectModal({
      targetGroupId,
      type: blockTypeOptions[0] ?? "basic_block",
      name: defaultName,
      position: defaultPosition,
      error: null,
    });

    setContextMenu(null);
  };

  const confirmAddObject = () => {
    if (!addObjectModal) return;

    const createdId = addBlock(
      addObjectModal.type,
      addObjectModal.position,
      addObjectModal.targetGroupId,
      addObjectModal.name
    );

    if (!createdId) {
      setAddObjectModal((current) =>
        current
          ? {
              ...current,
              error: "Na teto pozici uz existuje jiny objekt.",
            }
          : null
      );
      return;
    }

    selectBlock(createdId);
    setAddObjectModal(null);
  };

  const updateModalPosition = (axis: "x" | "y" | "z", value: string) => {
    const parsed = Number(value);

    setAddObjectModal((current) => {
      if (!current) return null;

      return {
        ...current,
        error: null,
        position: {
          ...current.position,
          [axis]: Number.isFinite(parsed) ? Math.trunc(parsed) : 0,
        },
      };
    });
  };

  const isRootTarget =
    contextMenu?.type === "group" && contextMenu.targetId === "root";

  return (
    <>
      <SceneTreeNode
        node={sceneTree}
        isLast={true}
        ancestorLines={[]}
        isRoot
        openContextMenu={handleOpenContextMenu}
        editingNodeId={editing?.nodeId ?? null}
        editingValue={editing?.value ?? ""}
        onEditingValueChange={(value) =>
          setEditing((current) => (current ? { ...current, value } : null))
        }
        onConfirmEditing={confirmEditing}
        onCancelEditing={() => setEditing(null)}
      />

      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
          }}
        >
          <button className="context-item" onClick={startCreateGroup}>
            Create Group
          </button>
          <button className="context-item" onClick={openAddObjectModal}>
            Add Object
          </button>
          <button
            className="context-item"
            onClick={startRename}
            disabled={isRootTarget}
          >
            Rename
          </button>
          <button
            className="context-item danger"
            onClick={deleteTarget}
            disabled={isRootTarget}
          >
            Delete
          </button>
        </div>
      )}

      {addObjectModal && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setAddObjectModal(null)}
        >
          <div
            className="modal-card"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3>Add Object</h3>

            <div className="modal-field">
              <label>Name</label>
              <input
                value={addObjectModal.name}
                onChange={(e) =>
                  setAddObjectModal((current) =>
                    current
                      ? { ...current, name: e.target.value, error: null }
                      : null
                  )
                }
              />
            </div>

            <div className="modal-field">
              <label>Type</label>
              <select
                value={addObjectModal.type}
                onChange={(e) =>
                  setAddObjectModal((current) =>
                    current
                      ? { ...current, type: e.target.value as BlockType, error: null }
                      : null
                  )
                }
              >
                {blockTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {BLOCK_DEFINITIONS[type].displayName}
                  </option>
                ))}
              </select>
            </div>

            <div className="modal-field">
              <label>Position</label>
              <div className="modal-position-grid">
                <input
                  type="number"
                  value={addObjectModal.position.x}
                  onChange={(e) => updateModalPosition("x", e.target.value)}
                />
                <input
                  type="number"
                  value={addObjectModal.position.y}
                  onChange={(e) => updateModalPosition("y", e.target.value)}
                />
                <input
                  type="number"
                  value={addObjectModal.position.z}
                  onChange={(e) => updateModalPosition("z", e.target.value)}
                />
              </div>
            </div>

            {addObjectModal.error && (
              <p className="modal-error">{addObjectModal.error}</p>
            )}

            <div className="modal-actions">
              <button onClick={() => setAddObjectModal(null)}>Cancel</button>
              <button className="primary" onClick={confirmAddObject}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SceneTreeView;
