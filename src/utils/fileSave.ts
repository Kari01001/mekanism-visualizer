type SaveDialogFilter = {
  name: string;
  extensions: string[];
};

export interface SaveTextFileOptions {
  content: string;
  defaultPath: string;
  title: string;
  filters?: SaveDialogFilter[];
  mimeType?: string;
  preferDialog?: boolean;
}

export interface SaveTextFileResult {
  saved: boolean;
  path: string | null;
  fileName: string | null;
  usedDialog: boolean;
}

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-z]:[\\/]/i;

const downloadTextFile = (fileName: string, content: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

export const isDesktopRuntime = () =>
  typeof window !== "undefined" &&
  typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== "undefined";

export const isAbsoluteFilePath = (value: string | null | undefined) => {
  if (!value) return false;

  const trimmed = value.trim();
  if (!trimmed) return false;

  return (
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\\\") ||
    trimmed.startsWith("file://")
  );
};

export const getFileNameFromPath = (value: string | null | undefined) => {
  if (!value) return null;

  const normalized = value
    .trim()
    .replace(/^file:\/\//i, "")
    .replace(/\\/g, "/");

  if (!normalized) return null;

  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? normalized;
};

export const saveTextFile = async ({
  content,
  defaultPath,
  title,
  filters,
  mimeType = "text/plain;charset=utf-8",
  preferDialog = false,
}: SaveTextFileOptions): Promise<SaveTextFileResult> => {
  const fallbackFileName = getFileNameFromPath(defaultPath) ?? defaultPath;

  if (!isDesktopRuntime()) {
    downloadTextFile(fallbackFileName, content, mimeType);
    return {
      saved: true,
      path: fallbackFileName,
      fileName: fallbackFileName,
      usedDialog: false,
    };
  }

  const [{ save }, { writeTextFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);

  const writeToPath = async (targetPath: string) => {
    await writeTextFile(targetPath, content);
    return {
      saved: true,
      path: targetPath,
      fileName: getFileNameFromPath(targetPath),
      usedDialog: false,
    } satisfies SaveTextFileResult;
  };

  if (!preferDialog && isAbsoluteFilePath(defaultPath)) {
    try {
      return await writeToPath(defaultPath);
    } catch {
      // Path scopes do not persist across restarts, so failed direct writes fall back to Save As.
    }
  }

  const selectedPath = await save({
    title,
    defaultPath,
    filters,
    canCreateDirectories: true,
  });

  if (!selectedPath) {
    return {
      saved: false,
      path: null,
      fileName: null,
      usedDialog: true,
    };
  }

  await writeTextFile(selectedPath, content);

  return {
    saved: true,
    path: selectedPath,
    fileName: getFileNameFromPath(selectedPath),
    usedDialog: true,
  };
};
