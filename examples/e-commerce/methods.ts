// Method implementations — runtime logic for KRL method contracts.
// Each method receives a typed context (self, args, graph).

import type { MethodsConfig } from './schema.generated'

export const methods: MethodsConfig = {
  Customer: {
    displayName(ctx) {
      return `${ctx.self.name} <${ctx.self.email}>`
    },

    async recentOrders(ctx) {
      // Use the graph client to traverse from this customer to their orders.
      // The return type is Order[] — typed by the generated MethodsConfig.
      const orders = await ctx.graph
        .node('Customer')
        .byId(ctx.self.id)
        .to('placedOrder')
        .orderBy('createdAt', 'DESC')
        .limit(ctx.args?.limit ?? 10)
        .execute()
      return orders
    },
  },

  Order: {
    async cancel(ctx) {
      if (ctx.self.status === 'cancelled') return false
      if (ctx.self.status === 'shipped' || ctx.self.status === 'delivered') return false

      await ctx.graph.mutate.update('Order', ctx.self.id, { status: 'cancelled' })
      return true
    },
  },

  orderItem: {
    subtotal(ctx) {
      return ctx.self.quantity * ctx.self.unitPriceCents
    },
  },
}
