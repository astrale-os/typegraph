// Method implementations — defined as kernel operations.
// Each method receives { self, params, kernel, auth } in the execute hook.

import { defineOperation } from '@astrale-os/kernel'
import { CustomerOps, OrderOps, OrderItemOps } from './schema.generated'

export const CustomerMethods = [
  defineOperation.internal(CustomerOps.displayName, {
    authorize: ({ self }) => ({ nodeIds: [self!.id], perm: 'read' }),
    execute: async ({ self }) => `${self!.name} <${self!.email}>`,
  }),

  defineOperation.internal(CustomerOps.recentOrders, {
    authorize: ({ self }) => ({ nodeIds: [self!.id], perm: 'read' }),
    execute: async ({ self, params, kernel, auth }) => {
      return kernel.graph
        .as(auth)
        .node('Customer')
        .byId(self!.id)
        .to('placedOrder')
        .orderBy('createdAt', 'DESC')
        .limit(params?.limit ?? 10)
        .execute()
    },
  }),
]

export const OrderMethods = [
  defineOperation.internal(OrderOps.cancel, {
    authorize: ({ self }) => ({ nodeIds: [self!.id], perm: 'write' }),
    execute: async ({ self, kernel, auth }) => {
      if (self!.status === 'cancelled') return false
      if (self!.status === 'shipped' || self!.status === 'delivered') return false

      await kernel.graph.as(auth).mutate.update('Order', self!.id, { status: 'cancelled' })
      return true
    },
  }),
]

export const OrderItemMethods = [
  defineOperation.internal(OrderItemOps.subtotal, {
    authorize: ({ self }) => ({ nodeIds: [self!.id], perm: 'read' }),
    execute: async ({ self }) => self!.quantity * self!.unitPriceCents,
  }),
]
