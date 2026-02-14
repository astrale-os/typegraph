# Sub-Spec 01: AST Type Definitions

**File:** `packages/core/src/ast/types.ts`
**Dependencies:** None
**Estimated Duration:** 0.5-1 day

---

## Overview

This sub-spec covers all new type definitions required for the v2 AST. These are additive changes that won't break existing code.

---

## Tasks

### Task 1.1: Define ConditionValue Type

**Purpose:** Distinguish between literal values and query parameters for efficient query plan caching.

```typescript
// Location: types.ts, after existing type definitions

/**
 * Represents a value in a condition - either a literal or a named parameter.
 *
 * - `literal`: Value is inlined into the query (use for discriminating values)
 * - `param`: Value is passed as a parameter (use for user input, enables plan caching)
 *
 * @example
 * // Literal - value is part of the query string
 * { kind: 'literal', value: 'active' }
 *
 * // Parameter - value is passed separately
 * { kind: 'param', name: 'status' }
 */
export type ConditionValue =
  | { kind: 'literal'; value: unknown }
  | { kind: 'param'; name: string }
```

**Acceptance Criteria:**
- [ ] Type defined and exported
- [ ] JSDoc with examples
- [ ] Used consistently in ComparisonCondition (optional migration)

---

### Task 1.2: Define Pattern Matching Types

**Purpose:** Support declarative pattern matching for complex graph structures (cycles, diamonds, multi-point joins).

**Prerequisites:** This task requires the following existing types from the codebase:
- `VariableLengthConfig` (defined in types.ts:124-138) - `{ min: number; max?: number; uniqueness: 'nodes' | 'edges' | 'none' }`
- `WhereCondition` (defined in types.ts:101-106) - Union of all condition types

```typescript
// Location: types.ts, new section for pattern matching

// =============================================================================
// EDGE WHERE CONDITION (for inline edge filtering)
// =============================================================================

/**
 * A lightweight condition for filtering edges during pattern matching.
 * Similar to ComparisonCondition but without target (applied to current edge).
 *
 * NOTE: This type already exists in types.ts:111-115 as EdgeWhereCondition.
 * Verify it matches this definition or extend as needed.
 */
export interface EdgeWhereCondition {
  /** The edge property name */
  field: string
  /** The comparison operator */
  operator: ComparisonOperator
  /** The value to compare against */
  value?: unknown
}

// =============================================================================
// PATTERN MATCHING
// =============================================================================

/**
 * A node in a pattern match.
 */
export interface PatternNode {
  /** Internal alias for this node */
  alias: string
  /** User-facing alias (if different from internal) */
  userAlias?: string
  /** Node labels to match */
  labels?: string[]
  /** Match node by specific ID */
  id?: string
  /** Inline conditions on this node (uses standard WhereCondition) */
  where?: WhereCondition[]
}

/**
 * An edge in a pattern match.
 *
 * @see VariableLengthConfig - Existing type in types.ts:124-138
 * @see EdgeWhereCondition - Lightweight edge property filter
 */
export interface PatternEdge {
  /** Internal alias for this edge (optional) */
  alias?: string
  /** User-facing alias */
  userAlias?: string
  /** Edge types to match (can be multiple with OR semantics) */
  types: string[]
  /** Traversal direction */
  direction: 'out' | 'in' | 'both'
  /** Source node alias */
  from: string
  /** Target node alias */
  to: string
  /** Variable-length path configuration (uses existing VariableLengthConfig) */
  variableLength?: VariableLengthConfig
  /** Inline conditions on this edge (lightweight, no target needed) */
  where?: EdgeWhereCondition[]
  /** Whether this edge is optional (LEFT JOIN semantics) */
  optional: boolean
}

/**
 * A declarative pattern matching step.
 *
 * Unlike sequential traversals, patterns allow expressing complex graph
 * shapes like diamonds, cycles, and multi-point joins in a single step.
 *
 * @example
 * // Diamond pattern: A -> B, A -> C, B -> D, C -> D
 * {
 *   type: 'pattern',
 *   nodes: [
 *     { alias: 'a', labels: ['A'] },
 *     { alias: 'b', labels: ['B'] },
 *     { alias: 'c', labels: ['C'] },
 *     { alias: 'd', labels: ['D'] },
 *   ],
 *   edges: [
 *     { from: 'a', to: 'b', types: ['E1'], direction: 'out', optional: false },
 *     { from: 'a', to: 'c', types: ['E2'], direction: 'out', optional: false },
 *     { from: 'b', to: 'd', types: ['E3'], direction: 'out', optional: false },
 *     { from: 'c', to: 'd', types: ['E4'], direction: 'out', optional: false },
 *   ],
 * }
 */
export interface PatternStep {
  type: 'pattern'
  /** All nodes in the pattern */
  nodes: PatternNode[]
  /** All edges connecting the nodes */
  edges: PatternEdge[]
}
```

