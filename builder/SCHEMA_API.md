# Schema API v2 — TypeScript-native schema definition

> Two source files contribute to a **single** `defineSchema()` call — no `extendSchema()`, one schema object.

## Pipeline

```
@astrale/builder/kernel ──┐
                           ├─ defineSchema() ─▶ Schema ─▶ generate() ─▶ schema.generated.ts
app.schema.ts ─────────────┘
```

---

## API surface

```typescript
// ── Data types — use Zod v4 ─────────────────────────────────────────────────
import { z } from 'zod'

// Scalars
z.string()                          // .min(n) .max(n) .email() .url() .uuid() .optional() .default(v) .array()
z.number().int()                    // .min(n) .max(n) .optional() .default(v)
z.boolean()                         // .optional() .default(v)

// Composite — standard Zod, no wrappers
z.enum(['a', 'b'])                  // .default(v) .optional() .array()
z.object({ key: z.ZodType })        // .optional() — use for value types (not nodes)

// ── Custom — no Zod equivalent ──────────────────────────────────────────────

bitmask(): BitmaskDef               // permissions bitfield
data(): DataSelfSchema              // datastore data marker for the owning node's content
data(target: NodeDef | IfaceDef): DataGrantSchema  // datastore data marker for another node's content

// ── Structural — custom builders ────────────────────────────────────────────

iface(config: {
  extends?:  readonly IfaceDef[],
  props?:    PropShape,
  data?:     DataShape,
  indexes?:  readonly IndexDef[],
  methods?:  Record<string, MethodDef>,
} | (() => {
  extends?:  readonly IfaceDef[],
  props?:    PropShape,
  data?:     DataShape,
  indexes?:  readonly IndexDef[],
  methods?:  Record<string, MethodDef>,
})): IfaceDef

node(config: {
  extends?:    NodeDef,
  implements?: readonly IfaceDef[],
  props?:      PropShape,
  data?:       DataShape,
  indexes?:    readonly IndexDef[],
  methods?:    Record<string, MethodDef>,
} | (() => {
  extends?:    NodeDef,
  implements?: readonly IfaceDef[],
  props?:      PropShape,
  data?:       DataShape,
  indexes?:    readonly IndexDef[],
  methods?:    Record<string, MethodDef>,
})): NodeDef

edge(
  from: { as: string; types: readonly (NodeDef | IfaceDef)[]; cardinality?: '0..1' | '1' | '0..*' | '1..*' },
  to:   { as: string; types: readonly (NodeDef | IfaceDef)[]; cardinality?: '0..1' | '1' | '0..*' | '1..*' },
  opts?: {
    noSelf?:      boolean,
    acyclic?:     boolean,
    unique?:      boolean,
    props?:       PropShape,
    methods?:     Record<string, MethodDef>,
  },
): EdgeDef

method(config: {
  params?:  ParamShape | (() => ParamShape),   // thunk for forward/circular refs
  returns:  z.ZodType,                         // use ref(NodeDef) for graph refs, data() for datastore-backed content
  access?:  'private' | 'internal',
}): MethodDef

ref(target: NodeDef | IfaceDef): z.ZodType   // wraps a graph def into a Zod schema
data(): DataSelfSchema                        // wraps owning node datastore content as a Zod return schema
data(target: NodeDef | IfaceDef): DataGrantSchema  // wraps target node datastore content as a Zod return schema

defineSchema(defs: Record<string, IfaceDef | NodeDef | EdgeDef>): Schema

// ── Index shorthand ────────────────────────────────────────────────────────

type IndexDef =
  | string                                                      // btree on single prop
  | { property: string; type?: 'btree' | 'fulltext' | 'unique' }

// ── PropShape ────────────────────────────────────────────────────────────────
// Used in node/edge/iface props. Zod + bitmask().

type PropShape = Record<string, z.ZodType | BitmaskDef>

// ── DataShape ────────────────────────────────────────────────────────────────
// Used in node/iface data. Pure Zod — describes datastore-backed content schema.

type DataShape = Record<string, z.ZodType>

// ── ParamShape ───────────────────────────────────────────────────────────────
// Used in method params. Pure Zod — use ref(NodeDef) for graph node references.

type ParamShape = Record<string, z.ZodType>
```

---

## Kernel schema (shipped by `@astrale/builder/kernel`)

The kernel schema is provided by the package. Its contents are shown here for reference.

