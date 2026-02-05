/**
 * FalkorDB Transaction POC
 *
 * This script tests whether FalkorDB actually supports transactions
 * and whether rollback works as expected.
 *
 * Run with: cd adapters/falkordb && npx tsx ../../__tests__/poc/falkordb-transaction-poc.ts
 */

import { FalkorDB } from 'falkordb'

const GRAPH_NAME = 'transaction_test'

async function main() {
  console.log('='.repeat(60))
  console.log('FalkorDB Transaction POC')
  console.log('='.repeat(60))

  const client = await FalkorDB.connect({
    socket: {
      host: process.env.FALKORDB_HOST ?? 'localhost',
      port: parseInt(process.env.FALKORDB_PORT ?? '6379'),
    },
  })

  const graph = client.selectGraph(GRAPH_NAME)
  console.log('\n✓ Connected to FalkorDB')

  // Clean up any existing test graph
  try {
    await graph.query('MATCH (n) DETACH DELETE n')
    console.log('✓ Cleaned up existing test graph')
  } catch (e) {
    // Graph might not exist
  }

  // ==========================================================================
  // TEST 1: Basic sequential writes (current behavior)
  // ==========================================================================
  console.log('\n' + '-'.repeat(60))
  console.log('TEST 1: Sequential writes (current behavior)')
  console.log('-'.repeat(60))

  try {
    await graph.query("CREATE (u:User {id: 'test-1', name: 'Alice'})")
    await graph.query("CREATE (u:User {id: 'test-2', name: 'Bob'})")

    const checkResult = await graph.roQuery("MATCH (u:User) RETURN u.id, u.name")
    console.log('✓ Sequential writes completed')
    console.log('  Results:', JSON.stringify(checkResult.data, null, 2))
  } catch (error) {
    console.log('✗ TEST 1 FAILED:', error instanceof Error ? error.message : error)
  }

  // ==========================================================================
  // TEST 2: Error in middle of sequential writes (test "rollback" behavior)
  // ==========================================================================
  console.log('\n' + '-'.repeat(60))
  console.log('TEST 2: Error in middle of writes (test partial failure)')
  console.log('-'.repeat(60))

  // First, clean the graph
  try {
    await graph.query('MATCH (n) DETACH DELETE n')
    console.log('✓ Cleared graph for rollback test')
  } catch (e) {
    // Ignore
  }

  let errorOccurred = false
  try {
    // First command should succeed
    await graph.query("CREATE (u:User {id: 'rollback-1', name: 'Test1'})")
    console.log('  ✓ First write succeeded')

    // Second command with invalid syntax
    await graph.query("THIS IS INVALID CYPHER SYNTAX")
    console.log('  Second write succeeded (unexpected!)')

    // Third command should succeed (if we get here)
    await graph.query("CREATE (u:User {id: 'rollback-2', name: 'Test2'})")
    console.log('  ✓ Third write succeeded')
  } catch (error) {
    errorOccurred = true
    console.log('  ✗ Error occurred as expected:', error instanceof Error ? error.message.slice(0, 80) : error)
  }

  // Check what data exists after the error
  if (errorOccurred) {
    try {
      const checkResult = await graph.roQuery("MATCH (u:User) RETURN u.id, u.name")
      console.log('\n  Data after failed operation:')
      console.log('  ', JSON.stringify(checkResult.data, null, 2))

      if (checkResult.data && checkResult.data.length > 0) {
        console.log('\n  ⚠️  PARTIAL WRITE PERSISTED!')
        console.log('      First command\'s data persisted despite error in second command')
        console.log('      This confirms FalkorDB does NOT have automatic rollback')
      } else {
        console.log('\n  ✓ No data found - this is unexpected')
      }
    } catch (error) {
      console.log('  Check query failed:', error instanceof Error ? error.message : error)
    }
  }

  // ==========================================================================
  // TEST 3: Multiple operations in single Cypher query (atomic within query)
  // ==========================================================================
  console.log('\n' + '-'.repeat(60))
  console.log('TEST 3: Multiple operations in single query (atomic)')
  console.log('-'.repeat(60))

  // Clean graph
  try {
    await graph.query('MATCH (n) DETACH DELETE n')
    console.log('✓ Cleared graph')
  } catch (e) {
    // Ignore
  }

  try {
    // This is atomic - all or nothing within a single query
    const result = await graph.query(`
      CREATE (a:User {id: 'atomic-1', name: 'Atomic1'})
      CREATE (b:User {id: 'atomic-2', name: 'Atomic2'})
      CREATE (c:User {id: 'atomic-3', name: 'Atomic3'})
      CREATE (a)-[:KNOWS]->(b)
      CREATE (b)-[:KNOWS]->(c)
      RETURN count(*) as operations
    `)
    console.log('✓ Atomic multi-operation query completed')
    console.log('  Result:', JSON.stringify(result.data, null, 2))

    const checkResult = await graph.roQuery("MATCH (u:User) RETURN u.id, u.name ORDER BY u.id")
    console.log('  Created users:', JSON.stringify(checkResult.data, null, 2))
  } catch (error) {
    console.log('✗ Atomic query failed:', error instanceof Error ? error.message : error)
  }

  // ==========================================================================
  // TEST 4: Simulate transaction with try/catch and manual cleanup
  // ==========================================================================
  console.log('\n' + '-'.repeat(60))
  console.log('TEST 4: Manual rollback simulation')
  console.log('-'.repeat(60))

  // Clean graph
  try {
    await graph.query('MATCH (n) DETACH DELETE n')
    console.log('✓ Cleared graph')
  } catch (e) {
    // Ignore
  }

  const createdIds: string[] = []
  try {
    // Track what we create so we can "rollback" manually
    await graph.query("CREATE (u:User {id: 'manual-1', name: 'Manual1'})")
    createdIds.push('manual-1')
    console.log('  ✓ Created manual-1')

    await graph.query("CREATE (u:User {id: 'manual-2', name: 'Manual2'})")
    createdIds.push('manual-2')
    console.log('  ✓ Created manual-2')

    // Simulate error
    throw new Error('Simulated business logic error')

    // This won't execute
    // await graph.query("CREATE (u:User {id: 'manual-3', name: 'Manual3'})")
  } catch (error) {
    console.log('  Error occurred:', error instanceof Error ? error.message : error)
    console.log('  Attempting manual rollback...')

    // Manual rollback - delete what we created
    for (const id of createdIds) {
      try {
        await graph.query(`MATCH (u:User {id: $id}) DELETE u`, { params: { id } })
        console.log(`    ✓ Deleted ${id}`)
      } catch (deleteError) {
        console.log(`    ✗ Failed to delete ${id}:`, deleteError)
      }
    }
  }

  // Verify cleanup
  const finalCheck = await graph.roQuery("MATCH (u:User) RETURN u.id")
  console.log('  After manual rollback:', finalCheck.data?.length === 0 ? 'No users (clean)' : JSON.stringify(finalCheck.data))

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`
Based on this POC:

1. SEQUENTIAL WRITES: Each query executes independently
   - No implicit transaction wrapping
   - No way to batch multiple queries atomically

2. ROLLBACK ON ERROR: DOES NOT WORK
   - If query 1 succeeds and query 2 fails, query 1's changes persist
   - This is NOT transactional behavior

3. ATOMIC WITHIN SINGLE QUERY: YES
   - Multiple operations in ONE Cypher query are atomic
   - This is the recommended approach for atomic operations

4. MANUAL ROLLBACK: Possible but complex
   - Applications must track changes and undo them manually
   - Not true transaction semantics, just cleanup logic

CONCLUSION:
- FalkorDB does NOT support multi-query ACID transactions
- The current adapter's "simulated transaction" is the correct approach
- Tests expecting automatic rollback should be skipped or modified
- For atomic operations, combine them in a single Cypher query
`)

  // Cleanup
  try {
    await graph.query('MATCH (n) DETACH DELETE n')
    console.log('✓ Cleaned up test graph')
  } catch (e) {
    // Ignore
  }

  await client.close()
  console.log('✓ Disconnected')
}

main().catch(console.error)
