import { create } from "zustand";
import type { SceneGroupNode } from "../models/sceneTree";
import type { BlockInstance, BlockType, Vec3 } from "../models/blocks";
import { insertNode, removeNodeById } from "../scene/sceneTreeUtils";

const isSamePosition = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
) => a.x === b.x && a.y === b.y && a.z === b.z;

interface BlocksState {
  blocks: BlockInstance[];
  sceneTree: SceneGroupNode;

  selectedBlockId: string | null;

  mode: "view" | "edit";
  setMode: (mode: "view" | "edit") => void;

  transformMode: "none" | "move" | "rotate";
  setTransformMode: (mode: "none" | "move" | "rotate") => void;

  gizmo: {
    mode: "none" | "move" | "rotate";
    axis: "x" | "y" | "z" | null;
  };
  setGizmoAxis: (axis: "x" | "y" | "z" | null) => void;

  addBlock: (type: BlockType, position: Vec3, parentGroupId?: string) => void;
  removeBlock: (id: string) => void;

  addGroup: (parentGroupId: string, name: string) => void;

  addBlockToGroup: (groupId: string, blockId: string) => void;

  moveBlock: (id: string, delta: { x?: number; y?: number; z?: number }) => void;
  rotateBlockAxis: (id: string, axis: "x" | "y" | "z", delta: 90 | -90) => void;
  setBlockRotation: (id: string, rotation: { x: number; y: number; z: number }) => void;

  loadBlocks: (blocks: BlockInstance[]) => void;
  loadProject: (data: {
    sceneTree: SceneGroupNode;
    blocks: BlockInstance[];
  }) => void;

  selectBlock: (id: string | null) => void;
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
    children: []
  },
  
  selectedBlockId: null,

  mode: "edit",
  setMode: (mode) => set({ mode }),

  transformMode: "none",
  setTransformMode: (transformMode) => set({ transformMode }),

  gizmo: {
    mode: "none",
    axis: null,
  },

  setGizmoAxis: (axis) => set((state) => ({
    gizmo: {
      ...state.gizmo,
      axis,
    },
  })),

  addBlock: (type, position, parentGroupId = "root") => set((state) => {
    const alreadyExists = state.blocks.some((b) =>
      isSamePosition(b.position, position)
    );

    if (alreadyExists) return state;

    const id = `block-${idCounter++}`;

    const newBlock: BlockInstance = {
      id,
      type,
      position,
      rotation: { x: 0, y: 0, z: 0 },
      parentGroupId,
    };

    const newTree = insertNode(state.sceneTree, parentGroupId, {
      id: `node-${id}`,
      type: "block",
      blockId: id,
    });

    return {
      blocks: [...state.blocks, newBlock],
      sceneTree: newTree,
    };
  }),

  removeBlock: (id) => set((state) => ({
    blocks: state.blocks.filter((b) => b.id !== id),
    selectedBlockId:
      state.selectedBlockId === id ? null : state.selectedBlockId,
    sceneTree: removeNodeById(state.sceneTree, `node-${id}`),
  })),

  moveBlock: (id, delta) => set((state) => ({
    blocks: state.blocks.map((b) =>
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
    ),
  })),

  rotateBlockAxis: (id, axis, delta) => set((state) => ({
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

  setBlockRotation: (id, rotation) => set((state) => ({
      blocks: state.blocks.map((b) =>
        b.id === id ? { ...b, rotation } : b
      ),
  })),

  addGroup: (parentGroupId, name) => set((state) => {
    const id = `grp-${crypto.randomUUID()}`;

    const newGroup: SceneGroupNode = {
      id,
      type: "group",
      name,
      children: [],
    };

    return {
      sceneTree: insertNode(state.sceneTree, parentGroupId, newGroup),
    };
  }),

  addBlockToGroup: (groupId, blockId) => set((state) => {
    const cleanedTree = removeNodeById(
      state.sceneTree,
      `node-${blockId}`
    );

    return {
      sceneTree: insertNode(cleanedTree, groupId, {
        id: `node-${blockId}`,
        type: "block",
        blockId,
      }),
      blocks: state.blocks.map((b) =>
        b.id === blockId
          ? { ...b, parentGroupId: groupId }
          : b
      ),
    };
  }),

  selectBlock: (id) => set({ selectedBlockId: id }),

  clearBlocks: () => set({
    blocks: [],
    selectedBlockId: null,
    sceneTree: {
      id: "root",
      type: "group",
      name: "Scene",
      children: [],
    },
  }),

  loadBlocks: (newBlocks) => set(() => {
    let newTree: SceneGroupNode = {
      id: "root",
      type: "group",
      name: "Scene",
      children: []
    };

    newBlocks.forEach((block) => {
      const parentId = block.parentGroupId ?? "root";

      newTree = insertNode(newTree, parentId, {
        id: `node-${block.id}`,
        type: "block",
        blockId: block.id
      });
    });

    return {
      blocks: newBlocks,
      sceneTree: newTree,
      selectedBlockId: null
    };
  }),

  loadProject: (project) => set(() => {
    let newTree = project.sceneTree;

    project.blocks.forEach((block) => {
      const parentId = block.parentGroupId ?? "root";

      newTree = insertNode(newTree, parentId, {
        id: `node-${block.id}`,
        type: "block",
        blockId: block.id,
      });
    });

    return {
      sceneTree: newTree,
      blocks: project.blocks,
      selectedBlockId: null,
    };
  }),

  exportProject: () => {
    const { blocks, sceneTree } = get();
    return JSON.stringify({ blocks, sceneTree }, null, 2);
  },

  importProject: (data: string) => {
    const parsed = JSON.parse(data); set({
      blocks: parsed.blocks ?? [],
      sceneTree: parsed.sceneTree ?? {
        id: "root",
        type: "group",
        name: "Scene",
        children: [],
      },
      selectedBlockId: null,
    });
  },
}));