```typescript
import { z } from 'zod'
import { iface, node, edge, bitmask, method, ref } from '@astrale/builder'

// ── Enums ──────────────────────────────────────────────────────────────────

const LinkAction      = z.enum(['link', 'unlink'])
const LinkConflict    = z.enum(['patch', 'replace'])
const LinkedDirection = z.enum(['out', 'in'])

// ── Value types — inputs ───────────────────────────────────────────────────

const MetadataInput   = z.object({ name: z.string().optional(), contentType: z.string().optional() })
const DatastoreObject = z.object({ uri: z.string(), contentType: z.string().optional() })
const DatastoreGrant  = z.object({ token: z.string(), objects: z.array(DatastoreObject) })
const NodeRef         = z.object({ id: z.string(), typeId: z.string() })
const NodeEditInput   = z.object({ metadata: MetadataInput.optional(), storage: z.boolean().optional(), typeId: z.string().optional() })
const NodeLinkInput   = z.object({ targetId: z.string(), typeId: z.string(), action: LinkAction, metadata: z.string().optional(), onConflict: LinkConflict.optional() })
const NodeLinkedInput = z.object({ typeId: z.string().optional(), direction: LinkedDirection.default('out') })

// ── Value types — results ──────────────────────────────────────────────────

const NodeCreateResult = z.object({ moduleId: z.string() })
const NodeOpenResult   = z.object({ moduleId: z.string(), storageUri: z.string().optional() })
const NodeEditResult   = z.object({ moduleId: z.string(), dataVersion: z.number().int().optional(), storageUri: z.string().optional(), grant: DatastoreGrant.optional() })
const NodeDeleteResult = z.object({ success: z.boolean() })
const NodeLinkResult   = z.object({ linked: z.boolean(), edgeId: z.string().optional() })
const NodeLinkedResult = z.object({ modules: z.array(NodeRef) })

// ── Interfaces ─────────────────────────────────────────────────────────────

export const Node = iface(() => ({
  methods: {
    create:  method({ params: { parent: ref(Node), class: ref(Class) }, returns: NodeCreateResult }),
    open:    method({ returns: NodeOpenResult }),
    edit:    method({ params: { input: NodeEditInput }, returns: NodeEditResult }),
    delete:  method({ returns: NodeDeleteResult }),
    link:    method({ params: { input: NodeLinkInput }, returns: NodeLinkResult }),
    linked:  method({ params: { input: NodeLinkedInput }, returns: NodeLinkedResult }),
  },
}))

export const Link     = iface({})
export const Identity = iface({ extends: [Node] })

// ── Nodes ──────────────────────────────────────────────────────────────────

export const Class     = node({ implements: [Node] })
export const Interface = node({ implements: [Node] })
export const Operation = node({ implements: [Node] })
export const Root      = node({ implements: [Identity] })

// ── Edges ───────────────────────────────────────────────────────────────────

export const hasParent = edge(
  { as: 'child',     types: [Node], cardinality: '0..1' },
  { as: 'parent',    types: [Node] },
  { noSelf: true, acyclic: true },
)
export const instanceOf = edge(
  { as: 'instance',  types: [Node, Link], cardinality: '1' },
  { as: 'type',      types: [Class] },
)
export const hasLink = edge(
  { as: 'source',    types: [Node] },
  { as: 'link',      types: [Link], cardinality: '1' },
)
export const linksTo = edge(
  { as: 'link',      types: [Link], cardinality: '1' },
  { as: 'target',    types: [Node] },
)
export const implements_ = edge(
  { as: 'class',     types: [Class] },
  { as: 'interface', types: [Interface] },
  { noSelf: true },
)
export const extends_ = edge(
  { as: 'child',     types: [Interface] },
  { as: 'parent',    types: [Interface] },
  { noSelf: true, acyclic: true },
)
export const methodOf = edge(
  { as: 'operation', types: [Operation], cardinality: '0..1' },
  { as: 'owner',     types: [Class, Interface] },
)
export const hasPerm = edge(
  { as: 'identity',  types: [Identity] },
  { as: 'target',    types: [Node] },
  { props: { perm: bitmask() } },
)
export const excludedFrom = edge(
  { as: 'subject',    types: [Identity] },
  { as: 'excluded',   types: [Identity] },
  { noSelf: true, acyclic: true },
)
export const constrainedBy = edge(
  { as: 'subject',    types: [Identity] },
  { as: 'constraint', types: [Identity] },
  { noSelf: true, acyclic: true },
)
export const extendsWith = edge(
  { as: 'subject',    types: [Identity] },
  { as: 'extension',  types: [Identity] },
  { noSelf: true, acyclic: true },
)
```

---

## ecommerce.schema.ts

