# Spec 10: Methods as Operations

> Methods are operations bound to a node. `self` is execution context — like `auth` or `kernel` —
> not a param. The operation system gains one optional field. Everything else stays the same.

---

## 1. Core Idea

A method is an operation where the caller provides a `self` — the node instance the operation is bound to.

| | Regular Operation | Method Operation |
|--|--|--|
| **params** | `{ iss, sub }` | `{ product }` (method args, flat) |
| **self** | `undefined` | `{ id, name, email, ... }` |
| **context** | `{ kernel, auth, params }` | `{ kernel, auth, params, self }` |

One addition to the operation system: `self` in the hook context. Everything else — `op()`, `defineOperation`, dispatcher, registration — unchanged.

---

## 2. Kernel Changes

### 2.1 `self` in Hook Context

```typescript
/** Context for pre-resolve hooks */
export type OperationContext<TParams, TSchema extends AnySchema = KernelSchemaType> = {
  kernel: ContextForSchema<TSchema>
  auth: AuthContext
  params: TParams
  self: Record<string, unknown> & { readonly id: string } | undefined
}
```

For regular operations, `self` is `undefined`. For methods, it's the node instance. Every hook gets it — authorize, resolve, invariants, execute, effects.

### 2.2 `kernel.call` Gains Optional `self`

```typescript
export type Kernel = {
  call<N extends AllOpName>(
    name: N,
    auth: AuthContext,
    params: OpTypeMap[N]['params'],
    self?: Record<string, unknown> & { readonly id: string },
  ): Promise<OpTypeMap[N]['result']>

  call(
    name: string,
    auth: AuthContext,
    params: unknown,
    self?: Record<string, unknown> & { readonly id: string },
  ): Promise<unknown>
}
```

Regular ops don't pass it. Methods do. The dispatcher threads it into hook context.

### 2.3 Dispatcher Change

One line in `createBoundOp`:

```typescript
export function createBoundOp(def, context, policyEvaluator): BoundOperation {
  return async (auth, params, self?) => {
    // ... validate params (unchanged) ...
    const baseCtx = { kernel: context, auth, params: validated, self }
    //                                                          ^^^^ new

    // ... rest of pipeline unchanged ...
  }
}
```

### 2.4 Optional `authorize` for Internal Ops

```typescript
export type InternalOperationConfig<O extends AnyOp, TResolved = undefined, TSchema = KernelSchemaType> =
  Omit<OperationConfig<O, TResolved, TSchema>, 'authorize'> & {
    authorize?: OperationConfig<O, TResolved, TSchema>['authorize']
  }
```

`defineOperation.internal` defaults `authorize` to `() => undefined`. External ops keep it required.

---

## 3. Method Operations

### 3.1 Codegen Emits `op()` Descriptors

Params are flat — just the method arguments:

```typescript
// GENERATED: schema.generated.ts

export const CustomerOps = {
  displayName: op(
    'Customer.displayName',
    z.void(),          // no args
    z.string(),
  ),

  canPurchase: op(
    'Customer.canPurchase',
    z.object({ product: z.string() }),   // flat method args
    z.boolean(),
  ),

  recentOrders: op(
    'Customer.recentOrders',
    z.object({ limit: z.number().optional() }).optional(),
    z.array(OrderPropsSchema),
  ),
} as const

export const OrderOps = {
  cancel: op(
    'Order.cancel',
    z.void(),
    z.boolean(),
  ),
} as const
```

Same `op()` as every other kernel operation. Params are the method's own args, not `{ self, args }`.

### 3.2 Author Implements

```typescript
// domain/methods/customer.ts
import { defineOperation } from '@astrale-os/kernel'
import { CustomerOps } from './schema.generated'

export const CustomerMethods = [
  defineOperation.internal(CustomerOps.displayName, {
    execute: async ({ self }) => `${self.name} <${self.email}>`,
  }),

  defineOperation.internal(CustomerOps.canPurchase, {
    authorize: ({ self }) => [{ nodeIds: [self.id], perm: 'customer:purchase' }],
    execute: async ({ kernel, auth, self, params }) => {
      const product = await kernel.graph.as(auth)
        .node('Product').byId(params.product).execute()
      return product.inStock && product.priceCents > 0
    },
  }),

  defineOperation.internal(CustomerOps.recentOrders, {
    execute: async ({ kernel, auth, self, params }) => {
      return kernel.graph.as(auth)
        .node('Customer').byId(self.id)
        .to('placedOrder')
        .orderBy('createdAt', 'desc')
        .limit(params?.limit ?? 10)
        .execute()
    },
  }),
]
```

```typescript
// domain/methods/order.ts
export const OrderMethods = [
  defineOperation.internal(OrderOps.cancel, {
    execute: async ({ kernel, auth, self }) => {
      if (self.status === 'cancelled') return false
      if (self.status === 'shipped' || self.status === 'delivered') return false
      await kernel.graph.as(auth).mutate.update('Order', self.id, { status: 'cancelled' })
      return true
    },
  }),
]
```

Clean. `self` is top-level context. `params` are method args. No unwrapping.

### 3.3 Comparison: Regular Op vs Method Op

```typescript
// Regular operation — no self
defineOperation.external(IdentityOps.find, {
  authorize: ({ params }) => [{ nodeIds: [params.who], perm: 'identity:read' }],
  execute: async ({ kernel, params }) => {
    return kernel.graph.node('Identity')
      .where('iss', 'eq', params.iss)
      .execute()
  },
})

// Method operation — self is the bound node
defineOperation.internal(CustomerOps.displayName, {
  execute: async ({ self }) => self.name,
})
```

Same `defineOperation`. Same hooks. Same pipeline. Methods just have `self`.

---

## 4. SDK Side

### 4.1 `dispatch` on GraphOptions

