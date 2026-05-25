import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  BLOCK_FACES,
  createConnectionMask,
  type BlockConnectionMask,
  type BlockConnectionMode,
  type BlockType,
} from "../../models/blocks";
import type { SceneGroupNode } from "../../models/sceneTree";
import { useBlockTypesStore } from "../../state/useBlockTypesStore";
import { useBlocksStore } from "../../state/useBlocksStore";
import SceneTreeNode, { type SceneTreeDropPosition } from "./SceneTreeNode";
import {
  findNodeById,
  findParentGroupId,
} from "./sceneTreeUtils";
import { logInfo, logWarn } from "../../state/useConsoleStore";

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
  typeFilter: string;
  name: string;
  position: {
    x: number;
    y: number;
    z: number;
  };
  error: string | null;
};

type EditConnectionsModalState = {
  blockId: string;
  blockName: string;
  mode: BlockConnectionMode;
  mask: BlockConnectionMask;
};

const groupNamePattern = /^Group \((\d+)\)$/;
const objectNamePattern = /^Object \((\d+)\)$/;
const connectionDirectionLabels: Record<(typeof BLOCK_FACES)[number], string> = {
  right: "Right (+X)",
  left: "Left (-X)",
  top: "Top (+Y)",
  bottom: "Bottom (-Y)",
  front: "Front (+Z)",
  back: "Back (-Z)",
};

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
  // New objects stack upward at origin until a free slot is found.
  while (occupied.has(`0:${y}:0`)) {
    y += 1;
  }

  return { x: 0, y, z: 0 };
};

const toGroupLabel = (value: string) =>
  value
    .split("/")
    .flatMap((part) => part.split("_"))
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" / ");

const getTypeGroupLabel = (typeId: string, explicitGroup?: string) => {
  if (explicitGroup?.trim()) {
    return toGroupLabel(explicitGroup.trim());
  }

  const segments = typeId.split("__");
  if (segments.length > 1) {
    return toGroupLabel(segments.slice(0, -1).join("/"));
  }

  return "General";
};

