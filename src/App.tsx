import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { SceneGroupNode } from "./models/sceneTree";
import initScene, { type SceneAPI } from "./three/initScene";
import defaultProject from "./data/defaultProject.json";
import BlockTypeManager from "./components/BlockTypeManager";
import ConsolePanel from "./components/ConsolePanel";
import Inspector from "./components/Inspector/Inspector";
import SceneTreeView from "./components/SceneTree/SceneTreeView";
import { dispatchAssetsCommand } from "./assets/assetsCommands";
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
import { collectBlockIds, findNodeById } from "./components/SceneTree/sceneTreeUtils";
import {
  getFileNameFromPath,
  isDesktopRuntime,
  saveTextFile,
} from "./utils/fileSave";

const FILE_SOURCE = "FileMenu";
const EDIT_SOURCE = "EditMenu";
const WINDOW_SOURCE = "WindowMenu";
const LAYOUT_STORAGE_KEY = "mekanism-visualizer.layout.v1";
const MAX_LAYOUT_PRESETS = 20;

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

type GroupBounds = {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
};

type PanelId = string;
type PanelKind = "sceneTree" | "assets" | "inspector" | "console";
type DockArea = "left" | "right" | "bottom";
type PanelMode = "docked" | "floating" | "minimized" | "closed";
type FloatingResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface PanelFloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PanelState {
  kind: PanelKind;
  mode: PanelMode;
  dockArea: DockArea;
  dockOrder: number;
  floatingRect: PanelFloatingRect;
  zIndex: number;
  minimizedFrom?: {
    mode: "docked" | "floating";
    dockArea: DockArea;
  };
}

type PanelStateMap = Record<PanelId, PanelState>;
interface LayoutSnapshot {
  panelStates: PanelStateMap;
  leftDockWidth: number;
  rightDockWidth: number;
  bottomDockHeight: number;
  bottomDockDirection: "row" | "column";
  panelZIndex: number;
}

interface LayoutPreset {
  id: string;
  name: string;
  snapshot: LayoutSnapshot;
  updatedAt: string;
}

interface LayoutStoragePayload {
  version: 1;
  presets: LayoutPreset[];
  activePresetId: string | null;
  workspace: LayoutSnapshot;
}

const DOCK_AREAS: DockArea[] = ["left", "right", "bottom"];
const DEFAULT_ASSET_PANEL_FOLDER = "assets/textures";
const PANEL_KIND_TITLES: Record<PanelKind, string> = {
  sceneTree: "Scene Tree",
  assets: "Assets",
  inspector: "Inspector",
  console: "Console",
};

const PANEL_DEFAULT_DOCK: Record<PanelKind, DockArea> = {
  sceneTree: "left",
  assets: "left",
  inspector: "right",
  console: "bottom",
};

const resolvePanelKindFromId = (panelId: PanelId): PanelKind => {
  if (panelId.startsWith("assets")) return "assets";
  if (panelId === "sceneTree") return "sceneTree";
  if (panelId === "inspector") return "inspector";
  if (panelId === "console") return "console";
  return "assets";
};

const resolvePanelTitle = (panelId: PanelId, panelKind: PanelKind) => {
  if (panelKind !== "assets") return PANEL_KIND_TITLES[panelKind];
  if (panelId === "assets") return "Assets";
  return "Assets";
};

// Base workspace layout used for first boot and full reset.
const createInitialPanelState = (): PanelStateMap => ({
  sceneTree: {
    kind: "sceneTree",
    mode: "docked",
    dockArea: "left",
    dockOrder: 0,
    floatingRect: { x: 48, y: 88, width: 360, height: 420 },
    zIndex: 11,
  },
  assets: {
    kind: "assets",
    mode: "closed",
    dockArea: "left",
    dockOrder: 1,
    floatingRect: { x: 92, y: 118, width: 380, height: 460 },
    zIndex: 12,
  },
  inspector: {
    kind: "inspector",
    mode: "docked",
    dockArea: "right",
    dockOrder: 0,
    floatingRect: { x: 220, y: 96, width: 360, height: 520 },
    zIndex: 13,
  },
  console: {
    kind: "console",
    mode: "closed",
    dockArea: "bottom",
    dockOrder: 0,
    floatingRect: { x: 140, y: 160, width: 640, height: 260 },
    zIndex: 14,
  },
});

const cloneFloatingRect = (rect: PanelFloatingRect): PanelFloatingRect => ({
  x: rect.x,
  y: rect.y,
  width: rect.width,
  height: rect.height,
});

const clonePanelState = (panel: PanelState): PanelState => ({
  ...panel,
  floatingRect: cloneFloatingRect(panel.floatingRect),
  minimizedFrom: panel.minimizedFrom
    ? {
        ...panel.minimizedFrom,
      }
    : undefined,
});

const clonePanelStateMap = (state: PanelStateMap): PanelStateMap => {
  const next: PanelStateMap = {};

  Object.entries(state).forEach(([panelId, panel]) => {
    next[panelId] = clonePanelState(panel);
  });

  return next;
};

const cloneLayoutSnapshot = (snapshot: LayoutSnapshot): LayoutSnapshot => ({
  panelStates: clonePanelStateMap(snapshot.panelStates),
  leftDockWidth: snapshot.leftDockWidth,
  rightDockWidth: snapshot.rightDockWidth,
  bottomDockHeight: snapshot.bottomDockHeight,
  bottomDockDirection: snapshot.bottomDockDirection,
  panelZIndex: snapshot.panelZIndex,
});

const cloneLayoutPreset = (preset: LayoutPreset): LayoutPreset => ({
  ...preset,
  snapshot: cloneLayoutSnapshot(preset.snapshot),
});

const createDefaultLayoutSnapshot = (): LayoutSnapshot => ({
  panelStates: createInitialPanelState(),
  leftDockWidth: 300,
  rightDockWidth: 320,
  bottomDockHeight: 210,
  bottomDockDirection: "column",
  panelZIndex: 100,
});

const isPanelKind = (value: unknown): value is PanelKind =>
  value === "sceneTree" ||
  value === "assets" ||
  value === "inspector" ||
  value === "console";

const isPanelMode = (value: unknown): value is PanelMode =>
  value === "docked" ||
  value === "floating" ||
  value === "minimized" ||
  value === "closed";

const isDockArea = (value: unknown): value is DockArea =>
  value === "left" || value === "right" || value === "bottom";

const MIN_LEFT_DOCK_WIDTH = 220;
const MAX_LEFT_DOCK_WIDTH = 540;
const MIN_RIGHT_DOCK_WIDTH = 240;
const MAX_RIGHT_DOCK_WIDTH = 640;
const MIN_BOTTOM_DOCK_HEIGHT = 120;
const MAX_BOTTOM_DOCK_HEIGHT = 420;
const FLOATING_MIN_WIDTH = 260;
const FLOATING_MIN_HEIGHT = 180;
const FLOATING_MIN_Y = 40;
const FLOATING_TASKBAR_HEIGHT = 34;
const PANEL_DRAG_THRESHOLD = 6;
const TOP_SNAP_BAR_HEIGHT = 46;
const TOP_SNAP_BAR_MAX_WIDTH = 340;
const TOP_SNAP_BAR_MARGIN = 10;
const TOP_SNAP_BAR_TRIGGER_HEIGHT = 94;
const MIN_WORKSPACE_TOP_ROW_HEIGHT = 160;
const MIN_BOTTOM_DOCK_HEIGHT_DYNAMIC = 72;
const DOCK_RESIZE_HANDLE_THICKNESS = 5;
const FLOATING_RESIZE_HANDLES: FloatingResizeHandle[] = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const clampFloatingRectToViewport = (rect: PanelFloatingRect): PanelFloatingRect => {
  const maxBottom = window.innerHeight - FLOATING_TASKBAR_HEIGHT;
  const maxWidth = Math.max(FLOATING_MIN_WIDTH, window.innerWidth);
  const maxHeight = Math.max(FLOATING_MIN_HEIGHT, maxBottom - FLOATING_MIN_Y);
  const width = clamp(rect.width, FLOATING_MIN_WIDTH, maxWidth);
  const height = clamp(rect.height, FLOATING_MIN_HEIGHT, maxHeight);
  const x = clamp(rect.x, 0, Math.max(0, window.innerWidth - width));
  const y = clamp(rect.y, FLOATING_MIN_Y, Math.max(FLOATING_MIN_Y, maxBottom - height));

  return { x, y, width, height };
};

const toFiniteNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizeFloatingRect = (
  value: unknown,
  fallback: PanelFloatingRect
): PanelFloatingRect => ({
  x: toFiniteNumber(isRecord(value) ? value.x : undefined, fallback.x),
  y: toFiniteNumber(isRecord(value) ? value.y : undefined, fallback.y),
  width: toFiniteNumber(isRecord(value) ? value.width : undefined, fallback.width),
  height: toFiniteNumber(isRecord(value) ? value.height : undefined, fallback.height),
});

const normalizePanelStateMap = (value: unknown): PanelStateMap => {
  const defaults = createInitialPanelState();
  const normalized = clonePanelStateMap(defaults);

  if (!isRecord(value)) {
    return normalized;
  }

  Object.entries(value).forEach(([panelId, rawPanel]) => {
    if (!isRecord(rawPanel)) return;

    const fallbackForId = normalized[panelId] ?? (() => {
      const kind = resolvePanelKindFromId(panelId);
      const base = defaults[kind] ?? defaults.assets;

      return {
        ...clonePanelState(base),
        kind,
        dockArea: PANEL_DEFAULT_DOCK[kind],
      } as PanelState;
    })();

    const kind = isPanelKind(rawPanel.kind) ? rawPanel.kind : fallbackForId.kind;
    const parsedMode = isPanelMode(rawPanel.mode) ? rawPanel.mode : fallbackForId.mode;
    const parsedDockArea = isDockArea(rawPanel.dockArea)
      ? rawPanel.dockArea
      : PANEL_DEFAULT_DOCK[kind];
    const mode =
      kind === "assets" || kind === "console"
        ? "closed"
        : parsedMode;
    const dockArea =
      parsedDockArea === "bottom" ? PANEL_DEFAULT_DOCK[kind] : parsedDockArea;
    const dockOrder = Math.max(0, Math.floor(toFiniteNumber(rawPanel.dockOrder, fallbackForId.dockOrder)));
    const zIndex = Math.max(1, Math.floor(toFiniteNumber(rawPanel.zIndex, fallbackForId.zIndex)));
    const floatingRect = normalizeFloatingRect(rawPanel.floatingRect, fallbackForId.floatingRect);
    let minimizedFrom: PanelState["minimizedFrom"];
    const rawMinimizedFrom = rawPanel.minimizedFrom;
    if (
      isRecord(rawMinimizedFrom) &&
      (rawMinimizedFrom.mode === "docked" || rawMinimizedFrom.mode === "floating") &&
      isDockArea(rawMinimizedFrom.dockArea)
    ) {
      minimizedFrom = {
        mode: rawMinimizedFrom.mode,
        dockArea: rawMinimizedFrom.dockArea,
      };
    }

    normalized[panelId] = {
      kind,
      mode,
      dockArea,
      dockOrder,
      floatingRect,
      zIndex,
      minimizedFrom: mode === "minimized" ? minimizedFrom : undefined,
    };
  });

  Object.entries(defaults).forEach(([panelId, panel]) => {
    if (!normalized[panelId]) {
      normalized[panelId] = clonePanelState(panel);
    }
  });

  DOCK_AREAS.forEach((area) => {
    // Normalize dock order after deserialization so rendering stays deterministic.
    const dockedEntries = Object.entries(normalized)
      .filter(([, panel]) => panel.mode === "docked" && panel.dockArea === area)
      .sort((a, b) => a[1].dockOrder - b[1].dockOrder);

    dockedEntries.forEach(([panelId], index) => {
      normalized[panelId] = {
        ...normalized[panelId],
        dockOrder: index,
      };
    });
  });

  return normalized;
};

const normalizeLayoutSnapshot = (value: unknown): LayoutSnapshot => {
  const fallback = createDefaultLayoutSnapshot();

  if (!isRecord(value)) {
    return fallback;
  }

  return {
    panelStates: normalizePanelStateMap(value.panelStates),
    leftDockWidth: clamp(
      toFiniteNumber(value.leftDockWidth, fallback.leftDockWidth),
      MIN_LEFT_DOCK_WIDTH,
      MAX_LEFT_DOCK_WIDTH
    ),
    rightDockWidth: clamp(
      toFiniteNumber(value.rightDockWidth, fallback.rightDockWidth),
      MIN_RIGHT_DOCK_WIDTH,
      MAX_RIGHT_DOCK_WIDTH
    ),
    bottomDockHeight: clamp(
      toFiniteNumber(value.bottomDockHeight, fallback.bottomDockHeight),
      MIN_BOTTOM_DOCK_HEIGHT,
      MAX_BOTTOM_DOCK_HEIGHT
    ),
    bottomDockDirection: value.bottomDockDirection === "row" ? "row" : "column",
    panelZIndex: Math.max(
      100,
      Math.floor(toFiniteNumber(value.panelZIndex, fallback.panelZIndex))
    ),
  };
};

const normalizeLayoutStorage = (value: unknown): LayoutStoragePayload => {
  if (!isRecord(value)) {
    return {
      version: 1,
      presets: [],
      activePresetId: null,
      workspace: createDefaultLayoutSnapshot(),
    };
  }

  const presetEntries = Array.isArray(value.presets) ? value.presets : [];
  const presets = presetEntries
    .map((entry) => {
      if (!isRecord(entry)) return null;
      if (typeof entry.id !== "string" || !entry.id.trim()) return null;
      if (typeof entry.name !== "string" || !entry.name.trim()) return null;

      return {
        id: entry.id,
        name: entry.name.trim(),
        snapshot: normalizeLayoutSnapshot(entry.snapshot),
        updatedAt:
          typeof entry.updatedAt === "string" && entry.updatedAt.trim()
            ? entry.updatedAt
            : new Date(0).toISOString(),
      } satisfies LayoutPreset;
    })
    .filter((preset): preset is LayoutPreset => preset !== null)
    .slice(0, MAX_LAYOUT_PRESETS);

  let activePresetId =
    typeof value.activePresetId === "string" && value.activePresetId.trim()
      ? value.activePresetId
      : null;

  if (activePresetId && !presets.some((preset) => preset.id === activePresetId)) {
    activePresetId = null;
  }

  return {
    version: 1,
    presets,
    activePresetId,
    workspace: normalizeLayoutSnapshot(value.workspace),
  };
};

