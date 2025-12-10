import { create } from "zustand";
import type { BlockInstance, BlockType, Vec3 } from "../models/blocks";

interface BlocksState {
  blocks: BlockInstance[];

  addBlock: (
    type: BlockType,
    position: Vec3,
    rotationY?: 0 | 90 | 180 | 270
  ) => void;

  clearBlocks: () => void;
}

let idCounter = 1;

export const useBlocksStore = create<BlocksState>((set) => ({
  blocks: [],

  // přidání bloku do světa
  addBlock: (type, position, rotationY = 0) =>
    set((state) => ({
      blocks: [
        ...state.blocks,
        {
          id: `block-${idCounter++}`,
          type,
          position,
          rotationY,
        },
      ],
    })),

  // smazání všech bloků (hodí se pro reset scény)
  clearBlocks: () => set({ blocks: [] }),
}));