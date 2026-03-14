import {
  BLOCK_FACES,
  type BlockDefinition,
  type ConduitTextureProfile,
  type BlockInstance,
  type BlockRenderMode,
  type BlockTextureMap,
  type Vec3,
} from "../models/blocks";
import type { ProjectData, ProjectMeta } from "../models/project";
import type { SceneGroupNode, SceneTreeNode } from "../models/sceneTree";

export const PROJECT_SCHEMA_VERSION = 2;
export const DEFAULT_PROJECT_NAME = "Untitled Project";

export interface NormalizedProject {
  meta: ProjectMeta;
  sceneTree: SceneGroupNode;
  blocks: BlockInstance[];
  embeddedBlockTypes: BlockDefinition[];
}

export type NormalizeProjectResult =
  | {
      ok: true;
      project: NormalizedProject;
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
    };

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

  return Object.keys(textures).length > 0 ? textures : null;
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

const parseBlockDefinition = (value: unknown): BlockDefinition | null => {
  if (!isRecord(value)) return null;

  const id = value.id;
  const displayName = value.displayName;
  const color = parseColor(value.color);
  const group = value.group;
  const connectTag = value.connectTag;
  const renderMode = parseRenderMode(value.renderMode);
  let scale: Vec3 | undefined;
  let textures: BlockTextureMap | undefined;
  let textureProfile: ConduitTextureProfile | undefined;

  if (value.scale !== undefined) {
    const parsedScale = parseScale(value.scale);
    if (!parsedScale) return null;
    scale = parsedScale;
  }

  if (value.textures !== undefined) {
    const parsedTextures = parseTextureMap(value.textures);
    if (!parsedTextures) return null;
    textures = parsedTextures;
  }

  if (value.textureProfile !== undefined) {
    const parsedTextureProfile = parseConduitTextureProfile(value.textureProfile);
    if (!parsedTextureProfile) return null;
    textureProfile = parsedTextureProfile;
  }

  if (typeof id !== "string" || id.trim() === "") return null;
  if (typeof displayName !== "string" || displayName.trim() === "") return null;
  if (color === null) return null;
  if (value.renderMode !== undefined && renderMode === null) return null;
  if (connectTag !== undefined && typeof connectTag !== "string") return null;
  if (group !== undefined && typeof group !== "string") return null;

  // Return a strictly validated definition so callers can safely merge/import it.
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
  };
};

const parseSceneTreeNode = (value: unknown): SceneTreeNode | null => {
  if (!isRecord(value)) return null;

  const id = value.id;
  const type = value.type;

  if (typeof id !== "string" || id.trim() === "") return null;
  if (type === "block") {
    const blockId = value.blockId;
    if (typeof blockId !== "string" || blockId.trim() === "") return null;

    return {
      id: id.trim(),
      type: "block",
      blockId: blockId.trim(),
    };
  }

  if (type === "group") {
    const name = value.name;
    const children = value.children;

    if (typeof name !== "string") return null;
    if (!Array.isArray(children)) return null;

    const parsedChildren: SceneTreeNode[] = [];
    for (const child of children) {
      const parsed = parseSceneTreeNode(child);
      if (!parsed) return null;
      parsedChildren.push(parsed);
    }

    return {
      id: id.trim(),
      type: "group",
      name,
      children: parsedChildren,
    };
  }

  return null;
};

const parseSceneTreeRoot = (value: unknown): SceneGroupNode | null => {
  const parsed = parseSceneTreeNode(value);
  if (!parsed || parsed.type !== "group") return null;
  return parsed;
};

export const createProjectMeta = (
  name = DEFAULT_PROJECT_NAME,
  nowIso = new Date().toISOString()
): ProjectMeta => ({
  name,
  version: PROJECT_SCHEMA_VERSION,
  createdAt: nowIso,
  updatedAt: nowIso,
});

export const createEmptySceneTree = (): SceneGroupNode => ({
  id: "root",
  type: "group",
  name: "Scene",
  children: [],
});

export const createEmptyProject = (name = DEFAULT_PROJECT_NAME): NormalizedProject => {
  const meta = createProjectMeta(name);
  return {
    meta,
    sceneTree: createEmptySceneTree(),
    blocks: [],
    embeddedBlockTypes: [],
  };
};

export const ensureJsonExtension = (fileName: string) => {
  const trimmed = fileName.trim();
  if (trimmed.toLowerCase().endsWith(".json")) return trimmed;
  return `${trimmed}.json`;
};

