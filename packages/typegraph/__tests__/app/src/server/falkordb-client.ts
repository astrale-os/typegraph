import { FalkorDB, type Graph } from 'falkordb'
import {
  createRawExecutor,
  clearDatabase,
  createIndexes,
} from '../../../integration/authz-v2/testing/setup'
import { FalkorDBAccessQueryAdapter } from '../../../integration/authz-v2/adapter/queries'
import {
  createIdentityEvaluator,
  type IdentityEvaluator,
} from '../../../integration/authz-v2/adapter/identity-evaluator'
import { checkAccess } from '../../../integration/authz-v2/authorization/checker'
import { explainAccess } from '../../../integration/authz-v2/authorization/explainer'
import type {
  RawExecutor,
  Grant,
  NodeId,
  PermissionT,
  IdentityId,
  AccessDecision,
  AccessExplanation,
} from '../../../integration/authz-v2/types'

export class PlaygroundFalkorDBClient {
  private client: FalkorDB | null = null
  private graph: Graph | null = null
  private executor: RawExecutor | null = null
  private identityEvaluator: IdentityEvaluator | null = null
  private _graphName = ''

  get connected(): boolean {
    return this.client !== null && this.graph !== null
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

  async clear(): Promise<void> {
    if (!this.graph) throw new Error('No graph selected')
    await clearDatabase(this.graph)
    this.identityEvaluator?.clearCompositionCache()
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
    this.identityEvaluator?.clearCompositionCache()
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

  private async resolveGrant(grant: Grant): Promise<Grant> {
    if (!this.identityEvaluator) return grant
    const [forType, forResource] = await Promise.all([
      this.identityEvaluator.evalExpr(grant.forType),
      this.identityEvaluator.evalExpr(grant.forResource),
    ])
    return { forType, forResource }
  }

  async checkAccess(params: {
    principal: IdentityId
    grant: Grant
    nodeId: NodeId
    perm: PermissionT
  }): Promise<AccessDecision> {
    if (!this.executor) throw new Error('No graph selected')
    const resolvedGrant = await this.resolveGrant(params.grant)
    const queryPort = new FalkorDBAccessQueryAdapter(this.executor)
    return checkAccess({ ...params, grant: resolvedGrant }, queryPort)
  }

  async explainAccess(params: {
    principal: IdentityId
    grant: Grant
    nodeId: NodeId
    perm: PermissionT
  }): Promise<AccessExplanation> {
    if (!this.executor) throw new Error('No graph selected')
    const resolvedGrant = await this.resolveGrant(params.grant)
    const queryPort = new FalkorDBAccessQueryAdapter(this.executor)
    return explainAccess({ ...params, grant: resolvedGrant }, queryPort)
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

    this.identityEvaluator?.clearCompositionCache()
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
}

export const playgroundClient = new PlaygroundFalkorDBClient()
