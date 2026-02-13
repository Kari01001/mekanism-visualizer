import type { SceneGroupNode } from "./sceneTree";
import type { BlockInstance } from "./blocks";

export interface ProjectData {
  sceneTree: SceneGroupNode;
  blocks: BlockInstance[];
}