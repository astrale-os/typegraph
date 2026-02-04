/**
 * Type-level tests for .return() callback type inference.
 *
 * These tests use STRICT assertions (toEqualTypeOf) to verify exact types.
 * They also include negative tests to ensure invalid operations are caught.
 */

import { describe, it, expectTypeOf } from 'vitest'
import { z } from 'zod'
import {
  defineSchema,
  node,
  edge,
  createGraph,
  collect,
  type CollectionBuilder,
  type SingleNodeBuilder,
  type OptionalNodeBuilder,
} from '../../src'

// Define a test schema
const testSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        name: z.string(),
        email: z.string(),
        age: z.number().optional(),
      },
    }),
    post: node({
      properties: {
        title: z.string(),
        content: z.string(),
        views: z.number(),
      },
    }),
    tag: node({
      properties: {
        name: z.string(),
      },
    }),
  },
  edges: {
    authored: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'optional' },
    }),
    hasTag: edge({
      from: 'post',
      to: 'tag',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
  },
})

type TestSchema = typeof testSchema

// Create a real graph for runtime tests (without executor - compile-only)
const graph = createGraph(testSchema, {})

describe('Return Type Inference', () => {
  describe('Builder type verification', () => {
    it('node() returns CollectionBuilder', () => {
      const builder = graph.node('user')

      // STRICT: Verify the builder type itself, not just what execute returns
      type BuilderType = typeof builder
      type IsCollectionBuilder = BuilderType extends CollectionBuilder<TestSchema, 'user', any, any>
        ? true
        : false
      expectTypeOf<IsCollectionBuilder>().toEqualTypeOf<true>()

      // Extract node label from builder
      type NodeLabel = BuilderType extends CollectionBuilder<TestSchema, infer N, any, any> ? N : never
      expectTypeOf<NodeLabel>().toEqualTypeOf<'user'>()
    })

    it('byId() returns SingleNodeBuilder', () => {
      const builder = graph.node('user').byId('1')

      // STRICT: Verify builder type
      type BuilderType = typeof builder
      type IsSingleNodeBuilder = BuilderType extends SingleNodeBuilder<TestSchema, 'user', any, any>
        ? true
        : false
      expectTypeOf<IsSingleNodeBuilder>().toEqualTypeOf<true>()
    })

    it('as() preserves builder type and adds alias', () => {
      const builder = graph.node('user').as('u')

      // STRICT: Still a CollectionBuilder
      type BuilderType = typeof builder
      type IsCollectionBuilder = BuilderType extends CollectionBuilder<TestSchema, 'user', any, any>
        ? true
        : false
      expectTypeOf<IsCollectionBuilder>().toEqualTypeOf<true>()

      // STRICT: Alias is recorded in the type
      type Aliases = BuilderType extends CollectionBuilder<TestSchema, any, infer A, any> ? A : never
      type HasUserAlias = 'u' extends keyof Aliases ? true : false
      expectTypeOf<HasUserAlias>().toEqualTypeOf<true>()
    })

    it('to() changes node type to target', () => {
      const builder = graph.node('user').as('u').to('authored')

      // After to('authored'), should be CollectionBuilder for 'post'
      type BuilderType = typeof builder
      type NodeLabel = BuilderType extends CollectionBuilder<TestSchema, infer N, any, any> ? N : never
      expectTypeOf<NodeLabel>().toEqualTypeOf<'post'>()
    })
  })

  describe('Property type inference (STRICT)', () => {
    it('string property returns string', () => {
      graph
        .node('user')
        .as('u')
        .return((q) => {
          // STRICT: Must be exactly string, not string | undefined or any
          expectTypeOf(q.u.name).toEqualTypeOf<string>()
          expectTypeOf(q.u.email).toEqualTypeOf<string>()
          return { name: q.u.name }
        })
    })

    it('number property returns number', () => {
      graph
        .node('post')
        .as('p')
        .return((q) => {
          // STRICT: Must be exactly number
          expectTypeOf(q.p.views).toEqualTypeOf<number>()
          return { views: q.p.views }
        })
    })

    it('optional property returns T | undefined', () => {
      graph
        .node('user')
        .as('u')
        .return((q) => {
          // STRICT: Must be exactly number | undefined
          expectTypeOf(q.u.age).toEqualTypeOf<number | undefined>()
          return { age: q.u.age }
        })
    })
  })

  describe('Execute return types (STRICT)', () => {
    it('execute returns correctly typed array', () => {
      const query = graph
        .node('user')
        .as('u')
        .return((q) => ({
          userName: q.u.name,
          userEmail: q.u.email,
        }))

      // STRICT: Exact array type
      type Result = Awaited<ReturnType<typeof query.execute>>
      expectTypeOf<Result>().toEqualTypeOf<Array<{ userName: string; userEmail: string }>>()
    })

    it('execute with optional property includes undefined', () => {
      const query = graph
        .node('user')
        .as('u')
        .return((q) => ({
          name: q.u.name,
          age: q.u.age,
        }))

      // STRICT: age must be number | undefined, not just number
      type Result = Awaited<ReturnType<typeof query.execute>>
      expectTypeOf<Result>().toEqualTypeOf<Array<{ name: string; age: number | undefined }>>()
    })
  })

  describe('Collect types (STRICT)', () => {
    it('collect returns typed array', () => {
      graph
        .node('user')
        .as('u')
        .to('authored')
        .as('p')
        .return((q) => {
          const posts = collect(q.p)

          // STRICT: Verify it's an array
          expectTypeOf(posts).toBeArray()

          // STRICT: Extract element type and verify exact shape
          type PostElement = (typeof posts)[number]

          // Must have ALL post properties with exact types
          expectTypeOf<PostElement['title']>().toEqualTypeOf<string>()
          expectTypeOf<PostElement['content']>().toEqualTypeOf<string>()
          expectTypeOf<PostElement['views']>().toEqualTypeOf<number>()

          return { posts }
        })
    })

    it('execute with collect has exact return type', () => {
      const query = graph
        .node('user')
        .as('u')
        .to('authored')
        .as('p')
        .return((q) => ({
          authorName: q.u.name,
          posts: collect(q.p),
        }))

      type Result = Awaited<ReturnType<typeof query.execute>>

      // STRICT: Exact element structure
      type Element = Result[number]
      expectTypeOf<Element['authorName']>().toEqualTypeOf<string>()

      // STRICT: posts must be array with exact post shape
      type PostArray = Element['posts']
      expectTypeOf<PostArray>().toBeArray()
      type Post = PostArray[number]
      expectTypeOf<Post['title']>().toEqualTypeOf<string>()
      expectTypeOf<Post['content']>().toEqualTypeOf<string>()
      expectTypeOf<Post['views']>().toEqualTypeOf<number>()
    })
  })

  describe('Negative tests - compile-time type errors', () => {
    it('traversing invalid edge is a compile-time error', () => {
      // Type-level only test - we verify the type constraint, not runtime behavior
      type UserBuilder = ReturnType<typeof graph.node<'user'>>
      type ToMethod = UserBuilder['to']

      // The 'to' method only accepts OutgoingEdges<S, 'user'>
      // 'invalid' should not be assignable to that type
      type ValidEdges = Parameters<ToMethod>[0]
      // If 'invalid' extends ValidEdges, this would be true - but it shouldn't
      type InvalidIsValid = 'invalid' extends ValidEdges ? true : false
      expectTypeOf<InvalidIsValid>().toEqualTypeOf<false>()

      // Valid edges should work
      type AuthoredIsValid = 'authored' extends ValidEdges ? true : false
      expectTypeOf<AuthoredIsValid>().toEqualTypeOf<true>()
    })

    it('traversing edge from wrong node is a compile-time error', () => {
      // 'replyTo' is between comments, not users
      type UserBuilder = ReturnType<typeof graph.node<'user'>>
      type ValidEdges = Parameters<UserBuilder['to']>[0]

      // replyTo should NOT be a valid edge from user
      type ReplyToIsValid = 'replyTo' extends ValidEdges ? true : false
      expectTypeOf<ReplyToIsValid>().toEqualTypeOf<false>()
    })

    it('using wrong type for collect should error', () => {
      // collect() signature requires NodeProxy, not primitive
      // This is verified at the type level by checking collect's parameter type
      type CollectParam = Parameters<typeof collect>[0]

      // string should NOT be assignable to CollectParam
      type StringIsValid = string extends CollectParam ? true : false
      expectTypeOf<StringIsValid>().toEqualTypeOf<false>()
    })

    it('accessing non-existent property on node should error', () => {
      // Verify that user node type doesn't have 'nonexistent' property
      type UserProps = TestSchema['nodes']['user']['properties']
      type HasNonexistent = 'nonexistent' extends keyof z.infer<UserProps> ? true : false
      expectTypeOf<HasNonexistent>().toEqualTypeOf<false>()

      // Valid properties should exist
      type HasName = 'name' extends keyof z.infer<UserProps> ? true : false
      expectTypeOf<HasName>().toEqualTypeOf<true>()
    })
  })

  describe('Runtime-only validation (type system limitation)', () => {
    /**
     * NOTE: The following invalid operations are caught at RUNTIME but not at compile-time.
     * This is a known limitation of the proxy-based type system.
     * The QueryContext type is permissive to allow property access on NodeProxy types,
     * but invalid alias access is only caught when the callback is executed.
     */

    it.skip('accessing non-existent alias throws at runtime (not compile-time)', () => {
      // This is a TYPE SYSTEM LIMITATION:
      // q.nonexistent compiles but throws "Unknown alias 'nonexistent'" at runtime
      graph
        .node('user')
        .as('u')
        .return((q) => {
          // TypeScript allows this, but it throws at runtime
          ;(q as any).nonexistent
          return { user: q.u }
        })
    })

    it.skip('using undefined alias throws at runtime (not compile-time)', () => {
      // This is a TYPE SYSTEM LIMITATION:
      // q.u compiles when no .as('u') was called, but throws at runtime
      graph
        .node('user')
        // No .as('u') call
        .return((q) => {
          // TypeScript allows this, but it throws at runtime
          ;(q as any).u
          return {}
        })
    })
  })

  describe('Traversal alias preservation', () => {
    it('aliases from previous nodes remain accessible', () => {
      graph
        .node('user')
        .as('u')
        .to('authored')
        .as('p')
        .return((q) => {
          // STRICT: User alias still has user properties
          expectTypeOf(q.u.name).toEqualTypeOf<string>()
          expectTypeOf(q.u.email).toEqualTypeOf<string>()

          // STRICT: Post alias has post properties
          expectTypeOf(q.p.title).toEqualTypeOf<string>()
          expectTypeOf(q.p.content).toEqualTypeOf<string>()
          expectTypeOf(q.p.views).toEqualTypeOf<number>()

          return { author: q.u, post: q.p }
        })
    })

    it('multiple traversals preserve all aliases', () => {
      graph
        .node('user')
        .as('u')
        .to('authored')
        .as('p')
        .to('hasTag')
        .as('t')
        .return((q) => {
          // All three aliases accessible with correct types
          expectTypeOf(q.u.name).toEqualTypeOf<string>()
          expectTypeOf(q.p.title).toEqualTypeOf<string>()
          expectTypeOf(q.t.name).toEqualTypeOf<string>()

          return { user: q.u, post: q.p, tag: q.t }
        })
    })
  })
})
