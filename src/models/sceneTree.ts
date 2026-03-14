// Discriminated union for recursive tree traversal and UI rendering.
export type SceneTreeNode = SceneGroupNode | SceneBlockNode;

export interface SceneGroupNode {
  id: string;
  type: "group";
  name: string;
  // Groups may contain both nested groups and block references.
  children: SceneTreeNode[];
}

export interface SceneBlockNode {
  id: string;
  type: "block";
  // References a concrete block instance from the blocks array/store.
  blockId: string;
}
