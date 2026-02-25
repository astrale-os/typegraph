# Spec 03: KRL Methods

> Method declarations in the KRL language — syntax, IR representation, and codegen contract.
> Methods are behavioral contracts: KRL declares the signature, TypeScript provides the body.

---

## 1. Syntax

### 1.1 Decision: `fn` Keyword

Methods use the `fn` keyword.

```krl
class Customer: Identity, Timestamped {
  email: Email [unique],
  name: String,
  phone: String?,

  fn displayName(): String
  fn canPurchase(product: Product): Boolean
  fn recentOrders(limit: Int = 10): Order[]
}
```

**Why `fn`:**
- Visual separation between data (attributes) and behavior (methods) in the same body
- 1-token lookahead for the parser: `Ident("fn")` → method, `Ident Colon` → attribute
- Common across languages (Rust, Swift `func`, Kotlin `fun`) — instantly readable
- Consistent with prior spec references (01-client-sdk.md, 00-overview.md)

**Rejected: no keyword** (`displayName(): String`). Workable with 2-token lookahead (`Ident LParen`), but loses visual scanning ability. In a body mixing 10 attributes and 3 methods, `fn` makes methods immediately findable.

### 1.2 Grammar

```ebnf
body         = '{' member* '}'
member       = attribute | method

attribute    = IDENT ':' type_expr modifier_list? default_value? ','?
method       = 'fn' IDENT '(' param_list? ')' ':' return_type

param_list   = method_param (',' method_param)* ','?
method_param = IDENT ':' type_expr default_value?

return_type  = type_expr ( '[]' | '?' )?
```

Parser disambiguation in `parseBody()`:
- `Ident("fn") Ident LParen` → `parseMethod()`
- `Ident Colon` → `parseAttribute()`

Return type suffix is mutually exclusive: `Type[]` (list) **or** `Type?` (nullable), never both. A method always returns something — empty list over null.

### 1.3 Full Example

```krl
extend "https://kernel.astrale.ai/v1" { Identity }

type Email = String [format: email]
type OrderStatus = String [in: ["pending", "confirmed", "shipped", "delivered"]]

interface Timestamped {
  created_at: Timestamp = now(),
  updated_at: Timestamp?,

  fn age(): Int
}

class Customer: Identity, Timestamped {
  email: Email [unique],
  name: String,
  phone: String?,

  fn displayName(): String
  fn canPurchase(product: Product): Boolean
  fn recentOrders(limit: Int = 10): Order[]
}

class Product: Timestamped {
  title: String,
  sku: String [unique],
  price_cents: Int,
  in_stock: Boolean = true,

  fn formattedPrice(currency: String = "USD"): String
}

class Order: Timestamped {
  status: OrderStatus = "pending",
  total_cents: Int,

  fn cancel(): Boolean
  fn summary(): String
}

class membership(user: Customer, org: Organization) {
  role: String,

  fn promote(): Boolean
}
```

### 1.4 Syntax Rules

| Rule | Example | Notes |
|------|---------|-------|
| Return type mandatory | `fn age(): Int` | KRL is a contract language — no inference |
| List return | `fn orders(): Order[]` | `[]` suffix on type |
| Nullable return | `fn parent(): Customer?` | `?` suffix on type |
| No `[]` + `?` combo | — | Pick one. Return empty list, not null |
| Params comma-separated | `fn search(q: String, limit: Int)` | Trailing comma allowed |
| Default params | `fn list(limit: Int = 10)` | Same syntax as attribute defaults |
| Graph type params | `fn canBuy(product: Product)` | Caller passes a node reference |
| No method body | — | Contract only. Body is TypeScript |
| No method modifiers (v1) | — | Grammar slot exists for future `[authorized]` etc. |
| No comma after method | `fn age(): Int` | Methods are newline-separated, not comma-separated |
| Interleaving allowed | See §1.3 | Convention: attributes first, then methods |

---

## 2. IR Types

### 2.1 TypeRef Extension

Add `List` variant to `TypeRef`:

