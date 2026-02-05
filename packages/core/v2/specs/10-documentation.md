# Sub-Spec 10: Documentation & Examples

**Files:**
- `packages/core/README.md`
- `packages/typegraph/README.md`
- `CHANGELOG.md`
- `docs/` (new directory)

**Dependencies:** Sub-Specs 01-09 (All implementation complete)
**Estimated Duration:** 1-2 days

---

## Overview

This sub-spec covers documentation updates for all v2 features, including API docs, migration guide, and examples.

---

## Tasks

### Task 10.1: Update Package README Files

**Core Package README:**
```markdown
# @astrale/typegraph-core

Core types and AST definitions for TypeGraph.

## New in v2

### Pattern Matching

Express complex graph shapes declaratively:

```typescript
import type { PatternStep, PatternNode, PatternEdge } from '@astrale/typegraph-core'

const pattern: PatternStep = {
  type: 'pattern',
  nodes: [
    { alias: 'a', labels: ['User'] },
    { alias: 'b', labels: ['Project'] },
    { alias: 'c', labels: ['Team'] },
    { alias: 'd', labels: ['Milestone'] },
  ],
  edges: [
    { from: 'a', to: 'b', types: ['OWNS'], direction: 'out', optional: false },
    { from: 'a', to: 'c', types: ['MEMBER_OF'], direction: 'out', optional: false },
    { from: 'b', to: 'd', types: ['HAS'], direction: 'out', optional: false },
    { from: 'c', to: 'd', types: ['ASSIGNED'], direction: 'out', optional: false },
  ],
}
```

### Subquery Conditions

Unified existence and count checks:

```typescript
import type { SubqueryCondition } from '@astrale/typegraph-core'

// Existence check
const exists: SubqueryCondition = {
  type: 'subquery',
  mode: 'exists',
  query: [...],
  correlatedAliases: ['user'],
}

// Count comparison
const countCheck: SubqueryCondition = {
  type: 'subquery',
  mode: 'count',
  query: [...],
  countPredicate: { operator: 'gt', value: 5 },
  correlatedAliases: ['user'],
}
```

### Projection Expressions

Computed return values:

```typescript
import type { ProjectionExpression, ReturnStep } from '@astrale/typegraph-core'

const fullName: ProjectionExpression = {
  type: 'computed',
  operator: 'concat',
  operands: [
    { type: 'field', alias: 'user', field: 'firstName' },
    { type: 'literal', value: ' ' },
    { type: 'field', alias: 'user', field: 'lastName' },
  ],
}
```
```

**Acceptance Criteria:**
- [ ] Core README updated with v2 types
- [ ] Examples for new types
- [ ] Links to full documentation

---

### Task 10.2: Create Migration Guide

**File:** `docs/migration-v2.md`

```markdown
# Migration Guide: v1 to v2

This guide covers migrating from TypeGraph v1 to v2.

## Breaking Changes

### Removed Types

| v1 Type | v2 Replacement | Migration |
|---------|----------------|-----------|
| `FirstStep` | `LimitStep` | Use `limit(1)` instead of `first()` |
| `CursorStep` | `SkipStep` + `LimitStep` | Cursor is now desugared internally |
| `ExistsCondition` | `SubqueryCondition` | See [Existence Checks](#existence-checks) |
| `ConnectedToCondition` | `SubqueryCondition` | See [Connectivity Checks](#connectivity-checks) |

### Existence Checks

**v1:**
```typescript
// Old API (still works, but deprecated)
graph.node('User').hasEdge('AUTHORED', 'out')
```

**v2:**
```typescript
// New API (preferred)
graph.node('User').whereExists(q => q.to('AUTHORED'))

// Or with more complex conditions
graph.node('User').whereExists(q =>
  q.to('AUTHORED', 'Post').where('status', 'eq', 'published')
)
```

### Connectivity Checks

**v1:**
```typescript
// Old API (still works, but deprecated)
graph.node('User').whereConnectedTo('post-123', 'AUTHORED')
```

**v2:**
```typescript
// New API (preferred)
graph.node('User').whereExists(q =>
  q.to('AUTHORED').where('id', 'eq', 'post-123')
)
```

### Projection Changes

**v1:**
```typescript
// Projection via separate field
const query = graph.node('User')
query._ast.setProjection({ mode: 'single', alias: 'user' })
```

**v2:**
```typescript
// Projection as pipeline step
graph.node('User')
  .return({ name: 'user.name', email: 'user.email' })
