/**
 * AST Builder Tests - High Signal Only
 *
 * ~22 focused tests covering:
 * - Immutability invariants (critical for functional builder pattern)
 * - Alias collision prevention (counter management, unique prefixes)
 * - Complex query patterns (multi-hop, hierarchy, branching, forks)
 * - Projection validation (rejects invalid aliases)
 * - Serialization round-trip
 */

import { describe, it, expect } from 'vitest'
import { QueryAST } from '../src/ast/builder'
import type { WhereCondition } from '../src/ast/types'

// =============================================================================
// IMMUTABILITY INVARIANTS
// =============================================================================

describe('Immutability Invariants', () => {
  it('addMatch returns new instance, original unchanged', () => {
    const original = new QueryAST()
    const modified = original.addMatch('user')

    expect(modified).not.toBe(original)
    expect(original.steps).toHaveLength(0)
    expect(modified.steps).toHaveLength(1)
  })

  it('chained operations preserve intermediate states', () => {
    const ast1 = new QueryAST()
    const ast2 = ast1.addMatch('user')
    const ast3 = ast2.addWhere([
      { type: 'comparison', target: 'n0', field: 'active', operator: 'eq', value: true },
    ])
    const ast4 = ast3.addTraversal({
      edges: ['follows'],
      direction: 'out',
      toLabels: ['user'],
      cardinality: 'many',
    })

    // Each intermediate state must be preserved (functional immutability)
    expect(ast1.steps).toHaveLength(0)
    expect(ast2.steps).toHaveLength(1)
    expect(ast3.steps).toHaveLength(2)
    expect(ast4.steps).toHaveLength(3)
  })

  it('steps array is frozen and cannot be mutated', () => {
    const ast = new QueryAST().addMatch('user')

    expect(() => {
      ;(ast.steps as unknown[]).push({ type: 'match', label: 'hacked', alias: 'x' })
    }).toThrow()
  })

  it('alias maps are independent between instances', () => {
    const ast1 = new QueryAST().addMatch('user').addUserAlias('u')
    const ast2 = ast1.addMatch('post').addUserAlias('p')

    // ast1 should not have 'p' alias (isolation)
    expect(ast1.userAliases.has('u')).toBe(true)
    expect(ast1.userAliases.has('p')).toBe(false)

    // ast2 should have both
    expect(ast2.userAliases.has('u')).toBe(true)
    expect(ast2.userAliases.has('p')).toBe(true)
  })
})

// =============================================================================
// ALIAS COLLISION PREVENTION
// =============================================================================

describe('Alias Collision Prevention', () => {
  it('generates unique node aliases across operations', () => {
    const ast = new QueryAST()
      .addMatch('user') // n0
      .addMatch('post') // n1
      .addMatch('comment') // n2

    const aliases = Array.from(ast.aliases.keys())
    expect(aliases).toContain('n0')
    expect(aliases).toContain('n1')
    expect(aliases).toContain('n2')
    expect(new Set(aliases).size).toBe(aliases.length) // All unique
  })

  it('generates unique edge aliases during traversal', () => {
    const ast = new QueryAST()
      .addMatch('user')
      .addTraversal({
        edges: ['follows'],
        direction: 'out',
        toLabels: ['user'],
        cardinality: 'many',
      })
      .addTraversal({
        edges: ['likes'],
        direction: 'out',
        toLabels: ['post'],
        cardinality: 'many',
      })

    const edgeAliases = Array.from(ast.aliases.entries())
      .filter(([_, info]) => info.type === 'edge')
      .map(([alias]) => alias)

    expect(edgeAliases.length).toBeGreaterThanOrEqual(2)
    expect(new Set(edgeAliases).size).toBe(edgeAliases.length) // All unique
  })

  it('withAliasOffset creates offset counters for parallel branches', () => {
    const ast = new QueryAST().addMatch('user') // counter at 1

    const branch1 = ast.withAliasOffset(0).addMatch('post') // n1
    const branch2 = ast.withAliasOffset(100).addMatch('post') // n101

    expect(branch1.currentAlias).toBe('n1')
    expect(branch2.currentAlias).toBe('n101')
  })
})

// =============================================================================
// USER ALIAS MANAGEMENT
// =============================================================================

describe('User Alias Management', () => {
  it('maps user alias to current internal alias', () => {
    const ast = new QueryAST().addMatch('user').addUserAlias('myUser')

    expect(ast.resolveUserAlias('myUser')).toBe('n0')
  })

  it('tracks edge user aliases separately from node aliases', () => {
    const ast = new QueryAST().addMatch('user').addTraversal({
      edges: ['follows'],
      direction: 'out',
      toLabels: ['user'],
      cardinality: 'many',
      edgeUserAlias: 'followEdge',
    })

    // Edge alias resolves to internal edge alias (e-prefixed)
    const resolvedEdgeAlias = ast.resolveEdgeUserAlias('followEdge')
    expect(resolvedEdgeAlias).toMatch(/^e\d+$/)

    // Registered in edge aliases
    expect(ast.getRegisteredEdgeUserAliases()).toContain('followEdge')

    // Not in node aliases
    expect(ast.getRegisteredUserAliases()).not.toContain('followEdge')
  })
})

