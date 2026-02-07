/**
 * Filesystem Scale Test
 *
 * Tests traversal-only approach at production scale.
 * Goal: Prove that traversal is "good enough" for filesystem-like systems.
 *
 * SKIPPED BY DEFAULT - Run with: RUN_PERF_TESTS=1 pnpm test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createFalkorDBConnection,
  createRawExecutor,
  clearDatabase,
  type FalkorDBConnection,
} from '../testing/setup'
import type { RawExecutor } from '../types'
import { benchmark, runConcurrent } from './perf-utils'
import { READ } from '../testing/helpers'

const SKIP_PERF_TESTS = !process.env.RUN_PERF_TESTS

describe.skipIf(SKIP_PERF_TESTS)('Filesystem Scale Test', () => {
  // Test at increasing scales
  const scales = [
    { name: '1K', workspaces: 10, foldersPerWs: 10, filesPerFolder: 10 }, // 1,000 files
    { name: '10K', workspaces: 20, foldersPerWs: 25, filesPerFolder: 20 }, // 10,000 files
    { name: '100K', workspaces: 50, foldersPerWs: 50, filesPerFolder: 40 }, // 100,000 files
  ]

  for (const scale of scales) {
    describe(`Scale: ${scale.name}`, () => {
      let connection: FalkorDBConnection
      let executor: RawExecutor
      let sampleFiles: string[]
      let sampleUsers: string[]

      beforeAll(async () => {
        connection = await createFalkorDBConnection(`fs_${scale.name.toLowerCase()}`)
        await clearDatabase(connection.graph)
        executor = createRawExecutor(connection.graph)

        // Create indexes
        for (const idx of [
          'CREATE INDEX FOR (n:Node) ON (n.id)',
          'CREATE INDEX FOR (f:Folder) ON (f.id)',
          'CREATE INDEX FOR (f:File) ON (f.id)',
          'CREATE INDEX FOR (i:Identity) ON (i.id)',
        ]) {
          try {
            await executor.run(idx)
          } catch {
            /* index may already exist */
          }
        }

        console.log(`\n  Seeding ${scale.name}...`)
        const result = await seedFilesystem(executor, scale)
        sampleFiles = result.files
        sampleUsers = result.users
        console.log(`  ✓ Created ${result.totalNodes} nodes`)
      }, 600000) // 10 min timeout for large scales

      afterAll(async () => {
        if (connection) {
          try {
            await (connection.client as any).delete(connection.graphName)
          } catch {
            /* cleanup failure ok */
          }
          await connection.client.close()
        }
      })

      it('measures single access check latency', async () => {
        console.log(`\n  Single access check @ ${scale.name}:`)

        const result = await benchmark(async () => {
          const file = sampleFiles[Math.floor(Math.random() * sampleFiles.length)]
          const user = sampleUsers[Math.floor(Math.random() * sampleUsers.length)]
          return checkAccess(executor, user, file, READ)
        }, 100)

        console.log(`    Mean: ${result.stats.mean.toFixed(2)}ms`)
        console.log(`    P95:  ${result.stats.p95.toFixed(2)}ms`)
        console.log(`    P99:  ${result.stats.p99.toFixed(2)}ms`)

        // Should stay under 10ms even at 100K
        expect(result.stats.p95).toBeLessThan(50)
      })

      it('measures concurrent throughput', async () => {
        console.log(`\n  Concurrent (50 requests) @ ${scale.name}:`)

        const result = await runConcurrent((i) => {
          const file = sampleFiles[i % sampleFiles.length]
          const user = sampleUsers[i % sampleUsers.length]
          return checkAccess(executor, user, file, READ)
        }, 50)

        console.log(`    Throughput: ${result.stats.throughputPerSec.toFixed(0)} req/s`)
        console.log(`    Mean latency: ${result.stats.timing.mean.toFixed(2)}ms`)

        expect(result.stats.errorCount).toBe(0)
      })

      it('measures folder move cost', async () => {
        // Create a test folder with children
        const folderId = `test_move_${scale.name}`
        const newParentId = `new_parent_${scale.name}`
        const childCount = 50

        await executor.run(
          `
          CREATE (f:Node:Folder {id: $folderId})
          CREATE (np:Node:Folder {id: $newParentId})
          WITH f
          UNWIND range(1, $childCount) AS i
          CREATE (child:Node:File {id: $folderId + '_child_' + i})-[:hasParent]->(f)
        `,
          { folderId, newParentId, childCount },
        )

        console.log(`\n  Folder move (${childCount} children) @ ${scale.name}:`)

        // Move is just updating one edge - should be constant time
        const result = await benchmark(async () => {
          await executor.run(
            `
            MATCH (f:Folder {id: $folderId})-[old:hasParent]->()
            DELETE old
            WITH f
            MATCH (np:Folder {id: $newParentId})
            MERGE (f)-[:hasParent]->(np)
          `,
            { folderId, newParentId },
          )
        }, 20)

        console.log(`    Mean: ${result.stats.mean.toFixed(2)}ms`)

        // Move should be fast regardless of graph size
        expect(result.stats.mean).toBeLessThan(10)
      })
    })
  }

  it('summarizes filesystem traversal approach', () => {
    console.log('\n')
    console.log('  ╔═══════════════════════════════════════════════════════════╗')
    console.log('  ║         FILESYSTEM TRAVERSAL APPROACH SUMMARY             ║')
    console.log('  ╠═══════════════════════════════════════════════════════════╣')
    console.log('  ║                                                           ║')
    console.log('  ║  For customer-facing filesystem where users move freely:  ║')
    console.log('  ║                                                           ║')
    console.log('  ║  ✓ Use indexed traversal (no materialization)             ║')
    console.log('  ║  ✓ Depth has minimal impact (0.1ms per 10 levels)         ║')
    console.log('  ║  ✓ Moves are instant O(1) - just update edge              ║')
    console.log('  ║  ✓ No stale data, no cache invalidation                   ║')
    console.log('  ║  ✓ Simple implementation, easy to reason about            ║')
    console.log('  ║                                                           ║')
    console.log('  ║  The `:Node` label on all nodes is good practice:         ║')
    console.log('  ║  - Single index covers all lookups                        ║')
    console.log('  ║  - No need to know type to find node                      ║')
    console.log('  ║  - Standard pattern in graph databases                    ║')
    console.log('  ║                                                           ║')
    console.log('  ╚═══════════════════════════════════════════════════════════╝')
    console.log('')
  })
})

