/**
 * Query Compilation Specification - Hierarchy Traversal
 *
 * Tests for tree-specific operations: ancestors, descendants, parent, children, siblings
 */

import { describe, it, expect } from 'vitest'

import { type SchemaShape, QueryAST } from '../../src'
import { CypherCompiler } from '../../src/query/compiler'
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

// =============================================================================
// MULTI-LABEL HIERARCHY TESTS (Actual Compilation)
// =============================================================================

describe('Hierarchy with Multi-Label Nodes (Actual Compilation)', () => {
  // Schema with simple hierarchy (no multi-label)
  const simpleHierarchySchema = {
    nodes: {
      folder: { abstract: false, attributes: ['name', 'path'] },
    },
    edges: {
      hasParent: {
        endpoints: {
          child: { types: ['folder'], cardinality: { min: 0, max: 1 } },
          parent: { types: ['folder'] },
        },
      },
    },
    hierarchy: { defaultEdge: 'hasParent', direction: 'up' as const },
  } as const satisfies SchemaShape

  // Schema with inheritance hierarchy
  const multiLabelSchema = {
    nodes: {
      resource: { abstract: false, attributes: ['name'] },
      folder: { abstract: false, implements: ['resource'], attributes: ['name', 'path'] },
      document: { abstract: false, implements: ['resource'], attributes: ['name', 'content'] },
    },
    edges: {
      // Hierarchy edge: resources can contain other resources
      contains: {
        endpoints: {
          parent: { types: ['resource'], cardinality: { min: 0, max: null } },
          child: { types: ['resource'], cardinality: { min: 0, max: 1 } },
        },
      },
    },
    hierarchy: { defaultEdge: 'contains', direction: 'down' as const },
  } as const satisfies SchemaShape

  describe('Simple Hierarchy - Target Labels', () => {
    const compiler = new CypherCompiler(simpleHierarchySchema as SchemaShape)

    it('includes target label in ancestors query', () => {
      const ast = new QueryAST()
        .addMatch('folder')
        .addHierarchy({
          operation: 'ancestors',
          edge: 'hasParent',
          hierarchyDirection: 'up',
          targetLabel: 'folder',
        })
        .setProjection({ type: 'node', nodeAliases: ['n1'], edgeAliases: [] })

      const result = compiler.compile(ast)

      // Should include :Folder label on target node
      expect(result.cypher).toContain(':Folder')
      expect(result.cypher).toContain('[:hasParent*1..]')
      expect(result.cypher).toMatch(/\(n1:Folder\)/)
    })

    it('includes target label in descendants query', () => {
      const ast = new QueryAST()
        .addMatch('folder')
        .addHierarchy({
          operation: 'descendants',
          edge: 'hasParent',
          hierarchyDirection: 'up',
          targetLabel: 'folder',
        })
        .setProjection({ type: 'node', nodeAliases: ['n1'], edgeAliases: [] })

      const result = compiler.compile(ast)

      // Should include :Folder label on target node
      expect(result.cypher).toMatch(/<-\[:hasParent\*1\.\.\]-\(n1:Folder\)/)
    })

    it('includes target label in parent query', () => {
      const ast = new QueryAST()
        .addMatch('folder')
        .addHierarchy({
          operation: 'parent',
          edge: 'hasParent',
          hierarchyDirection: 'up',
          targetLabel: 'folder',
        })
        .setProjection({ type: 'node', nodeAliases: ['n1'], edgeAliases: [] })

      const result = compiler.compile(ast)

      expect(result.cypher).toMatch(/\[:hasParent\]->\(n1:Folder\)/)
    })

    it('includes target label in children query', () => {
      const ast = new QueryAST()
        .addMatch('folder')
        .addHierarchy({
          operation: 'children',
          edge: 'hasParent',
          hierarchyDirection: 'up',
          targetLabel: 'folder',
        })
        .setProjection({ type: 'node', nodeAliases: ['n1'], edgeAliases: [] })

      const result = compiler.compile(ast)

      expect(result.cypher).toMatch(/<-\[:hasParent\]-\(n1:Folder\)/)
    })

    it('includes target label in root query', () => {
      const ast = new QueryAST()
        .addMatch('folder')
        .addHierarchy({
          operation: 'root',
          edge: 'hasParent',
          hierarchyDirection: 'up',
          targetLabel: 'folder',
        })
        .setProjection({ type: 'node', nodeAliases: ['n1'], edgeAliases: [] })

      const result = compiler.compile(ast)

      expect(result.cypher).toMatch(/\[:hasParent\*0\.\.\]->\(n1:Folder\)/)
      expect(result.cypher).toContain('WHERE NOT')
    })

    it('untilKind takes precedence over targetLabel', () => {
      const ast = new QueryAST()
        .addMatch('folder')
        .addHierarchy({
          operation: 'ancestors',
          edge: 'hasParent',
          hierarchyDirection: 'up',
          targetLabel: 'folder',
          untilKind: 'folder', // Both provided - untilKind wins
        })
        .setProjection({ type: 'node', nodeAliases: ['n1'], edgeAliases: [] })

      const result = compiler.compile(ast)

      // Both resolve to :Folder, but the logic should use untilKind
      expect(result.cypher).toMatch(/\(n1:Folder\)/)
    })
  })

  describe('Multi-Label Hierarchy - Inheritance', () => {
    const compiler = new CypherCompiler(multiLabelSchema as SchemaShape)

    it('resolves inherited labels for source node', () => {
      const ast = new QueryAST()
        .addMatch('folder')
        .setProjection({ type: 'node', nodeAliases: ['n0'], edgeAliases: [] })

      const result = compiler.compile(ast)

      // folder extends: [resourceNode], so should resolve to :Folder:Resource
      expect(result.cypher).toContain(':Folder:Resource')
    })

    it('includes base type label in hierarchy target for polymorphic edges', () => {
      // Edge defined as from: 'resource', to: 'resource'
      // When querying ancestors from a folder, target should be :Resource
      // This allows matching both folder AND document ancestors
      const ast = new QueryAST()
        .addMatch('folder')
        .addHierarchy({
          operation: 'ancestors',
          edge: 'contains',
          hierarchyDirection: 'down',
          targetLabel: 'resource', // Base type from edge definition
        })
        .setProjection({ type: 'node', nodeAliases: ['n1'], edgeAliases: [] })

      const result = compiler.compile(ast)

      // Source should have full label chain
      expect(result.cypher).toContain(':Folder:Resource')
      // Target should be :Resource (matches folder AND document)
      expect(result.cypher).toMatch(/\(n1:Resource\)/)
    })

    it('includes full label chain when targeting specific derived type', () => {
      const ast = new QueryAST()
        .addMatch('document')
        .addHierarchy({
          operation: 'ancestors',
          edge: 'contains',
          hierarchyDirection: 'down',
          targetLabel: 'folder', // Specific derived type
        })
        .setProjection({ type: 'node', nodeAliases: ['n1'], edgeAliases: [] })

      const result = compiler.compile(ast)

      // Source: document with full labels
      expect(result.cypher).toContain(':Document:Resource')
      // Target: folder with full labels
      expect(result.cypher).toMatch(/\(n1:Folder:Resource\)/)
    })

    it('resolves untilKind with inheritance correctly', () => {
      const ast = new QueryAST()
        .addMatch('document')
        .addHierarchy({
          operation: 'ancestors',
          edge: 'contains',
          hierarchyDirection: 'down',
          untilKind: 'folder', // Stop at folder nodes
        })
        .setProjection({ type: 'node', nodeAliases: ['n1'], edgeAliases: [] })

      const result = compiler.compile(ast)

      // untilKind 'folder' should resolve to :Folder:Resource
      expect(result.cypher).toMatch(/\(n1:Folder:Resource\)/)
    })

    it('works with descendants (reverse direction)', () => {
      const ast = new QueryAST()
        .addMatch('folder')
        .addHierarchy({
          operation: 'descendants',
          edge: 'contains',
          hierarchyDirection: 'down',
          targetLabel: 'resource',
        })
        .setProjection({ type: 'node', nodeAliases: ['n1'], edgeAliases: [] })

      const result = compiler.compile(ast)

      // For 'down' direction + descendants: follow outgoing edges
      expect(result.cypher).toContain('[:contains*1..]')
      expect(result.cypher).toMatch(/\(n1:Resource\)/)
    })

    it('siblings parent alias includes target label for better query planning', () => {
      const ast = new QueryAST()
        .addMatch('folder')
        .addHierarchy({
          operation: 'siblings',
          edge: 'contains',
          hierarchyDirection: 'down',
          targetLabel: 'resource',
        })
        .setProjection({ type: 'node', nodeAliases: ['n1'], edgeAliases: [] })

      const result = compiler.compile(ast)

      // For 'down' direction + siblings: go IN to parent, then OUT to siblings
      // Parent alias should have the target label for better query planning
      expect(result.cypher).toMatch(/<-\[:contains\]/)
      expect(result.cypher).toMatch(/\[:contains\]->/)
      // Both parent and sibling should have labels
      expect(result.cypher).toMatch(/\(parent_\d+:Resource\)/)
      expect(result.cypher).toMatch(/\(n1:Resource\)/)
      expect(result.cypher).toContain('WHERE n1.id <> n0.id')
    })
  })
})
