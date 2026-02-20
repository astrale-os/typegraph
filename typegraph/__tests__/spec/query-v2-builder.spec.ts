/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Query v2 Builder Specification
 *
 * Tests for SubqueryBuilder and NodeQueryBuilder v2 methods:
 * whereExists, whereNotExists, whereCount, subquery, unwind,
 * hasEdge/hasNoEdge (EXISTS migration), whereConnectedTo/whereConnectedFrom.
 *
 * NOTE on compilation behavior:
 * - The Cypher compiler has an optimization (`tryCompileOptimizedConnectedTo`)
 *   that detects the pattern [TraversalStep, WhereStep(id eq)] and compiles it
 *   as an inline pattern `(n)-[:EDGE]->({id: $p})` instead of `EXISTS { }`.
 *   This applies to `whereConnectedTo` and `whereConnectedFrom` since they
 *   produce exactly that pattern (traversal + where id = value).
 * - `hasEdge` / `hasNoEdge` produce a single TraversalStep (no WHERE), so they
 *   compile to `EXISTS { MATCH ... }` / `NOT EXISTS { MATCH ... }`.
 */

import { describe, it, expect } from 'vitest'
import { createQueryBuilder } from '../../src'
import { testSchema } from './fixtures/test-schema'
import { SubqueryBuilder } from '../../src/query/subquery-builder'

const graph = createQueryBuilder(testSchema)

// =============================================================================
// SUBQUERY BUILDER (Unit Tests)
// =============================================================================

