// @ts-nocheck
/**
 * Query V2 Compiler Specification Tests
 *
 * Comprehensive tests for all v2 Cypher compiler features:
 * - Pattern compilation
 * - Subquery step compilation (CALL {})
 * - Subquery condition compilation (EXISTS / NOT EXISTS / COUNT)
 * - Return step compilation
 * - Unwind compilation
 * - AliasComparison condition
 * - Except branch compilation
 */

import { describe, it, expect } from 'vitest'
import { createCypherCompiler } from '../../src/query/compiler'
import { QueryAST } from '../../src/query/ast'
import { normalizeCypher } from './fixtures/test-schema'

// =============================================================================
// HELPERS
// =============================================================================

function compile(ast: QueryAST) {
  const compiler = createCypherCompiler()
  return compiler.compile(ast)
}

// =============================================================================
// 1. PATTERN COMPILATION
// =============================================================================

describe('Pattern Compilation', () => {
  it('compiles basic 2-node + 1-edge pattern', () => {
    const ast = new QueryAST().addPattern({
      nodes: [
        { alias: 'a', labels: ['User'] },
        { alias: 'b', labels: ['Post'] },
      ],
      edges: [{ types: ['authored'], direction: 'out', from: 'a', to: 'b', optional: false }],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('MATCH (a:User)-[:authored]->(b:Post)')
    expect(result.cypher).toContain('RETURN')
  })

  it('compiles diamond pattern: 4 nodes + 4 edges', () => {
    const ast = new QueryAST().addPattern({
      nodes: [
        { alias: 'a', labels: ['A'] },
        { alias: 'b', labels: ['B'] },
        { alias: 'c', labels: ['C'] },
        { alias: 'd', labels: ['D'] },
      ],
      edges: [
        { types: ['E1'], direction: 'out', from: 'a', to: 'b', optional: false },
        { types: ['E2'], direction: 'out', from: 'a', to: 'c', optional: false },
        { types: ['E3'], direction: 'out', from: 'b', to: 'd', optional: false },
        { types: ['E4'], direction: 'out', from: 'c', to: 'd', optional: false },
      ],
    })

    const result = compile(ast)
    const cypher = normalizeCypher(result.cypher)

    // First edge emits full labels for both 'a' and 'b'
    expect(cypher).toContain('MATCH (a:A)-[:E1]->(b:B)')
    // Second edge: 'a' is already emitted, so it appears as (a); 'c' is new
    expect(cypher).toContain('MATCH (a)-[:E2]->(c:C)')
    // Third edge: 'b' is already emitted; 'd' is new
    expect(cypher).toContain('MATCH (b)-[:E3]->(d:D)')
    // Fourth edge: both 'c' and 'd' are already emitted
    expect(cypher).toContain('MATCH (c)-[:E4]->(d)')
  })

  it('compiles standalone node with no edges', () => {
    const ast = new QueryAST().addPattern({
      nodes: [{ alias: 'a', labels: ['User'] }],
      edges: [],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('MATCH (a:User)')
  })

  it('compiles optional edges with OPTIONAL MATCH', () => {
    const ast = new QueryAST().addPattern({
      nodes: [
        { alias: 'a', labels: ['User'] },
        { alias: 'b', labels: ['Post'] },
      ],
      edges: [{ types: ['authored'], direction: 'out', from: 'a', to: 'b', optional: true }],
    })

    const result = compile(ast)

    // Standalone node 'a' should get its own MATCH since there are no required edges
    expect(result.cypher).toContain('MATCH (a:User)')
    expect(result.cypher).toContain('OPTIONAL MATCH')
    expect(result.cypher).toContain('[:authored]')
  })

  it('compiles mixed required + optional edges', () => {
    const ast = new QueryAST().addPattern({
      nodes: [
        { alias: 'a', labels: ['User'] },
        { alias: 'b', labels: ['Post'] },
        { alias: 'c', labels: ['Comment'] },
      ],
      edges: [
        { types: ['authored'], direction: 'out', from: 'a', to: 'b', optional: false },
        { types: ['commentedOn'], direction: 'in', from: 'b', to: 'c', optional: true },
      ],
    })

    const result = compile(ast)
    const cypher = normalizeCypher(result.cypher)

    // Required edge first
    expect(cypher).toContain('MATCH (a:User)-[:authored]->(b:Post)')
    // Node 'c' is standalone (no required edges), so it gets its own MATCH
    expect(cypher).toContain('MATCH (c:Comment)')
    // Optional edge uses OPTIONAL MATCH; 'b' and 'c' are already emitted so no labels
    expect(cypher).toContain('OPTIONAL MATCH (b)<-[:commentedOn]-(c)')
  })

  it('compiles inline WHERE conditions on nodes', () => {
    const ast = new QueryAST().addPattern({
      nodes: [
        {
          alias: 'a',
          labels: ['User'],
          where: [
            { type: 'comparison', field: 'status', operator: 'eq', value: 'active', target: 'a' },
          ],
        },
        { alias: 'b', labels: ['Post'] },
      ],
      edges: [{ types: ['authored'], direction: 'out', from: 'a', to: 'b', optional: false }],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('WHERE a.status = $p0')
    expect(result.params).toHaveProperty('p0', 'active')
  })

  it('compiles inline WHERE conditions on edges with edge alias', () => {
    const ast = new QueryAST().addPattern({
      nodes: [
        { alias: 'a', labels: ['User'] },
        { alias: 'b', labels: ['Post'] },
      ],
      edges: [
        {
          alias: 'r',
          types: ['authored'],
          direction: 'out',
          from: 'a',
          to: 'b',
          optional: false,
          where: [{ field: 'role', operator: 'eq', value: 'primary' }],
        },
      ],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('[r:authored]')
    expect(result.cypher).toContain('WHERE r.role = $p0')
    expect(result.params).toHaveProperty('p0', 'primary')
  })

  it('compiles variable-length edge pattern', () => {
    const ast = new QueryAST().addPattern({
      nodes: [
        { alias: 'a', labels: ['Folder'] },
        { alias: 'b', labels: ['Folder'] },
      ],
      edges: [
        {
          types: ['hasParent'],
          direction: 'out',
          from: 'a',
          to: 'b',
          optional: false,
          variableLength: { min: 1, max: 5, uniqueness: 'nodes' },
        },
      ],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('[:hasParent*1..5]')
  })

  it('compiles node with ID property', () => {
    const ast = new QueryAST().addPattern({
      nodes: [
        { alias: 'a', labels: ['User'], id: 'user_123' },
        { alias: 'b', labels: ['Post'] },
      ],
      edges: [{ types: ['authored'], direction: 'out', from: 'a', to: 'b', optional: false }],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('{id: $p0}')
    expect(result.params).toHaveProperty('p0', 'user_123')
  })

  it('compiles multiple labels per node (no schema)', () => {
    const ast = new QueryAST().addPattern({
      nodes: [{ alias: 'a', labels: ['User', 'Admin'] }],
      edges: [],
    })

    const result = compile(ast)

    // Without schema, labels are joined with ':'
    expect(result.cypher).toContain('(a:User:Admin)')
  })

  it('deduplicates nodes shared across edges', () => {
    // Node 'b' appears in two edges; its labels should only be emitted once
    const ast = new QueryAST().addPattern({
      nodes: [
        { alias: 'a', labels: ['User'] },
        { alias: 'b', labels: ['Post'] },
        { alias: 'c', labels: ['Category'] },
      ],
      edges: [
        { types: ['authored'], direction: 'out', from: 'a', to: 'b', optional: false },
        { types: ['categorizedAs'], direction: 'out', from: 'b', to: 'c', optional: false },
      ],
    })

    const result = compile(ast)
    const cypher = normalizeCypher(result.cypher)

    // First occurrence of 'b' should include label
    expect(cypher).toContain('(b:Post)')
    // Second occurrence of 'b' (in second MATCH) should NOT include label again
    expect(cypher).toContain('MATCH (b)-[:categorizedAs]->(c:Category)')
  })
})

// =============================================================================
// 2. SUBQUERY STEP COMPILATION (CALL {})
// =============================================================================

describe('Subquery Step Compilation', () => {
  it('compiles basic CALL {} with correlated alias', () => {
    const ast = new QueryAST().addMatch('User').addSubqueryStep({
      correlatedAliases: ['n0'],
      steps: [
        {
          type: 'traversal',
          edges: ['authored'],
          direction: 'out',
          fromAlias: 'n0',
          toAlias: 'sq0',
          toLabels: [],
          optional: false,
          cardinality: 'many',
        },
      ],
      exportedAliases: ['sq0'],
    })

    const result = compile(ast)
    const cypher = normalizeCypher(result.cypher)

    expect(result.cypher).toContain('CALL {')
    expect(result.cypher).toContain('WITH n0')
    expect(result.cypher).toContain('RETURN sq0')
    expect(result.cypher).toContain('}')
  })

  it('omits WITH line when no correlated aliases', () => {
    const ast = new QueryAST().addMatch('User').addSubqueryStep({
      correlatedAliases: [],
      steps: [
        {
          type: 'match',
          label: 'Post',
          alias: 'sq0',
        },
      ],
      exportedAliases: ['sq0'],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('CALL {')
    expect(result.cypher).not.toContain('WITH')
    expect(result.cypher).toContain('RETURN sq0')
  })

  it('compiles multiple correlated aliases', () => {
    // Need both n0 and n1 in scope
    const ast = new QueryAST()
      .addMatch('User')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['Post'],
        cardinality: 'many',
      })
      .addSubqueryStep({
        correlatedAliases: ['n0', 'n1'],
        steps: [
          {
            type: 'traversal',
            edges: ['likes'],
            direction: 'in',
            fromAlias: 'n1',
            toAlias: 'sq0',
            toLabels: [],
            optional: false,
            cardinality: 'many',
          },
        ],
        exportedAliases: ['sq0'],
      })

    const result = compile(ast)

    expect(result.cypher).toContain('WITH n0, n1')
  })

  it('does not auto-generate RETURN when subquery has ReturnStep', () => {
    const ast = new QueryAST().addMatch('User').addSubqueryStep({
      correlatedAliases: ['n0'],
      steps: [
        {
          type: 'traversal',
          edges: ['authored'],
          direction: 'out',
          fromAlias: 'n0',
          toAlias: 'sq0',
          toLabels: [],
          optional: false,
          cardinality: 'many',
        },
        {
          type: 'return',
          returns: [{ kind: 'alias', alias: 'sq0', resultAlias: 'posts' }],
        },
      ],
      exportedAliases: [],
    })

    const result = compile(ast)

    // The subquery has its own RETURN, so no auto-generated RETURN
    const callBlock = result.cypher.split('CALL {')[1]!.split('}')[0]!
    // Count RETURN occurrences inside CALL block (should be exactly 1)
    const returnCount = (callBlock.match(/RETURN/g) || []).length
    expect(returnCount).toBe(1)
  })

  it('auto-generates RETURN when subquery has no ReturnStep but has exported aliases', () => {
    const ast = new QueryAST().addMatch('User').addSubqueryStep({
      correlatedAliases: ['n0'],
      steps: [
        {
          type: 'traversal',
          edges: ['authored'],
          direction: 'out',
          fromAlias: 'n0',
          toAlias: 'sq0',
          toLabels: [],
          optional: false,
          cardinality: 'many',
        },
      ],
      exportedAliases: ['sq0'],
    })

    const result = compile(ast)

    // Should auto-generate RETURN sq0 inside the CALL block
    expect(result.cypher).toContain('RETURN sq0')
  })

  it('compiles nested subqueries (subquery inside subquery)', () => {
    const ast = new QueryAST().addMatch('User').addSubqueryStep({
      correlatedAliases: ['n0'],
      steps: [
        {
          type: 'traversal',
          edges: ['authored'],
          direction: 'out',
          fromAlias: 'n0',
          toAlias: 'sq0',
          toLabels: [],
          optional: false,
          cardinality: 'many',
        },
        {
          type: 'subquery',
          correlatedAliases: ['sq0'],
          steps: [
            {
              type: 'traversal',
              edges: ['likes'],
              direction: 'in',
              fromAlias: 'sq0',
              toAlias: 'sq1',
              toLabels: [],
              optional: false,
              cardinality: 'many',
            },
          ],
          exportedAliases: ['sq1'],
        },
      ],
      exportedAliases: ['sq0'],
    })

    const result = compile(ast)

    // Should have nested CALL {} blocks
    const callCount = (result.cypher.match(/CALL \{/g) || []).length
    expect(callCount).toBe(2)
  })

  it('compiles subquery with inner WHERE + traversal', () => {
    const ast = new QueryAST().addMatch('User').addSubqueryStep({
      correlatedAliases: ['n0'],
      steps: [
        {
          type: 'traversal',
          edges: ['authored'],
          direction: 'out',
          fromAlias: 'n0',
          toAlias: 'sq0',
          toLabels: ['Post'],
          optional: false,
          cardinality: 'many',
        },
        {
          type: 'where',
          conditions: [
            {
              type: 'comparison',
              field: 'status',
              operator: 'eq',
              value: 'published',
              target: 'sq0',
            },
          ],
        },
      ],
      exportedAliases: ['sq0'],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('CALL {')
    expect(result.cypher).toContain('sq0.status = $p0')
    expect(result.params).toHaveProperty('p0', 'published')
  })
})

// =============================================================================
// 3. SUBQUERY CONDITION COMPILATION (EXISTS / NOT EXISTS / COUNT)
// =============================================================================

describe('Subquery Condition Compilation', () => {
  it('compiles EXISTS { MATCH ... }', () => {
    const base = new QueryAST().addMatch('User')
    const condition = {
      type: 'subquery' as const,
      mode: 'exists' as const,
      query: [
        {
          type: 'traversal' as const,
          edges: ['authored'],
          direction: 'out' as const,
          fromAlias: 'n0',
          toAlias: 'sq0',
          toLabels: [] as string[],
          optional: false,
          cardinality: 'many' as const,
        },
      ],
      correlatedAliases: ['n0'],
    }
    const ast = base.addWhere([condition])

    const result = compile(ast)

    expect(result.cypher).toContain('EXISTS {')
    expect(result.cypher).toContain('[:authored]')
  })

  it('compiles NOT EXISTS { MATCH ... }', () => {
    const base = new QueryAST().addMatch('User')
    const condition = {
      type: 'subquery' as const,
      mode: 'notExists' as const,
      query: [
        {
          type: 'traversal' as const,
          edges: ['authored'],
          direction: 'out' as const,
          fromAlias: 'n0',
          toAlias: 'sq0',
          toLabels: [] as string[],
          optional: false,
          cardinality: 'many' as const,
        },
      ],
      correlatedAliases: ['n0'],
    }
    const ast = base.addWhere([condition])

    const result = compile(ast)

    expect(result.cypher).toContain('NOT EXISTS {')
  })

  it('compiles COUNT { ... } > N', () => {
    const base = new QueryAST().addMatch('User')
    const condition = {
      type: 'subquery' as const,
      mode: 'count' as const,
      query: [
        {
          type: 'traversal' as const,
          edges: ['authored'],
          direction: 'out' as const,
          fromAlias: 'n0',
          toAlias: 'sq0',
          toLabels: [] as string[],
          optional: false,
          cardinality: 'many' as const,
        },
      ],
      correlatedAliases: ['n0'],
      countPredicate: { operator: 'gt' as const, value: 5 },
    }
    const ast = base.addWhere([condition])

    const result = compile(ast)

    expect(result.cypher).toContain('COUNT {')
    expect(result.cypher).toContain('> $p0')
    expect(result.params).toHaveProperty('p0', 5)
  })

  it('compiles COUNT with eq operator', () => {
    const base = new QueryAST().addMatch('User')
    const condition = {
      type: 'subquery' as const,
      mode: 'count' as const,
      query: [
        {
          type: 'traversal' as const,
          edges: ['authored'],
          direction: 'out' as const,
          fromAlias: 'n0',
          toAlias: 'sq0',
          toLabels: [] as string[],
          optional: false,
          cardinality: 'many' as const,
        },
      ],
      correlatedAliases: ['n0'],
      countPredicate: { operator: 'eq' as const, value: 3 },
    }
    const ast = base.addWhere([condition])

    const result = compile(ast)

    expect(result.cypher).toContain('COUNT {')
    expect(result.cypher).toContain('= $p0')
    expect(result.params).toHaveProperty('p0', 3)
  })

  it('compiles COUNT with lt operator', () => {
    const base = new QueryAST().addMatch('User')
    const condition = {
      type: 'subquery' as const,
      mode: 'count' as const,
      query: [
        {
          type: 'traversal' as const,
          edges: ['likes'],
          direction: 'out' as const,
          fromAlias: 'n0',
          toAlias: 'sq0',
          toLabels: [] as string[],
          optional: false,
          cardinality: 'many' as const,
        },
      ],
      correlatedAliases: ['n0'],
      countPredicate: { operator: 'lt' as const, value: 10 },
    }
    const ast = base.addWhere([condition])

    const result = compile(ast)

    expect(result.cypher).toContain('COUNT {')
    expect(result.cypher).toContain('< $p0')
    expect(result.params).toHaveProperty('p0', 10)
  })

  it('compiles COUNT with gte operator', () => {
    const base = new QueryAST().addMatch('User')
    const condition = {
      type: 'subquery' as const,
      mode: 'count' as const,
      query: [
        {
          type: 'traversal' as const,
          edges: ['authored'],
          direction: 'out' as const,
          fromAlias: 'n0',
          toAlias: 'sq0',
          toLabels: [] as string[],
          optional: false,
          cardinality: 'many' as const,
        },
      ],
      correlatedAliases: ['n0'],
      countPredicate: { operator: 'gte' as const, value: 1 },
    }
    const ast = base.addWhere([condition])

    const result = compile(ast)

    expect(result.cypher).toContain('COUNT {')
    expect(result.cypher).toContain('>= $p0')
    expect(result.params).toHaveProperty('p0', 1)
  })

  it('compiles subquery condition with traversal chain inside', () => {
    const base = new QueryAST().addMatch('User')
    const condition = {
      type: 'subquery' as const,
      mode: 'exists' as const,
      query: [
        {
          type: 'traversal' as const,
          edges: ['authored'],
          direction: 'out' as const,
          fromAlias: 'n0',
          toAlias: 'sq0',
          toLabels: ['Post'],
          optional: false,
          cardinality: 'many' as const,
        },
        {
          type: 'traversal' as const,
          edges: ['categorizedAs'],
          direction: 'out' as const,
          fromAlias: 'sq0',
          toAlias: 'sq1',
          toLabels: ['Category'],
          optional: false,
          cardinality: 'many' as const,
        },
      ],
      correlatedAliases: ['n0'],
    }
    const ast = base.addWhere([condition])

    const result = compile(ast)

    expect(result.cypher).toContain('EXISTS {')
    expect(result.cypher).toContain('[:authored]')
    expect(result.cypher).toContain('[:categorizedAs]')
  })

  it('compiles SubqueryCondition inside logical AND', () => {
    const base = new QueryAST().addMatch('User')
    const subqueryCondition = {
      type: 'subquery' as const,
      mode: 'exists' as const,
      query: [
        {
          type: 'traversal' as const,
          edges: ['authored'],
          direction: 'out' as const,
          fromAlias: 'n0',
          toAlias: 'sq0',
          toLabels: [] as string[],
          optional: false,
          cardinality: 'many' as const,
        },
      ],
      correlatedAliases: ['n0'],
    }
    const comparisonCondition = {
      type: 'comparison' as const,
      field: 'status',
      operator: 'eq' as const,
      value: 'active',
      target: 'n0',
    }
    const logicalCondition = {
      type: 'logical' as const,
      operator: 'AND' as const,
      conditions: [comparisonCondition, subqueryCondition],
    }
    const ast = base.addWhere([logicalCondition])

    const result = compile(ast)

    expect(result.cypher).toContain('n0.status = $p0')
    expect(result.cypher).toContain('EXISTS {')
  })

  it('compiles SubqueryCondition inside logical OR', () => {
    const base = new QueryAST().addMatch('User')
    const existsCondition = {
      type: 'subquery' as const,
      mode: 'exists' as const,
      query: [
        {
          type: 'traversal' as const,
          edges: ['authored'],
          direction: 'out' as const,
          fromAlias: 'n0',
          toAlias: 'sq0',
          toLabels: [] as string[],
          optional: false,
          cardinality: 'many' as const,
        },
      ],
      correlatedAliases: ['n0'],
    }
    const notExistsCondition = {
      type: 'subquery' as const,
      mode: 'notExists' as const,
      query: [
        {
          type: 'traversal' as const,
          edges: ['likes'],
          direction: 'out' as const,
          fromAlias: 'n0',
          toAlias: 'sq1',
          toLabels: [] as string[],
          optional: false,
          cardinality: 'many' as const,
        },
      ],
      correlatedAliases: ['n0'],
    }
    const logicalCondition = {
      type: 'logical' as const,
      operator: 'OR' as const,
      conditions: [existsCondition, notExistsCondition],
    }
    const ast = base.addWhere([logicalCondition])

    const result = compile(ast)

    expect(result.cypher).toContain('EXISTS {')
    expect(result.cypher).toContain('NOT EXISTS {')
    expect(result.cypher).toContain(' OR ')
  })
})

// =============================================================================
// 4. RETURN STEP COMPILATION
// =============================================================================

describe('Return Step Compilation', () => {
  it('returns single alias', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [{ kind: 'alias', alias: 'n0' }],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('RETURN n0')
  })

  it('returns alias with resultAlias (AS)', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [{ kind: 'alias', alias: 'n0', resultAlias: 'user' }],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('RETURN n0 AS user')
  })

  it('returns alias with field selection', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [{ kind: 'alias', alias: 'n0', fields: ['name', 'email'] }],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('n0.name')
    expect(result.cypher).toContain('n0.email')
  })

  it('returns expression with field ref', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [
        {
          kind: 'expression',
          expression: { type: 'field', alias: 'n0', field: 'name' },
          resultAlias: 'userName',
        },
      ],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('n0.name AS userName')
  })

  it('returns expression with string literal', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [
        {
          kind: 'expression',
          expression: { type: 'literal', value: 'hello' },
          resultAlias: 'greeting',
        },
      ],
    })

    const result = compile(ast)

    expect(result.cypher).toContain("'hello' AS greeting")
  })

  it('returns expression with number literal', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [
        {
          kind: 'expression',
          expression: { type: 'literal', value: 42 },
          resultAlias: 'answer',
        },
      ],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('42 AS answer')
  })

  it('returns expression with boolean literal', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [
        {
          kind: 'expression',
          expression: { type: 'literal', value: true },
          resultAlias: 'flag',
        },
      ],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('true AS flag')
  })

  it('returns expression with null literal', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [
        {
          kind: 'expression',
          expression: { type: 'literal', value: null },
          resultAlias: 'nothing',
        },
      ],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('null AS nothing')
  })

  it('returns expression with array literal', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [
        {
          kind: 'expression',
          expression: { type: 'literal', value: [1, 2, 3] },
          resultAlias: 'nums',
        },
      ],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('[1, 2, 3] AS nums')
  })

  it('returns expression with computed add', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [
        {
          kind: 'expression',
          expression: {
            type: 'computed',
            operator: 'add',
            operands: [
              { type: 'field', alias: 'n0', field: 'score' },
              { type: 'literal', value: 10 },
            ],
          },
          resultAlias: 'boosted',
        },
      ],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('(n0.score + 10) AS boosted')
  })

  it('returns expression with computed subtract', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [
        {
          kind: 'expression',
          expression: {
            type: 'computed',
            operator: 'subtract',
            operands: [
              { type: 'field', alias: 'n0', field: 'score' },
              { type: 'literal', value: 5 },
            ],
          },
          resultAlias: 'reduced',
        },
      ],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('(n0.score - 5) AS reduced')
  })

  it('returns expression with computed concat', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [
        {
          kind: 'expression',
          expression: {
            type: 'computed',
            operator: 'concat',
            operands: [
              { type: 'field', alias: 'n0', field: 'name' },
              { type: 'literal', value: '@example.com' },
            ],
          },
          resultAlias: 'email',
        },
      ],
    })

    const result = compile(ast)

    // concat compiles to operands joined with ' + '
    expect(result.cypher).toContain("n0.name + '@example.com' AS email")
  })

  it('returns expression with CASE WHEN', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [
        {
          kind: 'expression',
          expression: {
            type: 'case',
            branches: [
              {
                when: {
                  type: 'comparison',
                  field: 'score',
                  operator: 'gte',
                  value: 90,
                  target: 'n0',
                },
                then: { type: 'literal', value: 'A' }, // oxlint-disable-line no-thenable
              },
              {
                when: {
                  type: 'comparison',
                  field: 'score',
                  operator: 'gte',
                  value: 80,
                  target: 'n0',
                },
                then: { type: 'literal', value: 'B' }, // oxlint-disable-line no-thenable
              },
            ],
            else: { type: 'literal', value: 'C' },
          },
          resultAlias: 'grade',
        },
      ],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('CASE')
    expect(result.cypher).toContain('WHEN n0.score >= $p0 THEN')
    expect(result.cypher).toContain("'A'")
    expect(result.cypher).toContain('WHEN n0.score >= $p1 THEN')
    expect(result.cypher).toContain("'B'")
    expect(result.cypher).toContain("ELSE 'C'")
    expect(result.cypher).toContain('END')
    expect(result.cypher).toContain('AS grade')
  })

  it('returns expression with function call', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [
        {
          kind: 'expression',
          expression: {
            type: 'function',
            name: 'toUpper',
            args: [{ type: 'field', alias: 'n0', field: 'name' }],
          },
          resultAlias: 'upperName',
        },
      ],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('toUpper(n0.name) AS upperName')
  })

  it('returns collect kind without distinct', () => {
    const ast = new QueryAST()
      .addMatch('User')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['Post'],
        cardinality: 'many',
      })
      .addReturn({
        returns: [{ kind: 'collect', sourceAlias: 'n1', resultAlias: 'posts' }],
      })

    const result = compile(ast)

    expect(result.cypher).toContain('collect(n1) AS posts')
  })

  it('returns collect kind with distinct', () => {
    const ast = new QueryAST()
      .addMatch('User')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['Post'],
        cardinality: 'many',
      })
      .addReturn({
        returns: [
          { kind: 'collect', sourceAlias: 'n1', distinct: true, resultAlias: 'uniquePosts' },
        ],
      })

    const result = compile(ast)

    expect(result.cypher).toContain('collect(DISTINCT n1) AS uniquePosts')
  })

  it('returns path kind', () => {
    // Trace alias counter: addMatch('User') -> n0 (counter=1),
    // addTraversal -> n1/e2 (counter=3), addPath -> p3 (counter=4)
    const base = new QueryAST()
      .addMatch('User')
      .addTraversal({
        edges: ['follows'],
        direction: 'out',
        toLabels: ['User'],
        cardinality: 'many',
      })
      .addPath({
        algorithm: 'shortestPath',
        toAlias: 'n1',
        edge: 'follows',
        direction: 'out',
      })

    // Get the actual path alias from projection
    const pathAlias = base.projection.pathAlias!
    const ast = base.addReturn({
      returns: [{ kind: 'path', pathAlias, resultAlias: 'shortPath' }],
    })

    const result = compile(ast)

    expect(result.cypher).toContain(`${pathAlias} AS shortPath`)
  })

  it('compiles countOnly mode', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [{ kind: 'alias', alias: 'n0' }],
      countOnly: true,
    })

    const result = compile(ast)

    expect(result.cypher).toContain('RETURN count(n0) AS count')
  })

  it('compiles existsOnly mode', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [{ kind: 'alias', alias: 'n0' }],
      existsOnly: true,
    })

    const result = compile(ast)

    expect(result.cypher).toContain('RETURN count(n0) > 0 AS exists')
  })

  it('compiles DISTINCT + return interaction', () => {
    const ast = new QueryAST()
      .addMatch('User')
      .addDistinct()
      .addReturn({
        returns: [{ kind: 'alias', alias: 'n0' }],
      })

    const result = compile(ast)

    expect(result.cypher).toContain('RETURN DISTINCT n0')
  })

  it('compiles multiple return items', () => {
    const ast = new QueryAST()
      .addMatch('User')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['Post'],
        cardinality: 'many',
      })
      .addReturn({
        returns: [
          { kind: 'alias', alias: 'n0', resultAlias: 'author' },
          { kind: 'alias', alias: 'n1', resultAlias: 'post' },
          {
            kind: 'expression',
            expression: { type: 'field', alias: 'n0', field: 'name' },
            resultAlias: 'authorName',
          },
        ],
      })

    const result = compile(ast)

    expect(result.cypher).toContain('n0 AS author')
    expect(result.cypher).toContain('n1 AS post')
    expect(result.cypher).toContain('n0.name AS authorName')
  })

  it('does not emit alias AS alias when resultAlias matches alias', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [{ kind: 'alias', alias: 'n0', resultAlias: 'n0' }],
    })

    const result = compile(ast)

    // Should just be 'n0', not 'n0 AS n0'
    expect(result.cypher).toContain('RETURN n0')
    expect(result.cypher).not.toContain('n0 AS n0')
  })

  it('returns expression with param reference', () => {
    const ast = new QueryAST().addMatch('User').addReturn({
      returns: [
        {
          kind: 'expression',
          expression: { type: 'param', name: 'myParam' },
          resultAlias: 'val',
        },
      ],
    })

    const result = compile(ast)

    expect(result.cypher).toContain('$myParam AS val')
  })
})