```

## New Features

### Pattern Matching

Match complex graph shapes:

```typescript
// Find diamond patterns
const results = await graph.pattern({
  nodes: {
    user: 'User',
    projectA: 'Project',
    projectB: 'Project',
    shared: 'Milestone',
  },
  edges: [
    { from: 'user', to: 'projectA', type: 'OWNS' },
    { from: 'user', to: 'projectB', type: 'OWNS' },
    { from: 'projectA', to: 'shared', type: 'HAS_MILESTONE' },
    { from: 'projectB', to: 'shared', type: 'HAS_MILESTONE' },
  ],
}).execute()
```

### Count-Based Filtering

Filter by relationship counts:

```typescript
// Users with more than 10 posts
const prolificAuthors = await graph.node('User')
  .whereCount(q => q.to('AUTHORED'), 'gt', 10)
  .execute()
```

### Computed Projections

Return computed values:

```typescript
import { concat, coalesce } from '@astrale/typegraph'

const users = await graph.node('User')
  .return({
    displayName: coalesce('user.nickname', 'user.name'),
    fullName: concat('user.firstName', ' ', 'user.lastName'),
  })
  .execute()
```

### Array Unwinding

Process array fields:

```typescript
// Get unique tags across all posts
const tags = await graph.node('Post')
  .unwind('tags', 'tag')
  .return({ tag: 'tag' })
  .distinct()
  .execute()
```

## Deprecation Timeline

- **v0.2.x**: New APIs available, old APIs deprecated with warnings
- **v0.3.0**: Old APIs removed (breaking change)
- **v1.0.0**: Stable v2 API
```

**Acceptance Criteria:**
- [ ] Migration guide created
- [ ] All breaking changes documented
- [ ] Before/after code examples
- [ ] Deprecation timeline clear

---

### Task 10.3: Create API Documentation

**File:** `docs/api/`

Create comprehensive API documentation:

```markdown
# API Reference

## Query Methods

### whereExists(callback)

Filter results to those where a subquery returns at least one result.

**Signature:**
```typescript
whereExists<T>(
  buildSubquery: (q: SubqueryBuilder<S, N>) => SubqueryBuilder<S, T>
): CollectionBuilder<S, N>
```

**Parameters:**
- `buildSubquery`: Function receiving a SubqueryBuilder and returning a configured subquery

**Example:**
```typescript
// Find users who have authored at least one published post
const authors = await graph.node('User')
  .whereExists(q => q
    .to('AUTHORED', 'Post')
    .where('status', 'eq', 'published')
  )
  .execute()
```

**Generated Cypher:**
```cypher
MATCH (n0:User)
WHERE EXISTS {
  MATCH (n0)-[:AUTHORED]->(n1:Post)
  WHERE n1.status = $p0
}
RETURN n0
```

---

### whereCount(callback, operator, value)

Filter results based on subquery result count.

**Signature:**
```typescript
whereCount<T>(
  buildSubquery: (q: SubqueryBuilder<S, N>) => SubqueryBuilder<S, T>,
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte',
  value: number
): CollectionBuilder<S, N>
```

**Parameters:**
- `buildSubquery`: Function receiving a SubqueryBuilder
- `operator`: Comparison operator
- `value`: Number to compare against

**Example:**
```typescript
// Find users with more than 5 followers
const popular = await graph.node('User')
  .whereCount(q => q.from('FOLLOWS'), 'gt', 5)
  .execute()
```

---

### pattern(config)

Create a pattern matching query.

**Signature:**
```typescript
pattern<P extends PatternConfig<S>>(config: P): PatternBuilder<S, P>
```

**Parameters:**
- `config.nodes`: Object mapping alias to label or node config
- `config.edges`: Array of edge configurations

**Example:**
```typescript
// Find mutual followers (cycle pattern)
const mutualFollowers = await graph.pattern({
  nodes: {
    a: 'User',
    b: 'User',
  },
  edges: [
    { from: 'a', to: 'b', type: 'FOLLOWS' },
    { from: 'b', to: 'a', type: 'FOLLOWS' },
  ],
}).execute()
```

---

### unwind(field, as)

Unwind an array field into individual rows.

**Signature:**
```typescript
unwind(
  field: NodeFields<S, N>,
  as: string
): CollectionBuilder<S, N>
```

**Parameters:**
- `field`: Name of array field to unwind
- `as`: Alias for each unwound element

**Example:**
```typescript
const tags = await graph.node('Post')
  .unwind('tags', 'tag')
  .return({ tagName: 'tag' })
  .execute()
```
```

**Acceptance Criteria:**
- [ ] All new methods documented
- [ ] Signatures with types
- [ ] Examples for each method
- [ ] Generated Cypher shown where helpful

---