```typescript
export type TypeRef =
  | { kind: "Scalar"; name: string }
  | { kind: "Node"; name: string }
  | { kind: "Alias"; name: string }
  | { kind: "Edge"; name: string }
  | { kind: "AnyEdge" }
  | { kind: "Union"; types: TypeRef[] }
  | { kind: "List"; element: TypeRef }   // NEW
```

Only used in method return types for now. Positions us for list attributes later without IR changes.

### 2.2 Method IR Types

```typescript
export interface MethodDef {
  name: string
  params: MethodParam[]
  return_type: TypeRef
  return_nullable: boolean
}

export interface MethodParam {
  name: string
  type: TypeRef
  default: ValueNode | null
}
```

### 2.3 ClassDef Extension

Add `methods` field to both `NodeDef` and `EdgeDef`:

```typescript
export interface NodeDef {
  type: "node"
  name: string
  abstract: boolean
  implements: string[]
  attributes: IRAttribute[]
  methods: MethodDef[]            // NEW
  origin?: string
}

export interface EdgeDef {
  type: "edge"
  name: string
  endpoints: Endpoint[]
  attributes: IRAttribute[]
  methods: MethodDef[]            // NEW
  constraints: EdgeConstraints
  origin?: string
}
```

Types without methods get `methods: []`.

### 2.4 IR Examples

`fn displayName(): String`:
```json
{
  "name": "displayName",
  "params": [],
  "return_type": { "kind": "Scalar", "name": "String" },
  "return_nullable": false
}
```

`fn recentOrders(limit: Int = 10): Order[]`:
```json
{
  "name": "recentOrders",
  "params": [
    { "name": "limit", "type": { "kind": "Scalar", "name": "Int" }, "default": { "kind": "NumberLiteral", "value": 10 } }
  ],
  "return_type": { "kind": "List", "element": { "kind": "Node", "name": "Order" } },
  "return_nullable": false
}
```

`fn parent(): Customer?`:
```json
{
  "name": "parent",
  "params": [],
  "return_type": { "kind": "Node", "name": "Customer" },
  "return_nullable": true
}
```

---

## 3. Codegen Contract

The codegen reads `MethodDef[]` from the IR and emits 5 things.

### 3.1 Method Interfaces

One per type that declares methods (including abstract types):

```typescript
// Interface methods
export interface TimestampedMethods {
  age(): number | Promise<number>
}

// Node methods (own + inherited combined in MethodsConfig, not here)
export interface CustomerMethods {
  displayName(): string | Promise<string>
  canPurchase(args: { product: Product }): boolean | Promise<boolean>
  recentOrders(args?: { limit?: number }): Order[] | Promise<Order[]>
}

// Edge methods
export interface MembershipMethods {
  promote(): boolean | Promise<boolean>
}
```

**Type mapping for return types:**

| IR TypeRef | TypeScript |
|-----------|------------|
| `Scalar('String')` | `string` |
| `Scalar('Int')` / `Scalar('Float')` | `number` |
| `Scalar('Boolean')` | `boolean` |
| `Scalar('Timestamp')` | `string` |
| `Node('Customer')` | `Customer` |
| `Alias('Email')` | `Email` |
| `List(Node('Order'))` | `Order[]` |
| Any + `return_nullable: true` | `T \| null` |

**Parameter rules:**
- 0 params → no `args` parameter
- 1+ params, all required → `args: { name: Type, ... }`
- 1+ params, some have defaults → `args?: { name?: Type, ... }` (entire args object optional if all params have defaults; individual params optional if they have defaults)

Return type is always `T | Promise<T>` — allows both sync and async implementations.

### 3.2 Method Context

```typescript
export interface MethodContext<Self, Args = void> {
  self: Self & { readonly id: string; readonly __type: string }
  args: Args extends void ? undefined : Args
  graph: Graph<typeof schema>
}
```

For edge methods, `self` includes endpoint IDs:
```typescript
export interface EdgeMethodContext<Payload, Args = void> {
  self: Payload & { readonly endpoints: Record<string, string> }
  args: Args extends void ? undefined : Args
  graph: Graph<typeof schema>
}
```

### 3.3 MethodsConfig

Per-schema type for `createGraph({ methods })`. Every concrete class must provide all methods (own + inherited):

