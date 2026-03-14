import { create } from "zustand";
import type { SceneGroupNode } from "../models/sceneTree";
import {
  BLOCK_FACES,
  createConnectionMask,
  type BlockConnectionMask,
  type BlockConnectionMode,
  type BlockConnections,
  type BlockInstance,
  type BlockType,
  type Vec3,
} from "../models/blocks";
import { getBlockTypeDefinition } from "./useBlockTypesStore";
import {
  collectBlockIds,
  findNodeById,
  findParentGroupId,
  insertNode,
  removeNodeById,
  renameGroupById,
} from "../components/SceneTree/sceneTreeUtils";
import { applyAutoConnectionMasks } from "../utils/conduitConnections";

const isSamePosition = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
) => a.x === b.x && a.y === b.y && a.z === b.z;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseConnectionMode = (value: unknown): BlockConnectionMode =>
  value === "manual" ? "manual" : "auto";

const parseConnectionMask = (value: unknown): BlockConnectionMask => {
  const mask = createConnectionMask();
  if (!isRecord(value)) return mask;

  BLOCK_FACES.forEach((face) => {
    mask[face] = value[face] === true;
  });

  return mask;
};

const parseConnections = (value: unknown): BlockConnections | undefined => {
  if (!isRecord(value)) return undefined;

  return {
    mode: parseConnectionMode(value.mode),
    mask: parseConnectionMask(value.mask),
  };
};

const createDefaultConnections = (): BlockConnections => ({
  mode: "auto",
  mask: createConnectionMask(),
});

const normalizeConnections = (
  type: BlockType,
  value: unknown
): BlockConnections | undefined => {
  const parsed = parseConnections(value);
  if (parsed) return parsed;

  // Conduits default to auto-connect mode even when legacy payloads omit connection fields.
  const definition = getBlockTypeDefinition(type);
  if (definition.renderMode === "conduit") {
    return createDefaultConnections();
  }

  return undefined;
};

const normalizeBlockInstance = (block: BlockInstance): BlockInstance => ({
  ...block,
  connections: normalizeConnections(
    block.type,
    (block as BlockInstance & { connections?: unknown }).connections
  ),
});

const syncIdCounter = (blocks: BlockInstance[]) => {
  let max = 0;

  blocks.forEach((block) => {
    const match = /^block-(\d+)$/.exec(block.id);
    if (!match) return;

    const numericId = Number.parseInt(match[1], 10);
    if (Number.isFinite(numericId)) {
      max = Math.max(max, numericId);
    }
  });

  idCounter = Math.max(idCounter, max + 1);
};

interface BlocksState {
  blocks: BlockInstance[];
  sceneTree: SceneGroupNode;

  selectedBlockId: string | null;
  selectedSceneNodeId: string | null;

  mode: "view" | "edit";
  setMode: (mode: "view" | "edit") => void;

  transformMode: "none" | "move" | "rotate";
  setTransformMode: (mode: "none" | "move" | "rotate") => void;

  gizmo: {
    mode: "none" | "move" | "rotate";
    axis: "x" | "y" | "z" | null;
  };
  setGizmoAxis: (axis: "x" | "y" | "z" | null) => void;

  addBlock: (
    type: BlockType,
    position: Vec3,
    parentGroupId?: string,
    name?: string,
    connections?: BlockConnections
  ) => string | null;
  removeBlock: (id: string) => void;
  renameBlock: (id: string, name: string) => void;
  setBlockConnections: (id: string, connections: BlockConnections) => void;

  addGroup: (parentGroupId: string, name: string) => string;
  renameGroup: (groupId: string, name: string) => void;
  removeGroup: (groupId: string) => void;

  addBlockToGroup: (groupId: string, blockId: string) => void;
  moveSceneNode: (
    nodeId: string,
    targetGroupId: string,
    targetIndex?: number
  ) => boolean;

