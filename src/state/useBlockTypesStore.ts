import { create } from "zustand";
import {
  BLOCK_FACES,
  type BlockDefinition,
  type ConduitTextureProfile,
  type BlockRenderMode,
  type BlockTextureMap,
  type BlockType,
  type Vec3,
} from "../models/blocks";
import { logError, logInfo, logWarn } from "./useConsoleStore";

interface BlockTypePack {
  version: number;
  generatedAt: string;
  blockTypes: BlockDefinition[];
  assetFolders?: string[];
}

interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
}

interface BlockTypesState {
  initialized: boolean;
  revision: number;
  definitions: BlockDefinition[];
  definitionsById: Record<string, BlockDefinition>;
  assetFolders: string[];
  initializeBuiltInTypes: () => void;
  importPackFromString: (raw: string, source?: string) => ImportResult | null;
  createTypeFromSingleTexture: (fileName: string, dataUrl: string, source?: string) => string | null;
  createCustomObjectType: (displayName?: string) => string;
  updateTypeDefinition: (
    typeId: BlockType,
    patch: {
      displayName?: string;
      textures?: BlockTextureMap | undefined;
      group?: string | undefined;
      renderMode?: BlockRenderMode | undefined;
      connectTag?: string | undefined;
    }
  ) => boolean;
  deleteTypeDefinition: (typeId: BlockType) => boolean;
  setTextureProfile: (
    typeId: BlockType,
    textureProfile: ConduitTextureProfile | undefined
  ) => boolean;
  addAssetFolder: (folderPath: string) => string | null;
  renameAssetFolder: (currentPath: string, nextPath: string) => boolean;
  removeAssetFolder: (folderPath: string) => boolean;
  exportPackToString: () => string;
  getDefinition: (typeId: BlockType) => BlockDefinition;
}

const SOURCE = "BlockTypes";
const CUSTOM_OBJECT_GROUP = "custom_object";
const DEFAULT_ASSET_TEXTURES_GROUP = "assets/textures";
const DEFAULT_ASSET_ROOT = "assets";
const DEFAULT_ASSET_COLORS_GROUP = "assets/colors";
const PROTECTED_ASSET_FOLDERS = new Set([
  DEFAULT_ASSET_ROOT,
  DEFAULT_ASSET_TEXTURES_GROUP,
  DEFAULT_ASSET_COLORS_GROUP,
]);

const UNKNOWN_BLOCK_TYPE: BlockDefinition = {
  id: "unknown_block",
  displayName: "Unknown Block",
  color: 0xff00ff,
  internal: true,
};
const warnedMissingTypeIds = new Set<string>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseColor = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(0xffffff, Math.trunc(value)));
  }

  if (typeof value === "string") {
    const normalized = value.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
      return Number.parseInt(normalized, 16);
    }
  }

  return null;
};

const MIN_BLOCK_SCALE = 0.05;
const MAX_BLOCK_SCALE = 1;
const RENDER_MODES: BlockRenderMode[] = ["cube", "conduit"];
const CONDUIT_TEXTURE_PROFILE_KEYS = [
  "coreSide",
  "coreTop",
  "coreBottom",
  "armSide",
  "armSideHorizontal",
  "armSideVertical",
  "armCapOpen",
  "armCapConnected",
] as const;

const parseTextureValue = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

const parseTextureMap = (value: unknown): BlockTextureMap | null => {
  if (!isRecord(value)) return null;

  const textures: BlockTextureMap = {};
  const all = parseTextureValue(value.all);
  if (all) {
    textures.all = all;
  }

  BLOCK_FACES.forEach((face) => {
    const parsed = parseTextureValue(value[face]);
    if (parsed) {
      textures[face] = parsed;
    }
  });

  const hasAny = Object.keys(textures).length > 0;
  return hasAny ? textures : null;
};

