# Sub-Spec 09: Query Builder Updates

**Files:**
- `packages/typegraph/src/query/collection.ts`
- `packages/typegraph/src/query/single-node.ts`
- `packages/typegraph/src/query/optional-node.ts`
- `packages/typegraph/src/query/node-query-builder.ts`
- `packages/typegraph/src/query/impl.ts`
- `packages/typegraph/src/query/subquery-builder.ts` (**NEW**)
- `packages/typegraph/src/query/match-builder.ts` (**NEW**)
- `packages/typegraph/src/query/types.ts` (**NEW** - shared types)

**Dependencies:** Sub-Specs 01-08 (All AST and compiler changes)
**Estimated Duration:** 4-5 days

**CROSS-SPEC REQUIREMENTS (Must be added to other specs):**

1. **Spec 01 (AST Types)** - Add `AliasComparisonCondition` to `WhereCondition` union:
   ```typescript
   export interface AliasComparisonCondition {
     type: 'aliasComparison'
     leftAlias: string
     leftField: string
     operator: ComparisonOperator
     rightAlias: string
     rightField: string
   }
   ```

2. **Spec 05 (Compiler Subquery)** - Add handler in `compileCondition()`:
   ```typescript
   case 'aliasComparison':
     return `${condition.leftAlias}.${condition.leftField} ${opMap[condition.operator]} ${condition.rightAlias}.${condition.rightField}`
   ```

---

## Overview

This sub-spec covers updates to the fluent query builder API to expose new v2 features to users.

**IMPORTANT DESIGN DECISIONS:**

1. **API Naming**: Use `match()` for the pattern matching entry point (aligns with Cypher `MATCH` semantics). Internal AST uses `Pattern*` types.

2. **Return API**: Keep existing callback-based `.return()` for backward compatibility. Add new `.project()` method for config-based projections.

3. **Breaking Changes**: None. All new methods are additive. Existing methods (`hasEdge`, `whereConnectedTo`) will internally migrate to use SubqueryCondition but maintain same signatures.

4. **Deprecation Timeline**:
   - v0.3.0: Add new methods, internal migration, deprecation warnings on old condition types
   - v0.4.0: Remove ExistsCondition/ConnectedToCondition from public API
   - v1.0.0: Stable API

---

## Type Definitions (Task 9.0)

**Purpose:** Define all shared types used across query builders.

**Location:** `packages/typegraph/src/query/types.ts`

```typescript
// =============================================================================
// MATCH QUERY TYPES (Public API)
// =============================================================================

/**
 * Configuration for a match query.
 * Note: Internally converts to AST Pattern* types.
 */
export interface MatchConfig<S extends AnySchema> {
  /** Node aliases mapped to labels or full config */
  nodes: Record<string, NodeLabels<S> | MatchNodeConfig<S>>
  /** Edge connections between nodes */
  edges: MatchEdgeConfig[]
}

export interface MatchNodeConfig<S extends AnySchema> {
  /** Node labels (at least one required) */
  labels: NodeLabels<S>[]
  /** Optional: match by specific ID */
  id?: string
  /** Optional: inline WHERE conditions */
  where?: Array<{
    field: string
    operator: ComparisonOperator
    value: unknown
  }>
}

export interface MatchEdgeConfig {
  /** Source node alias */
  from: string
  /** Target node alias */
  to: string
  /** Edge type(s) */
  type: string | string[]
  /** Direction (default: 'out') */
  direction?: 'out' | 'in' | 'both'
  /** Optional edge (LEFT JOIN semantics) */
  optional?: boolean
  /** Edge alias for referencing in WHERE/RETURN */
  as?: string
  /** Variable-length path */
  variableLength?: { min?: number; max?: number }
}

/**
 * Extract node type from alias config.
 * For string labels, returns the label directly.
 * For MatchNodeConfig with multiple labels, returns union of all label types.
 */
type ExtractNodeType<S extends AnySchema, V> =
  V extends string
    ? V
    : V extends MatchNodeConfig<S>
      ? V['labels'][number]  // Union of all labels, not just [0]
      : never

/**
 * Result type for a match query.
 * Maps each node alias to its resolved type.
 *
 * IMPORTANT: When a node has multiple labels, the result type is a union.
 * Users should narrow with type guards if needed.
 */
export type MatchResult<S extends AnySchema, P extends MatchConfig<S>> = {
  [K in keyof P['nodes']]: NodeType<S, ExtractNodeType<S, P['nodes'][K]>>
}

// =============================================================================
// CONDITION VALUE TYPES (Required for query plan caching)
// =============================================================================

/**
 * Wrapper for condition values to distinguish literals from parameters.
 * This enables query plan caching - same query structure with different
 * parameter values can reuse the same compiled plan.
 *
 * NOTE: Must match ConditionValue in Spec 01 (AST Types).
 */
export type ConditionValue =
  | { kind: 'literal'; value: unknown }
  | { kind: 'param'; name: string }

/**
 * Helper to create a literal condition value.
 */
export function literal(value: unknown): ConditionValue {
  return { kind: 'literal', value }
}

/**
 * Helper to create a parameter condition value.
 */
export function param(name: string): ConditionValue {
  return { kind: 'param', name }
}

// =============================================================================
// ALIAS COMPARISON CONDITION (Cross-node field comparison)
// =============================================================================

/**
 * Condition comparing fields across two different pattern aliases.
 * Example: user.createdAt < project.startDate
 *
 * NOTE: Must be added to Spec 01 (AST Types) WhereCondition union.
 * NOTE: Must be handled in Spec 05 (Compiler) compileCondition().
 */
export interface AliasComparisonCondition {
  type: 'aliasComparison'
  leftAlias: string
  leftField: string
  operator: ComparisonOperator
  rightAlias: string
  rightField: string
}

// =============================================================================
// EXPORT METADATA TYPES
// =============================================================================

/**
 * Metadata describing what a subquery exports.
 *
 * - 'scalar': A single value (count, sum, max, min, avg results)
 * - 'node': A node reference (via .as() or .collect())
 * - 'array': An array of values (collect results)
 *
 * This enables proper type inference for subquery exports in return().
 */
export type ExportKind = 'scalar' | 'node' | 'array'

export interface ExportMetadata {
  alias: string
  kind: ExportKind
  /** For 'node' exports, the node label for type inference */
  nodeLabel?: string
}

// =============================================================================
// SUBQUERY BUILDER TYPES
// =============================================================================

/**
 * SubqueryBuilder with exported aliases.
 * Used when subquery results need to be available in the main query.
 */
export interface SubqueryBuilderWithExports<
  S extends AnySchema,
  N extends NodeLabels<S>,
  Exports extends Record<string, unknown>
> {
  toAST(): QueryAST
  getExportedAliases(): string[]
  getExportTypes(): Exports
}

/**
 * CollectionBuilder with additional exported aliases from subquery.
 */
export type CollectionBuilderWithExports<
  S extends AnySchema,
  N extends NodeLabels<S>,
  Exports extends Record<string, unknown>
> = CollectionBuilder<S, N> & {
  /** Access exported values in return/where */
  exported: Exports
}

// =============================================================================
// PROJECTION TYPES (for new project() API)
// =============================================================================

/**
 * Configuration for project() method.
 * Supports field selection, expressions, and aliases.
 */
export type ProjectConfig<S extends AnySchema, N extends NodeLabels<S>> = {
  [key: string]:
    | string                           // Alias reference: 'user'
    | string[]                         // Field selection: ['name', 'email']
    | ProjectionExpression             // Computed: { type: 'computed', ... }
    | { alias: string; fields: string[] }  // Explicit: { alias: 'user', fields: ['name'] }
}

/**
 * Result type inferred from projection config.
 */
export type ProjectResult<
  S extends AnySchema,
  N extends NodeLabels<S>,
  P extends ProjectConfig<S, N>
> = {
  [K in keyof P]: P[K] extends string
    ? NodeType<S, N>
    : P[K] extends string[]
      ? Pick<NodeType<S, N>, P[K][number]>
      : unknown
}
```

**Acceptance Criteria:**
- [ ] All types exported from types.ts
- [ ] Types compile without errors
- [ ] Generic constraints are correct

---

## Tasks

### Task 9.1: Add match() Method to GraphQuery

**Purpose:** Entry point for pattern matching queries.

```typescript
// Location: impl.ts (GraphQueryImpl)

/**
 * Start a pattern matching query.
 *
 * Match queries allow matching complex graph shapes like diamonds,
 * cycles, and multi-point joins declaratively.
 *
 * @example
 * // Diamond pattern: find all paths A→B, A→C, B→D, C→D
 * const results = await graph.match({
 *   nodes: {
 *     a: 'User',
 *     b: 'Project',
 *     c: 'Team',
 *     d: 'Milestone',
 *   },
 *   edges: [
 *     { from: 'a', to: 'b', type: 'OWNS' },
 *     { from: 'a', to: 'c', type: 'MEMBER_OF' },
 *     { from: 'b', to: 'd', type: 'HAS_MILESTONE' },
 *     { from: 'c', to: 'd', type: 'WORKS_ON' },
 *   ],
 * }).execute()
 */
match<P extends MatchConfig<S>>(config: P): MatchBuilder<S, P> {
  // Convert user-friendly config to AST PatternStep
  const patternNodes = Object.entries(config.nodes).map(([alias, labelOrConfig]) => {
    if (typeof labelOrConfig === 'string') {
      return { alias, labels: [labelOrConfig] }
    }
    return {
      alias,
      labels: labelOrConfig.labels,
      id: labelOrConfig.id,
      where: labelOrConfig.where,
    }
  })

  const patternEdges = config.edges.map(edge => ({
    from: edge.from,
    to: edge.to,
    types: Array.isArray(edge.type) ? edge.type : [edge.type],
    direction: edge.direction ?? 'out',
    optional: edge.optional ?? false,
    alias: edge.as,
    variableLength: edge.variableLength,
  }))

  // Internally convert to AST Pattern types
  const ast = new QueryAST().addPattern({
    nodes: patternNodes,
    edges: patternEdges,
  })

  return new MatchBuilder(ast, this._schema, this._executor, config)
}
```

**Type Definitions (Public API):**
```typescript
// User-facing types use "Match" naming
interface MatchConfig<S extends AnySchema> {
  nodes: Record<string, NodeLabels<S> | MatchNodeConfig>
  edges: MatchEdgeConfig[]
}

interface MatchNodeConfig {
  labels: string[]
  id?: string
  where?: WhereCondition[]
}

interface MatchEdgeConfig {
  from: string
  to: string
  type: string | string[]
  direction?: 'out' | 'in' | 'both'
  optional?: boolean
  as?: string
  variableLength?: { min?: number; max?: number }
}

// Note: Internal AST types remain as Pattern* (PatternStep, PatternNodeStep, etc.)
```

**Acceptance Criteria:**
- [ ] `match()` method on GraphQuery
- [ ] Type-safe node label inference
- [ ] MatchBuilder returned for chaining

---

### Task 9.2: Add whereExists() / whereNotExists() Methods

**Purpose:** Fluent API for subquery existence conditions.

