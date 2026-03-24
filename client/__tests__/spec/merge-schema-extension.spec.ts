import { describe, it, expect } from 'vitest'

import type { SchemaShape } from '../../src/schema'

import { ClassId } from '../../src/schema'
import { mergeSchemaExtension } from '../../src/schema/extend'

function baseSchema(overrides?: Partial<SchemaShape>): SchemaShape {
  return { nodes: {}, edges: {}, ...overrides } as SchemaShape
}

describe('mergeSchemaExtension — classRefs', () => {
  it('sets classRefs from undefined', () => {
    const target = baseSchema()
    mergeSchemaExtension(target, { classRefs: { A: ClassId('1') } })
    expect(target.classRefs).toEqual({ A: ClassId('1') })
  })

  it('merges refs additively', () => {
    const target = baseSchema({ classRefs: { A: ClassId('1') } })
    mergeSchemaExtension(target, { classRefs: { B: ClassId('2') } })
    expect(target.classRefs).toEqual({ A: ClassId('1'), B: ClassId('2') })
  })

  it('overwrites ref when same key appears', () => {
    const target = baseSchema({ classRefs: { A: ClassId('1') } })
    mergeSchemaExtension(target, { classRefs: { A: ClassId('updated') } })
    expect(target.classRefs).toEqual({ A: ClassId('updated') })
  })

  it('accumulates across multiple merges (multi-distribution)', () => {
    const target = baseSchema()

    mergeSchemaExtension(target, {
      classRefs: { customer: ClassId('cls-customer'), order: ClassId('cls-order') },
    })
    mergeSchemaExtension(target, {
      classRefs: { product: ClassId('cls-product') },
    })

    expect(target.classRefs).toEqual({
      customer: ClassId('cls-customer'),
      order: ClassId('cls-order'),
      product: ClassId('cls-product'),
    })
  })

  it('returns pipelineStale: true when classRefs first set', () => {
    const target = baseSchema()
    const result = mergeSchemaExtension(target, { classRefs: { A: ClassId('1') } })
    expect(result.pipelineStale).toBe(true)
  })

  it('returns pipelineStale: false when classRefs already present', () => {
    const target = baseSchema({ classRefs: { A: ClassId('1') } })
    const result = mergeSchemaExtension(target, { classRefs: { B: ClassId('2') } })
    expect(result.pipelineStale).toBe(false)
  })
})
