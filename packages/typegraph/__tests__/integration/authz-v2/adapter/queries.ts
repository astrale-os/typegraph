/**
 * FalkorDB Access Query Adapter
 *
 * Implements AccessQueryPort for FalkorDB graph database.
 * Holds executor, type cache, and maxDepth configuration.
 */

import type { AccessQueryPort } from '../authorization/access-query-port'
import { toCypher } from './cypher'
import type {
  IdentityExpr,
  NodeId,
  PermissionT,
  IdentityId,
  LeafEvaluation,
  RawExecutor,
} from '../types'

export class FalkorDBAccessQueryAdapter implements AccessQueryPort {
  private maxDepth: number
  private typeCache = new Map<NodeId, NodeId | null>()
  private typeCheckCache = new Map<string, boolean>()

  constructor(
    private executor: RawExecutor,
    config?: { maxDepth?: number },
  ) {
    this.maxDepth = config?.maxDepth ?? 20
  }

  generateCypher(
    expr: IdentityExpr,
    targetVar: string,
    perm: PermissionT,
    principal: IdentityId | undefined,
  ): string {
    return toCypher(expr, targetVar, perm, principal, this.maxDepth)
  }

  async executeCheck(cypherCheck: string, resourceId: NodeId): Promise<boolean> {
    const query = `
      MATCH (target:Node {id: $resourceId})
      WHERE ${cypherCheck}
      RETURN true AS found
      LIMIT 1
    `
    const results = await this.executor.run<{ found: boolean }>(query, { resourceId })
    return results[0]?.found ?? false
  }

  async executeTypeCheck(cypherCheck: string, typeId: NodeId): Promise<boolean> {
    const key = `${cypherCheck}|${typeId}`
    const cached = this.typeCheckCache.get(key)
    if (cached !== undefined) return cached

    const result = await this.executeCheck(cypherCheck, typeId)
    this.typeCheckCache.set(key, result)
    return result
  }

  async getTargetType(resourceId: NodeId): Promise<NodeId | null> {
    if (this.typeCache.has(resourceId)) {
      return this.typeCache.get(resourceId)!
    }

    const query = `
      MATCH (t:Node {id: $resourceId})
      OPTIONAL MATCH (t)-[:ofType]->(type:Type)
      RETURN type.id AS typeId
      LIMIT 1
    `

    const results = await this.executor.run<{ typeId: NodeId | null }>(query, { resourceId })
    const typeId = results[0]?.typeId ?? null
    this.typeCache.set(resourceId, typeId)
    return typeId
  }

  async queryLeafDetails(
    leaves: LeafEvaluation[],
    resourceId: NodeId,
    perm: PermissionT,
  ): Promise<void> {
    const identityIds = [...new Set(leaves.map((l) => l.identityId))]

    // First, check if any leaves have node restrictions
    const hasNodeRestrictions = leaves.some(
      (l) => l.nodeRestrictions && l.nodeRestrictions.length > 0,
    )

    // Query target's ancestor path (needed for node restriction checks)
    let targetAncestors: Set<NodeId> | null = null
    if (hasNodeRestrictions) {
      const ancestorQuery = `
        MATCH (target:Node {id: $resourceId})
        MATCH (target)-[:hasParent*0..${this.maxDepth}]->(ancestor:Node)
        RETURN collect(ancestor.id) AS ancestors
      `
      const ancestorResults = await this.executor.run<{ ancestors: string[] }>(ancestorQuery, {
        resourceId,
      })
      targetAncestors = new Set(ancestorResults[0]?.ancestors ?? [])
    }

    // Batch all identity lookups into a single query (avoids N+1)
    const query = `
      MATCH (target:Node {id: $resourceId})
      MATCH path = (target)-[:hasParent*0..${this.maxDepth}]->(ancestor:Node)
      OPTIONAL MATCH (ancestor)<-[:hasPerm {perm: $perm}]-(i:Identity)
      WHERE i.id IN $identityIds
      WITH ancestor, path, i
      ORDER BY length(path)
      WITH collect({
        ancestor: ancestor.id,
        pathNodes: [n IN nodes(path) | n.id],
        identityId: i.id
      }) AS results
      RETURN results
    `

    const queryResults = await this.executor.run<{
      results: Array<{ ancestor: string; pathNodes: string[]; identityId: string | null }>
    }>(query, { resourceId, perm, identityIds })

    const results = queryResults[0]?.results ?? []

    // searchedPath from the longest ancestor path (last entry, ordered by length)
    const searchedPath = results.length > 0 ? (results[results.length - 1]?.pathNodes ?? []) : []

    // Build per-identity grant info (first occurrence = closest ancestor with permission)
    const grantedByIdentity = new Map<string, { ancestor: string; pathNodes: string[] }>()
    for (const r of results) {
      if (r.identityId && !grantedByIdentity.has(r.identityId)) {
        grantedByIdentity.set(r.identityId, { ancestor: r.ancestor, pathNodes: r.pathNodes })
      }
    }

    for (const leaf of leaves) {
      const grantedResult = grantedByIdentity.get(leaf.identityId)

      if (grantedResult) {
        if (leaf.nodeRestrictions && leaf.nodeRestrictions.length > 0 && targetAncestors) {
          const nodeRestrictionsSatisfied = leaf.nodeRestrictions.some((restrictedNode) =>
            targetAncestors!.has(restrictedNode),
          )

          if (!nodeRestrictionsSatisfied) {
            leaf.status = 'filtered'
            leaf.searchedPath = searchedPath
            continue
          }
        }

        leaf.status = 'granted'
        leaf.grantedAt = grantedResult.ancestor
        leaf.inheritancePath = grantedResult.pathNodes
      } else {
        leaf.status = 'missing'
        leaf.searchedPath = searchedPath
      }
    }
  }

  clearCache(): void {
    this.typeCache.clear()
    this.typeCheckCache.clear()
  }
}