```typescript
// Location: collection.ts (CollectionBuilder), with trait

/**
 * Filter to nodes where a subquery returns results.
 *
 * @example
 * // Users who have authored at least one post
 * graph.node('User')
 *   .whereExists(q => q.to('AUTHORED', 'Post'))
 *   .execute()
 */
whereExists<T extends NodeLabels<S>>(
  buildSubquery: (q: SubqueryBuilder<S, N>) => SubqueryBuilder<S, T>
): CollectionBuilder<S, N> {
  const subBuilder = buildSubquery(new SubqueryBuilder(this._schema, this.currentAlias))
  const subAst = subBuilder.toAST()

  const condition: SubqueryCondition = {
    type: 'subquery',
    mode: 'exists',
    query: subAst.steps,
    correlatedAliases: [this.currentAlias],
  }

  const newAst = this._ast.addWhere([condition])
  return new CollectionBuilder(newAst, this._schema, this._executor)
}

/**
 * Filter to nodes where a subquery returns NO results.
 *
 * @example
 * // Users who have never authored a post
 * graph.node('User')
 *   .whereNotExists(q => q.to('AUTHORED', 'Post'))
 *   .execute()
 */
whereNotExists<T extends NodeLabels<S>>(
  buildSubquery: (q: SubqueryBuilder<S, N>) => SubqueryBuilder<S, T>
): CollectionBuilder<S, N> {
  const subBuilder = buildSubquery(new SubqueryBuilder(this._schema, this.currentAlias))
  const subAst = subBuilder.toAST()

  const condition: SubqueryCondition = {
    type: 'subquery',
    mode: 'notExists',
    query: subAst.steps,
    correlatedAliases: [this.currentAlias],
  }

  const newAst = this._ast.addWhere([condition])
  return new CollectionBuilder(newAst, this._schema, this._executor)
}
```

**Acceptance Criteria:**
- [ ] whereExists() method with subquery builder callback
- [ ] whereNotExists() method
- [ ] Type inference for subquery node types
- [ ] Works in CollectionBuilder, SingleNodeBuilder, OptionalNodeBuilder

---

### Task 9.3: Add whereCount() Method

**Purpose:** Filter based on subquery count comparisons.

```typescript
/**
 * Filter to nodes where a subquery count matches a condition.
 *
 * @example
 * // Users with more than 5 posts
 * graph.node('User')
 *   .whereCount(q => q.to('AUTHORED', 'Post'), 'gt', 5)
 *   .execute()
 *
 * // Users with exactly 3 followers
 * graph.node('User')
 *   .whereCount(q => q.from('FOLLOWS', 'User'), 'eq', 3)
 *   .execute()
 */
whereCount<T extends NodeLabels<S>>(
  buildSubquery: (q: SubqueryBuilder<S, N>) => SubqueryBuilder<S, T>,
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte',
  value: number
): CollectionBuilder<S, N> {
  const subBuilder = buildSubquery(new SubqueryBuilder(this._schema, this.currentAlias))
  const subAst = subBuilder.toAST()

  const condition: SubqueryCondition = {
    type: 'subquery',
    mode: 'count',
    query: subAst.steps,
    countPredicate: { operator, value },
    correlatedAliases: [this.currentAlias],
  }

  const newAst = this._ast.addWhere([condition])
  return new CollectionBuilder(newAst, this._schema, this._executor)
}
```

**Acceptance Criteria:**
- [ ] whereCount() method with operator and value
- [ ] All comparison operators supported
- [ ] Type inference preserved

---

### Task 9.4: Add subquery() Method for Pipeline Subqueries

**Purpose:** Add correlated subquery results to the main query.

```typescript
/**
 * Execute a correlated subquery and export its results.
 *
 * @example
 * // Get users with their post counts
 * graph.node('User')
 *   .subquery(q => q
 *     .to('AUTHORED', 'Post')
 *     .count()
 *     .as('postCount')
 *   )
 *   .return('user', 'postCount')
 *   .execute()
 */
subquery<Exports extends Record<string, unknown>>(
  buildSubquery: (q: SubqueryBuilder<S, N>) => SubqueryBuilderWithExports<S, Exports>
): CollectionBuilderWithExports<S, N, Exports> {
  const subBuilder = buildSubquery(new SubqueryBuilder(this._schema, this.currentAlias))
  const subAst = subBuilder.toAST()
  const exportedAliases = subBuilder.getExportedAliases()

  const newAst = this._ast.addSubqueryStep({
    correlatedAliases: [this.currentAlias],
    steps: subAst.steps,
    exportedAliases,
  })

  return new CollectionBuilderWithExports(newAst, this._schema, this._executor, exportedAliases)
}
```

**Acceptance Criteria:**
- [ ] subquery() method with builder callback
- [ ] Exported aliases available in subsequent chain
- [ ] Type inference for exports

---

### Task 9.5: Add unwind() Method

**Purpose:** Unwind array fields.

```typescript
/**
 * Unwind an array field into individual rows.
 *
 * @example
 * // Get all tags from all posts
 * graph.node('Post')
 *   .unwind('tags', 'tag')
 *   .return('tag')
 *   .distinct()
 *   .execute()
 */
unwind(
  field: NodeFields<S, N> & string,
  as: string
): CollectionBuilder<S, N> {
  const newAst = this._ast.addUnwind({
    sourceAlias: this.currentAlias,
    field,
    itemAlias: as,
  })

  return new CollectionBuilder(newAst, this._schema, this._executor)
}
```

**Acceptance Criteria:**
- [ ] unwind() method with field and alias
- [ ] Type-safe field names
- [ ] Item alias available in subsequent chain

---

### Task 9.6: Update hasEdge() / hasNoEdge() to Use SubqueryCondition

**Purpose:** Internal migration to new condition type.

```typescript
// Location: collection.ts

// Current implementation using ExistsCondition
hasEdge<E extends EdgeLabels<S>>(
  edge: E,
  direction: 'out' | 'in' | 'both' = 'out'
): CollectionBuilder<S, N> {
  // OLD (remove):
  // const condition: ExistsCondition = { ... }

  // NEW:
  return this.whereExists(q => {
    if (direction === 'out') {
      return q.to(edge)
    } else if (direction === 'in') {
      return q.from(edge)
    } else {
      return q.related(edge)
    }
  })
}

hasNoEdge<E extends EdgeLabels<S>>(
  edge: E,
  direction: 'out' | 'in' | 'both' = 'out'
): CollectionBuilder<S, N> {
  return this.whereNotExists(q => {
    if (direction === 'out') {
      return q.to(edge)
    } else if (direction === 'in') {
      return q.from(edge)
    } else {
      return q.related(edge)
    }
  })
}
```

**Acceptance Criteria:**
- [ ] hasEdge() uses whereExists() internally
- [ ] hasNoEdge() uses whereNotExists() internally
- [ ] Public API unchanged
- [ ] All existing tests pass

---

### Task 9.7: Update whereConnectedTo() / whereConnectedFrom()

**Purpose:** Internal migration to SubqueryCondition.

```typescript
// Current implementation using ConnectedToCondition
whereConnectedTo<E extends EdgeLabels<S>>(
  nodeId: string,
  edge: E,
  direction: 'out' | 'in' = 'out'
): CollectionBuilder<S, N> {
  // NEW:
  return this.whereExists(q =>
    q.to(edge).where('id', 'eq', nodeId)
  )
}

whereConnectedFrom<E extends EdgeLabels<S>>(
  nodeId: string,
  edge: E
): CollectionBuilder<S, N> {
  return this.whereExists(q =>
    q.from(edge).where('id', 'eq', nodeId)
  )
}
```

**Acceptance Criteria:**
- [ ] whereConnectedTo() uses whereExists() internally
- [ ] whereConnectedFrom() uses whereExists() internally
- [ ] Public API unchanged
- [ ] All existing tests pass

---

### Task 9.8: Create SubqueryBuilder Class

**Purpose:** Builder for constructing subqueries in callbacks.

**Location:** `packages/typegraph/src/query/subquery-builder.ts` (new file)

