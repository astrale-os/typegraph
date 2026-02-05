# Sub-Spec 02: AST Builder Methods

**File:** `packages/core/src/ast/builder.ts`
**Dependencies:** Sub-Spec 01 (AST Type Definitions)
**Estimated Duration:** 1-1.5 days

---

## Overview

This sub-spec covers new methods for the `QueryAST` class to construct the new AST node types. All methods follow the existing immutable pattern.

---

## Tasks

### Task 2.1: Implement addPattern() Method

**Purpose:** Build PatternStep with proper alias registration.

```typescript
// Location: builder.ts, add to QueryAST class

/**
 * Add a pattern matching step.
 *
 * Pattern steps allow matching complex graph shapes like diamonds,
 * cycles, and multi-point joins in a single declarative step.
 *
 * @example
 * const ast = new QueryAST().addPattern({
 *   nodes: [
 *     { alias: 'a', labels: ['User'] },
 *     { alias: 'b', labels: ['Post'] },
 *   ],
 *   edges: [
 *     { from: 'a', to: 'b', types: ['AUTHORED'], direction: 'out', optional: false },
 *   ],
 * })
 */
addPattern(config: {
  nodes: PatternNode[]
  edges: PatternEdge[]
}): QueryAST {
  const step: PatternStep = {
    type: 'pattern',
    nodes: config.nodes,
    edges: config.edges,
  }

  // Register all node aliases
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

  // Register all edge aliases
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

  // Update user alias mappings
  const newUserAliases = new Map(this._userAliases)
  for (const node of config.nodes) {
    if (node.userAlias) {
      newUserAliases.set(node.userAlias, node.alias)
    }
  }

  const newEdgeUserAliases = new Map(this._edgeUserAliases)
  for (const edge of config.edges) {
    if (edge.userAlias && edge.alias) {
      newEdgeUserAliases.set(edge.userAlias, edge.alias)
    }
  }

  // Determine the "current" node (last node in the pattern)
  const lastNode = config.nodes[config.nodes.length - 1]
  const currentAlias = lastNode?.alias ?? this._currentNodeAlias
  const currentLabel = lastNode?.labels?.[0] ?? this._currentNodeLabel

  return this.createNew(
    [...this._steps, step],
    this._projection,
    newAliases,
    newUserAliases,
    newEdgeUserAliases,
    this._aliasCounter,
    currentAlias,
    currentLabel,
  )
}
```

**Acceptance Criteria:**
- [ ] Method creates PatternStep correctly
- [ ] All node aliases registered
- [ ] All edge aliases registered (when provided)
- [ ] User alias mappings updated
- [ ] Current node set to last pattern node
- [ ] Immutable - returns new QueryAST instance

---

### Task 2.2: Implement addSubqueryStep() Method

**Purpose:** Build SubqueryStep for correlated subqueries in the pipeline.

```typescript
/**
 * Add a correlated subquery step.
 *
 * The subquery can reference aliases from the outer query and export
 * new aliases back to it.
 *
 * @example
 * // Get users with count of their posts
 * const ast = new QueryAST()
 *   .addMatch({ labels: ['User'], alias: 'user' })
 *   .addSubqueryStep({
 *     correlatedAliases: ['user'],
 *     steps: [
 *       { type: 'traversal', ... },
 *       { type: 'aggregate', field: 'count', operation: 'count', alias: 'postCount' },
 *     ],
 *     exportedAliases: ['postCount'],
 *   })
 */
addSubqueryStep(config: {
  correlatedAliases: string[]
  steps: ASTNode[]
  exportedAliases: string[]
}): QueryAST {
  // Validate correlated aliases exist
  for (const alias of config.correlatedAliases) {
    if (!this._aliases.has(alias)) {
      throw new Error(`Correlated alias '${alias}' does not exist in current query`)
    }
  }

  const step: SubqueryStep = {
    type: 'subquery',
    correlatedAliases: config.correlatedAliases,
    steps: config.steps,
    exportedAliases: config.exportedAliases,
  }

  // Register exported aliases
  const newAliases = new Map(this._aliases)
  for (const exportedAlias of config.exportedAliases) {
    newAliases.set(exportedAlias, {
      internalAlias: exportedAlias,
      userAlias: undefined,
      type: 'computed', // Subquery exports are computed values
      label: '',
      sourceStep: this._steps.length,
    })
  }

  return this.createNew(
    [...this._steps, step],
    this._projection,
    newAliases,
    this._userAliases,
    this._edgeUserAliases,
    this._aliasCounter,
    this._currentNodeAlias,
    this._currentNodeLabel,
  )
}
```