const filterTypeDefinitions = (
  definitions: Array<{ id: string; displayName: string; group?: string }>,
  filterText: string
) => {
  const normalized = filterText.trim().toLowerCase();
  if (normalized === "") return definitions;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return definitions;

  return definitions.filter((definition) => {
    const haystack = `${definition.displayName} ${definition.id} ${definition.group ?? ""}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
};

const normalizeConnectionsForModal = (
  value: { mode?: BlockConnectionMode; mask?: Partial<Record<(typeof BLOCK_FACES)[number], boolean>> } | undefined
): { mode: BlockConnectionMode; mask: BlockConnectionMask } => {
  // Modal state mirrors inspector behavior: explicit mode plus full face mask.
  const mask = createConnectionMask();
  if (value?.mask) {
    BLOCK_FACES.forEach((face) => {
      mask[face] = value.mask?.[face] === true;
    });
  }

  return {
    mode: value?.mode === "manual" ? "manual" : "auto",
    mask,
  };
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
  const setBlockConnections = useBlocksStore((s) => s.setBlockConnections);
  const moveSceneNode = useBlocksStore((s) => s.moveSceneNode);
  const selectBlock = useBlocksStore((s) => s.selectBlock);
  const selectSceneNode = useBlocksStore((s) => s.selectSceneNode);
  const typeDefinitions = useBlockTypesStore((s) => s.definitions);
  const getTypeDefinition = useBlockTypesStore((s) => s.getDefinition);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [addObjectModal, setAddObjectModal] = useState<AddObjectModalState | null>(null);
  const [editConnectionsModal, setEditConnectionsModal] = useState<EditConnectionsModalState | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{
    targetId: string;
    position: SceneTreeDropPosition;
  } | null>(null);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const draggingNodeIdRef = useRef<string | null>(null);
  const dragOverRef = useRef<{
    targetId: string;
    position: SceneTreeDropPosition;
  } | null>(null);
  const pendingPointerDragRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const visibleTypeDefinitions = useMemo(
    () => typeDefinitions.filter((definition) => !definition.internal),
    [typeDefinitions]
  );

  const blockTypeOptions = useMemo(
    () => visibleTypeDefinitions.map((definition) => definition.id),
    [visibleTypeDefinitions]
  );

  const blockDisplayNames = useMemo(
    () => blocks.map((b) => (b.name?.trim() ? b.name : b.id)),
    [blocks]
  );

  const filteredVisibleTypeDefinitions = useMemo(() => {
    const filterText = addObjectModal?.typeFilter ?? "";
    return filterTypeDefinitions(visibleTypeDefinitions, filterText);
  }, [visibleTypeDefinitions, addObjectModal?.typeFilter]);

  const groupedTypeOptions = useMemo(() => {
    const grouped = new Map<string, typeof filteredVisibleTypeDefinitions>();

    filteredVisibleTypeDefinitions.forEach((definition) => {
      const label = getTypeGroupLabel(definition.id, definition.group);
      const existing = grouped.get(label);
      if (existing) {
        existing.push(definition);
      } else {
        grouped.set(label, [definition]);
      }
    });

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, options]) => ({
        label,
        options: options.sort((a, b) => a.displayName.localeCompare(b.displayName)),
      }));
  }, [filteredVisibleTypeDefinitions]);

  const handleOpenContextMenu = (menu: ContextMenuState) => {
    setEditing(null);
    selectSceneNode(menu.targetId);
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

      if (editConnectionsModal) {
        setEditConnectionsModal(null);
        return;
      }

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
  }, [addObjectModal, contextMenu, editConnectionsModal, editing]);

  const resolveTargetGroupId = (menu: ContextMenuState) => {
    // Object menu actions target the parent group of the clicked block node.
    if (menu.type === "group") return menu.targetId;
    return findParentGroupId(sceneTree, menu.targetId) ?? "root";
  };

  const resolveObjectBlockFromContext = (menu: ContextMenuState | null) => {
    if (!menu || menu.type !== "object") return null;

    const node = findNodeById(sceneTree, menu.targetId);
    if (!node || node.type !== "block") return null;

    const block = blocks.find((entry) => entry.id === node.blockId);
    if (!block) return null;

    return block;
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
      type: blockTypeOptions[0] ?? "unknown_block",
      typeFilter: "",
      name: defaultName,
      position: defaultPosition,
      error: null,
    });

    setContextMenu(null);
  };

  const openEditConnectionsModal = () => {
    const block = resolveObjectBlockFromContext(contextMenu);
    if (!block) return;

    const definition = getTypeDefinition(block.type);
    if (definition.renderMode !== "conduit") {
      setContextMenu(null);
      return;
    }

    const normalized = normalizeConnectionsForModal(block.connections);
    setEditConnectionsModal({
      blockId: block.id,
      blockName: block.name?.trim() || block.id,
      mode: normalized.mode,
      mask: normalized.mask,
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

  const confirmEditConnections = () => {
    if (!editConnectionsModal) return;

    setBlockConnections(editConnectionsModal.blockId, {
      mode: editConnectionsModal.mode,
      mask: editConnectionsModal.mask,
    });
    setEditConnectionsModal(null);
  };

  const contextObjectBlock = resolveObjectBlockFromContext(contextMenu);
  const canEditConnections = Boolean(
    contextObjectBlock &&
      getTypeDefinition(contextObjectBlock.type).renderMode === "conduit"
  );

  const findChildIndex = (groupId: string, childId: string) => {
    const groupNode = findNodeById(sceneTree, groupId);
    if (!groupNode || groupNode.type !== "group") return -1;
    return groupNode.children.findIndex((child) => child.id === childId);
  };

  const resolveDropTarget = (
    targetId: string,
    position: SceneTreeDropPosition
  ): { groupId: string; index?: number } | null => {
    const targetNode = findNodeById(sceneTree, targetId);
    if (!targetNode) return null;

    if (targetNode.type === "group") {
      // Dropping "inside" a group appends to that group's children.
      if (position === "inside") {
        return { groupId: targetId };
      }

      const parentGroupId = findParentGroupId(sceneTree, targetId);
      if (!parentGroupId) return null;
      const targetIndex = findChildIndex(parentGroupId, targetId);
      if (targetIndex < 0) return null;

      return {
        groupId: parentGroupId,
        index: position === "before" ? targetIndex : targetIndex + 1,
      };
    }

    const parentGroupId = findParentGroupId(sceneTree, targetId);
    if (!parentGroupId) return null;
    const targetIndex = findChildIndex(parentGroupId, targetId);
    if (targetIndex < 0) return null;

    return {
      groupId: parentGroupId,
      index: position === "before" ? targetIndex : targetIndex + 1,
    };
  };

  const setDragOverState = (
    nextValue: {
      targetId: string;
      position: SceneTreeDropPosition;
    } | null
  ) => {
    dragOverRef.current = nextValue;
    setDragOver(nextValue);
  };

  const clearDragState = () => {
    pendingPointerDragRef.current = null;
    draggingNodeIdRef.current = null;
    dragOverRef.current = null;
    setDraggingNodeId(null);
    setDragOver(null);
  };

  const resolvePointerDropPosition = (
    targetType: "group" | "block",
    isRootTarget: boolean,
    rowRect: DOMRect,
    pointerY: number
  ): SceneTreeDropPosition => {
    const relativeY = pointerY - rowRect.top;
    const ratio = rowRect.height > 0 ? relativeY / rowRect.height : 0.5;

    if (targetType === "group") {
      if (isRootTarget) return "inside";
      if (ratio < 0.25) return "before";
      if (ratio > 0.75) return "after";
      return "inside";
    }

    return ratio < 0.5 ? "before" : "after";
  };

  const resolveDropFromPointer = (clientX: number, clientY: number) => {
    const hoveredElement = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const rowElement = hoveredElement?.closest("[data-scene-tree-node-id]") as HTMLElement | null;
    if (!rowElement) {
      return null;
    }

    const targetId = rowElement.dataset.sceneTreeNodeId;
    const targetType = rowElement.dataset.sceneTreeNodeType as "group" | "block" | undefined;
    if (!targetId || !targetType) {
      return null;
    }

    const position = resolvePointerDropPosition(
      targetType,
      rowElement.dataset.sceneTreeRoot === "true",
      rowElement.getBoundingClientRect(),
      clientY
    );

    return {
      targetId,
      position,
      target: resolveDropTarget(targetId, position),
    };
  };

  const handleTreePointerDown = (event: ReactMouseEvent, nodeId: string) => {
    if (event.button !== 0) return;

    const targetElement = event.target as HTMLElement | null;
    if (targetElement?.closest("button, input, select, textarea, a")) {
      return;
    }

    pendingPointerDragRef.current = {
      nodeId,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const shouldSuppressTreeClick = () => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  };

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      const pending = pendingPointerDragRef.current;
      if (!pending) return;

      const deltaX = event.clientX - pending.startX;
      const deltaY = event.clientY - pending.startY;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      const isActive = draggingNodeIdRef.current !== null;

      if (!isActive) {
        // Delay drag activation until the pointer clearly moved away from a click.
        if (distanceSquared < 16) return;

        draggingNodeIdRef.current = pending.nodeId;
        setDraggingNodeId(pending.nodeId);
      }

      event.preventDefault();

      const resolvedDrop = resolveDropFromPointer(event.clientX, event.clientY);
      if (
        !resolvedDrop ||
        !resolvedDrop.target ||
        (draggingNodeIdRef.current === resolvedDrop.targetId &&
          resolvedDrop.position === "inside")
      ) {
        setDragOverState(null);
        return;
      }

      setDragOverState({
        targetId: resolvedDrop.targetId,
        position: resolvedDrop.position,
      });
    };

    const handlePointerUp = (event: MouseEvent) => {
      const pending = pendingPointerDragRef.current;
      const sourceId = draggingNodeIdRef.current;
      if (!pending && !sourceId) return;

      if (sourceId) {
        const resolvedDrop = resolveDropFromPointer(event.clientX, event.clientY);
        if (!resolvedDrop || !resolvedDrop.target) {
          logWarn("SceneTree", "Drop ignored because the pointer was released outside a valid scene tree target.");
        } else {
          const moved = moveSceneNode(
            sourceId,
            resolvedDrop.target.groupId,
            resolvedDrop.target.index
          );

          if (moved) {
            selectSceneNode(sourceId);
            logInfo(
              "SceneTree",
              `Moved ${sourceId} into ${resolvedDrop.target.groupId}${
                typeof resolvedDrop.target.index === "number"
                  ? ` at index ${resolvedDrop.target.index}`
                  : ""
              }.`
            );
          } else {
            logWarn(
              "SceneTree",
              `Move rejected for ${sourceId} into ${resolvedDrop.target.groupId}${
                typeof resolvedDrop.target.index === "number"
                  ? ` at index ${resolvedDrop.target.index}`
                  : ""
              }.`
            );
          }
        }

        suppressClickRef.current = true;
      }

      clearDragState();
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);

    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, [moveSceneNode, selectSceneNode, sceneTree]);

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
        onTreePointerDown={handleTreePointerDown}
        shouldSuppressTreeClick={shouldSuppressTreeClick}
        draggingNodeId={draggingNodeId}
        dragOver={dragOver}
        onTreeDragEnd={clearDragState}
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
            onClick={openEditConnectionsModal}
            disabled={!canEditConnections}
          >
            Edit Connections
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
              <label>Type Filter</label>
              <input
                value={addObjectModal.typeFilter}
                onChange={(e) =>
                  setAddObjectModal((current) => {
                    if (!current) return null;

                    const nextFilter = e.target.value;
                    const filtered = filterTypeDefinitions(
                      visibleTypeDefinitions,
                      nextFilter
                    );
                    const nextType = filtered.some((definition) => definition.id === current.type)
                      ? current.type
                      : (filtered[0]?.id ?? current.type);

                    return {
                      ...current,
                      typeFilter: nextFilter,
                      type: nextType,
                      error: null,
                    };
                  })
                }
                placeholder="Search by name, id or group"
              />
            </div>

            <div className="modal-field">
              <label>Type</label>
              <select
                value={addObjectModal.type}
                disabled={
                  visibleTypeDefinitions.length > 0 &&
                  filteredVisibleTypeDefinitions.length === 0
                }
                onChange={(e) =>
                  setAddObjectModal((current) =>
                    current
                      ? { ...current, type: e.target.value as BlockType, error: null }
                      : null
                  )
                }
              >
                {groupedTypeOptions.length > 0 ? (
                  groupedTypeOptions.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((definition) => (
                        <option key={definition.id} value={definition.id}>
                          {definition.displayName}
                        </option>
                      ))}
                    </optgroup>
                  ))
                ) : (
                  <>
                    {visibleTypeDefinitions.length === 0 ? (
                      <option value="unknown_block">
                        {getTypeDefinition("unknown_block").displayName}
                      </option>
                    ) : (
                      <option value={addObjectModal.type}>
                        No type matches current filter
                      </option>
                    )}
                  </>
                )}
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

      {editConnectionsModal && (
        <div className="modal-backdrop" onMouseDown={() => setEditConnectionsModal(null)}>
          <div
            className="modal-card connections-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h3>Edit Connections</h3>
            <p className="connections-modal-summary">{editConnectionsModal.blockName}</p>

            <div className="modal-field">
              <label>Mode</label>
              <div className="connections-mode-toggle">
                <button
                  className={editConnectionsModal.mode === "auto" ? "active" : ""}
                  onClick={() =>
                    setEditConnectionsModal((current) =>
                      current ? { ...current, mode: "auto" } : current
                    )
                  }
                >
                  Auto
                </button>
                <button
                  className={editConnectionsModal.mode === "manual" ? "active" : ""}
                  onClick={() =>
                    setEditConnectionsModal((current) =>
                      current ? { ...current, mode: "manual" } : current
                    )
                  }
                >
                  Manual
                </button>
              </div>
            </div>

            <div className="modal-field">
              <label>Directions</label>
              <div className="connections-grid">
                {BLOCK_FACES.map((direction) => (
                  <label key={direction} className="connections-direction">
                    <input
                      type="checkbox"
                      checked={editConnectionsModal.mask[direction]}
                      disabled={editConnectionsModal.mode !== "manual"}
                      onChange={(event) =>
                        setEditConnectionsModal((current) =>
                          current
                            ? {
                                ...current,
                                mask: {
                                  ...current.mask,
                                  [direction]: event.target.checked,
                                },
                              }
                            : current
                        )
                      }
                    />
                    <span>{connectionDirectionLabels[direction]}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="modal-actions">
              <button onClick={() => setEditConnectionsModal(null)}>Cancel</button>
              <button className="primary" onClick={confirmEditConnections}>
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SceneTreeView;
