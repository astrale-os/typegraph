import { describe, it, expect } from 'vitest'

import type { SchemaIR, MethodDef } from '../src/model.js'

import { generate } from '../src/generate.js'
import { load } from '../src/loader.js'
import { compileAndGenerate, compileToModel } from './helpers.js'

// ─── Hand-crafted IR with methods ────────────────────────────
// Synthetic IR for isolated codegen testing (no compiler dependency).

function makeIR(overrides?: Partial<SchemaIR>): SchemaIR {
  return {
    version: '1.0',
    meta: { generated_at: '', source_hash: '' },
    extensions: [],
    builtin_scalars: ['String', 'Int', 'Float', 'Boolean', 'Timestamp'],
    type_aliases: [],
    classes: [],
    ...overrides,
  }
}

const ageMethods: MethodDef[] = [
  {
    name: 'age',
    access: 'public',
    params: [],
    return_type: { kind: 'Scalar', name: 'Int' },
    return_nullable: false,
  },
]

const customerMethods: MethodDef[] = [
  {
    name: 'displayName',
    access: 'public',
    params: [],
    return_type: { kind: 'Scalar', name: 'String' },
    return_nullable: false,
  },
  {
    name: 'canPurchase',
    access: 'public',
    params: [{ name: 'product', type: { kind: 'Node', name: 'Product' }, default: null }],
    return_type: { kind: 'Scalar', name: 'Boolean' },
    return_nullable: false,
  },
  {
    name: 'recentOrders',
    access: 'private',
    params: [
      {
        name: 'limit',
        type: { kind: 'Scalar', name: 'Int' },
        default: { kind: 'NumberLiteral', value: 10 } as any,
      },
    ],
    return_type: { kind: 'List', element: { kind: 'Node', name: 'Order' } } as any,
    return_nullable: false,
  },
]

const orderMethods: MethodDef[] = [
  {
    name: 'cancel',
    access: 'private',
    params: [],
    return_type: { kind: 'Scalar', name: 'Boolean' },
    return_nullable: false,
  },
]

const edgeMethods: MethodDef[] = [
  {
    name: 'subtotal',
    access: 'private',
    params: [],
    return_type: { kind: 'Scalar', name: 'Int' },
    return_nullable: false,
  },
]

function buildTestIR(): SchemaIR {
  return makeIR({
    classes: [
      {
        type: 'node',
        name: 'Timestamped',
        abstract: true,
        implements: [],
        attributes: [
          {
            name: 'created_at',
            type: { kind: 'Scalar', name: 'Timestamp' },
            nullable: false,
            default: null,
            modifiers: {},
          },
        ],
        methods: ageMethods,
      } as any,
      {
        type: 'node',
        name: 'Customer',
        abstract: false,
        implements: ['Timestamped'],
        attributes: [
          {
            name: 'email',
            type: { kind: 'Scalar', name: 'String' },
            nullable: false,
            default: null,
            modifiers: {},
          },
          {
            name: 'name',
            type: { kind: 'Scalar', name: 'String' },
            nullable: false,
            default: null,
            modifiers: {},
          },
        ],
        methods: customerMethods,
      } as any,
      {
        type: 'node',
        name: 'Product',
        abstract: false,
        implements: ['Timestamped'],
        attributes: [
          {
            name: 'title',
            type: { kind: 'Scalar', name: 'String' },
            nullable: false,
            default: null,
            modifiers: {},
          },
          {
            name: 'price_cents',
            type: { kind: 'Scalar', name: 'Int' },
            nullable: false,
            default: null,
            modifiers: {},
          },
        ],
        methods: [],
      } as any,
      {
        type: 'node',
        name: 'Order',
        abstract: false,
        implements: ['Timestamped'],
        attributes: [
          {
            name: 'status',
            type: { kind: 'Scalar', name: 'String' },
            nullable: false,
            default: null,
            modifiers: {},
          },
          {
            name: 'total_cents',
            type: { kind: 'Scalar', name: 'Int' },
            nullable: false,
            default: null,
            modifiers: {},
          },
        ],
        methods: orderMethods,
      } as any,
      {
        type: 'edge',
        name: 'order_item',
        endpoints: [
          {
            param_name: 'order',
            allowed_types: [{ kind: 'Node', name: 'Order' }],
            cardinality: null,
          },
          {
            param_name: 'product',
            allowed_types: [{ kind: 'Node', name: 'Product' }],
            cardinality: null,
          },
        ],
        attributes: [
          {
            name: 'quantity',
            type: { kind: 'Scalar', name: 'Int' },
            nullable: false,
            default: null,
            modifiers: {},
          },
          {
            name: 'unit_price_cents',
            type: { kind: 'Scalar', name: 'Int' },
            nullable: false,
            default: null,
            modifiers: {},
          },
        ],
        constraints: { no_self: false, acyclic: false, unique: false, symmetric: false },
        methods: edgeMethods,
      } as any,
      {
        type: 'edge',
        name: 'placed_order',
        endpoints: [
          {
            param_name: 'customer',
            allowed_types: [{ kind: 'Node', name: 'Customer' }],
            cardinality: null,
          },
          {
            param_name: 'order',
            allowed_types: [{ kind: 'Node', name: 'Order' }],
            cardinality: null,
          },
        ],
        attributes: [],
        constraints: { no_self: false, acyclic: false, unique: true, symmetric: false },
        methods: [],
      } as any,
    ],
  })
}