export const getProjectNameFromFileName = (fileName: string) => {
  const sanitized = fileName.trim();
  if (sanitized === "") return DEFAULT_PROJECT_NAME;
  return sanitized.replace(/\.json$/i, "") || DEFAULT_PROJECT_NAME;
};

const normalizeMeta = (value: unknown, fallbackName: string): ProjectMeta => {
  const now = new Date().toISOString();
  const fallback = createProjectMeta(fallbackName, now);

  if (!isRecord(value)) return fallback;

  const name =
    typeof value.name === "string" && value.name.trim() !== ""
      ? value.name.trim()
      : fallback.name;

  const version =
    typeof value.version === "number" && Number.isFinite(value.version)
      ? Math.trunc(value.version)
      : PROJECT_SCHEMA_VERSION;

  const createdAt =
    typeof value.createdAt === "string" && value.createdAt.trim() !== ""
      ? value.createdAt
      : fallback.createdAt;

  const updatedAt =
    typeof value.updatedAt === "string" && value.updatedAt.trim() !== ""
      ? value.updatedAt
      : createdAt;

  return {
    name,
    version,
    createdAt,
    updatedAt,
  };
};

const normalizeEmbeddedBlockTypes = (value: unknown) => {
  if (!Array.isArray(value)) {
    return {
      types: [] as BlockDefinition[],
      warnings: [] as string[],
    };
  }

  const warnings: string[] = [];
  const uniqueById = new Map<string, BlockDefinition>();

  value.forEach((entry, index) => {
    const parsed = parseBlockDefinition(entry);
    if (!parsed) {
      warnings.push(`Invalid embedded block type at index ${index}; skipped.`);
      return;
    }

    if (uniqueById.has(parsed.id)) {
      warnings.push(`Duplicate embedded block type id "${parsed.id}" skipped.`);
      return;
    }

    uniqueById.set(parsed.id, parsed);
  });

  return {
    types: Array.from(uniqueById.values()),
    warnings,
  };
};

export const normalizeProjectData = (
  input: unknown,
  fallbackName = DEFAULT_PROJECT_NAME
): NormalizeProjectResult => {
  if (!isRecord(input)) {
    return { ok: false, error: "Project file root must be an object." };
  }

  const sceneTree = input.sceneTree;
  const blocks = input.blocks;

  const parsedSceneTree = parseSceneTreeRoot(sceneTree);
  if (!parsedSceneTree) {
    return { ok: false, error: 'Project file is missing a valid "sceneTree" object.' };
  }

  if (!Array.isArray(blocks)) {
    return { ok: false, error: 'Project file is missing a valid "blocks" array.' };
  }

  const meta = normalizeMeta(input.meta, fallbackName);
  const embedded = normalizeEmbeddedBlockTypes(input.embeddedBlockTypes);

  // Blocks remain as provided; runtime stores normalize/repair references after load.
  const project: NormalizedProject = {
    meta,
    sceneTree: parsedSceneTree,
    blocks: blocks as BlockInstance[],
    embeddedBlockTypes: embedded.types,
  };

  return {
    ok: true,
    project,
    warnings: embedded.warnings,
  };
};

export const buildProjectPayload = (data: {
  meta: ProjectMeta;
  sceneTree: SceneGroupNode;
  blocks: BlockInstance[];
  embeddedBlockTypes: BlockDefinition[];
}): ProjectData => {
  const payload: ProjectData = {
    meta: {
      ...data.meta,
      // Persist payload with current schema version regardless of in-memory meta source.
      version: PROJECT_SCHEMA_VERSION,
    },
    sceneTree: data.sceneTree,
    blocks: data.blocks,
  };

  if (data.embeddedBlockTypes.length > 0) {
    payload.embeddedBlockTypes = data.embeddedBlockTypes;
  }

  return payload;
};

export const createProjectSnapshot = (data: {
  projectName: string;
  sceneTree: SceneGroupNode;
  blocks: BlockInstance[];
  embeddedBlockTypes: BlockDefinition[];
}) =>
  // Snapshot contains only fields required for undo/redo state restoration.
  JSON.stringify({
    projectName: data.projectName,
    sceneTree: data.sceneTree,
    blocks: data.blocks,
    embeddedBlockTypes: data.embeddedBlockTypes,
  });
