import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { iface, nodeDef, edgeDef, method, ref } from '../builders.js'
import { defineSchema, defineMethods } from '../schema.js'
import { SchemaValidationError } from '../types.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

const A = iface({ props: { x: z.string() } })
const B = nodeDef({ props: { y: z.number() } })

// ── defineSchema ─────────────────────────────────────────────────────────────

describe('defineSchema', () => {
  // ── 1. Valid schema passes ───────────────────────────────────────────────

  it('accepts a valid schema', () => {
    const s = defineSchema({
      A,
      B,
      ab: edgeDef({ as: 'a', types: [A] }, { as: 'b', types: [B] }),
    })
    expect(Object.keys(s.ifaces)).toEqual(['A'])
    expect(Object.keys(s.nodes)).toEqual(['B'])
    expect(Object.keys(s.edges)).toEqual(['ab'])
  })

  // ── 2. Duplicate name ───────────────────────────────────────────────────

  it('does not throw for distinct names', () => {
    expect(() =>
      defineSchema({
        I: iface({}),
        N: nodeDef({}),
        e: edgeDef({ as: 'a', types: [A] }, { as: 'b', types: [B] }),
        A,
        B,
      }),
    ).not.toThrow()
  })

  // ── 3. Edge unknown ref ─────────────────────────────────────────────────

  it('throws when edge references a type not in schema', () => {
    const Outside = iface({ props: { a: z.string() } })
    const Inside = nodeDef({})
    expect(() =>
      defineSchema({
        Inside,
        bad: edgeDef({ as: 'src', types: [Outside] }, { as: 'tgt', types: [Inside] }),
      }),
    ).toThrow(SchemaValidationError)
  })

  it('error has correct field for edge unknown ref', () => {
    const Outside = nodeDef({})
    const Inside = nodeDef({})
    try {
      defineSchema({
        Inside,
        bad: edgeDef({ as: 'src', types: [Outside] }, { as: 'tgt', types: [Inside] }),
      })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaValidationError)
      expect((e as SchemaValidationError).field).toBe('edges.bad.src')
    }
  })

  // ── 3b. Invalid cardinality ─────────────────────────────────────────────

  it('throws on invalid cardinality', () => {
    expect(() =>
      defineSchema({
        A,
        B,
        bad: edgeDef({ as: 'a', types: [A], cardinality: 'many' as any }, { as: 'b', types: [B] }),
      }),
    ).toThrow(SchemaValidationError)
  })

  // ── 4. Unresolvable thunk ──────────────────────────────────────────────

  it('throws on unresolvable param thunk', () => {
    const Bad = nodeDef({
      methods: {
        broken: method({
          params: () => {
            throw new Error('boom')
          },
          returns: z.void(),
        }),
      },
    })
    expect(() => defineSchema({ Bad })).toThrow(SchemaValidationError)
  })

  it('thunk error includes def and method name', () => {
    const Bad = nodeDef({
      methods: {
        doStuff: method({
          params: () => {
            throw new Error('nope')
          },
          returns: z.void(),
        }),
      },
    })
    try {
      defineSchema({ Bad })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaValidationError)
      expect((e as SchemaValidationError).field).toBe('Bad.doStuff.params')
    }
  })

  // ── 5. Index property validation ───────────────────────────────────────

  it('throws when index references unknown property', () => {
    const Bad = nodeDef({
      props: { name: z.string() },
      indexes: [{ property: 'nonexistent', type: 'unique' as const }],
    })
    expect(() => defineSchema({ Bad })).toThrow(SchemaValidationError)
  })

  it('index error includes property name and available props', () => {
    const Bad = iface({
      props: { foo: z.string(), bar: z.number() },
      indexes: ['missing'],
    })
    try {
      defineSchema({ Bad })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaValidationError)
      const err = e as SchemaValidationError
      expect(err.field).toBe('Bad.indexes')
      expect(err.received).toBe('missing')
      expect(err.expected).toContain('foo')
      expect(err.expected).toContain('bar')
    }
  })

  it('accepts index on own prop', () => {
    const Good = nodeDef({
      props: { email: z.string() },
      indexes: [{ property: 'email', type: 'unique' as const }],
    })
    expect(() => defineSchema({ Good })).not.toThrow()
  })

  it('accepts index on inherited iface prop', () => {
    const Base = iface({ props: { slug: z.string() } })
    const Child = nodeDef({
      implements: [Base],
      props: { name: z.string() },
      indexes: [{ property: 'slug', type: 'unique' as const }],
    })
    expect(() => defineSchema({ Base, Child })).not.toThrow()
  })

  it('accepts index on inherited node extends prop', () => {
    const Parent = nodeDef({ props: { sku: z.string() } })
    const Child = nodeDef({
      extends: Parent,
      props: { extra: z.number() },
      indexes: ['sku'],
    })
    expect(() => defineSchema({ Parent, Child })).not.toThrow()
  })

  it('accepts index on deeply inherited iface prop', () => {
    const GrandParent = iface({ props: { deep: z.string() } })
    const ParentIface = iface({ extends: [GrandParent], props: { mid: z.number() } })
    const Leaf = nodeDef({
      implements: [ParentIface],
      indexes: [{ property: 'deep', type: 'btree' as const }],
    })
    expect(() => defineSchema({ GrandParent, ParentIface, Leaf })).not.toThrow()
  })

  it('throws for index on iface with no props', () => {
    const Empty = iface({ indexes: ['phantom'] } as any)
    expect(() => defineSchema({ Empty })).toThrow(SchemaValidationError)
  })

  // ── 6. Method ref validation ──────────────────────────────────────────

  it('throws when method param ref points outside schema', () => {
    const Outside = nodeDef({ props: { a: z.string() } })
    const Inside = nodeDef({
      methods: {
        doIt: method({ params: { target: ref(Outside) }, returns: z.void() }),
      },
    })
    expect(() => defineSchema({ Inside })).toThrow(SchemaValidationError)
  })

  it('throws when method return ref points outside schema', () => {
    const Outside = nodeDef({})
    const Inside = nodeDef({
      methods: {
        get: method({ returns: ref(Outside) }),
      },
    })
    expect(() => defineSchema({ Inside })).toThrow(SchemaValidationError)
  })

  it('throws when method return z.array(ref()) points outside schema', () => {
    const Outside = nodeDef({})
    const Inside = nodeDef({
      methods: {
        list: method({ returns: z.array(ref(Outside)) }),
      },
    })
    expect(() => defineSchema({ Inside })).toThrow(SchemaValidationError)
  })

  it('ref error has correct field', () => {
    const Outside = nodeDef({})
    const Inside = nodeDef({
      methods: {
        act: method({ params: { who: ref(Outside) }, returns: z.void() }),
      },
    })
    try {
      defineSchema({ Inside })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaValidationError)
      expect((e as SchemaValidationError).field).toBe('Inside.act.params.who')
    }
  })

  it('accepts method ref pointing to a schema def', () => {
    const Target = nodeDef({})
    const Source = nodeDef({
      methods: {
        get: method({ params: { t: ref(Target) }, returns: z.void() }),
      },
    })
    expect(() => defineSchema({ Target, Source })).not.toThrow()
  })

  it('accepts method return z.array(ref()) pointing to schema def', () => {
    const Item = nodeDef({})
    const List = nodeDef({
      methods: {
        all: method({ returns: z.array(ref(Item)) }),
      },
    })
    expect(() => defineSchema({ Item, List })).not.toThrow()
  })

  it('accepts method with thunk params referencing schema defs', () => {
    const Target = nodeDef({})
    const Source = iface({
      methods: {
        act: method({
          params: () => ({ t: ref(Target) }),
          returns: z.void(),
        }),
      },
    })
    expect(() => defineSchema({ Target, Source })).not.toThrow()
  })

  it('throws when thunk-resolved param ref points outside schema', () => {
    const Outside = nodeDef({})
    const Source = nodeDef({
      methods: {
        act: method({
          params: () => ({ t: ref(Outside) }),
          returns: z.void(),
        }),
      },
    })
    expect(() => defineSchema({ Source })).toThrow(SchemaValidationError)
  })

  it('validates edge method refs too', () => {
    const Outside = nodeDef({})
    const N = nodeDef({})
    expect(() =>
      defineSchema({
        N,
        bad: edgeDef(
          { as: 'a', types: [N] },
          { as: 'b', types: [N] },
          { methods: { calc: method({ returns: ref(Outside) }) } },
        ),
      }),
    ).toThrow(SchemaValidationError)
  })
})