**Acceptance Criteria:**
- [ ] Method creates SubqueryStep correctly
- [ ] Correlated aliases validated
- [ ] Exported aliases registered
- [ ] Immutable pattern followed

---

### Task 2.3: Implement addUnwind() Method

**Purpose:** Unwind array fields into individual rows.

```typescript
/**
 * Add an unwind step to expand an array field.
 *
 * @example
 * // Unwind post tags
 * const ast = new QueryAST()
 *   .addMatch({ labels: ['Post'], alias: 'post' })
 *   .addUnwind({
 *     sourceAlias: 'post',
 *     field: 'tags',
 *     itemAlias: 'tag',
 *   })
 */
addUnwind(config: {
  sourceAlias: string
  field: string
  itemAlias: string
}): QueryAST {
  // Validate source alias exists
  if (!this._aliases.has(config.sourceAlias)) {
    throw new Error(`Source alias '${config.sourceAlias}' does not exist`)
  }

  const step: UnwindStep = {
    type: 'unwind',
    sourceAlias: config.sourceAlias,
    field: config.field,
    itemAlias: config.itemAlias,
  }

  // Register the item alias
  const newAliases = new Map(this._aliases)
  newAliases.set(config.itemAlias, {
    internalAlias: config.itemAlias,
    userAlias: undefined,
    type: 'value', // Unwound items are scalar values
    label: '',
    sourceStep: this._steps.length,
  })

  return this.createNew(
    [...this._steps, step],
    this._projection,
    newAliases,
    this._userAliases,
    this._edgeUserAliases,
    this._aliasCounter,
    this._currentNodeAlias,
    this._currentNodeLabel,
  )
}
```

**Acceptance Criteria:**
- [ ] Method creates UnwindStep correctly
- [ ] Source alias validated
- [ ] Item alias registered
- [ ] Immutable pattern followed

---

### Task 2.4: Implement addReturn() Method

**Purpose:** Add explicit return/projection step.

```typescript
/**
 * Add an explicit return step.
 *
 * This replaces the implicit `_projection` field with a first-class
 * pipeline step, enabling subqueries to have their own projections.
 *
 * @example
 * // Simple return
 * ast.addReturn({
 *   returns: [{ kind: 'alias', alias: 'user' }],
 * })
 *
 * // Count only
 * ast.addReturn({
 *   returns: [{ kind: 'alias', alias: 'user' }],
 *   countOnly: true,
 * })
 *
 * // Computed expression
 * ast.addReturn({
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
 * })
 */
addReturn(config: {
  returns: ProjectionReturn[]
  countOnly?: boolean
  existsOnly?: boolean
}): QueryAST {
  // Validate alias references in returns
  for (const ret of config.returns) {
    if (ret.kind === 'alias' && !this._aliases.has(ret.alias)) {
      throw new Error(`Return alias '${ret.alias}' does not exist`)
    }
    if (ret.kind === 'collect' && !this._aliases.has(ret.sourceAlias)) {
      throw new Error(`Collect source alias '${ret.sourceAlias}' does not exist`)
    }
    if (ret.kind === 'path' && !this._aliases.has(ret.pathAlias)) {
      throw new Error(`Path alias '${ret.pathAlias}' does not exist`)
    }
    if (ret.kind === 'expression') {
      this.validateExpression(ret.expression)
    }
  }

  const step: ReturnStep = {
    type: 'return',
    returns: config.returns,
    countOnly: config.countOnly,
    existsOnly: config.existsOnly,
  }

  return this.createNew(
    [...this._steps, step],
    this._projection, // Keep projection for backward compat during migration
    this._aliases,
    this._userAliases,
    this._edgeUserAliases,
    this._aliasCounter,
    this._currentNodeAlias,
    this._currentNodeLabel,
  )
}

/**
 * Validate that all alias references in an expression exist.
 */
private validateExpression(expr: ProjectionExpression): void {
  switch (expr.type) {
    case 'field':
      if (!this._aliases.has(expr.alias)) {
        throw new Error(`Expression field alias '${expr.alias}' does not exist`)
      }
      break
    case 'computed':
      for (const operand of expr.operands) {
        this.validateExpression(operand)
      }
      break
    case 'case':
      for (const branch of expr.branches) {
        // Validate the 'when' condition - it may reference aliases
        this.validateCondition(branch.when)
        // Validate the 'then' expression
        this.validateExpression(branch.then)
      }
      if (expr.else) {
        this.validateExpression(expr.else)
      }
      break
    case 'function':
      for (const arg of expr.args) {
        this.validateExpression(arg)
      }
      break
    // literal and param don't reference aliases
  }
}

/**
 * Validate that all alias references in a condition exist.
 */
private validateCondition(cond: WhereCondition): void {
  switch (cond.type) {
    case 'comparison':
      if (cond.target && !this._aliases.has(cond.target)) {
        throw new Error(`Condition target alias '${cond.target}' does not exist`)
      }
      break
    case 'logical':
      for (const subcond of cond.conditions) {
        this.validateCondition(subcond)
      }
      break
    case 'subquery':
      // Subquery conditions reference correlated aliases
      for (const alias of cond.correlatedAliases) {
        if (!this._aliases.has(alias)) {
          throw new Error(`Correlated alias '${alias}' does not exist`)
        }
      }
      break
    // label conditions don't reference aliases directly
  }
}
```