const parseConduitTextureProfile = (value: unknown): ConduitTextureProfile | null => {
  if (!isRecord(value)) return null;

  const profile: ConduitTextureProfile = {};

  CONDUIT_TEXTURE_PROFILE_KEYS.forEach((key) => {
    const parsed = parseTextureValue(value[key]);
    if (parsed) {
      profile[key] = parsed;
    }
  });

  return Object.keys(profile).length > 0 ? profile : null;
};

const normalizeTextureProfileInput = (
  textureProfile: ConduitTextureProfile | undefined
): ConduitTextureProfile | undefined => {
  if (!textureProfile) return undefined;

  const normalized: ConduitTextureProfile = {};
  CONDUIT_TEXTURE_PROFILE_KEYS.forEach((key) => {
    const parsed = parseTextureValue(textureProfile[key]);
    if (parsed) {
      normalized[key] = parsed;
    }
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeTextureMapInput = (
  textures: BlockTextureMap | undefined
): BlockTextureMap | undefined => {
  if (!textures) return undefined;

  const normalized: BlockTextureMap = {};

  const all = parseTextureValue(textures.all);
  if (all) {
    normalized.all = all;
  }

  BLOCK_FACES.forEach((face) => {
    const parsed = parseTextureValue(textures[face]);
    if (parsed) {
      normalized[face] = parsed;
    }
  });

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

const normalizeOptionalString = (value: string | undefined) => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const parseScaleComponent = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < MIN_BLOCK_SCALE || value > MAX_BLOCK_SCALE) return null;
  return value;
};

const parseScale = (value: unknown): Vec3 | null => {
  if (!isRecord(value)) return null;

  const x = parseScaleComponent(value.x);
  const y = parseScaleComponent(value.y);
  const z = parseScaleComponent(value.z);

  if (x === null || y === null || z === null) return null;
  return { x, y, z };
};

const parseRenderMode = (value: unknown): BlockRenderMode | null => {
  if (value === undefined) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!RENDER_MODES.includes(normalized as BlockRenderMode)) return null;
  return normalized as BlockRenderMode;
};

const sanitizeFileStem = (name: string) => {
  const withoutExt = name.replace(/\.[^.]+$/, "");
  return withoutExt
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
};

const toDisplayName = (value: string) =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");

const createUniqueTypeId = (
  map: Record<string, BlockDefinition>,
  baseId: string
) => {
  let id = baseId;
  let suffix = 2;

  while (map[id]) {
    id = `${baseId}_${suffix}`;
    suffix += 1;
  }

  return id;
};

const parseDefinition = (raw: unknown): BlockDefinition | null => {
  if (!isRecord(raw)) return null;

  const id = raw.id;
  const displayName = raw.displayName;
  const color = parseColor(raw.color);
  const group = raw.group;
  const connectTag = raw.connectTag;
  const renderMode = parseRenderMode(raw.renderMode);
  let scale: Vec3 | undefined;
  let textures: BlockTextureMap | undefined;
  let textureProfile: ConduitTextureProfile | undefined;
  if (raw.scale !== undefined) {
    const parsedScale = parseScale(raw.scale);
    if (!parsedScale) return null;
    scale = parsedScale;
  }
  if (raw.textures !== undefined) {
    const parsedTextures = parseTextureMap(raw.textures);
    if (!parsedTextures) return null;
    textures = parsedTextures;
  }
  if (raw.textureProfile !== undefined) {
    const parsedTextureProfile = parseConduitTextureProfile(raw.textureProfile);
    if (!parsedTextureProfile) return null;
    textureProfile = parsedTextureProfile;
  }
  const internal = raw.internal;

  if (typeof id !== "string" || id.trim() === "") return null;
  if (typeof displayName !== "string" || displayName.trim() === "") return null;
  if (color === null) return null;
  if (raw.renderMode !== undefined && renderMode === null) return null;
  if (connectTag !== undefined && typeof connectTag !== "string") return null;
  if (group !== undefined && typeof group !== "string") return null;
  if (internal !== undefined && typeof internal !== "boolean") return null;

  // Store shape is normalized here so runtime actions can trust strict types.
  return {
    id: id.trim(),
    displayName: displayName.trim(),
    color,
    scale,
    textureProfile,
    renderMode: renderMode ?? undefined,
    connectTag: connectTag?.trim() || undefined,
    group: group?.trim() || undefined,
    textures,
    internal: internal === true,
  };
};

const toDefinitionsArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.blockTypes)) return value.blockTypes;
  return [];
};