// =============================================================================
// COMPLEX QUERY PATTERNS
// =============================================================================

describe('Complex Query Patterns', () => {
  it('builds multi-hop user -> posts -> comments chain', () => {
    const ast = new QueryAST()
      .addMatch('user')
      .addUserAlias('author')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['post'],
        cardinality: 'many',
      })
      .addUserAlias('post')
      .addTraversal({
        edges: ['hasComment'],
        direction: 'in',
        toLabels: ['comment'],
        cardinality: 'many',
      })
      .addUserAlias('comment')

    // match + alias + traversal + alias + traversal + alias = 6 steps
    expect(ast.steps).toHaveLength(6)
    expect(ast.resolveUserAlias('author')).toBe('n0')
    expect(ast.resolveUserAlias('post')).toBe('n1')
    expect(ast.resolveUserAlias('comment')).toBeDefined()

    // All user aliases map to different internal aliases
    const authorInternal = ast.resolveUserAlias('author')
    const postInternal = ast.resolveUserAlias('post')
    const commentInternal = ast.resolveUserAlias('comment')
    expect(new Set([authorInternal, postInternal, commentInternal]).size).toBe(3)
  })

  it('builds variable-length path traversal with uniqueness constraint', () => {
    const ast = new QueryAST().addMatch('user').addTraversal({
      edges: ['follows'],
      direction: 'out',
      toLabels: ['user'],
      cardinality: 'many',
      variableLength: {
        min: 1,
        max: 6,
        uniqueness: 'nodes',
      },
    })

    const traversalStep = ast.steps.find((s) => s.type === 'traversal')
    expect(traversalStep).toBeDefined()
    if (traversalStep?.type === 'traversal') {
      expect(traversalStep.variableLength?.min).toBe(1)
      expect(traversalStep.variableLength?.max).toBe(6)
      expect(traversalStep.variableLength?.uniqueness).toBe('nodes')
    }
  })

  it('builds hierarchy ancestors query with depth tracking', () => {
    const ast = new QueryAST().addMatch('folder').addHierarchy({
      operation: 'ancestors',
      edge: 'hasParent',
      hierarchyDirection: 'up',
      maxDepth: 10,
      includeDepth: true,
    })

    const hierarchyStep = ast.steps.find((s) => s.type === 'hierarchy')
    if (hierarchyStep?.type === 'hierarchy') {
      expect(hierarchyStep.operation).toBe('ancestors')
      expect(hierarchyStep.maxDepth).toBe(10)
      expect(hierarchyStep.includeDepth).toBe(true)
    }
  })

  it('builds union branch combining two filtered queries', () => {
    const admins = new QueryAST()
      .addMatch('user')
      .addWhere([
        { type: 'comparison', target: 'n0', field: 'role', operator: 'eq', value: 'admin' },
      ])

    const verified = new QueryAST()
      .addMatch('user')
      .addWhere([
        { type: 'comparison', target: 'n0', field: 'verified', operator: 'eq', value: true },
      ])

    const ast = new QueryAST().addBranch({
      operator: 'union',
      branches: [admins, verified],
      distinct: true,
    })

    const branchStep = ast.steps.find((s) => s.type === 'branch')
    if (branchStep?.type === 'branch') {
      expect(branchStep.operator).toBe('union')
      expect(branchStep.branches).toHaveLength(2)
      expect(branchStep.distinct).toBe(true)
    }
  })

  it('fork merges alias counters to prevent collisions', () => {
    const base = new QueryAST().addMatch('user') // counter = 1

    // Branch with high counter
    const branch = new QueryAST()
      .addMatch('a')
      .addMatch('b')
      .addMatch('c')
      .addMatch('d')
      .addMatch('e') // counter = 5

    const ast = base.addFork([branch])

    // After fork, counter must be >= 5 to prevent future collisions
    expect(ast.aliasCounter).toBeGreaterThanOrEqual(5)
  })

  it('fork merges user aliases from all branches', () => {
    const base = new QueryAST().addMatch('user').addUserAlias('u')

    const postsPath = new QueryAST()
      .addMatch('user')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['post'],
        cardinality: 'many',
      })
      .addUserAlias('posts')

    const followersPath = new QueryAST()
      .addMatch('user')
      .addTraversal({
        edges: ['follows'],
        direction: 'in',
        toLabels: ['user'],
        cardinality: 'many',
      })
      .addUserAlias('followers')

    const ast = base.addFork([postsPath, followersPath])

    // Fork should merge user aliases from all branches
    expect(ast.userAliases.has('u')).toBe(true)
    expect(ast.userAliases.has('posts')).toBe(true)
    expect(ast.userAliases.has('followers')).toBe(true)
  })
})

// =============================================================================
// WHERE CONDITIONS
// =============================================================================

