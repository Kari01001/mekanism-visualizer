const VectorField = ({
  label,
  value,
  step,
  readOnly = false,
  hideNumberArrows = false,
  onChange,
}: {
  label: string;
  value: { x: number; y: number; z: number };
  step: number;
  readOnly?: boolean;
  hideNumberArrows?: boolean;
  onChange?: (axis: "x" | "y" | "z", v: number) => void;
}) => {
  const handleAxisChange = (axis: "x" | "y" | "z", rawValue: string) => {
    if (readOnly || !onChange) return;
    onChange(axis, parseInt(rawValue) || 0);
  };

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
              className={hideNumberArrows ? "no-number-arrows" : undefined}
              value={value[axis]}
              step={step}
              readOnly={readOnly}
              onChange={(e) => handleAxisChange(axis, e.target.value)}
              onBlur={(e) => handleAxisChange(axis, e.target.value)}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default VectorField;
