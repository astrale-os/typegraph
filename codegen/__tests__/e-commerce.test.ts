import { describe, it, expect } from 'vitest'
import { compileAndGenerate, extractValidatorBlock, extractSchemaEdgeBlock } from './helpers.js'

const ECOMMERCE = `
  extend "https://kernel.astrale.ai/v1" { Identity }

  type Currency = String [in: ["USD", "EUR", "GBP", "JPY"]]
  type OrderStatus = String [in: ["pending", "confirmed", "shipped", "delivered", "cancelled"]]
  type SKU = String [length: 3..20]
  type Email = String [format: email]
  type Url = String [format: url]

  interface Timestamped {
    created_at: Timestamp = now(),
    updated_at: Timestamp?
  }

  interface HasSlug {
    slug: String [unique]
  }

  interface Priceable {
    price_cents: Int,
    currency: Currency = "USD"
  }

  class Customer: Identity, Timestamped {
    email: Email [unique],
    name: String,
    phone: String?
  }

  class Product: Timestamped, HasSlug, Priceable {
    title: String,
    description: String?,
    sku: SKU [unique],
    in_stock: Boolean = true,
    image_url: Url?
  }

  class Category: HasSlug {
    name: String [unique]
  }

  class Order: Timestamped {
    status: OrderStatus = "pending",
    total_cents: Int,
    notes: String?
  }

  class Review: Timestamped {
    rating: Int,
    body: String?
  }

  class placed_order(customer: Customer, order: Order) [order -> 1, unique]

  class order_item(order: Order, product: Product) [] {
    quantity: Int = 1,
    unit_price_cents: Int
  }

  class in_category(product: Product, category: Category) []

  class parent_category(child: Category, parent: Category) [
    no_self,
    acyclic,
    child -> 0..1
  ]

  class reviewed(reviewer: Customer, product: Product) [unique] {
    rating: Int,
    body: String?,
    verified: Boolean = false
  }

  class wishlisted(customer: Customer, product: Product) [unique]
`

describe('complex schema — e-commerce', () => {
  it('compiles and generates without errors', () => {
    const { source, model } = compileAndGenerate(ECOMMERCE)
    expect(source).toBeTruthy()
    expect(model.nodeDefs.size).toBeGreaterThan(0)
    expect(model.edgeDefs.size).toBeGreaterThan(0)
  })

  it('resolves triple inheritance — Product gets Timestamped + HasSlug + Priceable', () => {
    const { model } = compileAndGenerate(ECOMMERCE)
    const product = model.nodeDefs.get('Product')!
    const names = product.allAttributes.map((a) => a.name)
    expect(names).toContain('created_at')
    expect(names).toContain('slug')
    expect(names).toContain('price_cents')
    expect(names).toContain('title')
    expect(names).toContain('sku')
  })

  it('generates all 5 concrete node types', () => {
    const { source } = compileAndGenerate(ECOMMERCE)
    for (const name of ['Customer', 'Product', 'Category', 'Order', 'Review']) {
      expect(source).toContain(`export interface ${name}`)
    }
  })

  it('generates correct SchemaNodeType for e-commerce', () => {
    const { source } = compileAndGenerate(ECOMMERCE)
    for (const name of ['Customer', 'Product', 'Category', 'Order', 'Review']) {
      expect(source).toContain(`'${name}'`)
    }
  })

  it('generates all 6 edge types', () => {
    const { source } = compileAndGenerate(ECOMMERCE)
    for (const name of [
      'placed_order',
      'order_item',
      'in_category',
      'parent_category',
      'reviewed',
      'wishlisted',
    ]) {
      expect(source).toMatch(new RegExp(`'${name}'`))
    }
  })

  it('generates edge payload for order_item and reviewed', () => {
    const { source } = compileAndGenerate(ECOMMERCE)
    expect(source).toContain('export interface OrderItemPayload {')
    expect(source).toContain('export interface ReviewedPayload {')
    expect(source).not.toContain('WishlistedPayload')
  })

  it('generates CoreEdgeEndpoints for self-referencing edge', () => {
    const { source } = compileAndGenerate(ECOMMERCE)
    expect(source).toContain('parent_category: { child: string; parent: string }')
  })

  it('generates validators with inherited + own attributes for Product', () => {
    const { source } = compileAndGenerate(ECOMMERCE)
    const block = extractValidatorBlock(source, 'Product')
    expect(block).toContain('created_at:')
    expect(block).toContain('slug:')
    expect(block).toContain('price_cents:')
    expect(block).toContain('currency:')
    expect(block).toContain('title:')
    expect(block).toContain('sku:')
    expect(block).toContain('in_stock:')
  })

  it('acyclic + no_self constraints on parent_category', () => {
    const { source } = compileAndGenerate(ECOMMERCE)
    const edgeBlock = extractSchemaEdgeBlock(source, 'parent_category')
    expect(edgeBlock).toContain('no_self: true')
    expect(edgeBlock).toContain('acyclic: true')
  })

  it('snapshot — e-commerce schema', () => {
    const { source } = compileAndGenerate(ECOMMERCE)
    expect(source).toMatchSnapshot()
  })
})