**Acceptance Criteria:**
- [ ] `PatternNode` interface defined with all fields
- [ ] `PatternEdge` interface defined with all fields
- [ ] `PatternStep` interface defined
- [ ] Comprehensive JSDoc with diamond pattern example
- [ ] All types exported

---

### Task 1.3: Define Subquery Types

**Purpose:** Support correlated subqueries for complex existence checks and count comparisons.

```typescript
// Location: types.ts, new section for subqueries

// =============================================================================
// SUBQUERY SUPPORT
// =============================================================================

/**
 * A subquery condition used in WHERE clauses.
 *
 * Replaces `ExistsCondition` and `ConnectedToCondition` with a unified,
 * more powerful construct.
 *
 * DESIGN NOTE: This is a discriminated union by `mode` field to ensure
 * type safety - countPredicate is REQUIRED when mode='count' and
 * FORBIDDEN when mode='exists'|'notExists'.
 *
 * @example
 * // Check existence: WHERE EXISTS { ... }
 * {
 *   type: 'subquery',
 *   mode: 'exists',
 *   query: [...],
 *   correlatedAliases: ['n0'],
 * }
 *
 * // Check non-existence: WHERE NOT EXISTS { ... }
 * {
 *   type: 'subquery',
 *   mode: 'notExists',
 *   query: [...],
 *   correlatedAliases: ['n0'],
 * }
 *
 * // Count comparison: WHERE COUNT { ... } > 5
 * {
 *   type: 'subquery',
 *   mode: 'count',
 *   query: [...],
 *   countPredicate: { operator: 'gt', value: 5 },
 *   correlatedAliases: ['n0'],
 * }
 */
export type SubqueryCondition =
  | SubqueryExistsCondition
  | SubqueryNotExistsCondition
  | SubqueryCountCondition

/** Base fields shared by all subquery condition modes */
interface SubqueryConditionBase {
  type: 'subquery'
  /** The subquery AST nodes */
  query: ASTNode[]
  /** Aliases from outer query that this subquery references */
  correlatedAliases: string[]
}

/** EXISTS subquery - checks if subquery returns any results */
export interface SubqueryExistsCondition extends SubqueryConditionBase {
  mode: 'exists'
}

/** NOT EXISTS subquery - checks if subquery returns no results */
export interface SubqueryNotExistsCondition extends SubqueryConditionBase {
  mode: 'notExists'
}

/** COUNT subquery - compares count of subquery results */
export interface SubqueryCountCondition extends SubqueryConditionBase {
  mode: 'count'
  /** REQUIRED for count mode: how to compare the count */
  countPredicate: {
    operator: ComparisonOperator
    value: number
  }
}

/**
 * A correlated subquery step in the main query pipeline.
 *
 * Used when subquery results need to be joined back to the main query
 * (e.g., for aggregations or additional filtering).
 *
 * Compiles to: CALL { WITH <correlated> ... RETURN <exported> }
 *
 * @example
 * // Get users with their post counts
 * {
 *   type: 'subquery',
 *   correlatedAliases: ['user'],
 *   steps: [
 *     { type: 'traversal', ... },
 *     { type: 'aggregate', ... },
 *   ],
 *   exportedAliases: ['postCount'],
 * }
 */
export interface SubqueryStep {
  type: 'subquery'
  /** Aliases from outer query imported into subquery */
  correlatedAliases: string[]
  /** AST steps of the subquery */
  steps: ASTNode[]
  /** Aliases exported from subquery to outer query */
  exportedAliases: string[]
}
```

**Acceptance Criteria:**
- [ ] `SubqueryCondition` interface defined with all modes
- [ ] `SubqueryStep` interface defined
- [ ] JSDoc with clear examples for each mode
- [ ] Proper typing for `countPredicate`

---

### Task 1.4: Define Projection Types

**Purpose:** Make projection a first-class pipeline step with support for computed expressions.