const normalizeAssetFolderPath = (value: string): string | null => {
  const normalized = value
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();

  if (normalized === "") {
    return null;
  }

  if (normalized === DEFAULT_ASSET_ROOT || normalized.startsWith(`${DEFAULT_ASSET_ROOT}/`)) {
    return normalized;
  }

  return `${DEFAULT_ASSET_ROOT}/${normalized}`;
};

const toAssetFoldersArray = (value: unknown): string[] => {
  if (!isRecord(value) || !Array.isArray(value.assetFolders)) return [];

  const folders = new Set<string>();
  value.assetFolders.forEach((candidate) => {
    if (typeof candidate !== "string") return;
    const normalized = normalizeAssetFolderPath(candidate);
    if (!normalized) return;
    // Core folders are always virtual and must not be imported/removed.
    if (PROTECTED_ASSET_FOLDERS.has(normalized)) return;
    folders.add(normalized);
  });

  return Array.from(folders).sort((a, b) => a.localeCompare(b));
};

const toSortedDefinitions = (definitionsById: Record<string, BlockDefinition>) =>
  Object.values(definitionsById).sort((a, b) => a.id.localeCompare(b.id));

const BUILTIN_TYPE_MODULES = import.meta.glob("../data/blockTypes/*.json", {
  eager: true,
});

const normalizeModuleDefault = (moduleValue: unknown) => {
  if (isRecord(moduleValue) && "default" in moduleValue) {
    return moduleValue.default;
  }
  return moduleValue;
};

const loadBuiltInDefinitions = (): BlockDefinition[] => {
  const modules = Object.entries(BUILTIN_TYPE_MODULES);

  if (modules.length === 0) {
    logWarn(SOURCE, "No built-in block type files found in src/data/blockTypes.");
    return [];
  }

  const definitions: BlockDefinition[] = [];

  modules.forEach(([path, moduleValue]) => {
    const parsed = parseDefinition(normalizeModuleDefault(moduleValue));

    if (!parsed) {
      logError(SOURCE, `Invalid built-in block type schema in ${path}.`);
      return;
    }

    definitions.push(parsed);
  });

  return definitions;
};

