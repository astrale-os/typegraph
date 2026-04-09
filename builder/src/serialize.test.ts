import type {
  SchemaIR,
  InterfaceDecl,
  NodeDecl,
  EdgeDecl,
  AnyDecl,
  JsonSchema,
} from '@astrale/typegraph-schema'

import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { interfaceDef, classDef, fn, ref, data, prop as propDef } from './defs/index.js'
import { collectPrivateProps } from './helpers/props.js'
import { defineSchema } from './schema/define.js'
import { serialize } from './serializer/serialize.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function findNode(ir: SchemaIR, name: string): NodeDecl {
  const c = ir.classes[name]
  if (!c || c.type !== 'node') throw new Error(`Node '${name}' not found`)
  return c
}

function findIface(ir: SchemaIR, name: string): InterfaceDecl {
  const c = ir.interfaces[name]
  if (!c || c.type !== 'interface') throw new Error(`Interface '${name}' not found`)
  return c
}

function findEdge(ir: SchemaIR, name: string): EdgeDecl {
  const c = ir.classes[name]
  if (!c || c.type !== 'edge') throw new Error(`Edge '${name}' not found`)
  return c
}

function prop(decl: AnyDecl, name: string): JsonSchema {
  return decl.properties[name]
}

function findMethod(decl: AnyDecl, name: string) {
  return decl.methods[name]
}

// ── Top-level structure ──────────────────────────────────────────────────────

