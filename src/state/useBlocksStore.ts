import { create } from "zustand";
import type { BlockInstance, BlockType, Vec3 } from "../models/blocks";

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

    return {
      blocks: [
        ...state.blocks,
        {
          id: `block-${idCounter++}`,
          type,
          position,
          rotation: { x: 0, y: 0, z: 0 },
        },
      ],
    };
  }),

  removeBlock: (id) =>
    set((state) => ({
      blocks: state.blocks.filter((b) => b.id !== id),
      selectedBlockId:
        state.selectedBlockId === id ? null : state.selectedBlockId,
    })),
    
  moveBlock: (id, delta) =>
    set((state) => ({
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

  rotateBlockAxis: (id, axis, delta) =>
  set((state) => ({
    blocks: state.blocks.map((b) =>
      b.id === id
        ? {
            ...b,
            rotation: {
              ...b.rotation,
              [axis]:
                ((b.rotation[axis] + delta) % 360 + 360) % 360,
            },
          }
        : b
    ),
  })),

  setBlockRotation: (id, rotation) =>
    set((state) => ({
      blocks: state.blocks.map((b) =>
        b.id === id
          ? { ...b, rotation }
          : b
      ),
    })
  ),

  setGizmoAxis: (axis: "x" | "y" | "z" | null) =>
  set((state) => ({
    gizmo: {
      ...state.gizmo,
      axis,
    },
  })),
  

  selectBlock: (id) => set({ selectedBlockId: id }),

  clearBlocks: () => set({ blocks: [], selectedBlockId: null })
}));
