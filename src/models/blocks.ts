export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type BlockType =
  | "basic_block"
  | "generator_basic"
  | "cable_basic";

export interface BlockInstance {
  id: string;
  type: BlockType;
  position: Vec3;
  rotation: {x: number; y: number;   z: number;};
}

export interface BlockDefinition {
  type: BlockType;
  displayName: string;
  color: number;
}

export const BLOCK_DEFINITIONS: Record<BlockType, BlockDefinition> = {
  basic_block: {
    type: "basic_block",
    displayName: "Basic Block",
    color: 0x2ecc71,
  },
  generator_basic: {
    type: "generator_basic",
    displayName: "Basic Generator",
    color: 0xf1c40f,
  },
  cable_basic: {
    type: "cable_basic",
    displayName: "Basic Cable",
    color: 0x3498db,
  },
};
