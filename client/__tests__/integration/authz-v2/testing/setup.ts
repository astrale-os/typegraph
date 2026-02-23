/**
 * AUTH_V2 Integration Test Setup
 *
 * Provides utilities for testing the capability-based access control system
 * against a real FalkorDB instance.
 */

import { FalkorDB, type Graph } from 'falkordb'
import type { AuthzTestData, RawExecutor } from '../types'

// =============================================================================
// CONNECTION CONFIGURATION
// =============================================================================

const FALKORDB_HOST = process.env.FALKORDB_HOST ?? 'localhost'
const FALKORDB_PORT = parseInt(process.env.FALKORDB_PORT ?? '6379', 10)
const GRAPH_NAME_PREFIX = 'authz_v2_test'

// Counter to generate unique graph names per test suite
let graphCounter = 0

// =============================================================================
// FALKORDB CONNECTION
// =============================================================================

export interface FalkorDBConnection {
  client: FalkorDB
  graph: Graph
  graphName: string
}

export async function createFalkorDBConnection(graphSuffix?: string): Promise<FalkorDBConnection> {
  const client = await FalkorDB.connect({
    socket: {
      host: FALKORDB_HOST,
      port: FALKORDB_PORT,
    },
  })

  const graphName = graphSuffix
    ? `${GRAPH_NAME_PREFIX}_${graphSuffix}`
    : `${GRAPH_NAME_PREFIX}_${++graphCounter}_${Date.now()}`

  const graph = client.selectGraph(graphName)

  return { client, graph, graphName }
}

// =============================================================================
// RAW EXECUTOR
// =============================================================================

/**
 * Transform FalkorDB result to plain objects.
 */
function transformResult<T>(record: Record<string, unknown>): T {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>
      // Node with properties
      if ('properties' in obj) {
        result[key] = obj.properties
      } else {
        result[key] = value
      }
    } else {
      result[key] = value
    }
  }

  return result as T
}

export function createRawExecutor(graph: Graph): RawExecutor {
  return {
    async run<T>(query: string, params?: Record<string, unknown>): Promise<T[]> {
      const result = (await graph.query(query, { params: (params ?? {}) as any })) as any
      const records: T[] = []

      // FalkorDB returns data differently
      if (result.data) {
        for (const row of result.data) {
          if (Array.isArray(row)) {
            // Convert array to object using header names
            const obj: Record<string, unknown> = {}
            if (result.header) {
              result.header.forEach((col: string, idx: number) => {
                obj[col] = row[idx]
              })
            }
            records.push(transformResult<T>(obj))
          } else if (typeof row === 'object') {
            records.push(transformResult<T>(row as Record<string, unknown>))
          }
        }
      }

      return records
    },
  }
}

// =============================================================================
// DATABASE OPERATIONS
// =============================================================================

export async function clearDatabase(graph: Graph): Promise<void> {
  try {
    await graph.query('MATCH (n) DETACH DELETE n')
  } catch {
    // Graph might not exist yet, ignore
  }
}

export async function createIndexes(graph: Graph): Promise<void> {
  // Create indexes for performance (ignore errors if they already exist)
  // The :Node index is the primary lookup - all nodes have this label
  const indexes = [
    'CREATE INDEX FOR (n:Node) ON (n.id)', // Primary index - covers all nodes
    'CREATE INDEX FOR (i:Identity) ON (i.id)',
    'CREATE INDEX FOR (m:Module) ON (m.id)',
    'CREATE INDEX FOR (t:Type) ON (t.id)',
    'CREATE INDEX FOR (s:Space) ON (s.id)',
    'CREATE INDEX FOR (r:Root) ON (r.id)',
  ]

  for (const indexQuery of indexes) {
    try {
      await graph.query(indexQuery)
    } catch {
      // Index may already exist, ignore
    }
  }
}

// =============================================================================
// SEED DATA
// =============================================================================