// =============================================================================
// 5. UNWIND COMPILATION
// =============================================================================

describe('Unwind Compilation', () => {
  it('compiles basic UNWIND', () => {
    const ast = new QueryAST()
      .addMatch('Post')
      .addUnwind({ sourceAlias: 'n0', field: 'tags', itemAlias: 'tag' })

    const result = compile(ast)

    expect(result.cypher).toContain('UNWIND n0.tags AS tag')
  })

  it('compiles unwind followed by WHERE', () => {
    const ast = new QueryAST()
      .addMatch('Post')
      .addUnwind({ sourceAlias: 'n0', field: 'tags', itemAlias: 'tag' })
      .addWhere([
        { type: 'comparison', field: 'tag', operator: 'eq', value: 'typescript', target: 'tag' },
      ])

    const result = compile(ast)
    const cypher = normalizeCypher(result.cypher)

    // UNWIND should come before WHERE
    const unwindIdx = cypher.indexOf('UNWIND')
    const whereIdx = cypher.indexOf('WHERE')
    expect(unwindIdx).toBeLessThan(whereIdx)
    expect(result.cypher).toContain('UNWIND n0.tags AS tag')
  })

  it('compiles MATCH -> UNWIND -> RETURN sequence', () => {
    const ast = new QueryAST()
      .addMatch('Post')
      .addUnwind({ sourceAlias: 'n0', field: 'tags', itemAlias: 'tag' })
      .addReturn({
        returns: [
          {
            kind: 'expression',
            expression: { type: 'field', alias: 'tag', field: 'tag' },
            resultAlias: 'tagValue',
          },
        ],
      })

    const result = compile(ast)
    const cypher = normalizeCypher(result.cypher)

    const matchIdx = cypher.indexOf('MATCH')
    const unwindIdx = cypher.indexOf('UNWIND')
    const returnIdx = cypher.indexOf('RETURN')

    expect(matchIdx).toBeLessThan(unwindIdx)
    expect(unwindIdx).toBeLessThan(returnIdx)
  })
})

