# Sub-Spec 04: Cypher Compiler - Pattern Matching

**File:** `packages/typegraph/src/compiler/cypher/compiler.ts`
**Dependencies:** Sub-Specs 01-02 (AST Types and Builder)
**Estimated Duration:** 1-1.5 days

---

## Overview

This sub-spec covers the Cypher compilation of PatternStep, enabling declarative pattern matching for complex graph structures.

---

## Tasks

### Task 4.1: Add compilePattern() Method

**Purpose:** Compile PatternStep to MATCH clauses.

```typescript
// Location: compiler.ts, add method to CypherCompiler class

/**
 * Compile a pattern step to MATCH clauses.
 *
 * Patterns are compiled as a series of MATCH clauses that together
 * represent the declarative graph shape.
 */
private compilePattern(step: PatternStep): void {
  // Track which nodes have been emitted in a MATCH clause
  const emittedNodes = new Set<string>()

  // Group edges by whether they're optional
  const requiredEdges = step.edges.filter(e => !e.optional)
  const optionalEdges = step.edges.filter(e => e.optional)

  // Build the required MATCH patterns first
  if (requiredEdges.length > 0) {
    this.compilePatternEdges(step.nodes, requiredEdges, emittedNodes, 'MATCH')
  }

  // Emit any standalone nodes not covered by edges
  const standaloneNodes = step.nodes.filter(n => !emittedNodes.has(n.alias))
  for (const node of standaloneNodes) {
    const pattern = this.buildNodePattern(node)
    this.clauses.push(`MATCH ${pattern}`)
    emittedNodes.add(node.alias)
  }

  // Build OPTIONAL MATCH for optional edges
  if (optionalEdges.length > 0) {
    this.compilePatternEdges(step.nodes, optionalEdges, emittedNodes, 'OPTIONAL MATCH')
  }

  // Compile inline WHERE conditions
  this.compilePatternConditions(step)
}
```

**Acceptance Criteria:**
- [ ] Method handles required edges
- [ ] Method handles optional edges (OPTIONAL MATCH)
- [ ] Standalone nodes emitted separately
- [ ] Inline conditions compiled

---

### Task 4.2: Implement buildNodePattern() Helper

**Purpose:** Build a single node pattern string.

