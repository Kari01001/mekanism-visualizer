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
  selectedBlockId: string | null;

  mode: "view" | "edit";

  gizmo: {
    mode: "none" | "move" | "rotate";
    axis: "x" | "y" | "z" | null;
  };
  setGizmoAxis: (axis: "x" | "y" | "z" | null) => void;

  setMode: (mode: "view" | "edit") => void;
  
  transformMode: "none" | "move" | "rotate";
  setTransformMode: (mode: "none" | "move" | "rotate") => void;
  addBlock: (type: BlockType, position: Vec3) => void;

  sceneTree: SceneGroupNode;

  addGroup: (parentGroupId: string, name: string) => void;
  removeNode: (nodeId: string) => void;

  addBlockToGroup: (groupId: string, blockId: string) => void;
  moveNode: (
    nodeId: string,
    targetGroupId: string,
    index?: number
  ) => void;


  removeBlock: (id: string) => void;
  moveBlock: (id: string, delta: {x?: number; y?: number, z?: number}) => void;
  rotateBlockAxis: (id: string, axis: "x" | "y" | "z", delta: 90 | -90) => void;

  setBlockRotation: (id: string, rotation: { x: number; y: number; z: number }) => void;

  selectBlock: (id: string | null) => void;
  clearBlocks: () => void;
}

let idCounter = 1;

export const useBlocksStore = create<BlocksState>((set) => ({
  blocks: [],
  selectedBlockId: null,
  mode: "edit",

  gizmo: {
    mode: "none",
    axis: null,
  },
  /*
  sceneTree: {
  id: "root",
  type: "group",
  name: "Scene",
  children: []
  },
  */
  sceneTree: {
    id: "root",
    type: "group",
    name: "Scene",
    children: [
      {
        id: "grp-a",
        type: "group",
        name: "Group A",
        children: [
          {
            id: "grp-a-1",
            type: "group",
            name: "Nested A1",
            children: [
              { id: "n-a1-b1", type: "block", blockId: "block-1" },
              { id: "n-a1-b2", type: "block", blockId: "block-2" },
            ],
          },
          { id: "n-a-b3", type: "block", blockId: "block-3" },
        ],
      },
      {
        id: "grp-b",
        type: "group",
        name: "Group B",
        children: [
          { id: "n-b-b4", type: "block", blockId: "block-4" },
          { id: "n-b-b5", type: "block", blockId: "block-5" },
        ],
      },
      { id: "n-root-b6", type: "block", blockId: "block-6" },
    ],
  },
  
  setMode: (mode) => set({ mode }),

  transformMode: "none",
  setTransformMode: (transformMode) => set({transformMode}),

  addBlock: (type, position) =>
  set((state) => {
    const alreadyExists = state.blocks.some((b) =>
      isSamePosition(b.position, position)
    );

    if (alreadyExists) {
      console.warn(
        `Block already exists at (${position.x}, ${position.y}, ${position.z})`
      );
      return state;
    }

    const id = `block-${idCounter++}`;

    return {
      blocks: [
        ...state.blocks,
        {
          id,
          type,
          position,
          rotation: { x: 0, y: 0, z: 0 },
        },
      ],
    };
  }),
  
  addGroup: (parentGroupId, name) => set((state) => {
    console.warn("addGroup not implemented yet", parentGroupId, name);
    return state;
  }),

  removeNode: (nodeId) => set((state) => {
    console.warn("removeNode not implemented yet", nodeId);
    return state;
  }),

  addBlockToGroup: (groupId, blockId) => set((state) => {
    const cleanedTree = removeNodeById(
      state.sceneTree,
      `node-${blockId}`
    );

    return {
      sceneTree: insertNode(
        cleanedTree,
        groupId,
        {
          id: `node-${blockId}`,
          type: "block",
          blockId,
        }
      ),
    };
  }),

  moveNode: (nodeId, targetGroupId, index) => set((state) => {
    console.warn("moveNode not implemented yet", nodeId, targetGroupId, index);
    return state;
  }),  

  removeBlock: (id) => set((state) => ({
    blocks: state.blocks.filter((b) => b.id !== id),
    selectedBlockId:
      state.selectedBlockId === id ? null : state.selectedBlockId,
  })),
    
  moveBlock: (id, delta) => set((state) => ({
    blocks: state.blocks.map((b) =>
      b.id === id ? {
        ...b,
        position: {
          x: b.position.x + (delta.x ?? 0),
          y: b.position.y + (delta.y ?? 0),
          z: b.position.z + (delta.z ?? 0),
        },
      } : b
    ),
  })),

  rotateBlockAxis: (id, axis, delta) => set((state) => ({
    blocks: state.blocks.map((b) =>
      b.id === id ? {
        ...b,
        rotation: {
          ...b.rotation,
          [axis]:
            ((b.rotation[axis] + delta) % 360 + 360) % 360,
        },
      } : b
    ),
  })),

  setBlockRotation: (id, rotation) => set((state) => ({
    blocks: state.blocks.map((b) =>
      b.id === id
        ? { ...b, rotation }
        : b
    ),
  })),

  setGizmoAxis: (axis: "x" | "y" | "z" | null) => set((state) => ({
    gizmo: {
      ...state.gizmo,
      axis,
    },
  })),
  

  selectBlock: (id) => set({ selectedBlockId: id }),

  clearBlocks: () => set({ blocks: [], selectedBlockId: null })
}));
