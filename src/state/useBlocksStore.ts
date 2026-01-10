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
  setMode: (mode: "view" | "edit") => void;
  
  transformMode: "none" | "move";
  setTransformMode: (mode: "none" | "move") => void;
  addBlock: (
    type: BlockType,
    position: Vec3,
    rotationY?: 0 | 90 | 180 | 270
  ) => void;

  removeBlock: (id: string) => void;
  moveBlock: (id: string, delta: {x?: number; y?: number, z?: number}) => void;
  selectBlock: (id: string | null) => void;
  clearBlocks: () => void;
}

let idCounter = 1;

export const useBlocksStore = create<BlocksState>((set) => ({
  blocks: [],
  selectedBlockId: null,
  mode: "edit",
  setMode: (mode) => set({ mode }),

  transformMode: "none",
  setTransformMode: (transformMode) => set({transformMode}),
  
  addBlock: (type, position, rotationY = 0) =>
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
          rotationY,
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

  selectBlock: (id) => set({ selectedBlockId: id }),

  clearBlocks: () => set({ blocks: [], selectedBlockId: null })
}));
