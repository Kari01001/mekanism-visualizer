import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { unzipSync } from "fflate";
import type {
  BlockDefinition,
  BlockFace,
  BlockRenderMode,
  BlockTextureMap,
  ConduitTextureProfile,
  Vec3,
} from "../models/blocks";
import { useBlockTypesStore } from "../state/useBlockTypesStore";
import { logError, logInfo, logWarn } from "../state/useConsoleStore";
import {
  ASSETS_COMMAND_EVENT,
  type AssetsCommandEventDetail,
} from "../assets/assetsCommands";

const SOURCE = "BlockTypes";
type ImportKind = "json" | "png" | "jar" | "unknown";
type TextureDescriptor = BlockFace | "all" | "side";
type TextureSlot = BlockFace | "all";
type TypeTextureSlot = TextureSlot;
type ConduitTextureProfileSlot = keyof ConduitTextureProfile;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JAR_FILE_SIZE_LIMIT = 128 * 1024 * 1024;
const FACE_PATTERN =
  /^(.*?)(?:_(front|back|left|right|top|bottom|up|down|north|south|east|west|side|all))(?:_(.+))?$/i;
const COMPACT_RENDER_KEYWORDS = ["cable", "pipe", "tube", "transporter", "conduit", "duct"];
const COMPACT_RENDER_SCALE: Vec3 = { x: 0.375, y: 0.375, z: 0.375 };
const CONDUIT_TEXTURE_PROFILE_SLOTS: ConduitTextureProfileSlot[] = [
  "coreSide",
  "coreTop",
  "coreBottom",
  "armSide",
  "armSideHorizontal",
  "armSideVertical",
  "armCapOpen",
  "armCapConnected",
];
const CONDUIT_TEXTURE_PROFILE_SLOT_LABELS: Record<ConduitTextureProfileSlot, string> = {
  coreSide: "Core Side",
  coreTop: "Core Top",
  coreBottom: "Core Bottom",
  armSide: "Arm Side",
  armSideHorizontal: "Arm Side Horizontal",
  armSideVertical: "Arm Side Vertical",
  armCapOpen: "Arm Cap Open",
  armCapConnected: "Arm Cap Connected",
};
const TYPE_TEXTURE_SLOTS: TypeTextureSlot[] = [
  "all",
  "right",
  "left",
  "top",
  "bottom",
  "front",
  "back",
];
const TYPE_TEXTURE_SLOT_LABELS: Record<TypeTextureSlot, string> = {
  all: "All Faces",
  right: "Right",
  left: "Left",
  top: "Top",
  bottom: "Bottom",
  front: "Front",
  back: "Back",
};
const CONNECTION_PROFILE_PATTERNS: Array<{ connectTag: string; tokens: string[] }> = [
  { connectTag: "fluid", tokens: ["mechanical_pipe", "pipe", "fluid"] },
  { connectTag: "gas", tokens: ["pressurized_tube", "tube", "gas"] },
  { connectTag: "item", tokens: ["logistical_transporter", "transporter", "item"] },
  { connectTag: "energy", tokens: ["universal_cable", "cable", "energy"] },
  { connectTag: "heat", tokens: ["thermodynamic_conductor", "conductor", "heat"] },
  { connectTag: "generic", tokens: ["conduit", "duct"] },
];
const TRANSMITTER_MODEL_PREFIX = "mekanism:block/transmitter/";
const BLOCKSTATE_PATH_PATTERN = /^assets\/mekanism\/blockstates\/([a-z0-9_]+)\.json$/i;
const DEFAULT_ASSET_ROOT = "assets";
const DEFAULT_ASSET_TEXTURES_FOLDER = "assets/textures";
const DEFAULT_ASSET_COLORS_FOLDER = "assets/colors";
const DEFAULT_ASSET_FOLDERS = [
  DEFAULT_ASSET_ROOT,
  DEFAULT_ASSET_TEXTURES_FOLDER,
  DEFAULT_ASSET_COLORS_FOLDER,
];
const PROTECTED_ASSET_FOLDERS = new Set(DEFAULT_ASSET_FOLDERS);
const INTERNAL_ASSET_DRAG_TYPES = ["text/x-block-type-id", "text/x-asset-folder"] as const;
const FACE_TOKEN_MAP: Record<string, TextureDescriptor> = {
  front: "front",
  back: "back",
  left: "left",
  right: "right",
  top: "top",
  bottom: "bottom",
  up: "top",
  down: "bottom",
  north: "front",
  south: "back",
  east: "right",
  west: "left",
  side: "side",
  all: "all",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasInternalAssetDragPayload = (dataTransfer: DataTransfer | null) => {
  if (!dataTransfer) return false;
  const dragTypes = Array.from(dataTransfer.types ?? []);
  return INTERNAL_ASSET_DRAG_TYPES.some((type) => dragTypes.includes(type));
};

// Pick one stable texture for previews/ghosts when a type has multiple face textures.
const resolvePrimaryTextureSource = (textures: BlockTextureMap | undefined) =>
  textures?.all ??
  textures?.front ??
  textures?.right ??
  textures?.left ??
  textures?.top ??
  textures?.bottom ??
  textures?.back;

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

    return byte === 0x7b || byte === 0x5b;
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

interface JarTextureCandidate {
  path: string;
  fileName: string;
  bytes: Uint8Array;
  namespace: string;
  relativePath: string;
}

type JarEntryMap = Record<string, Uint8Array>;

interface JarTextureGroup {
  key: string;
  typeId: string;
  displayName: string;
  groupLabel: string;
  textures: BlockTextureMap;
  textureProfile?: ConduitTextureProfile;
  sourcePaths: string[];
  faceSummary: string;
}

interface JarImportState {
  sourceFileName: string;
  groups: JarTextureGroup[];
  filterText: string;
  selectedKeys: Set<string>;
}

interface JarTextureGroupBuildState {
  key: string;
  typeId: string;
  displayName: string;
  groupLabel: string;
  textures: BlockTextureMap;
  textureProfile: ConduitTextureProfile;
  slotScores: Partial<Record<TextureSlot, number>>;
  profileScores: Partial<Record<ConduitTextureProfileSlot, number>>;
  sourcePaths: Set<string>;
}

type TextureProfileEditorState = {
  typeId: string;
  displayName: string;
  textures: BlockTextureMap;
  profile: ConduitTextureProfile;
  pendingSlot: ConduitTextureProfileSlot | null;
};

type TypeEditorState = {
  typeId: string;
  displayName: string;
  group: string;
  renderMode: BlockRenderMode;
  connectTag: string;
  textures: BlockTextureMap;
  pendingTextureSlot: TypeTextureSlot | null;
};

interface TextureSourceOption {
  id: string;
  label: string;
  value: string;
}

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Invalid file reader result."));
    };

    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });

const pngBytesToDataUrl = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return `data:image/png;base64,${btoa(binary)}`;
};

const textDecoder = new TextDecoder("utf-8");

const bytesToUtf8 = (bytes: Uint8Array) => textDecoder.decode(bytes);

const tryParseJson = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(bytesToUtf8(bytes));
  } catch {
    return null;
  }
};

const sanitizeJarEntryName = (value: string) => value.replace(/\\/g, "/");

const toDisplayName = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");

const sanitizeTypeIdPart = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeFolderPath = (value: string | undefined) => {
  if (!value) return DEFAULT_ASSET_TEXTURES_FOLDER;

  const normalized = value
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();

  if (normalized === "") return DEFAULT_ASSET_TEXTURES_FOLDER;

  if (!normalized.startsWith(`${DEFAULT_ASSET_ROOT}/`) && normalized !== DEFAULT_ASSET_ROOT) {
    return `${DEFAULT_ASSET_ROOT}/${normalized}`;
  }

  return normalized;
};

const toFolderParents = (folder: string) => {
  const parts = folder.split("/").filter(Boolean);
  const parents: string[] = [];

  for (let index = 1; index <= parts.length; index += 1) {
    parents.push(parts.slice(0, index).join("/"));
  }

  return parents;
};

const toFolderName = (folder: string) => {
  const parts = folder.split("/").filter(Boolean);
  if (parts.length === 0) return folder;
  return parts[parts.length - 1];
};

const toParentFolder = (folder: string) => {
  const parts = folder.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return DEFAULT_ASSET_TEXTURES_FOLDER;
  }

  return parts.slice(0, parts.length - 1).join("/");
};

const toFolderBreadcrumbs = (folder: string) => {
  const parts = folder.split("/").filter(Boolean);
  const breadcrumbs: Array<{ label: string; path: string }> = [];

  for (let index = 0; index < parts.length; index += 1) {
    breadcrumbs.push({
      label: toDisplayName(parts[index]) || parts[index],
      path: parts.slice(0, index + 1).join("/"),
    });
  }

  return breadcrumbs;
};

const getDirectChildFolders = (allFolders: string[], parentFolder: string) => {
  const normalizedParent = normalizeFolderPath(parentFolder);
  const prefix = `${normalizedParent}/`;
  const nextFolders = new Set<string>();

  allFolders.forEach((folder) => {
    const normalized = normalizeFolderPath(folder);
    if (!normalized.startsWith(prefix)) return;

    const remainder = normalized.slice(prefix.length);
    if (!remainder) return;
    const firstSegment = remainder.split("/")[0];
    if (!firstSegment) return;
    nextFolders.add(`${normalizedParent}/${firstSegment}`);
  });

  return Array.from(nextFolders).sort((a, b) => a.localeCompare(b));
};

