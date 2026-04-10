/**
 * Graph Generator
 *
 * Generates scaled authorization graphs for performance testing.
 * Uses batch inserts with UNWIND for efficient creation at 1M+ scale.
 */

import type { GraphMetadata, ProgressCallback } from './graph-metadata'
import type { Scale, ScaleConfig } from './scales'

import { createEmptyMetadata, addToPermissionIndex } from './graph-metadata'
import { SCALE_CONFIGS } from './scales'
import { createSeededRandom, type SeededRandom } from './seeded-random'

// =============================================================================
// TYPES
// =============================================================================

export interface GenerateOptions {
  seed?: number
  onProgress?: ProgressCallback
  batchSize?: number
}

interface RawExecutor {
  run<T = unknown>(query: string, params?: Record<string, unknown>): Promise<T[]>
}

// =============================================================================
// MAIN GENERATOR
// =============================================================================

export async function generateScaledGraph(
  executor: RawExecutor,
  scale: Scale,
  options: GenerateOptions = {},
): Promise<GraphMetadata> {
  const config = SCALE_CONFIGS[scale]
  const rng = createSeededRandom(options.seed ?? 42)
  const batchSize = options.batchSize ?? 200 // Small batches for FalkorDB stability
  const onProgress = options.onProgress

  // Helper to add small delay between batches to prevent overwhelming FalkorDB
  const batchDelay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))

  console.log(`[graph-gen] Starting ${scale} graph generation with batch size ${batchSize}`)
  console.log(
    `[graph-gen] Config: ${config.spaces} spaces, ${config.modulesPerSpace} modules/space, ${config.types} types`,
  )

  const metadata = createEmptyMetadata(scale, config.graphName)
  let nodesCreated = 0
  let edgesCreated = 0

  const reportProgress = (percent: number, phase: string) => {
    console.log(
      `[graph-gen] ${percent.toFixed(0)}% - ${phase} (nodes: ${nodesCreated}, edges: ${edgesCreated})`,
    )
    onProgress?.({ percent, phase, nodesCreated, edgesCreated })
  }

  // Set up indexes (skip clearing - we're using a fresh graph each time)
  reportProgress(0, 'Preparing database')
  // Note: clearDatabase is skipped because FalkorDB has a bug with Delta_Matrix_removeElement
  // that causes crashes during DELETE operations. Instead, we rely on the caller to
  // use a fresh graph name or explicitly handle cleanup.
  await createIndexes(executor)

  // Phase 1: Create types
  reportProgress(5, 'Creating types')
  await createTypes(executor, config, metadata)
  nodesCreated += config.types

  // Phase 2: Create spaces
  reportProgress(10, 'Creating spaces')
  await createSpaces(executor, config, metadata)
  nodesCreated += config.spaces

  // Phase 3: Create module hierarchy
  reportProgress(15, 'Creating modules')
  const moduleResult = await createModuleHierarchy(
    executor,
    config,
    metadata,
    rng,
    batchSize,
    batchDelay,
    (pct) => reportProgress(15 + pct * 0.45, 'Creating modules'),
  )
  nodesCreated += moduleResult.nodes
  edgesCreated += moduleResult.edges

  // Phase 4: Create identities
  reportProgress(60, 'Creating identities')
  await createIdentities(executor, config, metadata, rng)
  nodesCreated +=
    config.apps + config.users + Math.floor((config.apps + config.users) * config.composedRatio)

  // Phase 5: Create permissions
  reportProgress(70, 'Creating permissions')
  const permResult = await createPermissions(
    executor,
    config,
    metadata,
    rng,
    batchSize,
    batchDelay,
    (pct) => reportProgress(70 + pct * 0.2, 'Creating permissions'),
  )
  edgesCreated += permResult.edges

  // Phase 6: Create compositions
  reportProgress(90, 'Creating compositions')
  const compResult = await createCompositions(executor, config, metadata, rng)
  edgesCreated += compResult.edges

  // Phase 7: Finalize metadata
  reportProgress(95, 'Building indexes')
  await finalizeMetadata(executor, metadata)

  // Done
  metadata.stats.totalNodes = nodesCreated
  metadata.stats.totalEdges = edgesCreated
  metadata.stats.avgDegree = nodesCreated > 0 ? edgesCreated / nodesCreated : 0

  reportProgress(100, 'Complete')

  return metadata
}