```typescript
import { QueryAST, type ASTNode, type ComparisonCondition } from '@astrale/typegraph-core'
import type {
  AnySchema,
  NodeLabels,
  NodeFields,
  FieldType,
  OutgoingEdges,
  IncomingEdges,
  EdgeTarget,
  EdgeSource,
  ComparisonOperator,
} from './types'

/**
 * Builder for constructing subqueries.
 *
 * Used in whereExists, whereNotExists, whereCount, and subquery callbacks.
 *
 * @example
 * // In whereExists callback
 * graph.node('User').whereExists(q =>
 *   q.to('AUTHORED', 'Post')
 *    .where('status', 'eq', 'published')
 * )
 *
 * @example
 * // With aggregation export
 * graph.node('User').subquery(q =>
 *   q.to('AUTHORED')
 *    .count('postCount')
 * )
 */
export class SubqueryBuilder<S extends AnySchema, N extends NodeLabels<S>> {
  protected _ast: QueryAST
  protected _schema: S
  protected _currentAlias: string
  protected _correlatedAlias: string
  protected _exportedAliases: Map<string, ExportMetadata> = new Map()
  protected _aliasCounter: number = 0

  constructor(
    schema: S,
    correlatedAlias: string,
    ast?: QueryAST,
    currentAlias?: string
  ) {
    this._schema = schema
    this._correlatedAlias = correlatedAlias
    this._currentAlias = currentAlias ?? correlatedAlias
    this._ast = ast ?? new QueryAST()
  }

  // ===========================================================================
  // TRAVERSAL METHODS
  // ===========================================================================

  /**
   * Traverse outgoing edge.
   *
   * @example q.to('AUTHORED', 'Post')
   */
  to<E extends OutgoingEdges<S, N>, T extends EdgeTarget<S, E>>(
    edge: E,
    targetLabel?: T
  ): SubqueryBuilder<S, T> {
    const toAlias = this._generateAlias('to')
    const newAst = this._ast.addTraversal({
      fromAlias: this._currentAlias,
      edge: edge as string,
      direction: 'out',
      toAlias,
      toLabels: targetLabel ? [targetLabel as string] : [],
      optional: false,
      cardinality: 'many',
    })
    return this._derive<T>(newAst, toAlias)
  }

  /**
   * Traverse incoming edge.
   *
   * @example q.from('FOLLOWS', 'User')
   */
  from<E extends IncomingEdges<S, N>, T extends EdgeSource<S, E>>(
    edge: E,
    sourceLabel?: T
  ): SubqueryBuilder<S, T> {
    const fromAlias = this._generateAlias('from')
    const newAst = this._ast.addTraversal({
      fromAlias: this._currentAlias,
      edge: edge as string,
      direction: 'in',
      toAlias: fromAlias,
      toLabels: sourceLabel ? [sourceLabel as string] : [],
      optional: false,
      cardinality: 'many',
    })
    return this._derive<T>(newAst, fromAlias)
  }

  /**
   * Traverse edge in either direction (bidirectional).
   *
   * @example q.related('KNOWS')
   */
  related<E extends OutgoingEdges<S, N> | IncomingEdges<S, N>>(
    edge: E
  ): SubqueryBuilder<S, NodeLabels<S>> {
    const relAlias = this._generateAlias('rel')
    const newAst = this._ast.addTraversal({
      fromAlias: this._currentAlias,
      edge: edge as string,
      direction: 'both',
      toAlias: relAlias,
      toLabels: [],
      optional: false,
      cardinality: 'many',
    })
    return this._derive<NodeLabels<S>>(newAst, relAlias)
  }

  // ===========================================================================
  // FILTER METHODS
  // ===========================================================================

  /**
   * Add WHERE condition on current node.
   *
   * @example q.to('AUTHORED').where('status', 'eq', 'published')
   */
  where<F extends NodeFields<S, N>>(
    field: F,
    operator: ComparisonOperator,
    value: FieldType<S, N, F>
  ): SubqueryBuilder<S, N> {
    // Wrap value with ConditionValue for query plan caching
    const condition: ComparisonCondition = {
      type: 'comparison',
      field: field as string,
      operator,
      value: { kind: 'literal', value },  // Wrapped for plan caching
      target: this._currentAlias,
    }
    const newAst = this._ast.addWhere([condition])
    return this._derive<N>(newAst, this._currentAlias)
  }

  /**
   * Add multiple WHERE conditions (AND).
   *
   * @example q.whereAll([['status', 'eq', 'active'], ['age', 'gte', 18]])
   */
  whereAll(
    conditions: Array<[NodeFields<S, N>, ComparisonOperator, unknown]>
  ): SubqueryBuilder<S, N> {
    const compiledConditions = conditions.map(([field, op, value]) => ({
      type: 'comparison' as const,
      field: field as string,
      operator: op,
      value: { kind: 'literal' as const, value },  // Wrapped for plan caching
      target: this._currentAlias,
    }))
    const newAst = this._ast.addWhere(compiledConditions)
    return this._derive<N>(newAst, this._currentAlias)
  }

  // ===========================================================================
  // AGGREGATION METHODS
  // ===========================================================================

  /**
   * Count results and export as alias.
   *
   * @example q.to('AUTHORED').count('postCount')
   */
  count(alias: string = 'count'): SubqueryBuilder<S, N> {
    const newAst = this._ast.addAggregate({
      operation: 'count',
      field: '*',
      alias,
    })
    const builder = this._derive<N>(newAst, this._currentAlias)
    builder._exportedAliases.set(alias, { alias, kind: 'scalar' })
    return builder
  }

  /**
   * Sum a numeric field.
   *
   * @example q.to('TRANSACTIONS').sum('amount', 'totalAmount')
   */
  sum<F extends NodeFields<S, N>>(
    field: F,
    alias: string
  ): SubqueryBuilder<S, N> {
    const newAst = this._ast.addAggregate({
      operation: 'sum',
      field: field as string,
      alias,
      target: this._currentAlias,
    })
    const builder = this._derive<N>(newAst, this._currentAlias)
    builder._exportedAliases.set(alias, { alias, kind: 'scalar' })
    return builder
  }

  /**
   * Get maximum value of a field.
   *
   * @example q.to('SCORES').max('value', 'highScore')
   */
  max<F extends NodeFields<S, N>>(
    field: F,
    alias: string
  ): SubqueryBuilder<S, N> {
    const newAst = this._ast.addAggregate({
      operation: 'max',
      field: field as string,
      alias,
      target: this._currentAlias,
    })
    const builder = this._derive<N>(newAst, this._currentAlias)
    builder._exportedAliases.set(alias, { alias, kind: 'scalar' })
    return builder
  }

  /**
   * Get minimum value of a field.
   *
   * @example q.to('SCORES').min('value', 'lowScore')
   */
  min<F extends NodeFields<S, N>>(
    field: F,
    alias: string
  ): SubqueryBuilder<S, N> {
    const newAst = this._ast.addAggregate({
      operation: 'min',
      field: field as string,
      alias,
      target: this._currentAlias,
    })
    const builder = this._derive<N>(newAst, this._currentAlias)
    builder._exportedAliases.set(alias, { alias, kind: 'scalar' })
    return builder
  }

  /**
   * Calculate average of a field.
   *
   * @example q.to('REVIEWS').avg('rating', 'avgRating')
   */
  avg<F extends NodeFields<S, N>>(
    field: F,
    alias: string
  ): SubqueryBuilder<S, N> {
    const newAst = this._ast.addAggregate({
      operation: 'avg',
      field: field as string,
      alias,
      target: this._currentAlias,
    })
    const builder = this._derive<N>(newAst, this._currentAlias)
    builder._exportedAliases.set(alias, { alias, kind: 'scalar' })
    return builder
  }

  /**
   * Collect nodes into an array.
   *
   * @example q.to('TAGS').collect('allTags')
   */
  collect(alias: string, distinct: boolean = false): SubqueryBuilder<S, N> {
    const newAst = this._ast.addAggregate({
      operation: 'collect',
      field: this._currentAlias,
      alias,
      distinct,
    })
    const builder = this._derive<N>(newAst, this._currentAlias)
    builder._exportedAliases.set(alias, { alias, kind: 'array' })  // Array of nodes
    return builder
  }

  // ===========================================================================
  // EXPORT METHODS
  // ===========================================================================

  /**
   * Export the current node under an alias.
   *
   * @example q.to('AUTHORED', 'Post').as('latestPost')
   */
  as(alias: string): SubqueryBuilder<S, N> {
    // Register alias in AST
    const newAst = this._ast.addAlias({
      sourceAlias: this._currentAlias,
      targetAlias: alias,
    })
    const builder = this._derive<N>(newAst, this._currentAlias)
    builder._exportedAliases.set(alias, { alias, kind: 'node' })  // Single node reference
    return builder
  }

  // ===========================================================================
  // INTERNAL METHODS
  // ===========================================================================

  /**
   * Get the constructed AST.
   */
  toAST(): QueryAST {
    return this._ast
  }

  /**
   * Get all exported aliases and their types.
   */
  getExportedAliases(): string[] {
    return Array.from(this._exportedAliases.keys())
  }

  /**
   * Get export metadata for type inference.
   * Returns metadata about each exported alias including its kind (scalar/node/array).
   */
  getExportMetadata(): Map<string, ExportMetadata> {
    return this._exportedAliases
  }

  /**
   * Get the correlated (outer query) alias.
   */
  getCorrelatedAlias(): string {
    return this._correlatedAlias
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private _generateAlias(prefix: string): string {
    return `_${prefix}_${++this._aliasCounter}`
  }

  private _derive<T extends NodeLabels<S>>(
    newAst: QueryAST,
    newCurrentAlias: string
  ): SubqueryBuilder<S, T> {
    const builder = new SubqueryBuilder<S, T>(
      this._schema,
      this._correlatedAlias,
      newAst,
      newCurrentAlias
    )
    builder._aliasCounter = this._aliasCounter
    builder._exportedAliases = new Map(this._exportedAliases)
    return builder
  }
}
```

**Acceptance Criteria:**
- [ ] SubqueryBuilder class created in new file
- [ ] `to()` for outgoing traversal with type inference
- [ ] `from()` for incoming traversal with type inference
- [ ] `related()` for bidirectional traversal
- [ ] `where()` for single condition
- [ ] `whereAll()` for multiple conditions
- [ ] `count()`, `sum()`, `max()`, `min()`, `avg()` for aggregations
- [ ] `collect()` for array aggregation
- [ ] `as()` for exporting nodes
- [ ] `toAST()`, `getExportedAliases()` for internal use
- [ ] Proper generic type propagation

---

### Task 9.9: Add New Return API

**Purpose:** Fluent API for building return expressions.

```typescript
/**
 * Specify what to return from the query.
 *
 * @example
 * // Return specific fields
 * graph.node('User')
 *   .return({ user: ['name', 'email'] })
 *   .execute()
 *
 * // Return with computed expressions
 * graph.node('User')
 *   .return({
 *     name: 'user.name',
 *     fullName: concat('user.firstName', ' ', 'user.lastName'),
 *   })
 *   .execute()
 */
return<R extends ReturnConfig<S, N>>(config: R): TypedReturningBuilder<S, N, R> {
  const returns: ProjectionReturn[] = []

  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      // Simple alias
      returns.push({ kind: 'alias', alias: value, resultAlias: key })
    } else if (Array.isArray(value)) {
      // Alias with fields
      returns.push({ kind: 'alias', alias: key, fields: value })
    } else if (isExpression(value)) {
      // Computed expression
      returns.push({ kind: 'expression', expression: value, resultAlias: key })
    }
  }

  const newAst = this._ast.addReturn({ returns })
  return new TypedReturningBuilder(newAst, this._schema, this._executor)
}
```

**Acceptance Criteria:**
- [ ] return() method with flexible config
- [ ] Type inference for result shape
- [ ] Support for computed expressions

---

### Task 9.10: Add MatchBuilder Class

**Purpose:** Builder for match query chains with multi-node matching.

**Location:** `packages/typegraph/src/query/match-builder.ts` (new file)