**Acceptance Criteria:**
- [ ] Method creates ReturnStep correctly
- [ ] All alias references validated
- [ ] Expression validation recursive
- [ ] Supports countOnly and existsOnly flags
- [ ] Immutable pattern followed

---

### Task 2.5: Implement addWhereExists() Convenience Method

**Purpose:** Simplified API for existence subquery conditions.

```typescript
/**
 * Add a WHERE EXISTS subquery condition.
 *
 * @example
 * // Users who have authored at least one post
 * ast.addWhereExists({
 *   fromAlias: 'user',
 *   subquery: (sub) => sub
 *     .addTraversal({ edge: 'AUTHORED', direction: 'out', toLabel: 'Post' }),
 * })
 */
addWhereExists(config: {
  fromAlias: string
  subquery: (ast: QueryAST) => QueryAST
  negated?: boolean
}): QueryAST {
  const subAst = config.subquery(new QueryAST())

  // Use discriminated union types - create the specific condition type
  const condition: SubqueryExistsCondition | SubqueryNotExistsCondition = config.negated
    ? {
        type: 'subquery',
        mode: 'notExists',
        query: subAst.steps,
        correlatedAliases: [config.fromAlias],
      }
    : {
        type: 'subquery',
        mode: 'exists',
        query: subAst.steps,
        correlatedAliases: [config.fromAlias],
      }

  const whereStep: WhereStep = {
    type: 'where',
    conditions: [condition],
  }

  return this.createNew([...this._steps, whereStep])
}

/**
 * Add a WHERE NOT EXISTS subquery condition.
 */
addWhereNotExists(config: {
  fromAlias: string
  subquery: (ast: QueryAST) => QueryAST
}): QueryAST {
  return this.addWhereExists({ ...config, negated: true })
}
```

**Acceptance Criteria:**
- [ ] `addWhereExists` method implemented
- [ ] `addWhereNotExists` method implemented
- [ ] Subquery builder callback pattern works
- [ ] Conditions added as WhereStep

---

### Task 2.6: Implement addWhereCount() Convenience Method

**Purpose:** Simplified API for count comparison subquery conditions.

```typescript
/**
 * Add a WHERE COUNT { ... } comparison condition.
 *
 * @example
 * // Users with more than 5 posts
 * ast.addWhereCount({
 *   fromAlias: 'user',
 *   subquery: (sub) => sub.addTraversal({ ... }),
 *   operator: 'gt',
 *   value: 5,
 * })
 */
addWhereCount(config: {
  fromAlias: string
  subquery: (ast: QueryAST) => QueryAST
  operator: ComparisonOperator
  value: number
}): QueryAST {
  const subAst = config.subquery(new QueryAST())

  // SubqueryCountCondition - countPredicate is REQUIRED (not optional)
  const condition: SubqueryCountCondition = {
    type: 'subquery',
    mode: 'count',
    query: subAst.steps,
    countPredicate: {
      operator: config.operator,
      value: config.value,
    },
    correlatedAliases: [config.fromAlias],
  }

  const whereStep: WhereStep = {
    type: 'where',
    conditions: [condition],
  }

  return this.createNew([...this._steps, whereStep])
}
```

**Acceptance Criteria:**
- [ ] Method creates correct SubqueryCondition with count mode
- [ ] Supports all comparison operators
- [ ] Subquery builder callback works

---

### Task 2.7: Update Type Definitions for Alias Registry

**Purpose:** Support new alias types from patterns and subqueries.

```typescript
// Location: builder.ts, update AliasInfo type

interface AliasInfo {
  internalAlias: string
  userAlias?: string
  type: 'node' | 'edge' | 'computed' | 'value' | 'path' // Add new types
  label: string
  sourceStep: number
}
```

**Acceptance Criteria:**
- [ ] AliasInfo supports 'computed' type (for subquery exports)
- [ ] AliasInfo supports 'value' type (for unwind items)
- [ ] AliasInfo supports 'path' type (for path results)

---

