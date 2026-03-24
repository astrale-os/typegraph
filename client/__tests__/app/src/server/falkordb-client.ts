import { FalkorDB, type Graph } from 'falkordb'

import type { QueryFragment } from '../../../integration/authz-v2/adapter/cypher'
import type { AccessQueryPort } from '../../../integration/authz-v2/authorization/access-query-port'
import type {
  RawExecutor,
  Grant,
  NodeId,
  Permission,
  IdentityId,
  IdentityExpr,
  PrunedIdentityExpr,
  LeafEvaluation,
  AccessDecision,
  AccessExplanation,
  UnresolvedGrant,
} from '../../../integration/authz-v2/types'
import type { MethodTiming, PerformanceProfile } from '../types/api'

import {
  createIdentityEvaluator,
  type IdentityEvaluator,
} from '../../../integration/authz-v2/adapter/identity-evaluator'
import { FalkorDBAccessQueryAdapter } from '../../../integration/authz-v2/adapter/queries'
import {
  GrantDecoder,
  validateGrant,
  type DecodedGrant,
} from '../../../integration/authz-v2/authentication/grant-decoder'
import { IdentityRegistry } from '../../../integration/authz-v2/authentication/identity-registry'
import { IssuerKeyStore } from '../../../integration/authz-v2/authentication/issuer-key-store'
import {
  TokenVerifier,
  KERNEL_ISSUER,
  type TokenPayload,
} from '../../../integration/authz-v2/authentication/token-verifier'
import { checkAccess } from '../../../integration/authz-v2/authorization/checker'
import { explainAccess } from '../../../integration/authz-v2/authorization/explainer'
import {
  createRawExecutor,
  clearDatabase,
  createIndexes,
} from '../../../integration/authz-v2/testing/setup'
import {
  type Scale,
  type GraphMetadata,
  type ProgressCallback,
  SCALE_CONFIGS,
  generateScaledGraph,
} from '../performance'

// =============================================================================
// TIMED WRAPPERS FOR E2E FLOW
// =============================================================================

/**
 * Timed TokenVerifier - instruments TRUST phase (verifyToken)
 */
class TimedTokenVerifier {
  readonly calls: MethodTiming[] = []

  constructor(private inner: TokenVerifier) {}

  verifyToken(token: string): { payload: TokenPayload } {
    const startMs = performance.now()
    const result = this.inner.verifyToken(token)
    const endMs = performance.now()
    this.calls.push({
      method: 'verifyToken',
      phase: 'trust',
      startMs,
      endMs,
      durationMs: endMs - startMs,
      metadata: { iss: result.payload.iss, sub: result.payload.sub },
    })
    return result
  }

  verifyKernelIssued(token: string): { payload: TokenPayload } {
    const startMs = performance.now()
    const result = this.inner.verifyKernelIssued(token)
    const endMs = performance.now()
    this.calls.push({
      method: 'verifyKernelIssued',
      phase: 'trust',
      startMs,
      endMs,
      durationMs: endMs - startMs,
    })
    return result
  }

  decodeToken(token: string): TokenPayload {
    return this.inner.decodeToken(token)
  }
}

/**
 * Timed IdentityRegistry - instruments TRUST phase (resolveIdentity)
 */
class TimedIdentityRegistry {
  readonly calls: MethodTiming[] = []

  constructor(private inner: IdentityRegistry) {}

  resolveIdentity(iss: string, sub: string): IdentityId {
    const startMs = performance.now()
    const result = this.inner.resolveIdentity(iss, sub)
    const endMs = performance.now()
    this.calls.push({
      method: 'resolveIdentity',
      phase: 'trust',
      startMs,
      endMs,
      durationMs: endMs - startMs,
      metadata: { iss, sub, resolved: result },
    })
    return result
  }

  resolve(iss: string, sub: string): IdentityId | undefined {
    return this.inner.resolve(iss, sub)
  }

  register(iss: string, sub: string, identityId: IdentityId): void {
    this.inner.register(iss, sub, identityId)
  }
}

/**
 * Timed GrantDecoder - instruments DECODE phase (JWT → plain IDs)
 */
class TimedGrantDecoder {
  readonly calls: MethodTiming[] = []

  constructor(private inner: GrantDecoder) {}

