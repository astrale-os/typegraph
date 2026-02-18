import { describe, it, expect } from 'vitest'
import { mergeSchemaExtension } from '../../src/schema/extend'
import type { SchemaShape } from '../../src/schema'

function baseSchema(overrides?: Partial<SchemaShape>): SchemaShape {
  return { nodes: {}, edges: {}, ...overrides } as SchemaShape
}

describe('mergeSchemaExtension — classRefs', () => {
  it('sets classRefs from undefined', () => {
    const target = baseSchema()
    mergeSchemaExtension(target, { classRefs: { A: '1' } })
    expect(target.classRefs).toEqual({ A: '1' })
  })

  it('merges refs additively', () => {
    const target = baseSchema({ classRefs: { A: '1' } })
    mergeSchemaExtension(target, { classRefs: { B: '2' } })
    expect(target.classRefs).toEqual({ A: '1', B: '2' })
  })

  it('overwrites ref when same key appears', () => {
    const target = baseSchema({ classRefs: { A: '1' } })
    mergeSchemaExtension(target, { classRefs: { A: 'updated' } })
    expect(target.classRefs).toEqual({ A: 'updated' })
  })

  it('accumulates across multiple merges (multi-distribution)', () => {
    const target = baseSchema()

    mergeSchemaExtension(target, {
      classRefs: { customer: 'cls-customer', order: 'cls-order' },
    })
    mergeSchemaExtension(target, {
      classRefs: { product: 'cls-product' },
    })

    expect(target.classRefs).toEqual({
      customer: 'cls-customer',
      order: 'cls-order',
      product: 'cls-product',
    })
  })

  it('returns pipelineStale: true when classRefs first set', () => {
    const target = baseSchema()
    const result = mergeSchemaExtension(target, { classRefs: { A: '1' } })
    expect(result.pipelineStale).toBe(true)
  })

  it('returns pipelineStale: false when classRefs already present', () => {
    const target = baseSchema({ classRefs: { A: '1' } })
    const result = mergeSchemaExtension(target, { classRefs: { B: '2' } })
    expect(result.pipelineStale).toBe(false)
  })
})
