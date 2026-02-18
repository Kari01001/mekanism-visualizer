import { create } from "zustand";
import type { BlockDefinition, BlockType } from "../models/blocks";
import { logError, logInfo, logWarn } from "./useConsoleStore";

interface BlockTypePack {
  version: number;
  generatedAt: string;
  blockTypes: BlockDefinition[];
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
  initializeBuiltInTypes: () => void;
  importPackFromString: (raw: string, source?: string) => ImportResult | null;
  exportPackToString: () => string;
  getDefinition: (typeId: BlockType) => BlockDefinition;
}

const SOURCE = "BlockTypes";

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

const parseDefinition = (raw: unknown): BlockDefinition | null => {
  if (!isRecord(raw)) return null;

  const id = raw.id;
  const displayName = raw.displayName;
  const color = parseColor(raw.color);
  const internal = raw.internal;

  if (typeof id !== "string" || id.trim() === "") return null;
  if (typeof displayName !== "string" || displayName.trim() === "") return null;
  if (color === null) return null;
  if (internal !== undefined && typeof internal !== "boolean") return null;

  return {
    id: id.trim(),
    displayName: displayName.trim(),
    color,
    internal: internal === true,
  };
};

const toDefinitionsArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.blockTypes)) return value.blockTypes;
  return [];
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
    });

    logInfo(
      SOURCE,
      `Imported block type pack from ${source}: +${imported} new, ${updated} updated, ${skipped} skipped.`
    );

    return { imported, updated, skipped };
  },

  exportPackToString: () => {
    const state = get();
    const blockTypes = state.definitions.filter((definition) => !definition.internal);

    const pack: BlockTypePack = {
      version: 1,
      generatedAt: new Date().toISOString(),
      blockTypes,
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

    return state.definitionsById[UNKNOWN_BLOCK_TYPE.id];
  },
}));

export const getBlockTypeDefinition = (typeId: BlockType) =>
  useBlockTypesStore.getState().getDefinition(typeId);
