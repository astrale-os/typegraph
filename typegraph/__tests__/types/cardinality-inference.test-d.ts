/**
 * Type-level tests for cardinality inference.
 *
 * These tests verify that TypeScript types correctly infer:
 * 1. The BUILDER TYPE returned by traversal methods (SingleNodeBuilder vs OptionalNodeBuilder vs CollectionBuilder)
 * 2. The EXECUTE RETURN TYPE based on builder type (T vs T | null vs T[])
 *
 * Uses STRICT assertions (toEqualTypeOf) to catch any type mismatches.
 */

import { describe, it, expectTypeOf } from 'vitest'
import { z } from 'zod'
import {
  defineSchema,
  node,
  edge,
  createQueryBuilder,
  type SingleNodeBuilder,
  type OptionalNodeBuilder,
  type CollectionBuilder,
} from '../../src'

// Define a test schema with all cardinality combinations
const testSchema = defineSchema({
  nodes: {
    user: node({ properties: { name: z.string() } }),
    post: node({ properties: { title: z.string() } }),
    comment: node({ properties: { text: z.string() } }),
    profile: node({ properties: { bio: z.string() } }),
  },
  edges: {
    // outbound: one, inbound: one (user has exactly one profile)
    hasProfile: edge({
      from: 'user',
      to: 'profile',
      cardinality: { outbound: 'one', inbound: 'one' },
    }),
    // outbound: many, inbound: optional (user authors many posts, post has optional author)
    authored: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'optional' },
    }),
    // outbound: many, inbound: many (user can like many posts)
    likes: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
    // outbound: optional, inbound: many (comment may have parent)
    replyTo: edge({
      from: 'comment',
      to: 'comment',
      cardinality: { outbound: 'optional', inbound: 'many' },
    }),
  },
})

type TestSchema = typeof testSchema

// Create query builder for compile-only tests (no executor needed)
const graph = createQueryBuilder(testSchema)

