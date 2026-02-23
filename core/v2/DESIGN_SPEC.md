# TypeGraph Core v2 - Comprehensive Design Specification

## Executive Summary

This document provides the complete design specification for the TypeGraph Core v2 refactoring. It expands on the Graph Query AST Redesign Spec (README.md) with detailed implementation plans, file mappings, and decomposed tasks.

**Scope:** Refactor the graph query AST system to support declarative pattern matching, correlated subqueries, proper projection handling, and improved expressiveness while maintaining backward compatibility during migration.

**Key Files Affected:**
- `packages/core/src/ast/types.ts` (539 lines) - AST type definitions
- `packages/core/src/ast/builder.ts` (689 lines) - QueryAST builder class
- `packages/core/src/ast/visitor.ts` (141 lines) - Visitor pattern
- `packages/typegraph/src/compiler/cypher/compiler.ts` (1003 lines) - Cypher compilation

---

## Table of Contents

1. [Current Architecture Analysis](#1-current-architecture-analysis)
2. [Change Impact Assessment](#2-change-impact-assessment)
3. [Implementation Phases](#3-implementation-phases)
4. [Sub-Specifications](#4-sub-specifications)
5. [Migration Strategy](#5-migration-strategy)
6. [Testing Strategy](#6-testing-strategy)
7. [Error Handling Strategy](#7-error-handling-strategy)
8. [Risk Assessment](#8-risk-assessment)

---

## 1. Current Architecture Analysis

### 1.1 Package Structure

```
packages/
├── core/                          # @astrale/typegraph-core
│   └── src/
│       ├── ast/
│       │   ├── types.ts          # AST node type definitions
│       │   ├── builder.ts        # Immutable QueryAST builder
│       │   ├── visitor.ts        # Visitor pattern implementation
│       │   └── index.ts          # Module exports
│       ├── schema/
│       │   ├── types.ts          # Schema definition types
│       │   ├── builders.ts       # Schema builders (node, edge)
│       │   ├── inference.ts      # Type inference (892 lines)
│       │   ├── labels.ts         # Label resolution
│       │   └── serializer.ts     # Schema serialization
│       └── errors/               # Error types
│
└── typegraph/                     # @astrale/typegraph-client
    └── src/
        ├── query/                 # Query builders (17 files)
        │   ├── impl.ts           # GraphQueryImpl entry point
        │   ├── base.ts           # BaseBuilder abstract class
        │   ├── collection.ts     # CollectionBuilder (1245 lines)
        │   ├── single-node.ts    # SingleNodeBuilder
        │   ├── optional-node.ts  # OptionalNodeBuilder
        │   └── ...
        ├── compiler/
        │   ├── cypher/
        │   │   └── compiler.ts   # CypherCompiler (1003 lines)
        │   ├── optimizer.ts      # Query optimizer (stubs)
        │   └── cache.ts          # Compiler caching
        └── mutation/             # Mutation system
```

### 1.2 Current AST Node Types

```typescript
// Current ASTNode union (types.ts:499-516)
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
  | CursorStep      // TO BE REMOVED
  | FirstStep       // TO BE REMOVED
  | ReachableStep
  | ForkStep
```

### 1.3 Current WhereCondition Types

```typescript
// Current WhereCondition union (types.ts:101-106)
export type WhereCondition =
  | ComparisonCondition
  | LogicalCondition
  | ExistsCondition      // TO BE REPLACED by SubqueryCondition
  | ConnectedToCondition // TO BE REPLACED by SubqueryCondition
  | LabelCondition
```

### 1.4 Current Projection System

The current `Projection` type (types.ts:421-465) is a side field on `QueryAST`:
- Stored in `_projection` private field
- Modified via `setProjection*` methods
- Compiled separately in `compileProjection()`

**Problem:** Subqueries need their own projections, but the current design has projection as a global field.

---

## 2. Change Impact Assessment

### 2.1 Files Requiring Changes

| File | LOC | Change Type | Complexity |
|------|-----|-------------|------------|
| `core/src/ast/types.ts` | 539 | Additive + Removal | Medium |
| `core/src/ast/builder.ts` | 689 | Additive + Update | High |
| `core/src/ast/visitor.ts` | 141 | Additive + Removal | Low |
| `typegraph/src/compiler/cypher/compiler.ts` | 1003 | High | High |
| `typegraph/src/query/collection.ts` | 1245 | Update | Medium |
| `typegraph/src/query/single-node.ts` | ~800 | Update | Medium |
| `typegraph/src/query/optional-node.ts` | ~400 | Update | Medium |

### 2.2 Breaking Changes

| Change | Impact | Migration Path |
|--------|--------|----------------|
| Remove `FirstStep` | Low - internal only | Replace with `LimitStep` |
| Remove `CursorStep` | Medium - may be exposed | Desugar in query builders |
| Remove `ExistsCondition` | High - used in builders | Map to `SubqueryCondition` |
| Remove `ConnectedToCondition` | High - used in builders | Map to `SubqueryCondition` |
| Replace `Projection` with `ReturnStep` | High | Phased migration |

### 2.3 Dependency Graph

```
types.ts (definitions)
    ↓
builder.ts (constructs AST)
    ↓
visitor.ts (traverses AST)
    ↓
compiler.ts (compiles to Cypher)
    ↓
query/*.ts (fluent API)
```

Changes must flow top-down: types → builder → visitor → compiler → query builders.

---

## 3. Implementation Phases

### Phase 1: Additive Changes (Non-Breaking)

**Duration:** 2-3 days
**Goal:** Add all new types and methods without removing anything

#### 3.1.1 New Type Definitions (types.ts)

```typescript
// Add to types.ts

// =============================================================================
// NEW: PATTERN MATCHING
// =============================================================================

interface PatternNode {
  alias: string
  userAlias?: string
  labels?: string[]
  id?: string
  where?: WhereCondition[]
}

interface PatternEdge {
  alias?: string
  userAlias?: string
  types: string[]
  direction: 'out' | 'in' | 'both'
  from: string
  to: string
  variableLength?: VariableLengthConfig
  where?: EdgeWhereCondition[]
  optional: boolean
}

interface PatternStep {
  type: 'pattern'
  nodes: PatternNode[]
  edges: PatternEdge[]
}

// =============================================================================
// NEW: SUBQUERY SUPPORT (Discriminated Union)
// =============================================================================

// SubqueryCondition is a discriminated union by 'mode' field
// This ensures type safety - countPredicate is REQUIRED only for count mode

type SubqueryCondition =
  | SubqueryExistsCondition
  | SubqueryNotExistsCondition
  | SubqueryCountCondition

interface SubqueryConditionBase {
  type: 'subquery'
  query: ASTNode[]
  correlatedAliases: string[]
}

interface SubqueryExistsCondition extends SubqueryConditionBase {
  mode: 'exists'
}

interface SubqueryNotExistsCondition extends SubqueryConditionBase {
  mode: 'notExists'
}

interface SubqueryCountCondition extends SubqueryConditionBase {
  mode: 'count'
  countPredicate: { operator: ComparisonOperator; value: number } // REQUIRED
}

interface SubqueryStep {
  type: 'subquery'
  correlatedAliases: string[]
  steps: ASTNode[]
  exportedAliases: string[]
}

// =============================================================================
// NEW: PROJECTION AS STEP
// =============================================================================

interface ReturnStep {
  type: 'return'
  returns: ProjectionReturn[]
  existsOnly?: boolean
  countOnly?: boolean
}

type ProjectionReturn =
  | { kind: 'alias'; alias: string; fields?: string[] }
  | { kind: 'expression'; expression: ProjectionExpression; resultAlias: string }
  | { kind: 'collect'; sourceAlias: string; distinct?: boolean; resultAlias: string }
  | { kind: 'path'; pathAlias: string }

type ProjectionExpression =
  | { type: 'field'; alias: string; field: string }
  | { type: 'literal'; value: unknown }
  | { type: 'computed'; operator: ComputedOperator; operands: ProjectionExpression[] }
  | { type: 'case'; branches: Array<{ when: WhereCondition; then: ProjectionExpression }>; else?: ProjectionExpression }

type ComputedOperator =
  | 'add' | 'subtract' | 'multiply' | 'divide'
  | 'coalesce' | 'toString' | 'toInteger' | 'toFloat'
  | 'size' | 'trim' | 'toLower' | 'toUpper'
  | 'substring' | 'concat'

// =============================================================================
// NEW: UNWIND STEP
// =============================================================================

interface UnwindStep {
  type: 'unwind'
  sourceAlias: string
  field: string
  itemAlias: string
}

// =============================================================================
// NEW: CONDITION VALUE (for parameterization)
// =============================================================================

type ConditionValue =
  | { kind: 'literal'; value: unknown }
  | { kind: 'param'; name: string }
```

#### 3.1.2 Builder Methods (builder.ts)

Add new methods to `QueryAST` class:

```typescript
// Add to QueryAST class

addPattern(config: { nodes: PatternNode[], edges: PatternEdge[] }): QueryAST {
  const step: PatternStep = {
    type: 'pattern',
    nodes: config.nodes,
    edges: config.edges,
  }

  // Register all aliases
  const newAliases = new Map(this._aliases)
  for (const node of config.nodes) {
    newAliases.set(node.alias, {
      internalAlias: node.alias,
      userAlias: node.userAlias,
      type: 'node',
      label: node.labels?.[0] ?? '',
      sourceStep: this._steps.length,
    })
  }
  for (const edge of config.edges) {
    if (edge.alias) {
      newAliases.set(edge.alias, {
        internalAlias: edge.alias,
        userAlias: edge.userAlias,
        type: 'edge',
        label: edge.types[0] ?? '',
        sourceStep: this._steps.length,
      })
    }
  }

  // Set current to last node
  const lastNode = config.nodes[config.nodes.length - 1]

  return this.createNew(
    [...this._steps, step],
    this._projection,
    newAliases,
    new Map(this._userAliases),
    new Map(this._edgeUserAliases),
    this._aliasCounter,
    lastNode?.alias ?? this._currentNodeAlias,
    lastNode?.labels?.[0] ?? this._currentNodeLabel,
  )
}

addSubqueryStep(config: {
  correlatedAliases: string[]
  steps: ASTNode[]
  exportedAliases: string[]
}): QueryAST {
  const step: SubqueryStep = {
    type: 'subquery',
    correlatedAliases: config.correlatedAliases,
    steps: config.steps,
    exportedAliases: config.exportedAliases,
  }
  return this.createNew([...this._steps, step])
}

addUnwind(config: {
  sourceAlias: string
  field: string
  itemAlias: string
}): QueryAST {
  const step: UnwindStep = {
    type: 'unwind',
    sourceAlias: config.sourceAlias,
    field: config.field,
    itemAlias: config.itemAlias,
  }
  return this.createNew([...this._steps, step])
}

addReturn(config: {
  returns: ProjectionReturn[]
  countOnly?: boolean
  existsOnly?: boolean
}): QueryAST {
  const step: ReturnStep = {
    type: 'return',
    returns: config.returns,
    countOnly: config.countOnly,
    existsOnly: config.existsOnly,
  }
  return this.createNew([...this._steps, step])
}
```

#### 3.1.3 Visitor Updates (visitor.ts)

Add new visitor methods:

```typescript
// Add to ASTVisitorInterface
visitPattern?(node: PatternStep, context: TContext): TResult
visitMatchById?(node: MatchByIdStep, context: TContext): TResult
visitSubquery?(node: SubqueryStep, context: TContext): TResult
visitUnwind?(node: UnwindStep, context: TContext): TResult
visitReturn?(node: ReturnStep, context: TContext): TResult
visitFork?(node: ForkStep, context: TContext): TResult

// Add cases to visit() switch
case 'pattern':
  return this.visitPattern?.(node, context)
case 'matchById':
  return this.visitMatchById?.(node, context)
case 'subquery':
  return this.visitSubquery?.(node, context)
case 'unwind':
  return this.visitUnwind?.(node, context)
case 'return':
  return this.visitReturn?.(node, context)
case 'fork':
  return this.visitFork?.(node, context)
```

#### 3.1.4 Update BranchStep Operator

```typescript
// Update in types.ts
interface BranchStep {
  type: 'branch'
  operator: 'union' | 'intersect' | 'except'  // Add 'except'
  branches: ASTNode[][]
  distinct: boolean
}
```

### Phase 2: Compiler Support

**Duration:** 3-4 days
**Goal:** Update CypherCompiler to handle all new step types

#### 3.2.1 Pattern Step Compilation

```typescript
// Add to CypherCompiler

private compilePattern(step: PatternStep): void {
  // Build MATCH clause with all nodes and edges
  const matchParts: string[] = []

  // Create node patterns
  const nodePatterns = new Map<string, string>()
  for (const node of step.nodes) {
    const labelStr = node.labels?.length
      ? formatLabels(node.labels)
      : ''
    const idClause = node.id
      ? ` {id: ${this.addParam(node.id)}}`
      : ''
    nodePatterns.set(node.alias, `(${node.alias}${labelStr}${idClause})`)
  }

  // Build edge patterns
  for (const edge of step.edges) {
    const [leftArrow, rightArrow] = this.getArrow(edge.direction)
    const edgeTypes = edge.types.join('|')
    const edgeAlias = edge.alias ?? ''

    let lengthPattern = ''
    if (edge.variableLength) {
      const { min, max } = edge.variableLength
      lengthPattern = max !== undefined ? `*${min}..${max}` : `*${min}..`
    }

    const edgePattern = `[${edgeAlias}:${edgeTypes}${lengthPattern}]`
    const fromPattern = nodePatterns.get(edge.from) ?? `(${edge.from})`
    const toPattern = nodePatterns.get(edge.to) ?? `(${edge.to})`

    const matchKeyword = edge.optional ? 'OPTIONAL MATCH' : 'MATCH'
    matchParts.push(`${matchKeyword} ${fromPattern}${leftArrow}${edgePattern}${rightArrow}${toPattern}`)

    // Mark nodes as used
    nodePatterns.delete(edge.from)
    nodePatterns.delete(edge.to)
  }

  // Add standalone nodes
  for (const [alias, pattern] of nodePatterns) {
    matchParts.push(`MATCH ${pattern}`)
  }

  this.clauses.push(...matchParts)

  // Compile inline where conditions
  const whereConditions: string[] = []
  for (const node of step.nodes) {
    if (node.where?.length) {
      for (const cond of node.where) {
        whereConditions.push(this.compileCondition({
          ...cond,
          target: node.alias,
        }))
      }
    }
  }

  if (whereConditions.length > 0) {
    this.clauses.push(`WHERE ${whereConditions.join(' AND ')}`)
  }
}
```

#### 3.2.2 Subquery Compilation

```typescript
private compileSubqueryStep(step: SubqueryStep): void {
  // CALL { ... } syntax for Cypher subqueries
  const subCompiler = new CypherCompiler(this.schema, this.options)

  // Build sub-AST
  const subAst = new QueryAST()
  // ... construct from step.steps

  const subQuery = subCompiler.compile(subAst, this.schema)

  // Import correlated aliases
  const imports = step.correlatedAliases.join(', ')

  this.clauses.push(`CALL {`)
  this.clauses.push(`  WITH ${imports}`)
  this.clauses.push(`  ${subQuery.cypher.replace(/\n/g, '\n  ')}`)
  this.clauses.push(`}`)

  // Merge parameters
  Object.assign(this.params, subQuery.params)
}

private compileSubqueryCondition(condition: SubqueryCondition): string {
  // CRITICAL: Check for ConnectedTo optimization pattern FIRST
  // See Spec 05 Task 5.7 for full implementation
  const optimized = this.tryOptimizeConnectedToPattern(condition)
  if (optimized) return optimized

  const subCompiler = new CypherCompiler(this.schema, this.options)
  // Build and compile the subquery
  // Return EXISTS { ... } or COUNT { ... } syntax

  // Discriminated union - TypeScript narrows based on mode
  switch (condition.mode) {
    case 'exists':
      return `EXISTS { ${subQuery} }`
    case 'notExists':
      return `NOT EXISTS { ${subQuery} }`
    case 'count':
      // countPredicate is guaranteed to exist due to discriminated union
      const { operator, value } = condition.countPredicate
      const cypherOp = this.operatorToCypher(operator)
      return `COUNT { ${subQuery} } ${cypherOp} ${value}`
  }
}
```

#### 3.2.3 Return Step Compilation

```typescript
private compileReturnStep(step: ReturnStep): void {
  if (step.countOnly) {
    const alias = step.returns[0]?.kind === 'alias'
      ? (step.returns[0] as any).alias
      : 'n0'
    this.clauses.push(`RETURN count(${alias}) AS count`)
    return
  }

  if (step.existsOnly) {
    const alias = step.returns[0]?.kind === 'alias'
      ? (step.returns[0] as any).alias
      : 'n0'
    this.clauses.push(`RETURN count(${alias}) > 0 AS exists`)
    return
  }

  const returnExprs: string[] = []

  for (const ret of step.returns) {
    switch (ret.kind) {
      case 'alias':
        if (ret.fields?.length) {
          for (const field of ret.fields) {
            returnExprs.push(`${ret.alias}.${field}`)
          }
        } else {
          returnExprs.push(ret.alias)
        }
        break

      case 'expression':
        const expr = this.compileExpression(ret.expression)
        returnExprs.push(`${expr} AS ${ret.resultAlias}`)
        break

      case 'collect':
        const collectExpr = ret.distinct
          ? `collect(DISTINCT ${ret.sourceAlias})`
          : `collect(${ret.sourceAlias})`
        returnExprs.push(`${collectExpr} AS ${ret.resultAlias}`)
        break

      case 'path':
        returnExprs.push(ret.pathAlias)
        break
    }
  }

  const distinct = this.hasDistinct ? 'DISTINCT ' : ''
  this.clauses.push(`RETURN ${distinct}${returnExprs.join(', ')}`)
}

private compileExpression(expr: ProjectionExpression): string {
  switch (expr.type) {
    case 'field':
      return `${expr.alias}.${expr.field}`
    case 'literal':
      return this.addParam(expr.value)
    case 'computed':
      return this.compileComputedExpression(expr)
    case 'case':
      return this.compileCaseExpression(expr)
  }
}
```

### Phase 3: Removals

**Duration:** 1-2 days
**Goal:** Remove deprecated types and migrate usages

#### 3.3.1 Remove FirstStep

```typescript
// In types.ts: Remove FirstStep interface and from ASTNode union
// In builder.ts: Replace any FirstStep emission with LimitStep
// In visitor.ts: Remove visitFirst
// In compiler.ts: Remove case 'first'
```

#### 3.3.2 Remove CursorStep

```typescript
// In types.ts: Remove CursorStep interface and from ASTNode union
// In builder.ts: Remove addCursor method, desugar in query builders
// In visitor.ts: Remove visitCursor
// In compiler.ts: Remove compileCursor method
```

#### 3.3.3 Replace ExistsCondition and ConnectedToCondition

Create migration helpers:

```typescript
// In builder.ts - internal helper
private migrateExistsCondition(cond: ExistsCondition): SubqueryCondition {
  return {
    type: 'subquery',
    mode: cond.negated ? 'notExists' : 'exists',
    query: [{
      type: 'traversal',
      edges: [cond.edge],
      direction: cond.direction,
      fromAlias: cond.target,
      toAlias: `_sub_${this._aliasCounter}`,
      toLabels: [],
      optional: false,
      cardinality: 'many',
    }],
    correlatedAliases: [cond.target],
  }
}

private migrateConnectedToCondition(cond: ConnectedToCondition): SubqueryCondition {
  const subAlias = `_sub_${this._aliasCounter}`
  return {
    type: 'subquery',
    mode: 'exists',
    query: [
      {
        type: 'traversal',
        edges: [cond.edge],
        direction: cond.direction,
        fromAlias: cond.target,
        toAlias: subAlias,
        toLabels: [],
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
  }
}
```

### Phase 4: Projection Migration

**Duration:** 2-3 days
**Goal:** Migrate from `_projection` field to `ReturnStep`

#### 3.4.1 Dual Support Period

During migration, compiler checks for `ReturnStep` first, falls back to `_projection`:

```typescript
// In compiler.ts compile() method
compile(ast: QueryAST, schema?: SchemaDefinition, options?: CompilerOptions): CompiledQuery {
  // ... existing setup ...

  // Check if AST has a ReturnStep
  const returnStep = ast.steps.find(s => s.type === 'return') as ReturnStep | undefined

  if (returnStep) {
    // New path: compile ReturnStep
    this.compileReturnStep(returnStep)
  } else if (!this.hasBranchStep) {
    // Legacy path: compile _projection
    this.compileProjection(ast.projection, ast)
  }

  // ... rest of compilation ...
}
```

#### 3.4.2 Deprecate Old Methods

Mark as deprecated but keep working:

```typescript
/** @deprecated Use addReturn() instead */
setProjection(projection: Projection): QueryAST {
  console.warn('setProjection is deprecated, use addReturn instead')
  return this.createNew([...this._steps], projection)
}
```

---

## 4. Sub-Specifications

The implementation is decomposed into the following sub-specs for parallel work.

### Critical Cross-Cutting Concerns

These design decisions affect multiple specs and MUST be followed:

1. **SubqueryCondition Discriminated Union** (Spec 01, 02, 05)
   - SubqueryCondition is a discriminated union by `mode` field
   - `countPredicate` is REQUIRED when mode='count', forbidden otherwise
   - Ensures compile-time type safety

2. **ConnectedTo Optimization Preservation** (Spec 05, 08)
   - **CRITICAL PERFORMANCE**: The current `compileConnectedToAsMatch()` generates optimized MATCH patterns
   - When migrating to SubqueryCondition, the compiler MUST detect the pattern and preserve optimization
   - Pattern: exists mode + single traversal + WHERE id=eq generates MATCH with inline ID constraint
   - Without this, queries are 10-100x slower due to index usage vs full scans

3. **Type Definitions Reference Existing Types** (Spec 01)
   - `VariableLengthConfig` already exists in types.ts:124-138
   - `EdgeWhereCondition` for inline edge filtering
   - Verify actual definitions against spec claims before implementation

4. **Immutable Builder Pattern** (Spec 02)
   - All builder methods MUST return new QueryAST instances
   - Never mutate the current instance

### Sub-Spec 1: AST Type Definitions
**File:** `v2/specs/01-ast-types.md`
**Owner:** TBD
**Dependencies:** None

Tasks:
- [ ] Define `PatternNode` and `PatternEdge` interfaces
- [ ] Define `PatternStep` interface
- [ ] Define `SubqueryCondition` interface
- [ ] Define `SubqueryStep` interface
- [ ] Define `ReturnStep` and `ProjectionReturn` types
- [ ] Define `ProjectionExpression` recursive type
- [ ] Define `UnwindStep` interface
- [ ] Define `ConditionValue` type
- [ ] Add `'except'` to `BranchStep.operator`
- [ ] Update `ASTNode` union with new types
- [ ] Update `WhereCondition` union with `SubqueryCondition`
- [ ] Add exports to `index.ts`

### Sub-Spec 2: AST Builder Methods
**File:** `v2/specs/02-ast-builder.md`
**Owner:** TBD
**Dependencies:** Sub-Spec 1

Tasks:
- [ ] Implement `addPattern()` method
- [ ] Implement `addSubqueryStep()` method
- [ ] Implement `addUnwind()` method
- [ ] Implement `addReturn()` method
- [ ] Implement `addWhereExists()` convenience method
- [ ] Implement `addWhereNotExists()` convenience method
- [ ] Update alias registration for pattern nodes/edges
- [ ] Add unit tests for all new methods

### Sub-Spec 3: Visitor Pattern Updates
**File:** `v2/specs/03-visitor.md`
**Owner:** TBD
**Dependencies:** Sub-Spec 1

Tasks:
- [ ] Add `visitPattern` method
- [ ] Add `visitMatchById` method (missing)
- [ ] Add `visitSubquery` method
- [ ] Add `visitUnwind` method
- [ ] Add `visitReturn` method
- [ ] Add `visitFork` method (missing)
- [ ] Update `visit()` switch statement
- [ ] Add recursive visitor support for nested ASTs

### Sub-Spec 4: Cypher Compiler - Pattern Matching
**File:** `v2/specs/04-compiler-pattern.md`
**Owner:** TBD
**Dependencies:** Sub-Specs 1, 2

Tasks:
- [ ] Implement `compilePattern()` for PatternStep
- [ ] Handle multi-node patterns
- [ ] Handle variable-length edges in patterns
- [ ] Handle optional edges (LEFT JOIN semantics)
- [ ] Handle inline WHERE conditions on pattern nodes
- [ ] Add integration tests with Neo4j/Memgraph

### Sub-Spec 5: Cypher Compiler - Subqueries
**File:** `v2/specs/05-compiler-subquery.md`
**Owner:** TBD
**Dependencies:** Sub-Specs 1, 2

Tasks:
- [ ] Implement `compileSubqueryStep()` for SubqueryStep
- [ ] Implement `compileSubqueryCondition()` for WHERE clauses
- [ ] Handle `CALL { ... }` syntax for correlated subqueries
- [ ] Handle `EXISTS { ... }` syntax for existence checks
- [ ] Handle `COUNT { ... }` syntax for count comparisons
- [ ] Handle parameter passing to subqueries
- [ ] Add integration tests

### Sub-Spec 6: Cypher Compiler - Projection/Return
**File:** `v2/specs/06-compiler-return.md`
**Owner:** TBD
**Dependencies:** Sub-Specs 1, 2

Tasks:
- [ ] Implement `compileReturnStep()` for ReturnStep
- [ ] Implement `compileExpression()` for ProjectionExpression
- [ ] Handle computed expressions (arithmetic, string functions)
- [ ] Handle CASE expressions
- [ ] Handle collect aggregations
- [ ] Implement dual-support for legacy `_projection`
- [ ] Add integration tests

### Sub-Spec 7: Cypher Compiler - Unwind & Except
**File:** `v2/specs/07-compiler-misc.md`
**Owner:** TBD
**Dependencies:** Sub-Specs 1, 2

Tasks:
- [ ] Implement `compileUnwind()` for UnwindStep
- [ ] Implement `'except'` operator in `compileBranch()`
- [ ] Add integration tests

### Sub-Spec 8: Removals & Migration
**File:** `v2/specs/08-removals.md`
**Owner:** TBD
**Dependencies:** Sub-Specs 4, 5, 6, 7

Tasks:
- [ ] Remove `FirstStep` type and usages
- [ ] Remove `CursorStep` type and usages
- [ ] Implement cursor desugaring in query builders
- [ ] Remove `ExistsCondition` type
- [ ] Remove `ConnectedToCondition` type
- [ ] Create migration helpers for removed conditions
- [ ] Update query builders to use SubqueryCondition
- [ ] Remove deprecated visitor methods

### Sub-Spec 9: Query Builder Updates
**File:** `v2/specs/09-query-builders.md`
**Owner:** TBD
**Dependencies:** Sub-Specs 1-8

Tasks:
- [ ] Add `pattern()` method to CollectionBuilder
- [ ] Add `subquery()` method to CollectionBuilder
- [ ] Add `unwind()` method to CollectionBuilder
- [ ] Update `hasEdge()`/`hasNoEdge()` to use SubqueryCondition
- [ ] Update `whereConnectedTo()`/`whereConnectedFrom()` to use SubqueryCondition
- [ ] Add new return API methods
- [ ] Update TypeScript type inference for new features

### Sub-Spec 10: Documentation & Examples
**File:** `v2/specs/10-documentation.md`
**Owner:** TBD
**Dependencies:** All above

Tasks:
- [ ] Update API documentation
- [ ] Create migration guide
- [ ] Add code examples for PatternStep
- [ ] Add code examples for SubqueryCondition
- [ ] Add code examples for computed projections
- [ ] Update CHANGELOG

---

## 5. Migration Strategy

### 5.1 Backward Compatibility

During migration, both old and new APIs work:

```typescript
// Old way (still works)
graph.node('user').hasEdge('AUTHORED', 'out')

// New way (preferred)
graph.node('user').whereExists(q => q.to('AUTHORED'))
```

### 5.2 Deprecation Warnings

Add runtime warnings for deprecated features:

```typescript
hasEdge(edge: E, direction: 'out' | 'in' | 'both' = 'out') {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      'hasEdge() is deprecated, use whereExists() instead. ' +
      'See migration guide: https://...'
    )
  }
  // ... implementation using SubqueryCondition internally
}
```

### 5.3 Version Strategy

- **v0.2.x**: Add all new features, keep deprecated features working
- **v0.3.0**: Remove deprecated features, breaking changes allowed
- **v1.0.0**: Stable API with all v2 features

---

## 6. Testing Strategy

### 6.1 Unit Tests

Each sub-spec must include unit tests:

```typescript
// Example: test/ast/pattern-step.test.ts
describe('PatternStep', () => {
  it('creates a single-node pattern', () => {
    const ast = new QueryAST().addPattern({
      nodes: [{ alias: 'n0', labels: ['User'] }],
      edges: [],
    })
    expect(ast.steps).toHaveLength(1)
    expect(ast.steps[0].type).toBe('pattern')
  })

  it('creates a diamond pattern', () => {
    const ast = new QueryAST().addPattern({
      nodes: [
        { alias: 'a', labels: ['A'] },
        { alias: 'b', labels: ['B'] },
        { alias: 'c', labels: ['C'] },
        { alias: 'd', labels: ['D'] },
      ],
      edges: [
        { from: 'a', to: 'b', types: ['E1'], direction: 'out', optional: false },
        { from: 'a', to: 'c', types: ['E2'], direction: 'out', optional: false },
        { from: 'b', to: 'd', types: ['E3'], direction: 'out', optional: false },
        { from: 'c', to: 'd', types: ['E4'], direction: 'out', optional: false },
      ],
    })
    expect(ast.steps[0].type).toBe('pattern')
    expect((ast.steps[0] as PatternStep).nodes).toHaveLength(4)
    expect((ast.steps[0] as PatternStep).edges).toHaveLength(4)
  })
})
```

### 6.2 Integration Tests

Integration tests against real databases:

```typescript
// Example: test/integration/pattern.integration.test.ts
describe('Pattern Queries', () => {
  it('matches diamond pattern', async () => {
    const result = await graph.pattern({
      nodes: [...],
      edges: [...],
    }).execute()

    expect(result).toHaveLength(expectedCount)
  })
})
```

### 6.3 Type Tests

TypeScript type inference tests:

```typescript
// Example: test/types/pattern.test-d.ts
import { expectType } from 'tsd'

// Pattern return type should include all aliased nodes
const query = graph.pattern({...}).as('a').as('b')
expectType<CollectionBuilder<Schema, 'User', { a: 'User', b: 'Post' }>>(query)
```

---

## 7. Error Handling Strategy

### 7.1 Validation Errors

All validation happens at builder construction time, not at compile time:

```typescript
// Builder validates at construction
addSubqueryStep(config) {
  // Validate correlated aliases exist
  for (const alias of config.correlatedAliases) {
    if (!this._aliases.has(alias)) {
      throw new ASTValidationError(
        `Correlated alias '${alias}' does not exist in current query`,
        { alias, availableAliases: Array.from(this._aliases.keys()) }
      )
    }
  }
}

// Compiler validates at compile time for complex constraints
compilePattern(step: PatternStep) {
  // Validate no orphan edges (edges referencing non-existent nodes)
  const nodeAliases = new Set(step.nodes.map(n => n.alias))
  for (const edge of step.edges) {
    if (!nodeAliases.has(edge.from) || !nodeAliases.has(edge.to)) {
      throw new CompilationError(
        `Pattern edge references unknown node alias`,
        { edge, from: edge.from, to: edge.to, availableNodes: Array.from(nodeAliases) }
      )
    }
  }
}
```

### 7.2 Error Types

```typescript
// packages/core/src/errors/index.ts

/** Thrown when AST construction violates constraints */
export class ASTValidationError extends Error {
  constructor(message: string, public context: Record<string, unknown>) {
    super(message)
    this.name = 'ASTValidationError'
  }
}

/** Thrown when AST cannot be compiled to Cypher */
export class CompilationError extends Error {
  constructor(message: string, public context: Record<string, unknown>) {
    super(message)
    this.name = 'CompilationError'
  }
}

/** Thrown when deprecated features are used (in strict mode) */
export class DeprecationError extends Error {
  constructor(feature: string, replacement: string) {
    super(`${feature} is deprecated. Use ${replacement} instead.`)
    this.name = 'DeprecationError'
  }
}
```

### 7.3 Graceful Degradation

For backward compatibility, deprecated features issue warnings by default but can be configured to throw:

```typescript
const options: CompilerOptions = {
  deprecationMode: 'warn' | 'error' | 'silent',  // default: 'warn'
}
```

---

## 8. Risk Assessment

### 8.1 High Risk Items

| Risk | Impact | Mitigation |
|------|--------|------------|
| Compiler changes break existing queries | High | Extensive integration tests, phased rollout |
| Type inference breaks | Medium | Type tests, gradual migration |
| Performance regression in pattern matching | Medium | Benchmark tests, query plan analysis |

### 8.2 Rollback Plan

Each phase is independently deployable. If issues arise:

1. Revert to previous version
2. Keep new types but disable in compiler
3. Fix issues and re-deploy

### 8.3 Monitoring

- Track query compilation times
- Track query execution times
- Monitor for new error types
- A/B test with subset of users

---

## Appendix A: File Change Summary

| File | Additions | Modifications | Removals |
|------|-----------|---------------|----------|
| `types.ts` | ~150 lines | ~20 lines | ~50 lines |
| `builder.ts` | ~200 lines | ~50 lines | ~30 lines |
| `visitor.ts` | ~40 lines | ~20 lines | ~10 lines |
| `compiler.ts` | ~400 lines | ~100 lines | ~50 lines |
| `collection.ts` | ~100 lines | ~80 lines | ~20 lines |

**Total estimated changes:** ~1,200 lines added, ~270 lines modified, ~160 lines removed

---

## Appendix B: Timeline Estimate

| Phase | Duration | Parallelizable | Specs |
|-------|----------|----------------|-------|
| Phase 1: Additive Types | 2-3 days | Sub-specs 1-3 parallel | 01, 02, 03 |
| Phase 2: Compiler Support | 3-4 days | Sub-specs 4-7 partially parallel | 04, 05, 06, 07 |
| Phase 3: Query Builder Updates | 2-3 days | After Phase 2 | 09 |
| Phase 4: Removals & Migration | 1-2 days | After Phase 3 | 08 |
| Phase 5: Documentation | 1-2 days | After Phase 4 | 10 |
| Testing & Polish | 2-3 days | Throughout | - |

**IMPORTANT: Implementation Order**
- Spec 08 (Removals) depends on Spec 09 (Query Builders)
- Spec 09 must be completed BEFORE Spec 08
- Reason: Removals require new query builder APIs to be in place first

**Total: 10-15 days** with 2-3 developers working in parallel

---

---

## Appendix C: Key Design Refinements (v1.1)

This section documents critical refinements made after the initial v1.0 design:

1. **SubqueryCondition Discriminated Union** (Spec 01)
   - Changed from single interface with optional `countPredicate` to discriminated union by `mode`
   - Ensures compile-time type safety: `countPredicate` REQUIRED for count mode, forbidden otherwise

2. **ConnectedTo Optimization Preservation** (Spec 05, Task 5.7)
   - Added critical performance requirement to detect "connected to node by ID" patterns
   - Compiler must generate optimized MATCH patterns instead of EXISTS { } when pattern detected
   - Prevents 10-100x performance regression on ID-based connectivity queries

3. **EdgeWhereCondition Definition** (Spec 01)
   - Added explicit type definition for inline edge filtering in patterns
   - Lightweight alternative to full WhereCondition for edge properties

4. **Migration Helpers Type Safety** (Spec 08)
   - Updated `migrateExistsCondition` to return `SubqueryExistsCondition | SubqueryNotExistsCondition`
   - Updated `migrateConnectedToCondition` to return `SubqueryExistsCondition`
   - Uses TypeScript's `satisfies` for type checking

5. **Error Handling Strategy** (Section 7)
   - Added comprehensive error types: `ASTValidationError`, `CompilationError`, `DeprecationError`
   - Defined validation timing: builder time vs compile time
   - Added configurable deprecation mode

---

*Document Version: 1.1*
*Last Updated: 2026-02-05*
*Author: Claude (with exploration agents)*
*Reviewers: 5 parallel review agents (analysis, type safety, compilation, migration, documentation)*