```typescript
// Location: types.ts, new section for projections

// =============================================================================
// PROJECTION AS PIPELINE STEP
// =============================================================================

/**
 * Operators for computed expressions in projections.
 */
export type ComputedOperator =
  // Arithmetic
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'modulo'
  // Type conversions
  | 'toString'
  | 'toInteger'
  | 'toFloat'
  | 'toBoolean'
  // String functions
  | 'trim'
  | 'toLower'
  | 'toUpper'
  | 'substring'
  | 'concat'
  | 'split'
  | 'replace'
  // Collection functions
  | 'size'
  | 'head'
  | 'tail'
  | 'last'
  | 'reverse'
  // Null handling
  | 'coalesce'
  | 'nullIf'

/**
 * An expression that can be computed in a projection.
 *
 * Recursive type supporting nested expressions.
 */
export type ProjectionExpression =
  | { type: 'field'; alias: string; field: string }
  | { type: 'literal'; value: unknown }
  | { type: 'param'; name: string }
  | {
      type: 'computed'
      operator: ComputedOperator
      operands: ProjectionExpression[]
    }
  | {
      type: 'case'
      branches: Array<{
        when: WhereCondition
        then: ProjectionExpression
      }>
      else?: ProjectionExpression
    }
  | {
      type: 'function'
      name: string
      args: ProjectionExpression[]
    }

/**
 * A single return item in a ReturnStep.
 */
export type ProjectionReturn =
  | {
      kind: 'alias'
      alias: string
      /** If specified, return only these fields from the node/edge */
      fields?: string[]
      /** Result alias (defaults to source alias) */
      resultAlias?: string
    }
  | {
      kind: 'expression'
      expression: ProjectionExpression
      resultAlias: string
    }
  | {
      kind: 'collect'
      sourceAlias: string
      distinct?: boolean
      resultAlias: string
    }
  | {
      kind: 'path'
      pathAlias: string
      resultAlias?: string
    }

/**
 * Explicit return/projection step in the query pipeline.
 *
 * Makes projection a first-class step, enabling subqueries to have
 * their own projections.
 *
 * @example
 * // Simple return
 * {
 *   type: 'return',
 *   returns: [{ kind: 'alias', alias: 'user' }],
 * }
 *
 * // Count only
 * {
 *   type: 'return',
 *   returns: [{ kind: 'alias', alias: 'user' }],
 *   countOnly: true,
 * }
 *
 * // Computed expression
 * {
 *   type: 'return',
 *   returns: [{
 *     kind: 'expression',
 *     expression: {
 *       type: 'computed',
 *       operator: 'concat',
 *       operands: [
 *         { type: 'field', alias: 'user', field: 'firstName' },
 *         { type: 'literal', value: ' ' },
 *         { type: 'field', alias: 'user', field: 'lastName' },
 *       ],
 *     },
 *     resultAlias: 'fullName',
 *   }],
 * }
 */
export interface ReturnStep {
  type: 'return'
  /** Items to return */
  returns: ProjectionReturn[]
  /** Return only count */
  countOnly?: boolean
  /** Return only exists (count > 0) */
  existsOnly?: boolean
}
```

**Acceptance Criteria:**
- [ ] `ComputedOperator` type with comprehensive operators
- [ ] `ProjectionExpression` recursive type
- [ ] `ProjectionReturn` discriminated union
- [ ] `ReturnStep` interface
- [ ] JSDoc examples for each variant

---

### Task 1.5: Define UnwindStep

**Purpose:** Support array unwinding for list field processing.

```typescript
// Location: types.ts

/**
 * Unwind an array field into individual rows.
 *
 * @example
 * // Unwind tags array
 * {
 *   type: 'unwind',
 *   sourceAlias: 'post',
 *   field: 'tags',
 *   itemAlias: 'tag',
 * }
 * // Compiles to: UNWIND post.tags AS tag
 */
export interface UnwindStep {
  type: 'unwind'
  /** Alias of the node containing the array */
  sourceAlias: string
  /** Field name of the array to unwind */
  field: string
  /** Alias for each unwound item */
  itemAlias: string
}
```

**Acceptance Criteria:**
- [ ] `UnwindStep` interface defined
- [ ] JSDoc with example

---

### Task 1.6: Update BranchStep Operator

**Purpose:** Add 'except' (set difference) operator to BranchStep.

```typescript
// Location: types.ts, modify existing BranchStep

export interface BranchStep {
  type: 'branch'
  /**
   * Set operation to apply:
   * - 'union': combine all results (UNION ALL or UNION based on distinct)
   * - 'intersect': results present in all branches
   * - 'except': results in first branch but not in others (set difference)
   */
  operator: 'union' | 'intersect' | 'except'
  branches: ASTNode[][]
  distinct: boolean
}
```

**Acceptance Criteria:**
- [ ] `'except'` added to operator type
- [ ] JSDoc updated to explain all operators

---

### Task 1.7: Update ASTNode Union

**Purpose:** Add all new step types to the ASTNode union.

```typescript
// Location: types.ts, update existing union

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
  // New in v2
  | PatternStep
  | SubqueryStep
  | UnwindStep
  | ReturnStep
  // Deprecated (keep for now, remove in Phase 3)
  | CursorStep
  | FirstStep
```

**Acceptance Criteria:**
- [ ] `PatternStep` added to union
- [ ] `SubqueryStep` added to union
- [ ] `UnwindStep` added to union
- [ ] `ReturnStep` added to union
- [ ] Comments marking deprecated types

---

### Task 1.8: Update WhereCondition Union

**Purpose:** Add SubqueryCondition to WhereCondition union.