```typescript
import { QueryAST, type PatternStep, type ComparisonCondition } from '@astrale/typegraph-core'
import type {
  AnySchema,
  NodeLabels,
  NodeFields,
  ComparisonOperator,
  MatchConfig,
  MatchResult,
  ExtractLastNode,
} from './types'
import type { QueryExecutor } from './executor'

/**
 * Builder for match queries.
 *
 * Match queries declaratively match complex graph shapes using
 * multiple nodes and edges defined upfront.
 *
 * @example
 * // Find diamond pattern: User owns Project and is member of Team,
 * // both Project and Team have same Milestone
 * const results = await graph.match({
 *   nodes: {
 *     user: 'User',
 *     project: 'Project',
 *     team: 'Team',
 *     milestone: 'Milestone',
 *   },
 *   edges: [
 *     { from: 'user', to: 'project', type: 'OWNS' },
 *     { from: 'user', to: 'team', type: 'MEMBER_OF' },
 *     { from: 'project', to: 'milestone', type: 'HAS_MILESTONE' },
 *     { from: 'team', to: 'milestone', type: 'WORKS_ON' },
 *   ],
 * })
 * .where('user', 'status', 'eq', 'active')
 * .execute()
 */
export class MatchBuilder<S extends AnySchema, P extends MatchConfig<S>> {
  protected _ast: QueryAST
  protected _schema: S
  protected _executor: QueryExecutor
  protected _config: P
  protected _nodeAliases: Set<string>

  constructor(
    ast: QueryAST,
    schema: S,
    executor: QueryExecutor,
    config: P
  ) {
    this._ast = ast
    this._schema = schema
    this._executor = executor
    this._config = config
    this._nodeAliases = new Set(Object.keys(config.nodes))
  }

  // ===========================================================================
  // WHERE METHODS
  // ===========================================================================

  /**
   * Add WHERE condition on a specific pattern node.
   *
   * @param alias - The node alias defined in the pattern
   * @param field - Field name on that node
   * @param operator - Comparison operator
   * @param value - Value to compare against
   *
   * @example
   * pattern.where('user', 'status', 'eq', 'active')
   *
   * TYPE SAFETY NOTE:
   * The `field` and `value` params are loosely typed (string/unknown) because
   * full type inference from alias→nodeLabel→fields requires complex conditional
   * types. Runtime validation catches invalid fields. Future improvement:
   *
   * ```typescript
   * type NodeLabelForAlias<P, A> = P['nodes'][A] extends string
   *   ? P['nodes'][A]
   *   : P['nodes'][A]['labels'][0]
   *
   * where<A extends keyof P['nodes'], F extends NodeFields<S, NodeLabelForAlias<P, A>>>(
   *   alias: A,
   *   field: F,
   *   operator: ComparisonOperator,
   *   value: FieldType<S, NodeLabelForAlias<P, A>, F>
   * )
   * ```
   */
  where<A extends keyof P['nodes'] & string>(
    alias: A,
    field: string,
    operator: ComparisonOperator,
    value: unknown
  ): MatchBuilder<S, P> {
    if (!this._nodeAliases.has(alias)) {
      throw new Error(`Unknown pattern alias: ${alias}. Available: ${[...this._nodeAliases].join(', ')}`)
    }

    const condition: ComparisonCondition = {
      type: 'comparison',
      field,
      operator,
      value: { kind: 'literal', value },  // Wrapped for query plan caching
      target: alias,
    }

    const newAst = this._ast.addWhere([condition])
    return new MatchBuilder(newAst, this._schema, this._executor, this._config)
  }

  /**
   * Add multiple WHERE conditions (AND).
   *
   * @example
   * pattern.whereAll([
   *   ['user', 'status', 'eq', 'active'],
   *   ['project', 'public', 'eq', true],
   * ])
   */
  whereAll(
    conditions: Array<[keyof P['nodes'] & string, string, ComparisonOperator, unknown]>
  ): MatchBuilder<S, P> {
    const compiledConditions = conditions.map(([alias, field, operator, value]) => {
      if (!this._nodeAliases.has(alias)) {
        throw new Error(`Unknown pattern alias: ${alias}`)
      }
      return {
        type: 'comparison' as const,
        field,
        operator,
        value: { kind: 'literal' as const, value },  // Wrapped for query plan caching
        target: alias,
      }
    })

    const newAst = this._ast.addWhere(compiledConditions)
    return new MatchBuilder(newAst, this._schema, this._executor, this._config)
  }

  /**
   * Add WHERE condition comparing two pattern aliases.
   *
   * @example
   * // Nodes where user.createdAt < project.startDate
   * pattern.whereCompare('user', 'createdAt', 'lt', 'project', 'startDate')
   */
  whereCompare<
    A1 extends keyof P['nodes'] & string,
    A2 extends keyof P['nodes'] & string
  >(
    alias1: A1,
    field1: string,
    operator: ComparisonOperator,
    alias2: A2,
    field2: string
  ): MatchBuilder<S, P> {
    if (!this._nodeAliases.has(alias1)) {
      throw new Error(`Unknown pattern alias: ${alias1}`)
    }
    if (!this._nodeAliases.has(alias2)) {
      throw new Error(`Unknown pattern alias: ${alias2}`)
    }

    const condition = {
      type: 'aliasComparison' as const,
      leftAlias: alias1,
      leftField: field1,
      operator,
      rightAlias: alias2,
      rightField: field2,
    }

    const newAst = this._ast.addWhere([condition])
    return new MatchBuilder(newAst, this._schema, this._executor, this._config)
  }

  // ===========================================================================
  // ORDERING & PAGINATION
  // ===========================================================================

  /**
   * Order results by a field on a specific alias.
   *
   * @example
   * pattern.orderBy('user', 'name', 'asc')
   */
  orderBy<A extends keyof P['nodes'] & string>(
    alias: A,
    field: string,
    direction: 'asc' | 'desc' = 'asc'
  ): MatchBuilder<S, P> {
    if (!this._nodeAliases.has(alias)) {
      throw new Error(`Unknown pattern alias: ${alias}`)
    }

    const newAst = this._ast.addOrderBy({
      alias,
      field,
      direction,
    })
    return new MatchBuilder(newAst, this._schema, this._executor, this._config)
  }

  /**
   * Skip first N results.
   */
  skip(count: number): MatchBuilder<S, P> {
    const newAst = this._ast.addSkip(count)
    return new MatchBuilder(newAst, this._schema, this._executor, this._config)
  }

  /**
   * Limit to N results.
   */
  limit(count: number): MatchBuilder<S, P> {
    const newAst = this._ast.addLimit(count)
    return new MatchBuilder(newAst, this._schema, this._executor, this._config)
  }

  // ===========================================================================
  // RETURN / PROJECTION
  // ===========================================================================

  /**
   * Specify which aliases to return (callback-based, existing API compatible).
   *
   * @example
   * pattern.return(({ user, project }) => ({
   *   userName: user.name,
   *   projectTitle: project.title,
   * }))
   */
  return<R>(
    selector: (aliases: MatchAliasMap<S, P>) => R
  ): MatchReturningBuilder<S, P, R> {
    // Create alias map for selector callback
    const aliasMap = {} as MatchAliasMap<S, P>
    for (const alias of this._nodeAliases) {
      aliasMap[alias as keyof P['nodes']] = createFieldSelector(alias)
    }

    const selection = selector(aliasMap)
    const returnConfig = convertSelectionToReturn(selection)
    const newAst = this._ast.addReturn(returnConfig)

    return new MatchReturningBuilder(newAst, this._schema, this._executor, this._config)
  }

  /**
   * Specify which aliases to return (config-based, new API).
   *
   * @example
   * pattern.project({
   *   user: ['name', 'email'],
   *   project: ['title'],
   * })
   */
  project<R extends MatchProjectConfig<P>>(
    config: R
  ): MatchReturningBuilder<S, P, MatchProjectResult<S, P, R>> {
    const returns: ProjectionReturn[] = []

    for (const [alias, fields] of Object.entries(config)) {
      if (!this._nodeAliases.has(alias)) {
        throw new Error(`Unknown pattern alias: ${alias}`)
      }

      if (fields === true) {
        // Return all fields
        returns.push({ kind: 'alias', alias })
      } else if (Array.isArray(fields)) {
        // Return specific fields
        returns.push({ kind: 'alias', alias, fields })
      }
    }

    const newAst = this._ast.addReturn({ returns })
    return new MatchReturningBuilder(newAst, this._schema, this._executor, this._config)
  }

  // ===========================================================================
  // EXECUTION
  // ===========================================================================

  /**
   * Execute and return all matched pattern aliases.
   *
   * @returns Array of objects with all pattern aliases
   */
  async execute(): Promise<PatternResult<S, P>[]> {
    // Default: return all aliases
    const returns = [...this._nodeAliases].map(alias => ({
      kind: 'alias' as const,
      alias,
    }))

    const finalAst = this._ast.addReturn({ returns })
    const cypher = finalAst.compile('cypher')
    return this._executor.execute<PatternResult<S, P>>(cypher)
  }

  /**
   * Execute and return first match or null.
   */
  async executeFirst(): Promise<PatternResult<S, P> | null> {
    const limitedAst = this._ast.addLimit(1)
    const returns = [...this._nodeAliases].map(alias => ({
      kind: 'alias' as const,
      alias,
    }))

    const finalAst = limitedAst.addReturn({ returns })
    const cypher = finalAst.compile('cypher')
    const results = await this._executor.execute<PatternResult<S, P>>(cypher)
    return results[0] ?? null
  }

  /**
   * Count matching patterns.
   */
  async count(): Promise<number> {
    const newAst = this._ast.addReturn({
      returns: [{ kind: 'expression', expression: { type: 'count', value: '*' }, resultAlias: 'count' }],
    })
    const cypher = newAst.compile('cypher')
    const results = await this._executor.execute<{ count: number }>(cypher)
    return results[0]?.count ?? 0
  }

  /**
   * Check if any patterns match.
   */
  async exists(): Promise<boolean> {
    const count = await this.limit(1).count()
    return count > 0
  }

  // ===========================================================================
  // DEBUG / INSPECTION
  // ===========================================================================

  /**
   * Get the compiled Cypher query string.
   */
  toCypher(): string {
    const returns = [...this._nodeAliases].map(alias => ({
      kind: 'alias' as const,
      alias,
    }))

    const finalAst = this._ast.addReturn({ returns })
    return finalAst.compile('cypher')
  }

  /**
   * Get the underlying AST.
   */
  toAST(): QueryAST {
    return this._ast
  }
}

// ===========================================================================
// PATTERN RETURNING BUILDER
// ===========================================================================

/**
 * Builder returned after .return() or .project() on MatchBuilder.
 * Allows ordering, pagination, and execution with typed results.
 */
export class MatchReturningBuilder<
  S extends AnySchema,
  P extends PatternConfig<S>,
  R
> {
  protected _ast: QueryAST
  protected _schema: S
  protected _executor: QueryExecutor
  protected _config: P

  constructor(
    ast: QueryAST,
    schema: S,
    executor: QueryExecutor,
    config: P
  ) {
    this._ast = ast
    this._schema = schema
    this._executor = executor
    this._config = config
  }

  orderBy(alias: keyof P['nodes'] & string, field: string, direction: 'asc' | 'desc' = 'asc'): MatchReturningBuilder<S, P, R> {
    const newAst = this._ast.addOrderBy({ alias, field, direction })
    return new MatchReturningBuilder(newAst, this._schema, this._executor, this._config)
  }

  skip(count: number): MatchReturningBuilder<S, P, R> {
    const newAst = this._ast.addSkip(count)
    return new MatchReturningBuilder(newAst, this._schema, this._executor, this._config)
  }

  limit(count: number): MatchReturningBuilder<S, P, R> {
    const newAst = this._ast.addLimit(count)
    return new MatchReturningBuilder(newAst, this._schema, this._executor, this._config)
  }

  distinct(): MatchReturningBuilder<S, P, R> {
    const newAst = this._ast.addDistinct()
    return new MatchReturningBuilder(newAst, this._schema, this._executor, this._config)
  }

  async execute(): Promise<R[]> {
    const cypher = this._ast.compile('cypher')
    return this._executor.execute<R>(cypher)
  }

  async executeFirst(): Promise<R | null> {
    const limited = this._ast.addLimit(1)
    const cypher = limited.compile('cypher')
    const results = await this._executor.execute<R>(cypher)
    return results[0] ?? null
  }

  toCypher(): string {
    return this._ast.compile('cypher')
  }
}

// ===========================================================================
// HELPER TYPES
// ===========================================================================

/**
 * Map of aliases to field selectors for return callback.
 */
type MatchAliasMap<S extends AnySchema, P extends PatternConfig<S>> = {
  [K in keyof P['nodes']]: FieldSelector<
    S,
    P['nodes'][K] extends string ? P['nodes'][K] : P['nodes'][K]['labels'][0]
  >
}

/**
 * Config for project() method on MatchBuilder.
 */
type MatchProjectConfig<P extends PatternConfig<any>> = {
  [K in keyof P['nodes']]?: true | string[]
}

/**
 * Result type for project() method.
 */
type MatchProjectResult<
  S extends AnySchema,
  P extends PatternConfig<S>,
  C extends MatchProjectConfig<P>
> = {
  [K in keyof C]: C[K] extends true
    ? NodeType<S, P['nodes'][K] extends string ? P['nodes'][K] : P['nodes'][K]['labels'][0]>
    : C[K] extends string[]
      ? Pick<NodeType<S, P['nodes'][K] extends string ? P['nodes'][K] : P['nodes'][K]['labels'][0]>, C[K][number]>
      : never
}
```

**Acceptance Criteria:**
- [ ] PatternBuilder class with full implementation
- [ ] `where()` targeting specific aliases with validation
- [ ] `whereAll()` for multiple conditions
- [ ] `whereCompare()` for cross-alias comparisons
- [ ] `orderBy()`, `skip()`, `limit()` for pagination
- [ ] `return()` callback-based (backward compatible)
- [ ] `project()` config-based (new API)
- [ ] `execute()`, `executeFirst()`, `count()`, `exists()`
- [ ] `toCypher()` for debugging
- [ ] MatchReturningBuilder for post-projection operations
- [ ] Type-safe pattern result inference

---

### Task 9.11: Complete Existing Stub Implementations

**Purpose:** Implement stub methods that exist but are not functional.

**Location:** Various query builder files

#### 9.11.1: CollectionBuilder Stubs

