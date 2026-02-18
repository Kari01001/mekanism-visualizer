import { useMemo, useRef, type ChangeEvent } from "react";
import { useBlockTypesStore } from "../state/useBlockTypesStore";
import { logError } from "../state/useConsoleStore";

const SOURCE = "BlockTypes";

const BlockTypeManager = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const definitions = useBlockTypesStore((s) => s.definitions);
  const importPackFromString = useBlockTypesStore((s) => s.importPackFromString);
  const exportPackToString = useBlockTypesStore((s) => s.exportPackToString);

  const visibleDefinitions = useMemo(
    () => definitions.filter((definition) => !definition.internal),
    [definitions]
  );

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    try {
      const content = await file.text();
      importPackFromString(content, file.name);
    } catch {
      logError(SOURCE, `Failed to read "${file.name}".`);
    }
  };

  const handleExportClick = () => {
    const content = exportPackToString();
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `block-types-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="block-type-manager">
      <div className="assets-actions">
        <button onClick={handleImportClick}>Import Types</button>
        <button onClick={handleExportClick}>Export Types</button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden-file-input"
        onChange={handleFileChange}
      />

      <div className="assets-count">
        Loaded types: {visibleDefinitions.length}
      </div>

      <div className="block-type-list">
        {visibleDefinitions.map((definition) => (
          <div key={definition.id} className="block-type-row">
            <span
              className="block-type-swatch"
              style={{ backgroundColor: `#${definition.color.toString(16).padStart(6, "0")}` }}
            />
            <div className="block-type-text">
              <div className="block-type-name">{definition.displayName}</div>
              <div className="block-type-id">{definition.id}</div>
            </div>
          </div>
        ))}

        {visibleDefinitions.length === 0 && (
          <div className="assets-empty">No block types available.</div>
        )}
      </div>
    </div>
  );
};

export default BlockTypeManager;