describe('method codegen', () => {
  const ir = buildTestIR()

  it('loads methods into GraphModel', () => {
    const model = load([ir])
    const customer = model.nodeDefs.get('Customer')!
    expect(customer.ownMethods).toHaveLength(3)
    expect(customer.ownMethods.map((m) => m.name)).toEqual([
      'displayName',
      'canPurchase',
      'recentOrders',
    ])
  })

  it('resolves inherited methods', () => {
    const model = load([ir])
    const customer = model.nodeDefs.get('Customer')!
    // allMethods: inherited 'age' from Timestamped + 3 own
    expect(customer.allMethods).toHaveLength(4)
    expect(customer.allMethods.map((m) => m.name)).toContain('age')
    expect(customer.allMethods.map((m) => m.name)).toContain('displayName')
  })

  it('resolves edge methods (no inheritance)', () => {
    const model = load([ir])
    const orderItem = model.edgeDefs.get('order_item')!
    expect(orderItem.ownMethods).toHaveLength(1)
    expect(orderItem.allMethods).toHaveLength(1)
    expect(orderItem.allMethods[0].name).toBe('subtotal')
  })

  it('generates method interfaces', () => {
    const { source } = generate([ir])
    expect(source).toContain('export interface TimestampedMethods {')
    expect(source).toContain('  age(): number | Promise<number>')
    expect(source).toContain('export interface CustomerMethods {')
    expect(source).toContain('  displayName(): string | Promise<string>')
    expect(source).toContain('export interface OrderItemMethods {')
    expect(source).toContain('  subtotal(): number | Promise<number>')
  })

  it('generates correct param signatures', () => {
    const { source } = generate([ir])
    // canPurchase has required param
    expect(source).toContain(
      'canPurchase(args: { product: ProductId }): boolean | Promise<boolean>',
    )
    // recentOrders has param with default → optional
    expect(source).toContain('recentOrders(args?: { limit?: number }): Order[] | Promise<Order[]>')
  })

  it('does not emit legacy MethodContext/MethodsConfig types', () => {
    const { source } = generate([ir])
    expect(source).not.toContain('MethodContext')
    expect(source).not.toContain('EdgeMethodContext')
    expect(source).not.toContain('MethodsConfig')
  })

  it('generates enriched node types', () => {
    const { source } = generate([ir])
    expect(source).toContain('export type CustomerNode = Customer & {')
    expect(source).toContain("readonly __type: 'Customer'")
    expect(source).toContain('} & CustomerMethods & TimestampedMethods')

    // Product has no own methods but inherits from Timestamped
    expect(source).toContain('export type ProductNode = Product & {')
    expect(source).toContain('} & TimestampedMethods')
  })

  it('generates SchemaNodeTypeMap', () => {
    const { source } = generate([ir])
    expect(source).toContain('export interface SchemaNodeTypeMap {')
    expect(source).toContain('Customer: CustomerNode')
    expect(source).toContain('Product: ProductNode')
    expect(source).toContain('Order: OrderNode')
  })

  it('generates schema.methods metadata', () => {
    const { source } = generate([ir])
    expect(source).toContain('methods: {')
    expect(source).toContain("age: { params: {}, returns: 'Int' },")
    expect(source).toContain("displayName: { params: {}, returns: 'String' },")
    expect(source).toContain(
      "canPurchase: { params: { product: { type: 'Product' } }, returns: 'Boolean' },",
    )
    expect(source).toContain(
      "recentOrders: { params: { limit: { type: 'Int', default: 10 } }, returns: 'Order[]' },",
    )
    expect(source).toContain("subtotal: { params: {}, returns: 'Int' },")
  })

  it('types with no own methods get no *Methods interface', () => {
    const { source } = generate([ir])
    expect(source).not.toContain('interface ProductMethods')
    expect(source).not.toContain('interface PlacedOrderMethods')
  })

  it('edges without methods not in MethodsConfig', () => {
    const { source } = generate([ir])
    // placed_order has no methods — should not appear in MethodsConfig
    expect(source).not.toMatch(/placed_order:.*ctx:/)
  })

  it('result schema for Node return type uses validators (not z.string())', () => {
    const { source } = generate([ir])
    expect(source).toContain('z.array(validators.Order)')
    expect(source).not.toContain(
      "recentOrders: op('Customer.recentOrders', 'private', z.object({ limit: z.number().int().default(10) }), z.array(z.string()))",
    )
  })

  it('param schema for Node param type stays as z.string()', () => {
    const { source } = generate([ir])
    expect(source).toContain(
      "canPurchase: op('Customer.canPurchase', 'public', z.object({ product: z.string() })",
    )
  })

  it('scaffold uses per-type define functions', () => {
    const { scaffold } = generate([ir])
    expect(scaffold).not.toContain('@astrale-os/kernel-runtime')
    expect(scaffold).toContain("from './schema.generated'")
    expect(scaffold).toContain('defineCustomerMethods(CustomerOps, {')
    expect(scaffold).toContain('defineOrderMethods(OrderOps, {')
    expect(scaffold).toContain('defineOrderItemMethods(OrderItemOps, {')
  })

  it('scaffold imports per-type define functions and ops in single import', () => {
    const { scaffold } = generate([ir])
    expect(scaffold).toMatch(/^import \{ define.*Methods, .*Ops.* \} from '\.\/schema\.generated'/m)
    expect(scaffold).not.toContain("from '@astrale-os/kernel-runtime'")
  })

  it('snapshot — methods codegen', () => {
    const { source } = generate([ir])
    expect(source).toMatchSnapshot()
  })
})