```typescript
// Location: collection.ts

/**
 * Paginate after a cursor (cursor-based pagination).
 *
 * @example
 * const page2 = await graph.node('User')
 *   .after(lastCursor)
 *   .limit(20)
 *   .execute()
 */
after(cursor: string): CollectionBuilder<S, N> {
  // Decode cursor to get position info
  const decoded = decodeCursor(cursor)
  const newAst = this._ast.addCursor({
    type: 'after',
    ...decoded,
  })
  return new CollectionBuilder(newAst, this._schema, this._executor)
}

/**
 * Paginate before a cursor (cursor-based pagination).
 *
 * @example
 * const previousPage = await graph.node('User')
 *   .before(firstCursor)
 *   .limit(20)
 *   .execute()
 */
before(cursor: string): CollectionBuilder<S, N> {
  const decoded = decodeCursor(cursor)
  const newAst = this._ast.addCursor({
    type: 'before',
    ...decoded,
  })
  return new CollectionBuilder(newAst, this._schema, this._executor)
}

/**
 * Execute with cursor info for pagination.
 *
 * @returns Results with cursor metadata for next/previous pages
 *
 * @example
 * const { nodes, pageInfo } = await graph.node('User')
 *   .orderBy('createdAt', 'desc')
 *   .limit(20)
 *   .executeWithCursor()
 *
 * if (pageInfo.hasNextPage) {
 *   const nextPage = await graph.node('User')
 *     .after(pageInfo.endCursor)
 *     .limit(20)
 *     .execute()
 * }
 */
async executeWithCursor(): Promise<CursorResult<NodeType<S, N>>> {
  // Add cursor computation to return
  const cursorFields = this._getCursorFields()
  const newAst = this._ast.addCursorComputation(cursorFields)

  const cypher = newAst.compile('cypher')
  const results = await this._executor.execute(cypher)

  return {
    nodes: results.map(r => r.node),
    pageInfo: {
      hasNextPage: results.length > 0 && results[results.length - 1]._hasMore,
      hasPreviousPage: this._ast.hasCursor('after') || this._ast.hasCursor('before'),
      startCursor: results.length > 0 ? encodeCursor(results[0]) : null,
      endCursor: results.length > 0 ? encodeCursor(results[results.length - 1]) : null,
    },
  }
}

/**
 * Stream results for large datasets.
 *
 * @returns AsyncIterable of nodes
 *
 * @example
 * for await (const user of graph.node('User').stream()) {
 *   console.log(user.name)
 * }
 */
async *stream(batchSize: number = 100): AsyncGenerator<NodeType<S, N>> {
  let cursor: string | null = null
  let hasMore = true

  while (hasMore) {
    const query = cursor
      ? this.after(cursor).limit(batchSize)
      : this.limit(batchSize)

    const { nodes, pageInfo } = await query.executeWithCursor()

    for (const node of nodes) {
      yield node
    }

    hasMore = pageInfo.hasNextPage
    cursor = pageInfo.endCursor
  }
}
```

**Cursor Types:**
```typescript
interface CursorResult<T> {
  nodes: T[]
  pageInfo: {
    hasNextPage: boolean
    hasPreviousPage: boolean
    startCursor: string | null
    endCursor: string | null
  }
}

interface DecodedCursor {
  /** Primary sort field value */
  sortValue: unknown
  /** Node ID for tiebreaker */
  id: string
  /** Sort field name */
  sortField: string
  /** Sort direction */
  sortDirection: 'asc' | 'desc'
}

function encodeCursor(row: Record<string, unknown>): string {
  const payload = {
    sortValue: row._sortValue,
    id: row.id,
    sortField: row._sortField,
    sortDirection: row._sortDirection,
  }
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decodeCursor(cursor: string): DecodedCursor {
  const json = Buffer.from(cursor, 'base64url').toString('utf-8')
  return JSON.parse(json)
}
```

#### 9.11.2: SingleNodeBuilder Stubs

```typescript
// Location: single-node.ts

/**
 * Traverse to any connected node via outgoing edge.
 *
 * @example
 * const related = await graph.nodeById('User', 'u1')
 *   .toAny()
 *   .execute()
 */
toAny(): CollectionBuilder<S, NodeLabels<S>> {
  const toAlias = this._generateAlias('any')
  const newAst = this._ast.addTraversal({
    fromAlias: this._currentAlias,
    edge: '*',  // Any edge type
    direction: 'out',
    toAlias,
    toLabels: [],
    optional: false,
    cardinality: 'many',
  })
  return new CollectionBuilder(newAst, this._schema, this._executor)
}

/**
 * Traverse from any connected node via incoming edge.
 */
fromAny(): CollectionBuilder<S, NodeLabels<S>> {
  const fromAlias = this._generateAlias('any')
  const newAst = this._ast.addTraversal({
    fromAlias: this._currentAlias,
    edge: '*',
    direction: 'in',
    toAlias: fromAlias,
    toLabels: [],
    optional: false,
    cardinality: 'many',
  })
  return new CollectionBuilder(newAst, this._schema, this._executor)
}

/**
 * Traverse via any edge in either direction.
 */
viaAny(): CollectionBuilder<S, NodeLabels<S>> {
  const viaAlias = this._generateAlias('any')
  const newAst = this._ast.addTraversal({
    fromAlias: this._currentAlias,
    edge: '*',
    direction: 'both',
    toAlias: viaAlias,
    toLabels: [],
    optional: false,
    cardinality: 'many',
  })
  return new CollectionBuilder(newAst, this._schema, this._executor)
}

/**
 * Variable-length path traversal.
 *
 * @example
 * // Find all nodes within 3 hops
 * const nearby = await graph.nodeById('User', 'u1')
 *   .to('FOLLOWS')
 *   .depth(1, 3)
 *   .execute()
 */
depth(min: number, max: number): SingleNodeBuilder<S, N> {
  // Modify the last traversal to use variable length
  const newAst = this._ast.modifyLastTraversal({
    variableLength: { min, max },
  })
  return new SingleNodeBuilder(newAst, this._schema, this._executor, this._currentAlias)
}
```

#### 9.11.3: OptionalNodeBuilder Stubs

```typescript
// Location: optional-node.ts

/**
 * Provide default value if node is null.
 *
 * @example
 * const profile = await graph.nodeById('User', 'u1')
 *   .toOptional('HAS_PROFILE', 'Profile')
 *   .orElse({ bio: 'No profile yet', avatar: null })
 *   .execute()
 */
orElse<D extends Partial<NodeType<S, N>>>(
  defaultValue: D
): SingleNodeBuilder<S, N> {
  // Add COALESCE wrapper to return
  const newAst = this._ast.addCoalesce({
    alias: this._currentAlias,
    defaultValue,
  })
  return new SingleNodeBuilder(newAst, this._schema, this._executor, this._currentAlias)
}
```

#### 9.11.4: NodeQueryBuilder select() Stub

```typescript
// Location: node-query-builder.ts

/**
 * Select specific fields from nodes (early projection).
 * Reduces data transfer for large nodes.
 *
 * NOTE: This requires CollectionBuilder to accept a narrowed node type.
 * The builder must be generic over the projected shape.
 *
 * @example
 * const names = await graph.node('User')
 *   .select('name', 'email')
 *   .execute()
 */
select<F extends NodeFields<S, N> & string>(
  ...fields: F[]
): ProjectedCollectionBuilder<S, N, F> {
  const newAst = this._ast.addEarlyProjection({
    alias: this._currentAlias,
    fields,  // Type-safe: F is constrained to NodeFields
  })
  // ProjectedCollectionBuilder handles narrowed type without unsafe casts
  return new ProjectedCollectionBuilder<S, N, F>(
    newAst,
    this._schema,
    this._executor,
    fields
  )
}

/**
 * Builder for projected results with narrowed field types.
 * Separate class to maintain type safety without `as any` casts.
 */
class ProjectedCollectionBuilder<
  S extends AnySchema,
  N extends NodeLabels<S>,
  F extends NodeFields<S, N> & string
> extends BaseBuilder<S, N> {
  private _projectedFields: F[]

  constructor(ast: QueryAST, schema: S, executor: QueryExecutor, fields: F[]) {
    super(ast, schema, executor)
    this._projectedFields = fields
  }

  async execute(): Promise<Array<Pick<NodeType<S, N>, F>>> {
    const cypher = this._ast.compile('cypher')
    return this._executor.execute(cypher)
  }
}
```

**Acceptance Criteria:**
- [ ] `after()` / `before()` for cursor pagination
- [ ] `executeWithCursor()` returns results with page info
- [ ] `stream()` returns async generator for large datasets
- [ ] `toAny()` / `fromAny()` / `viaAny()` for wildcard traversals
- [ ] `depth()` for variable-length paths
- [ ] `orElse()` for optional node defaults
- [ ] `select()` for early field projection
- [ ] Cursor encode/decode utilities
- [ ] All existing tests still pass

---

## Deprecated Code (To Remove)

### Types to Deprecate

```typescript
// packages/core/src/ast/types.ts - DEPRECATE IN v0.3.0, REMOVE IN v0.4.0

/**
 * @deprecated Use SubqueryCondition with mode: 'exists' instead.
 * Will be removed in v0.4.0.
 */
export interface ExistsCondition {
  type: 'exists'
  edge: string
  direction: 'out' | 'in' | 'both'
  targetLabels?: string[]
}

/**
 * @deprecated Use SubqueryCondition with mode: 'exists' and where clause instead.
 * Will be removed in v0.4.0.
 */
export interface ConnectedToCondition {
  type: 'connectedTo'
  nodeId: string
  edge: string
  direction: 'out' | 'in'
}
```

### Internal Condition Handling (Backward Compatibility Shim)

```typescript
// packages/typegraph/src/compiler/cypher/conditions.ts

/**
 * Handles deprecated condition types during migration period.
 *
 * @param condition - The condition to normalize
 * @param outerAlias - The alias from the outer query context (REQUIRED for correlation)
 * @internal
 */
function normalizeCondition(
  condition: AnyCondition,
  outerAlias: string
): SubqueryCondition | ComparisonCondition {
  // Handle deprecated ExistsCondition
  if (condition.type === 'exists') {
    console.warn(
      `ExistsCondition is deprecated and will be removed in v0.4.0. ` +
      `Use whereExists() instead.`
    )
    return {
      type: 'subquery',
      mode: 'exists',
      query: [{
        type: 'traversal',
        fromAlias: outerAlias,  // Correlate with outer query
        edge: condition.edge,
        direction: condition.direction,
        toLabels: condition.targetLabels ?? [],
      }],
      correlatedAliases: [outerAlias],  // CRITICAL: Must include outer alias
    }
  }

  // Handle deprecated ConnectedToCondition
  if (condition.type === 'connectedTo') {
    console.warn(
      `ConnectedToCondition is deprecated and will be removed in v0.4.0. ` +
      `Use whereExists(q => q.to(edge).where('id', 'eq', nodeId)) instead.`
    )
    return {
      type: 'subquery',
      mode: 'exists',
      query: [
        {
          type: 'traversal',
          fromAlias: outerAlias,  // Correlate with outer query
          edge: condition.edge,
          direction: condition.direction,
          toLabels: [],
        },
        {
          type: 'where',
          conditions: [{
            type: 'comparison',
            field: 'id',
            operator: 'eq',
            value: { kind: 'literal', value: condition.nodeId },  // Wrapped
          }],
        },
      ],
      correlatedAliases: [outerAlias],  // CRITICAL: Must include outer alias
    }
  }

  return condition
}
```

### Public API Methods to Deprecate (Internal Migration Only)

The following methods will **NOT** be deprecated in the public API, but their internal implementation changes:

