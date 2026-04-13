import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import {
  nodeInterface,
  nodeClass,
  edgeInterface,
  edgeClass,
  fn,
  ref,
  data,
  prop,
  bitmask,
  SELF,
} from '../index.js'

describe('definition builders', () => {
  it('nodeInterface creates a branded def with __kind', () => {
    const I = nodeInterface({ attributes: { name: z.string() } })
    expect(I.__kind).toBe('node-interface')
    expect(I.config.attributes).toHaveProperty('name')
  })

  it('nodeClass creates a branded def with __kind', () => {
    const C = nodeClass({ attributes: { name: z.string() } })
    expect(C.__kind).toBe('node-class')
    expect(C.config.attributes).toHaveProperty('name')
  })

  it('edgeInterface creates a branded def with endpoints', () => {
    const N = nodeInterface({})
    const E = edgeInterface({ as: 'from', types: [N] }, { as: 'to', types: [N] })
    expect(E.__kind).toBe('edge-interface')
    expect(E.from.as).toBe('from')
    expect(E.to.as).toBe('to')
  })

  it('edgeClass creates a branded def with endpoints and config', () => {
    const N = nodeClass({})
    const E = edgeClass(
      { as: 'author', types: [N] },
      { as: 'article', types: [N] },
      { constraints: { unique: true } },
    )
    expect(E.__kind).toBe('edge-class')
    expect(E.config.constraints?.unique).toBe(true)
  })

  it('nodeInterface accepts a thunk for forward refs', () => {
    const I = nodeInterface(() => ({ attributes: { x: z.number() } }))
    expect(I.__kind).toBe('node-interface')
    // Thunk is stored as-is; resolved later by defineSchema
  })
})

describe('fn builder', () => {
  it('creates an FnDef with config', () => {
    const f = fn({
      params: { id: z.string() },
      returns: z.boolean(),
      inheritance: 'abstract',
    })
    expect(f.__type).toBe('fn')
    expect(f.config.inheritance).toBe('abstract')
  })
})

describe('ref builder', () => {
  it('creates a RefSchema from a definition', () => {
    const N = nodeClass({})
    const r = ref(N)
    expect(r).toBeDefined()
    // Should parse strings and objects with id
    expect(r.parse('abc')).toEqual({ id: 'abc' })
    expect(r.parse({ id: 'xyz' })).toEqual({ id: 'xyz' })
  })

  it('creates a RefSchema from SELF', () => {
    const r = ref(SELF)
    expect(r.parse('self-id')).toEqual({ id: 'self-id' })
  })
})

describe('data builder', () => {
  it('creates a DataSelfSchema with no args', () => {
    const d = data()
    expect(d).toBeDefined()
  })

  it('creates a DataGrantSchema with a def target', () => {
    const N = nodeClass({})
    const d = data(N)
    expect(d).toBeDefined()
  })
})

describe('prop builder', () => {
  it('creates an AttributeDef with metadata', () => {
    const p = prop(z.string(), { private: true })
    expect(p._tag).toBe('AttributeDef')
    expect(p.private).toBe(true)
  })

  it('defaults private to false', () => {
    const p = prop(z.number())
    expect(p.private).toBe(false)
  })
})

describe('bitmask builder', () => {
  it('creates a number schema with bitmask brand', () => {
    const b = bitmask()
    expect(b.parse(0)).toBe(0)
    expect(b.parse(7)).toBe(7)
    expect(() => b.parse(-1)).toThrow()
    expect(() => b.parse(1.5)).toThrow()
  })
})