```typescript
export type MethodsConfig = {
  Customer: {
    displayName: (ctx: MethodContext<Customer>) => string | Promise<string>
    canPurchase: (ctx: MethodContext<Customer, { product: Product }>) => boolean | Promise<boolean>
    recentOrders: (ctx: MethodContext<Customer, { limit?: number }>) => Order[] | Promise<Order[]>
    age: (ctx: MethodContext<Customer>) => number | Promise<number>   // inherited from Timestamped
  }
  Product: {
    formattedPrice: (ctx: MethodContext<Product, { currency?: string }>) => string | Promise<string>
    age: (ctx: MethodContext<Product>) => number | Promise<number>
  }
  Order: {
    cancel: (ctx: MethodContext<Order>) => boolean | Promise<boolean>
    summary: (ctx: MethodContext<Order>) => string | Promise<string>
    age: (ctx: MethodContext<Order>) => number | Promise<number>
  }
}
```

Abstract types (interfaces) are excluded — they have no instances to bind methods to. Their method contracts are enforced through concrete implementors.

### 3.4 Schema Metadata

Extend the `schema` const with method metadata:

```typescript
export const schema = {
  // ... existing: scalars, nodes, edges ...
  methods: {
    Timestamped: {
      age: { params: {}, returns: 'Int' },
    },
    Customer: {
      displayName: { params: {}, returns: 'String' },
      canPurchase: {
        params: { product: { type: 'Product' } },
        returns: 'Boolean',
      },
      recentOrders: {
        params: { limit: { type: 'Int', default: 10 } },
        returns: 'Order[]',
      },
    },
    Product: {
      formattedPrice: {
        params: { currency: { type: 'String', default: 'USD' } },
        returns: 'String',
      },
    },
    Order: {
      cancel: { params: {}, returns: 'Boolean' },
      summary: { params: {}, returns: 'String' },
    },
  },
} as const
```

The runtime uses this for:
- Startup validation (all required methods implemented)
- Default argument injection
- `graph.call()` argument validation

### 3.5 Enriched Node Types

Method interfaces merge into enriched node types:

```typescript
export type CustomerNode = Customer & {
  readonly id: string
  readonly __type: 'Customer'
} & CustomerMethods & TimestampedMethods
```

The codegen emits a `SchemaNodeTypeMap` that maps type names to enriched types:

```typescript
export interface SchemaNodeTypeMap {
  Customer: CustomerNode
  Product: ProductNode
  Order: OrderNode
}
```

---

## 4. Compiler Pipeline Impact

### 4.1 Lexer

**No changes.** `fn` is an `Ident` token, recognized contextually by the parser (same as `class`, `type`, `interface`).

Add `"fn"` to `CONTEXTUAL_KEYWORDS` for documentation:

```typescript
export const CONTEXTUAL_KEYWORDS = [
  // Declaration keywords
  "type", "interface", "class", "extend",
  "fn",                                     // NEW
  // ... rest unchanged
] as const
```

### 4.2 Parser

**New CST nodes:**

```typescript
interface MethodNode extends CstNode {
  kind: 'Method'
  fnKeyword: Token
  name: Token
  lparen: Token
  params: MethodParamNode[]
  rparen: Token
  colon: Token
  returnType: TypeExprNode
  listSuffix: { lbracket: Token; rbracket: Token } | null
  nullable: Token | null
}

interface MethodParamNode extends CstNode {
  kind: 'MethodParam'
  name: Token
  colon: Token
  typeExpr: TypeExprNode
  defaultValue: DefaultValueNode | null
}
```

**Extend `BodyNode`:**

```typescript
interface BodyNode extends CstNode {
  kind: 'Body'
  lbrace: Token
  attributes: AttributeNode[]
  methods: MethodNode[]       // NEW
  rbrace: Token
}
```

**`parseBody()` change:**

```
In the member loop:
  if isKeyword(current, 'fn') && peek(1).kind === 'Ident' && peek(2).kind === 'LParen':
    parseMethod() → push to methods[]
  else if current.kind === 'Ident' && peek(1).kind === 'Colon':
    parseAttribute() → push to attributes[]
  else:
    error "expected attribute or method declaration"
```

