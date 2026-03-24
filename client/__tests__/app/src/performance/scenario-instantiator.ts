/**
 * Scenario Instantiator
 *
 * Converts scenario templates to concrete test scenarios using graph metadata.
 */

import type { TestScenario } from '../types/profiling'
import type { GraphMetadata } from './graph-metadata'
import type {
  ScenarioTemplate,
  NodeSelector,
  UserSelector,
  AppSelector,
} from './scenario-templates'

import { createSeededRandom, type SeededRandom } from './seeded-random'

// =============================================================================
// MAIN INSTANTIATION
// =============================================================================

/**
 * Instantiate all templates into concrete scenarios.
 */
export function instantiateScenarios(
  templates: ScenarioTemplate[],
  metadata: GraphMetadata,
  seed: number = 42,
): TestScenario[] {
  const rng = createSeededRandom(seed)
  const scenarios: TestScenario[] = []

  for (const template of templates) {
    try {
      const scenario = instantiateScenario(template, metadata, rng)
      if (scenario) {
        scenarios.push(scenario)
      }
    } catch (e) {
      console.warn(`Failed to instantiate template ${template.id}:`, e)
    }
  }

  return scenarios
}

/**
 * Instantiate a single template into a concrete scenario.
 */
export function instantiateScenario(
  template: ScenarioTemplate,
  metadata: GraphMetadata,
  rng: SeededRandom,
): TestScenario | null {
  // Resolve app
  const appId = resolveAppSelector(template.appSelector, metadata, rng)
  if (!appId) return null

  // Resolve target node first (needed for user resolution)
  const nodeId = resolveNodeSelector(template.nodeSelector, metadata, rng, template.perm)
  if (!nodeId) return null

  // Resolve user based on node and permission requirements
  const userResolution = resolveUserSelector(
    template.userSelector,
    metadata,
    rng,
    nodeId,
    template.perm,
  )
  if (!userResolution) return null

  const { userId, identityExpr } = userResolution

  // Build grant
  const grant = {
    forType: { kind: 'identity' as const, id: appId },
    forResource: identityExpr,
  }

  // Compute expected result if needed
  let expectedGranted: boolean
  if (template.expectedGranted === 'compute') {
    expectedGranted = computeExpectedResult(metadata, appId, userId, nodeId, template.perm)
  } else {
    expectedGranted = template.expectedGranted
  }

  return {
    id: `${template.id}-${metadata.scale}`,
    name: `${template.name} [${metadata.scale}]`,
    description: `${template.description} (node: ${nodeId}, user: ${userId})`,
    principal: appId,
    nodeId,
    perm: template.perm,
    grant,
    expectedGranted,
  }
}

// =============================================================================
// SELECTOR RESOLUTION
// =============================================================================

function resolveAppSelector(
  selector: AppSelector,
  metadata: GraphMetadata,
  rng: SeededRandom,
): string | null {
  const apps = metadata.identities.apps
  if (apps.length === 0) return null

  switch (selector.strategy) {
    case 'first':
      return apps[0]!

    case 'random':
      return rng.pick(apps)

    case 'withTypePermission': {
      // Find an app that has permission on at least one type
      for (const appId of apps) {
        const perms = metadata.permissionIndex.byIdentity.get(appId) || []
        const hasTypePerm = perms.some((p) => metadata.types.includes(p.target))
        if (hasTypePerm) return appId
      }
      // Fall back to first app
      return apps[0]!
    }
  }
}

function resolveNodeSelector(
  selector: NodeSelector,
  metadata: GraphMetadata,
  rng: SeededRandom,
  _perm: string,
): string | null {
  switch (selector.strategy) {
    case 'byDepth': {
      let depth: number
      if (selector.depth === 'max') {
        depth = metadata.stats.maxDepth
      } else if (selector.depth === 'mid') {
        depth = Math.max(1, Math.floor(metadata.stats.maxDepth / 2))
      } else {
        depth = selector.depth
      }

      const candidates = metadata.modulesByDepth.get(depth) || []
      if (candidates.length === 0) {
        // Fall back to any available depth
        for (const [, modules] of metadata.modulesByDepth) {
          if (modules.length > 0) return rng.pick(modules)
        }
        return null
      }
      return rng.pick(candidates)
    }

    case 'leaf': {
      if (metadata.leafModules.length === 0) return null
      return rng.pick(metadata.leafModules)
    }

    case 'random': {
      const allModules = [...metadata.modulesByDepth.values()].flat()
      if (allModules.length === 0) return null
      return rng.pick(allModules)
    }

    case 'space': {
      if (metadata.spaces.length === 0) return null
      return rng.pick(metadata.spaces)
    }

    case 'withPermission': {
      // Find a node that has at least one permission entry for the given perm
      const targets = [...metadata.permissionIndex.byTarget.keys()]
      const validTargets = targets.filter((t) => {
        const entries = metadata.permissionIndex.byTarget.get(t) || []
        return entries.some((e) => e.perms.includes(selector.perm))
      })
      if (validTargets.length === 0) {
        // Fall back to any module
        const allModules = [...metadata.modulesByDepth.values()].flat()
        return allModules.length > 0 ? rng.pick(allModules) : null
      }
      return rng.pick(validTargets)
    }

    case 'byType': {
      // Find modules of a specific type (would need type mapping in metadata)
      // For now, fall back to random
      const allModules = [...metadata.modulesByDepth.values()].flat()
      return allModules.length > 0 ? rng.pick(allModules) : null
    }
  }
}

interface UserResolution {
  userId: string
  identityExpr: IdentityExpr
}

