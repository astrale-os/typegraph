# Typing Strategy (critical path)

## Typing boundary — Zod for data, TypeScript native for topology

Two distinct type systems coexist in the DSL, each handling what it does best:

- **Zod** handles runtime value schemas: graph `props`, datastore `data` (`node.data` / `iface.data`), method params, and method returns. Zod provides validation, inference (`z.infer`), and composability (`.optional()`, `.array()`, `z.union()`).
- **TypeScript native** (`readonly`, `<const>`, conditional types) handles the **topology layer**: which node implements which interface, which edge connects which endpoints, inheritance chains. These are purely structural relationships resolved at compile time — they carry zero runtime cost and need exact literal identity, not shape validation.

`ref()` and `data()` are bridges: they wrap topology-layer references and datastore data-access markers into Zod schemas so method signatures stay uniform (`returns: z.ZodType`).

## Builder config types (readonly for strict tuple inference)

All reference arrays in config types use `readonly` to ensure TypeScript infers exact tuples rather than widened arrays. Combined with `<const C>` on the builder generics (TS 5.0), this gives the compiler full knowledge of the inheritance tree — mandatory for SDK-level strict endpoint validation later.

```typescript
interface IfaceConfig {
  readonly extends?: readonly IfaceDef<any>[]
  readonly props?: PropShape
  readonly data?: DataShape
  readonly indexes?: readonly IndexDef[]
  readonly methods?: Record<string, MethodDef>
}

interface NodeConfig {
  readonly extends?: NodeDef<any>
  readonly implements?: readonly IfaceDef<any>[]
  readonly props?: PropShape
  readonly data?: DataShape
  readonly indexes?: readonly IndexDef[]
  readonly methods?: Record<string, MethodDef>
}

interface EdgeEndpointConfig {
  readonly as: string
  readonly types: readonly (NodeDef<any> | IfaceDef<any>)[]
  readonly cardinality?: '0..1' | '1' | '0..*' | '1..*'
}

interface EdgeConfig {
  readonly noSelf?: boolean
  readonly acyclic?: boolean
  readonly unique?: boolean
  readonly props?: PropShape
  readonly methods?: Record<string, MethodDef>
}
```

Without `readonly`, `node({ implements: [A, B] })` infers `C['implements']` as `(typeof A | typeof B)[]` — a bag where the compiler forgets which interfaces are present and in what position. With `readonly`, it infers `readonly [typeof A, typeof B]` — an exact tuple preserving identity.

## Forward refs in definition config

`iface()` and `node()` accept either a config object or a config thunk (`() => config`). This enables forward/circular references at definition level while preserving inferred literal config types.

```typescript
const Node = iface(() => ({
  methods: {
    create: method({ params: { parent: ref(Node), class: ref(Class) }, returns: NodeCreateResult }),
  },
}))
```

`defineSchema()` resolves config thunks before endpoint and method validation.

## Builder branded return types (Const Generics)

Each builder uses a single const-generic config parameter to capture its definition. The `__kind` discriminant enables `defineSchema()` to auto-categorise (see [schema-assembly](schema-assembly.md)). Props and methods are extracted on demand via conditional types.

```typescript
interface IfaceDef<const C extends IfaceConfig = IfaceConfig> {
  readonly __kind: 'iface'
  readonly __brand: unique symbol
  readonly config: C
}

interface NodeDef<const C extends NodeConfig = NodeConfig> {
  readonly __kind: 'node'
  readonly __brand: unique symbol
  readonly config: C
}

// EdgeDef — carries endpoint configs as type params for SDK-level strict validation
interface EdgeDef<
  const From extends EdgeEndpointConfig = EdgeEndpointConfig,
  const To extends EdgeEndpointConfig = EdgeEndpointConfig,
  const C extends EdgeConfig = EdgeConfig,
> {
  readonly __kind: 'edge'
  readonly __brand: unique symbol
  readonly from: From
  readonly to: To
  readonly config: C
}
```

The `edge()` builder captures all three type parameters via `<const>` inference:

```typescript
function edge<
  const From extends EdgeEndpointConfig,
  const To extends EdgeEndpointConfig,
  const C extends EdgeConfig,
>(from: From, to: To, opts?: C): EdgeDef<From, To, C>
```