### Task 10.4: Create Examples Directory

**Directory:** `examples/`

```typescript
// examples/pattern-matching.ts

import { createGraph, defineSchema, string, number } from '@astrale/typegraph'

const schema = defineSchema({
  nodes: {
    User: { name: string(), email: string() },
    Project: { name: string(), budget: number() },
    Team: { name: string() },
    Milestone: { name: string(), dueDate: string() },
  },
  edges: {
    OWNS: { from: 'User', to: 'Project' },
    MEMBER_OF: { from: 'User', to: 'Team' },
    HAS_MILESTONE: { from: 'Project', to: 'Milestone' },
    ASSIGNED_TO: { from: 'Team', to: 'Milestone' },
  },
})

async function main() {
  const graph = await createGraph(schema, { ... })

  // Example 1: Diamond Pattern
  // Find milestones that a user can reach through both
  // their projects AND their team
  const crossFunctionalMilestones = await graph.pattern({
    nodes: {
      user: 'User',
      project: 'Project',
      team: 'Team',
      milestone: 'Milestone',
    },
    edges: [
      { from: 'user', to: 'project', type: 'OWNS' },
      { from: 'user', to: 'team', type: 'MEMBER_OF' },
      { from: 'project', to: 'milestone', type: 'HAS_MILESTONE' },
      { from: 'team', to: 'milestone', type: 'ASSIGNED_TO' },
    ],
  })
    .where('user', 'email', 'eq', 'alice@example.com')
    .return('milestone')
    .execute()

  console.log('Cross-functional milestones:', crossFunctionalMilestones)

  // Example 2: Cycle Pattern
  // Find mutual connections
  const mutualConnections = await graph.pattern({
    nodes: {
      a: { labels: ['User'], where: [{ type: 'comparison', field: 'id', operator: 'eq', value: 'user-1' }] },
      b: 'User',
    },
    edges: [
      { from: 'a', to: 'b', type: 'FOLLOWS' },
      { from: 'b', to: 'a', type: 'FOLLOWS' },
    ],
  }).execute()

  // Example 3: Optional Pattern Edges
  // Find projects with their milestones (if any)
  const projectsWithMilestones = await graph.pattern({
    nodes: {
      project: 'Project',
      milestone: 'Milestone',
    },
    edges: [
      { from: 'project', to: 'milestone', type: 'HAS_MILESTONE', optional: true },
    ],
  }).execute()
}
```

```typescript
// examples/subqueries.ts

async function subqueryExamples(graph) {
  // Example 1: Existence Check
  const usersWithPosts = await graph.node('User')
    .whereExists(q => q.to('AUTHORED', 'Post'))
    .execute()

  // Example 2: Non-Existence Check
  const usersWithoutPosts = await graph.node('User')
    .whereNotExists(q => q.to('AUTHORED', 'Post'))
    .execute()

  // Example 3: Count Comparison
  const prolificAuthors = await graph.node('User')
    .whereCount(q => q.to('AUTHORED', 'Post'), 'gte', 10)
    .execute()

  // Example 4: Complex Subquery Condition
  const usersWithPublishedPosts = await graph.node('User')
    .whereExists(q => q
      .to('AUTHORED', 'Post')
      .where('status', 'eq', 'published')
      .where('views', 'gt', 100)
    )
    .execute()

  // Example 5: Correlated Subquery with Export
  const usersWithPostCounts = await graph.node('User')
    .as('user')
    .subquery(q => q
      .to('AUTHORED', 'Post')
      .count()
      .as('postCount')
    )
    .return('user', 'postCount')
    .execute()
}
```

```typescript
// examples/computed-projections.ts

import { concat, coalesce, toUpper, caseWhen } from '@astrale/typegraph'

async function projectionExamples(graph) {
  // Example 1: String Concatenation
  const usersWithFullName = await graph.node('User')
    .return({
      user: 'user',
      fullName: concat('user.firstName', ' ', 'user.lastName'),
    })
    .execute()

  // Example 2: Coalesce (null handling)
  const usersWithDisplayName = await graph.node('User')
    .return({
      displayName: coalesce('user.nickname', 'user.name', 'Anonymous'),
    })
    .execute()

  // Example 3: CASE Expression
  const usersWithTier = await graph.node('User')
    .return({
      name: 'user.name',
      tier: caseWhen([
        { when: { field: 'points', operator: 'gte', value: 1000 }, then: 'Gold' },
        { when: { field: 'points', operator: 'gte', value: 500 }, then: 'Silver' },
      ], 'Bronze'),
    })
    .execute()

  // Example 4: Arithmetic
  const productsWithTotal = await graph.node('Product')
    .return({
      name: 'product.name',
      total: multiply('product.price', 'product.quantity'),
    })
    .execute()
}
```

