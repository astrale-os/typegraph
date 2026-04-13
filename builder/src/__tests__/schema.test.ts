import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import {
  nodeInterface,
  nodeClass,
  edgeInterface,
  fn,
  ref,
  SELF,
  defineSchema,
  SchemaValidationError,
} from '../index.js'

describe('defineSchema', () => {
  it('creates a schema with interfaces and classes groups', () => {
    const Trackable = nodeInterface({
      properties: { createdAt: z.string() },
    })

    const Article = nodeClass({
      inherits: [Trackable],
      properties: { title: z.string() },
    })

    const schema = defineSchema('blog.example', {
      interfaces: { Trackable },
      classes: { Article },
    })

    expect(schema.domain).toBe('blog.example')
    expect(schema.interfaces.Trackable).toBe(Trackable)
    expect(schema.classes.Article).toBe(Article)
  })

  it('resolves thunks during defineSchema', () => {
    const Node = nodeInterface(() => ({
      properties: { name: z.string() },
      methods: {
        getName: fn({ returns: z.string() }),
      },
    }))

    const schema = defineSchema('test.com', {
      interfaces: { Node },
      classes: {},
    })

    expect(schema.interfaces.Node.config.properties).toBeDefined()
  })

  it('resolves SELF references', () => {
    const Tree = nodeClass({
      methods: {
        getParent: fn({
          params: () => ({ self: ref(SELF) }),
          returns: z.string(),
        }),
      },
    })

    const schema = defineSchema('test.com', {
      interfaces: {},
      classes: { Tree },
    })

    expect(schema.classes.Tree).toBe(Tree)
  })

  it('builds functions map with qualified method refs', () => {
    const Iface = nodeInterface({
      methods: {
        greet: fn({ returns: z.string(), inheritance: 'abstract' }),
      },
    })

    const Impl = nodeClass({
      inherits: [Iface],
      methods: {
        greet: fn({ returns: z.string() }),
      },
    })

    const schema = defineSchema('test.com', {
      interfaces: { Iface },
      classes: { Impl },
    })

    expect(schema.functions).toHaveProperty('interface.Iface.greet')
    expect(schema.functions).toHaveProperty('class.Impl.greet')
  })

  it('supports imports', () => {
    const Base = nodeInterface({ properties: { id: z.string() } })
    const baseSchema = defineSchema('base.com', {
      interfaces: { Base },
      classes: {},
    })

    const Child = nodeClass({ inherits: [Base] })

    const schema = defineSchema('child.com', {
      interfaces: {},
      classes: { Child },
      imports: [baseSchema],
    })

    expect(schema.imports).toHaveLength(1)
  })
})

describe('schema validation', () => {
  it('rejects concrete def in interfaces group', () => {
    const Bad = nodeClass({})
    expect(() =>
      defineSchema('test', {
        interfaces: { Bad: Bad as any },
        classes: {},
      }),
    ).toThrow(SchemaValidationError)
  })

  it('rejects abstract def in classes group', () => {
    const Bad = nodeInterface({})
    expect(() =>
      defineSchema('test', {
        interfaces: {},
        classes: { Bad: Bad as any },
      }),
    ).toThrow(SchemaValidationError)
  })

  it('rejects inheriting from concrete types', () => {
    const Concrete = nodeClass({})
    const Bad = nodeClass({ inherits: [Concrete as any] })

    expect(() =>
      defineSchema('test', {
        interfaces: {},
        classes: { Concrete, Bad },
      }),
    ).toThrow(SchemaValidationError)
  })

  it('rejects cross-kind inheritance (node inherits edge)', () => {
    const EdgeIface = edgeInterface({ as: 'from', types: [] }, { as: 'to', types: [] })

    const Bad = nodeClass({ inherits: [EdgeIface as any] })

    expect(() =>
      defineSchema('test', {
        interfaces: { EdgeIface },
        classes: { Bad },
      }),
    ).toThrow(SchemaValidationError)
  })

  it('rejects sealed method override', () => {
    const Base = nodeInterface({
      methods: {
        locked: fn({ returns: z.string(), inheritance: 'sealed' }),
      },
    })

    const Child = nodeClass({
      inherits: [Base],
      methods: {
        locked: fn({ returns: z.string() }),
      },
    })

    expect(() =>
      defineSchema('test', {
        interfaces: { Base },
        classes: { Child },
      }),
    ).toThrow(SchemaValidationError)
  })

  it('rejects unimplemented abstract methods on concrete defs', () => {
    const Base = nodeInterface({
      methods: {
        mustImpl: fn({ returns: z.string(), inheritance: 'abstract' }),
      },
    })

    const Child = nodeClass({
      inherits: [Base],
      // Missing 'mustImpl' implementation
    })

    expect(() =>
      defineSchema('test', {
        interfaces: { Base },
        classes: { Child },
      }),
    ).toThrow(SchemaValidationError)
  })

  it('rejects inheritance modifier on concrete def methods', () => {
    const Bad = nodeClass({
      methods: {
        oops: fn({ returns: z.string(), inheritance: 'sealed' }),
      },
    })

    expect(() =>
      defineSchema('test', {
        interfaces: {},
        classes: { Bad },
      }),
    ).toThrow(SchemaValidationError)
  })

  it('validates indexes reference existing properties', () => {
    const Bad = nodeClass({
      properties: { name: z.string() },
      indexes: [{ property: 'nonexistent', type: 'btree' }],
    })

    expect(() =>
      defineSchema('test', {
        interfaces: {},
        classes: { Bad },
      }),
    ).toThrow(SchemaValidationError)
  })

  it('accepts valid indexes on own properties', () => {
    const Good = nodeClass({
      properties: { name: z.string() },
      indexes: ['name'],
    })

    expect(() =>
      defineSchema('test', {
        interfaces: {},
        classes: { Good },
      }),
    ).not.toThrow()
  })
})