describe('Where Conditions', () => {
  it('handles comparison conditions with multiple operators', () => {
    const conditions: WhereCondition[] = [
      { type: 'comparison', target: 'n0', field: 'age', operator: 'gte', value: 18 },
      { type: 'comparison', target: 'n0', field: 'status', operator: 'eq', value: 'active' },
    ]

    const ast = new QueryAST().addMatch('user').addWhere(conditions)

    const whereStep = ast.steps.find((s) => s.type === 'where')
    if (whereStep?.type === 'where') {
      expect(whereStep.conditions).toHaveLength(2)
      expect(whereStep.conditions[0]?.type).toBe('comparison')
      expect(whereStep.conditions[1]?.type).toBe('comparison')
    }
  })

  it('handles nested logical conditions (AND/OR)', () => {
    const conditions: WhereCondition[] = [
      {
        type: 'logical',
        operator: 'OR',
        conditions: [
          { type: 'comparison', target: 'n0', field: 'role', operator: 'eq', value: 'admin' },
          { type: 'comparison', target: 'n0', field: 'verified', operator: 'eq', value: true },
        ],
      },
    ]

    const ast = new QueryAST().addMatch('user').addWhere(conditions)

    const whereStep = ast.steps.find((s) => s.type === 'where')
    if (whereStep?.type === 'where' && whereStep.conditions[0]?.type === 'logical') {
      expect(whereStep.conditions[0].operator).toBe('OR')
      expect(whereStep.conditions[0].conditions).toHaveLength(2)
    }
  })

  it('handles exists and connectedTo conditions', () => {
    const conditions: WhereCondition[] = [
      { type: 'exists', target: 'n0', edge: 'profilePicture', direction: 'out', negated: false },
      {
        type: 'connectedTo',
        target: 'n0',
        edge: 'belongsTo',
        direction: 'out',
        nodeId: 'tenant-123',
      },
    ]

    const ast = new QueryAST().addMatch('user').addWhere(conditions)

    const whereStep = ast.steps.find((s) => s.type === 'where')
    if (whereStep?.type === 'where') {
      expect(whereStep.conditions[0]?.type).toBe('exists')
      expect(whereStep.conditions[1]?.type).toBe('connectedTo')
      if (whereStep.conditions[1]?.type === 'connectedTo') {
        expect(whereStep.conditions[1].nodeId).toBe('tenant-123')
      }
    }
  })
})

// =============================================================================
// PROJECTION VALIDATION
// =============================================================================

describe('Projection Validation', () => {
  it('sets multi-node projection with valid aliases', () => {
    const ast = new QueryAST()
      .addMatch('user')
      .addUserAlias('u')
      .addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['post'],
        cardinality: 'many',
      })
      .addUserAlias('p')
      .setMultiNodeProjection(['u', 'p'])

    expect(ast.projection.type).toBe('multiNode')
    expect(ast.projection.nodeAliases).toEqual(['u', 'p'])
  })

  it('rejects multi-node projection with unknown node alias', () => {
    const ast = new QueryAST().addMatch('user').addUserAlias('u')

    expect(() => ast.setMultiNodeProjection(['u', 'unknown'])).toThrow(/Unknown node alias/)
  })

  it('rejects multi-node projection with unknown edge alias', () => {
    const ast = new QueryAST().addMatch('user').addUserAlias('u')

    expect(() => ast.setMultiNodeProjection(['u'], ['unknownEdge'])).toThrow(/Unknown edge alias/)
  })
})

// =============================================================================
// SERIALIZATION
// =============================================================================

describe('Serialization', () => {
  it('toJSON produces complete serializable output', () => {
    const ast = new QueryAST()
      .addMatch('user')
      .addUserAlias('u')
      .addTraversal({
        edges: ['follows'],
        direction: 'out',
        toLabels: ['user'],
        cardinality: 'many',
        edgeUserAlias: 'f',
      })
      .addUserAlias('friend')

    const json = ast.toJSON()

    expect(json).toHaveProperty('steps')
    expect(json).toHaveProperty('projection')
    expect(json).toHaveProperty('aliases')
    expect(json).toHaveProperty('userAliases')
    expect(json).toHaveProperty('edgeUserAliases')

    // Must be JSON-serializable (no circular refs, no functions)
    expect(() => JSON.stringify(json)).not.toThrow()
  })

  it('toJSON preserves all step data for reconstruction', () => {
    const ast = new QueryAST()
      .addMatch('user')
      .addWhere([
        { type: 'comparison', target: 'n0', field: 'active', operator: 'eq', value: true },
      ])
      .addLimit(10)

    const json = ast.toJSON() as { steps: unknown[] }

    expect(json.steps).toHaveLength(3)
    expect(json.steps[0]).toMatchObject({ type: 'match', label: 'user' })
    expect(json.steps[1]).toMatchObject({ type: 'where' })
    expect(json.steps[2]).toMatchObject({ type: 'limit', count: 10 })
  })
})