```typescript
import { z } from 'zod'
import { node, edge, iface, method, ref, data } from '@astrale/builder'
import { Identity } from '@astrale/builder/kernel'

// ── Enums ──────────────────────────────────────────────────────────────────

const Currency    = z.enum(['USD', 'EUR', 'GBP', 'JPY'])
const OrderStatus = z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'])

// ── Interfaces ─────────────────────────────────────────────────────────────

export const Timestamped = iface({
  props: { createdAt: z.string().default('now'), updatedAt: z.string().optional() },
})

export const HasSlug = iface({
  props:   { slug: z.string() },
  indexes: [{ property: 'slug', type: 'unique' }],
})

export const Priceable = iface({
  props: { priceCents: z.number().int(), currency: Currency.default('USD') },
})

// ── Nodes ──────────────────────────────────────────────────────────────────
// Order is declared before Customer: Customer.recentOrders returns Order (array)

export const Order = node({
  implements: [Timestamped],
  props: {
    status:     OrderStatus.default('pending'),
    totalCents: z.number().int(),
    notes:      z.string().optional(),
  },
  methods: {
    cancel: method({ returns: z.boolean(), access: 'private' }),
  },
})

export const Customer = node({
  implements: [Identity, Timestamped],
  props: {
    email: z.string().email(),
    name:  z.string(),
    phone: z.string().optional(),
  },
  indexes: [{ property: 'email', type: 'unique' }],
  methods: {
    displayName:  method({ returns: z.string() }),
    recentOrders: method({ params: { limit: z.number().int().default(10) }, returns: z.array(ref(Order)), access: 'private' }),
  },
})

export const Category = node({
  implements: [HasSlug],
  props:   { name: z.string() },
  indexes: [{ property: 'name', type: 'unique' }],
})

export const Product = node({
  implements: [Timestamped, HasSlug, Priceable],
  props: {
    title:   z.string(),
    sku:     z.string().min(3).max(20),
    inStock: z.boolean().default(true),
  },
  data: {
    description: z.string(),
    images:      z.array(z.string().url()),
    specs:       z.record(z.string(), z.string()).optional(),
  },
  indexes: [{ property: 'sku', type: 'unique' }],
  methods: {
    content: method({ returns: data() }),
  },
})

export const Review = node({
  implements: [Timestamped],
  props: { rating: z.number().int(), body: z.string().optional() },
})

export const PremiumProduct = node({
  extends: Product,
  props: {
    tier:     z.enum(['gold', 'platinum']),
    discount: z.number().int(),
  },
  methods: {
    effectivePrice: method({ returns: z.number().int() }),
  },
})

// ── Edges ───────────────────────────────────────────────────────────────────

export const placedOrder = edge(
  { as: 'customer', types: [Customer] },
  { as: 'order',    types: [Order], cardinality: '1' },
  { unique: true },
)
export const orderItem = edge(
  { as: 'order',   types: [Order] },
  { as: 'product', types: [Product] },
  {
    props:   { quantity: z.number().int().default(1), unitPriceCents: z.number().int() },
    methods: { subtotal: method({ returns: z.number().int(), access: 'private' }) },
  },
)
export const inCategory = edge(
  { as: 'product',  types: [Product] },
  { as: 'category', types: [Category] },
)
export const parentCategory = edge(
  { as: 'child',  types: [Category], cardinality: '0..1' },
  { as: 'parent', types: [Category] },
  { noSelf: true, acyclic: true },
)
export const reviewed = edge(
  { as: 'reviewer', types: [Customer] },
  { as: 'product',  types: [Product] },
  { unique: true, props: { rating: z.number().int(), body: z.string().optional(), verified: z.boolean().default(false) } },
)
export const wishlisted = edge(
  { as: 'customer', types: [Customer] },
  { as: 'product',  types: [Product] },
  { unique: true },
)
```

---

## schema.ts

```typescript
import { defineSchema } from '@astrale/builder'
import * as kernel    from '@astrale/builder/kernel'
import * as ecommerce from './ecommerce.schema'

export const Schema = defineSchema({ ...kernel, ...ecommerce })
```

---

## API patterns

### Data types — Zod all the way

Props, method params, and method returns (when scalar/object) use Zod directly. No wrapper types.

```typescript
// Props on a node
props: {
  email: z.string().email(),
  count: z.number().int().min(0),
  active: z.boolean().default(true),
}

// Value types (objects passed as params/results, not graph nodes)
const MetadataInput = z.object({ name: z.string().optional() })

// Enums
const Status = z.enum(['pending', 'done'])
```

