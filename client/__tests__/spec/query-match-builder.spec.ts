// @ts-nocheck
/**
 * MatchBuilder API Specification Tests
 *
 * Tests for the graph.match() entry point and MatchBuilder chaining methods.
 * Covers pattern compilation, WHERE, ordering, pagination, and cross-alias comparisons.
 */

import { describe, it, expect } from 'vitest'
import { createQueryBuilder } from '../../src'
import { testSchema, normalizeCypher } from './fixtures/test-schema'

const graph = createQueryBuilder(testSchema)

// =============================================================================
// BASIC MATCH QUERIES
// =============================================================================

describe('MatchBuilder: Basic Patterns', () => {
  it('simple two-node pattern', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user', b: 'post' },
        edges: [{ from: 'a', to: 'b', type: 'authored' }],
      })
      .compile()

    expect(compiled.cypher).toContain('MATCH')
    expect(compiled.cypher).toContain('User')
    expect(compiled.cypher).toContain('Post')
    expect(compiled.cypher).toContain('authored')
  })

  it('three-node chain', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user', b: 'post', c: 'category' },
        edges: [
          { from: 'a', to: 'b', type: 'authored' },
          { from: 'b', to: 'c', type: 'categorizedAs' },
        ],
      })
      .compile()

    expect(compiled.cypher).toContain('authored')
    expect(compiled.cypher).toContain('categorizedAs')
  })

  it('diamond pattern (4 nodes, 4 edges)', () => {
    const compiled = graph
      .match({
        nodes: { u: 'user', p: 'post', c: 'comment', cat: 'category' },
        edges: [
          { from: 'u', to: 'p', type: 'authored' },
          { from: 'u', to: 'c', type: 'writtenBy', direction: 'in' },
          { from: 'c', to: 'p', type: 'commentedOn' },
          { from: 'p', to: 'cat', type: 'categorizedAs' },
        ],
      })
      .compile()

    expect(compiled.cypher).toContain('authored')
    expect(compiled.cypher).toContain('writtenBy')
    expect(compiled.cypher).toContain('commentedOn')
    expect(compiled.cypher).toContain('categorizedAs')
  })

  it('single node (no edges)', () => {
    const compiled = graph
      .match({
        nodes: { u: 'user' },
        edges: [],
      })
      .compile()

    expect(compiled.cypher).toContain('User')
  })

  it('optional edge', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user', b: 'post' },
        edges: [{ from: 'a', to: 'b', type: 'authored', optional: true }],
      })
      .compile()

    expect(compiled.cypher).toContain('OPTIONAL MATCH')
  })

  it('incoming direction', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user', b: 'post' },
        edges: [{ from: 'a', to: 'b', type: 'authored', direction: 'in' }],
      })
      .compile()

    expect(compiled.cypher).toContain('<-')
  })
})

// =============================================================================
// NODE CONFIGS
// =============================================================================

describe('MatchBuilder: Node Config', () => {
  it('string label shorthand', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user' },
        edges: [],
      })
      .compile()

    expect(compiled.cypher).toContain('User')
  })

  it('object config with labels', () => {
    const compiled = graph
      .match({
        nodes: {
          a: { labels: ['user'] },
        },
        edges: [],
      })
      .compile()

    expect(compiled.cypher).toContain('User')
  })

  it('object config with id', () => {
    const compiled = graph
      .match({
        nodes: {
          a: { labels: ['user'], id: 'user_123' },
        },
        edges: [],
      })
      .compile()

    // ID is parameterized
    expect(compiled.cypher).toContain('{id:')
    expect(Object.values(compiled.params)).toContain('user_123')
  })

  it('object config with inline where', () => {
    const compiled = graph
      .match({
        nodes: {
          a: {
            labels: ['user'],
            where: [{ field: 'status', operator: 'eq', value: 'active' }],
          },
        },
        edges: [],
      })
      .compile()

    expect(compiled.cypher).toContain('status')
    expect(Object.values(compiled.params)).toContain('active')
  })
})

// =============================================================================
// WHERE
// =============================================================================

describe('MatchBuilder: where()', () => {
  it('single where condition', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user', b: 'post' },
        edges: [{ from: 'a', to: 'b', type: 'authored' }],
      })
      .where('a', 'status', 'eq', 'active')
      .compile()

    expect(compiled.cypher).toContain('status')
    expect(Object.values(compiled.params)).toContain('active')
  })

  it('chained where conditions', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user', b: 'post' },
        edges: [{ from: 'a', to: 'b', type: 'authored' }],
      })
      .where('a', 'status', 'eq', 'active')
      .where('b', 'viewCount', 'gt', 100)
      .compile()

    expect(compiled.cypher).toContain('status')
    expect(compiled.cypher).toContain('viewCount')
  })

  it('where on different aliases targets correct node', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user', b: 'post' },
        edges: [{ from: 'a', to: 'b', type: 'authored' }],
      })
      .where('b', 'title', 'contains', 'TypeGraph')
      .compile()

    // The condition should reference alias 'b'
    expect(compiled.cypher).toContain('b.title')
    expect(Object.values(compiled.params)).toContain('TypeGraph')
  })

  it('throws for unknown alias', () => {
    const builder = graph.match({
      nodes: { a: 'user' },
      edges: [],
    })

    expect(() => builder.where('z', 'name', 'eq', 'test')).toThrow('Unknown pattern alias: z')
  })
})

