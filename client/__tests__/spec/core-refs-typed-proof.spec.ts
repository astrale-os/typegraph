/**
 * Core Refs Type Proof
 *
 * Proves that CoreRefs<typeof core> from codegen produces correctly typed,
 * non-any refs with full hierarchical access.
 */

import { describe, it, expectTypeOf } from 'vitest'

import type { core } from '../../../examples/e-commerce/core'
import type { CoreRefs } from '../../../examples/e-commerce/schema.generated'
import type { NodeId } from '../../src/schema'

type C = CoreRefs<typeof core>

describe('CoreRefs<typeof core> type proof (e-commerce)', () => {
  it('leaf nodes are NodeId', () => {
    expectTypeOf<C['admin']>().toEqualTypeOf<NodeId>()
    expectTypeOf<C['iphone']>().toEqualTypeOf<NodeId>()
    expectTypeOf<C['macbook']>().toEqualTypeOf<NodeId>()
    expectTypeOf<C['clothing']>().toEqualTypeOf<NodeId>()
  })

  it('nested parent has children as properties', () => {
    expectTypeOf<C['electronics']>().toHaveProperty('phones')
    expectTypeOf<C['electronics']>().toHaveProperty('laptops')
  })

  it('nested children are NodeId', () => {
    expectTypeOf<C['electronics']['phones']>().toEqualTypeOf<NodeId>()
    expectTypeOf<C['electronics']['laptops']>().toEqualTypeOf<NodeId>()
  })

  it('schema types are also NodeId (from Record<SchemaType, NodeId>)', () => {
    expectTypeOf<C['Customer']>().toEqualTypeOf<NodeId>()
    expectTypeOf<C['Product']>().toEqualTypeOf<NodeId>()
    expectTypeOf<C['Order']>().toEqualTypeOf<NodeId>()
  })

  it('is NOT any — rejects invalid access', () => {
    // If C were `any`, these would pass. They should fail.
    // @ts-expect-error — C is not assignable to string
    expectTypeOf<C>().toBeString()
    // @ts-expect-error — C is not assignable to number
    expectTypeOf<C>().toBeNumber()
  })
})