This means `Schema['edges']['placedOrder']` preserves the exact endpoint types — e.g. `{ as: 'customer', types: readonly [typeof Customer] }` — which the SDK type utilities can inspect at compile time.

## Props inference — Zod all the way

Props and methods are extracted from the `config` using utility types:

```typescript
type ExtractProps<D> = D extends { config: { props: infer P } } ? P : {}
type InferProps<P> = {
  [K in keyof P]: P[K] extends BitmaskDef ? number
    : P[K] extends z.ZodType<infer O> ? O
    : never
}
```

`InferProps` handles both Zod types and `BitmaskDef` (which resolves to `number`).

## Data inference — parallel to props

`data` follows the same extraction and inheritance pattern as `props`, with its own utility chain:

```typescript
type ExtractData<D> = D extends { config: { data: infer P } } ? P : Record<string, never>
type ExtractFullData<D> =
  // NodeDef: own data + inherited from implements + inherited from extends
  // IfaceDef: own data + inherited from extends chain
type HasData<D> = keyof ExtractFullData<D> extends never ? false : true
```

`ExtractFullData` walks the same inheritance chains as `ExtractFullProps` — a node inherits `data` from its `implements` interfaces and its `extends` parent. `HasData` is used to determine whether a node has any datastore-backed content (own or inherited).

## Graph references in methods — `ref()` and `data()` wrappers

Method params and return types use Zod exclusively. Two wrappers bridge non-Zod concepts into Zod schemas:

- `ref()` wraps graph node references (NodeDef, IfaceDef) into `z.ZodType` for use in method params and returns.
- `data()` wraps datastore data-access markers into `z.ZodType` for use in method returns.

```typescript
function ref<D extends NodeDef | IfaceDef>(target: D): RefSchema<D>
interface RefSchema<D> extends z.ZodType<{ readonly id: string }> {
  readonly __ref_target: D
  readonly _output: ExtractFullProps<D> & { readonly id: string }
}

function data(): DataSelfSchema                                       // data marker for the owning node's own data
function data<D extends NodeDef | IfaceDef>(target: D): DataGrantSchema<D>  // data marker for another node's data
interface DataSelfSchema extends z.ZodType<unknown> {
  readonly __data_self: true
  readonly _output: unknown
}
interface DataGrantSchema<D> extends z.ZodType<unknown> {
  readonly __data_grant: true
  readonly __data_target: D
  readonly _output: ExtractFullData<D>
}
```

Both return `z.custom()` instances carrying runtime metadata for introspection by `defineSchema()`. This unifies the entire method config to pure Zod:

```typescript
function method<const C extends MethodConfig>(config: C): MethodDef<C>

type MethodConfig = {
  params?:  Record<string, z.ZodType> | (() => Record<string, z.ZodType>)
  returns:  z.ZodType
  access?:  'private' | 'internal'
}
```

`method()` takes a single config object. `params` is optional (defaults to no params), `returns` is required, and `access` is a flat field (no nested opts). This eliminates the empty `{}` first arg on no-params methods, makes every call scannable via the `returns:` label, and uses a single const-generic parameter instead of three — yielding shorter type errors and simpler extraction utilities. The config is also extensible without breaking changes (add `description`, `deprecated`, etc. later).

Composition comes for free from Zod:
- Single ref: `ref(Order)` — resolves to `Order & { id }` at the type level
- Array of refs: `z.array(ref(Order))` — resolves to `(Order & { id })[]`
- Optional ref: `ref(Order).optional()` — resolves to `(Order & { id }) | undefined`
- Union: `z.union([ref(Customer), ref(Admin)])` — polymorphic ref
- Self data marker: `data()` — method contract resolves to the node's data shape
- Targeted data marker: `data(Product)` — method contract resolves to `Product`'s data shape

`ExtractMethodReturn` and `ExtractMethodArgs` become simple `z.infer<>` calls — no special-casing for NodeDef vs ZodType.

## Collecting inherited props

```typescript
// Pseudo-code for collecting props from extended ifaces/nodes
type CollectIfaceProps<T extends readonly IfaceDef[]> = ...
type ExtractFullProps<N extends NodeDef | EdgeDef | IfaceDef> = 
  InferProps<ExtractProps<N>> & CollectIfaceProps<ExtractImplements<N>>
```