// =============================================================================
// whereAll
// =============================================================================

describe('MatchBuilder: whereAll()', () => {
  it('multiple conditions at once', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user', b: 'post' },
        edges: [{ from: 'a', to: 'b', type: 'authored' }],
      })
      .whereAll([
        ['a', 'status', 'eq', 'active'],
        ['b', 'viewCount', 'gt', 1000],
      ])
      .compile()

    expect(compiled.cypher).toContain('status')
    expect(compiled.cypher).toContain('viewCount')
  })

  it('throws for unknown alias in whereAll', () => {
    const builder = graph.match({
      nodes: { a: 'user' },
      edges: [],
    })

    expect(() => builder.whereAll([['x', 'name', 'eq', 'test']])).toThrow(
      'Unknown pattern alias: x',
    )
  })
})

// =============================================================================
// whereCompare
// =============================================================================

describe('MatchBuilder: whereCompare()', () => {
  it('cross-alias field comparison', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user', b: 'post' },
        edges: [{ from: 'a', to: 'b', type: 'authored' }],
      })
      .whereCompare('a', 'createdAt', 'lt', 'b', 'publishedAt')
      .compile()

    // Should contain alias.field comparison
    expect(compiled.cypher).toContain('a.createdAt')
    expect(compiled.cypher).toContain('b.publishedAt')
  })

  it('throws for unknown left alias', () => {
    const builder = graph.match({
      nodes: { a: 'user' },
      edges: [],
    })

    expect(() => builder.whereCompare('x', 'name', 'eq', 'a', 'name')).toThrow(
      'Unknown pattern alias: x',
    )
  })

  it('throws for unknown right alias', () => {
    const builder = graph.match({
      nodes: { a: 'user' },
      edges: [],
    })

    expect(() => builder.whereCompare('a', 'name', 'eq', 'y', 'name')).toThrow(
      'Unknown pattern alias: y',
    )
  })
})

// =============================================================================
// ORDERING & PAGINATION
// =============================================================================

describe('MatchBuilder: ordering & pagination', () => {
  it('orderBy', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user' },
        edges: [],
      })
      .orderBy('a', 'name', 'ASC')
      .compile()

    expect(compiled.cypher).toContain('ORDER BY')
    expect(compiled.cypher).toContain('name')
  })

  it('orderBy throws for unknown alias', () => {
    const builder = graph.match({
      nodes: { a: 'user' },
      edges: [],
    })

    expect(() => builder.orderBy('z', 'name')).toThrow('Unknown pattern alias: z')
  })

  it('limit', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user' },
        edges: [],
      })
      .limit(10)
      .compile()

    expect(compiled.cypher).toContain('LIMIT')
  })

  it('skip', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user' },
        edges: [],
      })
      .skip(5)
      .compile()

    expect(compiled.cypher).toContain('SKIP')
  })

  it('orderBy + skip + limit chain', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user', b: 'post' },
        edges: [{ from: 'a', to: 'b', type: 'authored' }],
      })
      .orderBy('b', 'viewCount', 'DESC')
      .skip(10)
      .limit(5)
      .compile()

    expect(compiled.cypher).toContain('ORDER BY')
    expect(compiled.cypher).toContain('SKIP')
    expect(compiled.cypher).toContain('LIMIT')
  })
})

// =============================================================================
// COMPILATION & INSPECTION
// =============================================================================

describe('MatchBuilder: compile & inspect', () => {
  it('compile returns cypher and params', () => {
    const compiled = graph
      .match({
        nodes: { a: 'user' },
        edges: [],
      })
      .where('a', 'status', 'eq', 'active')
      .compile()

    expect(compiled).toHaveProperty('cypher')
    expect(compiled).toHaveProperty('params')
    expect(typeof compiled.cypher).toBe('string')
    expect(typeof compiled.params).toBe('object')
  })

  it('toCypher returns just the string', () => {
    const cypher = graph
      .match({
        nodes: { a: 'user' },
        edges: [],
      })
      .toCypher()

    expect(typeof cypher).toBe('string')
    expect(cypher).toContain('User')
  })

  it('toParams returns just the params', () => {
    const params = graph
      .match({
        nodes: { a: 'user' },
        edges: [],
      })
      .where('a', 'name', 'eq', 'alice')
      .toParams()

    expect(Object.values(params)).toContain('alice')
  })

  it('toAST returns the AST', () => {
    const ast = graph
      .match({
        nodes: { a: 'user' },
        edges: [],
      })
      .toAST()

    expect(ast).toBeDefined()
    expect(ast.steps.length).toBeGreaterThan(0)
  })

  it('ast getter returns the AST', () => {
    const builder = graph.match({
      nodes: { a: 'user' },
      edges: [],
    })

    expect(builder.ast).toBeDefined()
    expect(builder.ast.steps.length).toBeGreaterThan(0)
  })
})