const toTypeId = (namespace: string, directory: string, baseStem: string) => {
  const parts = [
    sanitizeTypeIdPart(namespace),
    ...directory.split("/").map(sanitizeTypeIdPart).filter(Boolean),
    sanitizeTypeIdPart(baseStem),
  ].filter(Boolean);

  return parts.join("__") || "imported_texture";
};

const parseResourceLocation = (value: string, fallbackNamespace = "mekanism") => {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const colon = trimmed.indexOf(":");
  if (colon < 0) {
    return {
      namespace: fallbackNamespace,
      path: trimmed,
    };
  }

  const namespace = trimmed.slice(0, colon).trim();
  const path = trimmed.slice(colon + 1).trim();

  if (namespace === "" || path === "") return null;
  return { namespace, path };
};

const toModelPathFromResource = (resource: string) => {
  const parsed = parseResourceLocation(resource);
  if (!parsed) return null;
  return `assets/${parsed.namespace}/models/${parsed.path}.json`;
};

const toTexturePathCandidatesFromResource = (resource: string) => {
  const parsed = parseResourceLocation(resource);
  if (!parsed) return [];

  const direct = `assets/${parsed.namespace}/textures/${parsed.path}.png`;
  if (parsed.path.startsWith("textures/")) {
    return [
      direct,
      `assets/${parsed.namespace}/${parsed.path}.png`,
    ];
  }

  return [direct];
};

const parseFaceDescriptor = (fileStem: string): { baseStem: string; descriptor: TextureDescriptor } => {
  const parsed = FACE_PATTERN.exec(fileStem);
  if (!parsed) {
    return { baseStem: fileStem, descriptor: "all" };
  }

  const leading = parsed[1] ?? "";
  const token = (parsed[2] ?? "").toLowerCase();
  const trailing = parsed[3] ?? "";
  const descriptor = FACE_TOKEN_MAP[token] ?? "all";
  const baseStem = [leading, trailing].filter(Boolean).join("_").trim() || fileStem;

  return { baseStem, descriptor };
};

const setTextureForSlot = (
  textures: BlockTextureMap,
  slotScores: Partial<Record<TextureSlot, number>>,
  slot: TextureSlot,
  dataUrl: string,
  priority: number
) => {
  const currentScore = slotScores[slot] ?? -1;
  if (priority < currentScore) return;

  slotScores[slot] = priority;
  textures[slot] = dataUrl;
};

const setTextureProfileSlot = (
  profile: ConduitTextureProfile,
  profileScores: Partial<Record<ConduitTextureProfileSlot, number>>,
  slot: ConduitTextureProfileSlot,
  dataUrl: string,
  priority: number
) => {
  const currentScore = profileScores[slot] ?? -1;
  if (priority < currentScore) return;

  profileScores[slot] = priority;
  profile[slot] = dataUrl;
};

const tokenizeStem = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const hasAnyToken = (tokens: string[], checks: string[]) =>
  checks.some((check) => tokens.includes(check));

const applyConduitProfileFromCandidate = (
  profile: ConduitTextureProfile,
  profileScores: Partial<Record<ConduitTextureProfileSlot, number>>,
  rawStem: string,
  descriptor: TextureDescriptor,
  dataUrl: string
) => {
  const tokens = tokenizeStem(rawStem);

  if (hasAnyToken(tokens, ["open", "end", "cap", "disconnected", "terminal"])) {
    setTextureProfileSlot(profile, profileScores, "armCapOpen", dataUrl, 3);
  }

  if (hasAnyToken(tokens, ["connected", "join", "junction", "linked", "connection"])) {
    setTextureProfileSlot(profile, profileScores, "armCapConnected", dataUrl, 3);
  }

  if (hasAnyToken(tokens, ["vertical", "vert"])) {
    setTextureProfileSlot(profile, profileScores, "armSideVertical", dataUrl, 3);
  }

  if (hasAnyToken(tokens, ["horizontal", "horiz"])) {
    setTextureProfileSlot(profile, profileScores, "armSideHorizontal", dataUrl, 3);
  }

  if (hasAnyToken(tokens, ["arm", "segment", "line"])) {
    setTextureProfileSlot(profile, profileScores, "armSide", dataUrl, 2);
  }

  if (descriptor === "top") {
    setTextureProfileSlot(profile, profileScores, "coreTop", dataUrl, 1);
    return;
  }

  if (descriptor === "bottom") {
    setTextureProfileSlot(profile, profileScores, "coreBottom", dataUrl, 1);
    return;
  }

  if (descriptor === "all") {
    setTextureProfileSlot(profile, profileScores, "coreSide", dataUrl, 0);
    setTextureProfileSlot(profile, profileScores, "coreTop", dataUrl, 0);
    setTextureProfileSlot(profile, profileScores, "coreBottom", dataUrl, 0);
    return;
  }

  setTextureProfileSlot(profile, profileScores, "coreSide", dataUrl, 1);
};

const hasAnyTextureProfileSlot = (profile: ConduitTextureProfile) =>
  CONDUIT_TEXTURE_PROFILE_SLOTS.some((slot) => Boolean(profile[slot]));

const finalizeConduitTextureProfile = (
  profile: ConduitTextureProfile,
  textures: BlockTextureMap
): ConduitTextureProfile | undefined => {
  const coreSideFallback =
    profile.coreSide ??
    textures.all ??
    textures.front ??
    textures.right ??
    textures.left;
  const coreTopFallback =
    profile.coreTop ??
    textures.top ??
    textures.all ??
    coreSideFallback;
  const coreBottomFallback =
    profile.coreBottom ??
    textures.bottom ??
    textures.all ??
    coreSideFallback;
  const armSideFallback =
    profile.armSide ??
    profile.armSideHorizontal ??
    profile.armSideVertical ??
    coreSideFallback;
  const armSideHorizontalFallback =
    profile.armSideHorizontal ??
    armSideFallback;
  const armSideVerticalFallback =
    profile.armSideVertical ??
    armSideFallback;
  const armCapOpenFallback =
    profile.armCapOpen ??
    textures.front ??
    textures.back ??
    coreSideFallback;
  const armCapConnectedFallback =
    profile.armCapConnected ??
    armCapOpenFallback;

  const resolved: ConduitTextureProfile = {
    coreSide: coreSideFallback,
    coreTop: coreTopFallback,
    coreBottom: coreBottomFallback,
    armSide: armSideFallback,
    armSideHorizontal: armSideHorizontalFallback,
    armSideVertical: armSideVerticalFallback,
    armCapOpen: armCapOpenFallback,
    armCapConnected: armCapConnectedFallback,
  };

  return hasAnyTextureProfileSlot(resolved) ? resolved : undefined;
};

const resolveConduitTextureProfileForEditor = (
  definition: BlockDefinition
): ConduitTextureProfile => {
  const profile = definition.textureProfile ?? {};
  const textures = definition.textures ?? {};

  const coreSide =
    profile.coreSide ??
    textures.all ??
    textures.front ??
    textures.right ??
    textures.left;
  const coreTop =
    profile.coreTop ??
    textures.top ??
    textures.all ??
    coreSide;
  const coreBottom =
    profile.coreBottom ??
    textures.bottom ??
    textures.all ??
    coreSide;
  const armSide =
    profile.armSide ??
    profile.armSideHorizontal ??
    profile.armSideVertical ??
    coreSide;
  const armSideHorizontal =
    profile.armSideHorizontal ??
    armSide;
  const armSideVertical =
    profile.armSideVertical ??
    armSide;
  const armCapOpen =
    profile.armCapOpen ??
    textures.front ??
    textures.back ??
    coreSide;
  const armCapConnected =
    profile.armCapConnected ??
    armCapOpen;

  return {
    coreSide,
    coreTop,
    coreBottom,
    armSide,
    armSideHorizontal,
    armSideVertical,
    armCapOpen,
    armCapConnected,
  };
};

const resolveTexturesForTypeEditor = (definition: BlockDefinition): BlockTextureMap => {
  const textures = definition.textures ?? {};
  const normalized: BlockTextureMap = {};

  TYPE_TEXTURE_SLOTS.forEach((slot) => {
    const value = textures[slot];
    if (typeof value === "string" && value.trim() !== "") {
      normalized[slot] = value.trim();
    }
  });

  return normalized;
};

const resolveRenderModeForTypeEditor = (definition: BlockDefinition): BlockRenderMode =>
  definition.renderMode === "conduit" ? "conduit" : "cube";

const toTextureSourceOptions = (
  textures: BlockTextureMap,
  profile: ConduitTextureProfile
): TextureSourceOption[] => {
  const result: TextureSourceOption[] = [];
  const seen = new Set<string>();

  const push = (id: string, label: string, value: string | undefined) => {
    if (!value) return;
    if (seen.has(value)) return;
    seen.add(value);
    result.push({ id, label, value });
  };

  push("face-all", "Face: all", textures.all);
  push("face-right", "Face: right", textures.right);
  push("face-left", "Face: left", textures.left);
  push("face-top", "Face: top", textures.top);
  push("face-bottom", "Face: bottom", textures.bottom);
  push("face-front", "Face: front", textures.front);
  push("face-back", "Face: back", textures.back);

  CONDUIT_TEXTURE_PROFILE_SLOTS.forEach((slot) => {
    push(`profile-${slot}`, `Profile: ${CONDUIT_TEXTURE_PROFILE_SLOT_LABELS[slot]}`, profile[slot]);
  });

  return result;
};

