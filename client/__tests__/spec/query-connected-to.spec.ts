/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Query Compilation Specification - whereConnectedTo
 *
 * Tests for the whereConnectedTo/whereConnectedFrom filtering operations.
 *
 * Since v2, whereConnectedTo/whereConnectedFrom are internally migrated to
 * whereExists/whereNotExists, then the compiler applies the ConnectedTo
 * optimization: simple id-check subqueries compile to inline MATCH patterns
 * like (n0)-[:edge]->({id: $p0}) instead of full EXISTS { ... } subqueries.
 */

import { describe, it, expect } from 'vitest'

import { createQueryBuilder } from '../../src'
import { testSchema, normalizeCypher } from './fixtures/test-schema'

// Create a query builder for compilation testing (no executor needed)
const graph = createQueryBuilder(testSchema)

describe('Query Compilation: whereConnectedTo', () => {
  // ===========================================================================
  // BASIC BEHAVIOR
  // ===========================================================================

  describe('Basic Behavior', () => {
    it('compiles single whereConnectedTo', () => {
      const compiled = graph.node('post').whereConnectedTo('categorizedAs', 'cat_123').compile()

      expect(compiled.cypher).toContain('MATCH (n0:Post)')
      // Optimized inline pattern instead of EXISTS subquery
      expect(compiled.cypher).toContain('categorizedAs')
      expect(compiled.cypher).toContain('->({id:')
      expect(compiled.params).toHaveProperty('p0', 'cat_123')
    })

    it('compiles chained whereConnectedTo filters', () => {
      // Real-world use case: find posts in a category by a specific author
      const compiled = graph
        .node('post')
        .whereConnectedTo('categorizedAs', 'cat_123')
        .from('authored') // Get the author
        .where('id', 'eq', 'user_456')
        .compile()

      expect(compiled.cypher).toContain('categorizedAs')
      expect(compiled.cypher).toContain('authored')
    })
  })

  // ===========================================================================
  // OPTIMIZED INLINE PATTERN COMPILATION
  // ===========================================================================

  describe('Optimized Inline Pattern Compilation', () => {
    it('should compile whereConnectedTo as inline pattern', () => {
      const compiled = graph.node('post').whereConnectedTo('categorizedAs', 'cat_123').compile()

      // v2 + optimization: Uses inline (n)-[:edge]->({id: $p}) pattern
      expect(compiled.cypher).toMatch(/\(n0\)-\[:categorizedAs\]->\(\{id: \$p0\}\)/)
      expect(compiled.params.p0).toBe('cat_123')
    })

    it('should compile whereConnectedFrom as inline pattern with incoming direction', () => {
      const compiled = graph.node('user').whereConnectedFrom('authored', 'post_123').compile()

      // Incoming edge direction: <-[:edge]-
      expect(compiled.cypher).toContain('<-[:authored]-')
      expect(compiled.cypher).toContain('{id:')
    })

    it('should compile multiple whereConnectedTo as AND-ed inline patterns', () => {
      const compiled = graph
        .node('folder')
        .whereConnectedTo('hasParent', 'parent_123')
        .whereConnectedTo('owns', 'owner_456')
        .compile()

      // Both should appear as inline patterns in a single WHERE clause
      expect(compiled.cypher).toContain('hasParent')
      expect(compiled.cypher).toContain('owns')
      expect(compiled.cypher).toContain('AND')
      expect(compiled.params.p0).toBe('parent_123')
      expect(compiled.params.p1).toBe('owner_456')
    })
  })

  // ===========================================================================
  // REAL-WORLD KERNEL USE CASES
  // ===========================================================================

  describe('Real-world Kernel Use Cases', () => {
    it('findChildByType: modules with specific parent AND type', () => {
      const compiled = graph
        .node('post')
        .whereConnectedTo('categorizedAs', 'cat_tech')
        .where('viewCount', 'gt', 100)
        .compile()

      expect(compiled.cypher).toContain('categorizedAs')
      expect(compiled.cypher).toContain('viewCount')
    })

    it('listByType: all descendants of root with specific type', () => {
      const compiled = graph
        .node('folder')
        .byId('root_folder')
        .descendants()
        .whereConnectedTo('hasParent', 'some_parent')
        .compile()

      expect(compiled.cypher).toContain('hasParent')
    })

    it('combined: byId + whereConnectedTo', () => {
      const compiled = graph
        .node('user')
        .byId('user_123')
        .to('authored')
        .whereConnectedTo('categorizedAs', 'cat_tech')
        .compile()

      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toContain('categorizedAs')
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('Edge Cases', () => {
    it('handles whereConnectedTo on collection (not single node)', () => {
      const compiled = graph
        .node('post')
        .where('viewCount', 'gt', 1000)
        .whereConnectedTo('categorizedAs', 'cat_popular')
        .compile()

      expect(compiled.cypher).toContain('viewCount')
      expect(compiled.cypher).toContain('categorizedAs')
    })

    it('handles whereConnectedTo after traversal', () => {
      const compiled = graph
        .node('user')
        .byId('user_123')
        .to('authored')
        .whereConnectedTo('categorizedAs', 'cat_tech')
        .compile()

      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toContain('categorizedAs')
    })

    it('handles multiple different edge types', () => {
      const compiled = graph
        .node('post')
        .whereConnectedTo('categorizedAs', 'cat_123')
        .from('authored')
        .compile()

      expect(compiled.cypher).toContain('categorizedAs')
      expect(compiled.cypher).toContain('authored')
    })
  })

  // ===========================================================================
  // COMPILATION VERIFICATION
  // ===========================================================================

  describe('Compilation Verification', () => {
    it('should use inline pattern for optimized whereConnectedTo', () => {
      const compiled = graph.node('post').whereConnectedTo('categorizedAs', 'cat_123').compile()

      // Uses inline anonymous node pattern: ->({id: $p0})
      expect(compiled.cypher).toContain('->({id:')
    })

    it('should use inline pattern for whereConnectedTo', () => {
      const compiled = graph.node('post').whereConnectedTo('categorizedAs', 'cat_123').compile()

      expect(compiled.cypher).toMatch(/\(n0\)-\[:categorizedAs\]->\(\{id: \$p0\}\)/)
    })

    it('should handle multiple whereConnectedTo as combined WHERE patterns', () => {
      const compiled = graph
        .node('folder')
        .whereConnectedTo('hasParent', 'parent_123')
        .whereConnectedTo('owns', 'owner_456')
        .compile()

      // Should have 2 inline patterns ANDed in WHERE
      const inlinePatternCount = (compiled.cypher.match(/\{id: \$p\d+\}/g) || []).length
      expect(inlinePatternCount).toBe(2)
    })
  })
})

// ===========================================================================
// COMPILATION SNAPSHOTS
// ===========================================================================

describe('Compilation Snapshots', () => {
  it('snapshot: simple whereConnectedTo', () => {
    const compiled = graph.node('post').whereConnectedTo('categorizedAs', 'cat_123').compile()

    expect(compiled).toMatchSnapshot()
  })

  it('snapshot: chained whereConnectedTo', () => {
    const compiled = graph
      .node('folder')
      .whereConnectedTo('hasParent', 'parent_123')
      .where('name', 'eq', 'test')
      .compile()

    expect(compiled).toMatchSnapshot()
  })

  it('snapshot: whereConnectedFrom', () => {
    const compiled = graph
      .node('category')
      .whereConnectedFrom('categorizedAs', 'post_123')
      .compile()

    expect(compiled).toMatchSnapshot()
  })
})

// ===========================================================================
// COMPLEX MULTI-CONSTRAINT QUERIES
// ===========================================================================

describe('Complex Multi-Constraint Queries', () => {
  it('handles 3 whereConnectedTo constraints', () => {
    const compiled = graph
      .node('post')
      .whereConnectedTo('categorizedAs', 'cat_tech')
      .whereConnectedTo('categorizedAs', 'cat_featured')
      .whereConnectedTo('likes', 'user_curator')
      .compile()

    // Should have 3 inline patterns
    const patternCount = (compiled.cypher.match(/\{id: \$p\d+\}/g) || []).length
    expect(patternCount).toBe(3)

    // All params should be present
    expect(compiled.params.p0).toBe('cat_tech')
    expect(compiled.params.p1).toBe('cat_featured')
    expect(compiled.params.p2).toBe('user_curator')
  })

  it('handles 5 whereConnectedTo constraints', () => {
    const compiled = graph
      .node('post')
      .whereConnectedTo('categorizedAs', 'cat_1')
      .whereConnectedTo('categorizedAs', 'cat_2')
      .whereConnectedTo('categorizedAs', 'cat_3')
      .whereConnectedTo('likes', 'user_1')
      .whereConnectedTo('likes', 'user_2')
      .compile()

    // Should have 5 inline patterns
    const patternCount = (compiled.cypher.match(/\{id: \$p\d+\}/g) || []).length
    expect(patternCount).toBe(5)

    // All 5 params should be present
    expect(Object.keys(compiled.params)).toHaveLength(5)
  })

  it('handles mixed whereConnectedTo and whereConnectedFrom', () => {
    const compiled = graph
      .node('post')
      .whereConnectedTo('categorizedAs', 'cat_tech')
      .whereConnectedFrom('authored', 'user_author')
      .whereConnectedFrom('likes', 'user_fan')
      .compile()

    // Check both directions are present
    expect(compiled.cypher).toContain('->') // outgoing
    expect(compiled.cypher).toContain('<-') // incoming
  })

  it('handles whereConnectedTo with property filters interleaved', () => {
    const compiled = graph
      .node('post')
      .where('viewCount', 'gt', 1000)
      .whereConnectedTo('categorizedAs', 'cat_tech')
      .where('title', 'contains', 'Guide')
      .whereConnectedTo('likes', 'user_influencer')
      .where('publishedAt', 'isNotNull')
      .compile()

    // Should have 2 inline patterns
    const patternCount = (compiled.cypher.match(/\{id: \$p\d+\}/g) || []).length
    expect(patternCount).toBe(2)

    // Property conditions should also be present
    expect(compiled.cypher).toContain('viewCount')
    expect(compiled.cypher).toContain('title')
    expect(compiled.cypher).toContain('publishedAt')
  })

  it('handles complex query after traversal', () => {
    const compiled = graph
      .node('user')
      .byId('user_123')
      .to('authored')
      .whereConnectedTo('categorizedAs', 'cat_tech')
      .whereConnectedTo('categorizedAs', 'cat_tutorial')
      .where('viewCount', 'gt', 500)
      .compile()

    expect(compiled.cypher).toContain('MATCH (n0:User)')
    expect(compiled.cypher).toContain('authored')
    expect(compiled.cypher).toContain('categorizedAs')
  })

  it('handles whereConnectedTo on descendants', () => {
    const compiled = graph
      .node('folder')
      .byId('root_folder')
      .descendants()
      .whereConnectedTo('hasParent', 'special_parent')
      .whereConnectedTo('owns', 'special_owner')
      .compile()

    // Should have hierarchy traversal + inline patterns
    expect(compiled.cypher).toContain('hasParent*')
    expect(compiled.cypher).toContain('{id:')
  })

  it('generates valid Cypher for kernel-like query pattern', () => {
    const compiled = graph
      .node('folder')
      .whereConnectedTo('hasParent', 'parent_module_id')
      .whereConnectedTo('owns', 'owner_user_id')
      .where('name', 'eq', 'important')
      .compile()

    // The query should be well-formed
    expect(compiled.cypher).not.toContain('undefined')
    expect(compiled.cypher).not.toContain('null')

    // Params should match constraints
    expect(compiled.params.p0).toBe('parent_module_id')
    expect(compiled.params.p1).toBe('owner_user_id')
    expect(compiled.params.p2).toBe('important')
  })
})

describe('Complex Interleaved Chains', () => {
  it('traversal -> whereConnectedTo -> traversal -> whereConnectedTo', () => {
    const compiled = graph
      .node('user')
      .byId('user_123')
      .to('authored') // -> posts
      .whereConnectedTo('categorizedAs', 'cat_tech') // posts in tech category
      .from('commentedOn') // -> comments on those posts
      .whereConnectedTo('writtenBy', 'commenter_456') // comments by specific user
      .compile()

    expect(compiled.cypher).toContain('authored')
    expect(compiled.cypher).toContain('commentedOn')
    expect(compiled.cypher).toContain('categorizedAs')
    expect(compiled.cypher).toContain('writtenBy')
  })

  it('whereConnectedTo -> traversal -> whereConnectedTo -> traversal', () => {
    const compiled = graph
      .node('post')
      .whereConnectedTo('categorizedAs', 'cat_featured') // featured posts
      .from('authored') // -> authors of featured posts
      .whereConnectedTo('memberOf', 'org_acme') // authors in ACME org
      .to('follows') // -> who those authors follow
      .compile()

    expect(compiled.cypher).toContain('categorizedAs')
    expect(compiled.cypher).toContain('authored')
    expect(compiled.cypher).toContain('memberOf')
    expect(compiled.cypher).toContain('follows')
  })

  it('byId -> to -> whereConnectedTo -> from -> to -> whereConnectedTo', () => {
    const compiled = graph
      .node('user')
      .byId('seed_user')
      .to('authored') // user's posts
      .whereConnectedTo('categorizedAs', 'cat_1') // in category 1
      .from('likes') // users who liked those posts
      .to('memberOf') // organizations they belong to
      .whereConnectedTo('categoryParent', 'parent_org') // orgs under parent
      .compile()

    expect(compiled.cypher).toContain('authored')
    expect(compiled.cypher).toContain('categorizedAs')
    expect(compiled.cypher).toContain('likes')
    expect(compiled.cypher).toContain('memberOf')
  })

  it('multiple whereConnectedTo at different traversal depths', () => {
    const compiled = graph
      .node('user')
      .byId('root_user')
      .whereConnectedTo('memberOf', 'org_1') // constraint on user
      .to('authored')
      .whereConnectedTo('categorizedAs', 'cat_1') // constraint on posts
      .whereConnectedTo('likes', 'influencer_1') // another constraint on posts
      .from('commentedOn')
      .whereConnectedTo('writtenBy', 'trusted_user') // constraint on comments
      .compile()

    // Should have constraints on different node aliases
    expect(compiled.params.p0).toBe('root_user')
    expect(compiled.params.p1).toBe('org_1')
    expect(compiled.params.p2).toBe('cat_1')
  })

  it('hierarchy traversal with whereConnectedTo at multiple levels', () => {
    const compiled = graph
      .node('folder')
      .byId('start_folder')
      .whereConnectedTo('owns', 'owner_1') // owner of start folder
      .ancestors() // go up the tree
      .whereConnectedTo('owns', 'ancestor_owner') // ancestors owned by specific user
      .compile()

    expect(compiled.cypher).toContain('{id:')
  })

  it('via (bidirectional) with whereConnectedTo', () => {
    const compiled = graph
      .node('user')
      .byId('user_1')
      .via('follows') // followers/following
      .whereConnectedTo('memberOf', 'same_org') // in same org
      .to('authored')
      .whereConnectedTo('categorizedAs', 'shared_interest')
      .compile()

    expect(compiled.cypher).toContain('follows')
    expect(compiled.cypher).toContain('memberOf')
    expect(compiled.cypher).toContain('categorizedAs')
  })

  // Skip: toOptional is not implemented on SingleNodeBuilder
  it.skip('optional traversal with whereConnectedTo', () => {
    // This test requires toOptional which is not implemented
  })
})
