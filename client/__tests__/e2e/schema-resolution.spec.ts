/**
 * Schema Resolution E2E Tests
 *
 * Tests the schema resolution layer — label resolution, edge endpoint
 * resolution, inheritance, and helpers — against the e-commerce domain schema.
 */

import { describe, it, expect } from 'vitest'

import {
  resolveNodeLabels,
  formatLabels,
  toPascalCase,
  getNodesSatisfying,
  isReified,
} from '../../src'
import { edgeFrom, edgeTo, edgeCardinality } from '../../src/helpers'
import { schema } from './schema'

// =============================================================================
// LABEL RESOLUTION
// =============================================================================

describe('label resolution', () => {
  it('resolves Customer → [Customer, Timestamped]', () => {
    expect(resolveNodeLabels(schema, 'Customer')).toEqual(['Customer', 'Timestamped'])
  })

  it('resolves Product → [Product, Timestamped]', () => {
    expect(resolveNodeLabels(schema, 'Product')).toEqual(['Product', 'Timestamped'])
  })

  it('resolves Category → [Category] (no inheritance)', () => {
    expect(resolveNodeLabels(schema, 'Category')).toEqual(['Category'])
  })

  it('resolves Timestamped → [Timestamped] (abstract type still resolves)', () => {
    expect(resolveNodeLabels(schema, 'Timestamped')).toEqual(['Timestamped'])
  })

  it('resolves Order → [Order, Timestamped]', () => {
    expect(resolveNodeLabels(schema, 'Order')).toEqual(['Order', 'Timestamped'])
  })

  it('resolves Review → [Review, Timestamped]', () => {
    expect(resolveNodeLabels(schema, 'Review')).toEqual(['Review', 'Timestamped'])
  })

  it('resolves Warehouse → [Warehouse] (no inheritance)', () => {
    expect(resolveNodeLabels(schema, 'Warehouse')).toEqual(['Warehouse'])
  })
})

// =============================================================================
// LABEL FORMATTING
// =============================================================================

describe('label formatting', () => {
  it('formats multi-label as :Customer:Timestamped', () => {
    expect(formatLabels(['Customer', 'Timestamped'])).toBe(':Customer:Timestamped')
  })

  it('formats single label as :Category', () => {
    expect(formatLabels(['Category'])).toBe(':Category')
  })

  it('formats empty labels as empty string', () => {
    expect(formatLabels([])).toBe('')
  })
})

// =============================================================================
// toPascalCase
// =============================================================================

describe('toPascalCase', () => {
  it('converts snake_case → PascalCase', () => {
    expect(toPascalCase('category_parent')).toBe('CategoryParent')
  })

  it('preserves already PascalCase strings', () => {
    expect(toPascalCase('Customer')).toBe('Customer')
  })

  it('converts multi-word snake_case', () => {
    expect(toPascalCase('placed_order')).toBe('PlacedOrder')
  })

  it('handles lowercase single word', () => {
    expect(toPascalCase('review')).toBe('Review')
  })
})

// =============================================================================
// getNodesSatisfying (POLYMORPHIC RESOLUTION)
// =============================================================================

describe('getNodesSatisfying', () => {
  it('Timestamped → all concrete types that implement Timestamped', () => {
    const result = getNodesSatisfying(schema, 'Timestamped')
    expect(result).toEqual(expect.arrayContaining(['Customer', 'Product', 'Order', 'Review']))
    expect(result).toHaveLength(4)
  })

  it('Customer → [Customer] (concrete, just itself)', () => {
    expect(getNodesSatisfying(schema, 'Customer')).toEqual(['Customer'])
  })

  it('Category → [Category] (concrete, no implementors)', () => {
    expect(getNodesSatisfying(schema, 'Category')).toEqual(['Category'])
  })

  it('Warehouse → [Warehouse]', () => {
    expect(getNodesSatisfying(schema, 'Warehouse')).toEqual(['Warehouse'])
  })
})

// =============================================================================
// EDGE ENDPOINT RESOLUTION
// =============================================================================