export async function seedAuthzTestData(graph: Graph): Promise<AuthzTestData> {
  // All nodes get :Node label for universal indexing
  // This enables efficient lookups without knowing the node type

  // === TYPES ===
  await graph.query('CREATE (t:Node:Type {id: $id, name: $name})', {
    params: { id: 'T1', name: 'Type 1' },
  })
  await graph.query('CREATE (t:Node:Type {id: $id, name: $name})', {
    params: { id: 'T2', name: 'Type 2' },
  })

  // === ROOT ===
  await graph.query('CREATE (r:Node:Root {id: $id})', { params: { id: 'root' } })

  // === SPACES ===
  await graph.query('CREATE (s:Node:Space {id: $id, name: $name})', {
    params: { id: 'workspace-1', name: 'Workspace 1' },
  })
  await graph.query('CREATE (s:Node:Space {id: $id, name: $name})', {
    params: { id: 'workspace-2', name: 'Workspace 2' },
  })

  // Space -> Root hierarchy
  await graph.query(
    `MATCH (s:Space {id: $spaceId}), (r:Root {id: $rootId})
     CREATE (s)-[:hasParent]->(r)`,
    { params: { spaceId: 'workspace-1', rootId: 'root' } },
  )
  await graph.query(
    `MATCH (s:Space {id: $spaceId}), (r:Root {id: $rootId})
     CREATE (s)-[:hasParent]->(r)`,
    { params: { spaceId: 'workspace-2', rootId: 'root' } },
  )

  // === MODULES ===
  await graph.query('CREATE (m:Node:Module {id: $id, name: $name})', {
    params: { id: 'M1', name: 'Module 1' },
  })
  await graph.query('CREATE (m:Node:Module {id: $id, name: $name})', {
    params: { id: 'M2', name: 'Module 2' },
  })
  await graph.query('CREATE (m:Node:Module {id: $id, name: $name})', {
    params: { id: 'M3', name: 'Module 3' },
  })

  // Module -> Space hierarchy
  await graph.query(
    `MATCH (m:Module {id: $moduleId}), (s:Space {id: $spaceId})
     CREATE (m)-[:hasParent]->(s)`,
    { params: { moduleId: 'M1', spaceId: 'workspace-1' } },
  )
  await graph.query(
    `MATCH (m:Module {id: $moduleId}), (s:Space {id: $spaceId})
     CREATE (m)-[:hasParent]->(s)`,
    { params: { moduleId: 'M2', spaceId: 'workspace-1' } },
  )
  await graph.query(
    `MATCH (m:Module {id: $moduleId}), (s:Space {id: $spaceId})
     CREATE (m)-[:hasParent]->(s)`,
    { params: { moduleId: 'M3', spaceId: 'workspace-2' } },
  )

  // Module -> Type
  await graph.query(
    `MATCH (m:Module {id: $moduleId}), (t:Type {id: $typeId})
     CREATE (m)-[:ofType]->(t)`,
    { params: { moduleId: 'M1', typeId: 'T1' } },
  )
  await graph.query(
    `MATCH (m:Module {id: $moduleId}), (t:Type {id: $typeId})
     CREATE (m)-[:ofType]->(t)`,
    { params: { moduleId: 'M2', typeId: 'T1' } },
  )
  await graph.query(
    `MATCH (m:Module {id: $moduleId}), (t:Type {id: $typeId})
     CREATE (m)-[:ofType]->(t)`,
    { params: { moduleId: 'M3', typeId: 'T1' } },
  )

  // === IDENTITIES ===
  await graph.query('CREATE (i:Node:Identity {id: $id, name: $name})', {
    params: { id: 'APP1', name: 'App 1' },
  })
  await graph.query('CREATE (i:Node:Identity {id: $id, name: $name})', {
    params: { id: 'USER1', name: 'User 1' },
  })
  await graph.query('CREATE (i:Node:Identity {id: $id, name: $name})', {
    params: { id: 'ROLE1', name: 'Role 1' },
  })

  // === APP PERMISSIONS (type perms) ===
  await graph.query(
    `MATCH (i:Identity {id: $identityId}), (t:Type {id: $typeId})
     CREATE (i)-[:hasPerm {perms: 4}]->(t)`,
    { params: { identityId: 'APP1', typeId: 'T1' } },
  )

  // === USER PERMISSIONS (target perms) ===
  // USER1 has read on root (inherited by all)
  await graph.query(
    `MATCH (i:Identity {id: $identityId}), (r:Root {id: $rootId})
     CREATE (i)-[:hasPerm {perms: 1}]->(r)`,
    { params: { identityId: 'USER1', rootId: 'root' } },
  )
  // USER1 has edit on workspace-1
  await graph.query(
    `MATCH (i:Identity {id: $identityId}), (s:Space {id: $spaceId})
     CREATE (i)-[:hasPerm {perms: 2}]->(s)`,
    { params: { identityId: 'USER1', spaceId: 'workspace-1' } },
  )

  // === ROLE PERMISSIONS ===
  // ROLE1 has edit on workspace-2
  await graph.query(
    `MATCH (i:Identity {id: $identityId}), (s:Space {id: $spaceId})
     CREATE (i)-[:hasPerm {perms: 2}]->(s)`,
    { params: { identityId: 'ROLE1', spaceId: 'workspace-2' } },
  )

  // === COMPOSITION: USER1 unionWith ROLE1 ===
  await graph.query(
    `MATCH (u:Identity {id: $userId}), (r:Identity {id: $roleId})
     CREATE (u)-[:unionWith]->(r)`,
    { params: { userId: 'USER1', roleId: 'ROLE1' } },
  )

  // === INTERSECTION TEST IDENTITIES ===
  await graph.query('CREATE (i:Node:Identity {id: $id})', { params: { id: 'A' } })
  await graph.query('CREATE (i:Node:Identity {id: $id})', { params: { id: 'B' } })
  await graph.query('CREATE (i:Node:Identity {id: $id})', { params: { id: 'X' } })

  // A has read on M1 and M2
  await graph.query(
    `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
     CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
    { params: { identityId: 'A', moduleId: 'M1' } },
  )
  await graph.query(
    `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
     CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
    { params: { identityId: 'A', moduleId: 'M2' } },
  )

  // B has read on M1 only
  await graph.query(
    `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
     CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
    { params: { identityId: 'B', moduleId: 'M1' } },
  )

  // X = A intersect B
  await graph.query(
    `MATCH (x:Identity {id: $xId}), (a:Identity {id: $aId})
     CREATE (x)-[:intersectWith]->(a)`,
    { params: { xId: 'X', aId: 'A' } },
  )
  await graph.query(
    `MATCH (x:Identity {id: $xId}), (b:Identity {id: $bId})
     CREATE (x)-[:intersectWith]->(b)`,
    { params: { xId: 'X', bId: 'B' } },
  )

  return {
    identities: {
      app1: 'APP1',
      user1: 'USER1',
      role1: 'ROLE1',
      x: 'X',
      a: 'A',
      b: 'B',
    },
    types: { t1: 'T1', t2: 'T2' },
    modules: { m1: 'M1', m2: 'M2', m3: 'M3' },
    spaces: { ws1: 'workspace-1', ws2: 'workspace-2' },
    root: 'root',
  }
}

// =============================================================================
// TEST CONTEXT
// =============================================================================

export interface AuthzTestContext {
  connection: FalkorDBConnection
  executor: RawExecutor
  data: AuthzTestData
}

export async function setupAuthzTest(): Promise<AuthzTestContext> {
  const connection = await createFalkorDBConnection()

  await clearDatabase(connection.graph)
  await createIndexes(connection.graph)
  const data = await seedAuthzTestData(connection.graph)

  const executor = createRawExecutor(connection.graph)

  return { connection, executor, data }
}

export async function teardownAuthzTest(ctx: AuthzTestContext): Promise<void> {
  // Delete the graph entirely to clean up
  try {
    await (ctx.connection.client as any).delete(ctx.connection.graphName)
  } catch {
    // Graph might not exist, ignore
  }
  await ctx.connection.client.close()
}