// =============================================================================
// DATABASE SETUP
// =============================================================================

async function createIndexes(executor: RawExecutor): Promise<void> {
  // Create indexes for efficient lookups
  const indexes = [
    'CREATE INDEX IF NOT EXISTS FOR (n:Node) ON (n.id)',
    'CREATE INDEX IF NOT EXISTS FOR (n:Space) ON (n.id)',
    'CREATE INDEX IF NOT EXISTS FOR (n:Type) ON (n.id)',
    'CREATE INDEX IF NOT EXISTS FOR (n:Module) ON (n.id)',
    'CREATE INDEX IF NOT EXISTS FOR (n:Identity) ON (n.id)',
  ]

  for (const idx of indexes) {
    try {
      await executor.run(idx)
    } catch {
      // Index may already exist
    }
  }
}

// =============================================================================
// PHASE 1: TYPES
// =============================================================================

async function createTypes(
  executor: RawExecutor,
  config: ScaleConfig,
  metadata: GraphMetadata,
): Promise<void> {
  const types: { id: string; name: string }[] = []

  for (let i = 0; i < config.types; i++) {
    const id = `Type-${i}`
    const name = `Type ${i}`
    types.push({ id, name })
    metadata.types.push(id)
  }

  // Batch create types
  await executor.run(
    `UNWIND $types AS t
     CREATE (:Node:Type {id: t.id, name: t.name})`,
    { types },
  )
}

// =============================================================================
// PHASE 2: SPACES
// =============================================================================

async function createSpaces(
  executor: RawExecutor,
  config: ScaleConfig,
  metadata: GraphMetadata,
): Promise<void> {
  const spaces: { id: string; name: string }[] = []

  for (let i = 0; i < config.spaces; i++) {
    const id = `space-${i}`
    const name = `Space ${i}`
    spaces.push({ id, name })
    metadata.spaces.push(id)
  }

  // Batch create spaces
  await executor.run(
    `UNWIND $spaces AS s
     CREATE (:Node:Space {id: s.id, name: s.name})`,
    { spaces },
  )
}

// =============================================================================
// PHASE 3: MODULE HIERARCHY
// =============================================================================

interface ModuleData {
  id: string
  name: string
  depth: number
  parentId: string
  typeId: string
}

async function createModuleHierarchy(
  executor: RawExecutor,
  config: ScaleConfig,
  metadata: GraphMetadata,
  rng: SeededRandom,
  batchSize: number,
  batchDelay: () => Promise<void>,
  onProgress?: (pct: number) => void,
): Promise<{ nodes: number; edges: number }> {
  const allModules: ModuleData[] = []

  // Generate modules for each space
  for (let spaceIdx = 0; spaceIdx < config.spaces; spaceIdx++) {
    const spaceId = metadata.spaces[spaceIdx]!
    const spaceModules = generateModulesForSpace(spaceId, spaceIdx, config, metadata, rng)
    allModules.push(...spaceModules)
  }

  // Find max depth
  metadata.stats.maxDepth = Math.max(0, ...allModules.map((m) => m.depth))

  // Batch insert modules
  let processed = 0
  const total = allModules.length

  for (let i = 0; i < allModules.length; i += batchSize) {
    const batch = allModules.slice(i, i + batchSize)

    // Create nodes
    await executor.run(
      `UNWIND $modules AS m
       CREATE (:Node:Module {id: m.id, name: m.name})`,
      { modules: batch.map((m) => ({ id: m.id, name: m.name })) },
    )

    // Create hasParent edges
    await executor.run(
      `UNWIND $modules AS m
       MATCH (child {id: m.id}), (parent {id: m.parentId})
       CREATE (child)-[:hasParent]->(parent)`,
      { modules: batch.map((m) => ({ id: m.id, parentId: m.parentId })) },
    )

    // Create ofType edges
    await executor.run(
      `UNWIND $modules AS m
       MATCH (mod {id: m.id}), (type {id: m.typeId})
       CREATE (mod)-[:ofType]->(type)`,
      { modules: batch.map((m) => ({ id: m.id, typeId: m.typeId })) },
    )

    processed += batch.length
    onProgress?.(processed / total)

    // Small delay to prevent overwhelming FalkorDB
    await batchDelay()
  }

  // Identify leaf modules
  identifyLeafModules(allModules, metadata)

  // hasParent + ofType edges per module
  const edges = allModules.length * 2

  return { nodes: allModules.length, edges }
}