## Schema — flat record auto-categorisation

```typescript
type OnlyKind<D extends Record<string, any>, Kind extends string> = {
  [K in keyof D as D[K] extends { __kind: Kind } ? K : never]: D[K]
}

interface Schema<D extends Record<string, any> = Record<string, any>> {
  readonly defs: D
  readonly nodes: OnlyKind<D, 'node'>
  readonly ifaces: OnlyKind<D, 'iface'>
  readonly edges: OnlyKind<D, 'edge'>
}
```

## defineMethods factory

Instead of a manual type annotation, we use a factory function for optimal DX and contextual typing:

```typescript
function defineMethods<S extends Schema>(
  schema: S,
  methods: MethodsImpl<S>
): MethodsImpl<S>

type MethodsImpl<S extends Schema> = {
  [K in keyof S['nodes'] as HasMethods<S['nodes'][K]> extends true ? K : never]: {
    [M in ExtractMethodNames<S['nodes'][K]>]: (ctx: {
      self: ExtractFullProps<S['nodes'][K]> & { readonly id: string }
      args: z.infer<z.ZodObject<ExtractMethodParams<S['nodes'][K], M>>>
      graph: Client<S>
      data: {
        (): ExtractFullData<S['nodes'][K]>
        <T extends NodeDef<any> | IfaceDef<any>>(target: Ref<T> | (ExtractFullProps<T> & { readonly id: string })): ExtractFullData<T>
        (nodeId: string): unknown
      }
    }) => ExtractMethodReturnValue<S['nodes'][K], M> | Promise<ExtractMethodReturnValue<S['nodes'][K], M>>
  }
} & {
  [K in keyof S['edges'] as HasMethods<S['edges'][K]> extends true ? K : never]: {
    [M in ExtractMethodNames<S['edges'][K]>]: (ctx: {
      self: ExtractFullProps<S['edges'][K]> & { readonly id: string, readonly from: string, readonly to: string }
      args: z.infer<z.ZodObject<ExtractMethodParams<S['edges'][K], M>>>
      graph: Client<S>
      data: {
        (): never
        <T extends NodeDef<any> | IfaceDef<any>>(target: Ref<T> | (ExtractFullProps<T> & { readonly id: string })): ExtractFullData<T>
        (nodeId: string): unknown
      }
    }) => ExtractMethodReturnValue<S['edges'][K], M> | Promise<ExtractMethodReturnValue<S['edges'][K], M>>
  }
}
```

This gives perfect autocomplete without `typeof`, mapping over both nodes and edges. `ctx.graph` is the same `Client<S>` API as the SDK returned by `createClient(Schema)` — one API, not two. `ctx.data` resolves datastore-backed content with method-return types derived from schema `data`.

**Runtime injection:** `defineMethods()` is a pure registration step — the closures do not execute at definition time. The `graph` instance is injected by `bootstrap()` at call time, once the kernel exists. The dependency chain is `MethodsImpl<S> → Client<S> → Schema → MethodDef (signatures only)` — no circularity, since `Client<S>` never references `MethodsImpl<S>`.

## Method completeness — dual compile-time + runtime strategy

`MethodsImpl<S>` uses required keys (no `?`) so TypeScript **should** error when a node or method implementation is missing. This works when the underlying conditional types (`HasMethods`, `ExtractMethodNames`, `ExtractMethodParams`) resolve cleanly.

However, `MethodsImpl<S>` chains 4-5 nested conditional types with `z.infer`. If any step in this chain fails to resolve precisely (which can happen as schema size grows and TS degrades to a weaker type), the completeness check disappears silently. This is the fundamental risk of deep inference-only validation.

**Strategy: compile-time best-effort + runtime guarantee.**

1. **Compile-time (best effort):** `MethodsImpl<S>` enforces completeness via required mapped keys. For schemas within normal size (~20-40 nodes), this works reliably and provides IDE feedback instantly. No boilerplate, no explicit type annotations.

