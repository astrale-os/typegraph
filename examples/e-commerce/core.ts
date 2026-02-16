// Genesis data — the initial graph state seeded at boot time.
// Uses the generated Core DSL (defineCore, node, edge).

import { defineCore, node, edge } from './schema.generated'

export const core = defineCore({
  nodes: {
    // ─── Customers ─────────────────────────────────────────
    admin: node('Customer', {
      email: 'admin@store.com',
      name: 'Store Admin',
    }),

    // ─── Categories (nested via children) ──────────────────
    electronics: node(
      'Category',
      { name: 'Electronics', slug: 'electronics' },
      {
        children: {
          phones: node('Category', { name: 'Phones', slug: 'phones' }),
          laptops: node('Category', { name: 'Laptops', slug: 'laptops' }),
        },
      },
    ),

    clothing: node('Category', { name: 'Clothing', slug: 'clothing' }),

    // ─── Products ──────────────────────────────────────────
    iphone: node('Product', {
      title: 'iPhone 17',
      sku: 'IPH-17',
      priceCents: 99900,
      slug: 'iphone-17',
    }),

    macbook: node('Product', {
      title: 'MacBook Air',
      sku: 'MBA-M4',
      priceCents: 129900,
      slug: 'macbook-air',
    }),
  },

  edges: [
    // Products → Categories
    edge('inCategory', { product: 'iphone', category: 'phones' }),
    edge('inCategory', { product: 'macbook', category: 'laptops' }),

    // Category hierarchy (phones, laptops are children of electronics)
    edge('parentCategory', { child: 'phones', parent: 'electronics' }),
    edge('parentCategory', { child: 'laptops', parent: 'electronics' }),
  ],
})