const createLayoutPresetId = () =>
  `layout_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const normalizePresetName = (value: string) => value.trim().replace(/\s+/g, " ");

const getNextLayoutPresetName = (presets: LayoutPreset[]) => {
  const existing = new Set(presets.map((preset) => preset.name.toLowerCase()));
  let index = 1;

  while (existing.has(`layout ${index}`)) {
    index += 1;
  }

  return `Layout ${index}`;
};

const formatLayoutPresetTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  return date.toLocaleString();
};

const App = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
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
  const selectedSceneNodeId = useBlocksStore((s) => s.selectedSceneNodeId);
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

  const [panelStates, setPanelStates] = useState<PanelStateMap>(() => createInitialPanelState());
  const [leftDockWidth, setLeftDockWidth] = useState(300);
  const [rightDockWidth, setRightDockWidth] = useState(320);
  const [bottomDockHeight, setBottomDockHeight] = useState(210);
  const [bottomDockDirection, setBottomDockDirection] = useState<"row" | "column">("column");
  const [layoutPresets, setLayoutPresets] = useState<LayoutPreset[]>([]);
  const [activeLayoutPresetId, setActiveLayoutPresetId] = useState<string | null>(null);
  const [isLayoutManagerOpen, setIsLayoutManagerOpen] = useState(false);
  const [layoutManagerSelectedPresetId, setLayoutManagerSelectedPresetId] = useState<string | null>(null);
  const [layoutManagerPresetName, setLayoutManagerPresetName] = useState("");
  const [layoutManagerError, setLayoutManagerError] = useState<string | null>(null);
  const [draggingFloatingPanelId, setDraggingFloatingPanelId] = useState<PanelId | null>(null);
  const [topSnapBarVisible, setTopSnapBarVisible] = useState(false);
  const [topSnapBarHoverArea, setTopSnapBarHoverArea] = useState<DockArea | null>(null);
  const [utilityTab, setUtilityTab] = useState<"console" | "assets">("console");
  const panelZIndexRef = useRef(100);
  const didRestoreLayoutRef = useRef(false);

  const panelIds = useMemo(() => Object.keys(panelStates), [panelStates]);

  const dockedPanelsByArea = useMemo(() => {
    const grouped: Record<DockArea, PanelId[]> = {
      left: [],
      right: [],
      bottom: [],
    };

    panelIds.forEach((panelId) => {
      const panel = panelStates[panelId];
      if (!panel || panel.mode !== "docked") return;
      grouped[panel.dockArea].push(panelId);
    });

    DOCK_AREAS.forEach((area) => {
      grouped[area].sort(
        (a, b) => panelStates[a].dockOrder - panelStates[b].dockOrder
      );
    });

    return grouped;
  }, [panelIds, panelStates]);

  const floatingPanelIds = useMemo(
    () =>
      panelIds
        .filter((panelId) => panelStates[panelId].mode === "floating")
        .sort((a, b) => panelStates[a].zIndex - panelStates[b].zIndex),
    [panelIds, panelStates]
  );

  const minimizedPanelIds = useMemo(
    () => panelIds.filter((panelId) => panelStates[panelId].mode === "minimized"),
    [panelIds, panelStates]
  );

  const hasLeftDock = dockedPanelsByArea.left.length > 0;
  const hasRightDock = dockedPanelsByArea.right.length > 0;
  const hasBottomDock = true;

  const getNextDockOrder = useCallback(
    (state: PanelStateMap, area: DockArea) => {
      const dockOrders = Object.values(state)
        .filter((panel) => panel.mode === "docked" && panel.dockArea === area)
        .map((panel) => panel.dockOrder);

      if (dockOrders.length === 0) return 0;
      return Math.max(...dockOrders) + 1;
    },
    []
  );

  const bringPanelToFront = useCallback((panelId: PanelId) => {
    setPanelStates((current) => {
      const panel = current[panelId];
      if (!panel) return current;
      const nextZ = panelZIndexRef.current + 1;
      panelZIndexRef.current = nextZ;

      return {
        ...current,
        [panelId]: {
          ...panel,
          zIndex: nextZ,
        },
      };
    });
  }, []);

  const dockPanel = useCallback(
    (panelId: PanelId, dockArea: DockArea) => {
      setPanelStates((current) => {
        const panel = current[panelId];
        if (!panel) return current;
        const targetDockArea = dockArea === "bottom" ? PANEL_DEFAULT_DOCK[panel.kind] : dockArea;

        const shouldAppend =
          panel.mode !== "docked" || panel.dockArea !== targetDockArea;

        return {
          ...current,
          [panelId]: {
            ...panel,
            mode: "docked",
            dockArea: targetDockArea,
            dockOrder: shouldAppend
              ? getNextDockOrder(current, targetDockArea)
              : panel.dockOrder,
            minimizedFrom: undefined,
          },
        };
      });
    },
    [getNextDockOrder]
  );

  const floatPanel = useCallback((panelId: PanelId) => {
    setPanelStates((current) => {
      const panel = current[panelId];
      if (!panel) return current;
      const nextZ = panelZIndexRef.current + 1;
      panelZIndexRef.current = nextZ;

      return {
        ...current,
        [panelId]: {
          ...panel,
          mode: "floating",
          floatingRect: clampFloatingRectToViewport(panel.floatingRect),
          minimizedFrom: undefined,
          zIndex: nextZ,
        },
      };
    });
  }, []);

  const minimizePanel = useCallback((panelId: PanelId) => {
    setPanelStates((current) => {
      const panel = current[panelId];
      if (!panel || panel.mode === "minimized" || panel.mode === "closed") return current;

      return {
        ...current,
        [panelId]: {
          ...panel,
          mode: "minimized",
          minimizedFrom: {
            mode: panel.mode === "floating" ? "floating" : "docked",
            dockArea: panel.dockArea,
          },
        },
      };
    });
  }, []);

  const restorePanel = useCallback((panelId: PanelId) => {
    const panel = panelStates[panelId];
    if (!panel || panel.mode !== "minimized") return;

    const from = panel.minimizedFrom;
    if (from?.mode === "floating") {
      floatPanel(panelId);
      return;
    }

    dockPanel(panelId, from?.dockArea ?? panel.dockArea);
  }, [dockPanel, floatPanel, panelStates]);

  const closePanel = useCallback((panelId: PanelId) => {
    setPanelStates((current) => {
      const panel = current[panelId];
      if (!panel || panel.mode === "closed") return current;

      return {
        ...current,
        [panelId]: {
          ...panel,
          mode: "closed",
        },
      };
    });
  }, []);

  const openPanelWindow = useCallback(
    (kind: PanelKind) => {
      if (kind === "console") {
        setUtilityTab("console");
        return;
      }

      if (kind === "assets") {
        setUtilityTab("assets");
        return;
      }

      setPanelStates((current) => {
        const entries = Object.entries(current) as Array<[PanelId, PanelState]>;
        const existing = entries.filter(([, panel]) => panel.kind === kind);
        const first = existing[0];
        if (!first) return current;

        const [panelId, panel] = first;

        if (panel.mode === "closed") {
          return {
            ...current,
            [panelId]: {
              ...panel,
              mode: "docked",
              dockArea: PANEL_DEFAULT_DOCK[kind],
              dockOrder: getNextDockOrder(current, PANEL_DEFAULT_DOCK[kind]),
              minimizedFrom: undefined,
            },
          };
        }

        if (panel.mode === "minimized") {
          return {
            ...current,
            [panelId]: {
              ...panel,
              mode: panel.minimizedFrom?.mode === "floating" ? "floating" : "docked",
              dockArea: panel.minimizedFrom?.dockArea ?? panel.dockArea,
              minimizedFrom: undefined,
            },
          };
        }

        if (panel.mode === "floating") {
          const nextZ = panelZIndexRef.current + 1;
          panelZIndexRef.current = nextZ;

          return {
            ...current,
            [panelId]: {
              ...panel,
              zIndex: nextZ,
            },
          };
        }

        return current;
      });
    },
    [getNextDockOrder]
  );

  const resetPanelLayout = useCallback(() => {
    setPanelStates(createInitialPanelState());
    setLeftDockWidth(300);
    setRightDockWidth(320);
    setBottomDockHeight(210);
    setBottomDockDirection("column");
    setActiveLayoutPresetId(null);
    setTopSnapBarVisible(false);
    setTopSnapBarHoverArea(null);
    setUtilityTab("console");
    panelZIndexRef.current = 100;
  }, []);

  const createLayoutSnapshot = useCallback((): LayoutSnapshot => ({
    panelStates: clonePanelStateMap(panelStates),
    leftDockWidth,
    rightDockWidth,
    bottomDockHeight,
    bottomDockDirection,
    panelZIndex: panelZIndexRef.current,
  }), [bottomDockDirection, bottomDockHeight, leftDockWidth, panelStates, rightDockWidth]);

  const applyLayoutSnapshot = useCallback((snapshot: LayoutSnapshot) => {
    const normalized = normalizeLayoutSnapshot(snapshot);
    const nextPanelStates = clonePanelStateMap(normalized.panelStates);
    const maxPanelZ = Object.values(nextPanelStates).reduce(
      (maxValue, panel) => Math.max(maxValue, panel.zIndex),
      100
    );

    setPanelStates(nextPanelStates);
    setLeftDockWidth(normalized.leftDockWidth);
    setRightDockWidth(normalized.rightDockWidth);
    setBottomDockHeight(normalized.bottomDockHeight);
    setBottomDockDirection(normalized.bottomDockDirection);
    // z-index is restored from snapshot but must stay above any panel-specific max.
    panelZIndexRef.current = Math.max(normalized.panelZIndex, maxPanelZ);
  }, []);

  const activeLayoutPreset = useMemo(
    () => layoutPresets.find((preset) => preset.id === activeLayoutPresetId) ?? null,
    [activeLayoutPresetId, layoutPresets]
  );

  const getPresetById = useCallback(
    (presetId: string | null) => {
      if (!presetId) return null;
      return layoutPresets.find((preset) => preset.id === presetId) ?? null;
    },
    [layoutPresets]
  );

  const openLayoutManager = useCallback(() => {
    const selectedPreset =
      getPresetById(activeLayoutPresetId) ??
      (layoutPresets.length > 0 ? layoutPresets[0] : null);

    setLayoutManagerSelectedPresetId(selectedPreset?.id ?? null);
    setLayoutManagerPresetName(
      selectedPreset?.name ?? getNextLayoutPresetName(layoutPresets)
    );
    setLayoutManagerError(null);
    setIsLayoutManagerOpen(true);
  }, [activeLayoutPresetId, getPresetById, layoutPresets]);

  const closeLayoutManager = useCallback(() => {
    setIsLayoutManagerOpen(false);
    setLayoutManagerError(null);
  }, []);

  const selectLayoutPresetInManager = useCallback(
    (presetId: string) => {
      const preset = getPresetById(presetId);
      if (!preset) return;

      setLayoutManagerSelectedPresetId(preset.id);
      setLayoutManagerPresetName(preset.name);
      setLayoutManagerError(null);
    },
    [getPresetById]
  );

  const handleLoadLayoutPreset = useCallback((presetId: string) => {
    const preset = getPresetById(presetId);
    if (!preset) return;

    applyLayoutSnapshot(preset.snapshot);
    setActiveLayoutPresetId(preset.id);
    setLayoutManagerSelectedPresetId(preset.id);
    setLayoutManagerPresetName(preset.name);
    setLayoutManagerError(null);
    logInfo(WINDOW_SOURCE, `Loaded layout preset "${preset.name}".`);
  }, [applyLayoutSnapshot, getPresetById]);

  const handleCreateLayoutPreset = useCallback(() => {
    const presetName = normalizePresetName(layoutManagerPresetName);
    if (!presetName) {
      setLayoutManagerError("Preset name cannot be empty.");
      return;
    }

    const duplicate = layoutPresets.find(
      (preset) => preset.name.toLowerCase() === presetName.toLowerCase()
    );
    if (duplicate) {
      setLayoutManagerError(`Preset "${duplicate.name}" already exists.`);
      return;
    }

    const nextPreset: LayoutPreset = {
      id: createLayoutPresetId(),
      name: presetName,
      snapshot: createLayoutSnapshot(),
      updatedAt: new Date().toISOString(),
    };
    const nextPresets = [...layoutPresets, nextPreset];
    const boundedPresets =
      nextPresets.length <= MAX_LAYOUT_PRESETS
        ? nextPresets
        : nextPresets.slice(nextPresets.length - MAX_LAYOUT_PRESETS);

    setLayoutPresets(boundedPresets);
    setActiveLayoutPresetId(nextPreset.id);
    setLayoutManagerSelectedPresetId(nextPreset.id);
    setLayoutManagerPresetName(nextPreset.name);
    setLayoutManagerError(null);
    logInfo(WINDOW_SOURCE, `Saved layout preset "${presetName}".`);
  }, [createLayoutSnapshot, layoutManagerPresetName, layoutPresets]);

  const handleOverwriteLayoutPreset = useCallback(() => {
    const selectedPreset = getPresetById(layoutManagerSelectedPresetId);
    if (!selectedPreset) {
      setLayoutManagerError("Select a preset to overwrite.");
      return;
    }

    const presetName = normalizePresetName(layoutManagerPresetName);
    if (!presetName) {
      setLayoutManagerError("Preset name cannot be empty.");
      return;
    }

    const duplicate = layoutPresets.find(
      (preset) =>
        preset.id !== selectedPreset.id &&
        preset.name.toLowerCase() === presetName.toLowerCase()
    );
    if (duplicate) {
      setLayoutManagerError(`Preset "${duplicate.name}" already exists.`);
      return;
    }

    const updatedPreset: LayoutPreset = {
      ...selectedPreset,
      name: presetName,
      snapshot: createLayoutSnapshot(),
      updatedAt: new Date().toISOString(),
    };

    setLayoutPresets((current) =>
      current.map((preset) =>
        preset.id === selectedPreset.id ? updatedPreset : preset
      )
    );
    setActiveLayoutPresetId(selectedPreset.id);
    setLayoutManagerSelectedPresetId(selectedPreset.id);
    setLayoutManagerPresetName(updatedPreset.name);
    setLayoutManagerError(null);
    logInfo(WINDOW_SOURCE, `Updated layout preset "${updatedPreset.name}".`);
  }, [createLayoutSnapshot, getPresetById, layoutManagerPresetName, layoutManagerSelectedPresetId, layoutPresets]);

  const handleRenameLayoutPreset = useCallback(() => {
    const selectedPreset = getPresetById(layoutManagerSelectedPresetId);
    if (!selectedPreset) {
      setLayoutManagerError("Select a preset to rename.");
      return;
    }

    const presetName = normalizePresetName(layoutManagerPresetName);
    if (!presetName) {
      setLayoutManagerError("Preset name cannot be empty.");
      return;
    }

    const duplicate = layoutPresets.find(
      (preset) =>
        preset.id !== selectedPreset.id &&
        preset.name.toLowerCase() === presetName.toLowerCase()
    );
    if (duplicate) {
      setLayoutManagerError(`Preset "${duplicate.name}" already exists.`);
      return;
    }

    const updatedPreset: LayoutPreset = {
      ...selectedPreset,
      name: presetName,
      updatedAt: new Date().toISOString(),
    };

    setLayoutPresets((current) =>
      current.map((preset) =>
        preset.id === selectedPreset.id ? updatedPreset : preset
      )
    );
    setLayoutManagerPresetName(updatedPreset.name);
    setLayoutManagerError(null);
    logInfo(WINDOW_SOURCE, `Renamed layout preset to "${updatedPreset.name}".`);
  }, [getPresetById, layoutManagerPresetName, layoutManagerSelectedPresetId, layoutPresets]);

  const handleDeleteLayoutPreset = useCallback(() => {
    const selectedPreset = getPresetById(layoutManagerSelectedPresetId);
    if (!selectedPreset) {
      setLayoutManagerError("Select a preset to delete.");
      return;
    }

    const selectedIndex = layoutPresets.findIndex(
      (preset) => preset.id === selectedPreset.id
    );
    const nextPresets = layoutPresets.filter(
      (preset) => preset.id !== selectedPreset.id
    );

    setLayoutPresets(nextPresets);
    if (activeLayoutPresetId === selectedPreset.id) {
      setActiveLayoutPresetId(null);
    }

    const fallbackPreset =
      nextPresets[selectedIndex] ??
      nextPresets[Math.max(0, selectedIndex - 1)] ??
      null;

    setLayoutManagerSelectedPresetId(fallbackPreset?.id ?? null);
    setLayoutManagerPresetName(
      fallbackPreset?.name ?? getNextLayoutPresetName(nextPresets)
    );
    setLayoutManagerError(null);
    logInfo(WINDOW_SOURCE, `Deleted layout preset "${selectedPreset.name}".`);
  }, [activeLayoutPresetId, getPresetById, layoutManagerSelectedPresetId, layoutPresets]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as unknown;
      const stored = normalizeLayoutStorage(parsed);
      const loadedPresets = stored.presets.map(cloneLayoutPreset);

      setLayoutPresets(loadedPresets);
      setActiveLayoutPresetId(stored.activePresetId);
      // Workspace can diverge from the currently named preset, so persist both separately.
      applyLayoutSnapshot(stored.workspace);

      if (loadedPresets.length > 0) {
        logInfo(WINDOW_SOURCE, `Loaded ${loadedPresets.length} saved layout preset(s).`);
      }
    } catch {
      logWarn(WINDOW_SOURCE, "Failed to load saved layout configuration.");
    } finally {
      didRestoreLayoutRef.current = true;
    }
  }, [applyLayoutSnapshot]);

  useEffect(() => {
    if (!didRestoreLayoutRef.current) return;

    const persistTimer = window.setTimeout(() => {
      // Debounce writes so drag/resize interactions do not hammer localStorage.
      const payload: LayoutStoragePayload = {
        version: 1,
        presets: layoutPresets.map(cloneLayoutPreset),
        activePresetId:
          activeLayoutPresetId &&
          layoutPresets.some((preset) => preset.id === activeLayoutPresetId)
            ? activeLayoutPresetId
            : null,
        workspace: cloneLayoutSnapshot(createLayoutSnapshot()),
      };

      try {
        window.localStorage.setItem(
          LAYOUT_STORAGE_KEY,
          JSON.stringify(payload)
        );
      } catch {
        // Ignore storage failures to avoid noisy logs during resize operations.
      }
    }, 120);

    return () => window.clearTimeout(persistTimer);
  }, [
    activeLayoutPresetId,
    createLayoutSnapshot,
    layoutPresets,
    panelStates,
    leftDockWidth,
    rightDockWidth,
    bottomDockHeight,
    bottomDockDirection,
  ]);

  useEffect(() => {
    if (!isLayoutManagerOpen) return;

    const handleEscClose = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeLayoutManager();
    };

    window.addEventListener("keydown", handleEscClose);
    return () => window.removeEventListener("keydown", handleEscClose);
  }, [closeLayoutManager, isLayoutManagerOpen]);

  useEffect(() => {
    if (!isLayoutManagerOpen) return;

    if (
      layoutManagerSelectedPresetId &&
      !layoutPresets.some((preset) => preset.id === layoutManagerSelectedPresetId)
    ) {
      const fallbackPreset = layoutPresets[0] ?? null;
      setLayoutManagerSelectedPresetId(fallbackPreset?.id ?? null);
      setLayoutManagerPresetName(
        fallbackPreset?.name ?? getNextLayoutPresetName(layoutPresets)
      );
      setLayoutManagerError(null);
    }
  }, [isLayoutManagerOpen, layoutManagerSelectedPresetId, layoutPresets]);

  const resolveBottomDockResizeBounds = useCallback(() => {
    const workspaceHeight =
      workspaceBodyRef.current?.getBoundingClientRect().height ?? window.innerHeight;
    const maxByWorkspace = Math.max(
      MIN_BOTTOM_DOCK_HEIGHT_DYNAMIC,
      workspaceHeight - MIN_WORKSPACE_TOP_ROW_HEIGHT - DOCK_RESIZE_HANDLE_THICKNESS
    );
    const max = Math.min(MAX_BOTTOM_DOCK_HEIGHT, maxByWorkspace);
    const min = Math.min(MIN_BOTTOM_DOCK_HEIGHT, max);

    return { min, max };
  }, []);

  const startLeftDockResize = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftDockWidth;
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.min(
        MAX_LEFT_DOCK_WIDTH,
        Math.max(MIN_LEFT_DOCK_WIDTH, startWidth + delta)
      );
      setLeftDockWidth(nextWidth);
    };

    const onUp = () => {
      document.body.style.userSelect = "auto";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [leftDockWidth]);

  const startRightDockResize = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightDockWidth;
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.min(
        MAX_RIGHT_DOCK_WIDTH,
        Math.max(MIN_RIGHT_DOCK_WIDTH, startWidth - delta)
      );
      setRightDockWidth(nextWidth);
    };

    const onUp = () => {
      document.body.style.userSelect = "auto";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [rightDockWidth]);

  const startBottomDockResize = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = bottomDockHeight;
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const bounds = resolveBottomDockResizeBounds();
      const nextHeight = clamp(startHeight + delta, bounds.min, bounds.max);
      setBottomDockHeight(nextHeight);
    };

    const onUp = () => {
      document.body.style.userSelect = "auto";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [bottomDockHeight, resolveBottomDockResizeBounds]);

  const resolveTopSnapBarRect = useCallback(() => {
    const workspaceBody = workspaceBodyRef.current;
    if (!workspaceBody) return null;

    const rect = workspaceBody.getBoundingClientRect();
    const width = Math.max(
      210,
      Math.min(TOP_SNAP_BAR_MAX_WIDTH, rect.width - TOP_SNAP_BAR_MARGIN * 2)
    );
    const x = rect.left + (rect.width - width) / 2;
    const y = rect.top + TOP_SNAP_BAR_MARGIN;

    return {
      x,
      y,
      width,
      height: TOP_SNAP_BAR_HEIGHT,
      workspaceTop: rect.top,
      workspaceBottom: rect.bottom,
      workspaceLeft: rect.left,
      workspaceRight: rect.right,
    };
  }, []);

  const shouldShowTopSnapBarFromPointer = useCallback((clientX: number, clientY: number) => {
    const barRect = resolveTopSnapBarRect();
    if (!barRect) return false;

    if (
      clientX < barRect.workspaceLeft ||
      clientX > barRect.workspaceRight ||
      clientY < barRect.workspaceTop ||
      clientY > barRect.workspaceBottom
    ) {
      return false;
    }

    return clientY <= barRect.workspaceTop + TOP_SNAP_BAR_TRIGGER_HEIGHT;
  }, [resolveTopSnapBarRect]);

  const resolveTopSnapAreaFromPointer = useCallback((clientX: number, clientY: number): DockArea | null => {
    const barRect = resolveTopSnapBarRect();
    if (!barRect) return null;

    if (
      clientX < barRect.x ||
      clientX > barRect.x + barRect.width ||
      clientY < barRect.y ||
      clientY > barRect.y + barRect.height
    ) {
      return null;
    }

    const slotWidth = barRect.width / 2;
    const slotIndex = Math.min(
      1,
      Math.max(0, Math.floor((clientX - barRect.x) / slotWidth))
    );
    const slotAreas: DockArea[] = ["left", "right"];

    return slotAreas[slotIndex] ?? null;
  }, [resolveTopSnapBarRect]);

  const clampFloatingPanelsToViewport = useCallback(() => {
    setPanelStates((current) => {
      let changed = false;
      const nextState: PanelStateMap = { ...current };

      Object.entries(current).forEach(([panelId, panel]) => {
        if (panel.mode !== "floating") return;

        const clampedRect = clampFloatingRectToViewport(panel.floatingRect);
        if (
          clampedRect.x === panel.floatingRect.x &&
          clampedRect.y === panel.floatingRect.y &&
          clampedRect.width === panel.floatingRect.width &&
          clampedRect.height === panel.floatingRect.height
        ) {
          return;
        }

        changed = true;
        nextState[panelId] = {
          ...panel,
          floatingRect: clampedRect,
        };
      });

      return changed ? nextState : current;
    });
  }, []);

  const startPanelHeaderDrag = useCallback(
    (panelId: PanelId, event: ReactMouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const panel = panelStates[panelId];
      if (!panel || panel.mode === "closed" || panel.mode === "minimized") return;

      bringPanelToFront(panelId);
      document.body.style.userSelect = "none";

      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const headerElement = event.currentTarget as HTMLElement;
      const initialMode = panel.mode;

      let activeMode: PanelMode = initialMode;
      let didActivateDrag = initialMode === "floating";
      let floatingRect: PanelFloatingRect = panel.floatingRect;

      if (initialMode === "docked") {
        // Docked panels borrow their DOM rect as the initial floating window position.
        const dockedPanelElement = headerElement.closest(".workspace-docked-panel");
        if (!dockedPanelElement) {
          document.body.style.userSelect = "auto";
          return;
        }

        const dockedRect = dockedPanelElement.getBoundingClientRect();
        floatingRect = clampFloatingRectToViewport({
          x: dockedRect.left,
          y: dockedRect.top,
          width: dockedRect.width,
          height: dockedRect.height,
        });
      }

      let offsetX = startClientX - floatingRect.x;
      let offsetY = startClientY - floatingRect.y;

      if (didActivateDrag) {
        setDraggingFloatingPanelId(panelId);
        const isTopBarVisible = shouldShowTopSnapBarFromPointer(startClientX, startClientY);
        const topArea = isTopBarVisible
          ? resolveTopSnapAreaFromPointer(startClientX, startClientY)
          : null;

        setTopSnapBarVisible(isTopBarVisible);
        setTopSnapBarHoverArea(topArea);
      }

      const activateDockedDrag = (clientX: number, clientY: number) => {
        const nextZ = panelZIndexRef.current + 1;
        panelZIndexRef.current = nextZ;

        setPanelStates((current) => {
          const currentPanel = current[panelId];
          if (!currentPanel || currentPanel.mode !== "docked") return current;

          return {
            ...current,
            [panelId]: {
              ...currentPanel,
              mode: "floating",
              floatingRect,
              minimizedFrom: undefined,
              zIndex: nextZ,
            },
          };
        });

        activeMode = "floating";
        didActivateDrag = true;
        offsetX = clientX - floatingRect.x;
        offsetY = clientY - floatingRect.y;
        setDraggingFloatingPanelId(panelId);
        const isTopBarVisible = shouldShowTopSnapBarFromPointer(clientX, clientY);
        const topArea = isTopBarVisible
          ? resolveTopSnapAreaFromPointer(clientX, clientY)
          : null;

        setTopSnapBarVisible(isTopBarVisible);
        setTopSnapBarHoverArea(topArea);
      };

      const onMove = (moveEvent: MouseEvent) => {
        if (!didActivateDrag) {
          const deltaX = Math.abs(moveEvent.clientX - startClientX);
          const deltaY = Math.abs(moveEvent.clientY - startClientY);

          if (Math.max(deltaX, deltaY) >= PANEL_DRAG_THRESHOLD) {
            activateDockedDrag(moveEvent.clientX, moveEvent.clientY);
          }
        }

        if (!didActivateDrag || activeMode !== "floating") return;

        const maxX = Math.max(0, window.innerWidth - floatingRect.width);
        const maxY = Math.max(
          FLOATING_MIN_Y,
          window.innerHeight - floatingRect.height - FLOATING_TASKBAR_HEIGHT
        );
        const nextX = Math.min(maxX, Math.max(0, moveEvent.clientX - offsetX));
        const nextY = Math.min(maxY, Math.max(FLOATING_MIN_Y, moveEvent.clientY - offsetY));
        const isTopBarVisible = shouldShowTopSnapBarFromPointer(
          moveEvent.clientX,
          moveEvent.clientY
        );
        const topArea = isTopBarVisible
          ? resolveTopSnapAreaFromPointer(moveEvent.clientX, moveEvent.clientY)
          : null;

        floatingRect = {
          ...floatingRect,
          x: nextX,
          y: nextY,
        };

        setTopSnapBarVisible(isTopBarVisible);
        setTopSnapBarHoverArea(topArea);
        setPanelStates((current) => {
          const currentPanel = current[panelId];
          if (!currentPanel || currentPanel.mode !== "floating") return current;

          return {
            ...current,
            [panelId]: {
              ...currentPanel,
              floatingRect: {
                ...currentPanel.floatingRect,
                x: nextX,
                y: nextY,
              },
            },
          };
        });
      };

      const onUp = (upEvent: MouseEvent) => {
        document.body.style.userSelect = "auto";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);

        setDraggingFloatingPanelId(null);
        setTopSnapBarVisible(false);
        setTopSnapBarHoverArea(null);

        if (!didActivateDrag) {
          return;
        }

        const topArea = resolveTopSnapAreaFromPointer(upEvent.clientX, upEvent.clientY);
        if (!topArea) return;

        // Re-dock only when the pointer is released over an explicit snap slot.
        dockPanel(panelId, topArea);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [
      bringPanelToFront,
      dockPanel,
      panelStates,
      resolveTopSnapAreaFromPointer,
      shouldShowTopSnapBarFromPointer,
    ]
  );

  const startFloatingPanelResize = useCallback(
    (panelId: PanelId, handle: FloatingResizeHandle, event: ReactMouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const panel = panelStates[panelId];
      if (!panel || panel.mode !== "floating") return;

      bringPanelToFront(panelId);
      document.body.style.userSelect = "none";

      const startRect = panel.floatingRect;
      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const handlesNorth = handle.includes("n");
      const handlesSouth = handle.includes("s");
      const handlesEast = handle.includes("e");
      const handlesWest = handle.includes("w");

      const onMove = (moveEvent: MouseEvent) => {
        const deltaX = moveEvent.clientX - startClientX;
        const deltaY = moveEvent.clientY - startClientY;
        const maxBottom = window.innerHeight - FLOATING_TASKBAR_HEIGHT;

        let nextX = startRect.x;
        let nextY = startRect.y;
        let nextWidth = startRect.width;
        let nextHeight = startRect.height;

        if (handlesEast) {
          const maxWidth = Math.max(FLOATING_MIN_WIDTH, window.innerWidth - startRect.x);
          nextWidth = clamp(startRect.width + deltaX, FLOATING_MIN_WIDTH, maxWidth);
        }

        if (handlesSouth) {
          const maxHeight = Math.max(FLOATING_MIN_HEIGHT, maxBottom - startRect.y);
          nextHeight = clamp(startRect.height + deltaY, FLOATING_MIN_HEIGHT, maxHeight);
        }

        if (handlesWest) {
          const maxX = startRect.x + startRect.width - FLOATING_MIN_WIDTH;
          nextX = clamp(startRect.x + deltaX, 0, maxX);
          nextWidth = startRect.width + (startRect.x - nextX);
        }

        if (handlesNorth) {
          const maxY = startRect.y + startRect.height - FLOATING_MIN_HEIGHT;
          nextY = clamp(startRect.y + deltaY, FLOATING_MIN_Y, maxY);
          nextHeight = startRect.height + (startRect.y - nextY);
        }

        const nextRect = clampFloatingRectToViewport({
          x: nextX,
          y: nextY,
          width: nextWidth,
          height: nextHeight,
        });

        setPanelStates((current) => {
          const currentPanel = current[panelId];
          if (!currentPanel || currentPanel.mode !== "floating") return current;

          return {
            ...current,
            [panelId]: {
              ...currentPanel,
              floatingRect: nextRect,
            },
          };
        });
      };

      const onUp = () => {
        document.body.style.userSelect = "auto";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [bringPanelToFront, panelStates]
  );

  useEffect(() => {
    const onResize = () => {
      clampFloatingPanelsToViewport();
      const bounds = resolveBottomDockResizeBounds();
      setBottomDockHeight((current) => clamp(current, bounds.min, bounds.max));
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampFloatingPanelsToViewport, resolveBottomDockResizeBounds]);

  const visibleBlockTypes = useMemo(
    () => blockTypeDefinitions.filter((definition) => !definition.internal),
    [blockTypeDefinitions]
  );

  const selectedBlock = useMemo(
    () => blocks.find((block) => block.id === selectedBlockId) ?? null,
    [blocks, selectedBlockId]
  );

  const selectedGroupBounds = useMemo<GroupBounds | null>(() => {
    if (!selectedSceneNodeId) return null;

    const node = findNodeById(sceneTree, selectedSceneNodeId);
    if (!node || node.type !== "group") return null;

    const blockIds = collectBlockIds(node);
    if (blockIds.size === 0) return null;

    // Group highlight uses the outer bounds of all descendant blocks.
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    blocks.forEach((block) => {
      if (!blockIds.has(block.id)) return;

      minX = Math.min(minX, block.position.x - 0.5);
      minY = Math.min(minY, block.position.y);
      minZ = Math.min(minZ, block.position.z - 0.5);
      maxX = Math.max(maxX, block.position.x + 0.5);
      maxY = Math.max(maxY, block.position.y + 1);
      maxZ = Math.max(maxZ, block.position.z + 0.5);
    });

    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(minZ) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY) ||
      !Number.isFinite(maxZ)
    ) {
      return null;
    }

    return {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    };
  }, [blocks, sceneTree, selectedSceneNodeId]);

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

        if (typeof projectName !== "string") {
          throw new Error("History snapshot has invalid shape.");
        }

        const normalized = normalizeProjectData(
          {
            meta: { name: projectName },
            sceneTree: nextSceneTree,
            blocks: nextBlocks,
          },
          projectName
        );

        if (!normalized.ok) {
          throw new Error(normalized.error);
        }

        // Undo/redo reuses the same normalization path as file loading.
        loadProject({
          sceneTree: normalized.project.sceneTree,
          blocks: normalized.project.blocks,
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
        // Existing meshes are updated in place instead of recreated.
        api.updateBlock(block);
      }
    });
  }, [blocks]);

  useEffect(() => {
    sceneRef.current?.setSelectedBlock(selectedBlockId);
  }, [selectedBlockId]);

  useEffect(() => {
    sceneRef.current?.setSelectedGroupBounds(selectedGroupBounds);
  }, [selectedGroupBounds]);

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

  const saveProjectToFile = useCallback(
    async (targetPath: string, markAsSaved: boolean, preferDialog = false) => {
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
      const savedFile = await saveTextFile({
        content: serialized,
        defaultPath: targetPath,
        title: markAsSaved ? "Save Project" : "Export Project Snapshot",
        filters: [
          {
            name: "Project JSON",
            extensions: ["json"],
          },
        ],
        mimeType: "application/json",
        preferDialog,
      });

      if (!savedFile.saved) {
        return false;
      }

      const persistedPath = savedFile.path ?? targetPath;
      const persistedFileName = getFileNameFromPath(persistedPath) ?? targetPath;

      if (markAsSaved) {
        // Saved snapshot becomes the new dirty-state baseline.
        const snapshot = createProjectSnapshot({
          projectName: nextMeta.name,
          sceneTree,
          blocks,
          embeddedBlockTypes: visibleBlockTypes,
        });

        markSaved(nextMeta, persistedPath, snapshot);
        logInfo(FILE_SOURCE, `Saved project to "${persistedPath}".`);
      } else {
        logInfo(FILE_SOURCE, `Exported project to "${persistedFileName}".`);
      }

      return true;
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
          // Embedded type definitions are imported before scene data to preserve references.
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
    const resolvedProjectFileName = getFileNameFromPath(projectFileName);
    if (resolvedProjectFileName) return ensureJsonExtension(resolvedProjectFileName);
    return ensureJsonExtension(`${sanitizeFileStem(projectMeta.name)}.json`);
  }, [projectFileName, projectMeta.name]);

  const handleSaveAs = useCallback(async () => {
    const promptValue = !isDesktopRuntime()
      ? window.prompt("Save project as:", defaultSaveFileName)
      : null;
    const targetPath = ensureJsonExtension(
      promptValue || projectFileName || defaultSaveFileName
    );

    if (!isDesktopRuntime() && !promptValue) {
      return;
    }

    try {
      await saveProjectToFile(targetPath, true, true);
    } catch {
      logError(FILE_SOURCE, "Failed to save project.");
    }
  }, [defaultSaveFileName, projectFileName, saveProjectToFile]);

  const handleSave = useCallback(async () => {
    const targetPath = ensureJsonExtension(projectFileName ?? defaultSaveFileName);
    try {
      await saveProjectToFile(targetPath, true);
    } catch {
      logError(FILE_SOURCE, "Failed to save project.");
    }
  }, [defaultSaveFileName, projectFileName, saveProjectToFile]);

  const handleExport = useCallback(async () => {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    const targetFileName = ensureJsonExtension(
      `${sanitizeFileStem(projectMeta.name)}-export-${timestamp}.json`
    );
    try {
      await saveProjectToFile(targetFileName, false, true);
    } catch {
      logError(FILE_SOURCE, "Failed to export project snapshot.");
    }
  }, [projectMeta.name, saveProjectToFile]);

  const handleImportAssets = useCallback(() => {
    setUtilityTab("assets");
    window.requestAnimationFrame(() => {
      dispatchAssetsCommand("import-types");
    });
  }, []);

  const handleExportAssets = useCallback(() => {
    setUtilityTab("assets");
    window.requestAnimationFrame(() => {
      dispatchAssetsCommand("export-types");
    });
  }, []);

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
      selectedBlock.name ? `${selectedBlock.name} Copy` : undefined,
      selectedBlock.connections
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

  const handlePanelActionMouseDown = (event: ReactMouseEvent) => {
    event.stopPropagation();
  };

  const renderPanelBody = (panelId: PanelId) => {
    const panelKind = panelStates[panelId]?.kind ?? resolvePanelKindFromId(panelId);

    if (panelKind === "sceneTree") {
      return (
        <div className="workspace-scene-tree">
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

          <div className="scene-tree-container">
            <SceneTreeView />
          </div>
        </div>
      );
    }

    if (panelKind === "assets") {
      // Assets is instantiated per panel id so multiple floating asset windows can coexist later.
      return (
        <div className="assets-container workspace-assets-body">
          <BlockTypeManager
            key={`assets-manager:${panelId}`}
            initialFolder={DEFAULT_ASSET_PANEL_FOLDER}
          />
        </div>
      );
    }

    if (panelKind === "inspector") {
      return <Inspector />;
    }

    return (
      <div className="console-panel panel-console-shell">
        <ConsolePanel />
      </div>
    );
  };

  const renderWindowButtons = (panelId: PanelId) => {
    return (
      <div className="workspace-panel-actions">
        <button
          className="window-action"
          title="Minimize"
          aria-label="Minimize"
          onMouseDown={handlePanelActionMouseDown}
          onClick={() => minimizePanel(panelId)}
        >
          -
        </button>
        <button
          className="window-action close"
          title="Close"
          aria-label="Close"
          onMouseDown={handlePanelActionMouseDown}
          onClick={() => closePanel(panelId)}
        >
          x
        </button>
      </div>
    );
  };

  const renderDockedPanel = (panelId: PanelId) => {
    const panel = panelStates[panelId];
    if (!panel) return null;
    const panelTitle = resolvePanelTitle(panelId, panel.kind);

    return (
      <section key={panelId} className={`workspace-docked-panel panel-body-${panel.kind}`}>
        <div
          className="workspace-panel-header"
          onMouseDown={(event) => startPanelHeaderDrag(panelId, event)}
        >
          <div className="workspace-panel-title-wrap">
            <span className="workspace-panel-title">{panelTitle}</span>
          </div>
          {renderWindowButtons(panelId)}
        </div>
        <div className={`workspace-panel-body panel-body-${panel.kind}`}>
          {renderPanelBody(panelId)}
        </div>
      </section>
    );
  };

  const renderDockArea = (area: DockArea) => {
    const dockedPanels = dockedPanelsByArea[area];

    if (dockedPanels.length === 0) {
      return null;
    }

    return (
      <div className={`workspace-dock workspace-dock-${area}`}>
        <div className="workspace-dock-stack direction-column">
          {dockedPanels.map((panelId) => renderDockedPanel(panelId))}
        </div>
      </div>
    );
  };

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
              <div className="dropdown-separator" />
              <button className="dropdown-action" onClick={handleImportAssets}>
                Import Assets...
              </button>
              <button className="dropdown-action" onClick={handleExportAssets}>
                Export Assets...
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
              <div className="dropdown-separator" />
              <button className="dropdown-action" onClick={resetPanelLayout}>
                Reset Panel Layout
              </button>
            </div>
          </div>
          <div className="menu-item">
            App
            <div className="dropdown">
              <button className="dropdown-action" onClick={openLayoutManager}>
                Settings...
              </button>
              <button className="dropdown-action" onClick={() => setUtilityTab("console")}>
                Focus Console
              </button>
              <button className="dropdown-action" onClick={() => setUtilityTab("assets")}>
                Focus Assets
              </button>
              <div className="dropdown-separator" />
              <button className="dropdown-action" onClick={resetPanelLayout}>
                Reset App Layout
              </button>
            </div>
          </div>
          <div className="menu-item">
            Window
            <div className="dropdown">
              <button className="dropdown-action" onClick={() => openPanelWindow("sceneTree")}>
                Open Scene Tree
              </button>
              <button className="dropdown-action" onClick={() => openPanelWindow("inspector")}>
                Open Inspector
              </button>
              <button className="dropdown-action" onClick={() => openPanelWindow("console")}>
                Show Console Tab
              </button>
              <button className="dropdown-action" onClick={() => openPanelWindow("assets")}>
                Show Assets Tab
              </button>
              <div className="dropdown-separator" />
              <button className="dropdown-action" onClick={openLayoutManager}>
                Layout Manager...
              </button>
              <button className="dropdown-action" disabled>
                {activeLayoutPreset
                  ? `Active Preset: ${activeLayoutPreset.name}`
                  : "Active Preset: None"}
              </button>
              <button className="dropdown-action" onClick={resetPanelLayout}>
                Reset Layout
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

      <div className="workspace-body" ref={workspaceBodyRef}>
        <div className="workspace-top-row">
          {hasLeftDock && (
            <>
              <aside
                className="workspace-side-dock left"
                style={{ width: `${leftDockWidth}px` }}
              >
                {renderDockArea("left")}
              </aside>
              <div
                className="resize-vertical workspace-resize-handle"
                onMouseDown={startLeftDockResize}
              />
            </>
          )}

          <div className="center-area modular-center">
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
          </div>

          {hasRightDock && (
            <>
              <div
                className="resize-vertical workspace-resize-handle"
                onMouseDown={startRightDockResize}
              />
              <aside
                className="workspace-side-dock right"
                style={{ width: `${rightDockWidth}px` }}
              >
                {renderDockArea("right")}
              </aside>
            </>
          )}
        </div>

        {hasBottomDock && (
          <>
            <div
              className="resize-horizontal workspace-resize-handle"
              onMouseDown={startBottomDockResize}
            />
            <div
              className="workspace-bottom-dock"
              style={{ height: `${bottomDockHeight}px` }}
            >
              <div className="workspace-dock workspace-dock-bottom utility-dock">
                <div className="workspace-bottom-tabs">
                  <button
                    className={["workspace-bottom-tab", utilityTab === "console" ? "active" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseDown={handlePanelActionMouseDown}
                    onClick={() => setUtilityTab("console")}
                  >
                    Console
                  </button>
                  <button
                    className={["workspace-bottom-tab", utilityTab === "assets" ? "active" : ""]
                      .filter(Boolean)
                      .join(" ")}
                    onMouseDown={handlePanelActionMouseDown}
                    onClick={() => setUtilityTab("assets")}
                  >
                    Assets
                  </button>
                </div>
                <div className="workspace-utility-body">
                  {utilityTab === "console" ? (
                    <div className="console-panel panel-console-shell">
                      <ConsolePanel />
                    </div>
                  ) : (
                    <div className="assets-container workspace-assets-body">
                      <BlockTypeManager
                        initialFolder={DEFAULT_ASSET_PANEL_FOLDER}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {draggingFloatingPanelId && topSnapBarVisible && (
          <div className="dock-drop-overlay">
            <div className="top-snap-bar">
              {(["left", "right"] as DockArea[]).map((area) => (
                <div
                  key={`top-snap-slot:${area}`}
                  className={[
                    "top-snap-slot",
                    topSnapBarHoverArea === area ? "hovered" : "",
                    topSnapBarHoverArea === area ? "active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="top-snap-slot-label">
                    {area.slice(0, 1).toUpperCase() + area.slice(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="floating-layer">
          {floatingPanelIds.map((panelId) => {
            const panel = panelStates[panelId];
            if (!panel) return null;
            const panelTitle = resolvePanelTitle(panelId, panel.kind);
            return (
              <div
                key={`floating:${panelId}`}
                className="floating-panel-window"
                style={{
                  left: `${panel.floatingRect.x}px`,
                  top: `${panel.floatingRect.y}px`,
                  width: `${panel.floatingRect.width}px`,
                  height: `${panel.floatingRect.height}px`,
                  zIndex: panel.zIndex,
                }}
                onMouseDown={() => bringPanelToFront(panelId)}
              >
                <div
                  className="floating-panel-header"
                  onMouseDown={(event) => startPanelHeaderDrag(panelId, event)}
                >
                  <span className="floating-panel-title">{panelTitle}</span>
                  {renderWindowButtons(panelId)}
                </div>
                <div className={`floating-panel-body panel-body-${panel.kind}`}>
                  {renderPanelBody(panelId)}
                </div>
                {FLOATING_RESIZE_HANDLES.map((handle) => (
                  <div
                    key={`resize:${panelId}:${handle}`}
                    className={`floating-resize-handle handle-${handle}`}
                    onMouseDown={(event) => startFloatingPanelResize(panelId, handle, event)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel-taskbar">
        <button className="panel-taskbar-reset" onClick={resetPanelLayout}>
          Reset Panels
        </button>
        {minimizedPanelIds.length > 0 ? (
          minimizedPanelIds.map((panelId) => (
            <button
              key={`minimized:${panelId}`}
              className="panel-taskbar-item"
              onClick={() => restorePanel(panelId)}
            >
              {resolvePanelTitle(panelId, panelStates[panelId]?.kind ?? resolvePanelKindFromId(panelId))}
            </button>
          ))
        ) : (
          <span className="panel-taskbar-empty">No minimized panels</span>
        )}
      </div>

      {isLayoutManagerOpen && (
        <div className="modal-backdrop" onMouseDown={closeLayoutManager}>
          <div
            className="modal-card layout-manager-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h3>Layout Manager</h3>
            <p className="layout-manager-summary">
              Save, load, rename and delete workspace layout presets.
            </p>

            <div className="layout-manager-grid">
              <div className="layout-manager-list">
                {layoutPresets.length > 0 ? (
                  layoutPresets.map((preset) => {
                    const isSelected = layoutManagerSelectedPresetId === preset.id;
                    const isActive = activeLayoutPresetId === preset.id;
                    return (
                      <button
                        key={`layout-manager-preset:${preset.id}`}
                        className={[
                          "layout-manager-row",
                          isSelected && "active",
                          isActive && "current",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => selectLayoutPresetInManager(preset.id)}
                      >
                        <span className="layout-manager-row-name">
                          {isActive ? `* ${preset.name}` : preset.name}
                        </span>
                        <span className="layout-manager-row-meta">
                          Updated {formatLayoutPresetTimestamp(preset.updatedAt)}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="layout-manager-empty">No saved presets yet.</div>
                )}
              </div>

              <div className="layout-manager-side">
                <div className="modal-field">
                  <label htmlFor="layout-manager-name">Preset Name</label>
                  <input
                    id="layout-manager-name"
                    value={layoutManagerPresetName}
                    onChange={(event) => {
                      setLayoutManagerPresetName(event.target.value);
                      setLayoutManagerError(null);
                    }}
                    autoFocus
                  />
                </div>

                {layoutManagerError && (
                  <p className="layout-manager-error">{layoutManagerError}</p>
                )}

                <div className="layout-manager-actions">
                  <button
                    className="primary"
                    onClick={handleCreateLayoutPreset}
                  >
                    Save New
                  </button>
                  <button
                    onClick={() => {
                      if (!layoutManagerSelectedPresetId) return;
                      handleLoadLayoutPreset(layoutManagerSelectedPresetId);
                    }}
                    disabled={!layoutManagerSelectedPresetId}
                  >
                    Load Selected
                  </button>
                  <button
                    onClick={handleOverwriteLayoutPreset}
                    disabled={!layoutManagerSelectedPresetId}
                  >
                    Overwrite Selected
                  </button>
                  <button
                    onClick={handleRenameLayoutPreset}
                    disabled={!layoutManagerSelectedPresetId}
                  >
                    Rename Selected
                  </button>
                  <button
                    className="danger"
                    onClick={handleDeleteLayoutPreset}
                    disabled={!layoutManagerSelectedPresetId}
                  >
                    Delete Selected
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button onClick={closeLayoutManager}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;