const applyTextureDescriptor = (
  textures: BlockTextureMap,
  slotScores: Partial<Record<TextureSlot, number>>,
  descriptor: TextureDescriptor,
  dataUrl: string
) => {
  if (descriptor === "all") {
    setTextureForSlot(textures, slotScores, "all", dataUrl, 0);
    return;
  }

  if (descriptor === "side") {
    setTextureForSlot(textures, slotScores, "front", dataUrl, 1);
    setTextureForSlot(textures, slotScores, "back", dataUrl, 1);
    setTextureForSlot(textures, slotScores, "left", dataUrl, 1);
    setTextureForSlot(textures, slotScores, "right", dataUrl, 1);
    return;
  }

  setTextureForSlot(textures, slotScores, descriptor, dataUrl, 2);
};

const buildFaceSummary = (textures: BlockTextureMap) => {
  const faces: string[] = [];
  if (textures.all) faces.push("all");
  if (textures.front) faces.push("front");
  if (textures.back) faces.push("back");
  if (textures.left) faces.push("left");
  if (textures.right) faces.push("right");
  if (textures.top) faces.push("top");
  if (textures.bottom) faces.push("bottom");
  return faces.join(", ");
};

const extractArchiveEntries = (archiveData: Uint8Array) => {
  const extracted = unzipSync(archiveData);
  const entries: JarEntryMap = {};

  Object.entries(extracted).forEach(([entryName, entryBytes]) => {
    entries[sanitizeJarEntryName(entryName)] = entryBytes;
  });

  return entries;
};

const extractJarTextureCandidates = (archiveEntries: JarEntryMap) => {
  const candidates: JarTextureCandidate[] = [];
  const texturePathPattern =
    /^assets\/(mekanism|mekanismgenerators)\/textures\/block\/(.+)\.png$/i;

  Object.entries(archiveEntries).forEach(([entryName, entryBytes]) => {
    const normalized = sanitizeJarEntryName(entryName);
    const matched = texturePathPattern.exec(normalized);
    if (!matched) return;
    if (!hasPrefix(entryBytes, PNG_SIGNATURE)) return;

    const namespace = matched[1].toLowerCase();
    const relativePath = matched[2];
    const fileName = normalized.split("/").pop() ?? normalized;

    candidates.push({
      path: normalized,
      fileName,
      bytes: entryBytes,
      namespace,
      relativePath,
    });
  });

  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return candidates;
};

const buildJarTextureGroups = (candidates: JarTextureCandidate[]) => {
  const grouped = new Map<string, JarTextureGroupBuildState>();

  candidates.forEach((candidate) => {
    const segments = candidate.relativePath.split("/");
    const rawStem = segments[segments.length - 1];
    const directory = segments.slice(0, -1).join("/");
    const parsedFace = parseFaceDescriptor(rawStem);
    const baseStem = parsedFace.baseStem;

    const key = [candidate.namespace, directory, baseStem].filter(Boolean).join("/");
    const groupLabel = [candidate.namespace, directory].filter(Boolean).join("/");
    const typeId = toTypeId(candidate.namespace, directory, baseStem);

    let group = grouped.get(key);
    if (!group) {
      group = {
        key,
        typeId,
        displayName: toDisplayName(baseStem) || baseStem,
        groupLabel: groupLabel || candidate.namespace,
        textures: {},
        textureProfile: {},
        slotScores: {},
        profileScores: {},
        sourcePaths: new Set<string>(),
      };
      grouped.set(key, group);
    }

    const dataUrl = pngBytesToDataUrl(candidate.bytes);

    applyTextureDescriptor(
      group.textures,
      group.slotScores,
      parsedFace.descriptor,
      dataUrl
    );
    applyConduitProfileFromCandidate(
      group.textureProfile,
      group.profileScores,
      rawStem,
      parsedFace.descriptor,
      dataUrl
    );
    group.sourcePaths.add(candidate.path);
  });

  return Array.from(grouped.values())
    .map((group) => ({
      key: group.key,
      typeId: group.typeId,
      displayName: group.displayName,
      groupLabel: group.groupLabel,
      textures: group.textures,
      textureProfile: finalizeConduitTextureProfile(group.textureProfile, group.textures),
      sourcePaths: Array.from(group.sourcePaths).sort(),
      faceSummary: buildFaceSummary(group.textures),
    }))
    .sort((a, b) =>
      a.groupLabel === b.groupLabel
        ? a.displayName.localeCompare(b.displayName)
        : a.groupLabel.localeCompare(b.groupLabel)
    );
};

const getModelReferenceFromVariant = (value: unknown): string | null => {
  if (isRecord(value) && typeof value.model === "string") {
    const trimmed = value.model.trim();
    return trimmed === "" ? null : trimmed;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = getModelReferenceFromVariant(entry);
      if (parsed) return parsed;
    }
  }

  return null;
};

const getDefaultModelReferenceFromBlockstate = (value: unknown): string | null => {
  if (!isRecord(value) || !isRecord(value.variants)) return null;

  const variants = value.variants;
  const exact = getModelReferenceFromVariant(variants[""]);
  if (exact) return exact;

  for (const entry of Object.values(variants)) {
    const parsed = getModelReferenceFromVariant(entry);
    if (parsed) return parsed;
  }

  return null;
};

const resolveModelTextureReference = (
  textures: Record<string, unknown>,
  key: string,
  depth = 0
): string | null => {
  if (depth > 12) return null;

  const value = textures[key];
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!trimmed.startsWith("#")) return trimmed;

  const nextKey = trimmed.slice(1);
  if (nextKey === "") return null;
  return resolveModelTextureReference(textures, nextKey, depth + 1);
};

const resolveTextureDataUrlFromResource = (
  resource: string,
  archiveEntries: JarEntryMap
): { dataUrl: string; path: string } | null => {
  const candidates = toTexturePathCandidatesFromResource(resource);
  for (const path of candidates) {
    const bytes = archiveEntries[path];
    if (!bytes || !hasPrefix(bytes, PNG_SIGNATURE)) continue;

    return {
      dataUrl: pngBytesToDataUrl(bytes),
      path,
    };
  }

  return null;
};

const buildMekanismTransmitterGroups = (archiveEntries: JarEntryMap) => {
  const groups: JarTextureGroup[] = [];

  Object.entries(archiveEntries).forEach(([entryPath, bytes]) => {
    const matchedBlockstate = BLOCKSTATE_PATH_PATTERN.exec(entryPath);
    if (!matchedBlockstate) return;

    const blockId = matchedBlockstate[1].toLowerCase();
    const parsedBlockstate = tryParseJson(bytes);
    const modelReference = getDefaultModelReferenceFromBlockstate(parsedBlockstate);
    if (!modelReference || !modelReference.startsWith(TRANSMITTER_MODEL_PREFIX)) return;

    const modelPath = toModelPathFromResource(modelReference);
    if (!modelPath) return;

    const modelBytes = archiveEntries[modelPath];
    if (!modelBytes) return;

    const modelJson = tryParseJson(modelBytes);
    if (!isRecord(modelJson) || !isRecord(modelJson.textures)) return;

    const modelTextures = modelJson.textures;
    const sideRef = resolveModelTextureReference(modelTextures, "side");
    const centerRef =
      resolveModelTextureReference(modelTextures, "center_down") ??
      resolveModelTextureReference(modelTextures, "center") ??
      resolveModelTextureReference(modelTextures, "particle");

    const sideTexture = sideRef
      ? resolveTextureDataUrlFromResource(sideRef, archiveEntries)
      : null;
    const centerTexture = centerRef
      ? resolveTextureDataUrlFromResource(centerRef, archiveEntries)
      : null;

    if (!sideTexture && !centerTexture) return;

    const centerSource = centerTexture?.dataUrl ?? sideTexture?.dataUrl;
    const sideSource = sideTexture?.dataUrl ?? centerTexture?.dataUrl;
    const coreSource = centerSource ?? sideSource;
    const armSource = sideSource ?? centerSource;
    const armCapOpenSource = centerSource ?? sideSource;
    const armCapConnectedSource = sideSource ?? centerSource;
    const textures: BlockTextureMap = coreSource ? { all: coreSource } : {};
    const profile = finalizeConduitTextureProfile(
      {
        coreSide: coreSource,
        coreTop: coreSource,
        coreBottom: coreSource,
        armSide: armSource,
        armSideHorizontal: armSource,
        armSideVertical: armSource,
        armCapOpen: armCapOpenSource,
        armCapConnected: armCapConnectedSource,
      },
      textures
    );

    const sourcePaths = [
      entryPath,
      modelPath,
      centerTexture?.path,
      sideTexture?.path,
    ].filter((value): value is string => Boolean(value));

    groups.push({
      key: `mekanism/transmitter/${blockId}`,
      typeId: toTypeId("mekanism", "transmitter", blockId),
      displayName: toDisplayName(blockId) || blockId,
      groupLabel: "mekanism/transmitter",
      textures,
      textureProfile: profile,
      sourcePaths: Array.from(new Set(sourcePaths)).sort(),
      faceSummary: buildFaceSummary(textures),
    });
  });

  return groups
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .filter((group, index, array) => array.findIndex((item) => item.typeId === group.typeId) === index);
};

