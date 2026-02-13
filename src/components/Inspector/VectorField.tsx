const VectorField = ({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: { x: number; y: number; z: number };
  step: number;
  onChange: (axis: "x" | "y" | "z", v: number) => void;
}) => {
  return (
    <div className="vector-section">
      <div className="vector-section-title">{label}</div>

      {(["x", "y", "z"] as const).map((axis) => (
        <div key={axis} className="axis-row">
          <span className={`axis-label axis-${axis}`}>
            {axis.toUpperCase()}
          </span>

          <div className="axis-input-wrapper">
            <input
              type="number"
              value={value[axis]}
              step={step}
              onChange={(e) =>
                onChange(axis, parseInt(e.target.value) || 0)
              }
              onBlur={(e) =>
                onChange(axis, parseInt(e.target.value) || 0)
              }
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default VectorField;