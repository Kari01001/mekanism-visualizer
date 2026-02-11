import { useBlocksStore } from "../../state/useBlocksStore";
import SceneTreeNode from "./SceneTreeNode";

const SceneTreeView = () => {
  const sceneTree = useBlocksStore((s) => s.sceneTree);

  return (
    <div>
      <SceneTreeNode
        node={sceneTree}
        depth={0}
        isRoot
      />
    </div>
  );
};

export default SceneTreeView;