describe('SubqueryBuilder', () => {
  // ===========================================================================
  // TRAVERSAL
  // ===========================================================================

  describe('Traversal', () => {
    it('to() creates an outgoing TraversalStep', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored')

      expect(result.steps).toHaveLength(1)
      expect(result.steps[0].type).toBe('traversal')
      expect(result.steps[0].direction).toBe('out')
      expect(result.steps[0].edges).toEqual(['authored'])
      expect(result.steps[0].fromAlias).toBe('n0')
      expect(result.steps[0].toAlias).toBe('_to_1')
      expect(result.steps[0].edgeAlias).toBe('_e_to_1')
      expect(result.steps[0].optional).toBe(false)
      expect(result.steps[0].cardinality).toBe('many')
    })

    it('from() creates an incoming TraversalStep', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.from('authored')

      expect(result.steps).toHaveLength(1)
      expect(result.steps[0].type).toBe('traversal')
      expect(result.steps[0].direction).toBe('in')
      expect(result.steps[0].edges).toEqual(['authored'])
      expect(result.steps[0].fromAlias).toBe('n0')
      expect(result.steps[0].toAlias).toBe('_from_1')
      expect(result.steps[0].edgeAlias).toBe('_e_from_1')
    })

    it('related() creates a bidirectional TraversalStep', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.related('follows')

      expect(result.steps).toHaveLength(1)
      expect(result.steps[0].type).toBe('traversal')
      expect(result.steps[0].direction).toBe('both')
      expect(result.steps[0].edges).toEqual(['follows'])
      expect(result.steps[0].fromAlias).toBe('n0')
      expect(result.steps[0].toAlias).toBe('_rel_1')
      expect(result.steps[0].edgeAlias).toBe('_e_rel_1')
    })

    it('supports chained traversals (to -> from)', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').from('commentedOn')

      expect(result.steps).toHaveLength(2)

      // First step: to('authored')
      expect(result.steps[0].type).toBe('traversal')
      expect(result.steps[0].direction).toBe('out')
      expect(result.steps[0].edges).toEqual(['authored'])
      expect(result.steps[0].fromAlias).toBe('n0')
      expect(result.steps[0].toAlias).toBe('_to_1')

      // Second step: from('commentedOn') starts from the to alias of the first step
      expect(result.steps[1].type).toBe('traversal')
      expect(result.steps[1].direction).toBe('in')
      expect(result.steps[1].edges).toEqual(['commentedOn'])
      expect(result.steps[1].fromAlias).toBe('_to_1')
      expect(result.steps[1].toAlias).toBe('_from_2')
    })

    it('to() with target label sets toLabels', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored', 'post')

      expect(result.steps).toHaveLength(1)
      expect(result.steps[0].toLabels).toEqual(['post'])
    })

    it('to() without target label produces empty toLabels', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored')

      expect(result.steps[0].toLabels).toEqual([])
    })

    it('from() with source label sets toLabels', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.from('authored', 'user')

      expect(result.steps[0].toLabels).toEqual(['user'])
    })

    it('related() always has empty toLabels', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.related('follows')

      expect(result.steps[0].toLabels).toEqual([])
    })
  })

  // ===========================================================================
  // FILTERING
  // ===========================================================================

  describe('Filtering', () => {
    it('where() adds a WhereStep with comparison condition', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').where('viewCount', 'gt', 100)

      expect(result.steps).toHaveLength(2)
      expect(result.steps[1].type).toBe('where')
      expect(result.steps[1].conditions).toHaveLength(1)
      expect(result.steps[1].conditions[0]).toEqual({
        type: 'comparison',
        field: 'viewCount',
        operator: 'gt',
        value: 100,
        target: '_to_1',
      })
    })

    it('where() targets the current alias', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      // After to(), current alias becomes _to_1
      const result = builder.to('authored').where('title', 'eq', 'Hello')

      expect(result.steps[1].conditions[0].target).toBe('_to_1')
    })

    it('where() on initial builder targets the correlated alias', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.where('name', 'eq', 'Alice')

      expect(result.steps).toHaveLength(1)
      expect(result.steps[0].conditions[0].target).toBe('n0')
    })

    it('whereAll() with multiple conditions adds a single WhereStep', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').whereAll([
        ['viewCount', 'gt', 100],
        ['title', 'contains', 'Guide'],
        ['publishedAt', 'isNotNull', undefined],
      ])

      expect(result.steps).toHaveLength(2)
      expect(result.steps[1].type).toBe('where')
      expect(result.steps[1].conditions).toHaveLength(3)
      expect(result.steps[1].conditions[0].field).toBe('viewCount')
      expect(result.steps[1].conditions[0].operator).toBe('gt')
      expect(result.steps[1].conditions[0].value).toBe(100)
      expect(result.steps[1].conditions[1].field).toBe('title')
      expect(result.steps[1].conditions[1].operator).toBe('contains')
      expect(result.steps[1].conditions[2].field).toBe('publishedAt')
      expect(result.steps[1].conditions[2].operator).toBe('isNotNull')
    })

    it('whereAll() with empty array returns the same builder', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const traversed = builder.to('authored')
      const result = traversed.whereAll([])

      // Should be the exact same builder instance (no new steps)
      expect(result).toBe(traversed)
      expect(result.steps).toHaveLength(1) // only the traversal step
    })

    it('where() chains correctly after traversal', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder
        .to('authored')
        .where('viewCount', 'gt', 50)
        .where('title', 'contains', 'test')

      expect(result.steps).toHaveLength(3)
      expect(result.steps[0].type).toBe('traversal')
      expect(result.steps[1].type).toBe('where')
      expect(result.steps[2].type).toBe('where')
      expect(result.steps[1].conditions[0].field).toBe('viewCount')
      expect(result.steps[2].conditions[0].field).toBe('title')
    })
  })

  // ===========================================================================
  // AGGREGATION
  // ===========================================================================

  describe('Aggregation', () => {
    it('count() adds an AggregateStep with default alias', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').count()

      expect(result.steps).toHaveLength(2)
      expect(result.steps[1].type).toBe('aggregate')
      expect(result.steps[1].groupBy).toEqual([])
      expect(result.steps[1].aggregations).toHaveLength(1)
      expect(result.steps[1].aggregations[0]).toEqual({
        function: 'count',
        field: '*',
        resultAlias: 'count',
      })
    })

    it('count() exports as scalar', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').count()

      expect(result.getExportedAliases()).toEqual(['count'])
      const meta = result.getExportMetadata()
      expect(meta.get('count')).toEqual({ alias: 'count', kind: 'scalar' })
    })

    it('count() with custom alias', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').count('postCount')

      expect(result.steps[1].aggregations[0].resultAlias).toBe('postCount')
      expect(result.getExportedAliases()).toEqual(['postCount'])
    })

    it('sum() aggregation', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').sum('viewCount', 'totalViews')

      expect(result.steps).toHaveLength(2)
      expect(result.steps[1].type).toBe('aggregate')
      expect(result.steps[1].aggregations[0]).toEqual({
        function: 'sum',
        field: 'viewCount',
        sourceAlias: '_to_1',
        resultAlias: 'totalViews',
      })

      const meta = result.getExportMetadata()
      expect(meta.get('totalViews')).toEqual({ alias: 'totalViews', kind: 'scalar' })
    })

    it('max() aggregation', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').max('viewCount', 'maxViews')

      expect(result.steps[1].aggregations[0]).toEqual({
        function: 'max',
        field: 'viewCount',
        sourceAlias: '_to_1',
        resultAlias: 'maxViews',
      })

      expect(result.getExportMetadata().get('maxViews')?.kind).toBe('scalar')
    })

    it('min() aggregation', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').min('viewCount', 'minViews')

      expect(result.steps[1].aggregations[0]).toEqual({
        function: 'min',
        field: 'viewCount',
        sourceAlias: '_to_1',
        resultAlias: 'minViews',
      })

      expect(result.getExportMetadata().get('minViews')?.kind).toBe('scalar')
    })

    it('avg() aggregation', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').avg('viewCount', 'avgViews')

      expect(result.steps[1].aggregations[0]).toEqual({
        function: 'avg',
        field: 'viewCount',
        sourceAlias: '_to_1',
        resultAlias: 'avgViews',
      })

      expect(result.getExportMetadata().get('avgViews')?.kind).toBe('scalar')
    })

    it('collect() without distinct', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').collect('posts')

      expect(result.steps[1].type).toBe('aggregate')
      expect(result.steps[1].aggregations[0]).toEqual({
        function: 'collect',
        field: '_to_1',
        resultAlias: 'posts',
        distinct: false,
      })

      const meta = result.getExportMetadata()
      expect(meta.get('posts')).toEqual({ alias: 'posts', kind: 'array' })
    })

    it('collect() with distinct', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').collect('posts', true)

      expect(result.steps[1].aggregations[0]).toEqual({
        function: 'collect',
        field: '_to_1',
        resultAlias: 'posts',
        distinct: true,
      })

      expect(result.getExportMetadata().get('posts')?.kind).toBe('array')
    })
  })

  // ===========================================================================
  // EXPORT
  // ===========================================================================

  describe('Export', () => {
    it('as() registers a node export', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').as('myPost')

      expect(result.getExportedAliases()).toEqual(['myPost'])
      const meta = result.getExportMetadata()
      expect(meta.get('myPost')).toEqual({ alias: 'myPost', kind: 'node' })
    })

    it('as() does not add a step', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const beforeAs = builder.to('authored')
      const afterAs = beforeAs.as('myPost')

      // as() should not add new steps, only register the export
      expect(afterAs.steps).toHaveLength(beforeAs.steps.length)
    })

    it('multiple as() calls register multiple exports', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder
        .to('authored')
        .as('post1')
        .as('post2')

      expect(result.getExportedAliases()).toEqual(['post1', 'post2'])
    })

    it('getExportedAliases() returns registered exports', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder
        .to('authored')
        .count('postCount')
        .as('postNode')

      // Both scalar and node exports
      expect(result.getExportedAliases()).toContain('postCount')
      expect(result.getExportedAliases()).toContain('postNode')
    })

    it('getExportMetadata() returns metadata with kinds', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder
        .to('authored')
        .count('cnt')
        .collect('items', true)
        .as('node')

      const meta = result.getExportMetadata()
      expect(meta.get('cnt')).toEqual({ alias: 'cnt', kind: 'scalar' })
      expect(meta.get('items')).toEqual({ alias: 'items', kind: 'array' })
      expect(meta.get('node')).toEqual({ alias: 'node', kind: 'node' })
    })

    it('getCorrelatedAlias() returns the initial alias', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      expect(builder.getCorrelatedAlias()).toBe('n0')

      // After traversal, correlated alias stays the same
      const result = builder.to('authored').from('commentedOn')
      expect(result.getCorrelatedAlias()).toBe('n0')
    })
  })

  // ===========================================================================
  // PIPELINE
  // ===========================================================================

  describe('Pipeline', () => {
    it('buildPipelineSteps() adds ReturnStep for node exports', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').as('myPost')
      const steps = result.buildPipelineSteps()

      // Should have traversal step + return step
      expect(steps).toHaveLength(2)
      expect(steps[0].type).toBe('traversal')
      expect(steps[1].type).toBe('return')
      expect(steps[1].returns).toHaveLength(1)
      expect(steps[1].returns[0]).toEqual({
        kind: 'alias',
        alias: '_to_1',
        resultAlias: 'myPost',
      })
    })

    it('buildPipelineSteps() does NOT add ReturnStep for scalar exports only', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').count('postCount')
      const steps = result.buildPipelineSteps()

      // Scalar exports are handled by the aggregate step itself
      // No additional return step should be added
      expect(steps).toHaveLength(2) // traversal + aggregate
      expect(steps[0].type).toBe('traversal')
      expect(steps[1].type).toBe('aggregate')
      // No return step
      const returnSteps = steps.filter(s => s.type === 'return')
      expect(returnSteps).toHaveLength(0)
    })

    it('buildPipelineSteps() with no exports returns steps unchanged', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored')
      const steps = result.buildPipelineSteps()

      // Just the traversal, no return step
      expect(steps).toHaveLength(1)
      expect(steps[0].type).toBe('traversal')
    })

    it('buildPipelineSteps() with mixed scalar and node exports adds ReturnStep for node only', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').count('cnt').as('myPost')
      const steps = result.buildPipelineSteps()

      // traversal + aggregate + return (for node export)
      expect(steps).toHaveLength(3)
      expect(steps[0].type).toBe('traversal')
      expect(steps[1].type).toBe('aggregate')
      expect(steps[2].type).toBe('return')
      expect(steps[2].returns[0].kind).toBe('alias')
      expect(steps[2].returns[0].resultAlias).toBe('myPost')
    })
  })

  // ===========================================================================
  // IMMUTABILITY
  // ===========================================================================

  describe('Immutability', () => {
    it('to() returns a new builder, original is unchanged', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored')

      expect(builder.steps).toHaveLength(0)
      expect(result.steps).toHaveLength(1)
    })

    it('where() returns a new builder, original is unchanged', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const traversed = builder.to('authored')
      const filtered = traversed.where('viewCount', 'gt', 100)

      expect(traversed.steps).toHaveLength(1)
      expect(filtered.steps).toHaveLength(2)
    })

    it('count() returns a new builder, original exports are unchanged', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const traversed = builder.to('authored')
      const counted = traversed.count('postCount')

      expect(traversed.getExportedAliases()).toEqual([])
      expect(counted.getExportedAliases()).toEqual(['postCount'])
    })

    it('as() returns a new builder, original exports are unchanged', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const traversed = builder.to('authored')
      const aliased = traversed.as('myPost')

      expect(traversed.getExportedAliases()).toEqual([])
      expect(aliased.getExportedAliases()).toEqual(['myPost'])
    })
  })

  // ===========================================================================
  // ALIAS COUNTER
  // ===========================================================================

  describe('Alias Counter', () => {
    it('increments alias counter across chained traversals', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').to('categorizedAs')

      expect(result.steps[0].toAlias).toBe('_to_1')
      expect(result.steps[1].toAlias).toBe('_to_2')
    })

    it('increments alias counter across different traversal types', () => {
      const builder = new SubqueryBuilder(testSchema, 'n0')
      const result = builder.to('authored').from('commentedOn').related('follows')

      expect(result.steps[0].toAlias).toBe('_to_1')
      expect(result.steps[1].toAlias).toBe('_from_2')
      expect(result.steps[2].toAlias).toBe('_rel_3')
    })
  })
})