  moveBlock: (id: string, delta: { x?: number; y?: number; z?: number }) => void;
  setBlockPosition: (id: string, position: { x: number; y: number; z: number }) => void;
  rotateBlockAxis: (id: string, axis: "x" | "y" | "z", delta: 90 | -90) => void;
  setBlockRotation: (id: string, rotation: { x: number; y: number; z: number }) => void;

  loadBlocks: (blocks: BlockInstance[]) => void;
  loadProject: (data: { sceneTree: SceneGroupNode; blocks: BlockInstance[] }) => void;

  selectBlock: (id: string | null) => void;
  selectSceneNode: (nodeId: string | null) => void;
  clearBlocks: () => void;

  exportProject: () => string;
  importProject: (data: string) => void;
}

let idCounter = 1;

export const useBlocksStore = create<BlocksState>((set, get) => ({
  blocks: [],

  sceneTree: {
    id: "root",
    type: "group",
    name: "Scene",
    children: [],
  },

  selectedBlockId: null,
  selectedSceneNodeId: null,

  mode: "view",
  setMode: (mode) => set({ mode }),

  transformMode: "none",
  setTransformMode: (transformMode) => set({ transformMode }),

  gizmo: {
    mode: "none",
    axis: null,
  },

  setGizmoAxis: (axis) =>
    set((state) => ({
      gizmo: {
        ...state.gizmo,
        axis,
      },
    })),

  addBlock: (type, position, parentGroupId = "root", name, connections) => {
    const state = get();
    // Keep one block per exact grid position to preserve deterministic snapping behavior.
    const alreadyExists = state.blocks.some((b) => isSamePosition(b.position, position));

    if (alreadyExists) return null;

    const id = `block-${idCounter++}`;
    const trimmedName = name?.trim();

    const newBlock: BlockInstance = {
      id,
      name: trimmedName || undefined,
      type,
      position,
      rotation: { x: 0, y: 0, z: 0 },
      parentGroupId,
      connections: normalizeConnections(type, connections),
    };

    set((current) => {
      const nextBlocks = applyAutoConnectionMasks([...current.blocks, newBlock]);

      return {
        blocks: nextBlocks,
        sceneTree: insertNode(current.sceneTree, parentGroupId, {
          id: `node-${id}`,
          type: "block",
          blockId: id,
        }),
      };
    });

    return id;
  },

  removeBlock: (id) =>
    set((state) => ({
      blocks: applyAutoConnectionMasks(state.blocks.filter((b) => b.id !== id)),
      selectedBlockId: state.selectedBlockId === id ? null : state.selectedBlockId,
      selectedSceneNodeId:
        state.selectedSceneNodeId === `node-${id}` ? null : state.selectedSceneNodeId,
      sceneTree: removeNodeById(state.sceneTree, `node-${id}`),
    })),

  renameBlock: (id, name) =>
    set((state) => ({
      blocks: state.blocks.map((b) => (b.id === id ? { ...b, name } : b)),
    })),

  setBlockConnections: (id, connections) =>
    set((state) => {
      const nextBlocks = state.blocks.map((b) =>
        b.id === id
          ? {
              ...b,
              connections: {
                mode: parseConnectionMode(connections.mode),
                mask: parseConnectionMask(connections.mask),
              },
            }
          : b
      );

      return {
        blocks: applyAutoConnectionMasks(nextBlocks),
      };
    }),

  moveBlock: (id, delta) =>
    set((state) => ({
      blocks: applyAutoConnectionMasks(
        state.blocks.map((b) =>
          b.id === id
            ? {
                ...b,
                position: {
                  x: b.position.x + (delta.x ?? 0),
                  y: b.position.y + (delta.y ?? 0),
                  z: b.position.z + (delta.z ?? 0),
                },
              }
            : b
        )
      ),
    })),

  setBlockPosition: (id, position) =>
    set((state) => ({
      blocks: applyAutoConnectionMasks(
        state.blocks.map((b) =>
          b.id === id
            ? {
                ...b,
                position,
              }
            : b
        )
      ),
    })),

  rotateBlockAxis: (id, axis, delta) =>
    set((state) => ({
      blocks: state.blocks.map((b) =>
        b.id === id
          ? {
              ...b,
              rotation: {
                ...b.rotation,
                [axis]: ((b.rotation[axis] + delta) % 360 + 360) % 360,
              },
            }
          : b
      ),
    })),

  setBlockRotation: (id, rotation) =>
    set((state) => ({
      blocks: state.blocks.map((b) => (b.id === id ? { ...b, rotation } : b)),
    })),

  addGroup: (parentGroupId, name) => {
    const id = `grp-${crypto.randomUUID()}`;

    const newGroup: SceneGroupNode = {
      id,
      type: "group",
      name,
      children: [],
    };

    set((state) => ({
      sceneTree: insertNode(state.sceneTree, parentGroupId, newGroup),
    }));

    return id;
  },

  renameGroup: (groupId, name) =>
    set((state) => ({
      sceneTree: renameGroupById(state.sceneTree, groupId, name),
    })),

  removeGroup: (groupId) =>
    set((state) => {
      if (groupId === "root") return state;

      const node = findNodeById(state.sceneTree, groupId);
      if (!node || node.type !== "group") return state;

      const idsToRemove = collectBlockIds(node);

      return {
        sceneTree: removeNodeById(state.sceneTree, groupId),
        blocks: state.blocks.filter((b) => !idsToRemove.has(b.id)),
        selectedBlockId:
          state.selectedBlockId && idsToRemove.has(state.selectedBlockId)
            ? null
            : state.selectedBlockId,
        selectedSceneNodeId:
          state.selectedSceneNodeId === groupId ||
          (state.selectedSceneNodeId?.startsWith("node-") &&
            idsToRemove.has(state.selectedSceneNodeId.slice("node-".length)))
            ? null
            : state.selectedSceneNodeId,
      };
    }),

  addBlockToGroup: (groupId, blockId) =>
    set((state) => {
      const cleanedTree = removeNodeById(state.sceneTree, `node-${blockId}`);

      return {
        sceneTree: insertNode(cleanedTree, groupId, {
          id: `node-${blockId}`,
          type: "block",
          blockId,
        }),
        blocks: state.blocks.map((b) => (b.id === blockId ? { ...b, parentGroupId: groupId } : b)),
      };
    }),

  moveSceneNode: (nodeId, targetGroupId, targetIndex) => {
    if (nodeId === "root") return false;

    const state = get();
    const sourceParentId = findParentGroupId(state.sceneTree, nodeId);
    if (!sourceParentId) return false;

    const sourceParent = findNodeById(state.sceneTree, sourceParentId);
    const targetGroup = findNodeById(state.sceneTree, targetGroupId);
    const node = findNodeById(state.sceneTree, nodeId);

    if (!sourceParent || sourceParent.type !== "group") return false;
    if (!targetGroup || targetGroup.type !== "group") return false;
    if (!node) return false;

    // Prevent dragging a group into itself or any of its descendants.
    if (node.type === "group") {
      if (node.id === targetGroupId) return false;
      if (findNodeById(node, targetGroupId)) return false;
    }

    const sourceIndex = sourceParent.children.findIndex((child) => child.id === nodeId);
    if (sourceIndex < 0) return false;

    const hasExplicitTargetIndex = typeof targetIndex === "number" && Number.isFinite(targetIndex);
    const rawTargetIndex = hasExplicitTargetIndex ? Math.trunc(targetIndex) : targetGroup.children.length;
    const clampedIndex = Math.max(0, Math.min(rawTargetIndex, targetGroup.children.length));

    // When reordering inside the same parent, account for index shift after removal.
    let insertionIndex = clampedIndex;
    if (sourceParentId === targetGroupId && clampedIndex > sourceIndex) {
      insertionIndex -= 1;
    }

    if (sourceParentId === targetGroupId && insertionIndex === sourceIndex) {
      return false;
    }

    const cleanedTree = removeNodeById(state.sceneTree, nodeId);
    const nextSceneTree = insertNode(cleanedTree, targetGroupId, node, insertionIndex);

    set((current) => ({
      sceneTree: nextSceneTree,
      blocks:
        node.type === "block"
          ? current.blocks.map((block) =>
              block.id === node.blockId ? { ...block, parentGroupId: targetGroupId } : block
            )
          : current.blocks,
    }));

    return true;
  },

  selectBlock: (id) =>
    set({
      selectedBlockId: id,
      selectedSceneNodeId: id ? `node-${id}` : null,
    }),

  selectSceneNode: (nodeId) =>
    set((state) => {
      if (!nodeId) {
        return {
          selectedSceneNodeId: null,
          selectedBlockId: null,
        };
      }

      const node = findNodeById(state.sceneTree, nodeId);
      if (!node) {
        return state;
      }

      if (node.type === "block") {
        return {
          selectedSceneNodeId: nodeId,
          selectedBlockId: node.blockId,
        };
      }

      return {
        selectedSceneNodeId: nodeId,
        selectedBlockId: null,
      };
    }),

  clearBlocks: () =>
    set({
      blocks: [],
      selectedBlockId: null,
      selectedSceneNodeId: null,
      sceneTree: {
        id: "root",
        type: "group",
        name: "Scene",
        children: [],
      },
    }),

  loadBlocks: (newBlocks) =>
    set(() => {
      const normalizedBlocks = applyAutoConnectionMasks(
        newBlocks.map(normalizeBlockInstance)
      );
      let newTree: SceneGroupNode = {
        id: "root",
        type: "group",
        name: "Scene",
        children: [],
      };

      normalizedBlocks.forEach((block) => {
        const parentId = block.parentGroupId ?? "root";
        const nodeId = `node-${block.id}`;

        // Repair tree references if imported data contains blocks missing from sceneTree.
        if (!findNodeById(newTree, nodeId)) {
          newTree = insertNode(newTree, parentId, {
            id: nodeId,
            type: "block",
            blockId: block.id,
          });
        }
      });

      syncIdCounter(normalizedBlocks);

      return {
        blocks: normalizedBlocks,
        sceneTree: newTree,
        selectedBlockId: null,
        selectedSceneNodeId: null,
      };
    }),

  loadProject: (project) =>
    set(() => {
      const normalizedBlocks = applyAutoConnectionMasks(
        project.blocks.map(normalizeBlockInstance)
      );
      let newTree = project.sceneTree;

      normalizedBlocks.forEach((block) => {
        const parentId = block.parentGroupId ?? "root";
        const nodeId = `node-${block.id}`;

        // Keep scene tree and flat block array in sync after loading arbitrary project payloads.
        if (!findNodeById(newTree, nodeId)) {
          newTree = insertNode(newTree, parentId, {
            id: nodeId,
            type: "block",
            blockId: block.id,
          });
        }
      });

      syncIdCounter(normalizedBlocks);

      return {
        sceneTree: newTree,
        blocks: normalizedBlocks,
        selectedBlockId: null,
        selectedSceneNodeId: null,
      };
    }),

  exportProject: () => {
    const { blocks, sceneTree } = get();
    return JSON.stringify({ blocks, sceneTree }, null, 2);
  },

  importProject: (data: string) => {
    const parsed = JSON.parse(data);
    const rawBlocks: unknown[] = Array.isArray(parsed.blocks) ? parsed.blocks : [];
    const nextBlocks = applyAutoConnectionMasks(
      rawBlocks.map((block) =>
        normalizeBlockInstance(block as BlockInstance)
      )
    );
    syncIdCounter(nextBlocks);

    set({
      blocks: nextBlocks,
      sceneTree: parsed.sceneTree ?? {
        id: "root",
        type: "group",
        name: "Scene",
        children: [],
      },
      selectedBlockId: null,
      selectedSceneNodeId: null,
    });
  },
}));
