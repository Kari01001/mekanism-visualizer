export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type BlockType = string;

// Keep this order stable because multiple systems map face index -> material slot.
export const BLOCK_FACES = ["right", "left", "top", "bottom", "front", "back"] as const;
export type BlockFace = (typeof BLOCK_FACES)[number];
export type BlockRenderMode = "cube" | "conduit";
export type BlockConnectionMode = "auto" | "manual";

export type BlockConnectionMask = Record<BlockFace, boolean>;

export interface BlockConnections {
  // Auto mode is computed from neighbors, manual mode respects explicit mask values.
  mode: BlockConnectionMode;
  mask: BlockConnectionMask;
}

export const createConnectionMask = (): BlockConnectionMask => ({
  right: false,
  left: false,
  top: false,
  bottom: false,
  front: false,
  back: false,
});

export interface BlockTextureMap {
  // `all` acts as a face fallback when a specific face texture is missing.
  all?: string;
  right?: string;
  left?: string;
  top?: string;
  bottom?: string;
  front?: string;
  back?: string;
}

export interface ConduitTextureProfile {
  // Fine-grained texture slots used by conduit core/arm/cap sub-meshes.
  coreSide?: string;
  coreTop?: string;
  coreBottom?: string;
  armSide?: string;
  armSideHorizontal?: string;
  armSideVertical?: string;
  armCapOpen?: string;
  armCapConnected?: string;
}

export interface BlockInstance {
  id: string;
  name?: string;
  type: BlockType;
  position: Vec3;
  // Stored in degrees for editor-friendly manipulation and JSON readability.
  rotation: { x: number; y: number; z: number };
  parentGroupId: string;
  connections?: BlockConnections;
}

export interface BlockDefinition {
  id: BlockType;
  displayName: string;
  color: number;
  textures?: BlockTextureMap;
  textureProfile?: ConduitTextureProfile;
  scale?: Vec3;
  renderMode?: BlockRenderMode;
  connectTag?: string;
  group?: string;
  internal?: boolean;
}
