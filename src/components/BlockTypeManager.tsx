import { useMemo, useRef, type ChangeEvent } from "react";
import { useBlockTypesStore } from "../state/useBlockTypesStore";
import { logError, logInfo, logWarn } from "../state/useConsoleStore";

const SOURCE = "BlockTypes";
type ImportKind = "json" | "png" | "jar" | "unknown";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const hasPrefix = (bytes: Uint8Array, prefix: readonly number[]) =>
  bytes.length >= prefix.length &&
  prefix.every((value, index) => bytes[index] === value);

const isZipSignature = (bytes: Uint8Array) =>
  hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
  hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
  hasPrefix(bytes, [0x50, 0x4b, 0x07, 0x08]);

const getFileExtension = (name: string) => {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot + 1).toLowerCase();
};

const looksLikeJson = (bytes: Uint8Array) => {
  for (const byte of bytes) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      continue;
    }

    return byte === 0x7b || byte === 0x5b; // { or [
  }

  return false;
};

const detectImportKind = async (file: File): Promise<ImportKind> => {
  const extension = getFileExtension(file.name);

  if (extension === "json") return "json";
  if (extension === "png") return "png";
  if (extension === "jar" || extension === "zip") return "jar";

  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (hasPrefix(header, PNG_SIGNATURE)) return "png";
  if (isZipSignature(header)) return "jar";
  if (looksLikeJson(header)) return "json";

  return "unknown";
};

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

    const kind = await detectImportKind(file);

    try {
      if (kind === "json") {
        const content = await file.text();
        importPackFromString(content, file.name);
        return;
      }

      if (kind === "png") {
        logInfo(
          SOURCE,
          `Detected PNG texture "${file.name}". PNG texture import pipeline is next step.`
        );
        return;
      }

      if (kind === "jar") {
        logInfo(
          SOURCE,
          `Detected archive "${file.name}" (jar/zip). Archive texture import pipeline is next step.`
        );
        return;
      }

      logWarn(
        SOURCE,
        `Unsupported import file "${file.name}". Use JSON, PNG or JAR/ZIP.`
      );
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
        accept=".json,application/json,.png,image/png,.jar,.zip,application/java-archive,application/zip"
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
