// src/models/blocks.ts

// jednoduchý 3D vektor pro pozici na gridu
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// typy bloků – později sem přidám konkrétní Mekanism stroje
export type BlockType =
  | "basic_block"   // testovací univerzální blok
  | "generator_basic"
  | "cable_basic";

// jedna instance bloku ve světě
export interface BlockInstance {
  id: string;          // unikátní ID (třeba "block-1")
  type: BlockType;
  position: Vec3;      // pozice v prostoru (v “kostičkách”)
  rotationY: 0 | 90 | 180 | 270; // rotace kolem Y, jako v MC
}

// definice typu bloku – jak se má vizuálně renderovat
export interface BlockDefinition {
  type: BlockType;
  displayName: string;
  color: number; // hex barva pro Three.js (0xRRGGBB)
}

// „registr“ všech typů bloků
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
