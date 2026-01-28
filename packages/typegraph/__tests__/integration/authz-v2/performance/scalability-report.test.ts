/**
 * Scalability Report Test
 *
 * Tests AUTH_V2 performance at increasing scales (1K to 1M nodes)
 * with the :Node label optimization.
 *
 * SKIPPED BY DEFAULT - Run with: RUN_PERF_TESTS=1 pnpm test:integration
 */

import { describe, it, beforeAll, afterAll } from 'vitest'

const SKIP_PERF_TESTS = !process.env.RUN_PERF_TESTS
import {
  createFalkorDBConnection,
  createRawExecutor,
  clearDatabase,
  type FalkorDBConnection,
} from '../setup'
import type { RawExecutor } from '../types'
import { benchmark, runConcurrent } from './perf-utils'
import * as fs from 'fs'
import * as path from 'path'

interface ScaleResult {
  scale: string
  nodes: number
  latency: {
    mean: number
    p95: number
    p99: number
  }
  throughput: {
    sequential: number
    concurrent: number
  }
  moveLatency: number
}

const results: ScaleResult[] = []

describe.skipIf(SKIP_PERF_TESTS)('Scalability Report', () => {
  const scales = [
    { name: '1K', workspaces: 10, foldersPerWs: 10, filesPerFolder: 10 },
    { name: '10K', workspaces: 20, foldersPerWs: 25, filesPerFolder: 20 },
    { name: '100K', workspaces: 50, foldersPerWs: 50, filesPerFolder: 40 },
    { name: '500K', workspaces: 100, foldersPerWs: 100, filesPerFolder: 50 },
    { name: '1M', workspaces: 200, foldersPerWs: 100, filesPerFolder: 50 },
  ]

  for (const scale of scales) {
    describe(`Scale: ${scale.name}`, () => {
      let connection: FalkorDBConnection
      let executor: RawExecutor
      let sampleFiles: string[]
      let sampleUsers: string[]
      let totalNodes: number

      beforeAll(async () => {
        connection = await createFalkorDBConnection(`scale_${scale.name.toLowerCase()}`)
        await clearDatabase(connection.graph)
        executor = createRawExecutor(connection.graph)

        // Create indexes with :Node as primary
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
        const result = await seedAtScale(executor, scale)
        sampleFiles = result.files
        sampleUsers = result.users
        totalNodes = result.totalNodes
        console.log(`  ✓ Created ${totalNodes.toLocaleString()} nodes`)
      }, 1200000) // 20 min timeout

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

      it(`measures performance at ${scale.name}`, async () => {
        console.log(`\n  === ${scale.name} (${totalNodes.toLocaleString()} nodes) ===`)

        // Sequential latency
        const latencyResult = await benchmark(async () => {
          const file = sampleFiles[Math.floor(Math.random() * sampleFiles.length)]
          const user = sampleUsers[Math.floor(Math.random() * sampleUsers.length)]
          return checkAccess(executor, user, file, 'read')
        }, 100)

        console.log(
          `  Latency: mean=${latencyResult.stats.mean.toFixed(2)}ms, p95=${latencyResult.stats.p95.toFixed(2)}ms`,
        )

        // Sequential throughput
        const seqStart = Date.now()
        let seqOps = 0
        while (Date.now() - seqStart < 2000) {
          const file = sampleFiles[seqOps % sampleFiles.length]
          const user = sampleUsers[seqOps % sampleUsers.length]
          await checkAccess(executor, user, file, 'read')
          seqOps++
        }
        const seqThroughput = seqOps / 2

        console.log(`  Sequential throughput: ${seqThroughput.toFixed(0)} req/s`)

        // Concurrent throughput
        const concurrentResult = await runConcurrent((i) => {
          const file = sampleFiles[i % sampleFiles.length]
          const user = sampleUsers[i % sampleUsers.length]
          return checkAccess(executor, user, file, 'read')
        }, 100)

        console.log(
          `  Concurrent throughput: ${concurrentResult.stats.throughputPerSec.toFixed(0)} req/s`,
        )

        // Move operation
        const folderId = `move_test_${scale.name}`
        const newParentId = `new_parent_${scale.name}`
        await executor.run(
          `
          CREATE (f:Node:Folder {id: $folderId})
          CREATE (np:Node:Folder {id: $newParentId})
          WITH f
          UNWIND range(1, 50) AS i
          CREATE (child:Node:File {id: $folderId + '_child_' + i})-[:hasParent]->(f)
        `,
          { folderId, newParentId },
        )

        const moveResult = await benchmark(async () => {
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
        }, 10)

        console.log(`  Move latency: ${moveResult.stats.mean.toFixed(2)}ms`)

        // Store results
        results.push({
          scale: scale.name,
          nodes: totalNodes,
          latency: {
            mean: latencyResult.stats.mean,
            p95: latencyResult.stats.p95,
            p99: latencyResult.stats.p99,
          },
          throughput: {
            sequential: seqThroughput,
            concurrent: concurrentResult.stats.throughputPerSec,
          },
          moveLatency: moveResult.stats.mean,
        })
      }, 300000)
    })
  }

  it('generates scalability report', () => {
    if (results.length === 0) {
      console.log('No results to report')
      return
    }

    // Print summary table
    console.log('\n')
    console.log(
      '  ╔════════════════════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '  ║                    AUTH_V2 SCALABILITY REPORT (with :Node label)              ║',
    )
    console.log(
      '  ╠════════════════════════════════════════════════════════════════════════════════╣',
    )
    console.log('  ║  Scale   │   Nodes    │  Mean   │  P95    │  Seq/s  │  Conc/s │  Move   ║')
    console.log(
      '  ╠════════════════════════════════════════════════════════════════════════════════╣',
    )

    for (const r of results) {
      const nodes = r.nodes.toLocaleString().padStart(10)
      const mean = r.latency.mean.toFixed(2).padStart(6) + 'ms'
      const p95 = r.latency.p95.toFixed(2).padStart(6) + 'ms'
      const seq = r.throughput.sequential.toFixed(0).padStart(7)
      const conc = r.throughput.concurrent.toFixed(0).padStart(7)
      const move = r.moveLatency.toFixed(2).padStart(6) + 'ms'
      console.log(
        `  ║  ${r.scale.padEnd(6)} │ ${nodes} │ ${mean} │ ${p95} │ ${seq} │ ${conc} │ ${move} ║`,
      )
    }

    console.log(
      '  ╚════════════════════════════════════════════════════════════════════════════════╝',
    )
    console.log('')

    // Generate HTML report
    const reportDir = path.join(__dirname, 'reports')
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true })
    }

    const html = generateHtmlReport(results)
    const htmlPath = path.join(reportDir, 'scalability-report.html')
    fs.writeFileSync(htmlPath, html)
    console.log(`  Report saved to: ${htmlPath}`)

    // Generate JSON
    const jsonPath = path.join(reportDir, 'scalability-report.json')
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2))
    console.log(`  JSON saved to: ${jsonPath}`)
  })
})

