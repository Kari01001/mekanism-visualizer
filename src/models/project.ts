import type { SceneGroupNode } from "./sceneTree";
import type { BlockDefinition, BlockInstance } from "./blocks";

export interface ProjectMeta {
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectData {
  meta?: ProjectMeta;
  sceneTree: SceneGroupNode;
  blocks: BlockInstance[];
  embeddedBlockTypes?: BlockDefinition[];
}
