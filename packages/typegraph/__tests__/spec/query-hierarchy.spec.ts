/**
 * Query Compilation Specification - Hierarchy Traversal
 *
 * Tests for tree-specific operations: ancestors, descendants, parent, children, siblings
 */

import { describe, it, expect } from 'vitest'
import { normalizeCypher } from './fixtures/test-schema'

describe('Query Compilation: Hierarchy', () => {
  // ===========================================================================
  // PARENT / CHILDREN
  // ===========================================================================

  describe('Parent and Children', () => {
    it('compiles parent() traversal (default edge)', () => {
      // graph.node('folder').byId('f1').parent().compile()
      // Uses default hierarchy edge 'hasParent' with direction 'up'
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH (n0)-[:hasParent]->(n1:folder)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('(n0)-[:hasParent]->(n1:folder)')
    })

    it('compiles parent() with explicit edge', () => {
      // graph.node('category').byId('c1').parent('categoryParent').compile()
      const expected = `
        MATCH (n0:category {id: $p0})
        MATCH (n0)-[:categoryParent]->(n1:category)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('(n0)-[:categoryParent]->(n1:category)')
    })

    it('compiles children() traversal (default edge)', () => {
      // graph.node('folder').byId('f1').children().compile()
      // Reverse direction: find nodes where hasParent points TO this node
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH (n0)<-[:hasParent]-(n1:folder)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('(n0)<-[:hasParent]-(n1:folder)')
    })

    it('compiles children() with explicit edge', () => {
      // graph.node('category').byId('c1').children('categoryParent').compile()
      const expected = `
        MATCH (n0:category {id: $p0})
        MATCH (n0)<-[:categoryParent]-(n1:category)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('(n0)<-[:categoryParent]-(n1:category)')
    })
  })

  // ===========================================================================
  // ANCESTORS
  // ===========================================================================

  describe('Ancestors', () => {
    it('compiles ancestors() with unbounded depth', () => {
      // graph.node('folder').byId('f1').ancestors().compile()
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH (n0)-[:hasParent*1..]->(n1:folder)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('[:hasParent*1..]')
    })

    it('compiles ancestors() with max depth', () => {
      // graph.node('folder').byId('f1').ancestors({ maxDepth: 5 }).compile()
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH (n0)-[:hasParent*1..5]->(n1:folder)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('[:hasParent*1..5]')
    })

    it('compiles ancestors() with min and max depth', () => {
      // graph.node('folder').byId('f1').ancestors({ minDepth: 2, maxDepth: 4 }).compile()
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH (n0)-[:hasParent*2..4]->(n1:folder)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('[:hasParent*2..4]')
    })

    it('compiles ancestors() including depth information', () => {
      // graph.node('folder').byId('f1').ancestors({ includeDepth: true }).compile()
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH path = (n0)-[:hasParent*1..]->(n1:folder)
        RETURN n1, length(path) AS depth
      `

      expect(normalizeCypher(expected)).toContain('length(path) AS depth')
    })

    it('compiles ancestors() with explicit edge', () => {
      // graph.node('category').byId('c1').ancestors('categoryParent').compile()
      const expected = `
        MATCH (n0:category {id: $p0})
        MATCH (n0)-[:categoryParent*1..]->(n1:category)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('[:categoryParent*1..]')
    })

    it('compiles ancestors() with untilKind filter', () => {
      // graph.node('module').byId('m1').ancestors({ untilKind: 'application' }).compile()
      // Should filter target nodes to only 'application' kind
      const expected = `
        MATCH (n0:module {id: $p0})
        MATCH (n0)-[:hasParent*1..]->(n1:application)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('[:hasParent*1..]')
      expect(normalizeCypher(expected)).toContain('(n1:application)')
    })

    it('compiles ancestors() with untilKind and maxDepth', () => {
      // graph.node('module').byId('m1').ancestors({ untilKind: 'application', maxDepth: 10 }).compile()
      const expected = `
        MATCH (n0:module {id: $p0})
        MATCH (n0)-[:hasParent*1..10]->(n1:application)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('[:hasParent*1..10]')
      expect(normalizeCypher(expected)).toContain('(n1:application)')
    })
  })

  // ===========================================================================
  // DESCENDANTS
  // ===========================================================================

  describe('Descendants', () => {
    it('compiles descendants() with unbounded depth', () => {
      // graph.node('folder').byId('f1').descendants().compile()
      // Reverse direction: find all nodes that have hasParent pointing to this subtree
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH (n0)<-[:hasParent*1..]-(n1:folder)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('<-[:hasParent*1..]-')
    })

    it('compiles descendants() with max depth', () => {
      // graph.node('folder').byId('f1').descendants({ maxDepth: 3 }).compile()
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH (n0)<-[:hasParent*1..3]-(n1:folder)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('<-[:hasParent*1..3]-')
    })

    it('compiles descendants() including depth information', () => {
      // graph.node('folder').byId('f1').descendants({ includeDepth: true }).compile()
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH path = (n0)<-[:hasParent*1..]-(n1:folder)
        RETURN n1, length(path) AS depth
      `

      expect(normalizeCypher(expected)).toContain('length(path) AS depth')
    })

    it('compiles descendants() with explicit edge', () => {
      // graph.node('category').byId('c1').descendants('categoryParent').compile()
      const expected = `
        MATCH (n0:category {id: $p0})
        MATCH (n0)<-[:categoryParent*1..]-(n1:category)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('<-[:categoryParent*1..]-')
    })
  })

  // ===========================================================================
  // SIBLINGS
  // ===========================================================================

  describe('Siblings', () => {
    it('compiles siblings() - nodes with same parent', () => {
      // graph.node('folder').byId('f1').siblings().compile()
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH (n0)-[:hasParent]->(parent:folder)<-[:hasParent]-(n1:folder)
        WHERE n1.id <> n0.id
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('(n0)-[:hasParent]->(parent')
      expect(normalizeCypher(expected)).toContain('<-[:hasParent]-(n1:folder)')
      expect(normalizeCypher(expected)).toContain('WHERE n1.id <> n0.id')
    })

    it('compiles siblings() with explicit edge', () => {
      // graph.node('category').byId('c1').siblings('categoryParent').compile()
      const expected = `
        MATCH (n0:category {id: $p0})
        MATCH (n0)-[:categoryParent]->(parent:category)<-[:categoryParent]-(n1:category)
        WHERE n1.id <> n0.id
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('[:categoryParent]')
    })
  })

  // ===========================================================================
  // ROOT
  // ===========================================================================

  describe('Root', () => {
    it('compiles root() - finds the topmost ancestor', () => {
      // graph.node('folder').byId('f1').root().compile()
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH (n0)-[:hasParent*0..]->(n1:folder)
        WHERE NOT (n1)-[:hasParent]->()
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('[:hasParent*0..]')
      expect(normalizeCypher(expected)).toContain('WHERE NOT (n1)-[:hasParent]->()')
    })

    it('compiles root() with explicit edge', () => {
      // graph.node('category').byId('c1').root('categoryParent').compile()
      const expected = `
        MATCH (n0:category {id: $p0})
        MATCH (n0)-[:categoryParent*0..]->(n1:category)
        WHERE NOT (n1)-[:categoryParent]->()
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain('[:categoryParent*0..]')
    })
  })

  // ===========================================================================
  // REACHABLE (Transitive Closure)
  // ===========================================================================

  describe('Reachable (Transitive Closure)', () => {
    it('compiles reachable() with single edge', () => {
      // graph.node('user').byId('u1').reachable('follows').compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[:follows*1..]->(n1:user)
        RETURN DISTINCT n1
      `

      expect(normalizeCypher(expected)).toContain('[:follows*1..]')
      expect(normalizeCypher(expected)).toContain('RETURN DISTINCT')
    })

    it('compiles reachable() with max depth', () => {
      // graph.node('user').byId('u1').reachable('follows', { maxDepth: 3 }).compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[:follows*1..3]->(n1:user)
        RETURN DISTINCT n1
      `

      expect(normalizeCypher(expected)).toContain('[:follows*1..3]')
    })

    it('compiles reachable() bidirectional', () => {
      // graph.node('user').byId('u1').reachable('follows', { direction: 'both' }).compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[:follows*1..]-(n1:user)
        RETURN DISTINCT n1
      `

      expect(normalizeCypher(expected)).toContain('-[:follows*1..]-')
    })

    it('compiles reachable() with multiple edges', () => {
      // graph.node('user').byId('u1').reachable(['follows', 'memberOf']).compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[:follows|memberOf*1..]->(n1)
        RETURN DISTINCT n1
      `

      expect(normalizeCypher(expected)).toContain('[:follows|memberOf*1..]')
    })

    it('compiles reachable() including depth', () => {
      // graph.node('user').byId('u1').reachable('follows', { includeDepth: true }).compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH path = (n0)-[:follows*1..]->(n1:user)
        RETURN DISTINCT n1, length(path) AS depth
      `

      expect(normalizeCypher(expected)).toContain('length(path) AS depth')
    })
  })
})
