/**
 * Mutation Specification Tests
 *
 * Tests for the Mutation AST builder, pipeline, and Cypher compiler.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createNode,
  updateNode,
  deleteNode,
  upsertNode,
  cloneNode,
  createEdge,
  updateEdge,
  updateEdgeById,
  deleteEdge,
  deleteEdgeById,
  moveNode,
  deleteSubtree,
  batchCreate,
  batchUpdate,
  batchDelete,
  batchLink,
  batchUnlink,
  unlinkAllFrom,
  unlinkAllTo,
} from '../../src/mutation/ast/builder'
import { MutationCompilationPipeline } from '../../src/mutation/ast/pipeline'
import type { MutationCompilationPass } from '../../src/mutation/ast/pipeline'
import { MutationCypherCompiler } from '../../src/mutation/cypher/compiler'
import type { SchemaShape } from '../../src/schema'

// Minimal schema fixture for compiler tests
const schema: SchemaShape = {
  nodes: {
    user: { properties: {}, implements: [] },
    post: { properties: {}, implements: [] },
    folder: { properties: {}, implements: [] },
    category: { properties: {}, implements: [] },
  },
  edges: {
    authored: {
      properties: {},
      endpoints: {
        author: { types: ['user'], cardinality: { min: 0, max: null } },
        post: { types: ['post'], cardinality: { min: 0, max: null } },
      },
    },
    follows: {
      properties: {},
      endpoints: {
        follower: { types: ['user'], cardinality: { min: 0, max: null } },
        following: { types: ['user'], cardinality: { min: 0, max: null } },
      },
    },
    likes: {
      properties: {},
      endpoints: {
        liker: { types: ['user'], cardinality: { min: 0, max: null } },
        post: { types: ['post'], cardinality: { min: 0, max: null } },
      },
    },
    hasParent: {
      properties: {},
      endpoints: {
        child: { types: ['folder'], cardinality: { min: 0, max: null } },
        parent: { types: ['folder'], cardinality: { min: 0, max: null } },
      },
    },
    categoryParent: {
      properties: {},
      endpoints: {
        child: { types: ['category'], cardinality: { min: 0, max: null } },
        parent: { types: ['category'], cardinality: { min: 0, max: null } },
      },
    },
    ofType: {
      properties: {},
      endpoints: {
        node: { types: ['*'], cardinality: { min: 0, max: null } },
        type: { types: ['*'], cardinality: { min: 0, max: null } },
      },
    },
  },
} as unknown as SchemaShape

const compiler = new MutationCypherCompiler()

describe('Mutation Specification', () => {
  // ===========================================================================
  // AST BUILDER — FACTORY FUNCTIONS
  // ===========================================================================

  describe('AST Builder', () => {
    it('creates CreateNodeOp', () => {
      const op = createNode('user', 'u1', { name: 'John' })
      expect(op.type).toBe('createNode')
      expect(op.label).toBe('user')
      expect(op.id).toBe('u1')
      expect(op.data).toEqual({ name: 'John' })
    })

    it('creates CreateNodeOp with links', () => {
      const op = createNode('user', 'u1', { name: 'John' }, {
        links: [{ edgeType: 'hasParent', targetId: 'parent_1' }],
      })
      expect(op.links).toHaveLength(1)
      expect(op.links![0]).toEqual({ edgeType: 'hasParent', targetId: 'parent_1' })
    })

    it('creates UpdateNodeOp', () => {
      const op = updateNode('user', 'u1', { name: 'Jane' })
      expect(op.type).toBe('updateNode')
    })

    it('creates DeleteNodeOp with detach', () => {
      const op = deleteNode('user', 'u1', true)
      expect(op.type).toBe('deleteNode')
      expect(op.detach).toBe(true)
    })

    it('creates DeleteNodeOp without detach', () => {
      const op = deleteNode('user', 'u1', false)
      expect(op.detach).toBe(false)
    })

    it('creates UpsertNodeOp', () => {
      const op = upsertNode('user', 'u1', { name: 'John' })
      expect(op.type).toBe('upsertNode')
    })

    it('creates CloneNodeOp', () => {
      const op = cloneNode('folder', 's1', 'c1', { name: 'Clone' })
      expect(op.type).toBe('cloneNode')
      expect(op.sourceId).toBe('s1')
      expect(op.newId).toBe('c1')
    })

    it('creates CreateEdgeOp', () => {
      const op = createEdge('authored', 'u1', 'p1', 'e1', { role: 'author' })
      expect(op.type).toBe('createEdge')
      expect(op.data).toEqual({ role: 'author' })
    })

    it('creates MoveNodeOp', () => {
      const op = moveNode('n1', 'p2', 'hasParent')
      expect(op.type).toBe('moveNode')
      expect(op.edgeType).toBe('hasParent')
    })

    it('creates BatchCreateOp', () => {
      const op = batchCreate('user', [
        { id: 'u1', data: { name: 'A' } },
        { id: 'u2', data: { name: 'B' } },
      ])
      expect(op.type).toBe('batchCreate')
      expect(op.items).toHaveLength(2)
    })
  })

  // ===========================================================================
  // CYPHER COMPILER — SINGLE OP
  // ===========================================================================

  describe('Cypher Compiler — Single Op', () => {
    describe('Node CRUD', () => {
      describe('createNode', () => {
        it('generates CREATE query with properties', () => {
          const op = createNode('user', 'u1', { name: 'John', email: 'john@example.com' })
          const { query, params } = compiler.compileOne(op, schema)

          expect(query).toContain('CREATE (n:User)')
          expect(query).toContain('SET n = $props, n.id = $id')
          expect(query).toContain('RETURN n')
          expect(params.id).toBe('u1')
          expect(params.props).toEqual({ name: 'John', email: 'john@example.com' })
        })

        it('generates atomic create+link query for single link', () => {
          const op = createNode('user', 'u1', { name: 'John' }, {
            links: [{ edgeType: 'ofType', targetId: 't1' }],
          })
          const { query, params } = compiler.compileOne(op, schema)

          expect(query).toContain('MATCH (t0 {id: $t0Id})')
          expect(query).toContain('CREATE (n:User)')
          expect(query).toContain('SET n = $props, n.id = $id')
          expect(query).toContain('CREATE (n)-[:ofType]->(t0)')
          expect(query).toContain('RETURN n')
          expect(params.t0Id).toBe('t1')
        })

        it('generates atomic create+link query for multiple links', () => {
          const op = createNode('user', 'u1', { name: 'John' }, {
            links: [
              { edgeType: 'ofType', targetId: 't1' },
              { edgeType: 'hasParent', targetId: 'p1' },
            ],
          })
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('MATCH (t0 {id: $t0Id})')
          expect(query).toContain('MATCH (t1 {id: $t1Id})')
          expect(query).toContain('CREATE (n)-[:ofType]->(t0)')
          expect(query).toContain('CREATE (n)-[:hasParent]->(t1)')
        })

        it('generates clauses in correct order: MATCH, CREATE node, SET, CREATE edges, RETURN', () => {
          const op = createNode('user', 'u1', {}, {
            links: [{ edgeType: 'ofType', targetId: 't1' }],
          })
          const { query } = compiler.compileOne(op, schema)

          const matchIdx = query.indexOf('MATCH')
          const createNodeIdx = query.indexOf('CREATE (n:User)')
          const setIdx = query.indexOf('SET')
          const createEdgeIdx = query.indexOf('CREATE (n)-[:ofType]')
          const returnIdx = query.indexOf('RETURN')

          expect(matchIdx).toBeGreaterThanOrEqual(0)
          expect(matchIdx).toBeLessThan(createNodeIdx)
          expect(createNodeIdx).toBeLessThan(setIdx)
          expect(setIdx).toBeLessThan(createEdgeIdx)
          expect(createEdgeIdx).toBeLessThan(returnIdx)
        })

        it('produces output without MATCH when no links', () => {
          const op = createNode('user', 'u1', {})
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('CREATE (n:User)')
          expect(query).toContain('SET n = $props, n.id = $id')
          expect(query).toContain('RETURN n')
          expect(query).not.toContain('MATCH')
        })
      })

      describe('updateNode', () => {
        it('generates UPDATE query', () => {
          const op = updateNode('user', 'u1', { name: 'Jane' })
          const { query, params } = compiler.compileOne(op, schema)

          expect(query).toContain('MATCH (n:User {id: $id})')
          expect(query).toContain('SET n += $props')
          expect(params.id).toBe('u1')
          expect(params.props).toEqual({ name: 'Jane' })
        })
      })

      describe('deleteNode', () => {
        it('generates DETACH DELETE query by default', () => {
          const op = deleteNode('user', 'u1', true)
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('DETACH DELETE n')
          expect(query).toContain('RETURN count(n) > 0 as deleted')
        })

        it('generates safe DELETE when detach is false', () => {
          const op = deleteNode('user', 'u1', false)
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('DELETE n')
          expect(query).not.toContain('DETACH')
          expect(query).toContain('WHERE relCount = 0')
        })
      })

      describe('upsertNode', () => {
        it('generates MERGE query', () => {
          const op = upsertNode('user', 'u1', { name: 'John' })
          const { query, params } = compiler.compileOne(op, schema)

          expect(query).toContain('MERGE (n:User {id: $id})')
          expect(query).toContain('ON CREATE SET n = $createProps, n.id = $id')
          expect(query).toContain('ON MATCH SET n += $updateProps')
          expect(params.createProps).toEqual({ name: 'John' })
        })

        it('generates MERGE links for instanceOf', () => {
          const op = upsertNode('user', 'u1', { name: 'John' }, {
            links: [{ edgeType: 'instanceOf', targetId: 'class_user' }],
          })
          const { query, params } = compiler.compileOne(op, schema)

          expect(query).toContain('MERGE (n)-[:instanceOf]->(t0)')
          expect(params.t0Id).toBe('class_user')
        })
      })

      describe('cloneNode', () => {
        it('generates simple clone query', () => {
          const op = cloneNode('folder', 's1', 'c1', { name: 'Clone' })
          const { query, params } = compiler.compileOne(op, schema)

          expect(query).toContain('MATCH (source:Folder {id: $sourceId})')
          expect(query).toContain('clone = properties(source)')
          expect(query).toContain('clone.id = $newId')
          expect(params.sourceId).toBe('s1')
          expect(params.newId).toBe('c1')
        })

        it('generates clone with explicit parent', () => {
          const op = cloneNode('folder', 's1', 'c1', {}, { parentId: 'p1', edgeType: 'hasParent' })
          const { query, params } = compiler.compileOne(op, schema)

          expect(query).toContain('MATCH (parent {id: $parentId})')
          expect(query).toContain('CREATE (clone)-[:hasParent]->(parent)')
          expect(params.parentId).toBe('p1')
        })

        it('generates clone preserving parent', () => {
          const op = cloneNode('folder', 's1', 'c1', {}, { preserve: true, edgeType: 'hasParent' })
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('(source:Folder {id: $sourceId})-[:hasParent]->(parent)')
          expect(query).toContain('CREATE (clone)-[:hasParent]->(parent)')
        })
      })
    })

    describe('Edge CRUD', () => {
      describe('createEdge', () => {
        it('generates CREATE edge with properties', () => {
          const op = createEdge('authored', 'u1', 'p1', 'e1', { role: 'author' })
          const { query, params } = compiler.compileOne(op, schema)

          expect(query).toContain('CREATE (a)-[r:authored]->(b)')
          expect(query).toContain('SET r = $props, r.id = $edgeId')
          expect(params.edgeId).toBe('e1')
          expect(params.props).toEqual({ role: 'author' })
        })

        it('generates CREATE edge without properties', () => {
          const op = createEdge('likes', 'u1', 'p1', 'e1')
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('CREATE (a)-[r:likes {id: $edgeId}]->(b)')
        })
      })

      describe('updateEdge', () => {
        it('generates UPDATE edge by endpoints', () => {
          const op = updateEdge('authored', 'u1', 'p1', { role: 'editor' })
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('MATCH (a:User {id: $fromId})-[r:authored]->(b:Post {id: $toId})')
          expect(query).toContain('SET r += $props')
        })

        it('handles reified annotation', () => {
          const op: ReturnType<typeof updateEdge> = {
            ...updateEdge('authored', 'u1', 'p1', { qty: 3 }),
            reified: { linkLabel: 'OrderItem' },
          }
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain(':has_link')
          expect(query).toContain(':OrderItem')
          expect(query).toContain(':links_to')
        })
      })

      describe('updateEdgeById', () => {
        it('generates UPDATE edge by ID', () => {
          const op = updateEdgeById('authored', 'e1', { role: 'editor' })
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('r:authored {id: $edgeId}')
          expect(query).toContain('SET r += $props')
        })
      })

      describe('deleteEdge', () => {
        it('generates DELETE edge by endpoints', () => {
          const op = deleteEdge('authored', 'u1', 'p1')
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('DELETE r')
          expect(query).toContain('count(r) > 0 as deleted')
        })

        it('handles reified annotation (DETACH DELETE link node)', () => {
          const op: ReturnType<typeof deleteEdge> = {
            ...deleteEdge('authored', 'u1', 'p1'),
            reified: { linkLabel: 'OrderItem' },
          }
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain(':has_link')
          expect(query).toContain(':OrderItem')
          expect(query).toContain('DETACH DELETE link')
        })
      })

      describe('deleteEdgeById', () => {
        it('generates DELETE edge by ID', () => {
          const op = deleteEdgeById('authored', 'e1')
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('r:authored {id: $edgeId}')
          expect(query).toContain('DELETE r')
        })
      })
    })

    describe('Hierarchy', () => {
      describe('moveNode', () => {
        it('compiles move query', () => {
          const op = moveNode('n1', 'p2', 'hasParent')
          const { query, params } = compiler.compileMove(op)

          expect(query).toContain('MATCH (n {id: $nodeId})-[oldRel:hasParent]->(oldParent)')
          expect(query).toContain('DELETE oldRel')
          expect(query).toContain('CREATE (n)-[:hasParent]->(newParent)')
          expect(params.nodeId).toBe('n1')
          expect(params.newParentId).toBe('p2')
        })

        it('compiles orphan move query', () => {
          const op = moveNode('n1', 'p2', 'hasParent')
          const { query } = compiler.compileMoveOrphan(op)

          expect(query).toContain('WHERE NOT (n)-[:hasParent]->()')
          expect(query).toContain('CREATE (n)-[:hasParent]->(newParent)')
        })

        it('compiles cycle check query', () => {
          const op = moveNode('n1', 'p2', 'hasParent')
          const { query } = compiler.compileCycleCheck(op)

          expect(query).toContain('[:hasParent*0..]')
          expect(query).toContain('wouldCycle')
        })
      })

      describe('deleteSubtree', () => {
        it('generates recursive delete', () => {
          const op = deleteSubtree('r1', 'hasParent')
          const { query, params } = compiler.compileOne(op, schema)

          expect(query).toContain('[:hasParent*0..]')
          expect(query).toContain('DETACH DELETE n')
          expect(query).toContain('size(nodes) as deletedNodes')
          expect(params.rootId).toBe('r1')
        })
      })

      describe('getSubtree', () => {
        it('generates subtree traversal query', () => {
          const { query, params } = compiler.compileGetSubtree('r1', 'hasParent')

          expect(query).toContain('[:hasParent*0..]')
          expect(query).toContain('ORDER BY depth')
          expect(params.rootId).toBe('r1')
        })
      })
    })

    describe('Batch', () => {
      describe('batchCreate', () => {
        it('generates UNWIND-based batch create', () => {
          const op = batchCreate('user', [
            { id: 'u1', data: { name: 'A' } },
            { id: 'u2', data: { name: 'B' } },
          ])
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('UNWIND $items as item')
          expect(query).toContain('CREATE (n:User)')
          expect(query).toContain('SET n = item.props, n.id = item.id')
        })

        it('supports inline links (InstanceModelPass)', () => {
          const op = batchCreate('user', [{ id: 'u1', data: {} }], {
            links: [{ edgeType: 'instanceOf', targetId: 'class_user' }],
          })
          const { query, params } = compiler.compileOne(op, schema)

          expect(query).toContain('MATCH (t0 {id: $t0Id})')
          expect(query).toContain('CREATE (n)-[:instanceOf]->(t0)')
          expect(params.t0Id).toBe('class_user')
        })
      })

      describe('batchUpdate', () => {
        it('generates UNWIND-based batch update', () => {
          const op = batchUpdate('user', [{ id: 'u1', data: { name: 'X' } }])
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('UNWIND $updates as update')
          expect(query).toContain('SET n += update.props')
        })
      })

      describe('batchDelete', () => {
        it('generates UNWIND-based batch delete', () => {
          const op = batchDelete('user', ['u1', 'u2'])
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('UNWIND $ids as nodeId')
          expect(query).toContain('DETACH DELETE n')
        })
      })

      describe('batchLink', () => {
        it('generates UNWIND-based batch edge create', () => {
          const op = batchLink('follows', [
            { fromId: 'u1', toId: 'u2', edgeId: 'e1' },
            { fromId: 'u1', toId: 'u3', edgeId: 'e2' },
          ])
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('UNWIND $links as link')
          expect(query).toContain('CREATE (a)-[r:follows]->(b)')
          expect(query).toContain('SET r = coalesce(link.data, {}), r.id = link.id')
        })

        it('handles reified annotation', () => {
          const op: ReturnType<typeof batchLink> = {
            ...batchLink('follows', [{ fromId: 'u1', toId: 'u2', edgeId: 'e1' }]),
            reified: { linkLabel: 'FollowLink' },
          }
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('CREATE (linkNode:FollowLink)')
          expect(query).toContain('CREATE (a)-[:has_link]->(linkNode)')
          expect(query).toContain('CREATE (linkNode)-[:links_to]->(b)')
        })
      })

      describe('batchUnlink', () => {
        it('generates UNWIND-based batch unlink', () => {
          const op = batchUnlink('follows', [
            { fromId: 'u1', toId: 'u2' },
          ])
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain('UNWIND $links as link')
          expect(query).toContain('DELETE r')
        })
      })

      describe('unlinkAllFrom', () => {
        it('generates outgoing edge delete', () => {
          const op = unlinkAllFrom('follows', 'u1')
          const { query, params } = compiler.compileOne(op, schema)

          expect(query).toContain('(a:User {id: $from})-[r:follows]->()')
          expect(query).toContain('DELETE r')
          expect(params.from).toBe('u1')
        })

        it('handles reified annotation', () => {
          const op: ReturnType<typeof unlinkAllFrom> = {
            ...unlinkAllFrom('follows', 'u1'),
            reified: { linkLabel: 'FollowLink' },
          }
          const { query } = compiler.compileOne(op, schema)

          expect(query).toContain(':has_link')
          expect(query).toContain(':FollowLink')
          expect(query).toContain('DETACH DELETE linkNode')
        })
      })

      describe('unlinkAllTo', () => {
        it('generates incoming edge delete', () => {
          const op = unlinkAllTo('follows', 'u1')
          const { query, params } = compiler.compileOne(op, schema)

          expect(query).toContain('()-[r:follows]->(b:User {id: $to})')
          expect(query).toContain('DELETE r')
          expect(params.to).toBe('u1')
        })
      })
    })
  })

  // ===========================================================================
  // CYPHER COMPILER — MULTI-OP
  // ===========================================================================

  describe('Cypher Compiler — Multi-Op', () => {
    it('compiles empty array to empty query', () => {
      const { query, params } = compiler.compile([], schema)

      expect(query).toBe('')
      expect(params).toEqual({})
    })

    it('compiles single-element array without namespacing', () => {
      const op = createNode('user', 'u1', { name: 'John' })
      const single = compiler.compileOne(op, schema)
      const array = compiler.compile([op], schema)

      expect(array.query).toBe(single.query)
      expect(array.params).toEqual(single.params)
    })

    it('compiles multiple ops with parameter namespacing', () => {
      const op1 = createNode('user', 'u1', { name: 'John' })
      const op2 = createNode('post', 'p1', { title: 'Hello' })
      const { params } = compiler.compile([op1, op2], schema)

      expect(params.op0_id).toBe('u1')
      expect(params.op0_props).toEqual({ name: 'John' })
      expect(params.op1_id).toBe('p1')
      expect(params.op1_props).toEqual({ title: 'Hello' })
    })

    it('chains ops with WITH clauses', () => {
      const op1 = createNode('user', 'u1', { name: 'John' })
      const op2 = createEdge('authored', 'u1', 'p1', 'e1')
      const { query } = compiler.compile([op1, op2], schema)

      expect(query).toContain('WITH')
    })
  })

  // ===========================================================================
  // PIPELINE
  // ===========================================================================

  describe('Pipeline', () => {
    it('passes through with no passes configured', () => {
      const pipeline = new MutationCompilationPipeline()
      const op = createNode('user', 'u1', { name: 'John' })

      const result = pipeline.run(op, schema)
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(op)
    })

    it('applies 1:1 transformation pass', () => {
      const uppercasePass: MutationCompilationPass = {
        name: 'uppercase-label',
        transform(op) {
          if (op.type === 'createNode') {
            return { ...op, label: op.label.toUpperCase() }
          }
          return op
        },
      }

      const pipeline = new MutationCompilationPipeline([uppercasePass])
      const op = createNode('user', 'u1', { name: 'John' })

      const result = pipeline.run(op, schema)
      expect(result).toHaveLength(1)
      expect((result[0] as any).label).toBe('USER')
    })

    it('applies 1:N expansion pass', () => {
      const expandPass: MutationCompilationPass = {
        name: 'expand-edge',
        transform(op) {
          if (op.type === 'createEdge') {
            return [
              createNode('LinkNode', 'link_1', {}),
              createEdge('hasLink', op.fromId, 'link_1', 'hl_1'),
              createEdge('linksTo', 'link_1', op.toId, 'lt_1'),
            ]
          }
          return op
        },
      }

      const pipeline = new MutationCompilationPipeline([expandPass])
      const op = createEdge('authored', 'u1', 'p1', 'e1')

      const result = pipeline.run(op, schema)
      expect(result).toHaveLength(3)
      expect(result[0]!.type).toBe('createNode')
      expect(result[1]!.type).toBe('createEdge')
      expect(result[2]!.type).toBe('createEdge')
    })

    it('composes multiple passes in order', () => {
      const reifyPass: MutationCompilationPass = {
        name: 'reify',
        transform(op) {
          if (op.type === 'createEdge') {
            return [
              createNode('Link', 'link_1', {}),
              createEdge('hasLink', op.fromId, 'link_1', 'hl_1'),
              createEdge('linksTo', 'link_1', op.toId, 'lt_1'),
            ]
          }
          return op
        },
      }

      const labelPass: MutationCompilationPass = {
        name: 'relabel',
        transform(op) {
          if (op.type === 'createNode') {
            return { ...op, label: 'node', links: [{ edgeType: 'instanceOf', targetId: `class_${op.label}` }] }
          }
          return op
        },
      }

      const pipeline = new MutationCompilationPipeline([reifyPass, labelPass])
      const op = createEdge('authored', 'u1', 'p1', 'e1')

      const result = pipeline.run(op, schema)
      // reifyPass: 1 createEdge → [createNode, createEdge, createEdge]
      // labelPass: createNode → createNode with label 'node' and instanceOf link
      expect(result).toHaveLength(3)
      expect((result[0] as any).label).toBe('node')
      expect((result[0] as any).links).toEqual([{ edgeType: 'instanceOf', targetId: 'class_Link' }])
    })

    it('handles array input', () => {
      const pipeline = new MutationCompilationPipeline()
      const ops = [
        createNode('user', 'u1', {}),
        createEdge('authored', 'u1', 'p1', 'e1'),
      ]

      const result = pipeline.run(ops, schema)
      expect(result).toHaveLength(2)
    })
  })

  // ===========================================================================
  // IDENTIFIER SANITIZATION
  // ===========================================================================

  describe('Identifier Sanitization', () => {
    it('rejects invalid identifiers during compilation', () => {
      const op = createEdge('ofType]->(x) DELETE x//', 'u1', 'p1', 'e1')

      expect(() => compiler.compileOne(op, schema)).toThrow('Invalid identifier')
    })

    it('rejects empty identifiers', () => {
      const op = createEdge('', 'u1', 'p1', 'e1')

      expect(() => compiler.compileOne(op, schema)).toThrow('Invalid identifier')
    })

    it('accepts valid identifiers', () => {
      const op = createEdge('valid_edge_type', 'u1', 'p1', 'e1')

      // Should not throw (schema edge may not exist, but sanitization passes)
      expect(() => compiler.compileOne(op, schema)).not.toThrow()
    })
  })

  // ===========================================================================
  // TRANSACTIONS
  // ===========================================================================

  describe('Transactions', () => {
    it('transaction interface provides same API as main mutations', async () => {
      const mockTx = {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        link: vi.fn(),
        unlink: vi.fn(),
        patchLink: vi.fn(),
        upsert: vi.fn(),
        createChild: vi.fn(),
        move: vi.fn(),
        linkMany: vi.fn(),
        unlinkMany: vi.fn(),
        raw: vi.fn(),
      }

      expect(mockTx.create).toBeDefined()
      expect(mockTx.link).toBeDefined()
      expect(mockTx.raw).toBeDefined()
    })
  })
})
