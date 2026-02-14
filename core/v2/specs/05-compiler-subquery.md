# Sub-Spec 05: Cypher Compiler - Subqueries

**File:** `packages/typegraph/src/compiler/cypher/compiler.ts`
**Dependencies:** Sub-Specs 01-02 (AST Types and Builder)
**Cross-References:** Sub-Spec 08 Task 8.4 (ConnectedToCondition migration requires optimization from Task 5.7)
**Estimated Duration:** 1.5-2 days

---

## Overview

This sub-spec covers Cypher compilation for both SubqueryStep (pipeline subqueries) and SubqueryCondition (WHERE clause subqueries).

---

## Background: Cypher Subquery Syntax

Neo4j 4.0+ and Memgraph support these subquery forms:

```cypher
-- CALL subquery (pipeline)
CALL {
  WITH outer_alias
  MATCH (inner)-[:REL]->(other)
  RETURN inner.prop AS value
}

-- EXISTS subquery (condition)
WHERE EXISTS {
  MATCH (n)-[:REL]->(m)
  WHERE m.prop = $value
}

-- COUNT subquery (condition)
WHERE COUNT {
  MATCH (n)-[:REL]->(m)
} > 5
```

---

## Tasks

### Task 5.1: Implement compileSubqueryStep()

**Purpose:** Compile SubqueryStep to CALL { ... } syntax.

```typescript
// Location: compiler.ts

/**
 * Compile a correlated subquery step.
 *
 * @example
 * // Input: SubqueryStep with correlatedAliases: ['user'], exportedAliases: ['postCount']
 * // Output:
 * // CALL {
 * //   WITH user
 * //   MATCH (user)-[:AUTHORED]->(p:Post)
 * //   RETURN count(p) AS postCount
 * // }
 */
private compileSubqueryStep(step: SubqueryStep): void {
  // Start CALL block
  this.clauses.push('CALL {')

  // Import correlated aliases
  if (step.correlatedAliases.length > 0) {
    const imports = step.correlatedAliases.join(', ')
    this.clauses.push(`  WITH ${imports}`)
  }

  // Compile subquery body
  const subCompiler = this.createSubCompiler()
  const subResult = subCompiler.compileSteps(step.steps)

  // Indent subquery clauses
  for (const clause of subResult.clauses) {
    this.clauses.push(`  ${clause}`)
  }

  // Merge parameters
  Object.assign(this.params, subResult.params)

  // Add RETURN for exported aliases if not already present
  if (!subResult.hasReturn && step.exportedAliases.length > 0) {
    const exports = step.exportedAliases.join(', ')
    this.clauses.push(`  RETURN ${exports}`)
  }

  // Close CALL block
  this.clauses.push('}')
}

/**
 * Create a sub-compiler for nested compilation.
 */
private createSubCompiler(): CypherCompiler {
  const sub = new CypherCompiler(this.schema, this.options)
  // Share parameter counter to avoid collisions
  sub.paramCounter = this.paramCounter
  return sub
}

/**
 * Compile a list of steps without the full AST wrapper.
 */
private compileSteps(steps: ASTNode[]): {
  clauses: string[]
  params: Record<string, unknown>
  hasReturn: boolean
} {
  const savedClauses = this.clauses
  this.clauses = []

  let hasReturn = false
  for (const step of steps) {
    if (step.type === 'return') {
      hasReturn = true
    }
    this.compileStep(step)
  }

  const result = {
    clauses: this.clauses,
    params: this.params,
    hasReturn,
  }

  this.clauses = savedClauses
  return result
}
```

**Acceptance Criteria:**
- [ ] Emits CALL { ... } wrapper
- [ ] Imports correlated aliases with WITH
- [ ] Compiles subquery body with indentation
- [ ] Shares parameter counter between compilers
- [ ] Handles exported aliases

---

### Task 5.2: Implement compileSubqueryCondition()

**Purpose:** Compile SubqueryCondition to EXISTS/COUNT syntax.