2. **Runtime (guaranteed):** `defineMethods()` performs a runtime completeness check by introspecting the schema. This catches any gap the type system missed. The check runs at import time (when `defineMethods()` is called), not at `bootstrap()` time — the developer sees the error immediately when the dev server starts.

```typescript
function defineMethods<S extends Schema>(schema: S, methods: MethodsImpl<S>): MethodsImpl<S> {
  for (const [name, def] of [...Object.entries(schema.nodes), ...Object.entries(schema.edges)]) {
    const declared = extractMethodNames(def)
    if (declared.length === 0) continue
    const impl = (methods as any)[name]
    if (!impl) throw new SchemaValidationError(`Missing method implementations for '${name}'. Expected: ${declared.join(', ')}`, 'methods', declared.join(', '), 'undefined')
    const missing = declared.filter(m => typeof impl[m] !== 'function')
    if (missing.length > 0) throw new SchemaValidationError(`'${name}' is missing methods: ${missing.join(', ')}`, 'methods', declared.join(', '), Object.keys(impl).join(', '))
  }
  return methods
}
```

This dual approach gives the best of both worlds: instant IDE feedback when types resolve, and a guaranteed safety net that never lets a missing method reach production.

## defineCore typing

```typescript
function defineCore<
  S extends Schema,
  N extends string,
  Nodes extends Record<string, CoreInstance>,
>(
  schema: S,
  namespace: N,
  config: { nodes: Nodes; links?: readonly CoreLink[] },
): CoreDef<S, N, RefsFromInstances<Nodes>>
```

`create()` and `link()` are top-level helpers used to build `nodes` / `links` values passed to `defineCore()` and `defineSeed()`. Returned refs are available as `core.refs.<name>`.

## Strict endpoint validation — SDK strategy (future)

The SDK (`createClient`) will expose edge traversals as typed methods on node instances, named after the opposite endpoint's `as` (e.g. `customer.order()`, `order.customer()`). This requires **compile-time** validation that both source and target are compatible with the edge's declared endpoint types, including through deep inheritance chains.

The strategy relies on three type utilities that leverage the `readonly` tuple inference from the config types:

**1. Ancestor flattening via union distribution**

```typescript
type DirectParents<D> =
  D extends IfaceDef<infer C> ? (C['extends'] extends readonly any[] ? C['extends'][number] : never) :
  D extends NodeDef<infer C> ?
    (C['extends'] extends NodeDef<any> ? C['extends'] : never) |
    (C['implements'] extends readonly any[] ? C['implements'][number] : never)
  : never

type WalkAncestors<D> = D | (
  DirectParents<D> extends infer P ? (P extends any ? WalkAncestors<P> : never) : never
)
```

`WalkAncestors<typeof Customer>` produces the union `typeof Customer | typeof Identity | typeof Timestamped | typeof Node` — all ancestors flattened into a single union. TypeScript evaluates and caches unions very efficiently, avoiding the "excessively deep" recursion errors that occur with nested conditional types.

**2. Compatibility check**

```typescript
type IsCompatible<D, AllowedTypes extends readonly any[]> =
  Extract<WalkAncestors<D>, AllowedTypes[number]> extends never ? false : true
```

If an edge declares `types: [Identity]` on its source endpoint, `IsCompatible<typeof Customer, readonly [typeof Identity]>` resolves to `true` because `typeof Identity` appears in `WalkAncestors<typeof Customer>`.

**3. Node-to-schema resolution (valid sources and targets)**

```typescript
type ValidNodesForEndpoint<S extends Schema, Endpoint extends EdgeEndpointConfig> = {
  [K in keyof S['nodes']]: IsCompatible<S['nodes'][K], Endpoint['types']> extends true
    ? S['nodes'][K] : never
}[keyof S['nodes']]
```

Given an edge endpoint config, this produces the union of all concrete nodes in the schema that are compatible (directly or through ancestors). Used for both source and target sides.

**4. Bidirectional edge traversal methods on node instances**

Edge traversal is bidirectional. The `as` names of each endpoint provide the natural method names: when traversing an edge, the method is named after the **opposite** endpoint's `as`.