| Method | Current Internal | New Internal | Public API Change |
|--------|------------------|--------------|-------------------|
| `hasEdge()` | Creates `ExistsCondition` | Calls `whereExists()` | None |
| `hasNoEdge()` | Creates `ExistsCondition` with negation | Calls `whereNotExists()` | None |
| `whereConnectedTo()` | Creates `ConnectedToCondition` | Calls `whereExists()` | None |
| `whereConnectedFrom()` | Creates `ConnectedToCondition` | Calls `whereExists()` | None |

### Removal Checklist

**v0.3.0:**
- [ ] Add deprecation warnings to `ExistsCondition` type
- [ ] Add deprecation warnings to `ConnectedToCondition` type
- [ ] Add `normalizeCondition()` shim
- [ ] Add console warnings when deprecated types used
- [ ] Update internal implementations to use new APIs

**v0.4.0:**
- [ ] Remove `ExistsCondition` from public exports
- [ ] Remove `ConnectedToCondition` from public exports
- [ ] Keep `normalizeCondition()` shim (internal only)

**v1.0.0:**
- [ ] Remove `normalizeCondition()` shim entirely
- [ ] Remove all deprecated condition handling code

---

## Migration Guidance

### Overview

This section provides guidance for migrating from v1 condition types to v2 SubqueryCondition.

### Deprecation Timeline

| Version | Changes |
|---------|---------|
| v0.3.0 | New methods added (`whereExists`, `whereNotExists`, `whereCount`, `subquery`, `match`, `unwind`). Internal migration of `hasEdge`/`whereConnectedTo` to use SubqueryCondition. Deprecation warnings on direct use of `ExistsCondition`/`ConnectedToCondition` types. |
| v0.4.0 | `ExistsCondition` and `ConnectedToCondition` types removed from public API. Old condition types still accepted internally but logged as warnings. |
| v1.0.0 | Stable API. All internal compatibility shims removed. |

### Migration Examples

#### hasEdge() (No Change Required)

The `hasEdge()` and `hasNoEdge()` methods continue to work unchanged. Internally they now use `whereExists()`:

```typescript
// This still works exactly the same:
graph.node('User').hasEdge('AUTHORED').execute()

// Internally becomes:
graph.node('User').whereExists(q => q.to('AUTHORED')).execute()
```

#### whereConnectedTo() (No Change Required)

The `whereConnectedTo()` method continues to work unchanged:

```typescript
// This still works:
graph.node('User').whereConnectedTo('project-123', 'WORKS_ON').execute()

// Internally becomes:
graph.node('User').whereExists(q =>
  q.to('WORKS_ON').where('id', 'eq', 'project-123')
).execute()
```

#### Direct Condition Types (Migration Required)

If you're manually constructing conditions, migrate to the new APIs:

```typescript
// OLD (v1) - Will show deprecation warning in v0.3.0, error in v0.4.0:
const condition: ExistsCondition = {
  type: 'exists',
  edge: 'AUTHORED',
  direction: 'out',
}
query.addCondition(condition)

// NEW (v2):
query.whereExists(q => q.to('AUTHORED'))

// ------------------------------------

// OLD (v1):
const condition: ConnectedToCondition = {
  type: 'connectedTo',
  nodeId: 'project-123',
  edge: 'WORKS_ON',
  direction: 'out',
}

// NEW (v2):
query.whereExists(q => q.to('WORKS_ON').where('id', 'eq', 'project-123'))
```

### New Capabilities

The new APIs provide capabilities not possible with v1:

```typescript
// Count-based filtering (NEW)
graph.node('User')
  .whereCount(q => q.to('AUTHORED', 'Post'), 'gte', 5)
  .execute()

// Subquery with aggregation exports (NEW)
graph.node('User')
  .subquery(q => q.to('AUTHORED').count('postCount'))
  .return(({ user, postCount }) => ({ user, postCount }))
  .execute()

// Multi-node matching (NEW)
graph.match({
  nodes: { a: 'User', b: 'Post', c: 'Comment' },
  edges: [
    { from: 'a', to: 'b', type: 'AUTHORED' },
    { from: 'a', to: 'c', type: 'WROTE' },
    { from: 'c', to: 'b', type: 'ON' },
  ],
}).execute()

// Array unwinding (NEW)
graph.node('Post')
  .unwind('tags', 'tag')
  .return({ tag: 'tag' })
  .distinct()
  .execute()
```

### Performance Notes

The compiler preserves optimizations when migrating:

- **Simple `hasEdge()`**: Compiles to efficient `MATCH` pattern (not EXISTS subquery)
- **`whereConnectedTo()` with ID**: Compiles to optimized `MATCH` with ID predicate
- **Complex subqueries**: Use EXISTS/COUNT syntax when pattern optimization not possible

See Sub-Spec 05 Task 5.7 for compiler optimization details.

---

## Testing

### Test Data Schema

```typescript
// All tests use this schema
const schema = defineSchema({
  nodes: {
    User: {
      id: 'string',
      name: 'string',
      email: 'string',
      age: 'number',
      status: 'string',
      createdAt: 'datetime',
      roles: 'string[]',
    },
    Post: {
      id: 'string',
      title: 'string',
      content: 'string',
      status: 'string',
      tags: 'string[]',
      views: 'number',
      publishedAt: 'datetime',
    },
    Comment: {
      id: 'string',
      body: 'string',
      createdAt: 'datetime',
    },
    Team: {
      id: 'string',
      name: 'string',
    },
    Project: {
      id: 'string',
      name: 'string',
      public: 'boolean',
    },
    Milestone: {
      id: 'string',
      name: 'string',
      dueDate: 'datetime',
    },
  },
  edges: {
    AUTHORED: { from: 'User', to: 'Post' },
    WROTE: { from: 'User', to: 'Comment' },
    ON: { from: 'Comment', to: 'Post' },
    FOLLOWS: { from: 'User', to: 'User' },
    MEMBER_OF: { from: 'User', to: 'Team' },
    OWNS: { from: 'User', to: 'Project' },
    HAS_MILESTONE: { from: 'Project', to: 'Milestone' },
    WORKS_ON: { from: 'Team', to: 'Milestone' },
    LIKES: { from: 'User', to: 'Post' },
    MENTIONS: { from: 'Post', to: 'User' },
  },
})
```

---

### Unit Tests: whereExists / whereNotExists

```typescript
describe('whereExists', () => {
  it('basic: filters nodes with outgoing edge', () => {
    const cypher = graph.node('User')
      .whereExists(q => q.to('AUTHORED'))
      .toCypher()

    expect(cypher).toContain('WHERE EXISTS {')
    expect(cypher).toContain('MATCH (user)-[:AUTHORED]->')
  })

  it('with target label: filters by specific target type', () => {
    const cypher = graph.node('User')
      .whereExists(q => q.to('AUTHORED', 'Post'))
      .toCypher()

    expect(cypher).toContain('-[:AUTHORED]->(:Post)')
  })

  it('incoming edge: filters nodes with incoming edge', () => {
    const cypher = graph.node('User')
      .whereExists(q => q.from('FOLLOWS', 'User'))
      .toCypher()

    expect(cypher).toContain('<-[:FOLLOWS]-')
  })

  it('chained traversal: multi-hop subquery', () => {
    const cypher = graph.node('User')
      .whereExists(q => q.to('AUTHORED', 'Post').to('ON', 'Comment'))
      .toCypher()

    expect(cypher).toContain('-[:AUTHORED]->(:Post)-[:ON]->(:Comment)')
  })

  it('with where in subquery: filters target nodes', () => {
    const cypher = graph.node('User')
      .whereExists(q => q
        .to('AUTHORED', 'Post')
        .where('status', 'eq', 'published')
      )
      .toCypher()

    expect(cypher).toContain('WHERE _to_1.status = ')
  })

  it('bidirectional: related() works in subquery', () => {
    const cypher = graph.node('User')
      .whereExists(q => q.related('FOLLOWS'))
      .toCypher()

    expect(cypher).toContain('-[:FOLLOWS]-')
    expect(cypher).not.toContain('->')
    expect(cypher).not.toContain('<-')
  })
})

describe('whereNotExists', () => {
  it('basic: filters nodes WITHOUT edge', () => {
    const cypher = graph.node('User')
      .whereNotExists(q => q.to('AUTHORED'))
      .toCypher()

    expect(cypher).toContain('WHERE NOT EXISTS {')
  })

  it('complex: no posts with published status', () => {
    const cypher = graph.node('User')
      .whereNotExists(q => q
        .to('AUTHORED', 'Post')
        .where('status', 'eq', 'published')
      )
      .toCypher()

    expect(cypher).toContain('NOT EXISTS {')
    expect(cypher).toContain('status = ')
  })
})
```

---

### Unit Tests: whereCount

```typescript
describe('whereCount', () => {
  it('greater than: count > N', () => {
    const cypher = graph.node('User')
      .whereCount(q => q.to('AUTHORED'), 'gt', 5)
      .toCypher()

    expect(cypher).toContain('WHERE COUNT {')
    expect(cypher).toContain('} > 5')
  })

  it('equals: count = N', () => {
    const cypher = graph.node('User')
      .whereCount(q => q.to('AUTHORED'), 'eq', 0)
      .toCypher()

    expect(cypher).toContain('} = 0')
  })

  it('less than or equal: count <= N', () => {
    const cypher = graph.node('User')
      .whereCount(q => q.from('FOLLOWS'), 'lte', 10)
      .toCypher()

    expect(cypher).toContain('} <= 10')
  })

  it('with filtered subquery: count of specific matches', () => {
    const cypher = graph.node('User')
      .whereCount(q => q
        .to('AUTHORED', 'Post')
        .where('status', 'eq', 'published'),
        'gte', 3
      )
      .toCypher()

    expect(cypher).toContain('status = ')
    expect(cypher).toContain('} >= 3')
  })

  it('edge case: not equals zero (has at least one)', () => {
    const cypher = graph.node('User')
      .whereCount(q => q.to('AUTHORED'), 'neq', 0)
      .toCypher()

    expect(cypher).toContain('} <> 0')
  })
})
```

---

### Unit Tests: subquery (Pipeline Subqueries)

```typescript
describe('subquery', () => {
  it('basic count export', () => {
    const cypher = graph.node('User')
      .subquery(q => q.to('AUTHORED').count('postCount'))
      .toCypher()

    expect(cypher).toContain('CALL {')
    expect(cypher).toContain('RETURN count(*) AS postCount')
  })

  it('sum aggregation', () => {
    const cypher = graph.node('User')
      .subquery(q => q.to('AUTHORED', 'Post').sum('views', 'totalViews'))
      .toCypher()

    expect(cypher).toContain('sum(_to_1.views) AS totalViews')
  })

  it('collect nodes', () => {
    const cypher = graph.node('User')
      .subquery(q => q.to('AUTHORED', 'Post').collect('posts'))
      .toCypher()

    expect(cypher).toContain('collect(_to_1) AS posts')
  })

  it('multiple exports', () => {
    const cypher = graph.node('User')
      .subquery(q => q
        .to('AUTHORED', 'Post')
        .count('postCount')
        .max('views', 'maxViews')
      )
      .toCypher()

    expect(cypher).toContain('count(*) AS postCount')
    expect(cypher).toContain('max(_to_1.views) AS maxViews')
  })

  it('exported aliases available in return', () => {
    const cypher = graph.node('User')
      .subquery(q => q.to('AUTHORED').count('postCount'))
      .return(({ user, postCount }) => ({ userName: user.name, postCount }))
      .toCypher()

    expect(cypher).toContain('RETURN user.name AS userName, postCount')
  })
})
```

---

### Unit Tests: match (Multi-Node Patterns)