function generateModulesForSpace(
  spaceId: string,
  spaceIdx: number,
  config: ScaleConfig,
  metadata: GraphMetadata,
  rng: SeededRandom,
): ModuleData[] {
  const modules: ModuleData[] = []
  const modulePrefix = `M${spaceIdx}-`
  let moduleCounter = 0

  // Create modules level by level up to maxDepth
  // Level 1: direct children of space
  // Account for random branching (average half of branchingFactor) and some termination
  const avgBranching = config.branchingFactor / 2
  const expectedGrowth = Math.pow(avgBranching, config.maxDepth - 1) || 1
  const level1Count = Math.max(4, Math.ceil(config.modulesPerSpace / expectedGrowth / 2))
  const level1: ModuleData[] = []

  for (let i = 0; i < level1Count && moduleCounter < config.modulesPerSpace; i++) {
    const id = `${modulePrefix}${moduleCounter}`
    const typeId = metadata.types[rng.nextInt(metadata.types.length)]!
    const mod: ModuleData = {
      id,
      name: `Module ${moduleCounter}`,
      depth: 1,
      parentId: spaceId,
      typeId,
    }
    level1.push(mod)
    modules.push(mod)
    moduleCounter++

    // Track by depth
    if (!metadata.modulesByDepth.has(1)) {
      metadata.modulesByDepth.set(1, [])
    }
    metadata.modulesByDepth.get(1)!.push(id)
  }

  // Create subsequent levels
  let currentLevel = level1
  for (let depth = 2; depth <= config.maxDepth && moduleCounter < config.modulesPerSpace; depth++) {
    const nextLevel: ModuleData[] = []

    for (const parent of currentLevel) {
      // Each parent gets 1 to branchingFactor children (always at least 1 to ensure growth)
      const childCount = Math.min(
        rng.nextIntRange(1, config.branchingFactor + 1),
        config.modulesPerSpace - moduleCounter,
      )

      for (let c = 0; c < childCount && moduleCounter < config.modulesPerSpace; c++) {
        const id = `${modulePrefix}${moduleCounter}`
        const typeId = metadata.types[rng.nextInt(metadata.types.length)]!
        const mod: ModuleData = {
          id,
          name: `Module ${moduleCounter}`,
          depth,
          parentId: parent.id,
          typeId,
        }
        nextLevel.push(mod)
        modules.push(mod)
        moduleCounter++

        // Track by depth
        if (!metadata.modulesByDepth.has(depth)) {
          metadata.modulesByDepth.set(depth, [])
        }
        metadata.modulesByDepth.get(depth)!.push(id)
      }
    }

    currentLevel = nextLevel
    if (currentLevel.length === 0) break
  }

  return modules
}

function identifyLeafModules(modules: ModuleData[], metadata: GraphMetadata): void {
  const hasChildren = new Set<string>()

  for (const mod of modules) {
    hasChildren.add(mod.parentId)
  }

  for (const mod of modules) {
    if (!hasChildren.has(mod.id)) {
      metadata.leafModules.push(mod.id)
    }
  }
}

// =============================================================================
// PHASE 4: IDENTITIES
// =============================================================================