// =============================================================================
// EXECUTION (compile-only mode)
// =============================================================================

describe('MatchBuilder: execution errors', () => {
  it('execute() throws without executor', async () => {
    const builder = graph.match({
      nodes: { a: 'user' },
      edges: [],
    })

    await expect(builder.execute()).rejects.toThrow('no query executor')
  })

  it('executeFirst() throws without executor', async () => {
    const builder = graph.match({
      nodes: { a: 'user' },
      edges: [],
    })

    await expect(builder.executeFirst()).rejects.toThrow('no query executor')
  })

  it('count() throws without executor', async () => {
    const builder = graph.match({
      nodes: { a: 'user' },
      edges: [],
    })

    await expect(builder.count()).rejects.toThrow('no query executor')
  })
})

// =============================================================================
// IMMUTABILITY
// =============================================================================

describe('MatchBuilder: immutability', () => {
  it('where() returns new builder (does not mutate original)', () => {
    const original = graph.match({
      nodes: { a: 'user' },
      edges: [],
    })

    const filtered = original.where('a', 'name', 'eq', 'test')

    // Different compiled output
    expect(original.toCypher()).not.toEqual(filtered.toCypher())
  })

  it('limit() returns new builder', () => {
    const original = graph.match({
      nodes: { a: 'user' },
      edges: [],
    })

    const limited = original.limit(5)
    expect(original.toCypher()).not.toEqual(limited.toCypher())
  })
})

// =============================================================================
// COMPLEX REAL-WORLD PATTERNS
// =============================================================================

describe('MatchBuilder: complex patterns', () => {
  it('user-post-category triangle', () => {
    const compiled = graph
      .match({
        nodes: { u: 'user', p: 'post', c: 'category' },
        edges: [
          { from: 'u', to: 'p', type: 'authored' },
          { from: 'p', to: 'c', type: 'categorizedAs' },
        ],
      })
      .where('u', 'status', 'eq', 'active')
      .where('c', 'name', 'eq', 'TypeGraph')
      .orderBy('p', 'viewCount', 'DESC')
      .limit(10)
      .compile()

    expect(compiled.cypher).toContain('authored')
    expect(compiled.cypher).toContain('categorizedAs')
    expect(compiled.cypher).toContain('ORDER BY')
    expect(compiled.cypher).toContain('LIMIT')
  })

  it('mixed required and optional edges', () => {
    const compiled = graph
      .match({
        nodes: { u: 'user', p: 'post', c: 'comment' },
        edges: [
          { from: 'u', to: 'p', type: 'authored' },
          { from: 'c', to: 'p', type: 'commentedOn', optional: true },
        ],
      })
      .compile()

    expect(compiled.cypher).toContain('authored')
    expect(compiled.cypher).toContain('OPTIONAL MATCH')
    expect(compiled.cypher).toContain('commentedOn')
  })

  it('edge with alias', () => {
    const compiled = graph
      .match({
        nodes: { u: 'user', p: 'post' },
        edges: [{ from: 'u', to: 'p', type: 'authored', as: 'rel' }],
      })
      .compile()

    // Edge alias should appear in the Cypher
    expect(compiled.cypher).toContain('authored')
  })

  it('kernel-like findChildByType pattern', () => {
    const compiled = graph
      .match({
        nodes: { parent: 'folder', child: 'folder' },
        edges: [{ from: 'child', to: 'parent', type: 'hasParent' }],
      })
      .where('parent', 'id', 'eq', 'root_folder')
      .where('child', 'name', 'eq', 'important')
      .compile()

    expect(compiled.cypher).toContain('hasParent')
    expect(Object.values(compiled.params)).toContain('root_folder')
    expect(Object.values(compiled.params)).toContain('important')
  })

  it('snapshot: complex pattern', () => {
    const compiled = graph
      .match({
        nodes: { u: 'user', p: 'post', c: 'category' },
        edges: [
          { from: 'u', to: 'p', type: 'authored' },
          { from: 'p', to: 'c', type: 'categorizedAs' },
        ],
      })
      .where('u', 'status', 'eq', 'active')
      .limit(5)
      .compile()

    expect(compiled).toMatchSnapshot()
  })
})