describe('serialize', () => {
  it('produces a valid SchemaIR with version 2.0', () => {
    const A = classDef({})
    const schema = defineSchema('test', { A })
    const ir = serialize(schema)
    expect(ir.version).toBe('1.0')
    expect(ir.types).toBeDefined()
    expect(ir.classes).toBeDefined()
    expect(typeof ir.classes).toBe('object')
  })

  it('produces an empty schema when given no defs', () => {
    const schema = defineSchema('test', {})
    const ir = serialize(schema)
    expect(ir.version).toBe('1.0')
    expect(ir.types).toEqual({})
    expect(ir.interfaces).toEqual({})
    expect(ir.classes).toEqual({})
  })

  it('is JSON-serializable', () => {
    const Iface = interfaceDef({ props: { name: z.string() } })
    const A = classDef({ inherits: [Iface], props: { x: z.number().int() } })
    const B = classDef({})
    const aToB = classDef({
      endpoints: [
        { as: 'a', types: [A] },
        { as: 'b', types: [B] },
      ],
    })
    const schema = defineSchema('test', { Iface, A, B, aToB })
    const ir = serialize(schema)
    const json = JSON.stringify(ir)
    const parsed = JSON.parse(json)
    expect(parsed.version).toBe('1.0')
    expect(Object.keys(parsed.classes).length).toBe(Object.keys(ir.classes).length)
  })

  // ── Nodes ──────────────────────────────────────────────────────────────────

  describe('nodes', () => {
    it('serializes a simple node with type=node', () => {
      const A = classDef({})
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      expect(decl.type).toBe('node')
      expect(decl.implements).toEqual([])
      expect(decl.properties).toEqual({})
      expect(decl.methods).toEqual({})
    })

    it('serializes node with string prop', () => {
      const A = classDef({ props: { name: z.string() } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'name')
      expect(p).toEqual({ type: 'string' })
    })

    it('serializes private prop with private flag', () => {
      const A = classDef({
        props: {
          name: z.string(),
          secret: propDef(z.string(), { private: true }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      expect(prop(findNode(ir, 'A'), 'name').private).toBeUndefined()
      expect(prop(findNode(ir, 'A'), 'secret')).toEqual({ type: 'string', private: true })
    })

    it('serializes node with integer prop', () => {
      const A = classDef({ props: { count: z.number().int() } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'count')
      expect(p.type).toBe('integer')
    })

    it('serializes node with boolean prop', () => {
      const A = classDef({ props: { active: z.boolean() } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'active')
      expect(p).toEqual({ type: 'boolean' })
    })

    it('serializes node with float prop', () => {
      const A = classDef({ props: { score: z.number() } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'score')
      expect(p).toEqual({ type: 'number' })
    })

    it('serializes node with datetime prop', () => {
      const A = classDef({ props: { ts: z.string().datetime() } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'ts')
      expect(p.type).toBe('string')
      expect(p.format).toBe('date-time')
    })

    it('serializes node with multiple props preserving order', () => {
      const A = classDef({
        props: {
          alpha: z.string(),
          beta: z.number(),
          gamma: z.boolean(),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      expect(Object.keys(decl.properties)).toEqual(['alpha', 'beta', 'gamma'])
    })
  })

  // ── Interfaces ───────────────────────────────────────────────────────────

  describe('interfaces', () => {
    it('serializes an interface with type=interface', () => {
      const I = interfaceDef({ props: { name: z.string() } })
      const schema = defineSchema('test', { I })
      const ir = serialize(schema)
      const decl = findIface(ir, 'I')
      expect(decl.type).toBe('interface')
      expect(Object.keys(decl.properties).length).toBe(1)
    })

    it('serializes iface extends', () => {
      const Base = interfaceDef({ props: { x: z.string() } })
      const Child = interfaceDef({ extends: [Base], props: { y: z.number() } })
      const schema = defineSchema('test', { Base, Child })
      const ir = serialize(schema)
      const decl = findIface(ir, 'Child')
      expect(decl.type).toBe('interface')
      expect(decl.extends).toEqual(['Base'])
      expect(Object.keys(decl.properties).length).toBe(1) // own only
      expect(decl.properties['y']).toBeDefined()
    })

    it('serializes node implements', () => {
      const I = interfaceDef({ props: { name: z.string() } })
      const A = classDef({ inherits: [I], props: { extra: z.boolean() } })
      const schema = defineSchema('test', { I, A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      expect(decl.implements).toEqual(['I'])
      expect(Object.keys(decl.properties).length).toBe(1) // own only
      expect(decl.properties['extra']).toBeDefined()
    })

    it('serializes node with multiple interface implementations', () => {
      const I1 = interfaceDef({ props: { a: z.string() } })
      const I2 = interfaceDef({ props: { b: z.number() } })
      const A = classDef({ inherits: [I1, I2] })
      const schema = defineSchema('test', { I1, I2, A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      expect(decl.implements).toEqual(['I1', 'I2'])
    })
  })

  // ── Nullable & optional ──────────────────────────────────────────────────

  describe('nullable / optional', () => {
    it('folds optional prop into type array with null', () => {
      const A = classDef({ props: { name: z.string().optional() } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'name')
      expect(p.type).toEqual(['string', 'null'])
    })

    it('folds nullable prop into type array with null', () => {
      const A = classDef({ props: { name: z.string().nullable() } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'name')
      expect(p.type).toEqual(['string', 'null'])
    })

    it('required props have no null in type', () => {
      const A = classDef({ props: { name: z.string() } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'name')
      expect(p.type).toBe('string')
    })
  })

  // ── Defaults ───────────────────────────────────────────────────────────────

  describe('defaults', () => {
    it('folds string default into schema', () => {
      const A = classDef({ props: { status: z.string().default('active') } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'status')
      expect(p.default).toBe('active')
    })

    it('folds number default into schema', () => {
      const A = classDef({ props: { count: z.number().default(0) } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'count')
      expect(p.default).toBe(0)
    })

    it('folds boolean default into schema', () => {
      const A = classDef({ props: { active: z.boolean().default(false) } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'active')
      expect(p.default).toBe(false)
    })

    it('omits default when not present', () => {
      const A = classDef({ props: { name: z.string() } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'name')
      expect(p.default).toBeUndefined()
    })
  })

  // ── Enum / shared types ─────────────────────────────────────────────────

  describe('shared types', () => {
    it('hoists named types from options.types', () => {
      const Priority = z.enum(['low', 'medium', 'high'])
      const A = classDef({ props: { priority: Priority } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema, { types: { Priority } })
      expect(ir.types).toHaveProperty('Priority')
      expect(ir.types.Priority.enum).toEqual(['low', 'medium', 'high'])
      // Property should reference via $ref
      const p = prop(findNode(ir, 'A'), 'priority')
      expect(p).toEqual({ $ref: '#/types/Priority' })
    })

    it('uses $ref for named types in method params', () => {
      const Priority = z.enum(['low', 'medium', 'high'])
      const A = classDef({
        methods: {
          setPriority: fn({ params: { p: Priority }, returns: z.boolean() }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema, { types: { Priority } })
      const m = findMethod(findNode(ir, 'A'), 'setPriority')!
      expect(m.params['p']).toEqual({ $ref: '#/types/Priority' })
    })

    it('works with multiple named types', () => {
      const Priority = z.enum(['low', 'medium', 'high'])
      const Status = z.enum(['active', 'archived'])
      const A = classDef({
        props: { priority: Priority, status: Status },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema, { types: { Priority, Status } })
      expect(Object.keys(ir.types)).toContain('Priority')
      expect(Object.keys(ir.types)).toContain('Status')
    })

    it('inlines enum when not explicitly hoisted', () => {
      const A = classDef({ props: { priority: z.enum(['low', 'high']) } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      // Should be inlined, not $ref
      const p = prop(findNode(ir, 'A'), 'priority')
      expect(p.enum).toEqual(['low', 'high'])
      expect(ir.types).toEqual({})
    })
  })

  // ── Methods ──────────────────────────────────────────────────────────────

  describe('methods', () => {
    it('serializes a simple method', () => {
      const A = classDef({
        methods: {
          greet: fn({ returns: z.string() }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'A'), 'greet')!
      expect(m.name).toBe('greet')
      expect(m.params).toEqual({})
      expect(m.returns).toEqual({ type: 'string' })
    })

    it('serializes method with no params', () => {
      const A = classDef({
        methods: {
          internal: fn({ returns: z.boolean() }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'A'), 'internal')!
      expect(m.params).toEqual({})
    })

    it('serializes method params', () => {
      const A = classDef({
        methods: {
          setName: fn({
            params: { name: z.string(), age: z.number().int() },
            returns: z.boolean(),
          }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'A'), 'setName')!
      expect(Object.keys(m.params).length).toBe(2)
      expect(m.params['name']).toEqual({ type: 'string' })
      expect(m.params['age'].type).toBe('integer')
    })

    it('folds method param default into schema', () => {
      const A = classDef({
        methods: {
          setCount: fn({
            params: { count: z.number().default(10) },
            returns: z.boolean(),
          }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'A'), 'setCount')!
      expect(m.params['count'].default).toBe(10)
    })

    it('serializes method with nullable return', () => {
      const A = classDef({
        methods: {
          findName: fn({ returns: z.string().optional() }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'A'), 'findName')!
      expect(m.returnsNullable).toBe(true)
      expect(m.returns).toEqual({ type: 'string' })
    })

    it('serializes multiple methods preserving order', () => {
      const A = classDef({
        methods: {
          alpha: fn({ returns: z.string() }),
          beta: fn({ returns: z.number() }),
          gamma: fn({ returns: z.boolean() }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      expect(Object.keys(decl.methods)).toEqual(['alpha', 'beta', 'gamma'])
    })

    it('serializes static method with static: true', () => {
      const A = classDef({
        methods: {
          create: fn({ static: true, params: { name: z.string() }, returns: z.string() }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'A'), 'create')!
      expect(m.static).toBe(true)
      expect(m.params['name']).toEqual({ type: 'string' })
    })

    it('defaults static to false for non-static methods', () => {
      const A = classDef({
        methods: {
          greet: fn({ returns: z.string() }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'A'), 'greet')!
      expect(m.static).toBe(false)
    })

    it('serializes mixed static and instance methods', () => {
      const A = classDef({
        methods: {
          init: fn({ static: true, params: { title: z.string() }, returns: z.string() }),
          rename: fn({ params: { newTitle: z.string() }, returns: z.boolean() }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const initM = findMethod(findNode(ir, 'A'), 'init')!
      const renameM = findMethod(findNode(ir, 'A'), 'rename')!
      expect(initM.static).toBe(true)
      expect(renameM.static).toBe(false)
    })
  })

  // ── $nodeRef ─────────────────────────────────────────────────────────────

  describe('$nodeRef', () => {
    it('serializes ref() in method params', () => {
      const A = classDef({})
      const B = classDef({
        methods: {
          linkTo: fn({ params: { target: ref(A) }, returns: z.boolean() }),
        },
      })
      const schema = defineSchema('test', { A, B })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'B'), 'linkTo')!
      expect(m.params['target']).toEqual({ $nodeRef: 'A' })
    })

    it('serializes ref() in method return', () => {
      const A = classDef({})
      const B = classDef({
        methods: {
          getA: fn({ returns: ref(A) }),
        },
      })
      const schema = defineSchema('test', { A, B })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'B'), 'getA')!
      expect(m.returns).toEqual({ $nodeRef: 'A' })
    })

    it('serializes ref() to interface', () => {
      const I = interfaceDef({ props: { name: z.string() } })
      const A = classDef({
        inherits: [I],
        methods: {
          getI: fn({ returns: ref(I) }),
        },
      })
      const schema = defineSchema('test', { I, A })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'A'), 'getI')!
      expect(m.returns).toEqual({ $nodeRef: 'I' })
    })

    it('serializes array of refs', () => {
      const A = classDef({})
      const B = classDef({
        methods: {
          getMany: fn({ returns: z.array(ref(A)) }),
        },
      })
      const schema = defineSchema('test', { A, B })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'B'), 'getMany')!
      expect(m.returns).toEqual({
        type: 'array',
        items: { $nodeRef: 'A' },
      })
    })

    it('serializes ref(A, { data: true }) in method return', () => {
      const A = classDef({ data: { body: z.string() } })
      const B = classDef({
        methods: {
          getFull: fn({ returns: ref(A, { data: true }) }),
        },
      })
      const schema = defineSchema('test', { A, B })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'B'), 'getFull')!
      expect(m.returns).toEqual({ $nodeRef: 'A', includeData: true })
    })

    it('serializes ref(A, { data: true }) in method param', () => {
      const A = classDef({ data: { body: z.string() } })
      const B = classDef({
        methods: {
          process: fn({ params: { item: ref(A, { data: true }) }, returns: z.boolean() }),
        },
      })
      const schema = defineSchema('test', { A, B })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'B'), 'process')!
      expect(m.params['item']).toEqual({ $nodeRef: 'A', includeData: true })
    })

    it('serializes ref(A, { data: true }).optional() with anyOf nullable', () => {
      const A = classDef({ data: { body: z.string() } })
      const B = classDef({
        methods: {
          maybe: fn({ params: { item: ref(A, { data: true }).optional() }, returns: z.boolean() }),
        },
      })
      const schema = defineSchema('test', { A, B })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'B'), 'maybe')!
      expect(m.params['item']).toEqual({
        anyOf: [{ $nodeRef: 'A', includeData: true }, { type: 'null' }],
      })
    })

    it('serializes z.array(ref(A, { data: true }))', () => {
      const A = classDef({ data: { body: z.string() } })
      const B = classDef({
        methods: {
          listFull: fn({ returns: z.array(ref(A, { data: true })) }),
        },
      })
      const schema = defineSchema('test', { A, B })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'B'), 'listFull')!
      expect(m.returns).toEqual({
        type: 'array',
        items: { $nodeRef: 'A', includeData: true },
      })
    })

    it('ref(A) without data option has no includeData key', () => {
      const A = classDef({ data: { body: z.string() } })
      const B = classDef({
        methods: {
          getA: fn({ returns: ref(A) }),
        },
      })
      const schema = defineSchema('test', { A, B })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'B'), 'getA')!
      expect(m.returns).toEqual({ $nodeRef: 'A' })
      expect(m.returns).not.toHaveProperty('includeData')
    })
  })

  // ── $dataRef ─────────────────────────────────────────────────────────────

  describe('$dataRef', () => {
    it('serializes data() self as $dataRef self', () => {
      const A = classDef({
        data: { body: z.string() },
        methods: {
          content: fn({ returns: data() }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'A'), 'content')!
      expect(m.returns).toEqual({ $dataRef: 'self' })
    })

    it('serializes data(target) as $dataRef with name', () => {
      const A = classDef({ data: { body: z.string() } })
      const B = classDef({
        methods: {
          getAData: fn({ returns: data(A) }),
        },
      })
      const schema = defineSchema('test', { A, B })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'B'), 'getAData')!
      expect(m.returns).toEqual({ $dataRef: 'A' })
    })
  })

  // ── Data schema ────────────────────────────────────────────────────────

  describe('data schema', () => {
    it('serializes data as JSON Schema object', () => {
      const A = classDef({ data: { body: z.string(), count: z.number() } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      expect(decl.data).toBeDefined()
      expect(decl.data!.type).toBe('object')
      expect(decl.data!.properties).toBeDefined()
    })

    it('omits data when not defined', () => {
      const A = classDef({})
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      expect(decl.data).toBeUndefined()
    })
  })

  // ── Edges ──────────────────────────────────────────────────────────────

  describe('edges', () => {
    it('serializes a simple edge', () => {
      const A = classDef({})
      const B = classDef({})
      const aToB = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [B] },
        ],
      })
      const schema = defineSchema('test', { A, B, aToB })
      const ir = serialize(schema)
      const e = findEdge(ir, 'aToB')
      expect(e.type).toBe('edge')
      expect(e.endpoints.length).toBe(2)
      expect(e.endpoints[0].name).toBe('a')
      expect(e.endpoints[0].types).toEqual(['A'])
      expect(e.endpoints[1].name).toBe('b')
      expect(e.endpoints[1].types).toEqual(['B'])
    })

    it('serializes edge with cardinality 0..1', () => {
      const A = classDef({})
      const B = classDef({})
      const aToB = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [B], cardinality: '0..1' },
        ],
      })
      const schema = defineSchema('test', { A, B, aToB })
      const ir = serialize(schema)
      const e = findEdge(ir, 'aToB')
      expect(e.endpoints[1].cardinality).toEqual({ min: 0, max: 1 })
    })

    it('serializes edge with cardinality 1', () => {
      const A = classDef({})
      const B = classDef({})
      const aToB = classDef({
        endpoints: [
          { as: 'a', types: [A], cardinality: '1' },
          { as: 'b', types: [B] },
        ],
      })
      const schema = defineSchema('test', { A, B, aToB })
      const ir = serialize(schema)
      const e = findEdge(ir, 'aToB')
      expect(e.endpoints[0].cardinality).toEqual({ min: 1, max: 1 })
    })

    it('serializes edge with cardinality 1..*', () => {
      const A = classDef({})
      const B = classDef({})
      const aToB = classDef({
        endpoints: [
          { as: 'a', types: [A], cardinality: '1..*' },
          { as: 'b', types: [B] },
        ],
      })
      const schema = defineSchema('test', { A, B, aToB })
      const ir = serialize(schema)
      const e = findEdge(ir, 'aToB')
      expect(e.endpoints[0].cardinality).toEqual({ min: 1, max: null })
    })

    it('omits cardinality when not set (defaults to 0..*)', () => {
      const A = classDef({})
      const B = classDef({})
      const aToB = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [B] },
        ],
      })
      const schema = defineSchema('test', { A, B, aToB })
      const ir = serialize(schema)
      const e = findEdge(ir, 'aToB')
      expect(e.endpoints[0].cardinality).toBeUndefined()
      expect(e.endpoints[1].cardinality).toBeUndefined()
    })

    it('serializes edge with multi-type endpoints', () => {
      const A = classDef({})
      const B = classDef({})
      const C = classDef({})
      const mixed = classDef({
        endpoints: [
          { as: 'source', types: [A, B] },
          { as: 'target', types: [C] },
        ],
      })
      const schema = defineSchema('test', { A, B, C, mixed })
      const ir = serialize(schema)
      const e = findEdge(ir, 'mixed')
      expect(e.endpoints[0].types).toEqual(['A', 'B'])
    })

    it('serializes edge with interface endpoint', () => {
      const I = interfaceDef({})
      const A = classDef({ inherits: [I] })
      const e1 = classDef({
        endpoints: [
          { as: 'source', types: [I] },
          { as: 'target', types: [A] },
        ],
      })
      const schema = defineSchema('test', { I, A, e1 })
      const ir = serialize(schema)
      const e = findEdge(ir, 'e1')
      expect(e.endpoints[0].types).toEqual(['I'])
    })
  })

  // ── Edge constraints ──────────────────────────────────────────────────

  describe('edge constraints', () => {
    it('serializes unique constraint', () => {
      const A = classDef({})
      const e1 = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [A] },
        ],
        constraints: { unique: true },
      })
      const schema = defineSchema('test', { A, e1 })
      const ir = serialize(schema)
      const e = findEdge(ir, 'e1')
      expect(e.constraints).toEqual({ unique: true })
    })

    it('serializes noSelf constraint', () => {
      const A = classDef({})
      const e1 = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [A] },
        ],
        constraints: { noSelf: true },
      })
      const schema = defineSchema('test', { A, e1 })
      const ir = serialize(schema)
      const e = findEdge(ir, 'e1')
      expect(e.constraints).toEqual({ noSelf: true })
    })

    it('serializes acyclic constraint', () => {
      const A = classDef({})
      const e1 = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [A] },
        ],
        constraints: { acyclic: true },
      })
      const schema = defineSchema('test', { A, e1 })
      const ir = serialize(schema)
      const e = findEdge(ir, 'e1')
      expect(e.constraints).toEqual({ acyclic: true })
    })

    it('serializes multiple constraints', () => {
      const A = classDef({})
      const e1 = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [A] },
        ],
        constraints: { noSelf: true, acyclic: true },
      })
      const schema = defineSchema('test', { A, e1 })
      const ir = serialize(schema)
      const e = findEdge(ir, 'e1')
      expect(e.constraints).toEqual({ noSelf: true, acyclic: true })
    })

    it('omits constraints when none set', () => {
      const A = classDef({})
      const e1 = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [A] },
        ],
      })
      const schema = defineSchema('test', { A, e1 })
      const ir = serialize(schema)
      const e = findEdge(ir, 'e1')
      expect(e.constraints).toBeUndefined()
    })
  })

  // ── Edge props ──────────────────────────────────────────────────────────

  describe('edge properties', () => {
    it('serializes edge with props', () => {
      const A = classDef({})
      const e1 = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [A] },
        ],
        props: { weight: z.number(), label: z.string().optional() },
      })
      const schema = defineSchema('test', { A, e1 })
      const ir = serialize(schema)
      const e = findEdge(ir, 'e1')
      expect(Object.keys(e.properties).length).toBe(2)
      expect(e.properties['weight']).toEqual({ type: 'number' })
      expect(e.properties['label'].type).toEqual(['string', 'null'])
    })
  })

  // ── Thunks (lazy config) ──────────────────────────────────────────────

  describe('thunks', () => {
    it('handles iface with thunk config (circular refs)', () => {
      const I: any = interfaceDef(() => ({
        methods: {
          getParent: fn({ params: { child: ref(I) }, returns: ref(I) }),
        },
      }))
      const schema = defineSchema('test', { I })
      const ir = serialize(schema)
      const m = findMethod(findIface(ir, 'I'), 'getParent')!
      expect(m.params['child']).toEqual({ $nodeRef: 'I' })
      expect(m.returns).toEqual({ $nodeRef: 'I' })
    })
  })

  // ── Zod schema edge cases ────────────────────────────────────────────

  describe('zod edge cases', () => {
    it('serializes z.object as JSON Schema', () => {
      const A = classDef({
        methods: {
          create: fn({
            params: { input: z.object({ x: z.string(), y: z.number() }) },
            returns: z.boolean(),
          }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'A'), 'create')!
      expect(m.params['input'].type).toBe('object')
      expect(m.params['input'].properties).toBeDefined()
    })

    it('serializes z.array with standard items', () => {
      const A = classDef({
        methods: {
          getTags: fn({ returns: z.array(z.string()) }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'A'), 'getTags')!
      expect(m.returns.type).toBe('array')
      expect(m.returns.items).toEqual({ type: 'string' })
    })

    it('serializes enum as inline when not hoisted', () => {
      const A = classDef({
        props: { status: z.enum(['a', 'b', 'c']) },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'status')
      expect(p.enum).toEqual(['a', 'b', 'c'])
    })

    it('handles constrained strings', () => {
      const A = classDef({
        props: { email: z.string().email() },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'email')
      expect(p.type).toBe('string')
      expect(p.format).toBe('email')
    })

    it('handles bounded numbers', () => {
      const A = classDef({
        props: { score: z.number().min(0).max(100) },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'score')
      expect(p.type).toBe('number')
      expect(p.minimum).toBe(0)
      expect(p.maximum).toBe(100)
    })

    it('handles bounded strings', () => {
      const A = classDef({
        props: { name: z.string().min(1).max(255) },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'name')
      expect(p.type).toBe('string')
      expect(p.minLength).toBe(1)
      expect(p.maxLength).toBe(255)
    })
  })

  // ── Kernel integration ───────────────────────────────────────────────

  describe('kernel schema integration', () => {
    // Simulate a kernel schema — defineSchema registers each def in the registry
    const Node = interfaceDef({})
    const Identity = interfaceDef({ extends: [Node], props: { iss: z.string(), sub: z.string() } })
    const Root = classDef({ inherits: [Identity] })
    const hasParent = classDef({
      endpoints: [
        { as: 'child', types: [Node], cardinality: '0..1' },
        { as: 'parent', types: [Node] },
      ],
      constraints: { noSelf: true, acyclic: true },
    })
    // This registers all defs under the 'astrale.core' domain
    const kernelSchema = defineSchema('astrale.core', { Node, Identity, Root, hasParent })

    it('serializes full kernel schema', () => {
      const ir = serialize(kernelSchema)

      expect(ir.version).toBe('1.0')
      expect(ir.domain).toBe('astrale.core')
      expect(ir.imports).toBeUndefined()
      expect(Object.keys(ir.interfaces).length).toBe(2)
      expect(Object.keys(ir.classes).length).toBe(2)

      expect(ir.interfaces['Node']).toBeDefined()
      expect(ir.interfaces['Identity']).toBeDefined()
      expect(ir.classes['Root']).toBeDefined()
      expect(ir.classes['hasParent']).toBeDefined()
    })

    it('serializes distribution schema referencing kernel defs via registry', () => {
      const Timestamped = interfaceDef({
        props: {
          createdAt: z.string().datetime().optional(),
          updatedAt: z.string().datetime().optional(),
        },
      })
      // Task implements Identity from kernel — no spread needed
      const Task = classDef({
        inherits: [Identity, Timestamped],
        props: {
          title: z.string(),
          done: z.boolean().default(false),
        },
      })
      // Distribution schema only contains its own defs
      const distSchema = defineSchema('acme.todo', { Timestamped, Task })
      const ir = serialize(distSchema)

      // Only distribution defs in the IR
      expect(ir.domain).toBe('acme.todo')
      expect(Object.keys(ir.interfaces).length).toBe(1)
      expect(Object.keys(ir.classes).length).toBe(1)
      expect(ir.interfaces['Timestamped']).toBeDefined()
      expect(ir.classes['Task']).toBeDefined()

      // Identity resolved via registry — appears in imports
      expect(ir.imports).toEqual({ Identity: 'astrale.core' })

      const taskDecl = findNode(ir, 'Task')
      expect(taskDecl.implements).toContain('Identity')
      expect(taskDecl.implements).toContain('Timestamped')
      expect(Object.keys(taskDecl.properties)).toEqual(['title', 'done'])
    })

    it('serializes edge endpoints referencing registered external defs', () => {
      const Widget = classDef({ inherits: [Node] })
      const widgetLink = classDef({
        endpoints: [
          { as: 'widget', types: [Widget] },
          { as: 'parent', types: [Node] },
        ], // Node from kernel, registered
      })
      const distSchema = defineSchema('acme.widgets', { Widget, widgetLink })
      const ir = serialize(distSchema)

      expect(ir.imports).toEqual({ Node: 'astrale.core' })

      const e = findEdge(ir, 'widgetLink')
      expect(e.endpoints[1].types).toEqual(['Node'])
    })
  })

  // ── Complete todo-app-style schema ───────────────────────────────────

  describe('todo app integration', () => {
    it('serializes a complete app schema matching spec §7', () => {
      // Simulate kernel schema (registers defs in the registry)
      const Node = interfaceDef({})
      const Identity = interfaceDef({
        extends: [Node],
        props: { iss: z.string(), sub: z.string() },
      })
      void defineSchema('astrale.core', { Node, Identity }) // registers Node and Identity

      const Priority = z.enum(['low', 'medium', 'high', 'urgent'])
      const TaskStatus = z.enum(['todo', 'in_progress', 'done', 'cancelled'])

      const Timestamped = interfaceDef({
        props: {
          createdAt: z.string().datetime().optional(),
          updatedAt: z.string().datetime().optional(),
        },
      })

      const Project = classDef({
        inherits: [Identity, Timestamped],
        props: {
          name: z.string(),
          description: z.string().optional(),
          archived: z.boolean().default(false),
        },
        methods: {
          summary: fn({ returns: z.string() }),
          taskCount: fn({ returns: z.number().int() }),
          addTask: fn({
            params: { title: z.string(), priority: Priority.default('medium') },
            returns: z.boolean(),
          }),
        },
      })

      const Task = classDef({
        inherits: [Timestamped],
        props: {
          title: z.string(),
          description: z.string().optional(),
          status: TaskStatus.default('todo'),
          priority: Priority.default('medium'),
          dueDate: z.string().datetime().optional(),
        },
        methods: {
          formatTitle: fn({ returns: z.string() }),
          complete: fn({ returns: z.boolean() }),
          reopen: fn({ returns: z.boolean() }),
        },
      })

      const Tag = classDef({
        inherits: [Timestamped],
        props: {
          name: z.string(),
          color: z.string().optional(),
        },
      })

      const belongsTo = classDef({
        endpoints: [
          { as: 'task', types: [Task] },
          { as: 'project', types: [Project], cardinality: '0..1' },
        ],
        constraints: { unique: true },
      })

      const taggedWith = classDef({
        endpoints: [
          { as: 'task', types: [Task] },
          { as: 'tag', types: [Tag] },
        ],
        constraints: { unique: true },
      })

      const dependsOn = classDef({
        endpoints: [
          { as: 'blocker', types: [Task] },
          { as: 'blocked', types: [Task] },
        ],
        constraints: { noSelf: true, acyclic: true },
      })

      // Distribution schema — only own defs, kernel refs via registry
      const schema = defineSchema('acme.todo', {
        Timestamped,
        Project,
        Task,
        Tag,
        belongsTo,
        taggedWith,
        dependsOn,
      })

      const ir = serialize(schema, { types: { Priority, TaskStatus } })

      // ── Structure ──
      expect(ir.version).toBe('1.0')
      expect(ir.domain).toBe('acme.todo')
      expect(ir.imports).toEqual({ Identity: 'astrale.core' })

      // ── Shared types ──
      expect(ir.types.Priority).toBeDefined()
      expect(ir.types.Priority.enum).toEqual(['low', 'medium', 'high', 'urgent'])
      expect(ir.types.TaskStatus).toBeDefined()
      expect(ir.types.TaskStatus.enum).toEqual(['todo', 'in_progress', 'done', 'cancelled'])

      // ── Timestamped (interface) ──
      const ts = findIface(ir, 'Timestamped')
      expect(ts.type).toBe('interface')
      expect(Object.keys(ts.properties).length).toBe(2)
      // nullable folded into schema
      expect(ts.properties['updatedAt'].type).toEqual(['string', 'null'])

      // ── Project ──
      const proj = findNode(ir, 'Project')
      expect(proj.implements).toContain('Identity')
      expect(proj.implements).toContain('Timestamped')
      expect(Object.keys(proj.properties)).toEqual(['name', 'description', 'archived'])
      expect(proj.properties['archived'].default).toBe(false)
      expect(Object.keys(proj.methods).length).toBe(3)

      // addTask method with Priority param
      const addTask = findMethod(proj, 'addTask')!
      expect(Object.keys(addTask.params).length).toBe(2)
      expect(addTask.params['priority']).toEqual({ $ref: '#/types/Priority', default: 'medium' })

      // ── Task ──
      const task = findNode(ir, 'Task')
      expect(task.implements).toEqual(['Timestamped'])
      const statusProp = task.properties['status']
      expect(statusProp).toEqual({ $ref: '#/types/TaskStatus', default: 'todo' })

      // ── Edges ──
      const bt = findEdge(ir, 'belongsTo')
      expect(bt.endpoints[0].types).toEqual(['Task'])
      expect(bt.endpoints[1].types).toEqual(['Project'])
      expect(bt.endpoints[1].cardinality).toEqual({ min: 0, max: 1 })
      expect(bt.constraints).toEqual({ unique: true })

      const dep = findEdge(ir, 'dependsOn')
      expect(dep.constraints).toEqual({ noSelf: true, acyclic: true })

      // ── JSON serializable ──
      const json = JSON.stringify(ir)
      expect(() => JSON.parse(json)).not.toThrow()
    })
  })

  // ── Additional edge constraints (symmetric, onDelete) ──────────────

  describe('extended edge constraints', () => {
    it('serializes symmetric constraint', () => {
      const A = classDef({})
      const e1 = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [A] },
        ],
        constraints: { symmetric: true },
      })
      const schema = defineSchema('test', { A, e1 })
      const ir = serialize(schema)
      const e = findEdge(ir, 'e1')
      expect(e.constraints).toEqual({ symmetric: true })
    })

    it('serializes all constraints together', () => {
      const A = classDef({})
      const e1 = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [A] },
        ],
        constraints: { noSelf: true, acyclic: true, unique: true, symmetric: true },
      })
      const schema = defineSchema('test', { A, e1 })
      const ir = serialize(schema)
      const e = findEdge(ir, 'e1')
      expect(e.constraints).toEqual({
        noSelf: true,
        acyclic: true,
        unique: true,
        symmetric: true,
      })
    })
  })

  // ── 0..* cardinality omission ────────────────────────────────────────

  describe('cardinality 0..* omission', () => {
    it('omits cardinality when explicitly set to 0..*', () => {
      const A = classDef({})
      const B = classDef({})
      const aToB = classDef({
        endpoints: [
          { as: 'a', types: [A], cardinality: '0..*' },
          { as: 'b', types: [B] },
        ],
      })
      const schema = defineSchema('test', { A, B, aToB })
      const ir = serialize(schema)
      const e = findEdge(ir, 'aToB')
      // Per spec §3.8: 0..* is the default and should be absent
      expect(e.endpoints[0].cardinality).toBeUndefined()
    })
  })

  // ── Edge methods ─────────────────────────────────────────────────────

  describe('edge methods', () => {
    it('serializes methods on edges', () => {
      const A = classDef({})
      const e1 = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [A] },
        ],
        methods: {
          weight: fn({ returns: z.number() }),
        },
      } as any)
      const schema = defineSchema('test', { A, e1 })
      const ir = serialize(schema)
      const e = findEdge(ir, 'e1')
      expect(Object.keys(e.methods).length).toBe(1)
      expect(e.methods['weight']).toBeDefined()
    })
  })

  // ── Deeply nested optionals ──────────────────────────────────────────

  describe('deeply nested optionals', () => {
    it('handles z.string().optional().nullable()', () => {
      const A = classDef({ props: { name: z.string().optional().nullable() } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'name')
      expect(p.type).toEqual(['string', 'null'])
    })

    it('handles z.string().nullable().default(null)', () => {
      const A = classDef({ props: { name: z.string().nullable().default(null) } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'name')
      expect(p.type).toEqual(['string', 'null'])
      expect(p.default).toBe(null)
    })
  })

  // ── Interface with data ──────────────────────────────────────────────

  describe('interface with data', () => {
    it('serializes data on an interface', () => {
      const I = interfaceDef({ data: { content: z.string() } })
      const schema = defineSchema('test', { I })
      const ir = serialize(schema)
      const decl = findIface(ir, 'I')
      expect(decl.data).toBeDefined()
      expect(decl.data!.type).toBe('object')
    })
  })

  // ── Optional ref in params ───────────────────────────────────────────

  describe('optional ref in params', () => {
    it('handles ref().optional() as a param with anyOf nullable', () => {
      const A = classDef({})
      const B = classDef({
        methods: {
          maybe: fn({ params: { target: ref(A).optional() }, returns: z.boolean() }),
        },
      })
      const schema = defineSchema('test', { A, B })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'B'), 'maybe')!
      expect(m.params['target']).toEqual({
        anyOf: [{ $nodeRef: 'A' }, { type: 'null' }],
      })
    })
  })

  // ── Complex object default ──────────────────────────────────────────

  describe('complex object defaults', () => {
    it('folds complex object default into schema.default', () => {
      const A = classDef({
        props: { config: z.object({ x: z.string() }).default({ x: 'hi' }) },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'config')
      expect(p.default).toEqual({ x: 'hi' })
    })
  })

  // ── Standalone functions rejected ──────────────────────────────────

  describe('standalone functions rejected', () => {
    it('throws when a standalone fn is passed to defineSchema', () => {
      const createTask = fn({
        params: { title: z.string() },
        returns: z.boolean(),
      })
      expect(() => defineSchema('test', { createTask } as any)).toThrow(/Unsupported def type/)
    })
  })

  // ── Data declarations (comprehensive) ──────────────────────────────

  describe('data declarations', () => {
    it('serializes data with multiple field types', () => {
      const A = classDef({
        data: {
          title: z.string(),
          views: z.number().int(),
          published: z.boolean(),
          rating: z.number(),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      expect(decl.data).toBeDefined()
      expect(decl.data!.type).toBe('object')
      const props = decl.data!.properties as Record<string, any>
      expect(props.title.type).toBe('string')
      expect(props.views.type).toBe('integer')
      expect(props.published.type).toBe('boolean')
      expect(props.rating.type).toBe('number')
    })

    it('serializes data with optional fields', () => {
      const A = classDef({
        data: {
          body: z.string(),
          summary: z.string().optional(),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      expect(decl.data).toBeDefined()
      const props = decl.data!.properties as Record<string, any>
      expect(props.body).toBeDefined()
      expect(props.summary).toBeDefined()
    })

    it('serializes data with array fields', () => {
      const A = classDef({
        data: {
          tags: z.array(z.string()),
          images: z.array(z.string().url()),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      expect(decl.data).toBeDefined()
      const props = decl.data!.properties as Record<string, any>
      expect(props.tags.type).toBe('array')
      expect(props.images.type).toBe('array')
    })

    it('serializes data with record/map fields', () => {
      const A = classDef({
        data: {
          metadata: z.record(z.string(), z.string()),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      expect(decl.data).toBeDefined()
      const props = decl.data!.properties as Record<string, any>
      expect(props.metadata.type).toBe('object')
    })

    it('serializes data with nested object fields', () => {
      const A = classDef({
        data: {
          content: z.object({
            html: z.string(),
            plain: z.string(),
          }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      expect(decl.data).toBeDefined()
      const props = decl.data!.properties as Record<string, any>
      expect(props.content.type).toBe('object')
      expect(props.content.properties.html.type).toBe('string')
      expect(props.content.properties.plain.type).toBe('string')
    })

    it('data on iface serializes correctly', () => {
      const ContentIface = interfaceDef({
        data: { body: z.string(), format: z.enum(['md', 'html']) },
      })
      const schema = defineSchema('test', { ContentIface })
      const ir = serialize(schema)
      const decl = findIface(ir, 'ContentIface')
      expect(decl.type).toBe('interface')
      expect(decl.data).toBeDefined()
      expect(decl.data!.type).toBe('object')
      const props = decl.data!.properties as Record<string, any>
      expect(props.body.type).toBe('string')
      expect(props.format.enum).toEqual(['md', 'html'])
    })

    it('node with data and props keeps them separate', () => {
      const A = classDef({
        props: { title: z.string(), status: z.enum(['draft', 'published']) },
        data: { body: z.string(), images: z.array(z.string().url()) },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      // Props → properties map
      expect(Object.keys(decl.properties).length).toBe(2)
      expect(decl.properties['title']).toBeDefined()
      expect(decl.properties['status']).toBeDefined()
      // Data → separate schema
      expect(decl.data).toBeDefined()
      expect(decl.data!.type).toBe('object')
      const dataProps = decl.data!.properties as Record<string, any>
      expect(dataProps.body.type).toBe('string')
      expect(dataProps.images.type).toBe('array')
    })

    it('node with empty data object omits data', () => {
      const A = classDef({ data: {} })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      expect(decl.data).toBeUndefined()
    })

    it('data() self return in method with data on same node', () => {
      const A = classDef({
        data: {
          body: z.string(),
          specs: z.record(z.string(), z.string()).optional(),
        },
        methods: {
          content: fn({ returns: data() }),
        },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const decl = findNode(ir, 'A')
      expect(decl.data).toBeDefined()
      const m = findMethod(decl, 'content')!
      expect(m.returns).toEqual({ $dataRef: 'self' })
    })

    it('data(target) cross-node return', () => {
      const Article = classDef({
        data: { body: z.string(), html: z.string() },
      })
      const Reader = classDef({
        methods: {
          readArticle: fn({
            params: { article: ref(Article) },
            returns: data(Article),
          }),
        },
      })
      const schema = defineSchema('test', { Article, Reader })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'Reader'), 'readArticle')!
      expect(m.params['article']).toEqual({ $nodeRef: 'Article' })
      expect(m.returns).toEqual({ $dataRef: 'Article' })
    })
  })

  // ── Concrete inheritance (node extends) ─────────────────────────────

  describe('node extends (concrete inheritance)', () => {
    it('serializes extended node with parent in implements', () => {
      const Base = classDef({
        props: { name: z.string() },
      })
      const Child = classDef({
        inherits: [Base],
        props: { extra: z.boolean() },
      })
      const schema = defineSchema('test', { Base, Child })
      const ir = serialize(schema)
      const child = findNode(ir, 'Child')
      expect(child.implements).toContain('Base')
      expect(Object.keys(child.properties).length).toBe(1) // own only
      expect(child.properties['extra']).toBeDefined()
    })

    it('serializes two-level node extends chain', () => {
      const Base = classDef({ props: { a: z.string() } })
      const Mid = classDef({ inherits: [Base], props: { b: z.number() } })
      const Leaf = classDef({ inherits: [Mid], props: { c: z.boolean() } })
      const schema = defineSchema('test', { Base, Mid, Leaf })
      const ir = serialize(schema)
      const leaf = findNode(ir, 'Leaf')
      expect(leaf.implements).toContain('Mid')
      expect(Object.keys(leaf.properties).length).toBe(1)
      expect(leaf.properties['c']).toBeDefined()
    })

    it('node extends + implements combined', () => {
      const I = interfaceDef({ props: { tag: z.string() } })
      const Base = classDef({ props: { name: z.string() } })
      const Child = classDef({
        inherits: [Base, I],
        props: { extra: z.number() },
      })
      const schema = defineSchema('test', { I, Base, Child })
      const ir = serialize(schema)
      const child = findNode(ir, 'Child')
      expect(child.implements).toContain('Base')
      expect(child.implements).toContain('I')
      expect(Object.keys(child.properties).length).toBe(1) // own only
    })

    it('extended node inherits methods conceptually but only emits own', () => {
      const Base = classDef({
        methods: { greet: fn({ returns: z.string() }) },
      })
      const Child = classDef({
        inherits: [Base],
        methods: { farewell: fn({ returns: z.string() }) },
      })
      const schema = defineSchema('test', { Base, Child })
      const ir = serialize(schema)
      const child = findNode(ir, 'Child')
      expect(Object.keys(child.methods).length).toBe(1)
      expect(child.methods['farewell']).toBeDefined()
    })
  })

  // ── Interface extends chains ──────────────────────────────────────────

  describe('interface extends chains', () => {
    it('serializes multi-level iface extends', () => {
      const L0 = interfaceDef({ props: { a: z.string() } })
      const L1 = interfaceDef({ extends: [L0], props: { b: z.number() } })
      const L2 = interfaceDef({ extends: [L1], props: { c: z.boolean() } })
      const schema = defineSchema('test', { L0, L1, L2 })
      const ir = serialize(schema)

      const l2 = findIface(ir, 'L2')
      expect(l2.type).toBe('interface')
      expect(l2.extends).toEqual(['L1'])
      expect(Object.keys(l2.properties).length).toBe(1) // own only
      expect(l2.properties['c']).toBeDefined()
    })

    it('serializes diamond iface extends', () => {
      const Base = interfaceDef({ props: { id: z.string() } })
      const Left = interfaceDef({ extends: [Base], props: { l: z.number() } })
      const Right = interfaceDef({ extends: [Base], props: { r: z.number() } })
      const Diamond = interfaceDef({ extends: [Left, Right], props: { d: z.boolean() } })
      const schema = defineSchema('test', { Base, Left, Right, Diamond })
      const ir = serialize(schema)

      const d = findIface(ir, 'Diamond')
      expect(d.extends).toEqual(['Left', 'Right'])
      expect(Object.keys(d.properties).length).toBe(1)
    })

    it('node implementing deep iface chain', () => {
      const L0 = interfaceDef({ props: { ts: z.string() } })
      const L1 = interfaceDef({ extends: [L0], props: { v: z.number().int() } })
      const L2 = interfaceDef({ extends: [L1], props: { status: z.string() } })
      const A = classDef({ inherits: [L2], props: { name: z.string() } })
      const schema = defineSchema('test', { L0, L1, L2, A })
      const ir = serialize(schema)

      const a = findNode(ir, 'A')
      expect(a.implements).toEqual(['L2'])
      expect(Object.keys(a.properties).length).toBe(1)
      expect(a.properties['name']).toBeDefined()
    })
  })

  // ── Edge methods (comprehensive) ──────────────────────────────────────

  describe('edge methods (comprehensive)', () => {
    it('serializes edge with method and params', () => {
      const A = classDef({})
      const e1 = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [A] },
        ],
        props: { weight: z.number() },
        methods: {
          adjustWeight: fn({
            params: { delta: z.number() },
            returns: z.boolean(),
          }),
        },
      } as any)
      const schema = defineSchema('test', { A, e1 })
      const ir = serialize(schema)
      const e = findEdge(ir, 'e1')
      expect(Object.keys(e.properties).length).toBe(1)
      expect(Object.keys(e.methods).length).toBe(1)
      expect(e.methods['adjustWeight']).toBeDefined()
      expect(Object.keys(e.methods['adjustWeight'].params).length).toBe(1)
      expect(e.methods['adjustWeight'].params['delta']).toBeDefined()
    })

    it('serializes edge with multiple methods', () => {
      const A = classDef({})
      const e1 = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [A] },
        ],
        methods: {
          alpha: fn({ returns: z.string() }),
          beta: fn({ returns: z.number() }),
        },
      } as any)
      const schema = defineSchema('test', { A, e1 })
      const ir = serialize(schema)
      const e = findEdge(ir, 'e1')
      expect(Object.keys(e.methods).length).toBe(2)
      expect(Object.keys(e.methods)).toEqual(['alpha', 'beta'])
    })

    it('serializes edge with method that has no params', () => {
      const A = classDef({})
      const e1 = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [A] },
        ],
        methods: {
          internal: fn({ returns: z.boolean() }),
        },
      } as any)
      const schema = defineSchema('test', { A, e1 })
      const ir = serialize(schema)
      const e = findEdge(ir, 'e1')
      expect(e.methods['internal'].params).toEqual({})
    })

    it('serializes edge with props, methods, and constraints together', () => {
      const A = classDef({})
      const e1 = classDef({
        endpoints: [
          { as: 'a', types: [A] },
          { as: 'b', types: [A] },
        ],
        constraints: { unique: true, noSelf: true },
        props: { score: z.number().default(0) },
        methods: {
          normalize: fn({ returns: z.number() }),
        },
      } as any)
      const schema = defineSchema('test', { A, e1 })
      const ir = serialize(schema)
      const e = findEdge(ir, 'e1')
      expect(Object.keys(e.properties).length).toBe(1)
      expect(e.properties['score'].default).toBe(0)
      expect(Object.keys(e.methods).length).toBe(1)
      expect(e.constraints).toEqual({ unique: true, noSelf: true })
    })
  })

  // ── Method thunks ─────────────────────────────────────────────────────

  describe('method thunks', () => {
    it('resolves thunk params for method on node', () => {
      const A: any = classDef(() => ({
        methods: {
          link: fn({
            params: () => ({ target: ref(A) }),
            returns: z.boolean(),
          }),
        },
      }))
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const m = findMethod(findNode(ir, 'A'), 'link')!
      expect(m.params['target']).toEqual({ $nodeRef: 'A' })
    })

    it('resolves thunk for circular ref between two nodes', () => {
      const A: any = classDef(() => ({
        methods: {
          getB: fn({
            params: () => ({ b: ref(B) }),
            returns: z.boolean(),
          }),
        },
      }))
      const B = classDef({
        methods: {
          getA: fn({ returns: ref(A) }),
        },
      })
      const schema = defineSchema('test', { A, B })
      const ir = serialize(schema)
      const mA = findMethod(findNode(ir, 'A'), 'getB')!
      expect(mA.params['b']).toEqual({ $nodeRef: 'B' })
      const mB = findMethod(findNode(ir, 'B'), 'getA')!
      expect(mB.returns).toEqual({ $nodeRef: 'A' })
    })
  })

  // ── Complex property scenarios ─────────────────────────────────────

  describe('complex property scenarios', () => {
    it('serializes enum with default', () => {
      const A = classDef({
        props: { status: z.enum(['a', 'b', 'c']).default('b') },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'status')
      expect(p.enum).toEqual(['a', 'b', 'c'])
      expect(p.default).toBe('b')
    })

    it('serializes url string format', () => {
      const A = classDef({ props: { website: z.string().url() } })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'website')
      expect(p.type).toBe('string')
      expect(p.format).toBe('uri')
    })

    it('serializes nullable with default null', () => {
      const A = classDef({
        props: { deletedAt: z.string().nullable().default(null) },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'deletedAt')
      expect(p.type).toEqual(['string', 'null'])
      expect(p.default).toBe(null)
    })

    it('serializes string default without nullable', () => {
      const A = classDef({
        props: { role: z.string().default('user') },
      })
      const schema = defineSchema('test', { A })
      const ir = serialize(schema)
      const p = prop(findNode(ir, 'A'), 'role')
      expect(p.type).toBe('string')
      expect(p.default).toBe('user')
    })
  })

  // ── Full integration (e-commerce style) ──────────────────────────────

  describe('full e-commerce integration', () => {
    it('serializes e-commerce schema with data declarations', () => {
      const Currency = z.enum(['USD', 'EUR', 'GBP'])
      const OrderStatus = z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'])

      const Timestamped = interfaceDef({
        props: { createdAt: z.string().optional() },
      })

      const Priceable = interfaceDef({
        props: { priceCents: z.number().int(), currency: Currency.default('USD') },
      })

      const Order = classDef({
        inherits: [Timestamped],
        props: {
          status: OrderStatus.default('pending'),
          totalCents: z.number().int(),
        },
        methods: {
          cancel: fn({ returns: z.boolean() }),
        },
      })

      const Product = classDef({
        inherits: [Timestamped, Priceable],
        props: {
          title: z.string(),
          sku: z.string().min(3).max(20),
          inStock: z.boolean().default(true),
        },
        data: {
          description: z.string(),
          images: z.array(z.string().url()),
          specs: z.record(z.string(), z.string()).optional(),
        },
        methods: {
          content: fn({ returns: data() }),
        },
      })

      const Customer = classDef({
        inherits: [Timestamped],
        props: { email: z.string().email(), name: z.string() },
        methods: {
          recentOrders: fn({
            params: { limit: z.number().int().default(10) },
            returns: z.array(ref(Order)),
          }),
        },
      })

      const orderItem = classDef({
        endpoints: [
          { as: 'order', types: [Order] },
          { as: 'product', types: [Product] },
        ],
        props: { quantity: z.number().int().default(1), unitPriceCents: z.number().int() },
        methods: { subtotal: fn({ returns: z.number().int() }) },
      })

      const schema = defineSchema('test', {
        Timestamped,
        Priceable,
        Product,
        Customer,
        Order,
        orderItem,
      })

      const ir = serialize(schema, { types: { Currency, OrderStatus } })

      // Types
      expect(ir.types.Currency.enum).toEqual(['USD', 'EUR', 'GBP'])
      expect(ir.types.OrderStatus.enum).toEqual([
        'pending',
        'confirmed',
        'shipped',
        'delivered',
        'cancelled',
      ])

      // Product with data
      const product = findNode(ir, 'Product')
      expect(product.data).toBeDefined()
      expect(product.data!.type).toBe('object')
      const dataProps = product.data!.properties as Record<string, any>
      expect(dataProps.description.type).toBe('string')
      expect(dataProps.images.type).toBe('array')
      // content method returns $dataRef self
      const contentMethod = findMethod(product, 'content')!
      expect(contentMethod.returns).toEqual({ $dataRef: 'self' })

      // Product properties
      expect(Object.keys(product.properties)).toEqual(['title', 'sku', 'inStock'])
      expect(product.properties['sku'].minLength).toBe(3)
      expect(product.properties['sku'].maxLength).toBe(20)

      // Order
      const order = findNode(ir, 'Order')
      expect(Object.keys(order.methods).length).toBe(1)

      // Edge with props and methods
      const oi = findEdge(ir, 'orderItem')
      expect(Object.keys(oi.properties).length).toBe(2)
      expect(Object.keys(oi.methods).length).toBe(1)
      expect(oi.methods['subtotal']).toBeDefined()

      // Customer method with params
      const customer = findNode(ir, 'Customer')
      const recentOrders = findMethod(customer, 'recentOrders')!
      expect(recentOrders.params['limit'].default).toBe(10)
      expect(recentOrders.returns).toEqual({ type: 'array', items: { $nodeRef: 'Order' } })

      // JSON round-trip
      const json = JSON.stringify(ir)
      const parsed = JSON.parse(json)
      expect(parsed.version).toBe('1.0')
      expect(Object.keys(parsed.classes).length).toBe(Object.keys(ir.classes).length)
    })
  })

  // ── Error cases ──────────────────────────────────────────────────────

  describe('errors', () => {
    it('throws when a ref target is not in the schema', () => {
      const Missing = classDef({})
      const A = classDef({
        methods: {
          get: fn({ returns: ref(Missing) }),
        },
      })
      // Missing is not in defineSchema, so defineSchema should catch it
      expect(() => defineSchema('test', { A })).toThrow()
    })
  })

  // ── collectPrivateProps ────────────────────────────────────────────

  describe('collectPrivateProps', () => {
    it('child can un-private an inherited private prop', () => {
      const Parent = interfaceDef({
        props: {
          secret: propDef(z.string(), { private: true }),
          name: z.string(),
        },
      })
      const Child = classDef({
        inherits: [Parent],
        props: {
          secret: z.string(), // re-declared as public
        },
      })

      expect(collectPrivateProps(Parent)).toEqual(new Set(['secret']))
      expect(collectPrivateProps(Child)).toEqual(new Set()) // un-privated
    })
  })
})