async function createIdentities(
  executor: RawExecutor,
  config: ScaleConfig,
  metadata: GraphMetadata,
  rng: SeededRandom,
): Promise<void> {
  const identities: { id: string; name: string }[] = []

  // Create apps
  for (let i = 0; i < config.apps; i++) {
    const id = `APP-${i}`
    identities.push({ id, name: id })
    metadata.identities.apps.push(id)
  }

  // Create users
  for (let i = 0; i < config.users; i++) {
    const id = `USER-${i}`
    identities.push({ id, name: id })
    metadata.identities.users.push(id)
  }

  // Create composed identities
  const baseIdentityCount = config.apps + config.users
  const composedCount = Math.floor(baseIdentityCount * config.composedRatio)

  for (let i = 0; i < composedCount; i++) {
    // Alternate between TEAM and SCOPED
    const prefix = rng.chance(0.5) ? 'TEAM' : 'SCOPED'
    const id = `${prefix}-${i}`
    identities.push({ id, name: id })
    metadata.identities.composed.push(id)
  }

  // Batch create identities
  await executor.run(
    `UNWIND $identities AS i
     CREATE (:Node:Identity {id: i.id, name: i.name})`,
    { identities },
  )
}

// =============================================================================
// PHASE 5: PERMISSIONS
// =============================================================================

async function createPermissions(
  executor: RawExecutor,
  config: ScaleConfig,
  metadata: GraphMetadata,
  rng: SeededRandom,
  batchSize: number,
  batchDelay: () => Promise<void>,
  onProgress?: (pct: number) => void,
): Promise<{ edges: number }> {
  const permTypes = ['read', 'edit', 'use', 'share']

  // All possible targets (spaces + types + modules)
  const allModules = [...metadata.modulesByDepth.values()].flat()
  const targets = [...metadata.spaces, ...metadata.types, ...allModules]

  // All base identities (apps + users)
  const baseIdentities = [...metadata.identities.apps, ...metadata.identities.users]

  // Calculate how many permission edges to create
  // Cap at a reasonable maximum to prevent infinite loops and memory issues
  const totalPossiblePairs = baseIdentities.length * targets.length
  const rawTargetEdges = Math.floor(totalPossiblePairs * config.permissionDensity)
  const maxEdges = 200000 // Cap permission edges to prevent runaway
  const targetEdges = Math.min(rawTargetEdges, maxEdges)

  console.log(
    `[graph-gen] Creating permissions: ${targetEdges} target edges (capped from ${rawTargetEdges})`,
  )

  // Generate permission edges
  const permissions: { identity: string; target: string; perms: string[] }[] = []

  // Ensure every app has at least one permission on a type (for type checks)
  for (const appId of metadata.identities.apps) {
    const typeId = metadata.types[rng.nextInt(metadata.types.length)]!
    const perms = ['use']
    permissions.push({ identity: appId, target: typeId, perms })
    addToPermissionIndex(metadata.permissionIndex, appId, typeId, perms)
  }

  // Ensure every user has at least one permission on something
  for (const userId of metadata.identities.users) {
    const target = rng.pick(targets)
    const numPerms = rng.nextIntRange(1, Math.ceil(config.avgPermsPerGrant))
    const perms = rng.pickN(permTypes, Math.min(numPerms, permTypes.length))
    permissions.push({ identity: userId, target, perms })
    addToPermissionIndex(metadata.permissionIndex, userId, target, perms)
  }

  // Track used pairs to avoid duplicates
  const usedPairs = new Set<string>(permissions.map((p) => `${p.identity}:${p.target}`))

  // Give composed identities their own permissions
  // This is important so that when composed identities are referenced directly,
  // they have permissions that can be checked (in addition to member permissions)
  for (const composedId of metadata.identities.composed) {
    // Give each composed identity 1-2 permissions on random targets
    const numGrants = rng.nextIntRange(1, 2)
    for (let g = 0; g < numGrants; g++) {
      const target = rng.pick(targets)
      const pairKey = `${composedId}:${target}`
      if (!usedPairs.has(pairKey)) {
        usedPairs.add(pairKey)
        const numPerms = rng.nextIntRange(1, Math.ceil(config.avgPermsPerGrant))
        const perms = rng.pickN(permTypes, Math.min(numPerms, permTypes.length))
        permissions.push({ identity: composedId, target, perms })
        addToPermissionIndex(metadata.permissionIndex, composedId, target, perms)
      }
    }
  }

  // Fill remaining with random pairs (with safeguard against infinite loop)
  let attempts = 0
  const maxAttempts = targetEdges * 10 // Allow some retries for collisions
  while (permissions.length < targetEdges && attempts < maxAttempts) {
    attempts++
    const identity = rng.pick(baseIdentities)
    const target = rng.pick(targets)
    const pairKey = `${identity}:${target}`

    if (!usedPairs.has(pairKey)) {
      usedPairs.add(pairKey)
      const numPerms = rng.nextIntRange(1, Math.ceil(config.avgPermsPerGrant))
      const perms = rng.pickN(permTypes, Math.min(numPerms, permTypes.length))
      permissions.push({ identity, target, perms })
      addToPermissionIndex(metadata.permissionIndex, identity, target, perms)
    }
  }

  if (attempts >= maxAttempts) {
    console.log(
      `[graph-gen] Stopped permission generation after ${attempts} attempts (created ${permissions.length}/${targetEdges})`,
    )
  }

  // Batch insert permissions
  let processed = 0
  const total = permissions.length

  for (let i = 0; i < permissions.length; i += batchSize) {
    const batch = permissions.slice(i, i + batchSize)

    await executor.run(
      `UNWIND $perms AS p
       MATCH (identity {id: p.identity}), (target {id: p.target})
       CREATE (identity)-[:hasPerm {perms: p.perms}]->(target)`,
      { perms: batch },
    )

    processed += batch.length
    onProgress?.(processed / total)

    // Small delay to prevent overwhelming FalkorDB
    await batchDelay()
  }

  return { edges: permissions.length }
}

