# Integration Tests - Advanced Query & Edge Case Testing

This directory contains comprehensive end-to-end integration tests that verify the typegraph system handles complex patterns, edge cases, and real-world scenarios correctly.

## Test Philosophy

These tests are designed to:
- **Break things**: Test boundary conditions and edge cases that could fail in production
- **No overlap**: Avoid duplicating spec test coverage (compilation, Cypher generation)
- **Real behavior**: Test actual database operations, not just query compilation
- **Production patterns**: Cover real-world use cases and workflows

## Test Files

### 1. `transactions-concurrency.integration.test.ts`
**Focus**: Transaction semantics, isolation, and concurrent modifications

Tests:
- Concurrent updates to same node (last-write behavior)
- Transaction rollback on error (atomic operations)
- Multi-operation transactions
- Concurrent creates with different IDs
- Concurrent link/unlink operations
- Complex query and mutation mix in transactions
- Rollback preserves existing data
- Concurrent batch operations

**Key scenarios**: Race conditions, transaction isolation, rollback integrity

---

### 2. `integrity-violations.integration.test.ts`
**Focus**: Data integrity, cardinality enforcement, constraint violations

Tests:
- Delete without detach fails when relationships exist
- Delete with detach removes relationships
- Link to non-existent nodes
- Unlink non-existent relationships
- Create with duplicate ID
- Update non-existent node
- Hierarchy cycle detection
- Move node to itself
- Batch validation failures (atomic)
- UnlinkAll operations
- Cascade delete via deleteSubtree

**Key scenarios**: Constraint enforcement, referential integrity, hierarchy validation

---

### 3. `performance-edge-cases.integration.test.ts`
**Focus**: Performance under load, large datasets, query complexity

Tests:
- Large IN lists (1000+ items)
- Deep WHERE nesting (50 levels)
- Variable length paths with bounded depth
- Fan-out queries (cartesian products)
- Batch create 100 nodes
- Batch link 500 relationships
- Deep pagination (page 50)
- Distinct on large result sets
- Complex WHERE with many fields
- Empty result set operations
- Special characters in string filters

**Key scenarios**: Query performance, resource handling, scalability

---

### 4. `queries-complex-patterns.integration.test.ts`
**Focus**: Advanced query patterns, traversals, multi-node returns

Tests:
- Self-referencing edges (user following users)
- Self-loops (user following themselves)
- Mutual relationships (bidirectional follows)
- Optional traversals returning null
- Chained optional traversals
- Multi-node returns with deep aliases
- Edge existence filtering
- whereConnectedTo optimization
- Variable length paths (depth ranges)
- Distinct removes duplicates in variable paths
- Hierarchy operations (ancestors, descendants, siblings, root)
- Complex WHERE with AND/OR/NOT
- Multiple field ordering
- Pagination consistency with stable sort

**Key scenarios**: Complex traversals, type inference, advanced filtering

---

### 5. `graphs-topology.integration.test.ts`
**Focus**: Unusual graph structures and pathological cases

Tests:
- Disconnected components (reachable boundaries)
- High fan-out (hub with 100 connections)
- High fan-in (node with 100 outgoing)
- Cycles in non-hierarchy edges
- Reachable with cycles (no infinite loops)
- Fully connected clique (every node connected)
- Star topology (central hub pattern)
- Chain topology (linear sequence)
- Isolated nodes (no connections)
- Tree topology (no cycles)

**Key scenarios**: Graph structure edge cases, cycle handling, reachability

---

### 6. `workflows-realworld.integration.test.ts`
**Focus**: Production patterns and real-world application scenarios

Tests:
- Soft delete pattern (mark as deleted, preserve data)
- Audit trail (track creation and modifications)
- Versioning (document revisions)
- Multi-tenancy (data isolation)
- Rate limiting (request counters)
- Content moderation (flag and review workflow)
- Search relevance (weighted scoring)
- Recommendation system (friend-of-friend)
- Activity feed (aggregate actions)
- Permission inheritance (folder permissions cascade)

**Key scenarios**: Common application patterns, production workflows

---

### 7. `runtime-validation.integration.test.ts`
**Focus**: Schema validation, type checking, error handling

Tests:
- Invalid email format
- Invalid enum values
- Missing required fields
- Invalid type for field
- Optional fields as undefined
- Default value handling
- Partial updates preserve other fields
- Update with invalid data
- Extra fields (stripped or preserved)
- Batch create with mixed valid/invalid
- Edge property validation
- Empty string for required field
- Null for required field
- Negative numbers where positive required
- Float where integer required
- String minimum length validation
- Date field validation
- Query type checking
- Upsert validation
- Incorrect node label queries
- Descriptive error messages

