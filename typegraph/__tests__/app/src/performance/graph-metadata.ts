/**
 * Graph Metadata Types
 *
 * Defines the metadata returned after graph generation, used for scenario instantiation.
 */

import type { Scale } from './scales'

// =============================================================================
// GRAPH METADATA
// =============================================================================

export interface GraphMetadata {
  scale: Scale
  graphName: string

  // Node catalogs by category
  spaces: string[]
  types: string[]
  modulesByDepth: Map<number, string[]>
  leafModules: string[]

  // Identity catalogs
  identities: {
    apps: string[]
    users: string[]
    composed: string[]
  }

  // Permission index (for scenario instantiation)
  permissionIndex: PermissionIndex

  // Graph stats
  stats: GraphStats
}

export interface PermissionIndex {
  byIdentity: Map<string, PermissionEntry[]>
  byTarget: Map<string, PermissionEntry[]>
}

export interface PermissionEntry {
  identity: string
  target: string
  perms: string[]
}

export interface GraphStats {
  totalNodes: number
  totalEdges: number
  maxDepth: number
  avgDegree: number
}

// =============================================================================
// COMPOSITION TYPES
// =============================================================================

export interface CompositionInfo {
  id: string
  type: 'union' | 'exclude'
  members: string[]
}

// =============================================================================
// GENERATION PROGRESS
// =============================================================================

export interface GenerationProgress {
  percent: number
  phase: string
  nodesCreated: number
  edgesCreated: number
}

export type ProgressCallback = (progress: GenerationProgress) => void

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Create an empty metadata object.
 */
export function createEmptyMetadata(scale: Scale, graphName: string): GraphMetadata {
  return {
    scale,
    graphName,
    spaces: [],
    types: [],
    modulesByDepth: new Map(),
    leafModules: [],
    identities: {
      apps: [],
      users: [],
      composed: [],
    },
    permissionIndex: {
      byIdentity: new Map(),
      byTarget: new Map(),
    },
    stats: {
      totalNodes: 0,
      totalEdges: 0,
      maxDepth: 0,
      avgDegree: 0,
    },
  }
}

/**
 * Add a permission to the index.
 */
export function addToPermissionIndex(
  index: PermissionIndex,
  identity: string,
  target: string,
  perms: string[],
): void {
  const entry: PermissionEntry = { identity, target, perms }

  // Add to byIdentity
  if (!index.byIdentity.has(identity)) {
    index.byIdentity.set(identity, [])
  }
  index.byIdentity.get(identity)!.push(entry)

  // Add to byTarget
  if (!index.byTarget.has(target)) {
    index.byTarget.set(target, [])
  }
  index.byTarget.get(target)!.push(entry)
}

/**
 * Serialize metadata for JSON (Maps -> arrays).
 */
export function serializeMetadata(metadata: GraphMetadata): object {
  return {
    ...metadata,
    modulesByDepth: Array.from(metadata.modulesByDepth.entries()),
    permissionIndex: {
      byIdentity: Array.from(metadata.permissionIndex.byIdentity.entries()),
      byTarget: Array.from(metadata.permissionIndex.byTarget.entries()),
    },
  }
}

/**
 * Deserialize metadata from JSON (arrays -> Maps).
 */
export function deserializeMetadata(data: any): GraphMetadata {
  return {
    ...data,
    modulesByDepth: new Map(data.modulesByDepth),
    permissionIndex: {
      byIdentity: new Map(data.permissionIndex.byIdentity),
      byTarget: new Map(data.permissionIndex.byTarget),
    },
  }
}
