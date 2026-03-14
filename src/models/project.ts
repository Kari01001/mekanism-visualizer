import type { SceneGroupNode } from "./sceneTree";
import type { BlockDefinition, BlockInstance } from "./blocks";

export interface ProjectMeta {
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectData {
  // Optional for backward compatibility with older project files.
  meta?: ProjectMeta;
  sceneTree: SceneGroupNode;
  blocks: BlockInstance[];
  // Optional embedded block types used to reproduce custom assets on load.
  embeddedBlockTypes?: BlockDefinition[];
}
