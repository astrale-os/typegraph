/**
 * Edge Filtering and Return API Tests
 *
 * Tests edge property filtering during traversal and various return patterns.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineSchema, node, edge, createQueryBuilder, collect } from '../../src'

// Schema with edge properties
const schema = defineSchema({
  nodes: {
    module: node({
      properties: {
        name: z.string(),
        version: z.string().optional(),
      },
    }),
  },
  edges: {
    linkedTo: edge({
      from: 'module',
      to: 'module',
      properties: {
        type: z.enum(['simple', 'complex', 'reference']),
        weight: z.number().optional(),
        createdAt: z.date().optional(),
      },
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
  },
})

const graph = createQueryBuilder(schema)

describe('Edge Filtering', () => {
  describe('Basic edge property filtering', () => {
    it('filters by edge property with eq', () => {
      const query = graph
        .nodeByIdWithLabel('module', 'module-a')
        .to('linkedTo', { where: { type: { eq: 'simple' } } })

      const compiled = query.compile()
      console.log('eq filter:\n', compiled.cypher)
      console.log('params:', compiled.params)

      expect(compiled.cypher).toContain('linkedTo')
      expect(compiled.cypher).toContain('type')
    })

    it('filters by edge property with neq', () => {
      const query = graph
        .nodeByIdWithLabel('module', 'module-a')
        .to('linkedTo', { where: { type: { neq: 'complex' } } })

      const compiled = query.compile()
      console.log('neq filter:\n', compiled.cypher)
      expect(compiled.cypher).toContain('linkedTo')
    })

    it('filters by numeric edge property with gt', () => {
      const query = graph
        .nodeByIdWithLabel('module', 'module-a')
        .to('linkedTo', { where: { weight: { gt: 5 } } })

      const compiled = query.compile()
      console.log('gt filter:\n', compiled.cypher)
      expect(compiled.cypher).toContain('linkedTo')
    })

    it('filters by edge property with in', () => {
      const query = graph
        .nodeByIdWithLabel('module', 'module-a')
        .to('linkedTo', { where: { type: { in: ['simple', 'reference'] } } })

      const compiled = query.compile()
      console.log('in filter:\n', compiled.cypher)
      expect(compiled.cypher).toContain('linkedTo')
    })

    it('filters by edge property with isNull', () => {
      const query = graph
        .nodeByIdWithLabel('module', 'module-a')
        .to('linkedTo', { where: { weight: { isNull: true } } })

      const compiled = query.compile()
      console.log('isNull filter:\n', compiled.cypher)
      expect(compiled.cypher).toContain('linkedTo')
    })

    it('filters by edge property with isNotNull', () => {
      const query = graph
        .nodeByIdWithLabel('module', 'module-a')
        .to('linkedTo', { where: { createdAt: { isNotNull: true } } })

      const compiled = query.compile()
      console.log('isNotNull filter:\n', compiled.cypher)
      expect(compiled.cypher).toContain('linkedTo')
    })

    it('filters by multiple edge properties (AND)', () => {
      const query = graph.nodeByIdWithLabel('module', 'module-a').to('linkedTo', {
        where: {
          type: { eq: 'simple' },
          weight: { gt: 0 },
        },
      })

      const compiled = query.compile()
      console.log('multiple filters:\n', compiled.cypher)
      expect(compiled.cypher).toContain('linkedTo')
    })
  })

  describe('Edge filtering with edgeAs capture', () => {
    it('captures edge with edgeAs and filters', () => {
      const query = graph
        .nodeByIdWithLabel('module', 'module-a')
        .to('linkedTo', {
          where: { type: { eq: 'simple' } },
          edgeAs: 'link',
        })
        .as('target')

      const compiled = query.compile()
      console.log('edgeAs + filter:\n', compiled.cypher)
      expect(compiled.cypher).toContain('linkedTo')
    })
  })

  describe('Return API with edge aliases', () => {
    it('returns full nodes and edge with .return() - full objects', async () => {
      // This pattern WORKS - returning full node/edge objects
      const query = await graph
        .nodeByIdWithLabel('module', 'module-a')
        .as('source')
        .to('linkedTo', { edgeAs: 'link' })
        .as('target')
        .return((q) => ({
          source: q.source,
          target: q.target,
          link: q.link,
        }))

      const compiled = query.compile()
      console.log('return full nodes + edge:\n', compiled.cypher)
      expect(compiled.cypher).toContain('RETURN')
      expect(compiled.cypher).toContain('AS source')
      expect(compiled.cypher).toContain('AS target')
      expect(compiled.cypher).toContain('AS link')
    })

    it('returns node properties only (no edge in return)', async () => {
      // Edge is used for filtering, but we only return node data
      // Note: When accessing q.source.id, it actually returns full node as 'source'
      const query = await graph
        .nodeByIdWithLabel('module', 'module-a')
        .as('source')
        .to('linkedTo', {
          where: { type: { eq: 'simple' } },
        })
        .as('target')
        .return((q) => ({
          source: q.source, // Returns full node
          target: q.target, // Returns full node
        }))

      const compiled = query.compile()
      console.log('return nodes (filter by edge):\n', compiled.cypher)
      console.log('params:', compiled.params)

      expect(compiled.cypher).toContain('RETURN')
      expect(compiled.cypher).toContain('AS source')
      expect(compiled.cypher).toContain('AS target')
      expect(compiled.cypher).toContain('WHERE e2.type = $p1') // Edge filter applied
    })

    it('collects multiple targets using fork (nodes only)', async () => {
      const query = await graph
        .nodeByIdWithLabel('module', 'module-a')
        .as('source')
        .fork((q) =>
          q
            .to('linkedTo', {
              where: { type: { eq: 'simple' } },
            })
            .as('target'),
        )
        .return((q) => ({
          source: q.source,
          targets: collect(q.target),
        }))

      const compiled = query.compile()
      console.log('fork + collect nodes:\n', compiled.cypher)
      expect(compiled.cypher).toContain('collect(')
    })

    it('fork with edge capture - full edge object', async () => {
      const query = await graph
        .nodeByIdWithLabel('module', 'module-a')
        .as('source')
        .fork((q) =>
          q
            .to('linkedTo', {
              where: { type: { eq: 'simple' } },
              edgeAs: 'link',
            })
            .as('target'),
        )
        .return((q) => ({
          source: q.source,
          target: q.target,
          link: q.link, // Full edge object
        }))

      const compiled = query.compile()
      console.log('fork + edge object:\n', compiled.cypher)
      expect(compiled.cypher).toContain('AS link')
    })
  })

  describe('Bidirectional traversal with edge filter', () => {
    it('via() with edge filter', () => {
      const query = graph
        .nodeByIdWithLabel('module', 'module-a')
        .via('linkedTo', { where: { type: { eq: 'simple' } } })

      const compiled = query.compile()
      console.log('via + filter:\n', compiled.cypher)
      expect(compiled.cypher).toContain('linkedTo')
    })
  })

  describe('Type inference verification', () => {
    it('node properties are correctly typed in return', async () => {
      const query = await graph
        .nodeByIdWithLabel('module', 'module-a')
        .as('source')
        .to('linkedTo', { edgeAs: 'link' })
        .as('target')
        .return((q) => {
          // Type checks for node properties
          const targetName: string = q.target.name
          const targetVersion: string | undefined = q.target.version
          const sourceName: string = q.source.name

          return {
            targetName,
            targetVersion,
            sourceName,
          }
        })

      const compiled = query.compile()
      console.log('typed node return:\n', compiled.cypher)
      expect(compiled.cypher).toContain('RETURN')
    })

    it('full edge object is returned with edgeAs', async () => {
      const query = await graph
        .nodeByIdWithLabel('module', 'module-a')
        .as('source')
        .to('linkedTo', { edgeAs: 'link' })
        .as('target')
        .return((q) => ({
          source: q.source,
          target: q.target,
          link: q.link, // Full edge object, typed as EdgeProps
        }))

      const compiled = query.compile()
      console.log('full edge return:\n', compiled.cypher)
      expect(compiled.cypher).toContain('AS link')
    })

    it('filter where clause is type-safe', () => {
      // This should compile - valid enum value
      graph.nodeByIdWithLabel('module', 'module-a').to('linkedTo', {
        where: { type: { eq: 'simple' } },
      })

      // This should compile - valid number comparison
      graph.nodeByIdWithLabel('module', 'module-a').to('linkedTo', {
        where: { weight: { gt: 10 } },
      })

      // Type error examples (commented out - would fail compilation):
      // where: { type: { eq: 'invalid' } }  // 'invalid' not in enum
      // where: { weight: { eq: 'string' } } // weight is number
      // where: { nonexistent: { eq: 1 } }   // property doesn't exist

      expect(true).toBe(true) // Compilation success is the test
    })
  })

  describe('select() API', () => {
    it('select specific fields', () => {
      // Check if select exists on the builder
      const builder = graph
        .nodeByIdWithLabel('module', 'module-a')
        .to('linkedTo', { where: { type: { eq: 'simple' } } })

      // @ts-expect-error - Check if select method exists
      const hasSelect = typeof builder.select === 'function'
      console.log('has select():', hasSelect)

      // If select doesn't exist, we use return() instead
      if (!hasSelect) {
        console.log('select() not available, use return() instead')
      }
    })
  })
})
