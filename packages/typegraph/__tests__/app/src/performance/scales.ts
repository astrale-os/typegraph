/**
 * Scale Configurations
 *
 * Defines the configuration for each performance testing scale.
 */

// =============================================================================
// TYPES
// =============================================================================

export type Scale = 'small' | 'medium' | 'large'

export interface ScaleConfig {
  name: Scale
  graphName: string

  // Structure
  spaces: number
  types: number
  modulesPerSpace: number
  maxDepth: number
  branchingFactor: number

  // Identities
  apps: number
  users: number
  composedRatio: number

  // Permissions
  permissionDensity: number
  avgPermsPerGrant: number

  // Compositions
  unionDepth: number
  excludeRatio: number
}

// =============================================================================
// SCALE CONFIGURATIONS
// =============================================================================

export const SCALE_CONFIGS: Record<Scale, ScaleConfig> = {
  small: {
    name: 'small',
    graphName: 'authz-perf-small',
    spaces: 5,
    types: 10,
    modulesPerSpace: 1800,
    maxDepth: 6,
    branchingFactor: 4,
    apps: 20,
    users: 150,
    composedRatio: 0.3,
    permissionDensity: 0.02,
    avgPermsPerGrant: 2,
    unionDepth: 2,
    excludeRatio: 0.2,
  },
  medium: {
    name: 'medium',
    graphName: 'authz-perf-medium',
    spaces: 20,
    types: 30,
    modulesPerSpace: 4500,
    maxDepth: 8,
    branchingFactor: 5,
    apps: 100,
    users: 800,
    composedRatio: 0.25,
    permissionDensity: 0.01,
    avgPermsPerGrant: 2.5,
    unionDepth: 3,
    excludeRatio: 0.15,
  },
  large: {
    name: 'large',
    graphName: 'authz-perf-large',
    spaces: 50,
    types: 100,
    modulesPerSpace: 18000,
    maxDepth: 10,
    branchingFactor: 6,
    apps: 500,
    users: 5000,
    composedRatio: 0.2,
    permissionDensity: 0.005,
    avgPermsPerGrant: 3,
    unionDepth: 4,
    excludeRatio: 0.1,
  },
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Estimate the total number of nodes for a scale.
 */
export function estimateNodeCount(config: ScaleConfig): number {
  const modules = config.spaces * config.modulesPerSpace
  const identities =
    config.apps + config.users + Math.floor((config.apps + config.users) * config.composedRatio)
  return config.spaces + config.types + modules + identities
}

/**
 * Estimate the total number of edges for a scale.
 */
export function estimateEdgeCount(config: ScaleConfig): number {
  const modules = config.spaces * config.modulesPerSpace
  const identities = config.apps + config.users
  const composed = Math.floor(identities * config.composedRatio)

  // hasParent edges: modules + types
  const parentEdges = modules + config.types

  // ofType edges: modules
  const typeEdges = modules

  // hasPerm edges: based on density
  const permEdges = Math.floor(identities * modules * config.permissionDensity)

  // composition edges: composed identities reference 2-3 others on average
  const compEdges = composed * 2

  return parentEdges + typeEdges + permEdges + compEdges
}

/**
 * Format a number for display.
 */
function formatNumber(n: number): string {
  if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `~${(n / 1_000).toFixed(0)}K`
  return `${n}`
}

/**
 * Pre-computed scale info for each scale (cached to avoid creating new objects).
 */
export const SCALE_INFO_CACHE: Record<Scale, { nodes: string; edges: string }> = {
  small: {
    nodes: formatNumber(estimateNodeCount(SCALE_CONFIGS.small)),
    edges: formatNumber(estimateEdgeCount(SCALE_CONFIGS.small)),
  },
  medium: {
    nodes: formatNumber(estimateNodeCount(SCALE_CONFIGS.medium)),
    edges: formatNumber(estimateEdgeCount(SCALE_CONFIGS.medium)),
  },
  large: {
    nodes: formatNumber(estimateNodeCount(SCALE_CONFIGS.large)),
    edges: formatNumber(estimateEdgeCount(SCALE_CONFIGS.large)),
  },
}

/**
 * Cached base scale info.
 */
export const BASE_SCALE_INFO: { nodes: string; edges: string } = { nodes: '23', edges: '44' }

/**
 * Get scale info for display (returns cached object to avoid infinite loops).
 */
export function getScaleInfo(scale: Scale): { nodes: string; edges: string } {
  return SCALE_INFO_CACHE[scale]
}