```typescript
describe('match', () => {
  describe('basic patterns', () => {
    it('single edge pattern', () => {
      const cypher = graph.match({
        nodes: { u: 'User', p: 'Post' },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
      }).toCypher()

      expect(cypher).toContain('MATCH (u:User)-[:AUTHORED]->(p:Post)')
    })

    it('chain pattern: A → B → C', () => {
      const cypher = graph.match({
        nodes: { u: 'User', p: 'Post', c: 'Comment' },
        edges: [
          { from: 'u', to: 'p', type: 'AUTHORED' },
          { from: 'c', to: 'p', type: 'ON' },
        ],
      }).toCypher()

      expect(cypher).toContain('(u:User)')
      expect(cypher).toContain('(p:Post)')
      expect(cypher).toContain('(c:Comment)')
    })

    it('bidirectional edge', () => {
      const cypher = graph.match({
        nodes: { a: 'User', b: 'User' },
        edges: [{ from: 'a', to: 'b', type: 'FOLLOWS', direction: 'both' }],
      }).toCypher()

      expect(cypher).toContain('-[:FOLLOWS]-')
      expect(cypher).not.toContain('->')
    })
  })

  describe('diamond patterns', () => {
    it('finds diamond: A→B, A→C, B→D, C→D', () => {
      const cypher = graph.match({
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
          { from: 'team', to: 'milestone', type: 'WORKS_ON' },
        ],
      }).toCypher()

      expect(cypher).toContain('(user:User)')
      expect(cypher).toContain('(milestone:Milestone)')
      // Same milestone referenced from both paths
    })
  })

  describe('optional edges', () => {
    it('LEFT JOIN semantics with optional edge', () => {
      const cypher = graph.match({
        nodes: { u: 'User', p: 'Post' },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED', optional: true }],
      }).toCypher()

      expect(cypher).toContain('OPTIONAL MATCH')
    })
  })

  describe('variable-length paths', () => {
    it('path with min/max depth', () => {
      const cypher = graph.match({
        nodes: { a: 'User', b: 'User' },
        edges: [{ from: 'a', to: 'b', type: 'FOLLOWS', variableLength: { min: 1, max: 3 } }],
      }).toCypher()

      expect(cypher).toContain('[:FOLLOWS*1..3]')
    })

    it('unbounded path (min only)', () => {
      const cypher = graph.match({
        nodes: { a: 'User', b: 'User' },
        edges: [{ from: 'a', to: 'b', type: 'FOLLOWS', variableLength: { min: 2 } }],
      }).toCypher()

      expect(cypher).toContain('[:FOLLOWS*2..]')
    })
  })

  describe('multiple edge types', () => {
    it('OR of edge types', () => {
      const cypher = graph.match({
        nodes: { u: 'User', p: 'Post' },
        edges: [{ from: 'u', to: 'p', type: ['AUTHORED', 'LIKES'] }],
      }).toCypher()

      expect(cypher).toContain('[:AUTHORED|LIKES]')
    })
  })

  describe('inline conditions', () => {
    it('node with inline id', () => {
      const cypher = graph.match({
        nodes: {
          u: { labels: ['User'], id: 'user-123' },
          p: 'Post',
        },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
      }).toCypher()

      expect(cypher).toContain("u.id = 'user-123'")
    })

    it('node with inline where', () => {
      const cypher = graph.match({
        nodes: {
          u: {
            labels: ['User'],
            where: [{ field: 'status', operator: 'eq', value: 'active' }],
          },
          p: 'Post',
        },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
      }).toCypher()

      expect(cypher).toContain("u.status = 'active'")
    })
  })

  describe('where on match', () => {
    it('where on specific alias', () => {
      const cypher = graph.match({
        nodes: { u: 'User', p: 'Post' },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
      })
        .where('u', 'status', 'eq', 'active')
        .toCypher()

      expect(cypher).toContain("u.status = 'active'")
    })

    it('whereAll on multiple aliases', () => {
      const cypher = graph.match({
        nodes: { u: 'User', p: 'Post' },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
      })
        .whereAll([
          ['u', 'status', 'eq', 'active'],
          ['p', 'status', 'eq', 'published'],
        ])
        .toCypher()

      expect(cypher).toContain("u.status = 'active'")
      expect(cypher).toContain("p.status = 'published'")
    })

    it('whereCompare between aliases', () => {
      const cypher = graph.match({
        nodes: { u: 'User', p: 'Post' },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
      })
        .whereCompare('u', 'createdAt', 'lt', 'p', 'publishedAt')
        .toCypher()

      expect(cypher).toContain('u.createdAt < p.publishedAt')
    })

    it('throws on unknown alias', () => {
      expect(() => {
        graph.match({
          nodes: { u: 'User' },
          edges: [],
        }).where('x', 'status', 'eq', 'active')
      }).toThrow('Unknown pattern alias: x')
    })
  })

  describe('return / project', () => {
    it('return with callback selector', () => {
      const cypher = graph.match({
        nodes: { u: 'User', p: 'Post' },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
      })
        .return(({ u, p }) => ({
          author: u.name,
          title: p.title,
        }))
        .toCypher()

      expect(cypher).toContain('u.name AS author')
      expect(cypher).toContain('p.title AS title')
    })

    it('project with config', () => {
      const cypher = graph.match({
        nodes: { u: 'User', p: 'Post' },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
      })
        .project({
          u: ['name', 'email'],
          p: ['title'],
        })
        .toCypher()

      expect(cypher).toContain('u.name')
      expect(cypher).toContain('u.email')
      expect(cypher).toContain('p.title')
    })

    it('project with true returns whole node', () => {
      const cypher = graph.match({
        nodes: { u: 'User', p: 'Post' },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
      })
        .project({ u: true })
        .toCypher()

      expect(cypher).toContain('RETURN u')
    })
  })

  describe('ordering and pagination', () => {
    it('orderBy specific alias', () => {
      const cypher = graph.match({
        nodes: { u: 'User', p: 'Post' },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
      })
        .orderBy('p', 'publishedAt', 'desc')
        .toCypher()

      expect(cypher).toContain('ORDER BY p.publishedAt DESC')
    })

    it('skip and limit', () => {
      const cypher = graph.match({
        nodes: { u: 'User', p: 'Post' },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
      })
        .skip(10)
        .limit(20)
        .toCypher()

      expect(cypher).toContain('SKIP 10')
      expect(cypher).toContain('LIMIT 20')
    })
  })
})
```

---

### Unit Tests: unwind

```typescript
describe('unwind', () => {
  it('basic unwind of array field', () => {
    const cypher = graph.node('Post')
      .unwind('tags', 'tag')
      .toCypher()

    expect(cypher).toContain('UNWIND post.tags AS tag')
  })

  it('unwind with return', () => {
    const cypher = graph.node('Post')
      .unwind('tags', 'tag')
      .return(({ tag }) => ({ tag }))
      .toCypher()

    expect(cypher).toContain('RETURN tag')
  })

  it('unwind with distinct', () => {
    const cypher = graph.node('Post')
      .unwind('tags', 'tag')
      .return(({ tag }) => ({ tag }))
      .distinct()
      .toCypher()

    expect(cypher).toContain('RETURN DISTINCT tag')
  })
})
```

---

### Unit Tests: Combining Multiple Features

```typescript
describe('complex queries combining multiple features', () => {
  it('whereExists + whereCount + where', () => {
    const cypher = graph.node('User')
      .where('status', 'eq', 'active')
      .whereExists(q => q.to('MEMBER_OF', 'Team'))
      .whereCount(q => q.to('AUTHORED', 'Post'), 'gte', 5)
      .toCypher()

    expect(cypher).toContain("user.status = 'active'")
    expect(cypher).toContain('EXISTS {')
    expect(cypher).toContain('COUNT {')
    expect(cypher).toContain('} >= 5')
  })

  it('subquery + match + orderBy', () => {
    const cypher = graph.node('User')
      .subquery(q => q.to('AUTHORED').count('postCount'))
      .where('status', 'eq', 'active')
      .orderBy('postCount', 'desc')
      .limit(10)
      .toCypher()

    expect(cypher).toContain('CALL {')
    expect(cypher).toContain('ORDER BY postCount DESC')
    expect(cypher).toContain('LIMIT 10')
  })

  it('whereExists with nested traversal + aggregation check', () => {
    // Users who have authored posts with more than 100 views
    const cypher = graph.node('User')
      .whereExists(q => q
        .to('AUTHORED', 'Post')
        .where('views', 'gt', 100)
      )
      .toCypher()

    expect(cypher).toContain('EXISTS {')
    expect(cypher).toContain('views > 100')
  })

  it('match with whereExists subquery on alias', () => {
    // Diamond pattern where the user also likes the milestone
    const cypher = graph.match({
      nodes: {
        user: 'User',
        project: 'Project',
        milestone: 'Milestone',
      },
      edges: [
        { from: 'user', to: 'project', type: 'OWNS' },
        { from: 'project', to: 'milestone', type: 'HAS_MILESTONE' },
      ],
    })
      .where('user', 'status', 'eq', 'active')
      .toCypher()

    expect(cypher).toContain("user.status = 'active'")
    expect(cypher).toContain('(user:User)')
    expect(cypher).toContain('(project:Project)')
  })

  it('unwind + whereExists: posts with specific tags that have comments', () => {
    const cypher = graph.node('Post')
      .whereExists(q => q.from('ON', 'Comment'))
      .unwind('tags', 'tag')
      .where('tag', 'eq', 'typescript')
      .return(({ post, tag }) => ({ postId: post.id, tag }))
      .toCypher()

    expect(cypher).toContain('EXISTS {')
    expect(cypher).toContain('UNWIND')
    expect(cypher).toContain("tag = 'typescript'")
  })
})
```

---

### Unit Tests: Edge Cases and Error Handling

```typescript
describe('edge cases', () => {
  it('empty subquery should still be valid', () => {
    // Just checks edge exists, no further traversal
    const cypher = graph.node('User')
      .whereExists(q => q.to('AUTHORED'))
      .toCypher()

    expect(cypher).toContain('EXISTS {')
  })

  it('whereCount with zero value', () => {
    const cypher = graph.node('User')
      .whereCount(q => q.to('AUTHORED'), 'eq', 0)
      .toCypher()

    expect(cypher).toContain('} = 0')
  })

  it('whereCount neq 0 is equivalent to whereExists', () => {
    const cypher = graph.node('User')
      .whereCount(q => q.to('AUTHORED'), 'neq', 0)
      .toCypher()

    expect(cypher).toContain('} <> 0')
  })

  it('deeply nested subqueries', () => {
    // Users who follow users who have authored posts
    const cypher = graph.node('User')
      .whereExists(q => q
        .to('FOLLOWS', 'User')
        .where('status', 'eq', 'active')
      )
      .toCypher()

    expect(cypher).toContain('EXISTS {')
    expect(cypher).toContain("status = 'active'")
  })

  it('match with single node (no edges)', () => {
    const cypher = graph.match({
      nodes: { u: 'User' },
      edges: [],
    })
      .where('u', 'status', 'eq', 'active')
      .toCypher()

    expect(cypher).toContain('MATCH (u:User)')
    expect(cypher).toContain("u.status = 'active'")
  })

  it('match with self-referential edge', () => {
    const cypher = graph.match({
      nodes: { a: 'User', b: 'User' },
      edges: [{ from: 'a', to: 'b', type: 'FOLLOWS' }],
    }).toCypher()

    expect(cypher).toContain('(a:User)-[:FOLLOWS]->(b:User)')
  })

  it('whereAll with empty array is no-op', () => {
    const cypher = graph.node('User')
      .whereAll([])
      .toCypher()

    expect(cypher).not.toContain('WHERE')
  })

  it('multiple whereExists chains (AND semantics)', () => {
    const cypher = graph.node('User')
      .whereExists(q => q.to('AUTHORED'))
      .whereExists(q => q.to('MEMBER_OF'))
      .toCypher()

    expect(cypher).toMatch(/EXISTS.*AND.*EXISTS/s)
  })
})
```

