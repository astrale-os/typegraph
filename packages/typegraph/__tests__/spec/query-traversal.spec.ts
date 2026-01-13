/**
 * Query Compilation Specification - Edge Traversal
 *
 * Tests for edge traversal operations: to(), from(), via()
 */

import { describe, it, expect } from "vitest"
import { normalizeCypher } from "./fixtures/test-schema"

describe("Query Compilation: Traversal", () => {
  // ===========================================================================
  // BASIC TRAVERSAL
  // ===========================================================================

  describe("Basic Edge Traversal", () => {
    it("compiles outgoing traversal with to()", () => {
      // graph.node('user').byId('u1').to('authored').compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[e0:authored]->(n1:post)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain("(n0)-[e0:authored]->(n1:post)")
    })

    it("compiles incoming traversal with from()", () => {
      // graph.node('post').byId('p1').from('authored').compile()
      const expected = `
        MATCH (n0:post {id: $p0})
        MATCH (n0)<-[e0:authored]-(n1:user)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain("(n0)<-[e0:authored]-(n1:user)")
    })

    it("compiles bidirectional traversal with via()", () => {
      // graph.node('user').byId('u1').via('follows').compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[e0:follows]-(n1:user)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain("(n0)-[e0:follows]-(n1:user)")
    })

    it("compiles chained traversals", () => {
      // graph.node('user').byId('u1')
      //   .to('authored')
      //   .from('commentedOn')
      //   .compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[e0:authored]->(n1:post)
        MATCH (n1)<-[e1:commentedOn]-(n2:comment)
        RETURN n2
      `

      expect(normalizeCypher(expected)).toContain("(n0)-[e0:authored]->(n1:post)")
      expect(normalizeCypher(expected)).toContain("(n1)<-[e1:commentedOn]-(n2:comment)")
    })
  })

  // ===========================================================================
  // OPTIONAL TRAVERSAL
  // ===========================================================================

  describe("Optional Traversal", () => {
    it("compiles optional outgoing traversal", () => {
      // graph.node('user').byId('u1').toOptional('authored').compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        OPTIONAL MATCH (n0)-[e0:authored]->(n1:post)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain("OPTIONAL MATCH")
    })

    it("compiles optional incoming traversal", () => {
      // graph.node('post').byId('p1').fromOptional('likes').compile()
      const expected = `
        MATCH (n0:post {id: $p0})
        OPTIONAL MATCH (n0)<-[e0:likes]-(n1:user)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain("OPTIONAL MATCH")
    })
  })

  // ===========================================================================
  // EDGE PROPERTY FILTERING
  // ===========================================================================

  describe("Edge Property Filtering", () => {
    it("compiles traversal with edge property filter", () => {
      // graph.node('user').byId('u1')
      //   .to('authored', { where: { role: { eq: 'author' } } })
      //   .compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[e0:authored]->(n1:post)
        WHERE e0.role = $p1
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain("WHERE e0.role = $p1")
    })

    it("compiles traversal with multiple edge property filters", () => {
      // graph.node('user').byId('u1')
      //   .to('memberOf', {
      //     where: {
      //       role: { eq: 'admin' },
      //       joinedAt: { gte: someDate }
      //     }
      //   })
      //   .compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[e0:memberOf]->(n1:organization)
        WHERE e0.role = $p1 AND e0.joinedAt >= $p2
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain("e0.role = $p1 AND e0.joinedAt >= $p2")
    })

    it("compiles traversal with edge IN filter", () => {
      // graph.node('user').byId('u1')
      //   .to('authored', { where: { role: { in: ['author', 'coauthor'] } } })
      //   .compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[e0:authored]->(n1:post)
        WHERE e0.role IN $p1
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain("WHERE e0.role IN $p1")
    })
  })

  // ===========================================================================
  // VARIABLE LENGTH PATHS
  // ===========================================================================

  describe("Variable Length Paths", () => {
    it("compiles unbounded variable length path", () => {
      // graph.node('folder').byId('f1')
      //   .to('hasParent', { depth: { min: 1 } })
      //   .compile()
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH (n0)-[e0:hasParent*1..]->(n1:folder)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain("hasParent*1..]")
    })

    it("compiles bounded variable length path", () => {
      // graph.node('folder').byId('f1')
      //   .to('hasParent', { depth: { min: 1, max: 5 } })
      //   .compile()
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH (n0)-[e0:hasParent*1..5]->(n1:folder)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain("hasParent*1..5]")
    })

    it("compiles exact depth path", () => {
      // graph.node('folder').byId('f1')
      //   .to('hasParent', { depth: { min: 2, max: 2 } })
      //   .compile()
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH (n0)-[e0:hasParent*2]->(n1:folder)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain("hasParent*2]")
    })

    it("compiles zero-or-more path", () => {
      // graph.node('folder').byId('f1')
      //   .to('hasParent', { depth: { min: 0 } })
      //   .compile()
      const expected = `
        MATCH (n0:folder {id: $p0})
        MATCH (n0)-[e0:hasParent*0..]->(n1:folder)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain("hasParent*0..]")
    })
  })

  // ===========================================================================
  // MULTI-EDGE TRAVERSAL
  // ===========================================================================

  describe("Multi-Edge Traversal", () => {
    it("compiles toAny with multiple edges", () => {
      // graph.node('user').byId('u1')
      //   .toAny(['authored', 'likes'])
      //   .compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[e0:authored|likes]->(n1)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain("authored|likes]")
    })

    it("compiles fromAny with multiple edges", () => {
      // graph.node('post').byId('p1')
      //   .fromAny(['authored', 'likes'])
      //   .compile()
      const expected = `
        MATCH (n0:post {id: $p0})
        MATCH (n0)<-[e0:authored|likes]-(n1)
        RETURN n1
      `

      expect(normalizeCypher(expected)).toContain("<-[e0:authored|likes]-")
    })
  })

  // ===========================================================================
  // EDGE ALIAS CAPTURE
  // ===========================================================================

  describe("Edge Alias Capture", () => {
    it("captures edge with edgeAs option", () => {
      // graph.node('user').byId('u1')
      //   .to('authored', { edgeAs: 'authorship' })
      //   .returning('authorship')
      //   .compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[e0:authored]->(n1:post)
        RETURN e0 AS authorship
      `

      expect(normalizeCypher(expected)).toContain("RETURN e0 AS authorship")
    })

    it("returns both node and edge properties", () => {
      // graph.node('user').byId('u1')
      //   .as('user')
      //   .to('authored', { edgeAs: 'authorship' })
      //   .as('post')
      //   .returning('user', 'post', 'authorship')
      //   .compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[e0:authored]->(n1:post)
        RETURN n0 AS user, n1 AS post, e0 AS authorship
      `

      expect(normalizeCypher(expected)).toContain("n0 AS user, n1 AS post, e0 AS authorship")
    })
  })
})