  async decodeGrant(
    grant: UnresolvedGrant | undefined,
    principal: IdentityId,
  ): Promise<DecodedGrant> {
    const startMs = performance.now()
    const result = await this.inner.decodeGrant(grant, principal)
    const endMs = performance.now()
    this.calls.push({
      method: 'decodeGrant',
      phase: 'decode',
      startMs,
      endMs,
      durationMs: endMs - startMs,
      metadata: { principal, hasGrant: !!grant },
    })
    return result
  }
}

// =============================================================================
// TIMED IDENTITY EVALUATOR
// =============================================================================

class TimedIdentityEvaluator {
  readonly calls: MethodTiming[] = []

  constructor(private inner: IdentityEvaluator) {}

  async evalExpr(expr: IdentityExpr): Promise<IdentityExpr> {
    const startMs = performance.now()
    const result = await this.inner.evalExpr(expr)
    const endMs = performance.now()
    this.calls.push({
      method: 'evalExpr',
      phase: 'resolve',
      startMs,
      endMs,
      durationMs: endMs - startMs,
      metadata: { inputKind: expr.kind },
    })
    return result
  }
}

// =============================================================================
// TIMED ACCESS QUERY ADAPTER
// =============================================================================

class TimedAccessQueryAdapter implements AccessQueryPort {
  readonly calls: MethodTiming[] = []

  constructor(private inner: FalkorDBAccessQueryAdapter) {}

  generateQuery(expr: PrunedIdentityExpr, perm: Permission): QueryFragment | null {
    const startMs = performance.now()
    const result = this.inner.generateQuery(expr, perm)
    const endMs = performance.now()
    this.calls.push({
      method: 'generateQuery',
      phase: 'decide',
      startMs,
      endMs,
      durationMs: endMs - startMs,
    })
    return result
  }

  async executeResourceCheck(fragment: QueryFragment, resourceId: NodeId): Promise<boolean> {
    const startMs = performance.now()
    const result = await this.inner.executeResourceCheck(fragment, resourceId)
    const endMs = performance.now()
    this.calls.push({
      method: 'executeResourceCheck',
      phase: 'query',
      startMs,
      endMs,
      durationMs: endMs - startMs,
      query: { cypher: fragment.condition, params: fragment.params },
    })
    return result
  }

  async executeTypeCheck(fragment: QueryFragment, typeId: NodeId): Promise<boolean> {
    const startMs = performance.now()
    const result = await this.inner.executeTypeCheck(fragment, typeId)
    const endMs = performance.now()
    this.calls.push({
      method: 'executeTypeCheck',
      phase: 'query',
      startMs,
      endMs,
      durationMs: endMs - startMs,
      query: { cypher: fragment.condition, params: fragment.params },
    })
    return result
  }

  async getTargetType(resourceId: NodeId): Promise<NodeId | null> {
    const startMs = performance.now()
    const result = await this.inner.getTargetType(resourceId)
    const endMs = performance.now()
    this.calls.push({
      method: 'getTargetType',
      phase: 'query',
      startMs,
      endMs,
      durationMs: endMs - startMs,
    })
    return result
  }

  async queryLeafDetails(
    leaves: LeafEvaluation[],
    resourceId: NodeId,
    perm: Permission,
  ): Promise<void> {
    const startMs = performance.now()
    await this.inner.queryLeafDetails(leaves, resourceId, perm)
    const endMs = performance.now()
    this.calls.push({
      method: 'queryLeafDetails',
      phase: 'query',
      startMs,
      endMs,
      durationMs: endMs - startMs,
    })
  }

  clearCache(): void {
    this.inner.clearCache()
  }
}

export class PlaygroundFalkorDBClient {
  private client: FalkorDB | null = null
  private graph: Graph | null = null
  private executor: RawExecutor | null = null
  private identityEvaluator: IdentityEvaluator | null = null
  private _graphName = ''

  get connected(): boolean {
    return this.client !== null
  }

  get graphSelected(): boolean {
    return this.graph !== null
  }

  get graphName(): string {
    return this._graphName
  }