// =============================================================================
// 6. ALIAS COMPARISON CONDITION
// =============================================================================

describe('AliasComparison Condition', () => {
  it('compiles basic cross-alias eq comparison', () => {
    const ast = new QueryAST()
      .addMatch('User')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['Post'],
        cardinality: 'many',
      })
      .addWhere([
        {
          type: 'aliasComparison' as const,
          leftAlias: 'n0',
          leftField: 'name',
          operator: 'eq' as const,
          rightAlias: 'n1',
          rightField: 'title',
        },
      ])

    const result = compile(ast)

    expect(result.cypher).toContain('n0.name = n1.title')
  })

  it('compiles cross-alias lt comparison', () => {
    const ast = new QueryAST()
      .addMatch('User')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['Post'],
        cardinality: 'many',
      })
      .addWhere([
        {
          type: 'aliasComparison' as const,
          leftAlias: 'n0',
          leftField: 'createdAt',
          operator: 'lt' as const,
          rightAlias: 'n1',
          rightField: 'publishedAt',
        },
      ])

    const result = compile(ast)

    expect(result.cypher).toContain('n0.createdAt < n1.publishedAt')
  })

  it('compiles cross-alias gt comparison', () => {
    const ast = new QueryAST()
      .addMatch('User')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['Post'],
        cardinality: 'many',
      })
      .addWhere([
        {
          type: 'aliasComparison' as const,
          leftAlias: 'n0',
          leftField: 'score',
          operator: 'gt' as const,
          rightAlias: 'n1',
          rightField: 'viewCount',
        },
      ])

    const result = compile(ast)

    expect(result.cypher).toContain('n0.score > n1.viewCount')
  })

  it('compiles cross-alias gte comparison', () => {
    const ast = new QueryAST()
      .addMatch('User')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['Post'],
        cardinality: 'many',
      })
      .addWhere([
        {
          type: 'aliasComparison' as const,
          leftAlias: 'n0',
          leftField: 'score',
          operator: 'gte' as const,
          rightAlias: 'n1',
          rightField: 'viewCount',
        },
      ])

    const result = compile(ast)

    expect(result.cypher).toContain('n0.score >= n1.viewCount')
  })

  it('compiles cross-alias lte comparison', () => {
    const ast = new QueryAST()
      .addMatch('User')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['Post'],
        cardinality: 'many',
      })
      .addWhere([
        {
          type: 'aliasComparison' as const,
          leftAlias: 'n0',
          leftField: 'createdAt',
          operator: 'lte' as const,
          rightAlias: 'n1',
          rightField: 'publishedAt',
        },
      ])

    const result = compile(ast)

    expect(result.cypher).toContain('n0.createdAt <= n1.publishedAt')
  })

  it('compiles cross-alias neq comparison', () => {
    const ast = new QueryAST()
      .addMatch('User')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['Post'],
        cardinality: 'many',
      })
      .addWhere([
        {
          type: 'aliasComparison' as const,
          leftAlias: 'n0',
          leftField: 'name',
          operator: 'neq' as const,
          rightAlias: 'n1',
          rightField: 'title',
        },
      ])

    const result = compile(ast)

    expect(result.cypher).toContain('n0.name <> n1.title')
  })

  it('compiles aliasComparison in WHERE with other conditions (AND)', () => {
    const ast = new QueryAST()
      .addMatch('User')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['Post'],
        cardinality: 'many',
      })
      .addWhere([
        {
          type: 'comparison' as const,
          field: 'status',
          operator: 'eq' as const,
          value: 'active',
          target: 'n0',
        },
        {
          type: 'aliasComparison' as const,
          leftAlias: 'n0',
          leftField: 'createdAt',
          operator: 'lt' as const,
          rightAlias: 'n1',
          rightField: 'publishedAt',
        },
      ])

    const result = compile(ast)

    // Both conditions should be AND-ed in the WHERE clause
    expect(result.cypher).toContain('n0.status = $p0')
    expect(result.cypher).toContain('n0.createdAt < n1.publishedAt')
    expect(result.cypher).toContain('AND')
  })
})