```typescript
// Outbound: current node matches 'from' endpoint → method named after to.as
type OutboundEdgeMethods<S extends Schema, CurrentNode> = {
  [E in keyof S['edges'] as
    IsCompatible<CurrentNode, S['edges'][E]['from']['types']> extends true
      ? S['edges'][E]['to']['as'] : never
  ]: DirectionalReturn<S, S['edges'][E], 'from'>
}

// Inbound: current node matches 'to' endpoint → method named after from.as
type InboundEdgeMethods<S extends Schema, CurrentNode> = {
  [E in keyof S['edges'] as
    IsCompatible<CurrentNode, S['edges'][E]['to']['types']> extends true
      ? S['edges'][E]['from']['as'] : never
  ]: DirectionalReturn<S, S['edges'][E], 'to'>
}

type EdgeMethods<S extends Schema, CurrentNode> =
  OutboundEdgeMethods<S, CurrentNode> & InboundEdgeMethods<S, CurrentNode>
```

The cardinality of the **current node's own endpoint** determines the return shape — it tells you "how many edges can this node have for this edge type":

```typescript
type DirectionalReturn<
  S extends Schema,
  Edge extends EdgeDef,
  MySide extends 'from' | 'to',
> =
  CardinalityOf<Edge, MySide> extends '1'    ? () => Promise<ValidNodesForEndpoint<S, OppositeSide<Edge, MySide>>>
  : CardinalityOf<Edge, MySide> extends '0..1' ? () => Promise<ValidNodesForEndpoint<S, OppositeSide<Edge, MySide>> | null>
  : () => Promise<ValidNodesForEndpoint<S, OppositeSide<Edge, MySide>>[]>

type CardinalityOf<Edge extends EdgeDef, Side extends 'from' | 'to'> =
  Edge[Side]['cardinality'] extends string ? Edge[Side]['cardinality'] : '0..*'
```

**Example:** `placedOrder` edge with `from: { as: 'customer', types: [Customer] }`, `to: { as: 'order', types: [Order], cardinality: '1' }`:

- On Customer (matches `from`): method `customer.order()` — `from` cardinality undefined → `Order[]`
- On Order (matches `to`): method `order.customer()` — `to` cardinality `'1'` → `Customer` (non-null)

**Example:** `hasParent` edge with `from: { as: 'child', types: [Node], cardinality: '0..1' }`, `to: { as: 'parent', types: [Node] }`:

- On a child node: method `node.parent()` — `from` cardinality `'0..1'` → `Node | null`
- On a parent node: method `node.child()` — `to` cardinality undefined → `Node[]`

**5. Strict `link()` / `unlink()`**

```typescript
type StrictLink<S extends Schema> = <E extends keyof S['edges'] & string>(
  from: NodeInstance<ValidNodesForEndpoint<S, S['edges'][E]['from']>>,
  edge: E,
  to:   NodeInstance<ValidNodesForEndpoint<S, S['edges'][E]['to']>>,
  data?: S['edges'][E]['config']['props'] extends PropShape
    ? Partial<InferProps<S['edges'][E]['config']['props']>> : never
) => Promise<void>
```

Both `from` and `to` are constrained to the union of nodes compatible with the edge's declared endpoints. TypeScript infers `E` from the string literal, then narrows `from` and `to` accordingly. If the edge has props (e.g. `orderItem` has `quantity`), the optional `data` parameter is typed to match.

**Summary:** traversal is bidirectional using `as` names, only valid edges appear per direction, cardinality of the current node's endpoint drives the return shape, edge props are typed on `link`/`unlink` — all derived from the schema with zero codegen.

## Type error readability

TypeScript's structural type system expands deep conditional types into unreadable dumps in error messages. Three techniques mitigate this, composing to produce errors that read like documentation rather than structural noise.

**1. Schema-injected names (zero DX cost)**

`defineSchema({ Customer: node(...), Order: node(...) })` already has human-readable keys. The `Schema` type carries these as a name-to-def mapping. All downstream utilities (`createClient`, `link`, `defineMethods`) operate on `Schema`, so they can reverse-map any def to its name:

