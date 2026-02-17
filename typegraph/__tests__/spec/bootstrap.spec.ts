/**
 * withInstanceModel Tests
 *
 * Tests the pure schema enrichment helper that remains in typegraph.
 * The schema materialization logic has moved to kernel/boot.
 */

import { describe, it, expect } from 'vitest'
import { withInstanceModel } from '../../src/bootstrap'
import type { SchemaShape } from '../../src/schema'

// =============================================================================
// FIXTURES
// =============================================================================

const simpleSchema: SchemaShape = {
  nodes: {
    customer: { abstract: false, attributes: ['name'] },
    order: { abstract: false, attributes: ['status'] },
    product: { abstract: false, attributes: ['title'] },
  },
  edges: {
    placedOrder: {
      endpoints: {
        customer: { types: ['customer'] },
        order: { types: ['order'] },
      },
    },
  },
}

const mockResult = {
  refs: { customer: 'Class_abc', order: 'Class_def', product: 'Class_ghi' },
  implementors: { Node: ['Class_abc', 'Class_def', 'Class_ghi'] },
}

// =============================================================================
// TESTS
// =============================================================================

describe('withInstanceModel', () => {
  it('returns enriched schema with instanceModel config', () => {
    const enriched = withInstanceModel(simpleSchema, mockResult)

    expect(enriched.instanceModel).toBeDefined()
    expect(enriched.instanceModel.enabled).toBe(true)
    expect(enriched.instanceModel.refs).toBe(mockResult.refs)
    expect(enriched.instanceModel.implementors).toBe(mockResult.implementors)
  })

  it('preserves original schema properties', () => {
    const enriched = withInstanceModel(simpleSchema, mockResult)

    expect(enriched.nodes).toBe(simpleSchema.nodes)
    expect(enriched.edges).toBe(simpleSchema.edges)
  })

  it('does not mutate original schema', () => {
    withInstanceModel(simpleSchema, mockResult)

    expect((simpleSchema as any).instanceModel).toBeUndefined()
  })
})
