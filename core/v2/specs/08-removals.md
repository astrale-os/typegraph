# Sub-Spec 08: Removals & Migration

**Files:**
- `packages/core/src/ast/types.ts`
- `packages/core/src/ast/builder.ts`
- `packages/core/src/ast/visitor.ts`
- `packages/typegraph/src/compiler/cypher/compiler.ts`
- `packages/typegraph/src/query/*.ts`

**Dependencies:** Sub-Specs 01-07, 09 (All new features AND query builder updates implemented)
**Note:** Spec 09 must be completed before Spec 08 because removals require new query builder APIs to be in place.
**Estimated Duration:** 1-2 days

---

## Overview

This sub-spec covers the removal of deprecated types and migration of their usages. These are breaking changes and should only be executed after all new alternatives are in place and tested.

---

## Types to Remove

| Type | Reason | Replacement |
|------|--------|-------------|
| `FirstStep` | Internal implementation detail | `LimitStep` with `limit: 1` |
| `CursorStep` | Can be desugared | `SkipStep` + `LimitStep` |
| `ExistsCondition` | Unified in SubqueryCondition | `SubqueryCondition` with `mode: 'exists'` |
| `ConnectedToCondition` | Unified in SubqueryCondition | `SubqueryCondition` with traversal + ID filter |

---

## Tasks

### Task 8.1: Remove FirstStep

**Current Definition (types.ts):**
```typescript
// TO REMOVE
export interface FirstStep {
  type: 'first'
}
```

**Migration in builder.ts:**
```typescript
// Old method - TO REMOVE
first(): QueryAST {
  return this.createNew([...this._steps, { type: 'first' }])
}

// Already exists - use this instead
addLimit(limit: number): QueryAST {
  return this.createNew([...this._steps, { type: 'limit', limit }])
}
```

**Migration in query builders:**
```typescript
// In collection.ts or single-node.ts

// Old API (internal)
.first()

// New API (internal)
.limit(1)
```

**Removal Steps:**
1. [ ] Search codebase for `FirstStep` references
2. [ ] Replace all usages with `LimitStep`
3. [ ] Remove `FirstStep` interface from types.ts
4. [ ] Remove from `ASTNode` union
5. [ ] Remove `visitFirst` from visitor.ts
6. [ ] Remove `compileFirst` from compiler.ts
7. [ ] Remove `first()` method from builder.ts if exposed

**Acceptance Criteria:**
- [ ] No references to FirstStep remain
- [ ] All tests pass with LimitStep replacement

---

### Task 8.2: Remove CursorStep

**Current Definition (types.ts):**
```typescript
// TO REMOVE
export interface CursorStep {
  type: 'cursor'
  skip?: number
  limit?: number
  after?: string
  before?: string
}
```

**Migration Strategy:**

CursorStep combines skip/limit with cursor-based pagination. Desugar into separate steps:

```typescript
// Old - after cursor only
.cursor({ skip: 10, limit: 5, after: 'cursor123' })

// New (desugared)
.skip(10)
.where('id', 'gt', decodeCursor('cursor123'))
.limit(5)

// Old - before cursor only
.cursor({ limit: 5, before: 'cursor999' })

// New (desugared)
.where('id', 'lt', decodeCursor('cursor999'))
.orderBy('id', 'desc')  // Reverse order for before cursor
.limit(5)
// Note: Results must be reversed after fetching

// Old - both cursors (range query)
.cursor({ after: 'cursor123', before: 'cursor999', limit: 10 })

// New (desugared)
.where('id', 'gt', decodeCursor('cursor123'))
.where('id', 'lt', decodeCursor('cursor999'))
.limit(10)
```

**Cursor Decoding:**
```typescript
/**
 * Decode an opaque cursor to extract the last ID.
 * Cursors are typically base64-encoded JSON with format: { lastId: string, ... }
 *
 * @throws CursorDecodeError if cursor is invalid or expired
 */
function decodeCursor(cursor: string): { lastId: string } {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'))
    if (!decoded.lastId || typeof decoded.lastId !== 'string') {
      throw new CursorDecodeError('Invalid cursor format: missing lastId')
    }
    return decoded
  } catch (e) {
    if (e instanceof CursorDecodeError) throw e
    throw new CursorDecodeError(`Failed to decode cursor: ${e.message}`)
  }
}
```

**Migration in query builders:**
```typescript
// In collection.ts

// Keep the public API but desugar internally
cursor(options: CursorOptions): CollectionBuilder {
  let builder = this as CollectionBuilder

  if (options.after) {
    const decodedCursor = this.decodeCursor(options.after)
    builder = builder.where('id', 'gt', decodedCursor.lastId)
  }

  if (options.skip) {
    builder = builder.skip(options.skip)
  }

  if (options.limit) {
    builder = builder.limit(options.limit)
  }

  return builder
}
```