// =============================================================================
// 7. EXCEPT BRANCH COMPILATION
// =============================================================================

describe('Except Branch Compilation', () => {
  it('compiles EXCEPT (distinct=true)', () => {
    const branch1 = new QueryAST()
      .addMatch('User')
      .addWhere([
        { type: 'comparison', field: 'status', operator: 'eq', value: 'active', target: 'n0' },
      ])
    const branch2 = new QueryAST()
      .addMatch('User')
      .addWhere([
        { type: 'comparison', field: 'role', operator: 'eq', value: 'banned', target: 'n0' },
      ])

    const ast = new QueryAST().addBranch({
      operator: 'except',
      branches: [branch1, branch2],
      distinct: true,
    })

    const result = compile(ast)

    expect(result.cypher).toContain('EXCEPT')
    // Should NOT contain 'EXCEPT ALL' — just 'EXCEPT'
    expect(result.cypher).not.toContain('EXCEPT ALL')
    // Each branch should have its own MATCH + WHERE + RETURN
    expect(result.cypher).toContain('MATCH (n0:User)')
    expect(result.cypher).toContain('RETURN n0')
  })

  it('compiles EXCEPT ALL (distinct=false)', () => {
    const branch1 = new QueryAST()
      .addMatch('User')
      .addWhere([
        { type: 'comparison', field: 'status', operator: 'eq', value: 'active', target: 'n0' },
      ])
    const branch2 = new QueryAST()
      .addMatch('User')
      .addWhere([
        { type: 'comparison', field: 'role', operator: 'eq', value: 'banned', target: 'n0' },
      ])

    const ast = new QueryAST().addBranch({
      operator: 'except',
      branches: [branch1, branch2],
      distinct: false,
    })

    const result = compile(ast)

    expect(result.cypher).toContain('EXCEPT ALL')
  })

  it('compiles EXCEPT with 3+ branches', () => {
    const branch1 = new QueryAST()
      .addMatch('User')
      .addWhere([
        { type: 'comparison', field: 'status', operator: 'eq', value: 'active', target: 'n0' },
      ])
    const branch2 = new QueryAST()
      .addMatch('User')
      .addWhere([
        { type: 'comparison', field: 'role', operator: 'eq', value: 'banned', target: 'n0' },
      ])
    const branch3 = new QueryAST()
      .addMatch('User')
      .addWhere([
        { type: 'comparison', field: 'role', operator: 'eq', value: 'suspended', target: 'n0' },
      ])

    const ast = new QueryAST().addBranch({
      operator: 'except',
      branches: [branch1, branch2, branch3],
      distinct: true,
    })

    const result = compile(ast)

    // Should have EXCEPT between each branch
    const exceptCount = (result.cypher.match(/\bEXCEPT\b/g) || []).length
    expect(exceptCount).toBe(2)
    // Verify all three branches have RETURN
    const returnCount = (result.cypher.match(/RETURN n0/g) || []).length
    expect(returnCount).toBe(3)
  })
})