---

### Integration Tests

```typescript
describe('Integration Tests', () => {
  beforeAll(async () => {
    // Setup comprehensive test data
    await graph.mutate.create('User', { id: 'u1', name: 'Alice', status: 'active', age: 30, roles: ['admin', 'user'] })
    await graph.mutate.create('User', { id: 'u2', name: 'Bob', status: 'active', age: 25, roles: ['user'] })
    await graph.mutate.create('User', { id: 'u3', name: 'Charlie', status: 'inactive', age: 35, roles: ['user'] })

    await graph.mutate.create('Post', { id: 'p1', title: 'Hello', status: 'published', tags: ['ts', 'js'], views: 100 })
    await graph.mutate.create('Post', { id: 'p2', title: 'World', status: 'draft', tags: ['ts'], views: 50 })
    await graph.mutate.create('Post', { id: 'p3', title: 'Test', status: 'published', tags: ['js', 'testing'], views: 200 })

    await graph.mutate.create('Comment', { id: 'c1', body: 'Great post!' })
    await graph.mutate.create('Comment', { id: 'c2', body: 'Nice!' })

    await graph.mutate.create('Team', { id: 't1', name: 'Engineering' })
    await graph.mutate.create('Project', { id: 'proj1', name: 'API', public: true })
    await graph.mutate.create('Milestone', { id: 'm1', name: 'v1.0' })

    // Edges
    await graph.mutate.link('AUTHORED', 'u1', 'p1')
    await graph.mutate.link('AUTHORED', 'u1', 'p2')
    await graph.mutate.link('AUTHORED', 'u2', 'p3')

    await graph.mutate.link('WROTE', 'u2', 'c1')
    await graph.mutate.link('ON', 'c1', 'p1')
    await graph.mutate.link('WROTE', 'u1', 'c2')
    await graph.mutate.link('ON', 'c2', 'p3')

    await graph.mutate.link('FOLLOWS', 'u1', 'u2')
    await graph.mutate.link('FOLLOWS', 'u2', 'u3')

    await graph.mutate.link('MEMBER_OF', 'u1', 't1')
    await graph.mutate.link('OWNS', 'u1', 'proj1')
    await graph.mutate.link('HAS_MILESTONE', 'proj1', 'm1')
    await graph.mutate.link('WORKS_ON', 't1', 'm1')
  })

  describe('whereExists', () => {
    it('filters to users with posts', async () => {
      const authors = await graph.node('User')
        .whereExists(q => q.to('AUTHORED'))
        .execute()

      expect(authors).toHaveLength(2)
      expect(authors.map(u => u.name).sort()).toEqual(['Alice', 'Bob'])
    })

    it('filters to users with published posts', async () => {
      const authors = await graph.node('User')
        .whereExists(q => q
          .to('AUTHORED', 'Post')
          .where('status', 'eq', 'published')
        )
        .execute()

      expect(authors).toHaveLength(2)
    })
  })

  describe('whereNotExists', () => {
    it('filters to users without posts', async () => {
      const nonAuthors = await graph.node('User')
        .whereNotExists(q => q.to('AUTHORED'))
        .execute()

      expect(nonAuthors).toHaveLength(1)
      expect(nonAuthors[0].name).toBe('Charlie')
    })
  })

  describe('whereCount', () => {
    it('filters users with more than 1 post', async () => {
      const prolificAuthors = await graph.node('User')
        .whereCount(q => q.to('AUTHORED'), 'gt', 1)
        .execute()

      expect(prolificAuthors).toHaveLength(1)
      expect(prolificAuthors[0].name).toBe('Alice')
    })

    it('filters users with exactly 1 post', async () => {
      const singlePostAuthors = await graph.node('User')
        .whereCount(q => q.to('AUTHORED'), 'eq', 1)
        .execute()

      expect(singlePostAuthors).toHaveLength(1)
      expect(singlePostAuthors[0].name).toBe('Bob')
    })
  })

  describe('subquery', () => {
    it('exports post count correctly', async () => {
      const results = await graph.node('User')
        .where('status', 'eq', 'active')
        .subquery(q => q.to('AUTHORED').count('postCount'))
        .return(({ user, postCount }) => ({
          name: user.name,
          postCount,
        }))
        .orderBy('postCount', 'desc')
        .execute()

      expect(results[0]).toEqual({ name: 'Alice', postCount: 2 })
      expect(results[1]).toEqual({ name: 'Bob', postCount: 1 })
    })

    it('exports total views correctly', async () => {
      const results = await graph.node('User')
        .subquery(q => q.to('AUTHORED', 'Post').sum('views', 'totalViews'))
        .return(({ user, totalViews }) => ({
          name: user.name,
          totalViews,
        }))
        .execute()

      const alice = results.find(r => r.name === 'Alice')
      expect(alice?.totalViews).toBe(150) // 100 + 50
    })
  })

  describe('match', () => {
    it('finds simple author-post pattern', async () => {
      const results = await graph.match({
        nodes: { u: 'User', p: 'Post' },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
      }).execute()

      expect(results).toHaveLength(3)
    })

    it('finds diamond pattern', async () => {
      const results = await graph.match({
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
          { from: 'team', to: 'milestone', type: 'WORKS_ON' },
        ],
      }).execute()

      expect(results).toHaveLength(1)
      expect(results[0].user.name).toBe('Alice')
      expect(results[0].milestone.name).toBe('v1.0')
    })

    it('uses where on specific alias', async () => {
      const results = await graph.match({
        nodes: { u: 'User', p: 'Post' },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
      })
        .where('p', 'status', 'eq', 'published')
        .execute()

      expect(results).toHaveLength(2)
    })

    it('returns projected fields', async () => {
      const results = await graph.match({
        nodes: { u: 'User', p: 'Post' },
        edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
      })
        .project({ u: ['name'], p: ['title'] })
        .execute()

      expect(results[0]).toHaveProperty('u')
      expect(results[0]).toHaveProperty('p')
      expect(results[0].u).toHaveProperty('name')
      expect(results[0].u).not.toHaveProperty('email')
    })
  })

  describe('unwind', () => {
    it('expands array fields', async () => {
      const tags = await graph.node('Post')
        .unwind('tags', 'tag')
        .return(({ tag }) => ({ tag }))
        .execute()

      expect(tags.length).toBeGreaterThan(3)
    })

    it('distinct tags', async () => {
      const tags = await graph.node('Post')
        .unwind('tags', 'tag')
        .return(({ tag }) => ({ tag }))
        .distinct()
        .execute()

      const uniqueTags = [...new Set(tags.map(t => t.tag))]
      expect(tags.length).toBe(uniqueTags.length)
    })
  })

  describe('complex combinations', () => {
    it('whereExists + subquery + orderBy', async () => {
      const results = await graph.node('User')
        .where('status', 'eq', 'active')
        .whereExists(q => q.to('AUTHORED'))
        .subquery(q => q.to('AUTHORED').count('postCount'))
        .return(({ user, postCount }) => ({
          name: user.name,
          postCount,
        }))
        .orderBy('postCount', 'desc')
        .execute()

      expect(results).toHaveLength(2)
      expect(results[0].name).toBe('Alice')
      expect(results[0].postCount).toBe(2)
    })

    it('match + whereCompare across aliases', async () => {
      // Find users who authored posts and also wrote comments on other posts
      const results = await graph.match({
        nodes: {
          author: 'User',
          post: 'Post',
          comment: 'Comment',
          otherPost: 'Post',
        },
        edges: [
          { from: 'author', to: 'post', type: 'AUTHORED' },
          { from: 'author', to: 'comment', type: 'WROTE' },
          { from: 'comment', to: 'otherPost', type: 'ON' },
        ],
      })
        .whereCompare('post', 'id', 'neq', 'otherPost', 'id')
        .execute()

      // Alice authored p1, p2 and wrote c2 on p3
      expect(results.length).toBeGreaterThan(0)
    })
  })
})
```

---

### Type Inference Tests (Compile-Time)

```typescript
describe('Type Inference', () => {
  // These tests verify TypeScript compile-time behavior
  // They should compile without errors

  it('whereExists preserves node type', () => {
    const query = graph.node('User')
      .whereExists(q => q.to('AUTHORED'))

    // TypeScript: query should be CollectionBuilder<Schema, 'User'>
    type Result = Awaited<ReturnType<typeof query.execute>>
    type Expected = Array<{ id: string; name: string; email: string; /* ... */ }>
    // If this compiles, types are correct
  })

  it('subquery exports are typed', () => {
    const query = graph.node('User')
      .subquery(q => q.to('AUTHORED').count('postCount'))

    // TypeScript: postCount should be available in return
    query.return(({ user, postCount }) => ({
      name: user.name, // valid
      count: postCount, // valid - exported from subquery
    }))
  })

  it('match result type includes all aliases', () => {
    const query = graph.match({
      nodes: { u: 'User', p: 'Post' },
      edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
    })

    type Result = Awaited<ReturnType<typeof query.execute>>
    // Result should be { u: UserType, p: PostType }[]
  })

  it('project narrows result type', () => {
    const query = graph.match({
      nodes: { u: 'User', p: 'Post' },
      edges: [{ from: 'u', to: 'p', type: 'AUTHORED' }],
    }).project({
      u: ['name'],
      p: ['title'],
    })

    type Result = Awaited<ReturnType<typeof query.execute>>
    // Result should be { u: { name: string }, p: { title: string } }[]
  })
})
```

---

## Checklist

### Core Tasks
- [ ] Task 9.0: Type definitions in types.ts
- [ ] Task 9.1: Add match() method to GraphQuery
- [ ] Task 9.2: Add whereExists() / whereNotExists()
- [ ] Task 9.3: Add whereCount()
- [ ] Task 9.4: Add subquery() for pipeline subqueries
- [ ] Task 9.5: Add unwind()
- [ ] Task 9.6: Update hasEdge() / hasNoEdge() (internal migration)
- [ ] Task 9.7: Update whereConnectedTo() / whereConnectedFrom() (internal migration)
- [ ] Task 9.8: Create SubqueryBuilder class
- [ ] Task 9.9: Add new return API
- [ ] Task 9.10: Add MatchBuilder class

### Stub Implementations (Task 9.11)
- [ ] CollectionBuilder: after(), before()
- [ ] CollectionBuilder: executeWithCursor()
- [ ] CollectionBuilder: stream()
- [ ] SingleNodeBuilder: toAny(), fromAny(), viaAny()
- [ ] SingleNodeBuilder: depth()
- [ ] OptionalNodeBuilder: orElse()
- [ ] NodeQueryBuilder: select()

### Testing
- [ ] Unit tests for all new methods
- [ ] Integration tests against real database
- [ ] Type inference tests (compile-time)
- [ ] Migration tests (v1 conditions still work)
- [ ] Performance benchmarks for optimization paths

### Documentation
- [ ] API documentation for all new methods
- [ ] Migration guide reviewed
- [ ] Examples in docstrings

---

*Sub-spec version: 2.0*
