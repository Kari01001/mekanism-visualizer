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

export function findNodeById(
  node: SceneTreeNode,
  id: string
): SceneTreeNode | null {
  if (node.id === id) return node;

  if (node.type === "group") {
    for (const child of node.children) {
      const found = findNodeById(child, id);
      if (found) return found;
    }
  }
  
  return null;
}

export function insertNode(
  root: SceneGroupNode,
  targetGroupId: string,
  nodeToInsert: SceneTreeNode,
  index?: number
): SceneGroupNode {
  if (root.id === targetGroupId) {
    const children = [...root.children];
    if (index === undefined) {
      children.push(nodeToInsert);
    } else {
      children.splice(index, 0, nodeToInsert);
    }

    return { ...root, children };
  }

  return {
    ...root,
    children: root.children.map((child) =>
      child.type === "group"
        ? insertNode(child, targetGroupId, nodeToInsert, index)
        : child
    ),
  };
}

export function removeNodeById(
  root: SceneGroupNode,
  nodeId: string
): SceneGroupNode {
  return {
    ...root,
    children: root.children
      .filter((c) => c.id !== nodeId)
      .map((c) =>
        c.type === "group" ? removeNodeById(c, nodeId) : c
      ),
  };
}

export function renameGroupById(
  root: SceneGroupNode,
  groupId: string,
  name: string
): SceneGroupNode {
  if (root.id === groupId) {
    return { ...root, name };
  }

  return {
    ...root,
    children: root.children.map((child) =>
      child.type === "group"
        ? renameGroupById(child, groupId, name)
        : child
    ),
  };
}

export function collectBlockIds(node: SceneTreeNode): Set<string> {
  if (node.type === "block") {
    return new Set([node.blockId]);
  }

  const ids = new Set<string>();

  node.children.forEach((child) => {
    collectBlockIds(child).forEach((id) => ids.add(id));
  });

  return ids;
}

export function findParentGroupId(
  root: SceneGroupNode,
  nodeId: string
): string | null {
  for (const child of root.children) {
    if (child.id === nodeId) {
      return root.id;
    }

    if (child.type === "group") {
      const found = findParentGroupId(child, nodeId);
      if (found) return found;
    }
  }

  return null;
}