**`parseMethod()`:** consume `fn` → name → `(` → params → `)` → `:` → type_expr → optional `[]` or `?`

**`parseMethodParam()`:** consume name → `:` → type_expr → optional `= default`

### 4.3 Lowering (CST → AST)

**New AST nodes:**

```typescript
interface Method extends AstNode {
  kind: 'Method'
  name: Name
  params: MethodParam[]
  returnType: TypeExpr
  returnList: boolean
  returnNullable: boolean
  span: Span
}

interface MethodParam extends AstNode {
  kind: 'MethodParam'
  name: Name
  type: TypeExpr
  defaultValue: Expression | null
  span: Span
}
```

**Extend `NodeDecl` and `EdgeDecl`:**

```typescript
interface NodeDecl extends AstNode {
  kind: "NodeDecl"
  name: Name
  implements: Name[]
  modifiers: Modifier[]
  attributes: Attribute[]
  methods: Method[]          // NEW
  span: Span
}

interface EdgeDecl extends AstNode {
  kind: "EdgeDecl"
  name: Name
  params: Param[]
  implements: Name[]
  modifiers: Modifier[]
  attributes: Attribute[]
  methods: Method[]          // NEW
  span: Span
}
```

**`lowerMethod()`:** strip tokens, lower type expressions, extract boolean flags for list/nullable.

### 4.4 Resolver

- Resolve method param types (same as attribute type resolution)
- Resolve method return types (same, plus handle list wrapper)
- No new scope rules — methods don't introduce bindings (no body)

### 4.5 Validator

New validations:

| Rule | Error |
|------|-------|
| Return type must resolve to a known type | `unknown type 'Foo' in return type of method 'bar'` |
| Param type must resolve to a known type | `unknown type 'Foo' in parameter 'x' of method 'bar'` |
| No duplicate method names on same type | `duplicate method 'age' on type 'Customer'` |
| Override signature must match | `method 'age' on 'Customer' has incompatible return type (expected 'Int', got 'String')` |
| Diamond conflict: identical signatures required | `conflicting method 'age' inherited from 'A' and 'B' with different signatures` |
| Default value type matches param type | `default value 'hello' is not assignable to type 'Int'` |
| Param names unique within method | `duplicate parameter 'x' in method 'search'` |

### 4.6 Serializer

Emit `methods: MethodDef[]` on every `NodeDef` and `EdgeDef`. Types with no methods emit `methods: []`.

---

## 5. Edge Cases

### 5.1 Override Semantics

A class implementing an interface inherits its method contracts. The class can **redeclare** a method with an identical signature (explicit override). Different signature → error.

```krl
interface Timestamped {
  fn age(): Int
}

class Customer: Timestamped {
  fn age(): Int              # OK — explicit override, same signature
}
```

```krl
class Customer: Timestamped {
  fn age(): String           # ERROR — incompatible return type
}
```

No redeclaration needed — the method is inherited automatically. Redeclaration is opt-in for documentation clarity.

### 5.2 Diamond Inheritance

If a class implements two interfaces that declare the same method, the signatures must be identical. Otherwise → validator error.

```krl
interface A { fn id(): String }
interface B { fn id(): String }
class C: A, B { }              # OK — same signature, single method
```

```krl
interface A { fn id(): String }
interface B { fn id(): Int }
class C: A, B { }              # ERROR — conflicting signatures for 'id'
```

The IR emits one `MethodDef` for `id`, not two. The validator resolves the diamond before serialization.

### 5.3 Edge Methods

Edge methods work like node methods. The context differs — `self` has the edge payload + endpoint IDs.

```krl
class membership(user: Customer, org: Organization) {
  role: String,
  fn promote(): Boolean
}
```

Runtime implementation:
```typescript
methods: {
  membership: {
    promote: async ({ self, graph }) => {
      if (self.role === 'admin') return false
      // self.endpoints.user, self.endpoints.org available
      return true
    },
  },
}
```

The codegen emits `MembershipMethods` interface and includes `membership` in `MethodsConfig` alongside node types.

### 5.4 Empty Method Lists

