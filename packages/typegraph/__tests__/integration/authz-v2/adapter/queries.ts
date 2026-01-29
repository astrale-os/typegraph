/**
 * FalkorDB Access Query Adapter
 *
 * Implements AccessQueryPort for FalkorDB graph database.
 * Holds executor, type cache, and maxDepth configuration.
 */

import type { AccessQueryPort } from '../authorization/access-query-port'
import { toCypher, assembleQuery, type CypherFragment, type CypherOptions } from './cypher'
import { type GraphVocab, resolveVocab } from './vocabulary'
import type {
  IdentityExpr,
  NodeId,
  PermissionT,
  IdentityId,
  LeafEvaluation,
  RawExecutor,
} from '../types'

export interface FalkorDBQueryConfig {
  maxDepth?: number
  vocab?: Partial<GraphVocab>
  maxCacheSize?: number
}

export class FalkorDBAccessQueryAdapter implements AccessQueryPort {
  private cypherOptions: CypherOptions
  private vocab: GraphVocab
  private typeCache = new Map<NodeId, NodeId | null>()
  private typeCheckCache = new Map<string, boolean>()
  private maxCacheSize: number

  constructor(
    private executor: RawExecutor,
    config?: FalkorDBQueryConfig,
  ) {
    this.vocab = resolveVocab(config?.vocab)
    this.cypherOptions = {
      maxDepth: config?.maxDepth ?? 20,
      vocab: this.vocab,
    }
    this.maxCacheSize = config?.maxCacheSize ?? 10_000
  }

  private cacheSet<K, V>(cache: Map<K, V>, key: K, value: V): void {
    if (cache.size >= this.maxCacheSize) {
      const firstKey = cache.keys().next().value!
      cache.delete(firstKey)
    }
    cache.set(key, value)
  }

  generateQuery(
    expr: IdentityExpr,
    targetVar: string,
    perm: PermissionT,
    principal: IdentityId | undefined,
  ): CypherFragment | null {
    return toCypher(expr, targetVar, perm, principal, this.cypherOptions)
  }

  /**
   * Execute permission check on a resource node (module).
   * Used for forResource expression evaluation.
   */
  async executeResourceCheck(fragment: CypherFragment, resourceId: NodeId): Promise<boolean> {
    return this._executePermissionCheck(fragment, resourceId)
  }

  /**
   * Execute permission check on a type node.
   * Used for forType expression evaluation. Results are cached.
   */
  async executeTypeCheck(fragment: CypherFragment, typeId: NodeId): Promise<boolean> {
    const paramsKey = JSON.stringify(fragment.params)
    const key = `${fragment.condition}|${paramsKey}|${typeId}`
    const cached = this.typeCheckCache.get(key)
    if (cached !== undefined) return cached

    const result = await this._executePermissionCheck(fragment, typeId)
    this.cacheSet(this.typeCheckCache, key, result)
    return result
  }

  /**
   * Internal: execute the actual permission check query.
   */
  private async _executePermissionCheck(
    fragment: CypherFragment,
    nodeId: NodeId,
  ): Promise<boolean> {
    const { query, params } = assembleQuery(fragment, 'target', this.vocab, 'resourceId')
    const results = await this.executor.run<{ found: boolean }>(query, {
      resourceId: nodeId,
      ...params,
    })
    return results[0]?.found ?? false
  }

  async getTargetType(resourceId: NodeId): Promise<NodeId | null> {
    if (this.typeCache.has(resourceId)) {
      return this.typeCache.get(resourceId)!
    }

    const v = this.vocab
    const query = `
      MATCH (t:${v.node} {id: $resourceId})
      OPTIONAL MATCH (t)-[:${v.ofType}]->(type:${v.type})
      RETURN type.id AS typeId
      LIMIT 1
    `

    const results = await this.executor.run<{ typeId: NodeId | null }>(query, { resourceId })
    const typeId = results[0]?.typeId ?? null
    this.cacheSet(this.typeCache, resourceId, typeId)
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

    const v = this.vocab

    // Query target's ancestor path (needed for node restriction checks)
    let targetAncestors: Set<NodeId> | null = null
    if (hasNodeRestrictions) {
      const ancestorQuery = `
        MATCH (target:${v.node} {id: $resourceId})
        MATCH (target)-[:${v.parent}*0..${this.cypherOptions.maxDepth}]->(ancestor:${v.node})
        RETURN collect(ancestor.id) AS ancestors
      `
      const ancestorResults = await this.executor.run<{ ancestors: string[] }>(ancestorQuery, {
        resourceId,
      })
      targetAncestors = new Set(ancestorResults[0]?.ancestors ?? [])
    }

    // Batch all identity lookups into a single query (avoids N+1)
    const query = `
      MATCH (target:${v.node} {id: $resourceId})
      MATCH path = (target)-[:${v.parent}*0..${this.cypherOptions.maxDepth}]->(ancestor:${v.node})
      OPTIONAL MATCH (ancestor)<-[hp:${v.perm}]-(i:${v.identity})
      WHERE $perm IN hp.perms AND i.id IN $identityIds
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
