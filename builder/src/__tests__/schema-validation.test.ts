import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { interfaceDef, classDef, method, ref } from '../defs/index.js'
import { defineSchema } from '../schema/define.js'
import { edge, node, defineCore } from '../core/index.js'
import { SchemaValidationError } from '../schema/schema.js'
import { getDefName } from '../registry.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

const A = interfaceDef({ props: { x: z.string() } })
const B = classDef({ props: { y: z.number() } })

// ── defineSchema ─────────────────────────────────────────────────────────────

describe('defineSchema', () => {
  // ── 1. Valid schema passes ───────────────────────────────────────────────

  it('accepts a valid schema', () => {
    const s = defineSchema('test', {
      A,
      B,
      ab: classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [B] },
        ],
      }),
    })
    expect(Object.keys(s.defs)).toEqual(['A', 'B', 'ab'])
  })

  // ── 2. Duplicate name ───────────────────────────────────────────────────

  it('does not throw for distinct names', () => {
    expect(() =>
      defineSchema('test', {
        I: interfaceDef({}),
        N: classDef({}),
        e: classDef({
          endpoints: [
            { as: 'a', types: [A] },
            { as: 'b', types: [B] },
          ],
        }),
        A,
        B,
      }),
    ).not.toThrow()
  })

  // ── 3. Edge unknown ref ─────────────────────────────────────────────────

  it('throws when edge references a type not in schema', () => {
    const Outside = interfaceDef({ props: { a: z.string() } })
    const Inside = classDef({})
    expect(() =>
      defineSchema('test', {
        Inside,
        bad: classDef({
          endpoints: [
            { as: 'src', types: [Outside] },
            { as: 'tgt', types: [Inside] },
          ],
        }),
      }),
    ).toThrow(SchemaValidationError)
  })

  it('error has correct field for edge unknown ref', () => {
    const Outside = classDef({})
    const Inside = classDef({})
    try {
      defineSchema('test', {
        Inside,
        bad: classDef({
          endpoints: [
            { as: 'src', types: [Outside] },
            { as: 'tgt', types: [Inside] },
          ],
        }),
      })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaValidationError)
      expect((e as SchemaValidationError).field).toBe('defs.bad.src')
    }
  })

  // ── 3b. Invalid cardinality ─────────────────────────────────────────────

  it('throws on invalid cardinality', () => {
    expect(() =>
      defineSchema('test', {
        A,
        B,
        bad: classDef({
          endpoints: [
            { as: 'a', types: [A], cardinality: 'many' as any },
            { as: 'b', types: [B] },
          ],
        }),
      }),
    ).toThrow(SchemaValidationError)
  })

  // ── 4. Unresolvable thunk ──────────────────────────────────────────────

  it('throws on unresolvable param thunk', () => {
    const Bad = classDef({
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
    const Bad = classDef({
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
    const Bad = classDef({
      props: { name: z.string() },
      indexes: [{ property: 'nonexistent', type: 'unique' as const }],
    })
    expect(() => defineSchema('test', { Bad })).toThrow(SchemaValidationError)
  })

  it('index error includes property name and available props', () => {
    const Bad = interfaceDef({
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
    const Good = classDef({
      props: { email: z.string() },
      indexes: [{ property: 'email', type: 'unique' as const }],
    })
    expect(() => defineSchema('test', { Good })).not.toThrow()
  })

  it('accepts index on inherited def prop', () => {
    const Base = interfaceDef({ props: { slug: z.string() } })
    const Child = classDef({
      inherits: [Base],
      props: { name: z.string() },
      indexes: [{ property: 'slug', type: 'unique' as const }],
    })
    expect(() => defineSchema('test', { Base, Child })).not.toThrow()
  })

  it('accepts index on inherited node extends prop', () => {
    const Parent = classDef({ props: { sku: z.string() } })
    const Child = classDef({
      inherits: [Parent],
      props: { extra: z.number() },
      indexes: ['sku'],
    })
    expect(() => defineSchema('test', { Parent, Child })).not.toThrow()
  })

  it('accepts index on deeply inherited def prop', () => {
    const GrandParent = interfaceDef({ props: { deep: z.string() } })
    const ParentIface = interfaceDef({ extends: [GrandParent], props: { mid: z.number() } })
    const Leaf = classDef({
      inherits: [ParentIface],
      indexes: [{ property: 'deep', type: 'btree' as const }],
    })
    expect(() => defineSchema('test', { GrandParent, ParentIface, Leaf })).not.toThrow()
  })

  it('throws for index on def with no props', () => {
    const Empty = interfaceDef({ indexes: ['phantom'] } as any)
    expect(() => defineSchema('test', { Empty })).toThrow(SchemaValidationError)
  })

  // ── 6. Method ref validation ──────────────────────────────────────────

  it('throws when method param ref points outside schema', () => {
    const Outside = classDef({ props: { a: z.string() } })
    const Inside = classDef({
      methods: {
        doIt: method({ params: { target: ref(Outside) }, returns: z.void() }),
      },
    })
    expect(() => defineSchema('test', { Inside })).toThrow(SchemaValidationError)
  })

  it('throws when method return ref points outside schema', () => {
    const Outside = classDef({})
    const Inside = classDef({
      methods: {
        get: method({ returns: ref(Outside) }),
      },
    })
    expect(() => defineSchema('test', { Inside })).toThrow(SchemaValidationError)
  })

  it('throws when method return z.array(ref()) points outside schema', () => {
    const Outside = classDef({})
    const Inside = classDef({
      methods: {
        list: method({ returns: z.array(ref(Outside)) }),
      },
    })
    expect(() => defineSchema('test', { Inside })).toThrow(SchemaValidationError)
  })

  it('ref error has correct field', () => {
    const Outside = classDef({})
    const Inside = classDef({
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
    const Target = classDef({})
    const Source = classDef({
      methods: {
        get: method({ params: { t: ref(Target) }, returns: z.void() }),
      },
    })
    expect(() => defineSchema('test', { Target, Source })).not.toThrow()
  })

  it('accepts method return z.array(ref()) pointing to schema def', () => {
    const Item = classDef({})
    const List = classDef({
      methods: {
        all: method({ returns: z.array(ref(Item)) }),
      },
    })
    expect(() => defineSchema('test', { Item, List })).not.toThrow()
  })

  it('accepts method with thunk params referencing schema defs', () => {
    const Target = classDef({})
    const Source = interfaceDef({
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
    const Outside = classDef({})
    const Source = classDef({
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
    const Outside = classDef({})
    const N = classDef({})
    expect(() =>
      defineSchema('test', {
        N,
        bad: classDef({
          endpoints: [
            { as: 'a', types: [N] },
            { as: 'b', types: [N] },
          ],
          methods: { calc: method({ returns: ref(Outside) }) },
        }),
      }),
    ).toThrow(SchemaValidationError)
  })

  // ── 7. Def registry behavior ────────────────────────────────────────

  it('registers def names in the registry', () => {
    const MyIface = interfaceDef({ props: { x: z.string() } })
    const MyNode = classDef({})
    const myEdge = classDef({
      endpoints: [
        { as: 'a', types: [MyNode] },
        { as: 'b', types: [MyNode] },
      ],
    })
    defineSchema('test', { MyIface, MyNode, myEdge })
    expect(getDefName(MyIface)).toBe('MyIface')
    expect(getDefName(MyNode)).toBe('MyNode')
    expect(getDefName(myEdge)).toBe('myEdge')
  })

  it('accepts registered external def in extends', () => {
    const ExternalIface = interfaceDef({ props: { x: z.string() } })
    defineSchema('test', { ExternalIface }) // registers name
    const MyNode = classDef({ inherits: [ExternalIface] })
    // ExternalIface not in this schema but registered → accepted
    expect(() => defineSchema('test', { MyNode })).not.toThrow()
  })

  it('accepts registered external node in edge endpoints', () => {
    const ExternalNode = classDef({})
    defineSchema('test', { ExternalNode }) // registers name
    const MyNode = classDef({})
    const myEdge = classDef({
      endpoints: [
        { as: 'a', types: [MyNode] },
        { as: 'b', types: [ExternalNode] },
      ],
    })
    expect(() => defineSchema('test', { MyNode, myEdge })).not.toThrow()
  })

  it('rejects unregistered external def in edge endpoints', () => {
    const Unregistered = classDef({}) // never passed through defineSchema
    const MyNode = classDef({})
    const myEdge = classDef({
      endpoints: [
        { as: 'a', types: [MyNode] },
        { as: 'b', types: [Unregistered] },
      ],
    })
    expect(() => defineSchema('test', { MyNode, myEdge })).toThrow(SchemaValidationError)
  })

  it('accepts registered external ref in method params', () => {
    const ExternalNode = classDef({})
    defineSchema('test', { ExternalNode }) // registers name
    const MyNode = classDef({
      methods: {
        doIt: method({ params: { target: ref(ExternalNode) }, returns: z.void() }),
      },
    })
    expect(() => defineSchema('test', { MyNode })).not.toThrow()
  })

  it('accepts registered external ref in method return', () => {
    const ExternalNode = classDef({})
    defineSchema('test', { ExternalNode }) // registers name
    const MyNode = classDef({
      methods: {
        get: method({ returns: ref(ExternalNode) }),
      },
    })
    expect(() => defineSchema('test', { MyNode })).not.toThrow()
  })

  it('rejects unregistered external ref in method params', () => {
    const Unregistered = classDef({}) // never passed through defineSchema
    const MyNode = classDef({
      methods: {
        doIt: method({ params: { target: ref(Unregistered) }, returns: z.void() }),
      },
    })
    expect(() => defineSchema('test', { MyNode })).toThrow(SchemaValidationError)
  })

  it('rejects unregistered external def in extends', () => {
    const Unregistered = interfaceDef({ props: { x: z.string() } }) // never passed through defineSchema
    const MyNode = classDef({ inherits: [Unregistered] })
    expect(() => defineSchema('test', { MyNode })).toThrow(SchemaValidationError)
  })

  it('rejects unregistered external node in extends', () => {
    const Unregistered = classDef({}) // never passed through defineSchema
    const MyNode = classDef({ inherits: [Unregistered] })
    expect(() => defineSchema('test', { MyNode })).toThrow(SchemaValidationError)
  })

  it('accepts registered external def in def extends', () => {
    const ExternalIface = interfaceDef({ props: { x: z.string() } })
    defineSchema('test', { ExternalIface }) // registers name
    const MyIface = interfaceDef({ extends: [ExternalIface], props: { y: z.number() } })
    expect(() => defineSchema('test', { MyIface })).not.toThrow()
  })

  it('rejects unregistered external def in def extends', () => {
    const Unregistered = interfaceDef({ props: { x: z.string() } }) // never registered
    const MyIface = interfaceDef({ extends: [Unregistered], props: { y: z.number() } })
    expect(() => defineSchema('test', { MyIface })).toThrow(SchemaValidationError)
  })

  it('accepts registered external node in node extends', () => {
    const ExternalNode = classDef({ props: { x: z.string() } })
    defineSchema('test', { ExternalNode }) // registers name
    const MyNode = classDef({ inherits: [ExternalNode], props: { y: z.number() } })
    expect(() => defineSchema('test', { MyNode })).not.toThrow()
  })
})

// ── edge() with Def (endpoints) ──────────────────────────────────────────────

describe('edge() with Def (endpoints)', () => {
  it('resolves name from a registered Def', () => {
    const N = classDef({})
    const myEdge = classDef({
      endpoints: [
        { as: 'a', types: [N] },
        { as: 'b', types: [N] },
      ],
    })
    defineSchema('test', { N, myEdge }) // registers name 'myEdge'
    const n1 = node(N, {})
    const n2 = node(N, {})
    const link = edge(n1, myEdge, n2)
    expect(link.__edge).toBe('myEdge')
  })

  it('still accepts string edge names', () => {
    const N = classDef({})
    const n1 = node(N, {})
    const n2 = node(N, {})
    const link = edge(n1, 'someEdge', n2)
    expect(link.__edge).toBe('someEdge')
  })

  it('throws for unregistered Def', () => {
    const N = classDef({})
    const myEdge = classDef({
      endpoints: [
        { as: 'a', types: [N] },
        { as: 'b', types: [N] },
      ],
    })
    // Not passed through defineSchema — not registered
    const n1 = node(N, {})
    const n2 = node(N, {})
    expect(() => edge(n1, myEdge, n2)).toThrow('registered Def')
  })
})

// ── defineCore without edge validation ──────────────────────────────────────

describe('defineCore edge validation removed', () => {
  it('accepts links with external edge names', () => {
    const N = classDef({})
    const schema = defineSchema('test', { N })
    const n1 = node(N, {})
    const n2 = node(N, {})
    // 'external_edge' is not in schema.defs — should not throw anymore
    expect(() =>
      defineCore(schema, 'test', {
        nodes: { n1, n2 },
        links: [edge(n1, 'external_edge', n2)],
      }),
    ).not.toThrow()
  })
})
