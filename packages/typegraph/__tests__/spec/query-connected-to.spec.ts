/**
 * Query Compilation Specification - whereConnectedTo Optimization
 *
 * Tests for the whereConnectedTo/whereConnectedFrom filtering operations.
 *
 * CRITICAL OPTIMIZATION CONCERN:
 * The naive compilation of whereConnectedTo generates:
 *   MATCH (n0:module)
 *   WHERE (n0)-[:ofType]->({id: $p0})
 *
 * This is potentially a FULL LABEL SCAN because the query planner may:
 * 1. Scan all :module nodes
 * 2. For each, check if the edge pattern matches
 *
 * The OPTIMAL compilation should be:
 *   MATCH (n0:module)-[:ofType]->(target0 {id: $p0})
 *
 * This allows the query planner to:
 * 1. Start from the indexed {id: $p0} lookup
 * 2. Traverse backwards to find connected modules
 */

import { describe, it, expect } from "vitest"
import { createGraph } from "../../src"
import { testSchema, normalizeCypher, cypherEquals } from "./fixtures/test-schema"

// Create a graph instance for compilation testing (no executor needed)
const graph = createGraph(testSchema, { uri: "bolt://localhost:7687" })

describe("Query Compilation: whereConnectedTo Optimization", () => {
  // ===========================================================================
  // CURRENT BEHAVIOR (documenting what we have)
  // ===========================================================================

  describe("Current Behavior (to be optimized)", () => {
    it("compiles single whereConnectedTo", () => {
      const compiled = graph.node("post").whereConnectedTo("categorizedAs", "cat_123").compile()

      console.log("Current output:", compiled.cypher)
      console.log("Params:", compiled.params)

      // Document current (suboptimal) output
      expect(compiled.cypher).toContain("MATCH (n0:post)")
      expect(compiled.params).toHaveProperty("p0", "cat_123")
    })

    it("compiles chained whereConnectedTo filters", () => {
      // Real-world use case: find posts in a category by a specific author
      const compiled = graph
        .node("post")
        .whereConnectedTo("categorizedAs", "cat_123")
        .from("authored") // Get the author
        .where("id", "eq", "user_456")
        .compile()

      console.log("Chained output:", compiled.cypher)
      console.log("Params:", compiled.params)
    })
  })

  // ===========================================================================
  // OPTIMAL COMPILATION TARGETS
  // ===========================================================================

  describe("Optimal Compilation (target behavior)", () => {
    it("should compile single whereConnectedTo as MATCH pattern", () => {
      const compiled = graph.node("post").whereConnectedTo("categorizedAs", "cat_123").compile()

      // OPTIMAL: Uses explicit MATCH pattern that enables index-based lookup
      const optimal = `
        MATCH (n0:post)-[:categorizedAs]->(target0 {id: $p0})
        RETURN n0
      `

      // SUBOPTIMAL (current): Uses WHERE pattern that may cause full scan
      const suboptimal = `
        MATCH (n0:post)
        WHERE (n0)-[:categorizedAs]->({id: $p0})
        RETURN n0
      `

      console.log("Actual:", normalizeCypher(compiled.cypher))
      console.log("Optimal:", normalizeCypher(optimal))
      console.log("Suboptimal:", normalizeCypher(suboptimal))

      // Test should pass when optimization is implemented
      // expect(cypherEquals(compiled.cypher, optimal)).toBe(true)
    })

    it("should compile multiple whereConnectedTo as chained MATCH patterns", () => {
      // This is the critical use case from modules.adapter.ts
      // Finding modules with BOTH a specific parent AND a specific type
      const compiled = graph
        .node("folder")
        .whereConnectedTo("hasParent", "folder_parent")
        .whereConnectedTo("owns", "user_owner") // Note: folder doesn't have 'owns' in test schema, using for illustration
        .compile()

      // OPTIMAL: Each constraint becomes a MATCH clause
      // The query planner can start from either indexed ID
      const optimal = `
        MATCH (n0:folder)-[:hasParent]->(target0 {id: $p0})
        MATCH (n0)-[:owns]->(target1 {id: $p1})
        RETURN n0
      `

      console.log("Multiple whereConnectedTo actual:", normalizeCypher(compiled.cypher))
      console.log("Multiple whereConnectedTo optimal:", normalizeCypher(optimal))
    })

    it("should compile whereConnectedFrom as reverse MATCH pattern", () => {
      // Find users that have posts authored by them
      const compiled = graph.node("user").whereConnectedFrom("authored", "post_123").compile()

      // OPTIMAL: Incoming edge pattern
      const optimal = `
        MATCH (n0:user)<-[:authored]-(source0 {id: $p0})
        RETURN n0
      `

      console.log("whereConnectedFrom actual:", normalizeCypher(compiled.cypher))
      console.log("whereConnectedFrom optimal:", normalizeCypher(optimal))
    })
  })

  // ===========================================================================
  // REAL-WORLD KERNEL USE CASES
  // ===========================================================================

  describe("Real-world Kernel Use Cases", () => {
    it("findChildByType: modules with specific parent AND type", () => {
      // This is the exact pattern from modules.adapter.ts:findChildByType
      // graph.node("module")
      //   .whereConnectedTo("hasParent", parentId)
      //   .whereConnectedTo("ofType", typeId)

      // Using test schema equivalent
      const compiled = graph
        .node("post")
        .whereConnectedTo("categorizedAs", "cat_tech") // like ofType
        .where("viewCount", "gt", 100) // additional filter
        .compile()

      console.log("findChildByType pattern:", compiled.cypher)

      // OPTIMAL should be:
      // MATCH (n0:post)-[:categorizedAs]->(target0 {id: $p0})
      // WHERE n0.viewCount > $p1
      // RETURN n0
    })

    it("listByType: all descendants of root with specific type", () => {
      // Pattern: get descendants, then filter by type connection
      // This shows whereConnectedTo after traversal

      const compiled = graph
        .node("folder")
        .byId("root_folder")
        .descendants()
        .whereConnectedTo("hasParent", "some_parent") // Filter descendants
        .compile()

      console.log("listByType pattern:", compiled.cypher)
    })

    it("combined: byId + whereConnectedTo", () => {
      // Starting from a specific node, then filtering by connection
      const compiled = graph
        .node("user")
        .byId("user_123")
        .to("authored")
        .whereConnectedTo("categorizedAs", "cat_tech")
        .compile()

      console.log("byId + whereConnectedTo:", compiled.cypher)
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe("Edge Cases", () => {
    it("handles whereConnectedTo on collection (not single node)", () => {
      // Starting from a collection, not byId
      const compiled = graph
        .node("post")
        .where("viewCount", "gt", 1000)
        .whereConnectedTo("categorizedAs", "cat_popular")
        .compile()

      console.log("Collection + whereConnectedTo:", compiled.cypher)
    })

    it("handles whereConnectedTo after traversal", () => {
      // Traverse first, then filter by connection
      const compiled = graph
        .node("user")
        .byId("user_123")
        .to("authored") // Now we're at posts
        .whereConnectedTo("categorizedAs", "cat_tech") // Filter posts by category
        .compile()

      console.log("Traversal + whereConnectedTo:", compiled.cypher)
    })

    it("handles multiple different edge types", () => {
      // Filter by connections to different node types
      const compiled = graph
        .node("post")
        .whereConnectedTo("categorizedAs", "cat_123")
        .from("authored") // Different edge direction
        .compile()

      console.log("Mixed edge directions:", compiled.cypher)
    })
  })

  // ===========================================================================
  // PERFORMANCE ASSERTIONS (these actually verify the optimization)
  // ===========================================================================

  describe("Performance Characteristics", () => {
    it("should NOT contain anonymous node patterns in WHERE clause", () => {
      const compiled = graph.node("post").whereConnectedTo("categorizedAs", "cat_123").compile()

      // The anti-pattern we want to avoid:
      // WHERE (n0)-[:categorizedAs]->({id: $p0})
      //
      // The anonymous ({id: ...}) doesn't give the query planner
      // enough information to use an index

      const hasAnonymousPattern = compiled.cypher.includes("->({id:")

      console.log("Has anonymous pattern:", hasAnonymousPattern)
      console.log("Query:", compiled.cypher)

      // ASSERTION: No anonymous patterns should exist
      expect(hasAnonymousPattern).toBe(false)
    })

    it("should use explicit MATCH patterns for whereConnectedTo", () => {
      const compiled = graph.node("post").whereConnectedTo("categorizedAs", "cat_123").compile()

      // Count MATCH clauses - optimal compilation should have 2:
      // 1. Initial MATCH (n0:post)
      // 2. MATCH (n0)-[:categorizedAs]->(ct1 {id: $p0})
      const matchCount = (compiled.cypher.match(/MATCH/g) || []).length

      console.log("MATCH count:", matchCount)
      console.log("Query:", compiled.cypher)

      // ASSERTION: Should have 2 MATCH clauses (initial + connectedTo)
      expect(matchCount).toBe(2)
    })

    it("should use named target node in MATCH pattern", () => {
      const compiled = graph.node("post").whereConnectedTo("categorizedAs", "cat_123").compile()

      // The pattern should have a named node like (ct1 {id: $p0})
      // Not an anonymous node like ({id: $p0})
      const hasNamedTarget = /\(ct\d+ \{id: \$p\d+\}\)/.test(compiled.cypher)

      expect(hasNamedTarget).toBe(true)
    })

    it("should handle multiple whereConnectedTo with separate MATCH clauses", () => {
      const compiled = graph
        .node("folder")
        .whereConnectedTo("hasParent", "parent_123")
        .whereConnectedTo("owns", "owner_456")
        .compile()

      // Should have 3 MATCH clauses: initial + 2 connectedTo
      const matchCount = (compiled.cypher.match(/MATCH/g) || []).length
      expect(matchCount).toBe(3)

      // Both target nodes should be named
      expect(compiled.cypher).toContain("(ct1 {id: $p0})")
      expect(compiled.cypher).toContain("(ct2 {id: $p1})")
    })

    it("should NOT put connectedTo conditions in WHERE clause", () => {
      const compiled = graph.node("post").whereConnectedTo("categorizedAs", "cat_123").compile()

      // The WHERE clause should NOT contain edge patterns
      const whereClauseMatch = compiled.cypher.match(/WHERE.*\[:.*\]/s)

      expect(whereClauseMatch).toBeNull()
    })
  })
})

// ===========================================================================
// COMPILATION SNAPSHOTS
// ===========================================================================

describe("Compilation Snapshots", () => {
  it("snapshot: simple whereConnectedTo", () => {
    const compiled = graph.node("post").whereConnectedTo("categorizedAs", "cat_123").compile()

    // Snapshot for tracking changes
    expect(compiled).toMatchSnapshot()
  })

  it("snapshot: chained whereConnectedTo", () => {
    const compiled = graph
      .node("folder")
      .whereConnectedTo("hasParent", "parent_123")
      .where("name", "eq", "test")
      .compile()

    expect(compiled).toMatchSnapshot()
  })

  it("snapshot: whereConnectedFrom", () => {
    const compiled = graph.node("category").whereConnectedFrom("categorizedAs", "post_123").compile()

    expect(compiled).toMatchSnapshot()
  })
})

// ===========================================================================
// COMPLEX MULTI-CONSTRAINT QUERIES
// ===========================================================================

describe("Complex Multi-Constraint Queries", () => {
  it("handles 3 whereConnectedTo constraints", () => {
    const compiled = graph
      .node("post")
      .whereConnectedTo("categorizedAs", "cat_tech")
      .whereConnectedTo("categorizedAs", "cat_featured")
      .whereConnectedTo("likes", "user_curator")
      .compile()

    console.log("3 constraints:\n", compiled.cypher)
    console.log("Params:", compiled.params)

    // Should have 4 MATCH clauses: initial + 3 connectedTo
    const matchCount = (compiled.cypher.match(/MATCH/g) || []).length
    expect(matchCount).toBe(4)

    // Each constraint should have its own named target
    expect(compiled.cypher).toContain("(ct1 {id: $p0})")
    expect(compiled.cypher).toContain("(ct2 {id: $p1})")
    expect(compiled.cypher).toContain("(ct3 {id: $p2})")
  })

  it("handles 5 whereConnectedTo constraints", () => {
    const compiled = graph
      .node("post")
      .whereConnectedTo("categorizedAs", "cat_1")
      .whereConnectedTo("categorizedAs", "cat_2")
      .whereConnectedTo("categorizedAs", "cat_3")
      .whereConnectedTo("likes", "user_1")
      .whereConnectedTo("likes", "user_2")
      .compile()

    console.log("5 constraints:\n", compiled.cypher)
    console.log("Params:", compiled.params)

    // Should have 6 MATCH clauses
    const matchCount = (compiled.cypher.match(/MATCH/g) || []).length
    expect(matchCount).toBe(6)

    // All 5 params should be present
    expect(Object.keys(compiled.params)).toHaveLength(5)
  })

  it("handles mixed whereConnectedTo and whereConnectedFrom", () => {
    const compiled = graph
      .node("post")
      .whereConnectedTo("categorizedAs", "cat_tech")
      .whereConnectedFrom("authored", "user_author")
      .whereConnectedFrom("likes", "user_fan")
      .compile()

    console.log("Mixed directions:\n", compiled.cypher)

    // Check both directions are correct
    expect(compiled.cypher).toContain("->") // outgoing
    expect(compiled.cypher).toContain("<-") // incoming
  })

  it("handles whereConnectedTo with property filters interleaved", () => {
    const compiled = graph
      .node("post")
      .where("viewCount", "gt", 1000)
      .whereConnectedTo("categorizedAs", "cat_tech")
      .where("title", "contains", "Guide")
      .whereConnectedTo("likes", "user_influencer")
      .where("publishedAt", "isNotNull")
      .compile()

    console.log("Interleaved filters:\n", compiled.cypher)
    console.log("Params:", compiled.params)

    // Should have proper separation of MATCH and WHERE
    const matchCount = (compiled.cypher.match(/MATCH/g) || []).length
    const whereCount = (compiled.cypher.match(/WHERE/g) || []).length

    expect(matchCount).toBe(3) // initial + 2 connectedTo
    expect(whereCount).toBe(3) // 3 property filters
  })

  it("handles complex query after traversal", () => {
    // Start from user, traverse to posts, then apply multiple constraints
    const compiled = graph
      .node("user")
      .byId("user_123")
      .to("authored")
      .whereConnectedTo("categorizedAs", "cat_tech")
      .whereConnectedTo("categorizedAs", "cat_tutorial")
      .where("viewCount", "gt", 500)
      .compile()

    console.log("After traversal + multi-constraint:\n", compiled.cypher)

    // Verify structure
    expect(compiled.cypher).toContain("MATCH (n0:user)")
    expect(compiled.cypher).toContain("-[e2:authored]->")
    expect(compiled.cypher).toContain("(ct")
  })

  it("handles whereConnectedTo on descendants", () => {
    const compiled = graph
      .node("folder")
      .byId("root_folder")
      .descendants()
      .whereConnectedTo("hasParent", "special_parent")
      .whereConnectedTo("owns", "special_owner")
      .compile()

    console.log("Descendants + multi-constraint:\n", compiled.cypher)

    // Should have hierarchy traversal + connectedTo constraints
    expect(compiled.cypher).toContain("hasParent*")
  })

  it("generates valid Cypher for kernel-like query pattern", () => {
    // Simulating the kernel pattern: find modules by parent, type, and permission
    const compiled = graph
      .node("folder")
      .whereConnectedTo("hasParent", "parent_module_id")
      .whereConnectedTo("owns", "owner_user_id")
      .where("name", "eq", "important")
      .compile()

    console.log("Kernel-like pattern:\n", compiled.cypher)

    // The query should be well-formed
    expect(compiled.cypher).not.toContain("undefined")
    expect(compiled.cypher).not.toContain("null")
    
    // Params should match constraints
    expect(compiled.params.p0).toBe("parent_module_id")
    expect(compiled.params.p1).toBe("owner_user_id")
    expect(compiled.params.p2).toBe("important")
  })
})

describe("Complex Interleaved Chains", () => {
  it("traversal -> whereConnectedTo -> traversal -> whereConnectedTo", () => {
    // user -> posts (filtered) -> comments -> filter again
    const compiled = graph
      .node("user")
      .byId("user_123")
      .to("authored")                              // -> posts
      .whereConnectedTo("categorizedAs", "cat_tech") // posts in tech category
      .from("commentedOn")                         // -> comments on those posts
      .whereConnectedTo("writtenBy", "commenter_456") // comments by specific user
      .compile()

    console.log("Traversal-filter-traversal-filter:\n", compiled.cypher)
    console.log("Params:", compiled.params)

    expect(compiled.cypher).toContain("authored")
    expect(compiled.cypher).toContain("commentedOn")
    expect(compiled.cypher).toContain("categorizedAs")
    expect(compiled.cypher).toContain("writtenBy")
  })

  it("whereConnectedTo -> traversal -> whereConnectedTo -> traversal", () => {
    // Start filtered, traverse, filter again, traverse again
    const compiled = graph
      .node("post")
      .whereConnectedTo("categorizedAs", "cat_featured")  // featured posts
      .from("authored")                                    // -> authors of featured posts
      .whereConnectedTo("memberOf", "org_acme")           // authors in ACME org
      .to("follows")                                       // -> who those authors follow
      .compile()

    console.log("Filter-traverse-filter-traverse:\n", compiled.cypher)
    
    expect(compiled.cypher).toContain("categorizedAs")
    expect(compiled.cypher).toContain("authored")
    expect(compiled.cypher).toContain("memberOf")
    expect(compiled.cypher).toContain("follows")
  })

  it("byId -> to -> whereConnectedTo -> from -> to -> whereConnectedTo", () => {
    // Complex path through the graph
    const compiled = graph
      .node("user")
      .byId("seed_user")
      .to("authored")                                  // user's posts
      .whereConnectedTo("categorizedAs", "cat_1")     // in category 1
      .from("likes")                                   // users who liked those posts
      .to("memberOf")                                  // organizations they belong to
      .whereConnectedTo("categoryParent", "parent_org") // orgs under parent
      .compile()

    console.log("Long chain with multiple constraints:\n", compiled.cypher)
    console.log("Params:", compiled.params)
  })

  it("multiple whereConnectedTo at different traversal depths", () => {
    const compiled = graph
      .node("user")
      .byId("root_user")
      .whereConnectedTo("memberOf", "org_1")           // constraint on user
      .to("authored")
      .whereConnectedTo("categorizedAs", "cat_1")     // constraint on posts
      .whereConnectedTo("likes", "influencer_1")      // another constraint on posts
      .from("commentedOn")
      .whereConnectedTo("writtenBy", "trusted_user")  // constraint on comments
      .compile()

    console.log("Constraints at multiple depths:\n", compiled.cypher)
    console.log("Params:", compiled.params)

    // Should have constraints on different node aliases
    expect(compiled.params.p0).toBe("root_user")
    expect(compiled.params.p1).toBe("org_1")
    expect(compiled.params.p2).toBe("cat_1")
  })

  it("hierarchy traversal with whereConnectedTo at multiple levels", () => {
    const compiled = graph
      .node("folder")
      .byId("start_folder")
      .whereConnectedTo("owns", "owner_1")            // owner of start folder
      .ancestors()                                     // go up the tree
      .whereConnectedTo("owns", "ancestor_owner")     // ancestors owned by specific user
      .compile()

    console.log("Hierarchy with constraints:\n", compiled.cypher)
  })

  it("via (bidirectional) with whereConnectedTo", () => {
    const compiled = graph
      .node("user")
      .byId("user_1")
      .via("follows")                                  // followers/following
      .whereConnectedTo("memberOf", "same_org")       // in same org
      .to("authored")
      .whereConnectedTo("categorizedAs", "shared_interest")
      .compile()

    console.log("Bidirectional + constraints:\n", compiled.cypher)
  })

  it("optional traversal with whereConnectedTo", () => {
    const compiled = graph
      .node("user")
      .byId("user_1")
      .toOptional("authored")                          // might not have posts
      .whereConnectedTo("categorizedAs", "cat_1")     // if has posts, filter them
      .compile()

    console.log("Optional + constraint:\n", compiled.cypher)
    
    expect(compiled.cypher).toContain("OPTIONAL MATCH")
  })
})