**Key scenarios**: Runtime validation, type safety, error reporting

---

## Running Tests

### Prerequisites
- Memgraph instance running on `bolt://localhost:7687`
- Or set environment variables:
  ```bash
  export MEMGRAPH_URI=bolt://your-host:7687
  export MEMGRAPH_USER=username
  export MEMGRAPH_PASSWORD=password
  ```

### Run All Integration Tests
```bash
pnpm test:integration
```

### Run Specific Test File
```bash
pnpm vitest __tests__/integration/transactions-concurrency.integration.test.ts
```

### Run with Coverage
```bash
pnpm test:integration --coverage
```

### Run in Watch Mode
```bash
pnpm vitest __tests__/integration --watch
```

---

## Test Data Setup

Each test suite uses `setupIntegrationTest()` from `./setup.ts` which:
1. Connects to Memgraph
2. Clears the database
3. Seeds test data:
   - 3 users (Alice, Bob, Charlie)
   - 3 posts (Hello World, GraphQL vs REST, Draft Post)
   - 2 comments
   - 2 tags
   - Folder hierarchy (Root -> Documents -> Work)
   - Relationships (authored, likes, follows, hasComment, etc.)

Tests create additional data as needed and clean up in `afterAll()`.

---

## Coverage Analysis

### What These Tests Cover
✅ Transaction semantics and isolation
✅ Concurrent modifications and race conditions
✅ Data integrity and constraint violations
✅ Performance with large datasets
✅ Complex query patterns (self-loops, cycles, variable paths)
✅ Graph topology edge cases
✅ Real-world production workflows
✅ Runtime validation and type safety
✅ Error handling and recovery

### What's NOT Covered (Covered by Spec Tests)
❌ Cypher compilation correctness (spec tests)
❌ AST structure verification (spec tests)
❌ Label resolution logic (spec tests)
❌ Index compilation (spec tests)
❌ Query builder API surface (spec tests)

---

## Writing New Tests

### Guidelines

1. **Test behavior, not implementation**
   - Focus on what happens, not how it's compiled
   - Verify actual database state after operations

2. **Test edge cases and boundaries**
   - What happens at limits? (empty, huge, negative)
   - What happens with invalid input?
   - What happens with concurrent access?

3. **Be adversarial**
   - Try to break the system
   - Test scenarios that could fail in production
   - Verify error handling is robust

4. **Avoid overlap**
   - Check existing tests first
   - Don't duplicate spec test coverage
   - Focus on integration, not unit behavior

5. **Use descriptive test names**
   - Explain what's being tested and expected outcome
   - Good: "concurrent updates to same node - last-write behavior"
   - Bad: "test concurrent updates"

### Example Test Structure

```typescript
it('descriptive test name explaining scenario', async () => {
  // Setup: Create test data
  const user = await ctx.graph.create('user', { ... })

  // Action: Perform operation that might fail
  const result = await ctx.graph.someOperation(...)

  // Assert: Verify expected behavior
  expect(result).toBe(expected)

  // Verify: Check database state if needed
  const dbState = await ctx.graph.verify(...)
  expect(dbState).toMatchSnapshot()
})
```

---

## Debugging Tips

### Test is Failing
1. Check Memgraph is running: `docker ps`
2. Verify connection string: `echo $MEMGRAPH_URI`
3. Run test in isolation: `vitest path/to/test.ts`
4. Add `console.log` for compiled Cypher: `console.log(query.compile().cypher)`
5. Query database directly: Use Memgraph Lab or `cypher-shell`

### Test is Slow
1. Check if creating too much data
2. Verify indexes are created
3. Use `limit()` in queries during development
4. Profile with `--reporter=verbose`

### Flaky Test
1. Likely a timing issue with concurrent operations
2. Add explicit delays: `await sleep(100)`
3. Use deterministic IDs instead of random
4. Ensure proper cleanup in `afterAll()`

---

## Contributing

When adding new tests:
1. Follow existing patterns in similar test files
2. Add tests to appropriate file (or create new file for new category)
3. Update this README with test coverage
4. Ensure tests are deterministic (no random failures)
5. Clean up all created data in `afterAll()`

---

## Test Metrics

Run `pnpm test:integration --coverage` to see:
- Line coverage
- Branch coverage
- Function coverage
- Statement coverage

Target: >80% coverage for core query and mutation paths.