## Testing

### Unit Tests

```typescript
// test/ast/builder-v2.test.ts

import { QueryAST } from '@astrale/typegraph-core'
import type { PatternStep, SubqueryStep, UnwindStep, ReturnStep } from '@astrale/typegraph-core'

describe('QueryAST v2 Methods', () => {
  describe('addPattern', () => {
    it('creates a single-node pattern', () => {
      const ast = new QueryAST().addPattern({
        nodes: [{ alias: 'n0', labels: ['User'] }],
        edges: [],
      })

      expect(ast.steps).toHaveLength(1)
      expect(ast.steps[0].type).toBe('pattern')

      const step = ast.steps[0] as PatternStep
      expect(step.nodes).toHaveLength(1)
      expect(step.nodes[0].alias).toBe('n0')
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

      const step = ast.steps[0] as PatternStep
      expect(step.nodes).toHaveLength(4)
      expect(step.edges).toHaveLength(4)
    })

    it('registers all aliases', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'user', labels: ['User'], userAlias: 'u' },
          { alias: 'post', labels: ['Post'], userAlias: 'p' },
        ],
        edges: [
          { alias: 'authored', from: 'user', to: 'post', types: ['AUTHORED'], direction: 'out', optional: false },
        ],
      })

      expect(ast.hasAlias('user')).toBe(true)
      expect(ast.hasAlias('post')).toBe(true)
      expect(ast.hasAlias('authored')).toBe(true)
    })
  })

  describe('addSubqueryStep', () => {
    it('creates subquery with correlated aliases', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addSubqueryStep({
          correlatedAliases: ['user'],
          steps: [],
          exportedAliases: ['postCount'],
        })

      expect(ast.steps).toHaveLength(2)
      const step = ast.steps[1] as SubqueryStep
      expect(step.correlatedAliases).toContain('user')
      expect(step.exportedAliases).toContain('postCount')
    })

    it('throws on invalid correlated alias', () => {
      expect(() => {
        new QueryAST().addSubqueryStep({
          correlatedAliases: ['nonexistent'],
          steps: [],
          exportedAliases: [],
        })
      }).toThrow("Correlated alias 'nonexistent' does not exist")
    })
  })

  describe('addUnwind', () => {
    it('creates unwind step', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['Post'], alias: 'post' })
        .addUnwind({
          sourceAlias: 'post',
          field: 'tags',
          itemAlias: 'tag',
        })

      const step = ast.steps[1] as UnwindStep
      expect(step.type).toBe('unwind')
      expect(step.sourceAlias).toBe('post')
      expect(step.field).toBe('tags')
      expect(step.itemAlias).toBe('tag')
    })

    it('registers item alias', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['Post'], alias: 'post' })
        .addUnwind({
          sourceAlias: 'post',
          field: 'tags',
          itemAlias: 'tag',
        })

      expect(ast.hasAlias('tag')).toBe(true)
    })
  })

  describe('addReturn', () => {
    it('creates simple return', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addReturn({
          returns: [{ kind: 'alias', alias: 'user' }],
        })

      const step = ast.steps[1] as ReturnStep
      expect(step.type).toBe('return')
      expect(step.returns).toHaveLength(1)
    })

    it('creates count-only return', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addReturn({
          returns: [{ kind: 'alias', alias: 'user' }],
          countOnly: true,
        })

      const step = ast.steps[1] as ReturnStep
      expect(step.countOnly).toBe(true)
    })

    it('validates alias references', () => {
      expect(() => {
        new QueryAST().addReturn({
          returns: [{ kind: 'alias', alias: 'nonexistent' }],
        })
      }).toThrow("Return alias 'nonexistent' does not exist")
    })
  })

  describe('addWhereExists', () => {
    it('creates exists condition', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addWhereExists({
          fromAlias: 'user',
          subquery: (sub) => sub.addTraversal({
            edge: 'AUTHORED',
            direction: 'out',
            toLabel: 'Post',
            toAlias: 'p',
          }),
        })

      expect(ast.steps).toHaveLength(2)
      expect(ast.steps[1].type).toBe('where')
    })
  })
})
```

---

## Checklist

- [ ] Task 2.1: addPattern() method
- [ ] Task 2.2: addSubqueryStep() method
- [ ] Task 2.3: addUnwind() method
- [ ] Task 2.4: addReturn() method with validation
- [ ] Task 2.5: addWhereExists() convenience method
- [ ] Task 2.6: addWhereCount() convenience method
- [ ] Task 2.7: Update AliasInfo type
- [ ] Unit tests for all methods
- [ ] All tests passing
- [ ] JSDoc complete

---

*Sub-spec version: 1.0*