**Removal Steps:**
1. [ ] Identify all CursorStep usages
2. [ ] Implement desugaring in query builders
3. [ ] Remove `CursorStep` interface from types.ts
4. [ ] Remove from `ASTNode` union
5. [ ] Remove `visitCursor` from visitor.ts
6. [ ] Remove `compileCursor` from compiler.ts
7. [ ] Remove `addCursor` from builder.ts

**Acceptance Criteria:**
- [ ] Cursor functionality preserved via desugaring
- [ ] No CursorStep references in AST layer
- [ ] Query builder cursor() API unchanged (if public)

---

### Task 8.3: Remove ExistsCondition

**Current Definition (types.ts:61-67) - VERIFIED:**
```typescript
// TO REMOVE - This is the ACTUAL current definition
export interface ExistsCondition {
  type: 'exists'
  edge: string
  direction: 'out' | 'in' | 'both'
  target: string
  negated: boolean  // NOTE: Required, not optional
  // NOTE: No toLabel field in current implementation
}
```

**Migration Helper:**
```typescript
// Add to builder.ts or a migration utility

// Returns discriminated union type - SubqueryExistsCondition or SubqueryNotExistsCondition
function migrateExistsCondition(
  cond: ExistsCondition,
  aliasCounter: number
): SubqueryExistsCondition | SubqueryNotExistsCondition {
  const subAlias = `_migrated_${aliasCounter}`

  const baseQuery = [{
    type: 'traversal',
    fromAlias: cond.target,
    edge: cond.edge,
    direction: cond.direction,
    toAlias: subAlias,
    toLabels: [],  // ExistsCondition has no label filter
    optional: false,
    cardinality: 'many',
  }]

  // Return specific discriminated union type based on negated flag
  if (cond.negated) {
    return {
      type: 'subquery',
      mode: 'notExists',
      query: baseQuery,
      correlatedAliases: [cond.target],
    } satisfies SubqueryNotExistsCondition
  } else {
    return {
      type: 'subquery',
      mode: 'exists',
      query: baseQuery,
      correlatedAliases: [cond.target],
    } satisfies SubqueryExistsCondition
  }
}
```

**Migration in query builders:**
```typescript
// In collection.ts

// Old internal implementation
hasEdge(edge: E, direction: Direction = 'out'): CollectionBuilder {
  const condition: ExistsCondition = {
    type: 'exists',
    target: this.currentAlias,
    edge,
    direction,
  }
  return this.addWhere([condition])
}

// New internal implementation
hasEdge(edge: E, direction: Direction = 'out'): CollectionBuilder {
  return this.whereExists(sub =>
    sub.addTraversal({
      fromAlias: this.currentAlias,
      edge,
      direction,
      toAlias: `_edge_${this.aliasCounter}`,
      toLabels: [],
    })
  )
}
```

**Removal Steps:**
1. [ ] Create migration helper function
2. [ ] Update `hasEdge()` to use SubqueryCondition
3. [ ] Update `hasNoEdge()` to use SubqueryCondition with notExists
4. [ ] Search for all `ExistsCondition` usages
5. [ ] Remove `ExistsCondition` interface from types.ts
6. [ ] Remove from `WhereCondition` union
7. [ ] Remove `compileExistsCondition` from compiler.ts

**Acceptance Criteria:**
- [ ] hasEdge()/hasNoEdge() work with SubqueryCondition
- [ ] No ExistsCondition references remain
- [ ] All existence check tests pass

---

### Task 8.4: Remove ConnectedToCondition

**CRITICAL PERFORMANCE WARNING:**

The current compiler has an important optimization for ConnectedToCondition in
`compiler.ts:285-419` (`compileConnectedToAsMatch()`). This optimization:

1. Extracts ConnectedToCondition from WHERE steps
2. Generates: `MATCH (n0)-[:EDGE]->(target0 {id: $p0})`
3. Allows query planner to use index on target node ID (FAST)

Without this optimization, the naive SubqueryCondition migration generates:
```cypher
WHERE EXISTS { MATCH (n0)-[:EDGE]->(t) WHERE t.id = $p0 }
```
This starts from n0 scan, then checks each node (SLOW).

**REQUIRED: Preserve optimization in SubqueryCondition compiler**

When compiling SubqueryCondition with:
- mode: 'exists'
- Single traversal step
- Single WHERE with field='id' and operator='eq'

Generate the optimized MATCH pattern instead of EXISTS { }.

