/**
 * E2E: Hierarchy Query Building → Cypher Compilation
 *
 * Tests the hierarchy traversal API (parent, children, ancestors, descendants)
 * against the e-commerce schema, verifying that SDK calls produce the expected
 * Cypher output.
 *
 * Schema hierarchy config:
 *   hierarchy: { defaultEdge: 'category_parent', direction: 'up' }
 *
 * The `category_parent` edge connects Category → Category (child → 0..1 parent).
 * With direction: 'up', parent/ancestors follow outgoing edges (-[]->) and
 * children/descendants follow incoming edges (<-[]-)
 */

import { describe, it, expect } from 'vitest'
import { q, cypher } from './helpers'

// =============================================================================
// PARENT (single hop up the hierarchy)
// =============================================================================

describe('parent', () => {
  it('compiles parent traversal for a category by id', () => {
    const result = q.node('Category').byId('c1').parent().compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Category)
      WHERE n0.id = $p0
      MATCH (n0)-[:category_parent]->(n1:Category)
      RETURN n1
    `)
    expect(result.params).toEqual({ p0: 'c1' })
  })
})

// =============================================================================
// CHILDREN (single hop down the hierarchy)
// =============================================================================

describe('children', () => {
  it('compiles children traversal for a category by id', () => {
    const result = q.node('Category').byId('c1').children().compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Category)
      WHERE n0.id = $p0
      MATCH (n0)<-[:category_parent]-(n1:Category)
      RETURN n1
    `)
    expect(result.params).toEqual({ p0: 'c1' })
  })
})

// =============================================================================
// ANCESTORS (variable-length traversal up)
// =============================================================================

describe('ancestors', () => {
  it('compiles ancestors traversal for a category by id', () => {
    const result = q.node('Category').byId('c1').ancestors().compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Category)
      WHERE n0.id = $p0
      MATCH (n0)-[:category_parent*1..]->(n1:Category)
      RETURN n1
    `)
    expect(result.params).toEqual({ p0: 'c1' })
  })
})

// =============================================================================
// DESCENDANTS (variable-length traversal down)
// =============================================================================

describe('descendants', () => {
  it('compiles descendants traversal for a category by id', () => {
    const result = q.node('Category').byId('c1').descendants().compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Category)
      WHERE n0.id = $p0
      MATCH (n0)<-[:category_parent*1..]-(n1:Category)
      RETURN n1
    `)
    expect(result.params).toEqual({ p0: 'c1' })
  })
})
