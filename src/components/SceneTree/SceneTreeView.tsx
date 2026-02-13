import { useBlocksStore } from "../../state/useBlocksStore";
import SceneTreeNode from "./SceneTreeNode";

const SceneTreeView = () => {
  const sceneTree = useBlocksStore((s) => s.sceneTree);

  console.log("TREE:", sceneTree);
  console.log(
    sceneTree.children.map(c => ({
      id: c.id,
      type: c.type
    }))
  );
  return (
    <SceneTreeNode
      node={sceneTree}
      isLast={true}
      ancestorLines={[]}
      isRoot
    />
  );
};

export default SceneTreeView;