```typescript
/**
 * Compile a subquery condition to EXISTS { ... } or COUNT { ... } syntax.
 *
 * @example
 * // exists mode
 * WHERE EXISTS {
 *   MATCH (user)-[:AUTHORED]->(p:Post)
 * }
 *
 * // notExists mode
 * WHERE NOT EXISTS {
 *   MATCH (user)-[:AUTHORED]->(p:Post)
 * }
 *
 * // count mode
 * WHERE COUNT {
 *   MATCH (user)-[:AUTHORED]->(p:Post)
 * } > 5
 */
private compileSubqueryCondition(condition: SubqueryCondition): string {
  // Compile the subquery body
  const subCompiler = this.createSubCompiler()
  const subResult = subCompiler.compileSteps(condition.query)

  // Merge parameters
  Object.assign(this.params, subResult.params)

  // Build the subquery string (on single line for condition embedding)
  const subqueryBody = subResult.clauses.join(' ')

  switch (condition.mode) {
    case 'exists':
      return `EXISTS { ${subqueryBody} }`

    case 'notExists':
      return `NOT EXISTS { ${subqueryBody} }`

    case 'count': {
      if (!condition.countPredicate) {
        throw new Error('SubqueryCondition with mode=count requires countPredicate')
      }
      const { operator, value } = condition.countPredicate
      const cypherOp = this.operatorToCypher(operator)
      const paramName = this.addParam(value)
      return `COUNT { ${subqueryBody} } ${cypherOp} $${paramName}`
    }

    default:
      throw new Error(`Unknown subquery mode: ${condition.mode}`)
  }
}

/**
 * Convert comparison operator to Cypher syntax.
 */
private operatorToCypher(op: ComparisonOperator): string {
  switch (op) {
    case 'eq': return '='
    case 'neq': return '<>'
    case 'gt': return '>'
    case 'gte': return '>='
    case 'lt': return '<'
    case 'lte': return '<='
    default:
      throw new Error(`Unsupported comparison operator: ${op}`)
  }
}
```

**Acceptance Criteria:**
- [ ] Handles exists mode → EXISTS { }
- [ ] Handles notExists mode → NOT EXISTS { }
- [ ] Handles count mode → COUNT { } op value
- [ ] Parameters merged correctly
- [ ] Subquery body formatted appropriately

---

### Task 5.3: Integrate into compileCondition()

**Purpose:** Handle SubqueryCondition in the main condition compiler.

```typescript
// Update compileCondition to handle SubqueryCondition

private compileCondition(condition: WhereCondition): string {
  switch (condition.type) {
    case 'comparison':
      return this.compileComparisonCondition(condition)
    case 'logical':
      return this.compileLogicalCondition(condition)
    case 'label':
      return this.compileLabelCondition(condition)
    // New: SubqueryCondition
    case 'subquery':
      return this.compileSubqueryCondition(condition)
    // Deprecated (keep for backward compat)
    case 'exists':
      return this.compileExistsCondition(condition)
    case 'connectedTo':
      return this.compileConnectedToCondition(condition)
    default:
      throw new Error(`Unknown condition type: ${(condition as any).type}`)
  }
}
```

**Acceptance Criteria:**
- [ ] SubqueryCondition case added to switch
- [ ] Deprecated conditions still handled
- [ ] No type errors

---

### Task 5.4: Integrate SubqueryStep into compile()

**Purpose:** Handle SubqueryStep in the main step compilation.

```typescript
// In the step compilation switch/if chain

case 'subquery':
  this.compileSubqueryStep(step as SubqueryStep)
  break
```

**Acceptance Criteria:**
- [ ] SubqueryStep case added
- [ ] No runtime errors

---

### Task 5.5: Handle Correlated Alias References

**Purpose:** Ensure subqueries correctly reference outer query aliases.

```typescript
/**
 * When compiling subquery steps, the correlated aliases need to:
 * 1. Be imported with WITH at the start of the subquery
 * 2. Be usable as starting points for MATCH patterns
 *
 * Example:
 * Main query: MATCH (user:User)
 * Subquery:
 *   CALL {
 *     WITH user           -- Import correlated alias
 *     MATCH (user)-[:AUTHORED]->(p:Post)  -- Use it in MATCH
 *     RETURN count(p) AS postCount
 *   }
 */

// The compileSubqueryStep implementation already handles this by:
// 1. Emitting WITH <correlatedAliases> at the start
// 2. The subquery's MATCH patterns reference the imported alias
```

**Acceptance Criteria:**
- [ ] Correlated aliases imported correctly
- [ ] Subquery can reference outer aliases
- [ ] Resulting Cypher is syntactically correct

---

### Task 5.6: Handle Nested Subqueries

**Purpose:** Support subqueries within subqueries.