```typescript
interface GraphOptions<S extends SchemaShape> {
  adapter: GraphAdapter
  schemaInfo?: SchemaInfo

  /**
   * Operation dispatcher for method calls. Signature matches kernel.call.
   */
  dispatch?: (
    name: string,
    auth: unknown,
    params: unknown,
    self: { id: string } & Record<string, unknown>,
  ) => Promise<unknown>
}
```

### 4.2 `graph.as(auth)`

```typescript
interface Graph<S extends SchemaShape> {
  /** Auth-scoped graph. Methods on returned nodes dispatch with this auth. */
  as(auth: unknown): Graph<S>
}
```

Lightweight — `Object.create(this)`, shares adapter/schema, captures auth.

### 4.3 Enrichment

```typescript
function enrichNode<T extends Record<string, unknown>>(
  type: string,
  raw: T,
  methodNames: string[],
  dispatch: DispatchFn | undefined,
  auth: unknown,
): T {
  if (!methodNames.length) return raw

  return new Proxy(raw, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && methodNames.includes(prop)) {
        if (!dispatch) throw new MethodNotDispatchedError(type, prop)
        return (args?: unknown) =>
          dispatch(
            `${type}.${prop}`,    // operation name
            auth,                  // auth context
            args ?? undefined,     // params = method args (flat)
            target as any,         // self = the node
          )
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}
```

The proxy passes `target` (the node) as `self`. Method args go as `params`. Clean separation.

### 4.4 `graph.call()` Simplification

```typescript
async call(type: string, id: string, method: string, args?: unknown): Promise<unknown> {
  if (!this._dispatch || this._auth === undefined) {
    throw new MethodNotDispatchedError(type, method)
  }

  const [row] = await this._adapter.query(
    `MATCH (n:${type} {id: $id}) RETURN n`, { id },
  )
  if (!row) throw new Error(`${type} not found`)

  const { id: nodeId, ...props } = row.n
  return this._dispatch(
    `${type}.${method}`,
    this._auth,
    args ?? undefined,
    { id: (nodeId as string) ?? id, ...props },
  )
}
```

---

## 5. Registration

```typescript
const kernel = await createKernel({
  operations: [
    ...builtinOps,
    ...CustomerMethods,
    ...OrderMethods,
  ],
  deps: { graph, authentication, authorization, eventBus },
})
```

One array. Methods are operations. No separate path.

---

## 6. Full Flow

### 6.1 Usage in a Kernel Operation

```typescript
export const getCustomerProfile = defineOperation.external(ProfileOps.get, {
  authorize: ({ params }) => [{ nodeIds: [params.customerId], perm: 'read' }],

  execute: async ({ kernel, auth, params }) => {
    const g = kernel.graph.as(auth)

    const customer = await g.node('Customer').byId(params.customerId).execute()
    const displayName = await customer.displayName()
    //    → dispatch('Customer.displayName', auth, undefined, customer)
    //    → kernel pipeline: authorize → execute({ self: customer }) → event

    const recent = await customer.recentOrders({ limit: 5 })
    //    → dispatch('Customer.recentOrders', auth, { limit: 5 }, customer)

    return { customer, displayName, recentOrders: recent }
  },
})
```

### 6.2 What Happens

```
customer.displayName()
  → proxy: dispatch('Customer.displayName', auth, undefined, customer)
  → kernel.call('Customer.displayName', auth, undefined, customer)
  → dispatcher injects self into context
  → execute: ({ self }) => self.name    ← self = the customer node
  → event: op:Customer.displayName:completed
  → "Alice <alice@example.com>"
```

---

## 7. Dependency Path

```
kernel-api          ← op(), OpDef, Kernel type (unchanged except optional self on call)
  ↑
codegen             ← emits op() for methods (params = method args, flat)
  ↑
author code         ← defineOperation.internal (same as all ops)
  ↑
kernel boot         ← [...builtinOps, ...methodOps]

typegraph SDK       ← ZERO kernel dependency
                       dispatch?: (name, auth, params, self) => Promise<unknown>
                       graph.as(auth) captures auth
                       enrichment passes node as self
```

---

## 8. What Changes

### Kernel (minimal)

| Change | Scope |
|--------|-------|
| `self` field on `OperationContext` | One type addition |
| `self?` param on `kernel.call` | One optional arg |
| `self` threaded in `createBoundOp` | One line |
| `authorize` optional for internal ops | One type change |

### SDK (removal)

| Removed | Reason |
|---------|--------|
| `MethodsConfig`, `MethodHandler`, `MethodCallContext` | Methods are operations |
| `methods` option on `GraphOptions` | Replaced by `dispatch` |
| `validateMethodImplementations()` | Kernel validates operations |
| `callNodeMethod()` / `callEdgeMethod()` | Dispatch replaces direct invocation |

### Nothing new added

No `implementMethods`. No `MethodDispatcher`. No method-specific types. The operation system gains `self` — one optional field — and methods fall out naturally.

---

## 9. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **`self` is context, not params** | Top-level in hook context alongside `kernel`, `auth`, `params` | Flat access, no unwrapping |
| **`self` is optional** | `undefined` for regular ops | One context type for everything |
| **Method params = method args** | `{ product }`, not `{ self, args: { product } }` | Flat, natural, same as any operation's params |
| **No new abstractions** | Same `op()`, `defineOperation`, `OperationContract` | Methods aren't special |
| **`dispatch = kernel.call`** | Direct function on GraphOptions | Zero wrappers |
| **`graph.as(auth)`** | Auth scoping on graph, `unknown` type | SDK never sees AuthContext |
| **`authorize` optional for internal** | Default pass-through | Cuts boilerplate on all internal ops |
| **Array export for grouping** | `export const CustomerMethods = [...]` | Just an array, no helper |
