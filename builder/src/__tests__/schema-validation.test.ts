import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { iface, rawNodeDef as nodeDef, edgeDef, method, ref } from '../builders.js'
import { defineSchema } from '../schema.js'
import { edge, node, defineCore } from '../data.js'
import { SchemaValidationError } from '../types.js'
import { getDefName } from '../registry.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

const A = iface({ props: { x: z.string() } })
const B = nodeDef({ props: { y: z.number() } })

// ── defineSchema ─────────────────────────────────────────────────────────────

describe('defineSchema', () => {
  // ── 1. Valid schema passes ───────────────────────────────────────────────

  it('accepts a valid schema', () => {
    const s = defineSchema('test', {
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
      defineSchema('test', {
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
      defineSchema('test', {
        Inside,
        bad: edgeDef({ as: 'src', types: [Outside] }, { as: 'tgt', types: [Inside] }),
      }),
    ).toThrow(SchemaValidationError)
  })

  it('error has correct field for edge unknown ref', () => {
    const Outside = nodeDef({})
    const Inside = nodeDef({})
    try {
      defineSchema('test', {
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
      defineSchema('test', {
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
    expect(() => defineSchema('test', { Bad })).toThrow(SchemaValidationError)
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
      defineSchema('test', { Bad })
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
    expect(() => defineSchema('test', { Bad })).toThrow(SchemaValidationError)
  })

  it('index error includes property name and available props', () => {
    const Bad = iface({
      props: { foo: z.string(), bar: z.number() },
      indexes: ['missing'],
    })
    try {
      defineSchema('test', { Bad })
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
    expect(() => defineSchema('test', { Good })).not.toThrow()
  })

  it('accepts index on inherited iface prop', () => {
    const Base = iface({ props: { slug: z.string() } })
    const Child = nodeDef({
      implements: [Base],
      props: { name: z.string() },
      indexes: [{ property: 'slug', type: 'unique' as const }],
    })
    expect(() => defineSchema('test', { Base, Child })).not.toThrow()
  })

  it('accepts index on inherited node extends prop', () => {
    const Parent = nodeDef({ props: { sku: z.string() } })
    const Child = nodeDef({
      extends: Parent,
      props: { extra: z.number() },
      indexes: ['sku'],
    })
    expect(() => defineSchema('test', { Parent, Child })).not.toThrow()
  })

  it('accepts index on deeply inherited iface prop', () => {
    const GrandParent = iface({ props: { deep: z.string() } })
    const ParentIface = iface({ extends: [GrandParent], props: { mid: z.number() } })
    const Leaf = nodeDef({
      implements: [ParentIface],
      indexes: [{ property: 'deep', type: 'btree' as const }],
    })
    expect(() => defineSchema('test', { GrandParent, ParentIface, Leaf })).not.toThrow()
  })

  it('throws for index on iface with no props', () => {
    const Empty = iface({ indexes: ['phantom'] } as any)
    expect(() => defineSchema('test', { Empty })).toThrow(SchemaValidationError)
  })

  // ── 6. Method ref validation ──────────────────────────────────────────

  it('throws when method param ref points outside schema', () => {
    const Outside = nodeDef({ props: { a: z.string() } })
    const Inside = nodeDef({
      methods: {
        doIt: method({ params: { target: ref(Outside) }, returns: z.void() }),
      },
    })
    expect(() => defineSchema('test', { Inside })).toThrow(SchemaValidationError)
  })

  it('throws when method return ref points outside schema', () => {
    const Outside = nodeDef({})
    const Inside = nodeDef({
      methods: {
        get: method({ returns: ref(Outside) }),
      },
    })
    expect(() => defineSchema('test', { Inside })).toThrow(SchemaValidationError)
  })

  it('throws when method return z.array(ref()) points outside schema', () => {
    const Outside = nodeDef({})
    const Inside = nodeDef({
      methods: {
        list: method({ returns: z.array(ref(Outside)) }),
      },
    })
    expect(() => defineSchema('test', { Inside })).toThrow(SchemaValidationError)
  })

  it('ref error has correct field', () => {
    const Outside = nodeDef({})
    const Inside = nodeDef({
      methods: {
        act: method({ params: { who: ref(Outside) }, returns: z.void() }),
      },
    })
    try {
      defineSchema('test', { Inside })
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
    expect(() => defineSchema('test', { Target, Source })).not.toThrow()
  })

  it('accepts method return z.array(ref()) pointing to schema def', () => {
    const Item = nodeDef({})
    const List = nodeDef({
      methods: {
        all: method({ returns: z.array(ref(Item)) }),
      },
    })
    expect(() => defineSchema('test', { Item, List })).not.toThrow()
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
    expect(() => defineSchema('test', { Target, Source })).not.toThrow()
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
    expect(() => defineSchema('test', { Source })).toThrow(SchemaValidationError)
  })

  it('validates edge method refs too', () => {
    const Outside = nodeDef({})
    const N = nodeDef({})
    expect(() =>
      defineSchema('test', {
        N,
        bad: edgeDef(
          { as: 'a', types: [N] },
          { as: 'b', types: [N] },
          { methods: { calc: method({ returns: ref(Outside) }) } },
        ),
      }),
    ).toThrow(SchemaValidationError)
  })

  // ── 7. Def registry behavior ────────────────────────────────────────

  it('registers def names in the registry', () => {
    const MyIface = iface({ props: { x: z.string() } })
    const MyNode = nodeDef({})
    const myEdge = edgeDef({ as: 'a', types: [MyNode] }, { as: 'b', types: [MyNode] })
    defineSchema('test', { MyIface, MyNode, myEdge })
    expect(getDefName(MyIface)).toBe('MyIface')
    expect(getDefName(MyNode)).toBe('MyNode')
    expect(getDefName(myEdge)).toBe('myEdge')
  })

  it('accepts registered external iface in implements', () => {
    const ExternalIface = iface({ props: { x: z.string() } })
    defineSchema('test', { ExternalIface }) // registers name
    const MyNode = nodeDef({ implements: [ExternalIface] })
    // ExternalIface not in this schema but registered → accepted
    expect(() => defineSchema('test', { MyNode })).not.toThrow()
  })

  it('accepts registered external node in edge endpoints', () => {
    const ExternalNode = nodeDef({})
    defineSchema('test', { ExternalNode }) // registers name
    const MyNode = nodeDef({})
    const myEdge = edgeDef(
      { as: 'a', types: [MyNode] },
      { as: 'b', types: [ExternalNode] },
    )
    expect(() => defineSchema('test', { MyNode, myEdge })).not.toThrow()
  })

  it('rejects unregistered external def in edge endpoints', () => {
    const Unregistered = nodeDef({}) // never passed through defineSchema
    const MyNode = nodeDef({})
    const myEdge = edgeDef(
      { as: 'a', types: [MyNode] },
      { as: 'b', types: [Unregistered] },
    )
    expect(() => defineSchema('test', { MyNode, myEdge })).toThrow(SchemaValidationError)
  })

  it('accepts registered external ref in method params', () => {
    const ExternalNode = nodeDef({})
    defineSchema('test', { ExternalNode }) // registers name
    const MyNode = nodeDef({
      methods: {
        doIt: method({ params: { target: ref(ExternalNode) }, returns: z.void() }),
      },
    })
    expect(() => defineSchema('test', { MyNode })).not.toThrow()
  })

  it('accepts registered external ref in method return', () => {
    const ExternalNode = nodeDef({})
    defineSchema('test', { ExternalNode }) // registers name
    const MyNode = nodeDef({
      methods: {
        get: method({ returns: ref(ExternalNode) }),
      },
    })
    expect(() => defineSchema('test', { MyNode })).not.toThrow()
  })

  it('rejects unregistered external ref in method params', () => {
    const Unregistered = nodeDef({}) // never passed through defineSchema
    const MyNode = nodeDef({
      methods: {
        doIt: method({ params: { target: ref(Unregistered) }, returns: z.void() }),
      },
    })
    expect(() => defineSchema('test', { MyNode })).toThrow(SchemaValidationError)
  })

  it('rejects unregistered external iface in implements', () => {
    const Unregistered = iface({ props: { x: z.string() } }) // never passed through defineSchema
    const MyNode = nodeDef({ implements: [Unregistered] })
    expect(() => defineSchema('test', { MyNode })).toThrow(SchemaValidationError)
  })

  it('rejects unregistered external node in extends', () => {
    const Unregistered = nodeDef({}) // never passed through defineSchema
    const MyNode = nodeDef({ extends: Unregistered })
    expect(() => defineSchema('test', { MyNode })).toThrow(SchemaValidationError)
  })

  it('accepts registered external iface in iface extends', () => {
    const ExternalIface = iface({ props: { x: z.string() } })
    defineSchema('test', { ExternalIface }) // registers name
    const MyIface = iface({ extends: [ExternalIface], props: { y: z.number() } })
    expect(() => defineSchema('test', { MyIface })).not.toThrow()
  })

  it('rejects unregistered external iface in iface extends', () => {
    const Unregistered = iface({ props: { x: z.string() } }) // never registered
    const MyIface = iface({ extends: [Unregistered], props: { y: z.number() } })
    expect(() => defineSchema('test', { MyIface })).toThrow(SchemaValidationError)
  })

  it('accepts registered external node in node extends', () => {
    const ExternalNode = nodeDef({ props: { x: z.string() } })
    defineSchema('test', { ExternalNode }) // registers name
    const MyNode = nodeDef({ extends: ExternalNode, props: { y: z.number() } })
    expect(() => defineSchema('test', { MyNode })).not.toThrow()
  })
})

// ── edge() with EdgeDef ─────────────────────────────────────────────────────

describe('edge() with EdgeDef', () => {
  it('resolves name from a registered EdgeDef', () => {
    const N = nodeDef({})
    const myEdge = edgeDef({ as: 'a', types: [N] }, { as: 'b', types: [N] })
    defineSchema('test', { N, myEdge }) // registers name 'myEdge'
    const n1 = node(N, {})
    const n2 = node(N, {})
    const link = edge(n1, myEdge, n2)
    expect(link.__edge).toBe('myEdge')
  })

  it('still accepts string edge names', () => {
    const N = nodeDef({})
    const n1 = node(N, {})
    const n2 = node(N, {})
    const link = edge(n1, 'someEdge', n2)
    expect(link.__edge).toBe('someEdge')
  })

  it('throws for unregistered EdgeDef', () => {
    const N = nodeDef({})
    const myEdge = edgeDef({ as: 'a', types: [N] }, { as: 'b', types: [N] })
    // Not passed through defineSchema — not registered
    const n1 = node(N, {})
    const n2 = node(N, {})
    expect(() => edge(n1, myEdge, n2)).toThrow('registered EdgeDef')
  })
})

// ── defineCore without edge validation ──────────────────────────────────────

describe('defineCore edge validation removed', () => {
  it('accepts links with external edge names', () => {
    const N = nodeDef({})
    const schema = defineSchema('test', { N })
    const n1 = node(N, {})
    const n2 = node(N, {})
    // 'external_edge' is not in schema.edges — should not throw anymore
    expect(() =>
      defineCore(schema, 'test', {
        nodes: { n1, n2 },
        links: [edge(n1, 'external_edge', n2)],
      }),
    ).not.toThrow()
  })
})