export const useBlockTypesStore = create<BlockTypesState>((set, get) => ({
  initialized: false,
  revision: 0,
  definitions: [UNKNOWN_BLOCK_TYPE],
  definitionsById: {
    [UNKNOWN_BLOCK_TYPE.id]: UNKNOWN_BLOCK_TYPE,
  },
  assetFolders: [],

  initializeBuiltInTypes: () => {
    const state = get();
    if (state.initialized) return;

    const builtIns = loadBuiltInDefinitions();
    const map: Record<string, BlockDefinition> = {
      [UNKNOWN_BLOCK_TYPE.id]: UNKNOWN_BLOCK_TYPE,
    };

    let duplicates = 0;

    builtIns.forEach((definition) => {
      if (map[definition.id]) {
        duplicates += 1;
        logWarn(SOURCE, `Duplicate built-in block type id "${definition.id}" skipped.`);
        return;
      }

      map[definition.id] = definition;
    });

    const definitions = toSortedDefinitions(map);

    set({
      initialized: true,
      revision: state.revision + 1,
      definitionsById: map,
      definitions,
    });

    const loadedCount = definitions.filter((d) => !d.internal).length;
    logInfo(SOURCE, `Loaded ${loadedCount} built-in block type(s).`);
    if (duplicates > 0) {
      logWarn(SOURCE, `Skipped ${duplicates} duplicated built-in block type id(s).`);
    }
  },

  importPackFromString: (raw, source = "runtime-import") => {
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(raw);
    } catch {
      logError(SOURCE, `Failed to parse JSON from ${source}.`);
      return null;
    }

    const candidates = toDefinitionsArray(parsedJson);
    const importedAssetFolders = toAssetFoldersArray(parsedJson);
    if (candidates.length === 0) {
      logError(SOURCE, `No blockTypes array found in ${source}.`);
      return null;
    }

    const state = get();
    const map = { ...state.definitionsById };
    let imported = 0;
    let updated = 0;
    let skipped = 0;

    candidates.forEach((candidate, index) => {
      const parsedDefinition = parseDefinition(candidate);

      if (!parsedDefinition) {
        skipped += 1;
        logWarn(SOURCE, `Invalid block type entry at index ${index} in ${source}; skipped.`);
        return;
      }

      if (parsedDefinition.id === UNKNOWN_BLOCK_TYPE.id) {
        skipped += 1;
        logWarn(SOURCE, `Reserved id "${UNKNOWN_BLOCK_TYPE.id}" cannot be imported; skipped.`);
        return;
      }

      if (map[parsedDefinition.id]) {
        updated += 1;
      } else {
        imported += 1;
      }

      map[parsedDefinition.id] = {
        ...parsedDefinition,
        internal: false,
      };
    });

    if (imported === 0 && updated === 0) {
      logWarn(SOURCE, `No valid block type entries imported from ${source}.`);
      return {
        imported,
        updated,
        skipped,
      };
    }

    set({
      revision: state.revision + 1,
      definitionsById: map,
      definitions: toSortedDefinitions(map),
      // Keep folder tree cumulative across imports so explorer state remains usable.
      assetFolders: Array.from(new Set([...state.assetFolders, ...importedAssetFolders]))
        .sort((a, b) => a.localeCompare(b)),
    });

    logInfo(
      SOURCE,
      `Imported block type pack from ${source}: +${imported} new, ${updated} updated, ${skipped} skipped.`
    );

    return { imported, updated, skipped };
  },

  createTypeFromSingleTexture: (fileName, dataUrl, source = "runtime-import") => {
    const sanitizedStem = sanitizeFileStem(fileName);
    const baseId = sanitizedStem || "imported_texture";
    const baseDisplayName = toDisplayName(baseId) || "Imported Texture";
    const trimmedDataUrl = dataUrl.trim();

    if (trimmedDataUrl === "" || !trimmedDataUrl.startsWith("data:image/png")) {
      logError(SOURCE, `Invalid PNG data received for "${fileName}" from ${source}.`);
      return null;
    }

    const state = get();
    const map = { ...state.definitionsById };
    const id = createUniqueTypeId(map, baseId);

    map[id] = {
      id,
      displayName: baseDisplayName,
      color: 0xffffff,
      textures: {
        all: trimmedDataUrl,
      },
      group: DEFAULT_ASSET_TEXTURES_GROUP,
      internal: false,
    };

    set({
      revision: state.revision + 1,
      definitionsById: map,
      definitions: toSortedDefinitions(map),
    });

    logInfo(SOURCE, `Imported PNG texture "${fileName}" as block type "${id}".`);
    return id;
  },

  createCustomObjectType: (displayName = "Custom Object") => {
    const state = get();
    const map = { ...state.definitionsById };

    const sanitizedStem = sanitizeFileStem(displayName);
    const baseId = sanitizedStem || CUSTOM_OBJECT_GROUP;
    const id = createUniqueTypeId(map, baseId);
    const normalizedDisplayName = normalizeOptionalString(displayName) ?? toDisplayName(id) ?? "Custom Object";

    map[id] = {
      id,
      displayName: normalizedDisplayName,
      color: 0xffffff,
      renderMode: "cube",
      group: CUSTOM_OBJECT_GROUP,
      textures: {},
      internal: false,
    };

    set({
      revision: state.revision + 1,
      definitionsById: map,
      definitions: toSortedDefinitions(map),
    });

    logInfo(SOURCE, `Created custom object block type "${id}".`);
    return id;
  },

  updateTypeDefinition: (typeId, patch) => {
    const state = get();
    const existing = state.definitionsById[typeId];

    if (!existing || existing.internal) {
      logWarn(SOURCE, `Cannot update unknown/internal block type "${typeId}".`);
      return false;
    }

    const nextDefinition: BlockDefinition = {
      ...existing,
      internal: false,
    };

    if (patch.displayName !== undefined) {
      nextDefinition.displayName = normalizeOptionalString(patch.displayName) ?? existing.displayName;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "group")) {
      nextDefinition.group = normalizeOptionalString(patch.group);
    }

    if (Object.prototype.hasOwnProperty.call(patch, "connectTag")) {
      nextDefinition.connectTag = normalizeOptionalString(patch.connectTag);
    }

    if (Object.prototype.hasOwnProperty.call(patch, "textures")) {
      nextDefinition.textures = normalizeTextureMapInput(patch.textures);
    }

    if (patch.renderMode !== undefined) {
      nextDefinition.renderMode = patch.renderMode;
    } else if (!nextDefinition.renderMode) {
      nextDefinition.renderMode = "cube";
    }

    // Conduit profile is only meaningful for conduit render mode.
    if (nextDefinition.renderMode !== "conduit") {
      nextDefinition.textureProfile = undefined;
    }

    const map = { ...state.definitionsById };
    map[typeId] = nextDefinition;

    set({
      revision: state.revision + 1,
      definitionsById: map,
      definitions: toSortedDefinitions(map),
    });

    logInfo(SOURCE, `Updated block type "${typeId}".`);
    return true;
  },

  deleteTypeDefinition: (typeId) => {
    const state = get();
    const existing = state.definitionsById[typeId];

    if (!existing || existing.internal || typeId === UNKNOWN_BLOCK_TYPE.id) {
      logWarn(SOURCE, `Cannot delete unknown/internal block type "${typeId}".`);
      return false;
    }

    const map = { ...state.definitionsById };
    delete map[typeId];

    set({
      revision: state.revision + 1,
      definitionsById: map,
      definitions: toSortedDefinitions(map),
    });

    logInfo(SOURCE, `Deleted block type "${typeId}".`);
    return true;
  },

  setTextureProfile: (typeId, textureProfile) => {
    const state = get();
    const existing = state.definitionsById[typeId];

    if (!existing || existing.internal) {
      logWarn(SOURCE, `Cannot update texture profile for unknown/internal block type "${typeId}".`);
      return false;
    }

    if (existing.renderMode !== "conduit") {
      logWarn(SOURCE, `Cannot update texture profile for non-conduit block type "${typeId}".`);
      return false;
    }

    const normalizedTextureProfile = normalizeTextureProfileInput(textureProfile);
    const map = { ...state.definitionsById };
    map[typeId] = {
      ...existing,
      textureProfile: normalizedTextureProfile,
    };

    set({
      revision: state.revision + 1,
      definitionsById: map,
      definitions: toSortedDefinitions(map),
    });

    logInfo(
      SOURCE,
      normalizedTextureProfile
        ? `Updated conduit texture profile for "${typeId}".`
        : `Cleared conduit texture profile for "${typeId}".`
    );
    return true;
  },

  addAssetFolder: (folderPath) => {
    const normalized = normalizeAssetFolderPath(folderPath);
    if (!normalized) {
      logWarn(SOURCE, `Cannot add invalid asset folder path "${folderPath}".`);
      return null;
    }

    if (PROTECTED_ASSET_FOLDERS.has(normalized)) {
      return normalized;
    }

    const state = get();
    if (state.assetFolders.includes(normalized)) {
      return normalized;
    }

    set({
      revision: state.revision + 1,
      assetFolders: [...state.assetFolders, normalized].sort((a, b) => a.localeCompare(b)),
    });
    logInfo(SOURCE, `Added asset folder "${normalized}".`);
    return normalized;
  },

  renameAssetFolder: (currentPath, nextPath) => {
    const normalizedCurrent = normalizeAssetFolderPath(currentPath);
    const normalizedNext = normalizeAssetFolderPath(nextPath);

    if (!normalizedCurrent || !normalizedNext) {
      logWarn(SOURCE, "Cannot rename asset folder because source or target path is invalid.");
      return false;
    }

    if (normalizedCurrent === normalizedNext) {
      return true;
    }

    if (PROTECTED_ASSET_FOLDERS.has(normalizedCurrent)) {
      logWarn(SOURCE, `Cannot rename protected asset folder "${normalizedCurrent}".`);
      return false;
    }

    if (normalizedNext.startsWith(`${normalizedCurrent}/`)) {
      logWarn(SOURCE, "Cannot rename folder into its own subtree.");
      return false;
    }

    const prefix = `${normalizedCurrent}/`;
    const state = get();
    let changed = false;

    // Rename applies transitively to all descendants to preserve folder subtree shape.
    const mapped = state.assetFolders
      .map((folder) => {
        if (folder === normalizedCurrent) {
          changed = true;
          return normalizedNext;
        }

        if (folder.startsWith(prefix)) {
          changed = true;
          return `${normalizedNext}${folder.slice(normalizedCurrent.length)}`;
        }

        return folder;
      })
      .filter((folder) => !PROTECTED_ASSET_FOLDERS.has(folder));

    if (!changed) {
      return false;
    }

    set({
      revision: state.revision + 1,
      assetFolders: Array.from(new Set(mapped)).sort((a, b) => a.localeCompare(b)),
    });
    logInfo(SOURCE, `Renamed asset folder "${normalizedCurrent}" to "${normalizedNext}".`);
    return true;
  },

  removeAssetFolder: (folderPath) => {
    const normalized = normalizeAssetFolderPath(folderPath);
    if (!normalized) {
      logWarn(SOURCE, `Cannot remove invalid asset folder path "${folderPath}".`);
      return false;
    }

    if (PROTECTED_ASSET_FOLDERS.has(normalized)) {
      logWarn(SOURCE, `Cannot remove protected asset folder "${normalized}".`);
      return false;
    }

    const prefix = `${normalized}/`;
    const state = get();
    // Removing a folder also removes all nested descendant folder records.
    const nextFolders = state.assetFolders.filter(
      (folder) => folder !== normalized && !folder.startsWith(prefix)
    );

    if (nextFolders.length === state.assetFolders.length) {
      return false;
    }

    set({
      revision: state.revision + 1,
      assetFolders: nextFolders,
    });
    logInfo(SOURCE, `Removed asset folder "${normalized}".`);
    return true;
  },

  exportPackToString: () => {
    const state = get();
    const blockTypes = state.definitions.filter((definition) => !definition.internal);

    const pack: BlockTypePack = {
      version: 1,
      generatedAt: new Date().toISOString(),
      blockTypes,
      assetFolders: state.assetFolders,
    };

    const serialized = JSON.stringify(pack, null, 2);
    logInfo(SOURCE, `Exported block type pack with ${blockTypes.length} type(s).`);
    return serialized;
  },

  getDefinition: (typeId) => {
    const state = get();
    const definition = state.definitionsById[typeId];

    if (definition) {
      return definition;
    }

    if (!warnedMissingTypeIds.has(typeId)) {
      warnedMissingTypeIds.add(typeId);
      logWarn(SOURCE, `Unknown block type "${typeId}" used by scene. Falling back to "${UNKNOWN_BLOCK_TYPE.id}".`);
    }

    // Always return a safe placeholder definition to avoid hard rendering failures.
    return state.definitionsById[UNKNOWN_BLOCK_TYPE.id];
  },
}));

export const getBlockTypeDefinition = (typeId: BlockType) =>
  useBlockTypesStore.getState().getDefinition(typeId);
