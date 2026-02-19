import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { SceneGroupNode } from "./models/sceneTree";
import initScene, { type SceneAPI } from "./three/initScene";
import defaultProject from "./data/defaultProject.json";
import BlockTypeManager from "./components/BlockTypeManager";
import ConsolePanel from "./components/ConsolePanel";
import Inspector from "./components/Inspector/Inspector";
import SceneTreeView from "./components/SceneTree/SceneTreeView";
import {
  DEFAULT_PROJECT_NAME,
  buildProjectPayload,
  createEmptyProject,
  createProjectSnapshot,
  ensureJsonExtension,
  getProjectNameFromFileName,
  normalizeProjectData,
} from "./project/projectUtils";
import { useBlockTypesStore } from "./state/useBlockTypesStore";
import { logError, logInfo, logWarn } from "./state/useConsoleStore";
import { useBlocksStore } from "./state/useBlocksStore";
import { useProjectStore } from "./state/useProjectStore";
import { usePanelLayout } from "./utils/usePanelLayout";

const FILE_SOURCE = "FileMenu";
const EDIT_SOURCE = "EditMenu";

const sanitizeFileStem = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "project";

  return trimmed
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
};

const downloadJson = (fileName: string, content: string) => {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const toPositionKey = (position: { x: number; y: number; z: number }) =>
  `${position.x}:${position.y}:${position.z}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const countGroups = (root: SceneGroupNode): number => {
  let total = 1;

  root.children.forEach((child) => {
    if (child.type === "group") {
      total += countGroups(child);
    }
  });

  return total;
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
};

const App = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneAPI | null>(null);
  const renderedIdsRef = useRef<Set<string>>(new Set());
  const openFileInputRef = useRef<HTMLInputElement | null>(null);
  const didBootstrapRef = useRef(false);
  const historyRef = useRef<{
    past: string[];
    present: string | null;
    future: string[];
    initialized: boolean;
    applying: boolean;
  }>({
    past: [],
    present: null,
    future: [],
    initialized: false,
    applying: false,
  });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [activeCenterTab, setActiveCenterTab] = useState<"scene" | "preview">("scene");
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const blocks = useBlocksStore((s) => s.blocks);
  const sceneTree = useBlocksStore((s) => s.sceneTree);
  const selectedBlockId = useBlocksStore((s) => s.selectedBlockId);
  const selectBlock = useBlocksStore((s) => s.selectBlock);
  const loadProject = useBlocksStore((s) => s.loadProject);
  const addBlock = useBlocksStore((s) => s.addBlock);
  const removeBlock = useBlocksStore((s) => s.removeBlock);

  const mode = useBlocksStore((s) => s.mode);
  const transformMode = useBlocksStore((s) => s.transformMode);
  const setMode = useBlocksStore((s) => s.setMode);
  const setTransformMode = useBlocksStore((s) => s.setTransformMode);

  const initializeBuiltInTypes = useBlockTypesStore((s) => s.initializeBuiltInTypes);
  const importBlockTypePack = useBlockTypesStore((s) => s.importPackFromString);
  const blockTypeDefinitions = useBlockTypesStore((s) => s.definitions);

  const projectMeta = useProjectStore((s) => s.meta);
  const projectFileName = useProjectStore((s) => s.fileName);
  const dirty = useProjectStore((s) => s.dirty);
  const setLoadedProject = useProjectStore((s) => s.setLoadedProject);
  const markSaved = useProjectStore((s) => s.markSaved);
  const markDirtyFromSnapshot = useProjectStore((s) => s.markDirtyFromSnapshot);
  const setProjectName = useProjectStore((s) => s.setProjectName);

  const {
    leftWidth,
    rightWidth,
    consoleHeight,
    sceneHeight,
    startLeftResize,
    startRightResize,
    startConsoleResize,
    startSceneResize,
  } = usePanelLayout();

  const visibleBlockTypes = useMemo(
    () => blockTypeDefinitions.filter((definition) => !definition.internal),
    [blockTypeDefinitions]
  );

  const selectedBlock = useMemo(
    () => blocks.find((block) => block.id === selectedBlockId) ?? null,
    [blocks, selectedBlockId]
  );

  const currentSnapshot = useMemo(
    () =>
      createProjectSnapshot({
        projectName: projectMeta.name,
        sceneTree,
        blocks,
        embeddedBlockTypes: visibleBlockTypes,
      }),
    [projectMeta.name, sceneTree, blocks, visibleBlockTypes]
  );

  const historySnapshot = useMemo(
    () =>
      JSON.stringify({
        projectName: projectMeta.name,
        sceneTree,
        blocks,
      }),
    [projectMeta.name, sceneTree, blocks]
  );

  const updateHistoryFlags = useCallback(() => {
    const history = historyRef.current;
    setCanUndo(history.past.length > 0);
    setCanRedo(history.future.length > 0);
  }, []);

  const resetHistory = useCallback(
    (snapshot: string) => {
      historyRef.current = {
        past: [],
        present: snapshot,
        future: [],
        initialized: true,
        applying: false,
      };
      updateHistoryFlags();
    },
    [updateHistoryFlags]
  );

  const applyHistorySnapshot = useCallback(
    (snapshot: string) => {
      try {
        const parsed = JSON.parse(snapshot) as unknown;
        if (!isRecord(parsed)) {
          throw new Error("Invalid history snapshot root.");
        }

        const projectName = parsed.projectName;
        const nextSceneTree = parsed.sceneTree;
        const nextBlocks = parsed.blocks;

        if (typeof projectName !== "string" || !isRecord(nextSceneTree) || !Array.isArray(nextBlocks)) {
          throw new Error("History snapshot has invalid shape.");
        }

        loadProject({
          sceneTree: nextSceneTree as SceneGroupNode,
          blocks: nextBlocks,
        });
        setProjectName(projectName);
        selectBlock(null);
      } catch {
        logError(EDIT_SOURCE, "Failed to apply undo/redo snapshot.");
      }
    },
    [loadProject, selectBlock, setProjectName]
  );

  useEffect(() => {
    markDirtyFromSnapshot(currentSnapshot);
  }, [currentSnapshot, markDirtyFromSnapshot]);

  useEffect(() => {
    const history = historyRef.current;

    if (!history.initialized) {
      history.initialized = true;
      history.present = historySnapshot;
      history.future = [];
      history.past = [];
      updateHistoryFlags();
      return;
    }

    if (history.applying) {
      history.present = historySnapshot;
      history.applying = false;
      updateHistoryFlags();
      return;
    }

    if (history.present === historySnapshot) return;

    if (history.present !== null) {
      history.past.push(history.present);
    }

    history.present = historySnapshot;
    history.future = [];
    updateHistoryFlags();
  }, [historySnapshot, updateHistoryFlags]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (didBootstrapRef.current) return;
    didBootstrapRef.current = true;

    initializeBuiltInTypes();

    const normalized = normalizeProjectData(defaultProject, "Default Project");
    if (!normalized.ok) {
      logError(FILE_SOURCE, `Failed to load default project: ${normalized.error}`);
      return;
    }

    loadProject({
      sceneTree: normalized.project.sceneTree,
      blocks: normalized.project.blocks,
    });

    selectBlock(null);

    const embeddedForSnapshot = useBlockTypesStore
      .getState()
      .definitions
      .filter((definition) => !definition.internal);

    const snapshot = createProjectSnapshot({
      projectName: normalized.project.meta.name,
      sceneTree: normalized.project.sceneTree,
      blocks: normalized.project.blocks,
      embeddedBlockTypes: embeddedForSnapshot,
    });

    setLoadedProject(normalized.project.meta, "default-project.json", snapshot);
    resetHistory(
      JSON.stringify({
        projectName: normalized.project.meta.name,
        sceneTree: normalized.project.sceneTree,
        blocks: normalized.project.blocks,
      })
    );
    logInfo(FILE_SOURCE, `Loaded default project "${normalized.project.meta.name}".`);
  }, [initializeBuiltInTypes, loadProject, resetHistory, selectBlock, setLoadedProject]);

  useEffect(() => {
    if (!mountRef.current) return;
    const renderedIds = renderedIdsRef.current;

    const api = initScene(
      mountRef.current,
      [],
      (id) => selectBlock(id)
    );

    sceneRef.current = api;

    return () => {
      api.cleanup();
      sceneRef.current = null;
      renderedIds.clear();
    };
  }, [selectBlock]);

  useEffect(() => {
    if (!sceneRef.current) return;

    const api = sceneRef.current;
    const renderedIds = renderedIdsRef.current;
    const currentIds = new Set(blocks.map((block) => block.id));

    renderedIds.forEach((id) => {
      if (!currentIds.has(id)) {
        api.removeBlock(id);
        renderedIds.delete(id);
      }
    });

    blocks.forEach((block) => {
      if (!renderedIds.has(block.id)) {
        api.addBlock(block);
        renderedIds.add(block.id);
      } else {
        api.updateBlock(block);
      }
    });
  }, [blocks]);

  useEffect(() => {
    sceneRef.current?.setSelectedBlock(selectedBlockId);
  }, [selectedBlockId]);

  const capturePreview = useCallback(() => {
    const canvas = mountRef.current?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!canvas) {
      setPreviewImage(null);
      return;
    }

    try {
      const image = canvas.toDataURL("image/png");
      setPreviewImage(image);
    } catch {
      logWarn(FILE_SOURCE, "Failed to capture preview snapshot.");
      setPreviewImage(null);
    }
  }, []);

  useEffect(() => {
    if (activeCenterTab !== "preview") return;
    capturePreview();
  }, [activeCenterTab, blocks, selectedBlockId, capturePreview]);

  const confirmDiscardUnsaved = useCallback(() => {
    if (!dirty) return true;
    return window.confirm("You have unsaved changes. Continue anyway?");
  }, [dirty]);

  const saveProjectToDownload = useCallback(
    (targetFileName: string, markAsSaved: boolean) => {
      const now = new Date().toISOString();
      const nextMeta = {
        ...projectMeta,
        updatedAt: now,
      };

      const payload = buildProjectPayload({
        meta: nextMeta,
        sceneTree,
        blocks,
        embeddedBlockTypes: visibleBlockTypes,
      });

      const serialized = JSON.stringify(payload, null, 2);
      downloadJson(targetFileName, serialized);

      if (markAsSaved) {
        const snapshot = createProjectSnapshot({
          projectName: nextMeta.name,
          sceneTree,
          blocks,
          embeddedBlockTypes: visibleBlockTypes,
        });

        markSaved(nextMeta, targetFileName, snapshot);
        logInfo(FILE_SOURCE, `Saved project to "${targetFileName}".`);
      } else {
        logInfo(FILE_SOURCE, `Exported project to "${targetFileName}".`);
      }
    },
    [projectMeta, sceneTree, blocks, visibleBlockTypes, markSaved]
  );

  const handleNewProject = useCallback(() => {
    if (!confirmDiscardUnsaved()) return;

    const empty = createEmptyProject(DEFAULT_PROJECT_NAME);
    loadProject({
      sceneTree: empty.sceneTree,
      blocks: empty.blocks,
    });
    selectBlock(null);

    const snapshot = createProjectSnapshot({
      projectName: empty.meta.name,
      sceneTree: empty.sceneTree,
      blocks: empty.blocks,
      embeddedBlockTypes: visibleBlockTypes,
    });

    setLoadedProject(empty.meta, null, snapshot);
    resetHistory(
      JSON.stringify({
        projectName: empty.meta.name,
        sceneTree: empty.sceneTree,
        blocks: empty.blocks,
      })
    );
    logInfo(FILE_SOURCE, `Created new project "${empty.meta.name}".`);
  }, [confirmDiscardUnsaved, loadProject, resetHistory, selectBlock, setLoadedProject, visibleBlockTypes]);

  const handleOpenRequest = useCallback(() => {
    if (!confirmDiscardUnsaved()) return;
    openFileInputRef.current?.click();
  }, [confirmDiscardUnsaved]);

  const handleOpenFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        const fallbackName = getProjectNameFromFileName(file.name);
        const normalized = normalizeProjectData(parsed, fallbackName);

        if (!normalized.ok) {
          logError(FILE_SOURCE, `Failed to open "${file.name}": ${normalized.error}`);
          return;
        }

        normalized.warnings.forEach((warning) => {
          logWarn(FILE_SOURCE, warning);
        });

        if (normalized.project.embeddedBlockTypes.length > 0) {
          importBlockTypePack(
            JSON.stringify({ blockTypes: normalized.project.embeddedBlockTypes }),
            `${file.name} (embedded block types)`
          );
        }

        loadProject({
          sceneTree: normalized.project.sceneTree,
          blocks: normalized.project.blocks,
        });
        selectBlock(null);

        const embeddedForSnapshot = useBlockTypesStore
          .getState()
          .definitions
          .filter((definition) => !definition.internal);

        const snapshot = createProjectSnapshot({
          projectName: normalized.project.meta.name,
          sceneTree: normalized.project.sceneTree,
          blocks: normalized.project.blocks,
          embeddedBlockTypes: embeddedForSnapshot,
        });

        setLoadedProject(normalized.project.meta, file.name, snapshot);
        resetHistory(
          JSON.stringify({
            projectName: normalized.project.meta.name,
            sceneTree: normalized.project.sceneTree,
            blocks: normalized.project.blocks,
          })
        );
        logInfo(FILE_SOURCE, `Opened project "${normalized.project.meta.name}" from "${file.name}".`);
      } catch {
        logError(FILE_SOURCE, `Failed to parse "${file.name}" as JSON.`);
      }
    },
    [importBlockTypePack, loadProject, resetHistory, selectBlock, setLoadedProject]
  );

  const defaultSaveFileName = useMemo(() => {
    if (projectFileName) return ensureJsonExtension(projectFileName);
    return ensureJsonExtension(`${sanitizeFileStem(projectMeta.name)}.json`);
  }, [projectFileName, projectMeta.name]);

  const handleSaveAs = useCallback(() => {
    const promptValue = window.prompt("Save project as:", defaultSaveFileName);
    if (!promptValue) return;

    const targetFileName = ensureJsonExtension(promptValue);
    saveProjectToDownload(targetFileName, true);
  }, [defaultSaveFileName, saveProjectToDownload]);

  const handleSave = useCallback(() => {
    if (projectFileName) {
      saveProjectToDownload(ensureJsonExtension(projectFileName), true);
      return;
    }

    handleSaveAs();
  }, [handleSaveAs, projectFileName, saveProjectToDownload]);

  const handleExport = useCallback(() => {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const targetFileName = ensureJsonExtension(
      `${sanitizeFileStem(projectMeta.name)}-export-${timestamp}.json`
    );
    saveProjectToDownload(targetFileName, false);
  }, [projectMeta.name, saveProjectToDownload]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedBlock) {
      logWarn(EDIT_SOURCE, "Delete selected requested without an active object selection.");
      return;
    }

    removeBlock(selectedBlock.id);
    selectBlock(null);
    logInfo(EDIT_SOURCE, `Deleted object "${selectedBlock.name ?? selectedBlock.id}".`);
  }, [removeBlock, selectBlock, selectedBlock]);

  const handleDuplicateSelected = useCallback(() => {
    if (!selectedBlock) {
      logWarn(EDIT_SOURCE, "Duplicate selected requested without an active object selection.");
      return;
    }

    const occupied = new Set(blocks.map((block) => toPositionKey(block.position)));
    let deltaX = 1;
    let position = {
      x: selectedBlock.position.x + deltaX,
      y: selectedBlock.position.y,
      z: selectedBlock.position.z,
    };

    while (occupied.has(toPositionKey(position)) && deltaX < 256) {
      deltaX += 1;
      position = {
        x: selectedBlock.position.x + deltaX,
        y: selectedBlock.position.y,
        z: selectedBlock.position.z,
      };
    }

    const createdId = addBlock(
      selectedBlock.type,
      position,
      selectedBlock.parentGroupId,
      selectedBlock.name ? `${selectedBlock.name} Copy` : undefined
    );

    if (!createdId) {
      logWarn(EDIT_SOURCE, "Duplicate selected failed because no free position was found.");
      return;
    }

    selectBlock(createdId);
    logInfo(EDIT_SOURCE, `Duplicated object "${selectedBlock.name ?? selectedBlock.id}".`);
  }, [addBlock, blocks, selectBlock, selectedBlock]);

  const handleUndo = useCallback(() => {
    const history = historyRef.current;

    if (history.past.length === 0 || history.present === null) {
      logWarn(EDIT_SOURCE, "Nothing to undo.");
      return;
    }

    const targetSnapshot = history.past.pop()!;
    history.future.push(history.present);
    history.present = targetSnapshot;
    history.applying = true;
    updateHistoryFlags();

    applyHistorySnapshot(targetSnapshot);
    logInfo(EDIT_SOURCE, "Undo applied.");
  }, [applyHistorySnapshot, updateHistoryFlags]);

  const handleRedo = useCallback(() => {
    const history = historyRef.current;

    if (history.future.length === 0 || history.present === null) {
      logWarn(EDIT_SOURCE, "Nothing to redo.");
      return;
    }

    const targetSnapshot = history.future.pop()!;
    history.past.push(history.present);
    history.present = targetSnapshot;
    history.applying = true;
    updateHistoryFlags();

    applyHistorySnapshot(targetSnapshot);
    logInfo(EDIT_SOURCE, "Redo applied.");
  }, [applyHistorySnapshot, updateHistoryFlags]);

  useEffect(() => {
    const handleShortcuts = (event: KeyboardEvent) => {
      const ctrlOrMeta = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const typingTarget = isEditableTarget(event.target);

      if (ctrlOrMeta && key === "s") {
        event.preventDefault();
        if (event.shiftKey) {
          handleSaveAs();
        } else {
          handleSave();
        }
        return;
      }

      if (ctrlOrMeta && key === "o") {
        event.preventDefault();
        handleOpenRequest();
        return;
      }

      if (ctrlOrMeta && key === "n") {
        event.preventDefault();
        handleNewProject();
        return;
      }

      if (ctrlOrMeta && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      if (ctrlOrMeta && key === "y") {
        event.preventDefault();
        handleRedo();
        return;
      }

      if (typingTarget) return;

      if (ctrlOrMeta && key === "d") {
        event.preventDefault();
        if (selectedBlock) {
          handleDuplicateSelected();
        }
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selectedBlock) {
        event.preventDefault();
        handleDeleteSelected();
      }
    };

    window.addEventListener("keydown", handleShortcuts);
    return () => window.removeEventListener("keydown", handleShortcuts);
  }, [
    handleDeleteSelected,
    handleDuplicateSelected,
    handleNewProject,
    handleOpenRequest,
    handleRedo,
    handleSave,
    handleSaveAs,
    handleUndo,
    selectedBlock,
  ]);

  return (
    <div className="layout-root">
      <div className="topbar">
        <div className="menu">
          <div className="menu-item">
            File
            <div className="dropdown">
              <button className="dropdown-action" onClick={handleNewProject}>
                New Project
              </button>
              <button className="dropdown-action" onClick={handleOpenRequest}>
                Open...
              </button>
              <button className="dropdown-action" onClick={handleSave}>
                Save
              </button>
              <button className="dropdown-action" onClick={handleSaveAs}>
                Save As...
              </button>
              <button className="dropdown-action" onClick={handleExport}>
                Export Snapshot
              </button>
            </div>
          </div>
          <div className="menu-item">
            Edit
            <div className="dropdown">
              <button className="dropdown-action" onClick={handleUndo} disabled={!canUndo}>
                Undo
              </button>
              <button className="dropdown-action" onClick={handleRedo} disabled={!canRedo}>
                Redo
              </button>
              <div className="dropdown-separator" />
              <button
                className="dropdown-action"
                onClick={handleDuplicateSelected}
                disabled={!selectedBlock}
              >
                Duplicate Selected
              </button>
              <button
                className="dropdown-action danger"
                onClick={handleDeleteSelected}
                disabled={!selectedBlock}
              >
                Delete Selected
              </button>
            </div>
          </div>
        </div>

        <div className="topbar-status">
          {projectMeta.name}
          {dirty ? " *" : ""}
        </div>

        <input
          ref={openFileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden-file-input"
          onChange={handleOpenFileChange}
        />
      </div>

      <div className="layout-main" style={{ gridTemplateColumns: `${leftWidth}px 5px 1fr 5px ${rightWidth}px` }}>
        <div className="panel-left">
          <div className="mode-toolbar">
            <button
              className={mode === "view" ? "active" : ""}
              onClick={() => {
                setMode("view");
                setTransformMode("none");
              }}
            >
              Orbit
            </button>

            <button
              className={mode === "edit" && transformMode === "move" ? "active" : ""}
              onClick={() => {
                setMode("edit");
                setTransformMode("move");
              }}
            >
              Move
            </button>

            <button
              className={mode === "edit" && transformMode === "rotate" ? "active" : ""}
              onClick={() => {
                setMode("edit");
                setTransformMode("rotate");
              }}
            >
              Rotate
            </button>
          </div>

          <div className="panel-section" style={{ height: `${sceneHeight}px` }}>
            <div className="panel-section-header">Scene</div>
            <div className="scene-tree-container">
              <SceneTreeView />
            </div>
          </div>

          <div className="resize-horizontal" onMouseDown={startSceneResize} />

          <div className="panel-section" style={{ flex: 1 }}>
            <div className="panel-section-header">Assets</div>
            <div className="assets-container">
              <BlockTypeManager />
            </div>
          </div>
        </div>
        <div className="resize-vertical" onMouseDown={startLeftResize} />

        <div
          className="center-area"
          style={{
            gridTemplateRows: `32px 1fr 5px ${consoleHeight}px`,
          }}
        >
          <div className="canvas-header">
            <button
              className={`tab ${activeCenterTab === "scene" ? "active" : ""}`}
              onClick={() => setActiveCenterTab("scene")}
            >
              Scene
            </button>
            <button
              className={`tab ${activeCenterTab === "preview" ? "active" : ""}`}
              onClick={() => {
                setActiveCenterTab("preview");
                capturePreview();
              }}
            >
              Preview
            </button>
          </div>

          <div className="canvas-stage">
            <div
              className={`canvas-wrapper ${activeCenterTab !== "scene" ? "hidden" : ""}`}
              ref={mountRef}
            />

            {activeCenterTab === "preview" && (
              <div className="preview-panel">
                <div className="preview-shot-wrap">
                  {previewImage ? (
                    <img src={previewImage} alt="Scene preview" className="preview-shot" />
                  ) : (
                    <div className="preview-placeholder">Preview snapshot is unavailable.</div>
                  )}
                </div>

                <div className="preview-meta">
                  <div><strong>Project:</strong> {projectMeta.name}</div>
                  <div><strong>Objects:</strong> {blocks.length}</div>
                  <div><strong>Groups:</strong> {countGroups(sceneTree)}</div>
                  <div>
                    <strong>Selection:</strong>{" "}
                    {selectedBlock ? (selectedBlock.name?.trim() || selectedBlock.id) : "None"}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="resize-horizontal" onMouseDown={startConsoleResize} />

          <div className={["console-panel", consoleHeight <= 30 && "collapsed"].filter(Boolean).join(" ")}>
            <h4 className="console-title">Console</h4>
            <ConsolePanel />
          </div>
        </div>
        <div className="resize-vertical" onMouseDown={startRightResize} />

        <div className="panel-right">
          <Inspector />
        </div>
      </div>
    </div>
  );
};

export default App;