```typescript
type DefName<S extends Schema, D> = {
  [K in keyof S['defs'] & string]: S['defs'][K] extends D ? K : never
}[keyof S['defs'] & string]
// DefName<EcommerceSchema, typeof Customer> = 'Customer'

type JoinDefNames<S extends Schema, Types extends readonly any[]> =
  Types extends readonly [infer H, ...infer T]
    ? T extends readonly [] ? DefName<S, H>
    : `${DefName<S, H>} | ${JoinDefNames<S, T>}`
    : never
// JoinDefNames<S, readonly [typeof Customer, typeof Admin]> = 'Customer | Admin'
```

This works because each NodeDef has a unique config type (different props/methods/implements), so the reverse lookup resolves unambiguously. No name duplication required — the variable name already appears as the record key in `defineSchema()`.

**2. Template literal error messages via `Invalid<Msg>` pattern**

Instead of letting TypeScript produce structural dumps when validation fails, conditional types resolve to descriptive string literal types that appear verbatim in the error output:

```typescript
type Invalid<Msg extends string> = Msg & { readonly __error: never }

type ValidSourceFor<S extends Schema, E extends keyof S['edges'] & string, F> =
  IsCompatible<F, S['edges'][E]['from']['types']> extends true
    ? F
    : Invalid<`'${DefName<S, F>}' is not a valid source for edge '${E}'. Valid: ${JoinDefNames<S, S['edges'][E]['from']['types']>}`>
```

When a developer passes the wrong node to `link()`:

```typescript
await db.link(product, 'placedOrder', order)

// WITHOUT Invalid<Msg> — structural dump:
//   Argument of type 'NodeInstance<NodeDef<{ readonly __kind: "node";
//   readonly config: { readonly implements: readonly [IfaceDef<...>, ...]; ... } }>>'
//   is not assignable to parameter of type ...

// WITH Invalid<Msg> — human-readable:
//   Argument of type '...' is not assignable to type
//   "'Product' is not a valid source for edge 'placedOrder'. Valid: Customer"
```

Applied to `StrictLink`:

```typescript
type StrictLink<S extends Schema> = <E extends keyof S['edges'] & string>(
  from: ValidSourceFor<S, E, ???> extends infer V ? V : never,
  edge: E,
  to:   ValidTargetFor<S, E, ???> extends infer V ? V : never,
) => Promise<void>
```

The same technique applies to `defineMethods` (missing method implementations), `defineCore`/`defineSeed` (wrong node type in `create()`), and edge traversals in the SDK.

**3. `interface` for all public Def types**

TypeScript preserves `interface` names in error messages but fully expands `type` aliases. All builder return types (`NodeDef`, `IfaceDef`, `EdgeDef`, `Schema`) are already interfaces — this must remain the case. The key rule: **never convert a public `interface` to a `type` alias**, even for convenience.

These three techniques compose: Schema-injected names provide the vocabulary, `Invalid<Msg>` constructs the sentence, and interfaces keep the surrounding context compact. The result is that the most common mistakes (wrong node in `link()`, wrong node in `create()`, missing method in `defineMethods()`) produce one-line error messages with the exact node and edge names involved.

**Limitation:** errors at the raw def level (before `defineSchema()` is called) don't have names, since there is no Schema to reverse-map from. This is acceptable — errors at definition time are rare and typically structural (wrong config shape), where TypeScript's default messages are adequate.

## Type scalability

There is no infinite type recursion in this design: `ref()` projects only props (via `ExtractFullProps`), never methods, so mutual node references through methods do not create cyclic types. However, the `const C` generics capture the full literal config of every def, and `MethodsImpl<S>` maps over all nodes/edges with nested conditional types (`z.infer`, `ExtractMethodParams`, `CollectIfaceProps`). This means the TS server workload grows with schema size.

`Client<S>` is present in every method's `ctx`, but TypeScript caches structural types: `Client<S>` is evaluated once for a given `S` and reused across all method contexts. For schemas with 20-30 nodes this has no measurable impact.

For the current scope (kernel + one distribution, ~20-40 nodes), this is well within safe limits. If schemas grow significantly (100+ densely connected nodes), mitigation options include:

- Splitting into sub-schemas composed at runtime but not at the type level
- Making `MethodDef` opaque in the config generic and using a separate extraction mechanism
- Using nominal types for intermediate results to short-circuit structural comparison
- Making `Client<S>` a nominal type alias that TS caches after first evaluation, preventing structural re-expansion
