import {
  BLOCK_FACES,
  createConnectionMask,
  type BlockConnectionMask,
  type BlockDefinition,
  type BlockFace,
  type BlockInstance,
  type Vec3,
} from "../models/blocks";
import { getBlockTypeDefinition } from "../state/useBlockTypesStore";

const FACE_OFFSETS: Record<BlockFace, Vec3> = {
  right: { x: 1, y: 0, z: 0 },
  left: { x: -1, y: 0, z: 0 },
  top: { x: 0, y: 1, z: 0 },
  bottom: { x: 0, y: -1, z: 0 },
  front: { x: 0, y: 0, z: 1 },
  back: { x: 0, y: 0, z: -1 },
};

export const isConduitDefinition = (definition: BlockDefinition) =>
  definition.renderMode === "conduit";

const getDefinitionConnectTag = (definition: BlockDefinition) =>
  definition.connectTag?.trim().toLowerCase() || definition.id.toLowerCase();

const canConduitsConnect = (a: BlockDefinition, b: BlockDefinition) =>
  isConduitDefinition(a) &&
  isConduitDefinition(b) &&
  getDefinitionConnectTag(a) === getDefinitionConnectTag(b);

const canConduitConnectToNeighbor = (
  conduitDefinition: BlockDefinition,
  neighborDefinition: BlockDefinition
) => {
  if (!isConduitDefinition(conduitDefinition)) return false;

  if (isConduitDefinition(neighborDefinition)) {
    return canConduitsConnect(conduitDefinition, neighborDefinition);
  }

  return true;
};

export const normalizeConnectionMask = (
  mask: Partial<Record<BlockFace, boolean>> | undefined
) => {
  // Consumers expect a fully populated mask, not an object with missing faces.
  const normalized = createConnectionMask();
  if (!mask) return normalized;

  BLOCK_FACES.forEach((face) => {
    normalized[face] = mask[face] === true;
  });

  return normalized;
};

const toPositionKey = (position: Vec3) =>
  `${position.x}:${position.y}:${position.z}`;

const buildBlocksByPosition = (blocks: BlockInstance[]) =>
  new Map(blocks.map((block) => [toPositionKey(block.position), block]));

const hasCompatibleNeighborConnection = (
  instance: BlockInstance,
  definition: BlockDefinition,
  face: BlockFace,
  blocksByPosition: Map<string, BlockInstance>
) => {
  const offset = FACE_OFFSETS[face];
  const neighbor = blocksByPosition.get(
    toPositionKey({
      x: instance.position.x + offset.x,
      y: instance.position.y + offset.y,
      z: instance.position.z + offset.z,
    })
  );

  if (!neighbor || neighbor.id === instance.id) {
    return false;
  }

  const neighborDefinition = getBlockTypeDefinition(neighbor.type);
  return canConduitConnectToNeighbor(definition, neighborDefinition);
};

export const computeAutoConnectionMask = (
  instance: BlockInstance,
  blocksByPosition: Map<string, BlockInstance>
): BlockConnectionMask => {
  const definition = getBlockTypeDefinition(instance.type);
  const mask = createConnectionMask();

  if (!isConduitDefinition(definition)) {
    return mask;
  }

  BLOCK_FACES.forEach((face) => {
    mask[face] = hasCompatibleNeighborConnection(
      instance,
      definition,
      face,
      blocksByPosition
    );
  });

  return mask;
};

export const applyAutoConnectionMasks = (blocks: BlockInstance[]) => {
  const blocksByPosition = buildBlocksByPosition(blocks);
  let changed = false;

  const nextBlocks: BlockInstance[] = blocks.map((block) => {
    const definition = getBlockTypeDefinition(block.type);
    if (!isConduitDefinition(definition)) {
      return block;
    }

    const mode = block.connections?.mode === "manual" ? "manual" : "auto";
    if (mode !== "auto") {
      return block;
    }

    const nextMask = computeAutoConnectionMask(block, blocksByPosition);
    const currentMask = normalizeConnectionMask(block.connections?.mask);
    const hasSameMask = BLOCK_FACES.every(
      (face) => currentMask[face] === nextMask[face]
    );

    if (hasSameMask && block.connections?.mode === "auto") {
      return block;
    }

    // Keep auto mode explicit so UI can show that the mask is computed.
    changed = true;
    const nextBlock: BlockInstance = {
      ...block,
      connections: {
        mode: "auto",
        mask: nextMask,
      },
    };

    return nextBlock;
  });

  return changed ? nextBlocks : blocks;
};