// ── defineMethods ────────────────────────────────────────────────────────────

describe('defineMethods', () => {
  const Task = nodeDef({
    props: { title: z.string() },
    methods: {
      done: method({ returns: z.boolean() }),
      count: method({ returns: z.number() }),
    },
  })

  const schema = defineSchema({ Task })

  it('accepts complete implementations', () => {
    expect(() =>
      defineMethods(schema, {
        Task: {
          done: () => true,
          count: () => 0,
        },
      } as any),
    ).not.toThrow()
  })

  it('throws when entire def impl is missing', () => {
    expect(() => defineMethods(schema, {} as any)).toThrow(SchemaValidationError)
  })

  it('throws when individual method is missing', () => {
    try {
      defineMethods(schema, { Task: { done: () => true } } as any)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaValidationError)
      expect((e as SchemaValidationError).field).toBe('methods.Task')
    }
  })

  it('throws when method value is not a function', () => {
    expect(() => defineMethods(schema, { Task: { done: () => true, count: 42 } } as any)).toThrow(
      SchemaValidationError,
    )
  })

  it('validates edge methods too', () => {
    const N = nodeDef({})
    const e = edgeDef(
      { as: 'a', types: [N] },
      { as: 'b', types: [N] },
      { methods: { calc: method({ returns: z.number() }) } },
    )
    const s = defineSchema({ N, e })
    expect(() => defineMethods(s, {} as any)).toThrow(SchemaValidationError)
  })
})