describe('method codegen — edge cases', () => {
  it('IR with no methods produces no method interfaces', () => {
    const ir = makeIR({
      classes: [
        {
          type: 'node',
          name: 'Simple',
          abstract: false,
          implements: [],
          attributes: [
            {
              name: 'name',
              type: { kind: 'Scalar', name: 'String' },
              nullable: false,
              default: null,
              modifiers: {},
            },
          ],
        } as any,
      ],
    })
    const { source } = generate([ir])
    expect(source).not.toContain('SimpleMethods')
  })

  it('IR with no methods does not emit method-related code', () => {
    const ir = makeIR({
      classes: [
        {
          type: 'node',
          name: 'Simple',
          abstract: false,
          implements: [],
          attributes: [
            {
              name: 'name',
              type: { kind: 'Scalar', name: 'String' },
              nullable: false,
              default: null,
              modifiers: {},
            },
          ],
        } as any,
      ],
    })
    const { source } = generate([ir])
    expect(source).not.toContain('defineMethods')
  })

  it('nullable return type', () => {
    const ir = makeIR({
      classes: [
        {
          type: 'node',
          name: 'Foo',
          abstract: false,
          implements: [],
          attributes: [],
          methods: [
            {
              name: 'findParent',
              access: 'public',
              params: [],
              return_type: { kind: 'Node', name: 'Foo' },
              return_nullable: true,
            },
          ],
        } as any,
      ],
    })
    const { source } = generate([ir])
    expect(source).toContain('findParent(): Foo | null | Promise<Foo | null>')
  })

  it('diamond inheritance deduplicates methods', () => {
    const ir = makeIR({
      classes: [
        {
          type: 'node',
          name: 'A',
          abstract: true,
          implements: [],
          attributes: [],
          methods: [
            {
              name: 'x',
              access: 'public',
              params: [],
              return_type: { kind: 'Scalar', name: 'Int' },
              return_nullable: false,
            },
          ],
        } as any,
        {
          type: 'node',
          name: 'B',
          abstract: true,
          implements: ['A'],
          attributes: [],
          methods: [],
        } as any,
        {
          type: 'node',
          name: 'C',
          abstract: true,
          implements: ['A'],
          attributes: [],
          methods: [],
        } as any,
        {
          type: 'node',
          name: 'D',
          abstract: false,
          implements: ['B', 'C'],
          attributes: [],
          methods: [],
        } as any,
      ],
    })
    const model = load([ir])
    const d = model.nodeDefs.get('D')!
    // 'x' inherited from A via B and C — should appear once
    expect(d.allMethods).toHaveLength(1)
    expect(d.allMethods[0].name).toBe('x')
  })
})