```typescript
// test/compiler/nested-subquery.test.ts

it('compiles nested subqueries', () => {
  // User -> Posts where each Post has Comments
  const innerSubquery: SubqueryCondition = {
    type: 'subquery',
    mode: 'exists',
    query: [{
      type: 'traversal',
      edge: 'HAS_COMMENT',
      direction: 'out',
      toLabel: 'Comment',
      fromAlias: 'p',
      toAlias: 'c',
    }],
    correlatedAliases: ['p'],
  }

  const ast = new QueryAST()
    .addMatch({ labels: ['User'], alias: 'user' })
    .addWhereExists({
      fromAlias: 'user',
      subquery: (sub) => sub
        .addTraversal({ ... })
        .addWhere([innerSubquery]),
    })

  const result = compiler.compile(ast)

  // Should have nested EXISTS
  expect(result.cypher).toContain('EXISTS {')
  expect(result.cypher.match(/EXISTS \{/g)).toHaveLength(2)
})
```

**Acceptance Criteria:**
- [ ] Nested subqueries compile correctly
- [ ] Parameter counters don't collide
- [ ] Proper nesting of curly braces

---

### Task 5.7: Preserve ConnectedTo Optimization Pattern

**CRITICAL PERFORMANCE REQUIREMENT**

The current compiler has an important optimization in `compileConnectedToAsMatch()` (compiler.ts:285-419) that generates efficient MATCH patterns. When migrating ConnectedToCondition to SubqueryCondition (see Sub-Spec 08), we MUST preserve this optimization.

**Problem:**
```cypher
-- Naive SubqueryCondition compilation (SLOW - 10-100x slower)
WHERE EXISTS { MATCH (n0)-[:EDGE]->(t) WHERE t.id = $p0 }
-- This scans from n0, then checks each connected node

-- Optimized MATCH pattern (FAST - uses index)
MATCH (n0)-[:EDGE]->(target0 {id: $p0})
-- This uses the index on target node ID first
```

**Solution: Pattern Detection**

When compiling SubqueryCondition, detect the "connected to specific node" pattern and emit optimized MATCH instead of EXISTS:

```typescript
/**
 * Check if a SubqueryCondition can be optimized to a MATCH pattern.
 *
 * Optimizable pattern:
 * - mode: 'exists'
 * - Single traversal step
 * - Single WHERE with field='id' and operator='eq' targeting the traversal destination
 */
private isOptimizableConnectedToPattern(condition: SubqueryCondition): {
  optimizable: true
  traversal: TraversalStep
  nodeId: unknown
} | { optimizable: false } {
  if (condition.mode !== 'exists') {
    return { optimizable: false }
  }

  // Must have exactly: [TraversalStep, WhereStep]
  if (condition.query.length !== 2) {
    return { optimizable: false }
  }

  const [first, second] = condition.query
  if (first.type !== 'traversal' || second.type !== 'where') {
    return { optimizable: false }
  }

  const traversal = first as TraversalStep
  const where = second as WhereStep

  // Must have exactly one comparison condition on id
  if (where.conditions.length !== 1) {
    return { optimizable: false }
  }

  const cond = where.conditions[0]
  if (
    cond.type !== 'comparison' ||
    cond.field !== 'id' ||
    cond.operator !== 'eq' ||
    cond.target !== traversal.toAlias
  ) {
    return { optimizable: false }
  }

  // Extract the node ID value
  const nodeId = cond.value.kind === 'literal'
    ? cond.value.value
    : cond.value

  return { optimizable: true, traversal, nodeId }
}

/**
 * Compile SubqueryCondition with optimization detection.
 */
private compileSubqueryCondition(condition: SubqueryCondition): string {
  // Check for ConnectedTo optimization pattern
  const pattern = this.isOptimizableConnectedToPattern(condition)
  if (pattern.optimizable) {
    return this.compileOptimizedConnectedTo(pattern.traversal, pattern.nodeId)
  }

  // Fall back to standard EXISTS/COUNT compilation
  // ... existing implementation ...
}

/**
 * Emit optimized MATCH pattern for "connected to specific node" queries.
 * This generates a pattern that allows the query planner to use indexes.
 *
 * IMPORTANT: This method is called during WHERE compilation but needs to
 * emit a MATCH clause. We handle this by:
 * 1. Adding the MATCH pattern to a pending patterns list
 * 2. Returning a placeholder condition that's always true
 * 3. The main compile() method inserts pending patterns before WHERE
 */
private compileOptimizedConnectedTo(
  traversal: TraversalStep,
  nodeId: unknown
): string {
  const paramName = this.addParam(nodeId)
  const labels = traversal.toLabels?.join(':') || ''
  const labelClause = labels ? `:${labels}` : ''

  // Generate: (fromAlias)-[:EDGE]->(toAlias:Labels {id: $p0})
  const arrow = traversal.direction === 'out' ? '->' : '<-'
  const pattern = `(${traversal.fromAlias})-[:${traversal.edge}]${arrow}(${traversal.toAlias}${labelClause} {id: $${paramName}})`

  // Add to pending MATCH patterns - these are inserted before WHERE clauses
  // by the main compile() method
  this.pendingMatchPatterns.push(`MATCH ${pattern}`)

  // Return empty string - the condition is satisfied by the MATCH pattern
  // The caller should filter out empty conditions from the WHERE clause
  return ''
}

/**
 * Field to store MATCH patterns that need to be inserted before WHERE.
 * Initialized in compile() method.
 */
private pendingMatchPatterns: string[] = []

/**
 * In the main compile() method, insert pending MATCH patterns:
 *
 * private compile(): CompiledQuery {
 *   this.pendingMatchPatterns = []  // Initialize
 *
 *   // ... compile steps ...
 *
 *   // Before emitting WHERE, insert any pending MATCH patterns
 *   if (this.pendingMatchPatterns.length > 0) {
 *     // Find the last MATCH/OPTIONAL MATCH clause
 *     const lastMatchIdx = this.findLastMatchIndex()
 *     // Insert pending patterns after it
 *     this.clauses.splice(lastMatchIdx + 1, 0, ...this.pendingMatchPatterns)
 *   }
 *
 *   // ... continue with WHERE compilation ...
 * }
 *
 * When compiling WHERE conditions, filter out empty strings:
 * const conditionStrs = conditions.map(c => this.compileCondition(c)).filter(Boolean)
 */
```

