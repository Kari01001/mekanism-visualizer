import { useMemo, useState } from "react";
import type { SceneGroupNode, SceneTreeNode } from "../../models/sceneTree";
import { useBlocksStore } from "../../state/useBlocksStore";
import VectorField from "./VectorField";

const collectGroups = (root: SceneGroupNode) => {
  const groups: Array<{ id: string; name: string; depth: number }> = [];

  const visit = (node: SceneTreeNode, depth: number) => {
    if (node.type !== "group") return;
    groups.push({ id: node.id, name: node.name, depth });
    node.children.forEach((child) => visit(child, depth + 1));
  };

  visit(root, 0);
  return groups;
};

const Collapsible = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(true);

  return (
    <div className="inspector-section">
      <div
        className="inspector-section-header"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{title}</span>
        <span className="dropdown-arrow">
          {open ? "v" : ">"}
        </span>
      </div>

      {open && (
        <div className="inspector-section-content">
          {children}
        </div>
      )}
    </div>
  );
};

const Inspector = () => {
  const selectedBlockId = useBlocksStore((s) => s.selectedBlockId);
  const blocks = useBlocksStore((s) => s.blocks);
  const sceneTree = useBlocksStore((s) => s.sceneTree);
  const setBlockPosition = useBlocksStore((s) => s.setBlockPosition);
  const renameBlock = useBlocksStore((s) => s.renameBlock);
  const addBlockToGroup = useBlocksStore((s) => s.addBlockToGroup);

  const block = blocks.find((b) => b.id === selectedBlockId);
  const groupOptions = useMemo(() => collectGroups(sceneTree), [sceneTree]);

  if (!block) {
    return (
      <div className="inspector">
        <div className="inspector-header">Inspector</div>
        <div className="inspector-section-content">
          No selection
        </div>
      </div>
    );
  }

  return (
    <div className="inspector">
      <div className="inspector-header">Inspector</div>

      <div className="inspector-body">
        <div className="inspector-section">
          <div className="inspector-section-header">
            Transform
          </div>

          <div className="inspector-section-content">
            <Collapsible title="Position">
              <VectorField
                label=""
                value={block.position}
                step={1}
                onChange={(axis, value) => {
                  setBlockPosition(block.id, {
                    ...block.position,
                    [axis]: value,
                  });
                }}
              />
            </Collapsible>

            <Collapsible title="Rotation">
              <VectorField
                label=""
                value={block.rotation}
                step={90}
                readOnly
                hideNumberArrows
              />
            </Collapsible>
          </div>
        </div>

        <div className="inspector-section">
          <div className="inspector-section-header">
            Object
          </div>

          <div className="inspector-section-content">
            <div className="field-row">
              <label>Name</label>
              <input
                value={block.name ?? block.id}
                onChange={(event) => renameBlock(block.id, event.target.value)}
              />
            </div>

            <div className="field-row">
              <label>Group</label>
              <select
                value={block.parentGroupId}
                onChange={(event) =>
                  addBlockToGroup(event.target.value, block.id)
                }
              >
                {groupOptions.map((group) => (
                  <option key={group.id} value={group.id}>
                    {"  ".repeat(group.depth)}
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Inspector;