**Current Definition (types.ts:73-83) - VERIFIED:**
```typescript
// TO REMOVE - This is the ACTUAL current definition
export interface ConnectedToCondition {
  type: 'connectedTo'
  edge: string
  direction: 'out' | 'in'  // NOTE: No 'both' - verified from types.ts:78
  nodeId: string
  target: string
  // NOTE: No nodeLabel field in current implementation
}
```

**Migration Helper:**
```typescript
// Returns SubqueryExistsCondition specifically (mode is always 'exists')
// CRITICAL: This pattern MUST trigger optimization in compiler (see Spec 05 Task 5.7)
function migrateConnectedToCondition(
  cond: ConnectedToCondition,
  aliasCounter: number
): SubqueryExistsCondition {
  const subAlias = `_migrated_${aliasCounter}`

  // NOTE: This pattern should trigger the optimization in SubqueryCondition compiler
  // The compiler should detect this pattern and use MATCH instead of EXISTS
  // Pattern: exists mode + single traversal + WHERE id=eq
  return {
    type: 'subquery',
    mode: 'exists',
    query: [
      {
        type: 'traversal',
        fromAlias: cond.target,
        edge: cond.edge,
        direction: cond.direction,
        toAlias: subAlias,
        toLabels: [],  // ConnectedToCondition has no label filter
        optional: false,
        cardinality: 'many',
      },
      {
        type: 'where',
        conditions: [{
          type: 'comparison',
          field: 'id',
          operator: 'eq',
          value: { kind: 'literal', value: cond.nodeId },
          target: subAlias,
        }],
      },
    ],
    correlatedAliases: [cond.target],
  } satisfies SubqueryExistsCondition
}
```

**Migration in query builders:**
```typescript
// In collection.ts

// Old internal implementation
whereConnectedTo(nodeId: string, edge: E, direction: Direction = 'out') {
  const condition: ConnectedToCondition = {
    type: 'connectedTo',
    target: this.currentAlias,
    edge,
    direction,
    nodeId,
  }
  return this.addWhere([condition])
}

// New internal implementation
whereConnectedTo(nodeId: string, edge: E, direction: Direction = 'out') {
  return this.whereExists(sub =>
    sub
      .addTraversal({
        fromAlias: this.currentAlias,
        edge,
        direction,
        toAlias: `_conn_${this.aliasCounter}`,
        toLabels: [],
      })
      .addWhere([{
        type: 'comparison',
        field: 'id',
        operator: 'eq',
        value: nodeId,
        target: `_conn_${this.aliasCounter}`,
      }])
  )
}
```

**Removal Steps:**
1. [ ] Create migration helper function
2. [ ] Update `whereConnectedTo()` to use SubqueryCondition
3. [ ] Update `whereConnectedFrom()` similarly
4. [ ] Search for all `ConnectedToCondition` usages
5. [ ] Remove `ConnectedToCondition` interface from types.ts
6. [ ] Remove from `WhereCondition` union
7. [ ] Remove `compileConnectedToCondition` from compiler.ts

**Acceptance Criteria:**
- [ ] whereConnectedTo()/whereConnectedFrom() work with SubqueryCondition
- [ ] No ConnectedToCondition references remain
- [ ] All connectivity check tests pass

---

### Task 8.5: Update Type Unions

**After all removals, update the unions:**

```typescript
// types.ts

// Remove deprecated types from ASTNode
export type ASTNode =
  | MatchStep
  | MatchByIdStep
  | TraversalStep
  | WhereStep
  | AliasStep
  | BranchStep
  | PathStep
  | AggregateStep
  | OrderByStep
  | LimitStep
  | SkipStep
  | DistinctStep
  | HierarchyStep
  | ReachableStep
  | ForkStep
  // New v2 types
  | PatternStep
  | SubqueryStep
  | UnwindStep
  | ReturnStep
  // REMOVED: CursorStep, FirstStep

// Remove deprecated types from WhereCondition
export type WhereCondition =
  | ComparisonCondition
  | LogicalCondition
  | LabelCondition
  | SubqueryCondition
  // REMOVED: ExistsCondition, ConnectedToCondition
```

**Acceptance Criteria:**
- [ ] ASTNode union updated
- [ ] WhereCondition union updated
- [ ] TypeScript compiles without errors

---

### Task 8.6: Clean Up Visitor

**Remove deprecated visitor methods:**

```typescript
// visitor.ts

export interface ASTVisitorInterface<TResult, TContext = void> {
  // REMOVE:
  // visitFirst?(node: FirstStep, context: TContext): TResult
  // visitCursor?(node: CursorStep, context: TContext): TResult

  // REMOVE from visitCondition:
  // case 'exists':
  // case 'connectedTo':
}

// Update visit() switch to remove deprecated cases
visit(node: ASTNode, context: TContext): TResult | undefined {
  switch (node.type) {
    // ... active cases ...

    // REMOVE:
    // case 'first':
    // case 'cursor':

    default:
      const _exhaustive: never = node
      throw new Error(`Unknown node type: ${(node as any).type}`)
  }
}
```