Types with no methods:
- IR: `methods: []`
- Codegen: no `*Methods` interface emitted, not in `MethodsConfig`
- Enriched nodes: just `{ id, __type, ...props }` — no proxy overhead

### 5.5 Methods on Extended Types

Types imported via `extend` carry their own method contracts from their origin. Developers cannot add methods to imported types. To add behavior to a kernel type, wrap it:

```krl
extend "https://kernel.astrale.ai/v1" { Identity }

class User: Identity {
  fn displayName(): String    # method on User, not on Identity
}
```

### 5.6 Abstract Classes as Method Sources

Interface method inheritance chains recurse. If interface `B: A` and `A` declares `fn x(): Int`, then any class implementing `B` must provide `x()`.

```krl
interface A { fn x(): Int }
interface B: A { fn y(): String }
class C: B { }
# C requires both x() and y()
```

### 5.7 Methods With No Parameters

Common case. Codegen emits no `args` parameter:

```krl
fn displayName(): String
```

```typescript
// Method interface
displayName(): string | Promise<string>

// Handler
displayName: ({ self }) => self.name
```

### 5.8 All Parameters Have Defaults

When every param has a default, the `args` object is fully optional:

```krl
fn list(limit: Int = 10, offset: Int = 0): Order[]
```

```typescript
// Method interface
list(args?: { limit?: number; offset?: number }): Order[] | Promise<Order[]>

// Handler — args may be undefined
list: ({ self, args }) => { /* args?.limit ?? defaults applied by runtime */ }
```

---

## 6. Codegen — GraphModel Extension

The loader creates `ResolvedNode` / `ResolvedEdge` from the IR. Extend with methods:

```typescript
export interface ResolvedNode {
  name: string
  abstract: boolean
  implements: string[]
  ownAttributes: IRAttribute[]
  allAttributes: IRAttribute[]
  ownMethods: MethodDef[]        // NEW — declared on this type
  allMethods: MethodDef[]        // NEW — own + inherited (flattened, deduped)
  origin?: string
}

export interface ResolvedEdge {
  name: string
  endpoints: Endpoint[]
  ownAttributes: IRAttribute[]
  allAttributes: IRAttribute[]
  ownMethods: MethodDef[]        // NEW
  allMethods: MethodDef[]        // NEW (edges don't inherit, so own === all)
  constraints: EdgeConstraints
  origin?: string
}
```

The loader resolves `allMethods` by walking the `implements` chain and merging, same as `allAttributes`. Diamond duplicates resolved by the compiler validator (identical signatures guaranteed).

---

## 7. New Codegen Emitter: `emit/methods.ts`

New emitter in the codegen pipeline, runs after interfaces and before schema-value:

```
enums → scalars → interfaces → methods → validators → schema-value → schema-types → core
```

Responsibilities:
1. Emit `*Methods` interface per type with methods
2. Emit `MethodContext` / `EdgeMethodContext` generic types
3. Emit `MethodsConfig` type (concrete types only, own + inherited methods)
4. Emit `SchemaMethodMap` mapping type names → method interfaces

The schema-value emitter is extended to include the `methods` section in the `schema` const.

---

## 8. Summary

| Aspect | Decision |
|--------|----------|
| **Keyword** | `fn` — visual separation, 1-token lookahead |
| **Return type** | Mandatory. Suffix: `[]` for list, `?` for nullable, mutually exclusive |
| **Parameters** | Comma-separated, support defaults, graph types allowed |
| **Body** | Never. KRL is contract-only. Implementation is TypeScript |
| **Edge methods** | Supported. Context includes endpoint IDs |
| **Modifiers** | None for v1. Grammar slot reserved |
| **Override** | Implicit inheritance. Redeclaration allowed with identical signature |
| **Diamond** | Same signature required. Validator catches conflicts |
| **IR** | `MethodDef[]` on both `NodeDef` and `EdgeDef`. `List` added to `TypeRef` |
| **Codegen** | 5 outputs: method interfaces, context type, config type, schema metadata, enriched nodes |
| **Pipeline** | Lexer unchanged, parser+lower+resolver+validator+serializer all extended |