  async connect(host: string, port: number): Promise<void> {
    if (this.client) {
      await this.disconnect()
    }
    this.client = await FalkorDB.connect({ socket: { host, port } })
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
      this.graph = null
      this.executor = null
      this.identityEvaluator = null
      this._graphName = ''
    }
  }

  async selectGraph(name: string): Promise<void> {
    if (!this.client) throw new Error('Not connected')
    this.graph = this.client.selectGraph(name)
    this.executor = createRawExecutor(this.graph)
    this.identityEvaluator = createIdentityEvaluator(this.executor)
    this._graphName = name
  }

  async listGraphs(): Promise<string[]> {
    if (!this.client) throw new Error('Not connected')
    try {
      const result = await (this.client as any).list()
      return Array.isArray(result) ? result : []
    } catch {
      return []
    }
  }

  async deleteGraph(name: string): Promise<void> {
    if (!this.client) throw new Error('Not connected')
    try {
      // Use GRAPH.DELETE command via the raw client
      await (this.client as any).connection.sendCommand(['GRAPH.DELETE', name])
      // If we deleted the current graph, clear state
      if (this._graphName === name) {
        this.graph = null
        this.executor = null
        this.identityEvaluator = null
        this._graphName = ''
      }
    } catch (e) {
      // Graph may not exist, which is fine
      console.warn(`Failed to delete graph ${name}:`, e)
    }
  }

  async clear(): Promise<void> {
    if (!this.graph) throw new Error('No graph selected')
    await clearDatabase(this.graph)
  }

  async hasData(): Promise<boolean> {
    if (!this.executor) return false
    try {
      const result = await this.executor.run('MATCH (n) RETURN count(n) as c LIMIT 1')
      const count = result[0]?.c ?? 0
      return count > 0
    } catch {
      return false
    }
  }

  /**
   * Delete old graphs matching a prefix to avoid accumulation.
   * Uses Redis DEL command since FalkorDB graphs are Redis keys.
   */
  async cleanupOldGraphs(prefix: string): Promise<number> {
    if (!this.client) return 0

    try {
      const graphs = await this.listGraphs()
      const oldGraphs = graphs.filter((g) => g.startsWith(prefix + '-'))

      console.log(`[cleanupOldGraphs] Found ${oldGraphs.length} old graphs with prefix "${prefix}"`)

      for (const graphName of oldGraphs) {
        try {
          // Use Redis DEL to remove the graph key
          // Access the underlying Redis client
          const redisClient = (this.client as any)._client
          if (redisClient?.del) {
            await redisClient.del(graphName)
            console.log(`[cleanupOldGraphs] Deleted: ${graphName}`)
          }
        } catch (e) {
          console.warn(`[cleanupOldGraphs] Failed to delete ${graphName}:`, e)
        }
      }

      return oldGraphs.length
    } catch (e) {
      console.warn('[cleanupOldGraphs] Error:', e)
      return 0
    }
  }

  async seed(): Promise<Record<string, unknown>> {
    if (!this.graph) throw new Error('No graph selected')
    if (!this.executor) throw new Error('No graph selected')

    await clearDatabase(this.graph)
    await createIndexes(this.graph)

    const exec = this.executor

    // -- helpers --
    const mkNode = async (label: string, id: string, name: string) =>
      exec.run(`CREATE (:Node:${label} {id: $id, name: $name})`, { id, name })

    const mkParent = async (child: string, par: string) =>
      exec.run(`MATCH (c {id: $c}), (p {id: $p}) CREATE (c)-[:hasParent]->(p)`, {
        c: child,
        p: par,
      })

    const mkOfType = async (mod: string, type: string) =>
      exec.run(`MATCH (m {id: $m}), (t {id: $t}) CREATE (m)-[:ofType]->(t)`, { m: mod, t: type })

    const mkPerm = async (identity: string, target: string, perms: string[]) =>
      exec.run(`MATCH (i {id: $i}), (t {id: $t}) CREATE (i)-[:hasPerm {perms: $perms}]->(t)`, {
        i: identity,
        t: target,
        perms,
      })

    const mkCompose = async (
      from: string,
      to: string,
      rel: 'unionWith' | 'intersectWith' | 'excludeWith',
    ) => exec.run(`MATCH (a {id: $a}), (b {id: $b}) CREATE (a)-[:${rel}]->(b)`, { a: from, b: to })

    // ================================================================
    // 1. SPACE
    // ================================================================
    await mkNode('Space', 'platform', 'Platform')

    // ================================================================
    // 2. TYPES
    // ================================================================
    const typeNames = ['Function', 'Config']
    for (const t of typeNames) {
      await mkNode('Type', t, t)
      await mkParent(t, 'platform')
    }

    // ================================================================
    // 3. MODULE HIERARCHY (4 levels, 12 modules)
    //
    //  platform (Space)
    //  ├── backend (Config)
    //  │   ├── api (Function)
    //  │   │   ├── rest (Function)
    //  │   │   └── graphql (Function)
    //  │   └── auth (Function)
    //  ├── data (Config)
    //  │   ├── pipelines (Function)
    //  │   │   └── etl (Function)
    //  │   └── datasets (Config)
    //  └── infra (Config)
    //      ├── monitoring (Function)
    //      └── deploy (Function)
    // ================================================================
    const modules: Array<[string, string, string, string]> = [
      ['backend', 'Backend', 'platform', 'Config'],
      ['api', 'API', 'backend', 'Function'],
      ['rest', 'REST', 'api', 'Function'],
      ['graphql', 'GraphQL', 'api', 'Function'],
      ['auth', 'Auth', 'backend', 'Function'],

      ['data', 'Data', 'platform', 'Config'],
      ['pipelines', 'Pipelines', 'data', 'Function'],
      ['etl', 'ETL', 'pipelines', 'Function'],
      ['datasets', 'Datasets', 'data', 'Config'],

      ['infra', 'Infra', 'platform', 'Config'],
      ['monitoring', 'Monitoring', 'infra', 'Function'],
      ['deploy', 'Deploy', 'infra', 'Function'],
    ]

    for (const [id, name, par, typeRef] of modules) {
      await mkNode('Module', id, name)
      await mkParent(id, par)
      await mkOfType(id, typeRef)
    }

    // ================================================================
    // 4. IDENTITIES (all parented to platform so they layout in tree)
    // ================================================================
    const appIds = ['APP-gateway', 'APP-worker']
    const userIds = ['USER-alice', 'USER-bob', 'USER-carol']
    const composedIds = ['TEAM-dev', 'SCOPED-backend']

    for (const iid of [...appIds, ...userIds, ...composedIds]) {
      await mkNode('Identity', iid, iid)
      await mkParent(iid, 'platform')
    }

    // ================================================================
    // 5. APP PERMISSIONS (on Type nodes — phase 1 type check)
    //
    // APP-gateway : can use Functions
    // APP-worker  : can use Functions and Configs
    // ================================================================
    await mkPerm('APP-gateway', 'Function', ['use'])
    await mkPerm('APP-worker', 'Function', ['use'])
    await mkPerm('APP-worker', 'Config', ['use'])

    // ================================================================
    // 6. USER PERMISSIONS (on modules — phase 2 resource check)
    //
    // USER-alice : Admin — full access at platform level
    // USER-bob   : Backend dev — read+edit backend, read data
    // USER-carol : Data eng — read+edit data, read pipelines
    // ================================================================
    await mkPerm('USER-alice', 'platform', ['read', 'edit', 'share'])
    await mkPerm('USER-bob', 'backend', ['read', 'edit'])
    await mkPerm('USER-bob', 'data', ['read'])
    await mkPerm('USER-carol', 'data', ['read', 'edit'])
    await mkPerm('USER-carol', 'pipelines', ['use'])

    // ================================================================
    // 7. COMPOSED IDENTITY PERMISSIONS
    //
    // TEAM-dev       : team-wide read on platform + use on infra
    // SCOPED-backend : edit on backend (bob-scoped)
    // ================================================================
    await mkPerm('TEAM-dev', 'platform', ['read'])
    await mkPerm('TEAM-dev', 'infra', ['use'])
    await mkPerm('SCOPED-backend', 'backend', ['edit'])

    // ================================================================
    // 8. IDENTITY COMPOSITIONS
    //
    // TEAM-dev       = union(bob, carol)
    //   bob -[unionWith]-> TEAM-dev
    //   carol -[unionWith]-> TEAM-dev
    //
    // SCOPED-backend = bob EXCLUDE carol
    //   bob -[unionWith]-> SCOPED-backend
    //   carol -[excludeWith]-> SCOPED-backend
    // ================================================================
    await mkCompose('USER-bob', 'TEAM-dev', 'unionWith')
    await mkCompose('USER-carol', 'TEAM-dev', 'unionWith')

    await mkCompose('USER-bob', 'SCOPED-backend', 'unionWith')
    await mkCompose('USER-carol', 'SCOPED-backend', 'excludeWith')

    // ================================================================
    // Summary
    // ================================================================
    const moduleIds = modules.map(([id]) => id)
    return {
      space: 'platform',
      types: typeNames,
      modules: moduleIds,
      identities: { apps: appIds, users: userIds, composed: composedIds },
      stats: {
        totalNodes:
          1 +
          typeNames.length +
          modules.length +
          appIds.length +
          userIds.length +
          composedIds.length,
        modules: modules.length,
        types: typeNames.length,
        identities: appIds.length + userIds.length + composedIds.length,
        maxDepth: 4,
      },
    }
  }

  async query<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    if (!this.executor) throw new Error('No graph selected')
    return this.executor.run<T>(cypher, params)
  }

  async getAllNodes(): Promise<Array<{ id: string; labels: string[]; name?: string }>> {
    if (!this.executor) throw new Error('No graph selected')
    const results = await this.executor.run<{
      id: string
      labels: string[]
      name: string | null
    }>(
      `MATCH (n)
       RETURN n.id AS id, labels(n) AS labels, n.name AS name`,
    )
    return results.map((r) => ({
      id: r.id,
      labels: Array.isArray(r.labels) ? r.labels : [],
      name: r.name ?? undefined,
    }))
  }

  async getAllEdges(): Promise<
    Array<{
      sourceId: string
      targetId: string
      type: string
      properties: Record<string, unknown>
    }>
  > {
    if (!this.executor) throw new Error('No graph selected')
    const results = await this.executor.run<{
      sourceId: string
      targetId: string
      type: string
      perms: string[] | null
    }>(
      `MATCH (a)-[r]->(b)
       RETURN a.id AS sourceId, b.id AS targetId, type(r) AS type, r.perms AS perms`,
    )
    return results.map((r) => ({
      sourceId: r.sourceId,
      targetId: r.targetId,
      type: r.type,
      properties: r.perms ? { perms: r.perms } : {},
    }))
  }

  private async resolveGrantTimed(
    grant: Grant,
    timedEvaluator: TimedIdentityEvaluator,
  ): Promise<Grant> {
    const [forType, forResource] = await Promise.all([
      timedEvaluator.evalExpr(grant.forType),
      timedEvaluator.evalExpr(grant.forResource),
    ])
    return { forType, forResource }
  }

  async checkAccess(params: {
    principal: IdentityId
    grant: Grant
    nodeId: NodeId
    perm: Permission
  }): Promise<{ result: AccessDecision; profile: PerformanceProfile }> {
    if (!this.executor) throw new Error('No graph selected')
    if (!this.identityEvaluator) throw new Error('No graph selected')

    const t0 = performance.now()

    // Create timed wrappers
    const timedEvaluator = new TimedIdentityEvaluator(this.identityEvaluator)
    const inner = new FalkorDBAccessQueryAdapter(this.executor)
    const timedQuery = new TimedAccessQueryAdapter(inner)

    // RESOLVE phase: evaluate grant expressions
    const resolvedGrant = await this.resolveGrantTimed(params.grant, timedEvaluator)
    const resolveGrantMs = performance.now() - t0

    // DECIDE + QUERY phases: check access
    const t1 = performance.now()
    const result = await checkAccess({ ...params, grant: resolvedGrant }, timedQuery)
    const authCheckMs = performance.now() - t1

    // Combine all calls with proper timestamps
    const allCalls = [...timedEvaluator.calls, ...timedQuery.calls]

    return {
      result,
      profile: {
        totalMs: performance.now() - t0,
        resolveGrantMs,
        authCheckMs,
        calls: allCalls,
      },
    }
  }

  async explainAccess(params: {
    principal: IdentityId
    grant: Grant
    nodeId: NodeId
    perm: Permission
  }): Promise<{ result: AccessExplanation; profile: PerformanceProfile }> {
    if (!this.executor) throw new Error('No graph selected')
    if (!this.identityEvaluator) throw new Error('No graph selected')

    const t0 = performance.now()

    // Create timed wrappers
    const timedEvaluator = new TimedIdentityEvaluator(this.identityEvaluator)
    const inner = new FalkorDBAccessQueryAdapter(this.executor)
    const timedQuery = new TimedAccessQueryAdapter(inner)

    // RESOLVE phase
    const resolvedGrant = await this.resolveGrantTimed(params.grant, timedEvaluator)
    const resolveGrantMs = performance.now() - t0

    // DECIDE + QUERY phases
    const t1 = performance.now()
    const result = await explainAccess({ ...params, grant: resolvedGrant }, timedQuery)
    const authCheckMs = performance.now() - t1

    // Combine all calls
    const allCalls = [...timedEvaluator.calls, ...timedQuery.calls]

    return {
      result,
      profile: {
        totalMs: performance.now() - t0,
        resolveGrantMs,
        authCheckMs,
        calls: allCalls,
      },
    }
  }

  /**
   * End-to-end access check starting from authentication.
   *
   * This is the full flow:
   * 1. TRUST phase: Verify JWT, resolve principal
   * 2. RESOLVE phase: Resolve grant expressions
   * 3. DECIDE phase: Generate Cypher queries
   * 4. QUERY phase: Execute queries against FalkorDB
   *
   * @param params.appId - The app identity (e.g., 'APP-gateway')
   * @param params.grant - The grant with forType and forResource expressions
   * @param params.nodeId - The resource to check access to
   * @param params.perm - The permission to check
   */
  async checkAccessE2E(params: {
    appId: IdentityId
    grant: {
      forType: IdentityExpr
      forResource: IdentityExpr
    }
    nodeId: NodeId
    perm: Permission
  }): Promise<{ result: AccessDecision; profile: PerformanceProfile }> {
    if (!this.executor) throw new Error('No graph selected')

    const t0 = performance.now()
    const allCalls: MethodTiming[] = []

    // =========================================================================
    // 1. SET UP AUTHENTICATION INFRASTRUCTURE
    // =========================================================================
    const keyStore = new IssuerKeyStore()
    const registry = new IdentityRegistry()

    // Register kernel as trusted issuer
    keyStore.registerIssuer(KERNEL_ISSUER, 'kernel-key')

    // Register the app as trusted issuer (apps self-sign their JWTs)
    keyStore.registerIssuer(params.appId, 'app-key')

    // Register app identity: when app self-signs, (appId, appId) → appId
    registry.register(params.appId, params.appId, params.appId)

    // Create timed wrappers for TRUST phase
    const verifier = new TokenVerifier(keyStore)
    const timedVerifier = new TimedTokenVerifier(verifier)
    const timedRegistry = new TimedIdentityRegistry(registry)

    // Create decoder for DECODE phase (JWT → plain IDs)
    const decoder = new GrantDecoder(verifier, registry)
    const timedDecoder = new TimedGrantDecoder(decoder)

    // =========================================================================
    // 2. CREATE APP JWT WITH USER GRANT
    // =========================================================================
    // App creates a JWT with the grant expressions embedded
    const now = Math.floor(Date.now() / 1000)
    const payload: TokenPayload = {
      iss: params.appId,
      sub: params.appId,
      aud: KERNEL_ISSUER,
      iat: now,
      exp: now + 3600,
      grant: {
        v: 1,
        // forType: app's identity for TYPE check
        forType: params.grant.forType as any,
        // forResource: user's identity expression for RESOURCE check
        forResource: params.grant.forResource as any,
      },
    }
    const token = TokenVerifier.createMockToken(payload)

    // =========================================================================
    // 3. AUTHENTICATE (TRUST + RESOLVE phases)
    // =========================================================================
    // Manually implement authenticate with timed wrappers
    // (Can't use the original authenticate function as it doesn't accept our timed wrappers)

    // TRUST: Verify JWT
    const { payload: verifiedPayload } = timedVerifier.verifyToken(token)

    // TRUST: Resolve principal from (iss, sub)
    const principal = timedRegistry.resolveIdentity(verifiedPayload.iss, verifiedPayload.sub)

    // TRUST: Security check (external apps can only embed kernel-signed tokens)
    // In our case, the grant uses plain IDs, not JWTs, so this is a no-op
    const validateSecurityStart = performance.now()
    if (verifiedPayload.iss !== KERNEL_ISSUER && verifiedPayload.grant) {
      validateGrant(verifiedPayload.iss, verifiedPayload.grant, verifier)
    }
    const validateSecurityEnd = performance.now()
    if (validateSecurityEnd - validateSecurityStart > 0.001) {
      allCalls.push({
        method: 'validateGrant',
        phase: 'trust',
        startMs: validateSecurityStart,
        endMs: validateSecurityEnd,
        durationMs: validateSecurityEnd - validateSecurityStart,
      })
    }

    // DECODE: Decode grant expressions from JWT (verify JWTs, extract plain IDs)
    const decodedGrant = await timedDecoder.decodeGrant(verifiedPayload.grant, principal)

    // Collect TRUST + DECODE phase calls
    allCalls.push(...timedVerifier.calls)
    allCalls.push(...timedRegistry.calls)
    allCalls.push(...timedDecoder.calls)

    // =========================================================================
    // 3b. IDENTITY EVALUATION (RESOLVE phase continued)
    // =========================================================================
    // Expand identity compositions from the graph.
    // If USER-bob has unionWith edges to other identities, evalExpr will
    // query the graph and build the expanded expression tree.
    if (!this.identityEvaluator) throw new Error('No identity evaluator')
    const timedEvaluator = new TimedIdentityEvaluator(this.identityEvaluator)

    const [expandedForType, expandedForResource] = await Promise.all([
      timedEvaluator.evalExpr(decodedGrant.forType),
      timedEvaluator.evalExpr(decodedGrant.forResource),
    ])

    // Collect identity evaluation calls
    allCalls.push(...timedEvaluator.calls)

    const resolveGrantMs = performance.now() - t0

    // =========================================================================
    // 4. ACCESS CHECK (DECIDE + QUERY phases)
    // =========================================================================
    const grant: Grant = {
      forType: expandedForType,
      forResource: expandedForResource,
    }

    const inner = new FalkorDBAccessQueryAdapter(this.executor)
    const timedQuery = new TimedAccessQueryAdapter(inner)

    const t1 = performance.now()
    const result = await checkAccess(
      {
        principal,
        grant,
        nodeId: params.nodeId,
        perm: params.perm,
      },
      timedQuery,
    )
    const authCheckMs = performance.now() - t1

    // Add DECIDE + QUERY phase calls
    allCalls.push(...timedQuery.calls)

    return {
      result,
      profile: {
        totalMs: performance.now() - t0,
        resolveGrantMs,
        authCheckMs,
        calls: allCalls,
      },
    }
  }

  async randomSeed(options?: {
    spaces?: number
    modulesPerSpace?: number
    types?: number
    identities?: number
  }): Promise<Record<string, unknown>> {
    if (!this.graph) throw new Error('No graph selected')
    if (!this.executor) throw new Error('No graph selected')

    const spaces = options?.spaces ?? Math.floor(Math.random() * 3) + 2
    const modsPerSpace = options?.modulesPerSpace ?? Math.floor(Math.random() * 3) + 1
    const typeCount = options?.types ?? Math.floor(Math.random() * 3) + 1
    const identityCount = options?.identities ?? Math.floor(Math.random() * 4) + 3

    await clearDatabase(this.graph)
    await createIndexes(this.graph)

    const executor = this.executor

    // Create root
    await executor.run(`CREATE (:Root {id: 'root', name: 'root'})`)

    // Create types
    const typeIds: string[] = []
    for (let i = 1; i <= typeCount; i++) {
      const tid = `T${i}`
      typeIds.push(tid)
      await executor.run(`CREATE (:Type {id: $id, name: $id})`, { id: tid })
    }

    // Create spaces
    const spaceIds: string[] = []
    for (let i = 1; i <= spaces; i++) {
      const sid = `space-${i}`
      spaceIds.push(sid)
      await executor.run(`CREATE (:Space {id: $id, name: $name})`, {
        id: sid,
        name: `Space ${i}`,
      })
      await executor.run(`MATCH (s {id: $sid}), (r {id: 'root'}) CREATE (s)-[:hasParent]->(r)`, {
        sid,
      })
    }

    // Create modules under spaces
    const moduleIds: string[] = []
    let modCounter = 1
    for (const spaceId of spaceIds) {
      for (let j = 0; j < modsPerSpace; j++) {
        const mid = `M${modCounter}`
        moduleIds.push(mid)
        await executor.run(`CREATE (:Module {id: $id, name: $id})`, { id: mid })
        await executor.run(`MATCH (m {id: $mid}), (s {id: $sid}) CREATE (m)-[:hasParent]->(s)`, {
          mid,
          sid: spaceId,
        })
        // Assign a random type
        const randomType = typeIds[Math.floor(Math.random() * typeIds.length)]!
        await executor.run(`MATCH (m {id: $mid}), (t {id: $tid}) CREATE (m)-[:ofType]->(t)`, {
          mid,
          tid: randomType,
        })
        modCounter++
      }
    }

    // Create identities
    const identIds: string[] = []
    const perms = ['read', 'edit', 'use', 'share']
    for (let i = 1; i <= identityCount; i++) {
      const iid = i <= 2 ? `APP${i}` : `USER${i - 2}`
      identIds.push(iid)
      await executor.run(`CREATE (:Identity {id: $id, name: $id})`, { id: iid })
    }

    // Create random hasPerm edges
    const permEdges: Array<{ from: string; to: string; perms: string[] }> = []
    for (const identId of identIds) {
      const numEdges = Math.floor(Math.random() * 3) + 1
      const allTargets = ['root', ...spaceIds, ...moduleIds]
      for (let p = 0; p < numEdges; p++) {
        const target = allTargets[Math.floor(Math.random() * allTargets.length)]!
        const edgePerms: string[] = []
        const numPermsPerEdge = Math.floor(Math.random() * 2) + 1
        for (let pp = 0; pp < numPermsPerEdge; pp++) {
          const perm = perms[Math.floor(Math.random() * perms.length)]!
          if (!edgePerms.includes(perm)) edgePerms.push(perm)
        }
        await executor.run(
          `MATCH (i {id: $iid}), (t {id: $tid}) CREATE (i)-[:hasPerm {perms: $perms}]->(t)`,
          { iid: identId, tid: target, perms: edgePerms },
        )
        permEdges.push({ from: identId, to: target, perms: edgePerms })
      }
    }

    // Create 0-2 random composition edges (union/intersect)
    const compEdges: Array<{ from: string; to: string; type: string }> = []
    const compCount = Math.floor(Math.random() * 3)
    for (let c = 0; c < compCount; c++) {
      if (identIds.length < 2) break
      const i1 = Math.floor(Math.random() * identIds.length)
      let i2 = Math.floor(Math.random() * identIds.length)
      while (i2 === i1) i2 = Math.floor(Math.random() * identIds.length)
      const compType = Math.random() > 0.5 ? 'unionWith' : 'intersectWith'
      await executor.run(`MATCH (a {id: $a}), (b {id: $b}) CREATE (a)-[:${compType}]->(b)`, {
        a: identIds[i1]!,
        b: identIds[i2]!,
      })
      compEdges.push({ from: identIds[i1]!, to: identIds[i2]!, type: compType })
    }

    return {
      root: 'root',
      spaces: spaceIds,
      modules: moduleIds,
      types: typeIds,
      identities: identIds,
      permissions: permEdges,
      compositions: compEdges,
    }
  }

  /**
   * Generate a scaled graph for performance testing.
   *
   * Creates a new graph with the specified scale (small, medium, large)
   * without affecting the base seed data.
   *
   * @param scale - The scale configuration to use
   * @param options - Optional seed and progress callback
   * @returns Graph metadata for scenario instantiation
   */
  async seedScaled(
    scale: Scale,
    options?: {
      seed?: number
      onProgress?: ProgressCallback
    },
  ): Promise<GraphMetadata> {
    if (!this.client) throw new Error('Not connected')

    const config = SCALE_CONFIGS[scale]

    // Clean up old graphs with same prefix before creating new one
    await this.cleanupOldGraphs(config.graphName)

    // Use a unique graph name with timestamp to avoid DELETE bug in FalkorDB
    const graphName = `${config.graphName}-${Date.now()}`
    console.log(`[seedScaled] Creating graph: ${graphName}`)

    // Select the performance graph (creates it if it doesn't exist)
    await this.selectGraph(graphName)

    if (!this.executor) throw new Error('No executor available')

    // Generate the scaled graph
    const metadata = await generateScaledGraph(this.executor, scale, {
      seed: options?.seed ?? 42,
      onProgress: options?.onProgress,
    })

    // Update the graph name to reflect the actual name used
    metadata.graphName = graphName

    return metadata
  }

  /**
   * Get the executor for direct queries (used by graph generator).
   */
  getExecutor(): RawExecutor | null {
    return this.executor
  }
}

export const playgroundClient = new PlaygroundFalkorDBClient()