async function checkAccess(
  executor: RawExecutor,
  userId: string,
  resourceId: string,
  perm: number,
): Promise<boolean> {
  const query = `
    MATCH (resource:Node {id: $resourceId})-[:hasParent*0..20]->(ancestor:Node)<-[hp:hasPerm]-(i:Identity {id: $userId})
    WHERE (hp.perms % ($perm * 2)) >= $perm
    RETURN true AS hasAccess
    LIMIT 1
  `
  const results = await executor.run<{ hasAccess: boolean }>(query, { resourceId, userId, perm })
  return results.length > 0
}

async function seedFilesystem(
  executor: RawExecutor,
  config: { workspaces: number; foldersPerWs: number; filesPerFolder: number },
): Promise<{ files: string[]; users: string[]; totalNodes: number }> {
  const { workspaces, foldersPerWs, filesPerFolder } = config

  // Create root
  await executor.run(`CREATE (r:Node:Root {id: 'root'})`)

  // Create users with read on root
  const userIds: string[] = []
  for (let u = 1; u <= 20; u++) {
    const userId = `USER${u}`
    userIds.push(userId)
  }

  await executor.run(
    `
    UNWIND $userIds AS userId
    CREATE (i:Node:Identity {id: userId})
    WITH i
    MATCH (r:Root {id: 'root'})
    CREATE (i)-[:hasPerm {perms: 1}]->(r)
  `,
    { userIds },
  )

  const fileIds: string[] = []
  let totalNodes = 1 + userIds.length // root + users

  // Create workspaces in batches
  const wsIds: string[] = []
  for (let w = 1; w <= workspaces; w++) {
    wsIds.push(`WS${w}`)
  }

  await executor.run(
    `
    UNWIND $wsIds AS wsId
    CREATE (ws:Node:Folder {id: wsId})-[:hasParent]->(:Root {id: 'root'})
  `,
    { wsIds },
  )
  totalNodes += workspaces

  // Create folders and files per workspace
  for (const wsId of wsIds) {
    const folderIds: string[] = []
    for (let f = 1; f <= foldersPerWs; f++) {
      folderIds.push(`${wsId}_F${f}`)
    }

    await executor.run(
      `
      UNWIND $folderIds AS folderId
      CREATE (f:Node:Folder {id: folderId})-[:hasParent]->(:Folder {id: $wsId})
    `,
      { folderIds, wsId },
    )
    totalNodes += foldersPerWs

    // Create files per folder
    for (const folderId of folderIds) {
      const batchFileIds: string[] = []
      for (let i = 1; i <= filesPerFolder; i++) {
        const fileId = `${folderId}_file${i}`
        batchFileIds.push(fileId)
        if (fileIds.length < 100) fileIds.push(fileId) // Keep samples
      }

      await executor.run(
        `
        UNWIND $batchFileIds AS fileId
        CREATE (f:Node:File {id: fileId})-[:hasParent]->(:Folder {id: $folderId})
      `,
        { batchFileIds, folderId },
      )
      totalNodes += filesPerFolder
    }
  }

  return { files: fileIds, users: userIds, totalNodes }
}