**Acceptance Criteria:**
- [ ] No deprecated visitor methods remain
- [ ] Exhaustiveness check passes

---

### Task 8.7: Clean Up Compiler

**Remove deprecated compilation methods:**

```typescript
// compiler.ts

// REMOVE these methods:
// private compileFirst(step: FirstStep): void { ... }
// private compileCursor(step: CursorStep): void { ... }
// private compileExistsCondition(cond: ExistsCondition): string { ... }
// private compileConnectedToCondition(cond: ConnectedToCondition): string { ... }

// Update compileStep switch
private compileStep(step: ASTNode): void {
  switch (step.type) {
    // ... active cases ...

    // REMOVE:
    // case 'first':
    // case 'cursor':
  }
}

// Update compileCondition switch
private compileCondition(condition: WhereCondition): string {
  switch (condition.type) {
    // ... active cases ...

    // REMOVE:
    // case 'exists':
    // case 'connectedTo':
  }
}
```

**Acceptance Criteria:**
- [ ] No deprecated compiler methods remain
- [ ] All switch cases updated

---

### Task 8.8: Deprecation Period (Optional)

If a deprecation period is desired before removal:

```typescript
// Add deprecation warnings

/** @deprecated Use LimitStep with limit: 1 instead */
export interface FirstStep {
  type: 'first'
}

// In builder.ts
/** @deprecated Use limit(1) instead */
first(): QueryAST {
  console.warn('first() is deprecated, use limit(1) instead')
  return this.addLimit(1)
}

// In compiler.ts
private compileFirst(step: FirstStep): void {
  console.warn('FirstStep is deprecated')
  this.compileLimit({ type: 'limit', limit: 1 })
}
```

**Acceptance Criteria:**
- [ ] Deprecated types marked with @deprecated JSDoc
- [ ] Runtime warnings added
- [ ] Deprecated implementations delegate to new ones

---

## Testing

### Migration Tests

```typescript
// test/migration/removals.test.ts

describe('Migration: Removed Types', () => {
  describe('FirstStep → LimitStep', () => {
    it('produces equivalent results', async () => {
      // Test that limit(1) produces same result as old first()
      const oldResult = await legacyQuery.node('User').first().execute()
      const newResult = await graph.node('User').limit(1).execute()

      expect(newResult).toEqual(oldResult)
    })
  })

  describe('ExistsCondition → SubqueryCondition', () => {
    it('hasEdge produces equivalent results', async () => {
      // Setup test data
      await setupTestData()

      // Old query (simulated)
      const oldCypher = `
        MATCH (u:User)
        WHERE EXISTS { (u)-[:AUTHORED]->(:Post) }
        RETURN u
      `

      // New query
      const newResult = await graph
        .node('User')
        .whereExists(q => q.to('AUTHORED'))
        .execute()

      // Compare results
      expect(newResult).toHaveLength(expectedCount)
    })
  })

  describe('ConnectedToCondition → SubqueryCondition', () => {
    it('whereConnectedTo produces equivalent results', async () => {
      await setupTestData()

      const result = await graph
        .node('User')
        .whereConnectedTo('post-123', 'AUTHORED', 'out')
        .execute()

      expect(result).toHaveLength(1)
    })
  })
})
```

### Type Safety Tests

```typescript
// test/types/removals.test-d.ts

import { expectError } from 'tsd'
import type { ASTNode, WhereCondition } from '@astrale/typegraph-core'

// After removal, these should be type errors
expectError<ASTNode>({ type: 'first' })
expectError<ASTNode>({ type: 'cursor', skip: 10 })
expectError<WhereCondition>({ type: 'exists', target: 'n0', edge: 'E' })
expectError<WhereCondition>({ type: 'connectedTo', target: 'n0', edge: 'E', nodeId: '123' })
```

---

## Checklist

- [ ] Task 8.1: Remove FirstStep
- [ ] Task 8.2: Remove CursorStep (with desugaring)
- [ ] Task 8.3: Remove ExistsCondition (with migration helper)
- [ ] Task 8.4: Remove ConnectedToCondition (with migration helper)
- [ ] Task 8.5: Update type unions
- [ ] Task 8.6: Clean up visitor
- [ ] Task 8.7: Clean up compiler
- [ ] Task 8.8: Deprecation period (optional)
- [ ] Migration tests written
- [ ] Type safety tests written
- [ ] All tests passing
- [ ] No TypeScript errors

---

*Sub-spec version: 1.0*