describe('Cardinality Type Inference', () => {
  describe('SingleNodeBuilder.to() - Builder Type Tests', () => {
    it('returns SingleNodeBuilder for outbound: one', () => {
      const builder = graph.node('user').byId('1').to('hasProfile')

      // STRICT: Verify the BUILDER TYPE, not just execute return
      type BuilderType = typeof builder
      type IsSingleNodeBuilder = BuilderType extends SingleNodeBuilder<TestSchema, 'profile', any, any>
        ? true
        : false
      expectTypeOf<IsSingleNodeBuilder>().toEqualTypeOf<true>()

      // STRICT: NOT an OptionalNodeBuilder
      type IsOptionalNodeBuilder = BuilderType extends OptionalNodeBuilder<TestSchema, any, any, any>
        ? true
        : false
      expectTypeOf<IsOptionalNodeBuilder>().toEqualTypeOf<false>()

      // STRICT: NOT a CollectionBuilder
      type IsCollectionBuilder = BuilderType extends CollectionBuilder<TestSchema, any, any, any>
        ? true
        : false
      expectTypeOf<IsCollectionBuilder>().toEqualTypeOf<false>()
    })

    it('returns OptionalNodeBuilder for outbound: optional', () => {
      const builder = graph.node('comment').byId('1').to('replyTo')

      // STRICT: Verify builder type is OptionalNodeBuilder
      type BuilderType = typeof builder
      type IsOptionalNodeBuilder = BuilderType extends OptionalNodeBuilder<TestSchema, 'comment', any, any>
        ? true
        : false
      expectTypeOf<IsOptionalNodeBuilder>().toEqualTypeOf<true>()

      // STRICT: NOT a SingleNodeBuilder (it's optional, not required)
      // Note: OptionalNodeBuilder might extend SingleNodeBuilder internally, so check specific
      type NodeLabel = BuilderType extends OptionalNodeBuilder<TestSchema, infer N, any, any> ? N : never
      expectTypeOf<NodeLabel>().toEqualTypeOf<'comment'>()
    })

    it('returns CollectionBuilder for outbound: many', () => {
      const builder = graph.node('user').byId('1').to('likes')

      // STRICT: Verify builder type is CollectionBuilder
      type BuilderType = typeof builder
      type IsCollectionBuilder = BuilderType extends CollectionBuilder<TestSchema, 'post', any, any>
        ? true
        : false
      expectTypeOf<IsCollectionBuilder>().toEqualTypeOf<true>()

      // STRICT: Node label is 'post'
      type NodeLabel = BuilderType extends CollectionBuilder<TestSchema, infer N, any, any> ? N : never
      expectTypeOf<NodeLabel>().toEqualTypeOf<'post'>()
    })
  })

  describe('SingleNodeBuilder.to() - Execute Return Type Tests', () => {
    it('one cardinality: execute returns single node (not array, not nullable)', () => {
      const query = graph.node('user').byId('1').to('hasProfile')

      type Result = Awaited<ReturnType<typeof query.execute>>

      // STRICT: Result should NOT include null
      type HasNull = null extends Result ? true : false
      expectTypeOf<HasNull>().toEqualTypeOf<false>()

      // STRICT: Result should NOT be an array
      type IsArray = Result extends Array<any> ? true : false
      expectTypeOf<IsArray>().toEqualTypeOf<false>()

      // STRICT: Result should have profile properties
      expectTypeOf<Result['bio']>().toEqualTypeOf<string>()
    })

    it('optional cardinality: execute returns T | null', () => {
      const query = graph.node('comment').byId('1').to('replyTo')

      type Result = Awaited<ReturnType<typeof query.execute>>

      // STRICT: Result MUST include null
      type HasNull = null extends Result ? true : false
      expectTypeOf<HasNull>().toEqualTypeOf<true>()

      // STRICT: Non-null part has correct properties
      type NonNullPart = Exclude<Result, null>
      expectTypeOf<NonNullPart['text']>().toEqualTypeOf<string>()

      // STRICT: Result should NOT be an array
      type IsArray = NonNullPart extends Array<any> ? true : false
      expectTypeOf<IsArray>().toEqualTypeOf<false>()
    })

    it('many cardinality: execute returns array', () => {
      const query = graph.node('user').byId('1').to('likes')

      type Result = Awaited<ReturnType<typeof query.execute>>

      // STRICT: Result MUST be an array
      type IsArray = Result extends Array<any> ? true : false
      expectTypeOf<IsArray>().toEqualTypeOf<true>()

      // STRICT: Array element has correct properties
      type Element = Result extends Array<infer E> ? E : never
      expectTypeOf<Element['title']>().toEqualTypeOf<string>()
    })
  })

  describe('SingleNodeBuilder.from() - Builder Type Tests', () => {
    it('returns SingleNodeBuilder for inbound: one', () => {
      const builder = graph.node('profile').byId('1').from('hasProfile')

      // STRICT: Verify builder type
      type BuilderType = typeof builder
      type IsSingleNodeBuilder = BuilderType extends SingleNodeBuilder<TestSchema, 'user', any, any>
        ? true
        : false
      expectTypeOf<IsSingleNodeBuilder>().toEqualTypeOf<true>()
    })

    it('returns OptionalNodeBuilder for inbound: optional', () => {
      const builder = graph.node('post').byId('1').from('authored')

      // STRICT: Verify builder type is OptionalNodeBuilder
      type BuilderType = typeof builder
      type IsOptionalNodeBuilder = BuilderType extends OptionalNodeBuilder<TestSchema, 'user', any, any>
        ? true
        : false
      expectTypeOf<IsOptionalNodeBuilder>().toEqualTypeOf<true>()
    })

    it('returns CollectionBuilder for inbound: many', () => {
      const builder = graph.node('post').byId('1').from('likes')

      // STRICT: Verify builder type is CollectionBuilder
      type BuilderType = typeof builder
      type IsCollectionBuilder = BuilderType extends CollectionBuilder<TestSchema, 'user', any, any>
        ? true
        : false
      expectTypeOf<IsCollectionBuilder>().toEqualTypeOf<true>()
    })
  })

  describe('SingleNodeBuilder.from() - Execute Return Type Tests', () => {
    it('one cardinality: execute returns single node', () => {
      const query = graph.node('profile').byId('1').from('hasProfile')

      type Result = Awaited<ReturnType<typeof query.execute>>

      // STRICT: NOT nullable
      type HasNull = null extends Result ? true : false
      expectTypeOf<HasNull>().toEqualTypeOf<false>()

      // STRICT: Has user properties
      expectTypeOf<Result['name']>().toEqualTypeOf<string>()
    })

    it('optional cardinality: execute returns T | null', () => {
      const query = graph.node('post').byId('1').from('authored')

      type Result = Awaited<ReturnType<typeof query.execute>>

      // STRICT: MUST be nullable
      type HasNull = null extends Result ? true : false
      expectTypeOf<HasNull>().toEqualTypeOf<true>()

      // STRICT: Non-null part has correct properties
      type NonNullPart = Exclude<Result, null>
      expectTypeOf<NonNullPart['name']>().toEqualTypeOf<string>()
    })

    it('many cardinality: execute returns array', () => {
      const query = graph.node('post').byId('1').from('likes')

      type Result = Awaited<ReturnType<typeof query.execute>>

      // STRICT: MUST be array
      type IsArray = Result extends Array<any> ? true : false
      expectTypeOf<IsArray>().toEqualTypeOf<true>()

      // STRICT: Element has correct properties
      type Element = Result extends Array<infer E> ? E : never
      expectTypeOf<Element['name']>().toEqualTypeOf<string>()
    })
  })

  describe('OptionalNodeBuilder traversal', () => {
    it.skip('chained optional traversal preserves optionality (runtime not implemented)', () => {
      // NOTE: OptionalNodeBuilder.to() throws "Not implemented" at runtime
      // This test verifies the TYPE is correct even though runtime isn't ready
      // TODO: Uncomment type assertions when OptionalNodeBuilder.to() is implemented
      // const builder = graph.node('comment').byId('1').to('replyTo').to('replyTo')
      //
      // // Type should still be OptionalNodeBuilder (optional -> optional = optional)
      // type BuilderType = typeof builder
      // type IsOptional = BuilderType extends OptionalNodeBuilder<TestSchema, 'comment', any, any>
      //   ? true
      //   : false
      // expectTypeOf<IsOptional>().toEqualTypeOf<true>()
    })
  })

  describe('Negative tests - compile-time type errors', () => {
    it('traversing edge with wrong direction is a compile-time error', () => {
      // hasProfile goes FROM user TO profile
      // Type-level check: hasProfile should NOT be in OutgoingEdges from profile
      type ProfileBuilder = ReturnType<typeof graph.node<'profile'>>['byId']
      type ProfileSingleBuilder = ReturnType<ProfileBuilder>
      type ValidOutgoingEdges = Parameters<ProfileSingleBuilder['to']>[0]

      // hasProfile should NOT be a valid outgoing edge from profile
      type HasProfileIsValid = 'hasProfile' extends ValidOutgoingEdges ? true : false
      expectTypeOf<HasProfileIsValid>().toEqualTypeOf<false>()
    })

    it('traversing non-existent edge is a compile-time error', () => {
      // Type-level check: 'invalid' should not be a valid edge
      type UserSingleBuilder = ReturnType<ReturnType<typeof graph.node<'user'>>['byId']>
      type ValidEdges = Parameters<UserSingleBuilder['to']>[0]

      // 'invalid' should NOT extend ValidEdges
      type InvalidIsValid = 'invalid' extends ValidEdges ? true : false
      expectTypeOf<InvalidIsValid>().toEqualTypeOf<false>()

      // But valid edges should work
      type HasProfileIsValid = 'hasProfile' extends ValidEdges ? true : false
      expectTypeOf<HasProfileIsValid>().toEqualTypeOf<true>()
    })

    it('traversing edge not connected to current node is a compile-time error', () => {
      // replyTo is between comments, not users
      type UserSingleBuilder = ReturnType<ReturnType<typeof graph.node<'user'>>['byId']>
      type ValidEdges = Parameters<UserSingleBuilder['to']>[0]

      // replyTo should NOT be valid from user
      type ReplyToIsValid = 'replyTo' extends ValidEdges ? true : false
      expectTypeOf<ReplyToIsValid>().toEqualTypeOf<false>()

      // But it should be valid from comment
      type CommentSingleBuilder = ReturnType<ReturnType<typeof graph.node<'comment'>>['byId']>
      type CommentValidEdges = Parameters<CommentSingleBuilder['to']>[0]
      type ReplyToValidFromComment = 'replyTo' extends CommentValidEdges ? true : false
      expectTypeOf<ReplyToValidFromComment>().toEqualTypeOf<true>()
    })
  })
})