// ─── Integration: KRL → Compiler → Codegen ──────────────────

describe('method codegen — KRL integration', () => {
  it('compiles KRL with methods and generates correct output', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Identity }

      interface Timestamped {
        created_at: Timestamp,
        fn age(): Int
      }

      class Customer: Identity, Timestamped {
        email: String,
        fn displayName(): String
      }
    `)
    expect(source).toContain('export interface TimestampedMethods {')
    expect(source).toContain('  age(): number | Promise<number>')
    expect(source).toContain('export interface CustomerMethods {')
    expect(source).toContain('  displayName(): string | Promise<string>')
  })

  it('model has inherited methods from KRL', () => {
    const model = compileToModel(`
      extend "https://kernel.astrale.ai/v1" { Identity }

      interface Timestamped {
        created_at: Timestamp,
        fn age(): Int
      }

      class Customer: Identity, Timestamped {
        email: String,
        fn displayName(): String
      }
    `)
    const customer = model.nodeDefs.get('Customer')!
    expect(customer.ownMethods).toHaveLength(1)
    expect(customer.ownMethods[0].name).toBe('displayName')
    expect(customer.allMethods.map((m) => m.name)).toContain('age')
    expect(customer.allMethods.map((m) => m.name)).toContain('displayName')
  })

  it('generates method param signatures from KRL', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Identity }
      class Product: Identity {}
      class Customer: Identity {
        fn canPurchase(product: Product): Boolean
      }
    `)
    expect(source).toContain(
      'canPurchase(args: { product: ProductId }): boolean | Promise<boolean>',
    )
  })

  it('generates method with default params from KRL', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Identity }
      class Listing: Identity {
        fn search(limit: Int = 10): String
      }
    `)
    expect(source).toContain('search(args?: { limit?: number }): string | Promise<string>')
  })

  it('generates list return type from KRL', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Identity }
      class Order: Identity {}
      class Customer: Identity {
        fn orders(): Order[]
      }
    `)
    expect(source).toContain('orders(): Order[] | Promise<Order[]>')
  })

  it('generates nullable return type from KRL', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Identity }
      class Customer: Identity {
        fn nickname(): String?
      }
    `)
    expect(source).toContain('nickname(): string | null | Promise<string | null>')
  })

  it('generates edge methods from KRL', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Identity }
      class User: Identity {}
      class Org: Identity {}
      class membership(user: User, org: Org) {
        role: String,
        fn promote(): Boolean
      }
    `)
    expect(source).toContain('export interface MembershipMethods {')
    expect(source).toContain('  promote(): boolean | Promise<boolean>')
    expect(source).not.toContain('EdgeMethodContext')
  })

  it('types without methods produce no method interface', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Identity }
      class Simple: Identity {
        name: String
      }
    `)
    expect(source).not.toContain('SimpleMethods')
  })

  it('does not emit legacy MethodsConfig from KRL', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Identity }
      interface Greetable {
        fn greet(): String
      }
      class User: Identity, Greetable {
        fn status(): String
      }
    `)
    expect(source).not.toContain('MethodsConfig')
    expect(source).not.toContain('MethodContext')
    // But method interfaces should still be there
    expect(source).toContain('export interface GreetableMethods {')
    expect(source).toContain('export interface UserMethods {')
  })
})