```typescript
// Location: types.ts, update existing union

export type WhereCondition =
  | ComparisonCondition
  | LogicalCondition
  | LabelCondition
  // New in v2
  | SubqueryCondition
  // Deprecated (keep for now, remove in Phase 3)
  | ExistsCondition
  | ConnectedToCondition
```

**Acceptance Criteria:**
- [ ] `SubqueryCondition` added to union
- [ ] Comments marking deprecated types

---

### Task 1.9: Update Exports

**Purpose:** Export all new types from the module.

```typescript
// Location: ast/index.ts

// Add to existing exports
export type {
  // Existing exports...

  // New v2 types
  ConditionValue,
  EdgeWhereCondition,
  PatternNode,
  PatternEdge,
  PatternStep,
  // SubqueryCondition types (discriminated union)
  SubqueryCondition,
  SubqueryExistsCondition,
  SubqueryNotExistsCondition,
  SubqueryCountCondition,
  SubqueryStep,
  ComputedOperator,
  ProjectionExpression,
  ProjectionReturn,
  ReturnStep,
  UnwindStep,
} from './types'
```

**Acceptance Criteria:**
- [ ] All new types exported
- [ ] No circular dependency issues

---

## Testing

### Unit Tests

```typescript
// test/ast/types.test.ts

import type {
  PatternStep,
  SubqueryCondition,
  SubqueryCountCondition,
  ReturnStep,
  UnwindStep,
  ConditionValue,
} from '@astrale/typegraph-core'

describe('AST Types', () => {
  describe('PatternStep', () => {
    it('type guards work correctly', () => {
      const step: PatternStep = {
        type: 'pattern',
        nodes: [{ alias: 'n0', labels: ['User'] }],
        edges: [],
      }
      expect(step.type).toBe('pattern')
    })
  })

  describe('SubqueryCondition', () => {
    it('supports exists mode', () => {
      const cond: SubqueryCondition = {
        type: 'subquery',
        mode: 'exists',
        query: [],
        correlatedAliases: ['n0'],
      }
      expect(cond.mode).toBe('exists')
    })

    it('supports count mode with required predicate', () => {
      // Note: With discriminated union, countPredicate is REQUIRED for mode='count'
      const cond: SubqueryCountCondition = {
        type: 'subquery',
        mode: 'count',
        query: [],
        countPredicate: { operator: 'gt', value: 5 },
        correlatedAliases: ['n0'],
      }
      // No optional chaining needed - TypeScript knows countPredicate exists
      expect(cond.countPredicate.value).toBe(5)
    })

    it('type narrowing works on mode discriminant', () => {
      const cond: SubqueryCondition = {
        type: 'subquery',
        mode: 'count',
        query: [],
        countPredicate: { operator: 'gt', value: 5 },
        correlatedAliases: ['n0'],
      }

      // Discriminated union enables type narrowing
      if (cond.mode === 'count') {
        // TypeScript knows countPredicate is defined here
        expect(cond.countPredicate.operator).toBe('gt')
      }
    })
  })

  describe('ConditionValue', () => {
    it('distinguishes literals from params', () => {
      const literal: ConditionValue = { kind: 'literal', value: 'active' }
      const param: ConditionValue = { kind: 'param', name: 'status' }

      expect(literal.kind).toBe('literal')
      expect(param.kind).toBe('param')
    })
  })
})
```

### Type Tests

```typescript
// test/types/ast-types.test-d.ts
import { expectType, expectError } from 'tsd'
import type { PatternStep, BranchStep } from '@astrale/typegraph-core'

// Pattern step should require nodes and edges arrays
expectType<PatternStep>({
  type: 'pattern',
  nodes: [],
  edges: [],
})

// BranchStep should accept 'except'
expectType<BranchStep>({
  type: 'branch',
  operator: 'except',
  branches: [],
  distinct: true,
})

// BranchStep should reject invalid operators
expectError<BranchStep>({
  type: 'branch',
  operator: 'invalid',
  branches: [],
  distinct: true,
})
```

---

## Checklist

- [ ] Task 1.1: ConditionValue type
- [ ] Task 1.2: Pattern matching types (PatternNode, PatternEdge, PatternStep)
- [ ] Task 1.3: Subquery types (SubqueryCondition, SubqueryStep)
- [ ] Task 1.4: Projection types (ComputedOperator, ProjectionExpression, ProjectionReturn, ReturnStep)
- [ ] Task 1.5: UnwindStep type
- [ ] Task 1.6: Update BranchStep with 'except'
- [ ] Task 1.7: Update ASTNode union
- [ ] Task 1.8: Update WhereCondition union
- [ ] Task 1.9: Update exports
- [ ] Unit tests written
- [ ] Type tests written
- [ ] All tests passing
- [ ] Documentation complete

---

*Sub-spec version: 1.0*
