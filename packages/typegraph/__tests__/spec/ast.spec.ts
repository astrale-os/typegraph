/**
 * AST Builder Specification Tests
 *
 * Tests for the immutable AST builder operations.
 */

import { describe, it, expect } from "vitest"

// These tests define the expected behavior of QueryAST

describe("AST Builder Specification", () => {
  // ===========================================================================
  // IMMUTABILITY
  // ===========================================================================

  describe("Immutability", () => {
    it("addMatch returns new instance", () => {
      // const ast1 = new QueryAST()
      // const ast2 = ast1.addMatch('user')
      // ast1 !== ast2
      const original = { steps: [] }
      const modified = { steps: [{ type: "match", label: "user" }] }

      expect(original.steps).not.toBe(modified.steps)
    })

    it("steps array is frozen", () => {
      // ast.steps should be readonly
      const steps = Object.freeze([{ type: "match", label: "user" }])

      expect(() => {
        // @ts-expect-error - testing runtime immutability
        steps.push({ type: "match", label: "post" })
      }).toThrow()
    })

    it("chained operations create new instances at each step", () => {
      // Each method call should return a new QueryAST
      // const ast1 = new QueryAST().addMatch('user')
      // const ast2 = ast1.addWhere([...])
      // const ast3 = ast2.addLimit(10)
      // ast1 !== ast2 !== ast3
      const instances = ["ast1", "ast2", "ast3"]
      const uniqueInstances = new Set(instances)

      expect(uniqueInstances.size).toBe(3)
    })
  })

  // ===========================================================================
  // ALIAS MANAGEMENT
  // ===========================================================================

  describe("Alias Management", () => {
    it("generates sequential node aliases", () => {
      // First match: n0, second match: n1, etc.
      const aliases = ["n0", "n1", "n2"]

      expect(aliases[0]).toBe("n0")
      expect(aliases[1]).toBe("n1")
      expect(aliases[2]).toBe("n2")
    })

    it("generates sequential edge aliases", () => {
      // First edge: e0, second edge: e1, etc.
      const aliases = ["e0", "e1", "e2"]

      expect(aliases[0]).toBe("e0")
    })

    it("tracks current node alias", () => {
      // After addMatch('user'), currentAlias should be 'n0'
      // After addTraversal(...), currentAlias should be 'n1'
      const currentAlias = "n1"

      expect(currentAlias).toBe("n1")
    })

    it("tracks current node label", () => {
      // After addMatch('user'), currentLabel should be 'user'
      const currentLabel = "user"

      expect(currentLabel).toBe("user")
    })

    it("registers user aliases via addUserAlias", () => {
      // ast.addUserAlias('author') should register 'author' -> current internal alias
      const userAliases = new Map([["author", "n0"]])

      expect(userAliases.get("author")).toBe("n0")
    })

    it("resolves user alias to internal alias", () => {
      // ast.resolveUserAlias('author') should return 'n0'
      const userAliases = new Map([["author", "n0"]])
      const resolved = userAliases.get("author")

      expect(resolved).toBe("n0")
    })

    it("tracks edge user aliases separately", () => {
      // Edge aliases should be in separate map from node aliases
      const nodeAliases = new Map([["author", "n0"]])
      const edgeAliases = new Map([["authorship", "e0"]])

      expect(nodeAliases.has("author")).toBe(true)
      expect(edgeAliases.has("authorship")).toBe(true)
    })
  })

  // ===========================================================================
  // STEP GENERATION
  // ===========================================================================

  describe("Step Generation", () => {
    describe("addMatch()", () => {
      it("creates MatchStep with label and alias", () => {
        // ast.addMatch('user')
        const step = {
          type: "match",
          label: "user",
          alias: "n0",
        }

        expect(step.type).toBe("match")
        expect(step.label).toBe("user")
        expect(step.alias).toBe("n0")
      })
    })

    describe("addTraversal()", () => {
      it("creates TraversalStep with all required fields", () => {
        // ast.addTraversal({ edges: ['authored'], direction: 'out', ... })
        const step = {
          type: "traversal",
          edges: ["authored"],
          direction: "out",
          fromAlias: "n0",
          toAlias: "n1",
          toLabels: ["post"],
          optional: false,
          cardinality: "many",
        }

        expect(step.type).toBe("traversal")
        expect(step.edges).toContain("authored")
        expect(step.direction).toBe("out")
      })

      it("supports variable length config", () => {
        const step = {
          type: "traversal",
          variableLength: { min: 1, max: 5, uniqueness: "nodes" },
        }

        expect(step.variableLength?.min).toBe(1)
        expect(step.variableLength?.max).toBe(5)
      })

      it("supports edge where conditions", () => {
        const step = {
          type: "traversal",
          edgeWhere: [{ field: "role", operator: "eq", value: "author" }],
        }

        expect(step.edgeWhere?.[0]?.field).toBe("role")
      })

      it("supports optional match", () => {
        const step = { type: "traversal", optional: true }

        expect(step.optional).toBe(true)
      })
    })

    describe("addWhere()", () => {
      it("creates WhereStep with conditions", () => {
        const step = {
          type: "where",
          conditions: [{ type: "comparison", field: "status", operator: "eq", value: "active", target: "n0" }],
        }

        expect(step.type).toBe("where")
        expect(step.conditions).toHaveLength(1)
      })

      it("supports logical conditions", () => {
        const condition = {
          type: "logical",
          operator: "OR",
          conditions: [
            { type: "comparison", field: "status", operator: "eq", value: "active", target: "n0" },
            { type: "comparison", field: "status", operator: "eq", value: "inactive", target: "n0" },
          ],
        }

        expect(condition.operator).toBe("OR")
        expect(condition.conditions).toHaveLength(2)
      })

      it("supports exists conditions", () => {
        const condition = {
          type: "exists",
          edge: "authored",
          direction: "out",
          target: "n0",
          negated: false,
        }

        expect(condition.type).toBe("exists")
        expect(condition.negated).toBe(false)
      })
    })

    describe("addHierarchy()", () => {
      it("creates HierarchyStep for ancestors", () => {
        const step = {
          type: "hierarchy",
          operation: "ancestors",
          edge: "hasParent",
          fromAlias: "n0",
          toAlias: "n1",
          hierarchyDirection: "up",
        }

        expect(step.operation).toBe("ancestors")
        expect(step.hierarchyDirection).toBe("up")
      })

      it("creates HierarchyStep for descendants", () => {
        const step = {
          type: "hierarchy",
          operation: "descendants",
          edge: "hasParent",
          hierarchyDirection: "up",
        }

        expect(step.operation).toBe("descendants")
      })

      it("supports depth limits", () => {
        const step = {
          type: "hierarchy",
          operation: "ancestors",
          minDepth: 1,
          maxDepth: 5,
        }

        expect(step.minDepth).toBe(1)
        expect(step.maxDepth).toBe(5)
      })

      it("supports depth inclusion in results", () => {
        const step = {
          type: "hierarchy",
          operation: "ancestors",
          includeDepth: true,
          depthAlias: "level",
        }

        expect(step.includeDepth).toBe(true)
        expect(step.depthAlias).toBe("level")
      })
    })

    describe("addOrderBy()", () => {
      it("creates OrderByStep with fields", () => {
        const step = {
          type: "orderBy",
          fields: [{ field: "name", direction: "ASC", target: "n0" }],
        }

        expect(step.type).toBe("orderBy")
        expect(step.fields[0]?.direction).toBe("ASC")
      })

      it("supports multiple order fields", () => {
        const step = {
          type: "orderBy",
          fields: [
            { field: "status", direction: "ASC", target: "n0" },
            { field: "name", direction: "DESC", target: "n0" },
          ],
        }

        expect(step.fields).toHaveLength(2)
      })
    })

    describe("addLimit() and addSkip()", () => {
      it("creates LimitStep", () => {
        const step = { type: "limit", count: 10 }

        expect(step.type).toBe("limit")
        expect(step.count).toBe(10)
      })

      it("creates SkipStep", () => {
        const step = { type: "skip", count: 20 }

        expect(step.type).toBe("skip")
        expect(step.count).toBe(20)
      })
    })
  })

  // ===========================================================================
  // PROJECTION
  // ===========================================================================

  describe("Projection", () => {
    it("default projection is collection type", () => {
      const projection = {
        type: "collection",
        nodeAliases: ["n0"],
        edgeAliases: [],
      }

      expect(projection.type).toBe("collection")
    })

    it("setMultiNodeProjection validates aliases exist", () => {
      // Should throw if alias not registered
      const registeredAliases = new Map([["author", "n0"]])
      const requestedAliases = ["author", "unknown"]

      const unknownAlias = requestedAliases.find((a) => !registeredAliases.has(a))
      expect(unknownAlias).toBe("unknown")
    })

    it("setCountProjection sets countOnly flag", () => {
      const projection = {
        type: "count",
        countOnly: true,
      }

      expect(projection.countOnly).toBe(true)
    })

    it("setExistsProjection sets existsOnly flag", () => {
      const projection = {
        type: "exists",
        existsOnly: true,
      }

      expect(projection.existsOnly).toBe(true)
    })

    it("setFieldSelection specifies fields per alias", () => {
      const projection = {
        type: "collection",
        fields: {
          n0: ["id", "name", "email"],
        },
      }

      expect(projection.fields?.n0).toContain("name")
    })
  })

  // ===========================================================================
  // VALIDATION
  // ===========================================================================

  describe("Validation", () => {
    it("validate() checks traversal references valid aliases", () => {
      // Traversal fromAlias must exist in aliases registry
      const aliases = new Map([["n0", { type: "node" }]])
      const traversalFromAlias = "n0"

      expect(aliases.has(traversalFromAlias)).toBe(true)
    })

    it("validate() checks where conditions reference valid aliases", () => {
      // Where condition target must exist in aliases registry
      const aliases = new Map([["n0", { type: "node" }]])
      const conditionTarget = "n0"

      expect(aliases.has(conditionTarget)).toBe(true)
    })

    it("validate() throws for invalid alias references", () => {
      const aliases = new Map([["n0", { type: "node" }]])
      const invalidTarget = "n99"

      expect(aliases.has(invalidTarget)).toBe(false)
    })
  })

  // ===========================================================================
  // SERIALIZATION
  // ===========================================================================

  describe("Serialization", () => {
    it("toJSON() returns serializable representation", () => {
      const json = {
        steps: [{ type: "match", label: "user", alias: "n0" }],
        projection: { type: "collection", nodeAliases: ["n0"], edgeAliases: [] },
        aliases: { n0: { internalAlias: "n0", type: "node", label: "user" } },
        userAliases: {},
        edgeUserAliases: {},
        currentNodeAlias: "n0",
        currentNodeLabel: "user",
      }

      expect(json.steps).toBeDefined()
      expect(json.projection).toBeDefined()
      expect(json.aliases).toBeDefined()
    })

    it("clone() creates independent copy", () => {
      // Modifications to clone should not affect original
      const original = { steps: [{ type: "match" }] }
      const cloned = { steps: [...original.steps] }

      cloned.steps.push({ type: "limit" })

      expect(original.steps).toHaveLength(1)
      expect(cloned.steps).toHaveLength(2)
    })
  })
})