The only exceptions are `bitmask()` (a permissions bitfield with no Zod equivalent, used exclusively on edge props), `ref()` (wraps a `NodeDef`/`IfaceDef` into a `z.ZodType` for use in method params and returns), and `data()` (wraps datastore-backed content for use in method returns).

---

### props vs data — two storage layers

`props` are graph metadata — stored directly on the node in the kernel graph. Fast to read, included in every query result. Use for small, frequently accessed fields (name, status, sku).

`data` is datastore-backed content — stored outside the graph and exposed through typed methods. Use for large or rich content (descriptions, images, specs) that doesn't need to appear in list queries.

```typescript
const Product = node({
  props: { title: z.string(), sku: z.string(), inStock: z.boolean().default(true) },
  data:  { description: z.string(), images: z.array(z.string().url()) },
  methods: {
    content: method({ returns: data() }),  // returns this node's typed datastore content
  },
})
```

`data()` (no argument) resolves to the owning node's own typed datastore content. `data(target)` resolves to typed datastore content from another node/interface. Both produce `z.ZodType`-compatible schemas usable as method `returns`.

`data` is inherited the same way as `props`: a node inherits `data` from its `implements` interfaces and its `extends` parent.

---

### Graph references in methods — `ref()` wrapper

`NodeDef` and `IfaceDef` are not `z.ZodType`. To use them as method params or returns, wrap them with `ref()` which produces a standard Zod schema. This keeps the `method()` config uniform: params and returns are always `z.ZodType`.

```typescript
displayName:  method({ returns: z.string() })                                                       // scalar return
recentOrders: method({ params: { limit: z.number().int().default(10) }, returns: z.array(ref(Order)) })  // array of nodes
findOwner:    method({ returns: ref(Customer).optional() })                                         // optional single ref
create:       method({ params: () => ({ parent: ref(Node), class: ref(Class) }), returns: NodeCreateResult }) // node refs as params
```

All Zod combinators work on `ref()` results: `.array()`, `.optional()`, `.nullable()`, `z.union([...])`, etc.

---

### edge() — endpoint objects, no positional ambiguity

Endpoints are named objects `{ as, types }`. The label is colocated with its types.

```typescript
edge(
  { as: 'instance', types: [Node, Link], cardinality: '1' },
  { as: 'type',     types: [Class] },
)
```

Cardinality is colocated with its endpoint — no separate record, no string-key matching. Default is `'0..*'` when omitted.

---

### node vs iface inheritance rules

```
iface.extends   → readonly IfaceDef[]   multiple iface inheritance (exact tuple inferred)
node.extends    → NodeDef               single node inheritance (at most one)
node.implements → readonly IfaceDef[]   multiple iface implementation (exact tuple inferred)
```

All reference arrays are `readonly` so that TypeScript infers exact tuples (`readonly [typeof A, typeof B]`) instead of widened arrays (`(typeof A | typeof B)[]`). This preserves the full inheritance identity at the type level — required for the SDK to resolve deep inheritance chains and generate strictly typed edge traversals (see [typing-strategy](docs/design/typing-strategy.md) §"Strict endpoint validation").

---

### unique index — separated from scalar type

`unique` is an index constraint, not a type attribute. It lives in `indexes` at the node/iface level.

```typescript
props:   { email: z.string().email() }
indexes: [{ property: 'email', type: 'unique' }]
```

Indexes declared on an `iface` are inherited by all nodes that implement it.

---

### Named scalar constraints — plain TypeScript const

Zod schemas are immutable values and compose freely.

```typescript
const email = z.string().email()
const sku   = z.string().min(3).max(20)

const Customer = node({ props: { email, backupEmail: email.optional() } })
const Product  = node({ props: { sku } })
```

---

### Forward refs — config thunk and params thunk

When defs reference symbols declared later in the file, you can wrap the whole `iface()`/`node()` config in a thunk. `defineSchema()` resolves config thunks first, then method param thunks.

```typescript
// Config thunk lets methods reference later defs
const Node = iface(() => ({
  methods: {
    create: method({ params: { parent: ref(Node), class: ref(Class) }, returns: NodeCreateResult }),
  },
}))

// Params thunk still works when only params need laziness
const Customer = node({
  methods: {
    findOwner: method({ params: () => ({ target: ref(User) }), returns: z.boolean() }),
  },
})
```

`returns` is never a thunk — it must always be an already-initialized Zod schema.

For details on schema assembly (flat record, `import *` merge, authoring rules), see [schema-assembly](docs/design/schema-assembly.md).