// =============================================================================
// INTEGRATION / COMBINED TESTS
// =============================================================================

describe('Combined V2 Features', () => {
  it('compiles pattern + subquery step + return', () => {
    const ast = new QueryAST()
      .addPattern({
        nodes: [
          { alias: 'u', labels: ['User'] },
          { alias: 'p', labels: ['Post'] },
        ],
        edges: [{ types: ['authored'], direction: 'out', from: 'u', to: 'p', optional: false }],
      })
      .addSubqueryStep({
        correlatedAliases: ['p'],
        steps: [
          {
            type: 'traversal',
            edges: ['likes'],
            direction: 'in',
            fromAlias: 'p',
            toAlias: 'liker',
            toLabels: [],
            optional: false,
            cardinality: 'many',
          },
        ],
        exportedAliases: ['liker'],
      })
      .addReturn({
        returns: [
          { kind: 'alias', alias: 'u', resultAlias: 'author' },
          { kind: 'alias', alias: 'p', resultAlias: 'post' },
          { kind: 'collect', sourceAlias: 'liker', resultAlias: 'likers' },
        ],
      })

    const result = compile(ast)

    expect(result.cypher).toContain('MATCH (u:User)-[:authored]->(p:Post)')
    expect(result.cypher).toContain('CALL {')
    expect(result.cypher).toContain('WITH p')
    expect(result.cypher).toContain('u AS author')
    expect(result.cypher).toContain('p AS post')
    expect(result.cypher).toContain('collect(liker) AS likers')
  })

  it('compiles match + unwind + where + return', () => {
    const ast = new QueryAST()
      .addMatch('Post')
      .addUnwind({ sourceAlias: 'n0', field: 'tags', itemAlias: 'tag' })
      .addWhere([
        { type: 'comparison', field: 'status', operator: 'eq', value: 'published', target: 'n0' },
      ])
      .addReturn({
        returns: [
          { kind: 'alias', alias: 'n0', resultAlias: 'post' },
          {
            kind: 'expression',
            expression: { type: 'field', alias: 'tag', field: 'tag' },
            resultAlias: 'tagName',
          },
        ],
      })

    const result = compile(ast)
    const cypher = normalizeCypher(result.cypher)

    expect(cypher).toContain('MATCH (n0:Post)')
    expect(cypher).toContain('UNWIND n0.tags AS tag')
    expect(cypher).toContain('n0.status = $p0')
    expect(cypher).toContain('n0 AS post')
  })

  it('compiles match + where with EXISTS + aliasComparison', () => {
    const ast = new QueryAST()
      .addMatch('User')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['Post'],
        cardinality: 'many',
      })
      .addWhere([
        {
          type: 'aliasComparison' as const,
          leftAlias: 'n0',
          leftField: 'createdAt',
          operator: 'lt' as const,
          rightAlias: 'n1',
          rightField: 'publishedAt',
        },
        {
          type: 'subquery' as const,
          mode: 'exists' as const,
          query: [
            {
              type: 'traversal' as const,
              edges: ['likes'],
              direction: 'in' as const,
              fromAlias: 'n1',
              toAlias: 'sq0',
              toLabels: [] as string[],
              optional: false,
              cardinality: 'many' as const,
            },
          ],
          correlatedAliases: ['n1'],
        },
      ])

    const result = compile(ast)

    expect(result.cypher).toContain('n0.createdAt < n1.publishedAt')
    expect(result.cypher).toContain('EXISTS {')
    expect(result.cypher).toContain('AND')
  })

  it('compiles pattern with variable-length edge and return step', () => {
    const ast = new QueryAST()
      .addPattern({
        nodes: [
          { alias: 'start', labels: ['Folder'] },
          { alias: 'end', labels: ['Folder'] },
        ],
        edges: [
          {
            types: ['hasParent'],
            direction: 'out',
            from: 'start',
            to: 'end',
            optional: false,
            variableLength: { min: 1, max: 10, uniqueness: 'nodes' },
          },
        ],
      })
      .addReturn({
        returns: [
          { kind: 'alias', alias: 'start', resultAlias: 'child' },
          { kind: 'alias', alias: 'end', resultAlias: 'ancestor' },
        ],
      })

    const result = compile(ast)

    expect(result.cypher).toContain('[:hasParent*1..10]')
    expect(result.cypher).toContain('start AS child')
    expect(result.cypher).toContain('end AS ancestor')
  })
})