**Alternative: Compiler Flag**

If pattern detection is too complex, provide a compiler option:

```typescript
interface CompilerOptions {
  /**
   * When true, attempt to optimize EXISTS subqueries that check
   * connection to a specific node by ID into MATCH patterns.
   * Default: true
   */
  optimizeConnectedToPatterns?: boolean
}
```

**Acceptance Criteria:**
- [ ] Pattern detection correctly identifies "connected to node by ID" subqueries
- [ ] Optimized pattern generates MATCH with inline ID constraint
- [ ] Non-matching patterns fall back to standard EXISTS
- [ ] Performance test confirms optimization provides expected speedup
- [ ] Handles both 'out' and 'in' directions

---

## Testing

### Unit Tests

```typescript
// test/compiler/subquery.test.ts

import { CypherCompiler, QueryAST } from '@astrale/typegraph'

describe('Subquery Compilation', () => {
  let compiler: CypherCompiler

  beforeEach(() => {
    compiler = new CypherCompiler(schema)
  })

  describe('SubqueryCondition', () => {
    it('compiles exists mode', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addWhereExists({
          fromAlias: 'user',
          subquery: (sub) => sub.addTraversal({
            edge: 'AUTHORED',
            direction: 'out',
            toLabel: 'Post',
            fromAlias: 'user',
            toAlias: 'p',
          }),
        })

      const result = compiler.compile(ast)

      expect(result.cypher).toContain('WHERE EXISTS {')
      expect(result.cypher).toContain('MATCH (user)-[:AUTHORED]->(p:Post)')
    })

    it('compiles notExists mode', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addWhereNotExists({
          fromAlias: 'user',
          subquery: (sub) => sub.addTraversal({ ... }),
        })

      const result = compiler.compile(ast)

      expect(result.cypher).toContain('WHERE NOT EXISTS {')
    })

    it('compiles count mode with comparison', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addWhereCount({
          fromAlias: 'user',
          subquery: (sub) => sub.addTraversal({ ... }),
          operator: 'gt',
          value: 5,
        })

      const result = compiler.compile(ast)

      expect(result.cypher).toContain('WHERE COUNT {')
      expect(result.cypher).toMatch(/} > \$p\d+/)
    })
  })

  describe('SubqueryStep', () => {
    it('compiles CALL subquery', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addSubqueryStep({
          correlatedAliases: ['user'],
          steps: [
            {
              type: 'traversal',
              edge: 'AUTHORED',
              direction: 'out',
              toLabel: 'Post',
              fromAlias: 'user',
              toAlias: 'p',
              optional: false,
              cardinality: 'many',
            },
            {
              type: 'aggregate',
              field: '*',
              operation: 'count',
              alias: 'postCount',
            },
          ],
          exportedAliases: ['postCount'],
        })

      const result = compiler.compile(ast)

      expect(result.cypher).toContain('CALL {')
      expect(result.cypher).toContain('WITH user')
      expect(result.cypher).toContain('RETURN')
      expect(result.cypher).toContain('postCount')
      expect(result.cypher).toContain('}')
    })

    it('handles empty correlated aliases', () => {
      const ast = new QueryAST()
        .addSubqueryStep({
          correlatedAliases: [],
          steps: [
            { type: 'match', labels: ['Config'], alias: 'config' },
          ],
          exportedAliases: ['config'],
        })

      const result = compiler.compile(ast)

      expect(result.cypher).toContain('CALL {')
      expect(result.cypher).not.toContain('WITH ')
      expect(result.cypher).toContain('MATCH (config:Config)')
    })
  })

  describe('Parameter Handling', () => {
    it('shares parameter counter across subqueries', () => {
      const ast = new QueryAST()
        .addMatch({ labels: ['User'], alias: 'user' })
        .addWhere([{ type: 'comparison', field: 'status', operator: 'eq', value: 'active', target: 'user' }])
        .addWhereExists({
          fromAlias: 'user',
          subquery: (sub) => sub
            .addTraversal({ ... })
            .addWhere([{ type: 'comparison', field: 'published', operator: 'eq', value: true, target: 'p' }]),
        })

      const result = compiler.compile(ast)

      // Parameters should be p0, p1 (not p0, p0)
      expect(result.params).toHaveProperty('p0', 'active')
      expect(result.params).toHaveProperty('p1', true)
    })
  })
})
```

