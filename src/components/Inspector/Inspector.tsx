import { useBlocksStore } from "../../state/useBlocksStore";
import { useState } from "react";
import VectorField from "./VectorField";

const Collapsible = ({
  title,
  children,
}:{
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
          {open ? "▾" : "▸"}
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
  const block = blocks.find((b) => b.id === selectedBlockId);

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
                onChange={(axis, v) => {
                }}
              />
            </Collapsible>

            <Collapsible title="Rotation">
              <VectorField
                label=""
                value={block.rotation}
                step={90}
                onChange={(axis, v) => {
                }}
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
              <input defaultValue={block.id} />
            </div>

            <div className="field-row">
              <label>Group</label>
              <select>
                <option>Create Group...</option>
                <option>Root</option>
              </select>
            </div>

          </div>
        </div>

      </div>
    </div>
  );

};

export default Inspector;