const mergeJarTextureGroups = (base: JarTextureGroup[], extra: JarTextureGroup[]) => {
  if (extra.length === 0) return base;

  const byTypeId = new Map<string, JarTextureGroup>();
  base.forEach((group) => byTypeId.set(group.typeId, group));

  extra.forEach((group) => {
    const existing = byTypeId.get(group.typeId);
    if (!existing) {
      byTypeId.set(group.typeId, group);
      return;
    }

    byTypeId.set(group.typeId, {
      ...existing,
      ...group,
      textures: {
        ...existing.textures,
        ...group.textures,
      },
      textureProfile: group.textureProfile ?? existing.textureProfile,
      sourcePaths: Array.from(new Set([...existing.sourcePaths, ...group.sourcePaths])).sort(),
      faceSummary: group.faceSummary || existing.faceSummary,
    });
  });

  return Array.from(byTypeId.values()).sort((a, b) =>
    a.groupLabel === b.groupLabel
      ? a.displayName.localeCompare(b.displayName)
      : a.groupLabel.localeCompare(b.groupLabel)
  );
};

const filterGroups = (groups: JarTextureGroup[], filterText: string) => {
  const tokens = filterText
    .split(",")
    .flatMap((entry) => entry.trim().toLowerCase().split(/\s+/))
    .filter(Boolean);

  if (tokens.length === 0) return groups;

  return groups.filter((group) =>
    tokens.every((token) => {
      const text = `${group.displayName} ${group.groupLabel} ${group.typeId} ${group.faceSummary}`.toLowerCase();
      return text.includes(token);
    })
  );
};

const inferScaleForGroup = (group: JarTextureGroup): Vec3 | undefined => {
  const haystack = `${group.displayName} ${group.groupLabel} ${group.typeId}`.toLowerCase();
  const shouldUseCompactScale = COMPACT_RENDER_KEYWORDS.some((keyword) =>
    haystack.includes(keyword)
  );

  if (!shouldUseCompactScale) {
    return undefined;
  }

  return { ...COMPACT_RENDER_SCALE };
};

const inferConnectTagForGroup = (group: JarTextureGroup): string | undefined => {
  const haystack = `${group.displayName} ${group.groupLabel} ${group.typeId}`.toLowerCase();

  for (const profile of CONNECTION_PROFILE_PATTERNS) {
    if (profile.tokens.some((token) => haystack.includes(token))) {
      return profile.connectTag;
    }
  }

  return undefined;
};

const inferRenderModeForGroup = (group: JarTextureGroup): BlockRenderMode | undefined => {
  const compactScale = inferScaleForGroup(group);
  if (compactScale) return "conduit";
  return undefined;
};

interface BlockTypeManagerProps {
  initialFolder?: string;
}

type AssetsContextMenuTarget =
  | { kind: "browser" }
  | { kind: "folder"; folderPath: string };

