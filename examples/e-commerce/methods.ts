import {
  defineCustomerMethods,
  defineOrderMethods,
  defineOrderItemMethods,
  CustomerOps,
  OrderOps,
  OrderItemOps,
} from './schema.generated'

export const CustomerMethods = defineCustomerMethods(CustomerOps, {
  displayName: {
    // authorize: ({ self }) => ({ nodeIds: [self.id], perm: READ }),
    authorize: () => undefined,
    execute: async ({ self }) => `${self.name} <${self.email}>`,
  },
  recentOrders: {
    // authorize: ({ self }) => ({ nodeIds: [self.id], perm: READ }),
    authorize: () => undefined,
    execute: async ({ self, params, kernel, auth }) => {
      const orders = await kernel.graph
        .as(auth)
        .node('Customer')
        .byId(self.id)
        .to('placedOrder')
        .orderBy('createdAt', 'DESC')
        .limit(params?.limit ?? 10)
        .execute()
      return orders
    },
  },
})

export const OrderMethods = defineOrderMethods(OrderOps, {
  cancel: {
    // authorize: ({ self }) => ({ nodeIds: [self.id], perm: EDIT }),
    authorize: () => undefined,
    execute: async ({ self, kernel, auth }) => {
      if (self.status === 'cancelled') return false
      if (self.status === 'shipped' || self.status === 'delivered') return false

      await kernel.graph.as(auth).mutate.update('Order', self.id, { status: 'cancelled' })
      return true
    },
  },
})

export const OrderItemMethods = defineOrderItemMethods(OrderItemOps, {
  subtotal: {
    // authorize: ({ self }) => ({ nodeIds: [self.id], perm: READ }),
    authorize: () => undefined,
    execute: async ({ self }) => self.quantity * self.unitPriceCents,
  },
})