type IdentityExpr =
  | { kind: 'identity'; id: string }
  | { kind: 'union'; left: IdentityExpr; right: IdentityExpr }
  | { kind: 'exclude'; left: IdentityExpr; right: IdentityExpr }

function resolveUserSelector(
  selector: UserSelector,
  metadata: GraphMetadata,
  rng: SeededRandom,
  nodeId: string,
  perm: string,
): UserResolution | null {
  const users = metadata.identities.users
  if (users.length === 0) return null

  switch (selector.strategy) {
    case 'withPermissionOn': {
      // Find a user with the permission on the target or ancestor
      const usersWithPerm = findUsersWithPermission(metadata, nodeId, perm)
      if (usersWithPerm.length > 0) {
        const userId = rng.pick(usersWithPerm)
        return { userId, identityExpr: { kind: 'identity', id: userId } }
      }
      // Fall back: find any user with the perm anywhere
      for (const userId of users) {
        const perms = metadata.permissionIndex.byIdentity.get(userId) || []
        if (perms.some((p) => p.perms.includes(perm))) {
          return { userId, identityExpr: { kind: 'identity', id: userId } }
        }
      }
      // Last resort: random user
      const userId = rng.pick(users)
      return { userId, identityExpr: { kind: 'identity', id: userId } }
    }

    case 'withoutPermissionOn': {
      // Find a user WITHOUT the permission
      const usersWithPerm = new Set(findUsersWithPermission(metadata, nodeId, perm))
      const usersWithout = users.filter((u) => !usersWithPerm.has(u))
      if (usersWithout.length > 0) {
        const userId = rng.pick(usersWithout)
        return { userId, identityExpr: { kind: 'identity', id: userId } }
      }
      // If everyone has permission, just pick random
      const userId = rng.pick(users)
      return { userId, identityExpr: { kind: 'identity', id: userId } }
    }

    case 'random': {
      const userId = rng.pick(users)
      return { userId, identityExpr: { kind: 'identity', id: userId } }
    }

    case 'composed': {
      // Reference a composed identity directly - this exercises the identity
      // evaluator's composition resolution logic (looking up unionWith/excludeWith edges)
      const composed = metadata.identities.composed
      if (composed.length === 0) {
        // Fall back to inline union of two random users
        if (users.length < 2) {
          const userId = users[0]!
          return { userId, identityExpr: { kind: 'identity', id: userId } }
        }
        const [u1, u2] = rng.pickN(users, 2)
        return {
          userId: u1!,
          identityExpr: {
            kind: 'union',
            left: { kind: 'identity', id: u1! },
            right: { kind: 'identity', id: u2! },
          },
        }
      }

      // Pick a composed identity and reference it directly
      // The identity evaluator will resolve its composition from the graph
      const composedId = rng.pick(composed)

      // For exclude types, prefer SCOPED- prefixed identities
      // For union types, prefer TEAM- prefixed identities
      let selectedId = composedId
      if (selector.compositionType === 'exclude') {
        const scopedIds = composed.filter((id) => id.startsWith('SCOPED-'))
        if (scopedIds.length > 0) {
          selectedId = rng.pick(scopedIds)
        }
      } else {
        const teamIds = composed.filter((id) => id.startsWith('TEAM-'))
        if (teamIds.length > 0) {
          selectedId = rng.pick(teamIds)
        }
      }

      // Reference the composed identity directly
      // The identity evaluator will expand it based on graph relationships
      return {
        userId: selectedId,
        identityExpr: { kind: 'identity', id: selectedId },
      }
    }

    case 'composedInline': {
      // Build an inline union/exclude expression (alternative to direct reference)
      // This tests the query generator's handling of composed expressions
      if (users.length < 2) {
        const userId = users[0]!
        return { userId, identityExpr: { kind: 'identity', id: userId } }
      }

      const [u1, u2] = rng.pickN(users, 2)

      if (selector.compositionType === 'exclude') {
        return {
          userId: u1!,
          identityExpr: {
            kind: 'exclude',
            left: { kind: 'identity', id: u1! },
            right: { kind: 'identity', id: u2! },
          },
        }
      }

      return {
        userId: u1!,
        identityExpr: {
          kind: 'union',
          left: { kind: 'identity', id: u1! },
          right: { kind: 'identity', id: u2! },
        },
      }
    }
  }
}

/**
 * Find users that have the given permission on the target or any of its ancestors.
 */
function findUsersWithPermission(metadata: GraphMetadata, nodeId: string, perm: string): string[] {
  const result: string[] = []

  for (const userId of metadata.identities.users) {
    const perms = metadata.permissionIndex.byIdentity.get(userId) || []
    // Check direct permission on target
    const hasPerm = perms.some((p) => p.target === nodeId && p.perms.includes(perm))
    if (hasPerm) {
      result.push(userId)
      continue
    }

    // Check permission on spaces (which inherit to modules)
    const hasSpacePerm = perms.some(
      (p) => metadata.spaces.includes(p.target) && p.perms.includes(perm),
    )
    if (hasSpacePerm) {
      result.push(userId)
    }
  }

  return result
}

/**
 * Compute the expected access result based on graph structure.
 */
function computeExpectedResult(
  metadata: GraphMetadata,
  _appId: string,
  userId: string,
  nodeId: string,
  perm: string,
): boolean {
  // Simple check: does the user have the permission on the target or any space?
  const perms = metadata.permissionIndex.byIdentity.get(userId) || []

  // Direct permission
  if (perms.some((p) => p.target === nodeId && p.perms.includes(perm))) {
    return true
  }

  // Space permission (inherits to all modules)
  if (perms.some((p) => metadata.spaces.includes(p.target) && p.perms.includes(perm))) {
    return true
  }

  return false
}