const BlockTypeManager = ({
  initialFolder = DEFAULT_ASSET_TEXTURES_FOLDER,
}: BlockTypeManagerProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textureProfileFileInputRef = useRef<HTMLInputElement | null>(null);
  const typeTextureFileInputRef = useRef<HTMLInputElement | null>(null);
  const [jarImportState, setJarImportState] = useState<JarImportState | null>(null);
  const [textureProfileEditor, setTextureProfileEditor] = useState<TextureProfileEditorState | null>(null);
  const [typeEditor, setTypeEditor] = useState<TypeEditorState | null>(null);
  const [selectedFolder, setSelectedFolder] = useState(normalizeFolderPath(initialFolder));
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [assetsContextMenu, setAssetsContextMenu] = useState<{
    x: number;
    y: number;
    target: AssetsContextMenuTarget;
  } | null>(null);
  const managerContainerRef = useRef<HTMLDivElement | null>(null);
  const assetsEntryGridRef = useRef<HTMLDivElement | null>(null);
  const pendingTypeDragRef = useRef<{
    typeId: string;
    startX: number;
    startY: number;
  } | null>(null);
  const [dragHoverFolderPath, setDragHoverFolderPath] = useState<string | null>(null);
  const [customDraggingTypeId, setCustomDraggingTypeId] = useState<string | null>(null);
  const [dragPreviewPosition, setDragPreviewPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [isAssetDragActive, setIsAssetDragActive] = useState(false);
  const definitions = useBlockTypesStore((s) => s.definitions);
  const configuredAssetFolders = useBlockTypesStore((s) => s.assetFolders);
  const importPackFromString = useBlockTypesStore((s) => s.importPackFromString);
  const createTypeFromSingleTexture = useBlockTypesStore((s) => s.createTypeFromSingleTexture);
  const createCustomObjectType = useBlockTypesStore((s) => s.createCustomObjectType);
  const updateTypeDefinition = useBlockTypesStore((s) => s.updateTypeDefinition);
  const deleteTypeDefinition = useBlockTypesStore((s) => s.deleteTypeDefinition);
  const addAssetFolder = useBlockTypesStore((s) => s.addAssetFolder);
  const renameAssetFolder = useBlockTypesStore((s) => s.renameAssetFolder);
  const removeAssetFolder = useBlockTypesStore((s) => s.removeAssetFolder);
  const setTextureProfile = useBlockTypesStore((s) => s.setTextureProfile);
  const getTypeDefinition = useBlockTypesStore((s) => s.getDefinition);
  const exportPackToString = useBlockTypesStore((s) => s.exportPackToString);

  const allVisibleDefinitions = useMemo(
    () => definitions.filter((definition) => !definition.internal),
    [definitions]
  );
  const assetFolders = useMemo(() => {
    const folders = new Set<string>(DEFAULT_ASSET_FOLDERS);

    configuredAssetFolders.forEach((folder) => {
      const normalized = normalizeFolderPath(folder);
      toFolderParents(normalized).forEach((parent) => folders.add(parent));
    });

    allVisibleDefinitions.forEach((definition) => {
      const normalized = normalizeFolderPath(definition.group);
      toFolderParents(normalized).forEach((folder) => folders.add(folder));
    });

    return Array.from(folders).sort((a, b) => a.localeCompare(b));
  }, [allVisibleDefinitions, configuredAssetFolders]);

  const effectiveSelectedFolder = assetFolders.includes(selectedFolder)
    ? selectedFolder
    : DEFAULT_ASSET_TEXTURES_FOLDER;
  const folderBreadcrumbs = useMemo(
    () => toFolderBreadcrumbs(effectiveSelectedFolder),
    [effectiveSelectedFolder]
  );
  const directChildFolders = useMemo(
    () => getDirectChildFolders(assetFolders, effectiveSelectedFolder),
    [assetFolders, effectiveSelectedFolder]
  );
  const parentFolder =
    effectiveSelectedFolder === DEFAULT_ASSET_ROOT
      ? null
      : normalizeFolderPath(toParentFolder(effectiveSelectedFolder));

  const visibleDefinitions = useMemo(() => {
    const normalizedSelectedFolder = normalizeFolderPath(effectiveSelectedFolder);

    return allVisibleDefinitions.filter((definition) => {
      const folder = normalizeFolderPath(definition.group);
      return folder === normalizedSelectedFolder;
    });
  }, [allVisibleDefinitions, effectiveSelectedFolder]);
  const customDraggingDefinition = useMemo(() => {
    if (!customDraggingTypeId) return null;
    return allVisibleDefinitions.find((definition) => definition.id === customDraggingTypeId) ?? null;
  }, [allVisibleDefinitions, customDraggingTypeId]);
  const filteredJarGroups = useMemo(() => {
    if (!jarImportState) return [];
    return filterGroups(jarImportState.groups, jarImportState.filterText);
  }, [jarImportState]);
  const textureSourceOptions = useMemo(() => {
    if (!textureProfileEditor) return [];
    return toTextureSourceOptions(textureProfileEditor.textures, textureProfileEditor.profile);
  }, [textureProfileEditor]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const openTypeEditor = useCallback((definition: BlockDefinition) => {
    if (definition.internal) return;

    setTypeEditor({
      typeId: definition.id,
      displayName: definition.displayName,
      group: definition.group ?? "",
      renderMode: resolveRenderModeForTypeEditor(definition),
      connectTag: definition.connectTag ?? "",
      textures: resolveTexturesForTypeEditor(definition),
      pendingTextureSlot: null,
    });
  }, []);

  const closeTypeEditor = () => {
    setTypeEditor(null);
  };

  const updateTypeTextureSlot = (slot: TypeTextureSlot, value: string) => {
    setTypeEditor((current) =>
      current
        ? {
            ...current,
            textures: {
              ...current.textures,
              [slot]: value,
            },
          }
        : current
    );
  };

  const clearTypeTextureSlot = (slot: TypeTextureSlot) => {
    setTypeEditor((current) => {
      if (!current) return current;
      const nextTextures = { ...current.textures };
      delete nextTextures[slot];

      return {
        ...current,
        textures: nextTextures,
      };
    });
  };

  const openTypeTextureFilePicker = (slot: TypeTextureSlot) => {
    setTypeEditor((current) =>
      current
        ? {
            ...current,
            pendingTextureSlot: slot,
          }
        : current
    );
    typeTextureFileInputRef.current?.click();
  };

  const handleTypeTextureFileChange = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const current = typeEditor;
    if (!current || !current.pendingTextureSlot) return;
    const targetSlot = current.pendingTextureSlot;

    const kind = await detectImportKind(file);
    if (kind !== "png") {
      logWarn(SOURCE, `Block type texture slot only accepts PNG. Ignored "${file.name}".`);
      setTypeEditor((editor) =>
        editor
          ? {
              ...editor,
              pendingTextureSlot: null,
            }
          : editor
      );
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setTypeEditor((editor) =>
        editor
          ? {
              ...editor,
              textures: {
                ...editor.textures,
                [targetSlot]: dataUrl,
              },
              pendingTextureSlot: null,
            }
          : editor
      );
    } catch {
      logError(SOURCE, `Failed to read texture file "${file.name}".`);
      setTypeEditor((editor) =>
        editor
          ? {
              ...editor,
              pendingTextureSlot: null,
            }
          : editor
      );
    }
  };

  const saveTypeEditor = () => {
    if (!typeEditor) return;
    const ok = updateTypeDefinition(typeEditor.typeId, {
      displayName: typeEditor.displayName,
      group: typeEditor.group,
      renderMode: typeEditor.renderMode,
      connectTag: typeEditor.renderMode === "conduit" ? typeEditor.connectTag : undefined,
      textures: typeEditor.textures,
    });
    if (!ok) return;
    closeTypeEditor();
  };

  const handleCreateCustomObject = useCallback(() => {
    const createdId = createCustomObjectType();
    const created = getTypeDefinition(createdId);
    if (created.internal) return;
    openTypeEditor(created);
  }, [createCustomObjectType, getTypeDefinition, openTypeEditor]);

  const moveTypeToFolder = useCallback((typeId: string, folder: string) => {
    const normalizedFolder = normalizeFolderPath(folder);
    const ok = updateTypeDefinition(typeId, {
      group: normalizedFolder,
    });

    if (ok) {
      logInfo(SOURCE, `Moved "${typeId}" to "${normalizedFolder}".`);
    }
  }, [updateTypeDefinition]);

  const resolveHoveredFolderPathFromTarget = useCallback((target: EventTarget | null) => {
    const element = target instanceof HTMLElement ? target : null;
    const folderElement = element?.closest<HTMLElement>("[data-folder-path]");
    const folderPath = folderElement?.dataset.folderPath;
    return folderPath ? normalizeFolderPath(folderPath) : null;
  }, []);

  const resolveHoveredFolderPathFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const element = document.elementFromPoint(clientX, clientY);
      return resolveHoveredFolderPathFromTarget(element);
    },
    [resolveHoveredFolderPathFromTarget]
  );

  // Scroll the assets grid when dragging near its edges so distant folders stay reachable.
  const autoScrollAssetsGridFromPointer = useCallback((clientX: number, clientY: number) => {
    const container = assetsEntryGridRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const edgeSize = 56;
    const maxStep = 28;

    const resolveDelta = (pointer: number, minEdge: number, maxEdge: number) => {
      const startThreshold = minEdge + edgeSize;
      const endThreshold = maxEdge - edgeSize;

      if (pointer < startThreshold) {
        const distance = Math.min(startThreshold - pointer, edgeSize);
        return -Math.ceil((distance / edgeSize) * maxStep);
      }

      if (pointer > endThreshold) {
        const distance = Math.min(pointer - endThreshold, edgeSize);
        return Math.ceil((distance / edgeSize) * maxStep);
      }

      return 0;
    };

    const deltaY = resolveDelta(clientY, rect.top, rect.bottom);
    const deltaX = resolveDelta(clientX, rect.left, rect.right);

    if (deltaY !== 0) {
      container.scrollTop += deltaY;
    }
    if (deltaX !== 0) {
      container.scrollLeft += deltaX;
    }
  }, []);

  const handleAssetsEntryGridDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasInternalAssetDragPayload(event.dataTransfer)) return;
    event.preventDefault();

    const hoveredFolderPath = resolveHoveredFolderPathFromTarget(event.target);
    setDragHoverFolderPath((current) =>
      current === hoveredFolderPath ? current : hoveredFolderPath
    );
    autoScrollAssetsGridFromPointer(event.clientX, event.clientY);
  };

  const handleAssetsEntryGridDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setDragHoverFolderPath(null);
  };

  const endAssetDragInteraction = useCallback(() => {
    setIsAssetDragActive(false);
    setDragHoverFolderPath(null);
    setCustomDraggingTypeId(null);
    setDragPreviewPosition(null);
    pendingTypeDragRef.current = null;
  }, []);

  const handleAssetsEntryGridWheelCapture = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const handleTypeTileMouseDown = (
    event: ReactMouseEvent<HTMLDivElement>,
    typeId: string
  ) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, input, textarea, select")) {
      return;
    }

    // Keep this as "pending" until movement threshold is exceeded, so clicks still behave like clicks.
    pendingTypeDragRef.current = {
      typeId,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  useEffect(() => {
    const handleWindowMouseMove = (event: MouseEvent) => {
      const pending = pendingTypeDragRef.current;
      if (!pending && !customDraggingTypeId) {
        return;
      }

      const nextDraggingTypeId = customDraggingTypeId ?? pending?.typeId ?? null;
      if (!nextDraggingTypeId) return;

      if (pending && !customDraggingTypeId) {
        const distance = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
        if (distance < 4) {
          return;
        }

        // Promote pending drag to active drag only after intentional pointer movement.
        setCustomDraggingTypeId(nextDraggingTypeId);
        setIsAssetDragActive(true);
      }

      event.preventDefault();
      setDragPreviewPosition((current) =>
        current?.x === event.clientX && current?.y === event.clientY
          ? current
          : {
              x: event.clientX,
              y: event.clientY,
            }
      );
      const hoveredFolderPath = resolveHoveredFolderPathFromPoint(event.clientX, event.clientY);
      setDragHoverFolderPath((current) =>
        current === hoveredFolderPath ? current : hoveredFolderPath
      );
      autoScrollAssetsGridFromPointer(event.clientX, event.clientY);
    };

    const handleWindowMouseUp = () => {
      const activeDragTypeId = customDraggingTypeId;
      const targetFolderPath = dragHoverFolderPath;
      const shouldMove = Boolean(activeDragTypeId && targetFolderPath);
      endAssetDragInteraction();

      if (shouldMove && activeDragTypeId && targetFolderPath) {
        moveTypeToFolder(activeDragTypeId, targetFolderPath);
      }
    };

    const handleWindowBlur = () => {
      endAssetDragInteraction();
    };

    window.addEventListener("mousemove", handleWindowMouseMove);
    window.addEventListener("mouseup", handleWindowMouseUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
    autoScrollAssetsGridFromPointer,
    customDraggingTypeId,
    dragHoverFolderPath,
    endAssetDragInteraction,
    moveTypeToFolder,
    resolveHoveredFolderPathFromPoint,
  ]);

  const handleAssetDropOnFolder = (
    event: ReactDragEvent<HTMLButtonElement>,
    targetFolder: string
  ) => {
    event.preventDefault();
    endAssetDragInteraction();
    const normalizedTargetFolder = normalizeFolderPath(targetFolder);
    const typeId = event.dataTransfer.getData("text/x-block-type-id");
    if (typeId) {
      moveTypeToFolder(typeId, normalizedTargetFolder);
      return;
    }

    const sourceFolder = event.dataTransfer.getData("text/x-asset-folder");
    if (!sourceFolder) return;
    const normalizedSource = normalizeFolderPath(sourceFolder);
    if (normalizedSource === normalizedTargetFolder) return;
    if (normalizedTargetFolder.startsWith(`${normalizedSource}/`)) {
      logWarn(SOURCE, "Cannot move folder into its own subtree.");
      return;
    }
    if (PROTECTED_ASSET_FOLDERS.has(normalizedSource)) {
      logWarn(SOURCE, `Folder "${normalizedSource}" is protected.`);
      return;
    }

    const targetFolderPath = normalizeFolderPath(
      `${normalizedTargetFolder}/${toFolderName(normalizedSource)}`
    );
    remapFolderPrefix(normalizedSource, targetFolderPath);
  };

  const remapFolderPrefix = (
    sourceFolder: string,
    targetFolder: string
  ) => {
    const normalizedSource = normalizeFolderPath(sourceFolder);
    const normalizedTarget = normalizeFolderPath(targetFolder);

    if (normalizedSource === normalizedTarget) {
      return true;
    }

    if (normalizedTarget.startsWith(`${normalizedSource}/`)) {
      logWarn(SOURCE, "Cannot move folder into its own subtree.");
      return false;
    }

    const sourcePrefix = `${normalizedSource}/`;
    let movedCount = 0;

    allVisibleDefinitions.forEach((definition) => {
      const currentFolder = normalizeFolderPath(definition.group);
      if (currentFolder !== normalizedSource && !currentFolder.startsWith(sourcePrefix)) {
        return;
      }

      const suffix =
        currentFolder === normalizedSource
          ? ""
          : currentFolder.slice(normalizedSource.length);
      const nextFolder = normalizeFolderPath(`${normalizedTarget}${suffix}`);
      const ok = updateTypeDefinition(definition.id, {
        group: nextFolder,
      });

      if (ok) {
        movedCount += 1;
      }
    });

    addAssetFolder(normalizedTarget);
    renameAssetFolder(normalizedSource, normalizedTarget);
    setSelectedFolder(normalizedTarget);
    logInfo(
      SOURCE,
      `Folder "${normalizedSource}" was moved to "${normalizedTarget}" (${movedCount} item(s) updated).`
    );
    return true;
  };

  const canModifyFolder = (folderPath: string) => !PROTECTED_ASSET_FOLDERS.has(folderPath);

  const handleCreateFolderAt = (baseFolder: string) => {
    const normalizedBase = normalizeFolderPath(baseFolder);
    const suggested = `${normalizedBase}/new_folder`;
    const input = window.prompt("Enter folder path:", suggested);
    if (!input) return;

    const normalizedFolder = addAssetFolder(input);
    if (!normalizedFolder) {
      return;
    }

    setSelectedFolder(normalizedFolder);
  };

  const handleRenameFolderAt = (folderPath: string) => {
    const normalizedFolder = normalizeFolderPath(folderPath);
    if (!canModifyFolder(normalizedFolder)) {
      logWarn(SOURCE, `Folder "${normalizedFolder}" is protected.`);
      return;
    }

    const input = window.prompt("Rename folder to:", normalizedFolder);
    if (!input) return;

    const normalizedTarget = normalizeFolderPath(input);
    remapFolderPrefix(normalizedFolder, normalizedTarget);
  };

  const handleDeleteFolderAt = (folderPath: string) => {
    const normalizedFolder = normalizeFolderPath(folderPath);
    if (!canModifyFolder(normalizedFolder)) {
      logWarn(SOURCE, `Folder "${normalizedFolder}" is protected.`);
      return;
    }

    const fallbackFolder = normalizeFolderPath(toParentFolder(normalizedFolder));
    const folderPrefix = `${normalizedFolder}/`;
    const affected = allVisibleDefinitions.filter((definition) => {
      const folder = normalizeFolderPath(definition.group);
      return folder === normalizedFolder || folder.startsWith(folderPrefix);
    });
    const confirmed = window.confirm(
      affected.length > 0
        ? `Delete folder "${normalizedFolder}" and move ${affected.length} item(s) to "${fallbackFolder}"?`
        : `Delete empty folder "${normalizedFolder}"?`
    );
    if (!confirmed) return;

    let movedCount = 0;
    affected.forEach((definition) => {
      const currentFolder = normalizeFolderPath(definition.group);
      const suffix =
        currentFolder === normalizedFolder
          ? ""
          : currentFolder.slice(normalizedFolder.length);
      const nextFolder = normalizeFolderPath(`${fallbackFolder}${suffix}`);
      const ok = updateTypeDefinition(definition.id, {
        group: nextFolder,
      });
      if (ok) {
        movedCount += 1;
      }
    });

    removeAssetFolder(normalizedFolder);
    setSelectedFolder(fallbackFolder);
    logInfo(
      SOURCE,
      `Deleted folder "${normalizedFolder}" and moved ${movedCount} item(s) to "${fallbackFolder}".`
    );
  };

  const commitRename = (definition: BlockDefinition) => {
    const draft = renameDrafts[definition.id];
    if (draft === undefined) return;

    const nextDisplayName = draft.trim();
    if (nextDisplayName === "" || nextDisplayName === definition.displayName) {
      setRenameDrafts((current) => {
        const next = { ...current };
        delete next[definition.id];
        return next;
      });
      return;
    }

    const ok = updateTypeDefinition(definition.id, {
      displayName: nextDisplayName,
    });

    if (!ok) return;
    setRenameDrafts((current) => {
      const next = { ...current };
      delete next[definition.id];
      return next;
    });
  };

  const startRename = (definition: BlockDefinition) => {
    setRenameDrafts((current) => ({
      ...current,
      [definition.id]: definition.displayName,
    }));
  };

  const removeType = (definition: BlockDefinition) => {
    const confirmed = window.confirm(`Delete block type "${definition.displayName}"?`);
    if (!confirmed) return;
    deleteTypeDefinition(definition.id);
  };

  const openTextureProfileEditor = (definition: BlockDefinition) => {
    if (definition.renderMode !== "conduit") return;

    setTextureProfileEditor({
      typeId: definition.id,
      displayName: definition.displayName,
      textures: definition.textures ?? {},
      profile: resolveConduitTextureProfileForEditor(definition),
      pendingSlot: null,
    });
  };

  const closeTextureProfileEditor = () => {
    setTextureProfileEditor(null);
  };

  const updateTextureProfileSlot = (
    slot: ConduitTextureProfileSlot,
    value: string
  ) => {
    setTextureProfileEditor((current) =>
      current
        ? {
            ...current,
            profile: {
              ...current.profile,
              [slot]: value,
            },
          }
        : current
    );
  };

  const clearTextureProfileSlot = (slot: ConduitTextureProfileSlot) => {
    setTextureProfileEditor((current) => {
      if (!current) return current;
      const nextProfile = { ...current.profile };
      delete nextProfile[slot];

      return {
        ...current,
        profile: nextProfile,
      };
    });
  };

  const handleTextureSourceSelect = (
    slot: ConduitTextureProfileSlot,
    sourceId: string
  ) => {
    if (!textureProfileEditor || sourceId === "") return;
    const source = textureSourceOptions.find((option) => option.id === sourceId);
    if (!source) return;
    updateTextureProfileSlot(slot, source.value);
  };

  const openTextureProfileSlotFilePicker = (slot: ConduitTextureProfileSlot) => {
    setTextureProfileEditor((current) =>
      current
        ? {
            ...current,
            pendingSlot: slot,
          }
        : current
    );
    textureProfileFileInputRef.current?.click();
  };

  const handleTextureProfileFileChange = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const current = textureProfileEditor;
    if (!current || !current.pendingSlot) return;
    const targetSlot = current.pendingSlot;

    const kind = await detectImportKind(file);
    if (kind !== "png") {
      logWarn(SOURCE, `Texture profile slot only accepts PNG. Ignored "${file.name}".`);
      setTextureProfileEditor((editor) =>
        editor
          ? {
              ...editor,
              pendingSlot: null,
            }
          : editor
      );
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(file);
      setTextureProfileEditor((editor) =>
        editor
          ? {
              ...editor,
              profile: {
                ...editor.profile,
                [targetSlot]: dataUrl,
              },
              pendingSlot: null,
            }
          : editor
      );
    } catch {
      logError(SOURCE, `Failed to read texture file "${file.name}".`);
      setTextureProfileEditor((editor) =>
        editor
          ? {
              ...editor,
              pendingSlot: null,
            }
          : editor
      );
    }
  };

  const saveTextureProfileEditor = () => {
    if (!textureProfileEditor) return;
    const ok = setTextureProfile(textureProfileEditor.typeId, textureProfileEditor.profile);
    if (!ok) return;
    closeTextureProfileEditor();
  };

  const closeJarImportDialog = () => {
    setJarImportState(null);
  };

  const toggleJarGroup = (key: string) => {
    setJarImportState((current) => {
      if (!current) return current;

      const nextSelected = new Set(current.selectedKeys);
      if (nextSelected.has(key)) {
        nextSelected.delete(key);
      } else {
        nextSelected.add(key);
      }

      return {
        ...current,
        selectedKeys: nextSelected,
      };
    });
  };

  const selectVisibleJarGroups = () => {
    setJarImportState((current) => {
      if (!current) return current;

      const visible = filterGroups(current.groups, current.filterText);
      const nextSelected = new Set(current.selectedKeys);
      visible.forEach((group) => nextSelected.add(group.key));

      return {
        ...current,
        selectedKeys: nextSelected,
      };
    });
  };

  const deselectVisibleJarGroups = () => {
    setJarImportState((current) => {
      if (!current) return current;

      const visible = filterGroups(current.groups, current.filterText);
      const nextSelected = new Set(current.selectedKeys);
      visible.forEach((group) => nextSelected.delete(group.key));

      return {
        ...current,
        selectedKeys: nextSelected,
      };
    });
  };

  const selectAllJarGroups = () => {
    setJarImportState((current) => {
      if (!current) return current;
      return {
        ...current,
        selectedKeys: new Set(current.groups.map((group) => group.key)),
      };
    });
  };

  const clearAllJarGroups = () => {
    setJarImportState((current) => {
      if (!current) return current;
      return {
        ...current,
        selectedKeys: new Set<string>(),
      };
    });
  };

  const confirmJarImport = () => {
    const current = jarImportState;
    if (!current) return;

    const selectedGroups = current.groups.filter((group) =>
      current.selectedKeys.has(group.key)
    );

    if (selectedGroups.length === 0) {
      logWarn(SOURCE, `No grouped block textures selected from "${current.sourceFileName}".`);
      return;
    }

    const blockTypes: BlockDefinition[] = selectedGroups.map((group) => {
      const scale = inferScaleForGroup(group);
      const renderMode = inferRenderModeForGroup(group);
      const connectTag = inferConnectTagForGroup(group);
      const textureProfile =
        renderMode === "conduit" ? group.textureProfile : undefined;

      return {
        id: group.typeId,
        displayName: group.displayName,
        color: 0xffffff,
        scale,
        renderMode,
        connectTag,
        textureProfile,
        group: group.groupLabel,
        textures: group.textures,
      };
    });

    const result = importPackFromString(
      JSON.stringify({ blockTypes }),
      `${current.sourceFileName} (grouped textures)`
    );

    if (!result) return;

    logInfo(
      SOURCE,
      `Imported ${selectedGroups.length} grouped block type(s) from "${current.sourceFileName}".`
    );
    closeJarImportDialog();
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
        const dataUrl = await fileToDataUrl(file);
        createTypeFromSingleTexture(file.name, dataUrl, file.name);
        return;
      }

      if (kind === "jar") {
        if (file.size > JAR_FILE_SIZE_LIMIT) {
          logWarn(
            SOURCE,
            `Archive "${file.name}" is larger than ${Math.floor(
              JAR_FILE_SIZE_LIMIT / (1024 * 1024)
            )}MB and was blocked for safety.`
          );
          return;
        }

        const archiveBytes = new Uint8Array(await file.arrayBuffer());
        const archiveEntries = extractArchiveEntries(archiveBytes);
        const textureCandidates = extractJarTextureCandidates(archiveEntries);
        const textureGroups = buildJarTextureGroups(textureCandidates);
        const transmitterGroups = buildMekanismTransmitterGroups(archiveEntries);
        const groups = mergeJarTextureGroups(textureGroups, transmitterGroups);

        if (groups.length === 0) {
          logWarn(SOURCE, `No grouped block candidates were created from "${file.name}".`);
          return;
        }

        setJarImportState({
          sourceFileName: file.name,
          groups,
          filterText: "",
          selectedKeys: new Set(groups.map((group) => group.key)),
        });
        logInfo(
          SOURCE,
          `Loaded ${groups.length} grouped block candidate(s) from "${file.name}" (${textureGroups.length} texture groups, ${transmitterGroups.length} transmitter groups).`
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

  const handleExportClick = useCallback(() => {
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
  }, [exportPackToString]);

  const closeAssetsContextMenu = () => {
    setAssetsContextMenu(null);
  };

  const openAssetsContextMenu = (
    event: ReactMouseEvent,
    target: AssetsContextMenuTarget
  ) => {
    event.preventDefault();
    event.stopPropagation();
    managerContainerRef.current?.focus();
    setAssetsContextMenu({
      x: event.clientX,
      y: event.clientY,
      target,
    });
  };

  const handleAssetsContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select")) {
      return;
    }
    if (!target?.closest(".assets-browser-layout")) {
      return;
    }

    openAssetsContextMenu(event, { kind: "browser" });
  };

  const handleFolderContextMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    folderPath: string
  ) => {
    openAssetsContextMenu(event, {
      kind: "folder",
      folderPath,
    });
  };

  useEffect(() => {
    if (!assetsContextMenu) return;

    const handleWindowMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".context-menu")) return;
      closeAssetsContextMenu();
    };

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAssetsContextMenu();
      }
    };

    window.addEventListener("mousedown", handleWindowMouseDown);
    window.addEventListener("keydown", handleWindowKeyDown);

    return () => {
      window.removeEventListener("mousedown", handleWindowMouseDown);
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [assetsContextMenu]);

  useEffect(() => {
    if (!isAssetDragActive) return;

    // While custom asset drag is active, force wheel input into assets scrolling and block scene zoom.
    const handleWindowWheel = (event: WheelEvent) => {
      const grid = assetsEntryGridRef.current;
      if (!grid) {
        event.preventDefault();
        return;
      }

      const target = event.target as HTMLElement | null;
      const targetInsideGrid = Boolean(target?.closest(".assets-entry-grid"));
      const rect = grid.getBoundingClientRect();
      const pointerInsideGrid =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;

      if (targetInsideGrid || pointerInsideGrid) {
        const baseStep = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? grid.clientHeight : 1;
        const nextDeltaY = event.deltaY * baseStep;
        const nextDeltaX = event.deltaX * baseStep;

        grid.scrollTop += nextDeltaY;
        grid.scrollLeft += nextDeltaX;
      }

      event.preventDefault();
    };

    window.addEventListener("wheel", handleWindowWheel, {
      passive: false,
      capture: true,
    });

    return () => {
      window.removeEventListener("wheel", handleWindowWheel, true);
    };
  }, [isAssetDragActive]);

  useEffect(() => {
    const handleAssetsCommandEvent = (event: Event) => {
      const customEvent = event as CustomEvent<AssetsCommandEventDetail>;
      const command = customEvent.detail?.command;

      if (command === "new-custom-object") {
        handleCreateCustomObject();
        return;
      }

      if (command === "import-types") {
        handleImportClick();
        return;
      }

      if (command === "export-types") {
        handleExportClick();
      }
    };

    window.addEventListener(ASSETS_COMMAND_EVENT, handleAssetsCommandEvent as EventListener);
    return () =>
      window.removeEventListener(ASSETS_COMMAND_EVENT, handleAssetsCommandEvent as EventListener);
  }, [handleCreateCustomObject, handleExportClick, handleImportClick]);

  const folderContextTarget =
    assetsContextMenu?.target.kind === "folder"
      ? assetsContextMenu.target
      : null;
  const customDraggingTextureSource = customDraggingDefinition
    ? resolvePrimaryTextureSource(customDraggingDefinition.textures)
    : undefined;

  return (
    <>
      <div
        className="block-type-manager"
        ref={managerContainerRef}
        tabIndex={0}
        onMouseDown={() => managerContainerRef.current?.focus()}
        onContextMenu={handleAssetsContextMenu}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json,.png,image/png,.jar,.zip,application/java-archive,application/zip"
          className="hidden-file-input"
          onChange={handleFileChange}
        />
        <input
          ref={textureProfileFileInputRef}
          type="file"
          accept=".png,image/png"
          className="hidden-file-input"
          onChange={handleTextureProfileFileChange}
        />
        <input
          ref={typeTextureFileInputRef}
          type="file"
          accept=".png,image/png"
          className="hidden-file-input"
          onChange={handleTypeTextureFileChange}
        />

        <div className="assets-browser-layout">
          <div className="assets-folder-breadcrumbs">
            {folderBreadcrumbs.map((breadcrumb, index) => (
              <span key={`breadcrumb:${breadcrumb.path}`} className="assets-breadcrumb-segment">
                <button
                  className={[
                    "assets-breadcrumb-button",
                    breadcrumb.path === effectiveSelectedFolder ? "active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => setSelectedFolder(breadcrumb.path)}
                >
                  {breadcrumb.label}
                </button>
                {index < folderBreadcrumbs.length - 1 && (
                  <span className="assets-breadcrumb-separator">/</span>
                )}
              </span>
            ))}
          </div>

          <div
            className="assets-entry-grid"
            ref={assetsEntryGridRef}
            onDragOver={handleAssetsEntryGridDragOver}
            onDragLeave={handleAssetsEntryGridDragLeave}
            onDrop={endAssetDragInteraction}
            onWheelCapture={handleAssetsEntryGridWheelCapture}
          >
            {parentFolder && (
              <button
                className={[
                  "assets-folder-tile",
                  "folder-up",
                  dragHoverFolderPath === parentFolder ? "drag-over" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                data-folder-path={parentFolder}
                onClick={() => setSelectedFolder(parentFolder)}
                onContextMenu={(event) => handleFolderContextMenu(event, parentFolder)}
                onDragOver={(event) => {
                  if (!hasInternalAssetDragPayload(event.dataTransfer)) return;
                  event.preventDefault();
                  setDragHoverFolderPath((current) =>
                    current === parentFolder ? current : parentFolder
                  );
                }}
                onDrop={(event) => handleAssetDropOnFolder(event, parentFolder)}
              >
                <span className="assets-folder-icon" aria-hidden />
                <span className="assets-folder-tile-name">..</span>
                <span className="assets-folder-tile-path">{parentFolder}</span>
              </button>
            )}

            {directChildFolders.map((folder) => {
              const isProtected = PROTECTED_ASSET_FOLDERS.has(folder);

              return (
                <button
                  key={folder}
                  className={[
                    "assets-folder-tile",
                    effectiveSelectedFolder === folder ? "active" : "",
                    dragHoverFolderPath === folder ? "drag-over" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  data-folder-path={folder}
                  onClick={() => setSelectedFolder(folder)}
                  onContextMenu={(event) => handleFolderContextMenu(event, folder)}
                  draggable={!isProtected}
                  onDragStart={(event) => {
                    if (isProtected) return;
                    event.dataTransfer.setData("text/x-asset-folder", folder);
                    event.dataTransfer.effectAllowed = "move";
                    setIsAssetDragActive(true);
                    setDragHoverFolderPath(null);
                  }}
                  onDragEnd={endAssetDragInteraction}
                  onDragOver={(event) => {
                    if (!hasInternalAssetDragPayload(event.dataTransfer)) return;
                    event.preventDefault();
                    setDragHoverFolderPath((current) => (current === folder ? current : folder));
                  }}
                  onDrop={(event) => handleAssetDropOnFolder(event, folder)}
                >
                  <span className="assets-folder-icon" aria-hidden />
                  <span className="assets-folder-tile-name">{toFolderName(folder)}</span>
                  <span className="assets-folder-tile-path">{folder}</span>
                </button>
              );
            })}

            {visibleDefinitions.map((definition) => {
              const renameDraft = renameDrafts[definition.id];
              const isRenaming = renameDraft !== undefined;

              return (
                <div
                  key={definition.id}
                  className={[
                    "assets-type-tile",
                    customDraggingTypeId === definition.id ? "dragging" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseDown={(event) => handleTypeTileMouseDown(event, definition.id)}
                >
                  <div className="block-type-row-main">
                    <span
                      className="block-type-swatch"
                      style={{
                        backgroundColor: `#${definition.color.toString(16).padStart(6, "0")}`,
                        backgroundImage: (() => {
                          const source = resolvePrimaryTextureSource(definition.textures);
                          return source ? `url("${source}")` : undefined;
                        })(),
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    />
                    <div className="block-type-text">
                      {isRenaming ? (
                        <input
                          className="block-type-rename-input"
                          value={renameDraft}
                          autoFocus
                          onChange={(event) =>
                            setRenameDrafts((current) => ({
                              ...current,
                              [definition.id]: event.target.value,
                            }))
                          }
                          onBlur={() => commitRename(definition)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              commitRename(definition);
                            }

                            if (event.key === "Escape") {
                              event.preventDefault();
                              setRenameDrafts((current) => {
                                const next = { ...current };
                                delete next[definition.id];
                                return next;
                              });
                            }
                          }}
                        />
                      ) : (
                        <div className="block-type-name">{definition.displayName}</div>
                      )}
                      <div className="block-type-id">{definition.id}</div>
                    </div>
                  </div>
                  <div className="block-type-row-actions">
                    <button
                      className="block-type-edit-button"
                      onClick={() => startRename(definition)}
                    >
                      Rename
                    </button>
                    <button
                      className="block-type-edit-button"
                      onClick={() => openTypeEditor(definition)}
                    >
                      Edit
                    </button>
                    {definition.renderMode === "conduit" && (
                      <button
                        className="block-type-edit-button"
                        onClick={() => openTextureProfileEditor(definition)}
                      >
                        Conduit
                      </button>
                    )}
                    <button
                      className="block-type-edit-button danger"
                      onClick={() => removeType(definition)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}

            {directChildFolders.length === 0 && visibleDefinitions.length === 0 && (
              <div className="assets-empty">This folder is empty.</div>
            )}
          </div>
        </div>
      </div>

      {customDraggingDefinition && dragPreviewPosition && (
        <div
          className="assets-drag-ghost"
          style={{
            left: `${dragPreviewPosition.x}px`,
            top: `${dragPreviewPosition.y}px`,
          }}
        >
          <span
            className="assets-drag-ghost-swatch"
            style={{
              backgroundColor: `#${customDraggingDefinition.color.toString(16).padStart(6, "0")}`,
              backgroundImage: customDraggingTextureSource
                ? `url("${customDraggingTextureSource}")`
                : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div className="assets-drag-ghost-text">
            <div className="assets-drag-ghost-name">{customDraggingDefinition.displayName}</div>
            <div className="assets-drag-ghost-id">{customDraggingDefinition.id}</div>
          </div>
        </div>
      )}

      {assetsContextMenu && (
        <div
          className="context-menu"
          style={{
            left: `${assetsContextMenu.x}px`,
            top: `${assetsContextMenu.y}px`,
          }}
        >
          {folderContextTarget && (
            <>
              <button
                className="context-item"
                onClick={() => {
                  closeAssetsContextMenu();
                  setSelectedFolder(folderContextTarget.folderPath);
                }}
              >
                Open Folder
              </button>
              <button
                className="context-item"
                onClick={() => {
                  closeAssetsContextMenu();
                  handleCreateFolderAt(folderContextTarget.folderPath);
                }}
              >
                New Folder Here
              </button>
              <button
                className="context-item"
                disabled={!canModifyFolder(folderContextTarget.folderPath)}
                onClick={() => {
                  closeAssetsContextMenu();
                  handleRenameFolderAt(folderContextTarget.folderPath);
                }}
              >
                Rename Folder
              </button>
              <button
                className="context-item danger"
                disabled={!canModifyFolder(folderContextTarget.folderPath)}
                onClick={() => {
                  closeAssetsContextMenu();
                  handleDeleteFolderAt(folderContextTarget.folderPath);
                }}
              >
                Delete Folder
              </button>
              <div className="context-separator" />
            </>
          )}
          <button
            className="context-item"
            onClick={() => {
              closeAssetsContextMenu();
              handleCreateCustomObject();
            }}
          >
            New Custom Object
          </button>
          <button
            className="context-item"
            onClick={() => {
              closeAssetsContextMenu();
              handleImportClick();
            }}
          >
            Import Types
          </button>
          <button
            className="context-item"
            onClick={() => {
              closeAssetsContextMenu();
              handleExportClick();
            }}
          >
            Export Types
          </button>
        </div>
      )}

      {typeEditor && (
        <div className="modal-backdrop" onClick={closeTypeEditor}>
          <div
            className="modal-card type-editor-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Edit Block Type</h3>
            <p className="texture-profile-summary">{typeEditor.typeId}</p>

            <div className="modal-field">
              <label>Display Name</label>
              <input
                value={typeEditor.displayName}
                onChange={(event) =>
                  setTypeEditor((current) =>
                    current
                      ? {
                          ...current,
                          displayName: event.target.value,
                        }
                      : current
                  )
                }
              />
            </div>

            <div className="modal-field">
              <label>Group</label>
              <div className="type-editor-inline-row">
                <input
                  value={typeEditor.group}
                  onChange={(event) =>
                    setTypeEditor((current) =>
                      current
                        ? {
                            ...current,
                            group: event.target.value,
                          }
                        : current
                    )
                  }
                  placeholder="e.g. mekanism/generator or custom_object"
                />
                <button
                  onClick={() =>
                    setTypeEditor((current) =>
                      current
                        ? {
                            ...current,
                            group: "custom_object",
                          }
                        : current
                    )
                  }
                >
                  Set custom_object
                </button>
              </div>
            </div>

            <div className="modal-field">
              <label>Render Mode</label>
              <select
                value={typeEditor.renderMode}
                onChange={(event) =>
                  setTypeEditor((current) =>
                    current
                      ? {
                          ...current,
                          renderMode: event.target.value as BlockRenderMode,
                        }
                      : current
                  )
                }
              >
                <option value="cube">cube</option>
                <option value="conduit">conduit</option>
              </select>
            </div>

            {typeEditor.renderMode === "conduit" && (
              <div className="modal-field">
                <label>Connect Tag</label>
                <input
                  value={typeEditor.connectTag}
                  onChange={(event) =>
                    setTypeEditor((current) =>
                      current
                        ? {
                            ...current,
                            connectTag: event.target.value,
                          }
                        : current
                    )
                  }
                  placeholder="e.g. energy, gas, fluid"
                />
              </div>
            )}

            <div className="type-editor-texture-list">
              {TYPE_TEXTURE_SLOTS.map((slot) => (
                <div key={slot} className="type-editor-texture-row">
                  <label>{TYPE_TEXTURE_SLOT_LABELS[slot]}</label>
                  <input
                    value={typeEditor.textures[slot] ?? ""}
                    onChange={(event) => updateTypeTextureSlot(slot, event.target.value)}
                    placeholder="data:image/png;base64,... or URL"
                  />
                  <div className="type-editor-texture-actions">
                    <button onClick={() => openTypeTextureFilePicker(slot)}>
                      Pick PNG
                    </button>
                    <button onClick={() => clearTypeTextureSlot(slot)}>Clear</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button onClick={closeTypeEditor}>Cancel</button>
              <button className="primary" onClick={saveTypeEditor}>
                Save Type
              </button>
            </div>
          </div>
        </div>
      )}

      {textureProfileEditor && (
        <div className="modal-backdrop" onClick={closeTextureProfileEditor}>
          <div
            className="modal-card texture-profile-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Edit Conduit Textures</h3>
            <p className="texture-profile-summary">
              {textureProfileEditor.displayName} ({textureProfileEditor.typeId})
            </p>

            <div className="texture-profile-list">
              {CONDUIT_TEXTURE_PROFILE_SLOTS.map((slot) => (
                <div key={slot} className="texture-profile-row">
                  <label>{CONDUIT_TEXTURE_PROFILE_SLOT_LABELS[slot]}</label>
                  <input
                    value={textureProfileEditor.profile[slot] ?? ""}
                    onChange={(event) =>
                      updateTextureProfileSlot(slot, event.target.value)
                    }
                    placeholder="data:image/png;base64,... or URL"
                  />
                  <div className="texture-profile-row-actions">
                    <select
                      value=""
                      onChange={(event) =>
                        handleTextureSourceSelect(slot, event.target.value)
                      }
                    >
                      <option value="">Use Existing...</option>
                      {textureSourceOptions.map((option) => (
                        <option key={`${slot}:${option.id}`} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => openTextureProfileSlotFilePicker(slot)}>
                      Pick PNG
                    </button>
                    <button onClick={() => clearTextureProfileSlot(slot)}>Clear</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button onClick={closeTextureProfileEditor}>Cancel</button>
              <button className="primary" onClick={saveTextureProfileEditor}>
                Save Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {jarImportState && (
        <div className="modal-backdrop" onClick={closeJarImportDialog}>
          <div
            className="modal-card jar-import-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Import Archive Textures</h3>
            <p className="jar-import-summary">
              Source: {jarImportState.sourceFileName}
              <br />
              Found: {jarImportState.groups.length} grouped block types
              <br />
              Selected: {jarImportState.selectedKeys.size}
            </p>

            <div className="modal-field">
              <label>Filter (comma or space separated)</label>
              <input
                value={jarImportState.filterText}
                onChange={(event) =>
                  setJarImportState((current) =>
                    current
                      ? {
                          ...current,
                          filterText: event.target.value,
                        }
                      : current
                  )
                }
                placeholder="e.g. smelting factory cable"
                autoFocus
              />
            </div>

            <div className="jar-import-toolbar">
              <button onClick={selectVisibleJarGroups}>Select Visible</button>
              <button onClick={deselectVisibleJarGroups}>Deselect Visible</button>
              <button onClick={selectAllJarGroups}>Select All</button>
              <button onClick={clearAllJarGroups}>Clear</button>
            </div>

            <div className="jar-import-list">
              {filteredJarGroups.map((group) => (
                <label key={group.key} className="jar-import-row">
                  <input
                    type="checkbox"
                    checked={jarImportState.selectedKeys.has(group.key)}
                    onChange={() => toggleJarGroup(group.key)}
                  />
                  <div className="jar-import-row-main">
                    <span className="jar-import-name">{group.displayName}</span>
                    <span className="jar-import-meta">
                      {group.groupLabel} | {group.faceSummary}
                    </span>
                    <span className="jar-import-path">{group.typeId}</span>
                  </div>
                </label>
              ))}

              {filteredJarGroups.length === 0 && (
                <div className="assets-empty">No grouped textures match your filter.</div>
              )}
            </div>

            <div className="modal-actions">
              <button onClick={closeJarImportDialog}>Cancel</button>
              <button
                className="primary"
                onClick={confirmJarImport}
                disabled={jarImportState.selectedKeys.size === 0}
              >
                Import Selected
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BlockTypeManager;
