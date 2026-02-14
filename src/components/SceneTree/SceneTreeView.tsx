import { useBlocksStore } from "../../state/useBlocksStore";
import { useState, useEffect, useRef } from "react";
import SceneTreeNode from "./SceneTreeNode";

const SceneTreeView = () => {
  const sceneTree = useBlocksStore((s) => s.sceneTree);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    targetId: string;
    type: "group" | "object";
  } | null>(null);
 
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!menuRef.current) return;

      if (!menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);

    return () =>
      window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <>
      <SceneTreeNode
        node={sceneTree}
        isLast={true}
        ancestorLines={[]}
        isRoot
        openContextMenu={setContextMenu}
      />

      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
          }}
        >
          <div>Create Group</div>
          <div>Add Object</div>
          <div>Rename</div>
          <div>Delete</div>
        </div>
      )}
    </>
  );
};

export default SceneTreeView;