describe('edge endpoint resolution', () => {
  it('placed_order: from → [Customer], to → [Order]', () => {
    expect(edgeFrom(schema, 'placed_order')).toEqual(['Customer'])
    expect(edgeTo(schema, 'placed_order')).toEqual(['Order'])
  })

  it('follows: from → [Customer], to → [Customer]', () => {
    expect(edgeFrom(schema, 'follows')).toEqual(['Customer'])
    expect(edgeTo(schema, 'follows')).toEqual(['Customer'])
  })

  it('order_item: from → [Order], to → [Product]', () => {
    expect(edgeFrom(schema, 'order_item')).toEqual(['Order'])
    expect(edgeTo(schema, 'order_item')).toEqual(['Product'])
  })

  it('categorized_as: from → [Product], to → [Category]', () => {
    expect(edgeFrom(schema, 'categorized_as')).toEqual(['Product'])
    expect(edgeTo(schema, 'categorized_as')).toEqual(['Category'])
  })

  it('category_parent: from → [Category], to → [Category]', () => {
    expect(edgeFrom(schema, 'category_parent')).toEqual(['Category'])
    expect(edgeTo(schema, 'category_parent')).toEqual(['Category'])
  })

  it('returns empty arrays for unknown edge', () => {
    expect(edgeFrom(schema, 'nonexistent')).toEqual([])
    expect(edgeTo(schema, 'nonexistent')).toEqual([])
  })
})

// =============================================================================
// EDGE CARDINALITY
// =============================================================================

describe('edge cardinality', () => {
  it('wrote_review: review has min:1/max:1 → outbound one, inbound many', () => {
    const card = edgeCardinality(schema, 'wrote_review')
    // review (source) has cardinality { min: 1, max: 1 } → outbound is 'one'
    // customer (target) has no cardinality → inbound is 'many'
    expect(card.outbound).toBe('one')
    expect(card.inbound).toBe('many')
  })

  it('placed_order: no cardinality constraints → both many', () => {
    const card = edgeCardinality(schema, 'placed_order')
    expect(card.outbound).toBe('many')
    expect(card.inbound).toBe('many')
  })

  it('category_parent: child has min:0/max:1 → outbound optional', () => {
    const card = edgeCardinality(schema, 'category_parent')
    // child (source) has cardinality { min: 0, max: 1 } → outbound is 'optional'
    // parent (target) has no cardinality → inbound is 'many'
    expect(card.outbound).toBe('optional')
    expect(card.inbound).toBe('many')
  })

  it('review_of: review has min:1/max:1 → outbound one, inbound many', () => {
    const card = edgeCardinality(schema, 'review_of')
    expect(card.outbound).toBe('one')
    expect(card.inbound).toBe('many')
  })

  it('unknown edge → both many (default)', () => {
    const card = edgeCardinality(schema, 'nonexistent')
    expect(card.outbound).toBe('many')
    expect(card.inbound).toBe('many')
  })
})

// =============================================================================
// isReified
// =============================================================================

describe('isReified', () => {
  it('returns false for edges in schema without reifyEdges flag', () => {
    expect(isReified(schema, 'placed_order')).toBe(false)
    expect(isReified(schema, 'order_item')).toBe(false)
    expect(isReified(schema, 'follows')).toBe(false)
  })

  it('returns false for unknown edge type', () => {
    expect(isReified(schema, 'nonexistent')).toBe(false)
  })

  it('respects per-edge reified override', () => {
    const modifiedSchema = {
      ...schema,
      edges: {
        ...schema.edges,
        order_item: {
          ...schema.edges.order_item,
          reified: true as const,
        },
      },
    }
    expect(isReified(modifiedSchema, 'order_item')).toBe(true)
    expect(isReified(modifiedSchema, 'placed_order')).toBe(false)
  })

  it('respects global reifyEdges flag', () => {
    const globalReifiedSchema = {
      ...schema,
      reifyEdges: true as const,
    }
    expect(isReified(globalReifiedSchema, 'placed_order')).toBe(true)
    expect(isReified(globalReifiedSchema, 'follows')).toBe(true)
  })

  it('per-edge override wins over global flag', () => {
    const mixedSchema = {
      ...schema,
      reifyEdges: true as const,
      edges: {
        ...schema.edges,
        follows: {
          ...schema.edges.follows,
          reified: false as const,
        },
      },
    }
    expect(isReified(mixedSchema, 'follows')).toBe(false)
    expect(isReified(mixedSchema, 'placed_order')).toBe(true)
  })
})