async function checkAccess(
  executor: RawExecutor,
  userId: string,
  targetId: string,
  perm: string,
): Promise<boolean> {
  const query = `
    MATCH (target:Node {id: $targetId})-[:hasParent*0..20]->(ancestor:Node)<-[:hasPerm {perm: $perm}]-(i:Identity {id: $userId})
    RETURN true AS hasAccess
    LIMIT 1
  `
  const results = await executor.run<{ hasAccess: boolean }>(query, { targetId, userId, perm })
  return results.length > 0
}

async function seedAtScale(
  executor: RawExecutor,
  config: { workspaces: number; foldersPerWs: number; filesPerFolder: number },
): Promise<{ files: string[]; users: string[]; totalNodes: number }> {
  const { workspaces, foldersPerWs, filesPerFolder } = config

  // Create root
  await executor.run(`CREATE (r:Node:Root {id: 'root'})`)

  // Create users with read on root
  const userIds: string[] = []
  for (let u = 1; u <= 20; u++) {
    userIds.push(`USER${u}`)
  }

  await executor.run(
    `
    UNWIND $userIds AS userId
    CREATE (i:Node:Identity {id: userId})
    WITH i
    MATCH (r:Root {id: 'root'})
    CREATE (i)-[:hasPerm {perm: 'read'}]->(r)
  `,
    { userIds },
  )

  const fileIds: string[] = []
  let totalNodes = 1 + userIds.length

  // Create workspaces in batches
  const wsBatchSize = 50
  for (let wStart = 1; wStart <= workspaces; wStart += wsBatchSize) {
    const wsIds: string[] = []
    for (let w = wStart; w < Math.min(wStart + wsBatchSize, workspaces + 1); w++) {
      wsIds.push(`WS${w}`)
    }

    await executor.run(
      `
      UNWIND $wsIds AS wsId
      CREATE (ws:Node:Folder {id: wsId})-[:hasParent]->(:Root {id: 'root'})
    `,
      { wsIds },
    )
    totalNodes += wsIds.length
  }

  // Create folders and files per workspace
  for (let w = 1; w <= workspaces; w++) {
    const wsId = `WS${w}`

    // Batch folders
    const folderBatchSize = 50
    for (let fStart = 1; fStart <= foldersPerWs; fStart += folderBatchSize) {
      const folderIds: string[] = []
      for (let f = fStart; f < Math.min(fStart + folderBatchSize, foldersPerWs + 1); f++) {
        folderIds.push(`${wsId}_F${f}`)
      }

      await executor.run(
        `
        UNWIND $folderIds AS folderId
        CREATE (f:Node:Folder {id: folderId})-[:hasParent]->(:Folder {id: $wsId})
      `,
        { folderIds, wsId },
      )
      totalNodes += folderIds.length

      // Create files per folder in this batch
      for (const folderId of folderIds) {
        const batchFileIds: string[] = []
        for (let i = 1; i <= filesPerFolder; i++) {
          const fileId = `${folderId}_file${i}`
          batchFileIds.push(fileId)
          if (fileIds.length < 200) fileIds.push(fileId)
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

    // Progress indicator for large scales
    if (w % 20 === 0) {
      process.stdout.write(`  ... ${w}/${workspaces} workspaces\r`)
    }
  }

  return { files: fileIds, users: userIds, totalNodes }
}

function generateHtmlReport(results: ScaleResult[]): string {
  const scales = results.map((r) => r.scale)
  const means = results.map((r) => r.latency.mean)
  const p95s = results.map((r) => r.latency.p95)
  const seqThroughputs = results.map((r) => r.throughput.sequential)
  const concThroughputs = results.map((r) => r.throughput.concurrent)

  return `<!DOCTYPE html>
<html>
<head>
  <title>AUTH_V2 Scalability Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; background: #f5f5f5; }
    h1 { color: #333; }
    .chart-container { background: white; border-radius: 8px; padding: 20px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    canvas { max-height: 400px; }
    table { border-collapse: collapse; width: 100%; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    th, td { padding: 12px 16px; text-align: right; border-bottom: 1px solid #eee; }
    th { background: #333; color: white; }
    tr:hover { background: #f9f9f9; }
    .info { background: #e8f4f8; padding: 16px; border-radius: 8px; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>AUTH_V2 Scalability Report</h1>
  <p>Generated: ${new Date().toISOString()}</p>

  <div class="info">
    <strong>Configuration:</strong> Using <code>:Node</code> label on all nodes for indexed traversal.
    No materialized paths - pure graph traversal with proper indexes.
  </div>

  <h2>Summary Table</h2>
  <table>
    <tr>
      <th>Scale</th>
      <th>Nodes</th>
      <th>Mean Latency</th>
      <th>P95 Latency</th>
      <th>Seq Throughput</th>
      <th>Conc Throughput</th>
      <th>Move Latency</th>
    </tr>
    ${results
      .map(
        (r) => `
    <tr>
      <td>${r.scale}</td>
      <td>${r.nodes.toLocaleString()}</td>
      <td>${r.latency.mean.toFixed(2)} ms</td>
      <td>${r.latency.p95.toFixed(2)} ms</td>
      <td>${r.throughput.sequential.toFixed(0)} req/s</td>
      <td>${r.throughput.concurrent.toFixed(0)} req/s</td>
      <td>${r.moveLatency.toFixed(2)} ms</td>
    </tr>
    `,
      )
      .join('')}
  </table>

  <div class="chart-container">
    <h2>Latency vs Scale</h2>
    <canvas id="latencyChart"></canvas>
  </div>

  <div class="chart-container">
    <h2>Throughput vs Scale</h2>
    <canvas id="throughputChart"></canvas>
  </div>

  <script>
    new Chart(document.getElementById('latencyChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(scales)},
        datasets: [{
          label: 'Mean Latency (ms)',
          data: ${JSON.stringify(means)},
          borderColor: '#4CAF50',
          backgroundColor: 'rgba(76, 175, 80, 0.1)',
          fill: true,
        }, {
          label: 'P95 Latency (ms)',
          data: ${JSON.stringify(p95s)},
          borderColor: '#FF9800',
          backgroundColor: 'rgba(255, 152, 0, 0.1)',
          fill: true,
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Latency (ms)' } },
          x: { title: { display: true, text: 'Scale (nodes)' } }
        }
      }
    });

    new Chart(document.getElementById('throughputChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(scales)},
        datasets: [{
          label: 'Sequential (req/s)',
          data: ${JSON.stringify(seqThroughputs)},
          backgroundColor: '#2196F3',
        }, {
          label: 'Concurrent (req/s)',
          data: ${JSON.stringify(concThroughputs)},
          backgroundColor: '#9C27B0',
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Throughput (req/s)' } }
        }
      }
    });
  </script>
</body>
</html>`
}