// =============================================================================
// NODE QUERY BUILDER v2 METHODS (Compilation Tests)
// =============================================================================

describe('NodeQueryBuilder v2', () => {
  // ===========================================================================
  // whereExists
  // ===========================================================================

  describe('whereExists', () => {
    it('basic: compiles to EXISTS subquery', () => {
      const compiled = graph.node('user').whereExists(q => q.to('authored')).compile()

      expect(compiled.cypher).toContain('EXISTS {')
      expect(compiled.cypher).toContain('authored')
      // Should have outgoing direction arrow
      expect(compiled.cypher).toMatch(/-\[.*:authored\]->/)
    })

    it('with non-id filter: whereExists with inner where() compiles to EXISTS', () => {
      const compiled = graph
        .node('user')
        .whereExists(q => q.to('authored').where('viewCount', 'gt', 100))
        .compile()

      expect(compiled.cypher).toContain('EXISTS {')
      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toContain('viewCount')
      // The 100 value should be parameterized
      expect(Object.values(compiled.params)).toContain(100)
    })

    it('chained with regular where', () => {
      const compiled = graph
        .node('user')
        .where('status', 'eq', 'active')
        .whereExists(q => q.to('authored'))
        .compile()

      expect(compiled.cypher).toContain('status')
      expect(compiled.cypher).toContain('EXISTS {')
      expect(compiled.cypher).toContain('authored')
      expect(Object.values(compiled.params)).toContain('active')
    })

    it('multiple whereExists calls produce multiple EXISTS clauses', () => {
      const compiled = graph
        .node('user')
        .whereExists(q => q.to('authored'))
        .whereExists(q => q.to('follows'))
        .compile()

      const existsCount = (compiled.cypher.match(/EXISTS \{/g) || []).length
      expect(existsCount).toBe(2)
      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toContain('follows')
    })

    it('whereExists with incoming traversal', () => {
      const compiled = graph
        .node('post')
        .whereExists(q => q.from('authored'))
        .compile()

      expect(compiled.cypher).toContain('EXISTS {')
      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toContain('<-')
    })

    it('whereExists with target label', () => {
      const compiled = graph
        .node('user')
        .whereExists(q => q.to('authored', 'post'))
        .compile()

      expect(compiled.cypher).toContain('EXISTS {')
      expect(compiled.cypher).toContain('authored')
    })

    it('whereExists with chained inner traversals', () => {
      const compiled = graph
        .node('user')
        .whereExists(q => q.to('authored').to('categorizedAs'))
        .compile()

      expect(compiled.cypher).toContain('EXISTS {')
      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toContain('categorizedAs')
    })

    it('whereExists with id filter is optimized to inline pattern', () => {
      // The compiler detects [TraversalStep, WhereStep(id eq)] and inlines it
      const compiled = graph
        .node('user')
        .whereExists(q => q.to('authored').where('id', 'eq', 'post_123'))
        .compile()

      // Optimized to inline pattern, not EXISTS { }
      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toMatch(/\(\{id: \$p\d+\}\)/)
      expect(Object.values(compiled.params)).toContain('post_123')
    })
  })

  // ===========================================================================
  // whereNotExists
  // ===========================================================================

  describe('whereNotExists', () => {
    it('basic: compiles to NOT EXISTS subquery', () => {
      const compiled = graph
        .node('user')
        .whereNotExists(q => q.to('authored'))
        .compile()

      expect(compiled.cypher).toContain('NOT EXISTS {')
      expect(compiled.cypher).toContain('authored')
    })

    it('with non-id filter: NOT EXISTS with where clause', () => {
      const compiled = graph
        .node('user')
        .whereNotExists(q =>
          q.to('authored').where('viewCount', 'lt', 10),
        )
        .compile()

      expect(compiled.cypher).toContain('NOT EXISTS {')
      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toContain('viewCount')
    })

    it('chained with whereExists produces EXISTS and NOT EXISTS', () => {
      const compiled = graph
        .node('user')
        .whereExists(q => q.to('follows'))
        .whereNotExists(q => q.to('authored'))
        .compile()

      expect(compiled.cypher).toMatch(/(?<!NOT )EXISTS \{/)
      expect(compiled.cypher).toContain('NOT EXISTS {')
      expect(compiled.cypher).toContain('follows')
      expect(compiled.cypher).toContain('authored')
    })

    it('NOT EXISTS with bidirectional traversal', () => {
      const compiled = graph
        .node('user')
        .whereNotExists(q => q.related('follows'))
        .compile()

      expect(compiled.cypher).toContain('NOT EXISTS {')
      expect(compiled.cypher).toContain('follows')
    })

    it('NOT EXISTS with id filter is optimized to inline NOT pattern', () => {
      // Compiler optimization: [TraversalStep, WhereStep(id eq)] -> NOT (n)-[:E]->({id: $p})
      const compiled = graph
        .node('user')
        .whereNotExists(q => q.to('follows').where('id', 'eq', 'blocked_user'))
        .compile()

      expect(compiled.cypher).toContain('NOT')
      expect(compiled.cypher).toContain('follows')
      expect(compiled.cypher).toMatch(/\(\{id: \$p\d+\}\)/)
      expect(Object.values(compiled.params)).toContain('blocked_user')
    })
  })

  // ===========================================================================
  // whereCount
  // ===========================================================================

  describe('whereCount', () => {
    it('gt operator: count > 5', () => {
      const compiled = graph
        .node('user')
        .whereCount(q => q.to('authored'), 'gt', 5)
        .compile()

      expect(compiled.cypher).toContain('COUNT {')
      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toContain('>')
      expect(Object.values(compiled.params)).toContain(5)
    })

    it('eq operator: count = 3', () => {
      const compiled = graph
        .node('user')
        .whereCount(q => q.to('authored'), 'eq', 3)
        .compile()

      expect(compiled.cypher).toContain('COUNT {')
      expect(compiled.cypher).toContain('=')
      expect(Object.values(compiled.params)).toContain(3)
    })

    it('lte operator: count <= 10', () => {
      const compiled = graph
        .node('user')
        .whereCount(q => q.to('authored'), 'lte', 10)
        .compile()

      expect(compiled.cypher).toContain('COUNT {')
      expect(compiled.cypher).toContain('<=')
      expect(Object.values(compiled.params)).toContain(10)
    })

    it('value 0: count = 0 (equivalent to not exists but via count)', () => {
      const compiled = graph
        .node('user')
        .whereCount(q => q.to('authored'), 'eq', 0)
        .compile()

      expect(compiled.cypher).toContain('COUNT {')
      expect(compiled.cypher).toContain('=')
      expect(Object.values(compiled.params)).toContain(0)
    })

    it('with filter in subquery: count with where', () => {
      const compiled = graph
        .node('user')
        .whereCount(
          q => q.to('authored').where('viewCount', 'gt', 100),
          'gte',
          2,
        )
        .compile()

      expect(compiled.cypher).toContain('COUNT {')
      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toContain('viewCount')
      expect(compiled.cypher).toContain('>=')
    })

    it('multiple whereCount calls', () => {
      const compiled = graph
        .node('user')
        .whereCount(q => q.to('authored'), 'gt', 5)
        .whereCount(q => q.to('follows'), 'gte', 10)
        .compile()

      const countOccurrences = (compiled.cypher.match(/COUNT \{/g) || []).length
      expect(countOccurrences).toBe(2)
    })
  })

  // ===========================================================================
  // subquery
  // ===========================================================================

  describe('subquery', () => {
    it('pipeline subquery with count export', () => {
      const compiled = graph
        .node('user')
        .subquery(q => q.to('authored').count('postCount'))
        .compile()

      expect(compiled.cypher).toContain('CALL {')
      expect(compiled.cypher).toContain('}')
      expect(compiled.cypher).toContain('authored')
    })

    it('CALL {} in output', () => {
      const compiled = graph
        .node('user')
        .subquery(q => q.to('authored').count('postCount'))
        .compile()

      // Should produce CALL { ... }
      expect(compiled.cypher).toMatch(/CALL \{/)
      expect(compiled.cypher).toMatch(/\}/)
    })

    it('subquery with exported node alias', () => {
      const compiled = graph
        .node('user')
        .subquery(q => q.to('authored').as('post'))
        .compile()

      expect(compiled.cypher).toContain('CALL {')
      expect(compiled.cypher).toContain('authored')
      // The exported alias should appear in the subquery RETURN
      expect(compiled.cypher).toContain('RETURN')
    })

    it('subquery with correlated alias (WITH clause)', () => {
      const compiled = graph
        .node('user')
        .subquery(q => q.to('authored').count('postCount'))
        .compile()

      // Correlated subquery should import the outer alias
      expect(compiled.cypher).toContain('WITH')
    })

    it('subquery with sum aggregation', () => {
      const compiled = graph
        .node('user')
        .subquery(q => q.to('authored').sum('viewCount', 'totalViews'))
        .compile()

      expect(compiled.cypher).toContain('CALL {')
      expect(compiled.cypher).toContain('authored')
    })

    it('subquery followed by where', () => {
      const compiled = graph
        .node('user')
        .subquery(q => q.to('authored').count('postCount'))
        .where('name', 'eq', 'Alice')
        .compile()

      expect(compiled.cypher).toContain('CALL {')
      expect(compiled.cypher).toContain('name')
      expect(Object.values(compiled.params)).toContain('Alice')
    })
  })

  // ===========================================================================
  // unwind
  // ===========================================================================

  describe('unwind', () => {
    it('basic unwind compiles to UNWIND clause', () => {
      const compiled = graph
        .node('post')
        .unwind('tags', 'tag')
        .compile()

      expect(compiled.cypher).toContain('UNWIND')
      expect(compiled.cypher).toContain('.tags')
      expect(compiled.cypher).toContain('AS tag')
    })

    it('verify full UNWIND syntax', () => {
      const compiled = graph
        .node('post')
        .unwind('tags', 'tag')
        .compile()

      // Should match: UNWIND <alias>.tags AS tag
      expect(compiled.cypher).toMatch(/UNWIND \w+\.tags AS tag/)
    })

    it('unwind followed by where', () => {
      const compiled = graph
        .node('post')
        .where('viewCount', 'gt', 100)
        .unwind('tags', 'tag')
        .compile()

      expect(compiled.cypher).toContain('viewCount')
      expect(compiled.cypher).toContain('UNWIND')
      expect(compiled.cypher).toContain('AS tag')
    })
  })

  // ===========================================================================
  // hasEdge migration (now uses EXISTS via whereExists)
  // ===========================================================================

  describe('hasEdge migration', () => {
    it('hasEdge outgoing produces EXISTS subquery', () => {
      const compiled = graph
        .node('user')
        .hasEdge('authored', 'out')
        .compile()

      // hasEdge produces a single TraversalStep (no id WHERE), so no optimization
      expect(compiled.cypher).toContain('EXISTS {')
      expect(compiled.cypher).toContain('authored')
      // Outgoing direction
      expect(compiled.cypher).toMatch(/-\[.*:authored\]->/)
    })

    it('hasEdge incoming produces EXISTS with incoming direction', () => {
      const compiled = graph
        .node('post')
        .hasEdge('authored', 'in')
        .compile()

      expect(compiled.cypher).toContain('EXISTS {')
      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toContain('<-')
    })

    it('hasEdge both produces EXISTS with bidirectional', () => {
      const compiled = graph
        .node('user')
        .hasEdge('follows', 'both')
        .compile()

      expect(compiled.cypher).toContain('EXISTS {')
      expect(compiled.cypher).toContain('follows')
    })

    it('hasEdge default direction is outgoing', () => {
      const compiled = graph
        .node('user')
        .hasEdge('authored')
        .compile()

      expect(compiled.cypher).toContain('EXISTS {')
      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toMatch(/-\[.*:authored\]->/)
    })

    it('hasNoEdge produces NOT EXISTS', () => {
      const compiled = graph
        .node('user')
        .hasNoEdge('authored')
        .compile()

      expect(compiled.cypher).toContain('NOT EXISTS {')
      expect(compiled.cypher).toContain('authored')
    })

    it('hasNoEdge incoming produces NOT EXISTS with incoming direction', () => {
      const compiled = graph
        .node('post')
        .hasNoEdge('authored', 'in')
        .compile()

      expect(compiled.cypher).toContain('NOT EXISTS {')
      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toContain('<-')
    })

    it('hasNoEdge both produces NOT EXISTS with bidirectional', () => {
      const compiled = graph
        .node('user')
        .hasNoEdge('follows', 'both')
        .compile()

      expect(compiled.cypher).toContain('NOT EXISTS {')
      expect(compiled.cypher).toContain('follows')
    })

    it('hasEdge chained with where', () => {
      const compiled = graph
        .node('user')
        .where('status', 'eq', 'active')
        .hasEdge('authored')
        .compile()

      expect(compiled.cypher).toContain('status')
      expect(compiled.cypher).toContain('EXISTS {')
      expect(compiled.cypher).toContain('authored')
    })

    it('multiple hasEdge calls produce multiple EXISTS clauses', () => {
      const compiled = graph
        .node('user')
        .hasEdge('authored')
        .hasEdge('follows')
        .compile()

      const existsCount = (compiled.cypher.match(/EXISTS \{/g) || []).length
      expect(existsCount).toBe(2)
    })
  })

  // ===========================================================================
  // whereConnectedTo migration (optimized to inline pattern by compiler)
  // ===========================================================================

  describe('whereConnectedTo migration', () => {
    it('whereConnectedTo compiles to optimized inline pattern with ID check', () => {
      // The compiler optimizes [TraversalStep, WhereStep(id eq)] into inline pattern
      const compiled = graph
        .node('post')
        .whereConnectedTo('categorizedAs', 'cat_123')
        .compile()

      // Optimized: (n0)-[:categorizedAs]->({id: $p0}) instead of EXISTS { }
      expect(compiled.cypher).toContain('categorizedAs')
      expect(compiled.cypher).toMatch(/\(\{id: \$p\d+\}\)/)
      expect(Object.values(compiled.params)).toContain('cat_123')
    })

    it('whereConnectedTo uses outgoing direction in inline pattern', () => {
      const compiled = graph
        .node('post')
        .whereConnectedTo('categorizedAs', 'cat_123')
        .compile()

      // Outgoing arrow in the inline pattern
      expect(compiled.cypher).toMatch(/-\[:categorizedAs\]->/)
    })

    it('whereConnectedFrom compiles to optimized inline pattern with incoming direction', () => {
      const compiled = graph
        .node('user')
        .whereConnectedFrom('authored', 'post_123')
        .compile()

      // Incoming direction in inline pattern
      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toContain('<-')
      expect(compiled.cypher).toMatch(/\(\{id: \$p\d+\}\)/)
      expect(Object.values(compiled.params)).toContain('post_123')
    })

    it('whereConnectedTo chained with property filter', () => {
      const compiled = graph
        .node('post')
        .where('viewCount', 'gt', 100)
        .whereConnectedTo('categorizedAs', 'cat_tech')
        .compile()

      expect(compiled.cypher).toContain('viewCount')
      expect(compiled.cypher).toContain('categorizedAs')
      expect(compiled.cypher).toMatch(/\(\{id: \$p\d+\}\)/)
    })

    it('multiple whereConnectedTo produce multiple inline patterns', () => {
      const compiled = graph
        .node('post')
        .whereConnectedTo('categorizedAs', 'cat_1')
        .whereConnectedTo('likes', 'user_1')
        .compile()

      // Both IDs should be parameterized
      expect(Object.values(compiled.params)).toContain('cat_1')
      expect(Object.values(compiled.params)).toContain('user_1')
      // Both edge types should appear
      expect(compiled.cypher).toContain('categorizedAs')
      expect(compiled.cypher).toContain('likes')
    })

    it('whereConnectedTo after traversal', () => {
      const compiled = graph
        .node('user')
        .to('authored')
        .whereConnectedTo('categorizedAs', 'cat_tech')
        .compile()

      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toContain('categorizedAs')
      expect(compiled.cypher).toMatch(/\(\{id: \$p\d+\}\)/)
    })
  })

  // ===========================================================================
  // COMBINED v2 METHODS
  // ===========================================================================

  describe('Combined v2 methods', () => {
    it('whereExists + whereCount together', () => {
      const compiled = graph
        .node('user')
        .whereExists(q => q.to('follows'))
        .whereCount(q => q.to('authored'), 'gt', 3)
        .compile()

      expect(compiled.cypher).toContain('EXISTS {')
      expect(compiled.cypher).toContain('COUNT {')
      expect(compiled.cypher).toContain('follows')
      expect(compiled.cypher).toContain('authored')
    })

    it('subquery + whereExists together', () => {
      const compiled = graph
        .node('user')
        .subquery(q => q.to('authored').count('postCount'))
        .whereExists(q => q.to('follows'))
        .compile()

      expect(compiled.cypher).toContain('CALL {')
      expect(compiled.cypher).toContain('EXISTS {')
    })

    it('where + hasEdge + whereNotExists(id) combined', () => {
      // hasEdge uses EXISTS { }, whereNotExists with id filter uses inline NOT pattern
      const compiled = graph
        .node('user')
        .where('status', 'eq', 'active')
        .hasEdge('authored')
        .whereNotExists(q => q.to('follows').where('id', 'eq', 'blocked_user'))
        .compile()

      expect(compiled.cypher).toContain('status')
      // hasEdge produces EXISTS { }
      expect(compiled.cypher).toContain('EXISTS {')
      // whereNotExists with id filter is optimized to inline NOT pattern
      expect(compiled.cypher).toMatch(/NOT \(/)
      expect(compiled.cypher).toContain('follows')
    })

    it('where + hasEdge + whereNotExists(non-id) combined', () => {
      // whereNotExists without id eq filter should use NOT EXISTS { }
      const compiled = graph
        .node('user')
        .where('status', 'eq', 'active')
        .hasEdge('authored')
        .whereNotExists(q => q.to('authored').where('viewCount', 'gt', 100))
        .compile()

      expect(compiled.cypher).toContain('status')
      // hasEdge produces EXISTS { }
      expect(compiled.cypher).toContain('EXISTS {')
      // whereNotExists with non-id filter uses NOT EXISTS { }
      expect(compiled.cypher).toContain('NOT EXISTS {')
    })

    it('traversal + whereExists + unwind chain', () => {
      const compiled = graph
        .node('user')
        .to('authored')
        .whereExists(q => q.to('categorizedAs'))
        .unwind('tags', 'tag')
        .compile()

      expect(compiled.cypher).toContain('authored')
      expect(compiled.cypher).toContain('EXISTS {')
      expect(compiled.cypher).toContain('UNWIND')
      expect(compiled.cypher).toContain('AS tag')
    })
  })

  // ===========================================================================
  // PARAMETER HANDLING
  // ===========================================================================

  describe('Parameter handling', () => {
    it('parameters are correctly numbered across v2 methods', () => {
      const compiled = graph
        .node('user')
        .where('status', 'eq', 'active')
        .whereExists(q => q.to('authored').where('viewCount', 'gt', 100))
        .whereCount(q => q.to('follows'), 'gte', 5)
        .compile()

      // Each value should be present as a parameter
      const paramValues = Object.values(compiled.params)
      expect(paramValues).toContain('active')
      expect(paramValues).toContain(100)
      expect(paramValues).toContain(5)
    })

    it('whereConnectedTo parameters are isolated per call', () => {
      const compiled = graph
        .node('post')
        .whereConnectedTo('categorizedAs', 'cat_A')
        .whereConnectedTo('categorizedAs', 'cat_B')
        .compile()

      const paramValues = Object.values(compiled.params)
      expect(paramValues).toContain('cat_A')
      expect(paramValues).toContain('cat_B')
      // Should have at least 2 distinct params
      expect(Object.keys(compiled.params).length).toBeGreaterThanOrEqual(2)
    })
  })
})