// =============================================================================
// PHASE 6: COMPOSITIONS
// =============================================================================

async function createCompositions(
  executor: RawExecutor,
  config: ScaleConfig,
  metadata: GraphMetadata,
  rng: SeededRandom,
): Promise<{ edges: number }> {
  const compositions: { from: string; to: string; rel: 'unionWith' | 'excludeWith' }[] = []

  const baseIdentities = [...metadata.identities.apps, ...metadata.identities.users]

  for (const composedId of metadata.identities.composed) {
    const isExclude = rng.chance(config.excludeRatio)
    const memberCount = rng.nextIntRange(2, config.unionDepth + 2)

    // Pick random members from base identities
    const members = rng.pickN(baseIdentities, Math.min(memberCount, baseIdentities.length))

    if (isExclude && members.length >= 2) {
      // First members union in, last one excludes
      for (let i = 0; i < members.length - 1; i++) {
        compositions.push({ from: members[i]!, to: composedId, rel: 'unionWith' })
      }
      compositions.push({ from: members[members.length - 1]!, to: composedId, rel: 'excludeWith' })
    } else {
      // All members union in
      for (const member of members) {
        compositions.push({ from: member, to: composedId, rel: 'unionWith' })
      }
    }
  }

  // Create composition edges
  if (compositions.length > 0) {
    // Union edges
    const unions = compositions.filter((c) => c.rel === 'unionWith')
    if (unions.length > 0) {
      await executor.run(
        `UNWIND $comps AS c
         MATCH (a {id: c.from}), (b {id: c.to})
         CREATE (a)-[:unionWith]->(b)`,
        { comps: unions },
      )
    }

    // Exclude edges
    const excludes = compositions.filter((c) => c.rel === 'excludeWith')
    if (excludes.length > 0) {
      await executor.run(
        `UNWIND $comps AS c
         MATCH (a {id: c.from}), (b {id: c.to})
         CREATE (a)-[:excludeWith]->(b)`,
        { comps: excludes },
      )
    }
  }

  return { edges: compositions.length }
}

// =============================================================================
// PHASE 7: FINALIZE METADATA
// =============================================================================

async function finalizeMetadata(_executor: RawExecutor, _metadata: GraphMetadata): Promise<void> {
  // Metadata is already built during generation
  // This phase can be used for verification queries if needed
}
