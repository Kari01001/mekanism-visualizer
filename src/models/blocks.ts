export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type BlockType = string;

export interface BlockInstance {
  id: string;
  name?: string;
  type: BlockType;
  position: Vec3;
  rotation: {x: number; y: number;   z: number;};
  parentGroupId: string;
}

export interface BlockDefinition {
  id: BlockType;
  displayName: string;
  color: number;
  internal?: boolean;
}
