import type { BlockDefinition, BlockInstance } from "../models/blocks";
import type { ProjectData, ProjectMeta } from "../models/project";
import type { SceneGroupNode } from "../models/sceneTree";

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

const parseBlockDefinition = (value: unknown): BlockDefinition | null => {
  if (!isRecord(value)) return null;

  const id = value.id;
  const displayName = value.displayName;
  const color = parseColor(value.color);

  if (typeof id !== "string" || id.trim() === "") return null;
  if (typeof displayName !== "string" || displayName.trim() === "") return null;
  if (color === null) return null;

  return {
    id: id.trim(),
    displayName: displayName.trim(),
    color,
  };
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

  if (!isRecord(sceneTree)) {
    return { ok: false, error: 'Project file is missing a valid "sceneTree" object.' };
  }

  if (!Array.isArray(blocks)) {
    return { ok: false, error: 'Project file is missing a valid "blocks" array.' };
  }

  const meta = normalizeMeta(input.meta, fallbackName);
  const embedded = normalizeEmbeddedBlockTypes(input.embeddedBlockTypes);

  const project: NormalizedProject = {
    meta,
    sceneTree: sceneTree as SceneGroupNode,
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
  JSON.stringify({
    projectName: data.projectName,
    sceneTree: data.sceneTree,
    blocks: data.blocks,
    embeddedBlockTypes: data.embeddedBlockTypes,
  });