**Acceptance Criteria:**
- [ ] Pattern matching examples
- [ ] Subquery examples
- [ ] Computed projection examples
- [ ] Comments explaining each example

---

### Task 10.5: Update CHANGELOG

**File:** `CHANGELOG.md`

```markdown
# Changelog

## [0.2.0] - 2025-XX-XX

### Added

- **Pattern Matching** (`PatternStep`): Declaratively match complex graph shapes
  including diamonds, cycles, and multi-point joins
- **Subquery Conditions** (`SubqueryCondition`): Unified existence and count checks
  - `whereExists()`: Filter where subquery has results
  - `whereNotExists()`: Filter where subquery has no results
  - `whereCount()`: Filter based on subquery result count
- **Correlated Subqueries** (`SubqueryStep`): Add subquery results to main query
- **Projection Expressions** (`ProjectionExpression`): Computed return values
  - Arithmetic operators: add, subtract, multiply, divide
  - String functions: concat, trim, toLower, toUpper
  - Null handling: coalesce, nullIf
  - CASE expressions
- **Return Step** (`ReturnStep`): Explicit projection as pipeline step
- **Unwind Step** (`UnwindStep`): Expand array fields into rows
- **Except Operator**: Set difference for branch queries
- **ConditionValue**: Distinguish literals from parameters for plan caching

### Changed

- `BranchStep.operator` now supports `'except'` in addition to `'union'` and `'intersect'`

### Deprecated

- `hasEdge()` / `hasNoEdge()`: Use `whereExists()` / `whereNotExists()` instead
- `whereConnectedTo()`: Use `whereExists()` with ID filter instead
- `ExistsCondition`: Replaced by `SubqueryCondition` with `mode: 'exists'`
- `ConnectedToCondition`: Replaced by `SubqueryCondition`
- `FirstStep`: Use `LimitStep` with `limit: 1`
- `CursorStep`: Desugared to Skip + Limit internally

### Removed

Nothing removed in this version. Deprecated features will be removed in v0.3.0.

## [0.1.x] - Previous Releases

...
```

**Acceptance Criteria:**
- [ ] All new features listed
- [ ] All changes documented
- [ ] All deprecations listed
- [ ] Migration references included

---

### Task 10.6: Add JSDoc to All New Types

**Purpose:** Ensure all new types have comprehensive JSDoc.

```typescript
/**
 * A declarative pattern matching step.
 *
 * Patterns allow expressing complex graph shapes that cannot be easily
 * represented with sequential traversals, such as:
 *
 * - **Diamond patterns**: A→B, A→C, B→D, C→D
 * - **Cycles**: A→B→C→A
 * - **Multi-point joins**: Multiple paths converging on a node
 *
 * @example
 * ```typescript
 * // Find diamond patterns in an organization
 * const pattern: PatternStep = {
 *   type: 'pattern',
 *   nodes: [
 *     { alias: 'manager', labels: ['Employee'] },
 *     { alias: 'project', labels: ['Project'] },
 *     { alias: 'team', labels: ['Team'] },
 *     { alias: 'milestone', labels: ['Milestone'] },
 *   ],
 *   edges: [
 *     { from: 'manager', to: 'project', types: ['MANAGES'], direction: 'out', optional: false },
 *     { from: 'manager', to: 'team', types: ['LEADS'], direction: 'out', optional: false },
 *     { from: 'project', to: 'milestone', types: ['HAS'], direction: 'out', optional: false },
 *     { from: 'team', to: 'milestone', types: ['ASSIGNED'], direction: 'out', optional: false },
 *   ],
 * }
 * ```
 *
 * @see {@link PatternNode} for node configuration
 * @see {@link PatternEdge} for edge configuration
 */
export interface PatternStep {
  type: 'pattern'
  nodes: PatternNode[]
  edges: PatternEdge[]
}
```

**Acceptance Criteria:**
- [ ] All new interfaces have JSDoc
- [ ] Examples in JSDoc
- [ ] Cross-references with @see

---

## Checklist

- [ ] Task 10.1: Update package READMEs
- [ ] Task 10.2: Create migration guide
- [ ] Task 10.3: Create API documentation
- [ ] Task 10.4: Create examples directory
- [ ] Task 10.5: Update CHANGELOG
- [ ] Task 10.6: Add JSDoc to all new types
- [ ] All documentation reviewed for accuracy
- [ ] All code examples tested

---

*Sub-spec version: 1.0*
