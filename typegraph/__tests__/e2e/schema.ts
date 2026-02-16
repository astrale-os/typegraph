/**
 * E2E Test Schema
 *
 * Realistic domain model representing an e-commerce platform.
 * This is the SchemaShape that codegen would produce from the following KRL:
 *
 * ```krl
 * extend "https://kernel.astrale.ai/v1" { Identity }
 *
 * type Email = String [format: email]
 * type OrderStatus = String [in: ["pending", "confirmed", "shipped", "delivered"]]
 *
 * interface Timestamped {
 *   created_at: Timestamp [readonly] = now(),
 *   updated_at: Timestamp?
 * }
 *
 * class Customer: Identity, Timestamped {
 *   email: Email [unique],
 *   username: String [unique],
 *   tier: String
 * }
 *
 * class Product: Timestamped {
 *   name: String,
 *   price: Float,
 *   sku: String [unique],
 *   active: Boolean = true
 * }
 *
 * class Order: Timestamped {
 *   status: OrderStatus = "pending",
 *   total: Float
 * }
 *
 * class Review: Timestamped {
 *   rating: Int [>= 1, <= 5],
 *   body: String
 * }
 *
 * class Category {
 *   name: String,
 *   slug: String [unique]
 * }
 *
 * class Warehouse {
 *   name: String,
 *   location: String
 * }
 *
 * -- Edges
 *
 * class placed_order(customer: Customer, order: Order)
 *
 * class order_item(order: Order, product: Product) {
 *   quantity: Int,
 *   unit_price: Float
 * }
 *
 * class reviewed(customer: Customer, product: Product)
 *
 * class wrote_review(review: Review, customer: Customer) [
 *   review -> 1
 * ]
 *
 * class review_of(review: Review, product: Product) [
 *   review -> 1
 * ]
 *
 * class categorized_as(product: Product, category: Category)
 *
 * class category_parent(child: Category, parent: Category) [
 *   no_self,
 *   acyclic,
 *   child -> 0..1
 * ]
 *
 * class stocked_in(product: Product, warehouse: Warehouse) {
 *   quantity: Int
 * }
 *
 * class follows(follower: Customer, followed: Customer) [no_self, unique] {
 *   since: Timestamp
 * }
 * ```
 */

import type { SchemaShape } from '../../src/schema'

export const schema = {
  scalars: ['String', 'Int', 'Float', 'Boolean', 'Timestamp'],

  nodes: {
    Timestamped: {
      abstract: true,
      attributes: ['created_at', 'updated_at'],
    },
    Customer: {
      abstract: false,
      implements: ['Timestamped'],
      attributes: ['email', 'username', 'tier', 'created_at', 'updated_at'],
    },
    Product: {
      abstract: false,
      implements: ['Timestamped'],
      attributes: ['name', 'price', 'sku', 'active', 'created_at', 'updated_at'],
    },
    Order: {
      abstract: false,
      implements: ['Timestamped'],
      attributes: ['status', 'total', 'created_at', 'updated_at'],
    },
    Review: {
      abstract: false,
      implements: ['Timestamped'],
      attributes: ['rating', 'body', 'created_at', 'updated_at'],
    },
    Category: {
      abstract: false,
      attributes: ['name', 'slug'],
    },
    Warehouse: {
      abstract: false,
      attributes: ['name', 'location'],
    },
  },

  edges: {
    placed_order: {
      endpoints: {
        customer: { types: ['Customer'] },
        order: { types: ['Order'] },
      },
    },
    order_item: {
      endpoints: {
        order: { types: ['Order'] },
        product: { types: ['Product'] },
      },
      attributes: ['quantity', 'unit_price'],
    },
    reviewed: {
      endpoints: {
        customer: { types: ['Customer'] },
        product: { types: ['Product'] },
      },
    },
    wrote_review: {
      endpoints: {
        review: { types: ['Review'], cardinality: { min: 1, max: 1 } },
        customer: { types: ['Customer'] },
      },
    },
    review_of: {
      endpoints: {
        review: { types: ['Review'], cardinality: { min: 1, max: 1 } },
        product: { types: ['Product'] },
      },
    },
    categorized_as: {
      endpoints: {
        product: { types: ['Product'] },
        category: { types: ['Category'] },
      },
    },
    category_parent: {
      endpoints: {
        child: { types: ['Category'], cardinality: { min: 0, max: 1 } },
        parent: { types: ['Category'] },
      },
      constraints: {
        no_self: true,
        acyclic: true,
      },
    },
    stocked_in: {
      endpoints: {
        product: { types: ['Product'] },
        warehouse: { types: ['Warehouse'] },
      },
      attributes: ['quantity'],
    },
    follows: {
      endpoints: {
        follower: { types: ['Customer'] },
        followed: { types: ['Customer'] },
      },
      constraints: {
        no_self: true,
        unique: true,
      },
      attributes: ['since'],
    },
  },

  hierarchy: {
    defaultEdge: 'category_parent',
    direction: 'up' as const,
  },
} as const satisfies SchemaShape

export type EcommerceSchema = typeof schema