```typescript
/**
 * Build a Cypher node pattern.
 *
 * @example
 * // (n0:User {id: $p0})
 * // (n0:User:Admin)
 * // (n0)
 */
private buildNodePattern(node: PatternNode): string {
  const parts: string[] = [`(${node.alias}`]

  // Labels
  if (node.labels?.length) {
    parts.push(`:${node.labels.join(':')}`)
  }

  // ID property filter
  if (node.id !== undefined) {
    const paramName = this.addParam(node.id)
    parts.push(` {id: $${paramName}}`)
  }

  parts.push(')')
  return parts.join('')
}
```

**Acceptance Criteria:**
- [ ] Handles no labels
- [ ] Handles single label
- [ ] Handles multiple labels
- [ ] Handles ID property

---

### Task 4.3: Implement buildEdgePattern() Helper

**Purpose:** Build an edge pattern string with direction arrows.

```typescript
/**
 * Build a Cypher edge pattern with direction arrows.
 *
 * @example
 * // -[r:KNOWS]->
 * // <-[r:KNOWS]-
 * // -[r:KNOWS]-
 * // -[r:KNOWS*1..5]->
 */
private buildEdgePattern(edge: PatternEdge): {
  leftArrow: string
  rightArrow: string
  edgeStr: string
} {
  // Direction arrows
  let leftArrow = '-'
  let rightArrow = '-'

  switch (edge.direction) {
    case 'out':
      rightArrow = '->'
      break
    case 'in':
      leftArrow = '<-'
      break
    case 'both':
      // No arrows for bidirectional
      break
  }

  // Edge type(s)
  const typesStr = edge.types.join('|')

  // Alias (optional)
  const aliasStr = edge.alias ?? ''

  // Variable length
  let lengthStr = ''
  if (edge.variableLength) {
    const { min, max } = edge.variableLength
    if (max !== undefined) {
      lengthStr = `*${min}..${max}`
    } else if (min !== undefined) {
      lengthStr = `*${min}..`
    } else {
      lengthStr = '*'
    }
  }

  const edgeStr = `[${aliasStr}:${typesStr}${lengthStr}]`

  return { leftArrow, rightArrow, edgeStr }
}
```

**Acceptance Criteria:**
- [ ] Handles outgoing direction
- [ ] Handles incoming direction
- [ ] Handles bidirectional
- [ ] Handles variable length paths
- [ ] Handles optional edge alias

---

### Task 4.4: Implement compilePatternEdges() Helper

**Purpose:** Compile a set of edges, trying to chain them efficiently.

```typescript
/**
 * Compile a set of pattern edges to MATCH clauses.
 *
 * Attempts to chain edges that share nodes to minimize MATCH clauses.
 */
private compilePatternEdges(
  nodes: PatternNode[],
  edges: PatternEdge[],
  emittedNodes: Set<string>,
  keyword: 'MATCH' | 'OPTIONAL MATCH',
): void {
  const nodeMap = new Map(nodes.map(n => [n.alias, n]))

  // For each edge, emit a MATCH clause
  // Future optimization: chain connected edges in single MATCH
  for (const edge of edges) {
    const fromNode = nodeMap.get(edge.from)
    const toNode = nodeMap.get(edge.to)

    const { leftArrow, rightArrow, edgeStr } = this.buildEdgePattern(edge)

    // Build node patterns (reuse alias if already emitted)
    const fromPattern = emittedNodes.has(edge.from)
      ? `(${edge.from})`
      : this.buildNodePattern(fromNode ?? { alias: edge.from })

    const toPattern = emittedNodes.has(edge.to)
      ? `(${edge.to})`
      : this.buildNodePattern(toNode ?? { alias: edge.to })

    const matchClause = `${keyword} ${fromPattern}${leftArrow}${edgeStr}${rightArrow}${toPattern}`
    this.clauses.push(matchClause)

    // Mark nodes as emitted
    emittedNodes.add(edge.from)
    emittedNodes.add(edge.to)
  }
}
```

**Acceptance Criteria:**
- [ ] Emits correct MATCH/OPTIONAL MATCH keyword
- [ ] Reuses aliases for already-emitted nodes
- [ ] Builds full node pattern for new nodes
- [ ] Tracks emitted nodes

---

### Task 4.5: Implement compilePatternConditions() Helper

**Purpose:** Compile inline WHERE conditions from pattern nodes and edges.

```typescript
/**
 * Compile inline WHERE conditions from pattern.
 */
private compilePatternConditions(step: PatternStep): void {
  const conditions: string[] = []

  // Node conditions - these are full WhereCondition types
  for (const node of step.nodes) {
    if (node.where?.length) {
      for (const condition of node.where) {
        // WhereCondition already has 'target' field
        const condStr = this.compileCondition(condition)
        conditions.push(condStr)
      }
    }
  }

  // Edge conditions - these are lightweight EdgeWhereCondition types
  // EdgeWhereCondition has: { field, operator, value } - no target or type
  for (const edge of step.edges) {
    if (edge.where?.length && edge.alias) {
      for (const edgeCond of edge.where) {
        // EdgeWhereCondition is simpler - compile directly as comparison
        const paramName = this.addParam(edgeCond.value)
        const cypherOp = this.operatorToCypher(edgeCond.operator)
        const condStr = `${edge.alias}.${edgeCond.field} ${cypherOp} $${paramName}`
        conditions.push(condStr)
      }
    }
  }

  if (conditions.length > 0) {
    this.clauses.push(`WHERE ${conditions.join(' AND ')}`)
  }
}
```

**Acceptance Criteria:**
- [ ] Compiles node inline conditions
- [ ] Compiles edge inline conditions
- [ ] Combines with AND
- [ ] Uses correct target alias

---

### Task 4.6: Add Pattern Step Case to compile()

**Purpose:** Integrate PatternStep into the main compile loop.

```typescript
// In compile() method, add to switch or step processing

case 'pattern':
  this.compilePattern(step as PatternStep)
  break
```

**Acceptance Criteria:**
- [ ] PatternStep handled in compile()
- [ ] No runtime errors for pattern queries

---

### Task 4.7: Handle Complex Pattern Shapes

**Purpose:** Ensure diamond, cycle, and multi-join patterns work correctly.

```typescript
// test/compiler/pattern-shapes.test.ts

describe('Pattern Shape Compilation', () => {
  describe('Diamond Pattern', () => {
    it('compiles A->B, A->C, B->D, C->D', () => {
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

      const cypher = compiler.compile(ast).cypher

      // Should have multiple MATCH clauses referencing shared nodes
      expect(cypher).toContain('MATCH (a:A)')
      expect(cypher).toContain('MATCH (a)-[:E1]->(b:B)')
      // etc.
    })
  })

  describe('Cycle Pattern', () => {
    it('compiles A->B->C->A', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'a', labels: ['A'] },
          { alias: 'b', labels: ['B'] },
          { alias: 'c', labels: ['C'] },
        ],
        edges: [
          { from: 'a', to: 'b', types: ['E1'], direction: 'out', optional: false },
          { from: 'b', to: 'c', types: ['E2'], direction: 'out', optional: false },
          { from: 'c', to: 'a', types: ['E3'], direction: 'out', optional: false },
        ],
      })

      const cypher = compiler.compile(ast).cypher

      // Should correctly reference 'a' twice
      expect(cypher).toContain('->(a)')
    })
  })

  describe('Mixed Optional Pattern', () => {
    it('compiles required and optional edges separately', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'u', labels: ['User'] },
          { alias: 'p', labels: ['Post'] },
          { alias: 'c', labels: ['Comment'] },
        ],
        edges: [
          { from: 'u', to: 'p', types: ['AUTHORED'], direction: 'out', optional: false },
          { from: 'p', to: 'c', types: ['HAS_COMMENT'], direction: 'out', optional: true },
        ],
      })

      const cypher = compiler.compile(ast).cypher

      expect(cypher).toContain('MATCH')
      expect(cypher).toContain('OPTIONAL MATCH')
    })
  })
})
```

**Acceptance Criteria:**
- [ ] Diamond patterns compile correctly
- [ ] Cycle patterns compile correctly (node reuse)
- [ ] Mixed required/optional patterns use correct keywords

---

## Testing

### Unit Tests

```typescript
// test/compiler/pattern.test.ts

import { CypherCompiler, QueryAST, type PatternStep } from '@astrale/typegraph'

describe('Pattern Compilation', () => {
  let compiler: CypherCompiler

  beforeEach(() => {
    compiler = new CypherCompiler(schema)
  })

  describe('buildNodePattern', () => {
    it('builds simple node pattern', () => {
      const pattern = compiler['buildNodePattern']({
        alias: 'n0',
        labels: ['User'],
      })
      expect(pattern).toBe('(n0:User)')
    })

    it('builds node with multiple labels', () => {
      const pattern = compiler['buildNodePattern']({
        alias: 'n0',
        labels: ['User', 'Admin'],
      })
      expect(pattern).toBe('(n0:User:Admin)')
    })

    it('builds node with ID filter', () => {
      const pattern = compiler['buildNodePattern']({
        alias: 'n0',
        labels: ['User'],
        id: 'user-123',
      })
      expect(pattern).toMatch(/\(n0:User \{id: \$p\d+\}\)/)
    })
  })

  describe('buildEdgePattern', () => {
    it('builds outgoing edge', () => {
      const { leftArrow, rightArrow, edgeStr } = compiler['buildEdgePattern']({
        types: ['KNOWS'],
        direction: 'out',
        from: 'a',
        to: 'b',
        optional: false,
      })
      expect(leftArrow).toBe('-')
      expect(rightArrow).toBe('->')
      expect(edgeStr).toBe('[:KNOWS]')
    })

    it('builds incoming edge', () => {
      const { leftArrow, rightArrow } = compiler['buildEdgePattern']({
        types: ['KNOWS'],
        direction: 'in',
        from: 'a',
        to: 'b',
        optional: false,
      })
      expect(leftArrow).toBe('<-')
      expect(rightArrow).toBe('-')
    })

    it('builds variable length edge', () => {
      const { edgeStr } = compiler['buildEdgePattern']({
        alias: 'path',
        types: ['KNOWS'],
        direction: 'out',
        from: 'a',
        to: 'b',
        optional: false,
        variableLength: { min: 1, max: 5 },
      })
      expect(edgeStr).toBe('[path:KNOWS*1..5]')
    })

    it('builds multi-type edge', () => {
      const { edgeStr } = compiler['buildEdgePattern']({
        types: ['KNOWS', 'LIKES'],
        direction: 'out',
        from: 'a',
        to: 'b',
        optional: false,
      })
      expect(edgeStr).toBe('[:KNOWS|LIKES]')
    })
  })

  describe('compilePattern', () => {
    it('compiles simple two-node pattern', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'user', labels: ['User'] },
          { alias: 'post', labels: ['Post'] },
        ],
        edges: [
          { from: 'user', to: 'post', types: ['AUTHORED'], direction: 'out', optional: false },
        ],
      })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('MATCH (user:User)-[:AUTHORED]->(post:Post)')
    })

    it('compiles standalone nodes', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'user', labels: ['User'] },
          { alias: 'admin', labels: ['Admin'] },
        ],
        edges: [],
      })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('MATCH (user:User)')
      expect(result.cypher).toContain('MATCH (admin:Admin)')
    })

    it('compiles inline conditions', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          {
            alias: 'user',
            labels: ['User'],
            where: [{ type: 'comparison', field: 'status', operator: 'eq', value: 'active' }],
          },
        ],
        edges: [],
      })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('WHERE')
      expect(result.cypher).toContain('status')
    })
  })
})
```

### Integration Tests

```typescript
// test/integration/pattern.integration.test.ts

describe('Pattern Integration', () => {
  it('executes diamond pattern query', async () => {
    // Setup test data with diamond shape
    await graph.mutate.create('User', { id: 'u1', name: 'Alice' })
    await graph.mutate.create('Project', { id: 'p1', name: 'Project' })
    await graph.mutate.create('Task', { id: 't1', name: 'Task 1' })
    await graph.mutate.create('Task', { id: 't2', name: 'Task 2' })
    await graph.mutate.create('Review', { id: 'r1', status: 'pending' })
    // ... create edges forming diamond

    const result = await graph.pattern({
      nodes: [
        { alias: 'u', labels: ['User'] },
        { alias: 't1', labels: ['Task'] },
        { alias: 't2', labels: ['Task'] },
        { alias: 'r', labels: ['Review'] },
      ],
      edges: [
        { from: 'u', to: 't1', types: ['ASSIGNED'], direction: 'out', optional: false },
        { from: 'u', to: 't2', types: ['ASSIGNED'], direction: 'out', optional: false },
        { from: 't1', to: 'r', types: ['PENDING_REVIEW'], direction: 'out', optional: false },
        { from: 't2', to: 'r', types: ['PENDING_REVIEW'], direction: 'out', optional: false },
      ],
    }).execute()

    expect(result).toHaveLength(1)
  })
})
```

---

## Checklist

- [ ] Task 4.1: compilePattern() method
- [ ] Task 4.2: buildNodePattern() helper
- [ ] Task 4.3: buildEdgePattern() helper
- [ ] Task 4.4: compilePatternEdges() helper
- [ ] Task 4.5: compilePatternConditions() helper
- [ ] Task 4.6: Integration in compile()
- [ ] Task 4.7: Complex pattern shape tests
- [ ] Unit tests written
- [ ] Integration tests written
- [ ] All tests passing

---

*Sub-spec version: 1.0*
