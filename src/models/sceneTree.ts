export type SceneTreeNode =
  | SceneGroupNode
  | SceneBlockNode;

export interface SceneGroupNode {
  id: string;
  type: "group";
  name: string;
  children: SceneTreeNode[];
}

export interface SceneBlockNode {
  id: string;
  type: "block";
  blockId: string;
}