### Integration Tests

```typescript
// test/integration/subquery.integration.test.ts

describe('Subquery Integration', () => {
  it('executes exists subquery', async () => {
    // Setup: users with and without posts
    await graph.mutate.create('User', { id: 'u1', name: 'Author' })
    await graph.mutate.create('User', { id: 'u2', name: 'Reader' })
    await graph.mutate.create('Post', { id: 'p1', title: 'Hello' })
    await graph.mutate.link('AUTHORED', 'u1', 'p1')

    const authorsOnly = await graph
      .node('User')
      .whereExists(q => q.to('AUTHORED'))
      .execute()

    expect(authorsOnly).toHaveLength(1)
    expect(authorsOnly[0].name).toBe('Author')
  })

  it('executes count subquery', async () => {
    // Setup: user with 3 posts
    await graph.mutate.create('User', { id: 'u1', name: 'Prolific' })
    await Promise.all([
      graph.mutate.create('Post', { id: 'p1' }),
      graph.mutate.create('Post', { id: 'p2' }),
      graph.mutate.create('Post', { id: 'p3' }),
    ])
    await Promise.all([
      graph.mutate.link('AUTHORED', 'u1', 'p1'),
      graph.mutate.link('AUTHORED', 'u1', 'p2'),
      graph.mutate.link('AUTHORED', 'u1', 'p3'),
    ])

    const prolificAuthors = await graph
      .node('User')
      .whereCount(q => q.to('AUTHORED'), 'gte', 3)
      .execute()

    expect(prolificAuthors).toHaveLength(1)
  })

  it('executes CALL subquery with aggregation', async () => {
    // ... similar setup ...

    const usersWithPostCounts = await graph
      .node('User')
      .subquery({
        correlated: ['user'],
        query: q => q.to('AUTHORED').count().as('postCount'),
        exports: ['postCount'],
      })
      .execute()

    expect(usersWithPostCounts[0]).toHaveProperty('postCount')
  })
})
```

---

## Checklist

- [ ] Task 5.1: compileSubqueryStep() method
- [ ] Task 5.2: compileSubqueryCondition() method
- [ ] Task 5.3: Integrate into compileCondition()
- [ ] Task 5.4: Integrate SubqueryStep into compile()
- [ ] Task 5.5: Handle correlated alias references
- [ ] Task 5.6: Handle nested subqueries
- [ ] Task 5.7: Preserve ConnectedTo optimization pattern (CRITICAL)
- [ ] Unit tests written
- [ ] Integration tests written
- [ ] Performance tests for optimization
- [ ] All tests passing

---

*Sub-spec version: 1.0*
