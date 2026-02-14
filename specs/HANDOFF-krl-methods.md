# KRL Methods — Design Handoff

> Context for designing method declarations in the KRL language.
> The syntax, IR representation, and codegen output need to be specified.
> Challenge every assumption — `fn` is a placeholder, not a decision.

---

## Your Task

Design how **methods** (behavioral contracts) are declared on KRL classes and interfaces. The output is:

1. **KRL syntax** — how the developer writes method declarations in `.krl` files
2. **IR extension** — what `SchemaIR` looks like with methods (new types, fields)
3. **Codegen contract** — what the codegen needs to emit (TypeScript types for the SDK to consume)

You are NOT implementing the compiler changes, just specifying them.

---

## What You Need to Know

### KRL Today

KRL is a schema language for declaring graph types. The compiler pipeline is:

```
KRL source → Lexer → Parser (CST) → Lower (AST) → Resolver → Validator → Serializer → SchemaIR (JSON)
```

Current declarations:

```krl
type Email = String [format: email]                         # type alias
type Currency = String [in: ["USD", "EUR"]]                 # enum alias
interface Timestamped { created_at: Timestamp = now() }     # interface (abstract)
class Customer: Identity, Timestamped { email: Email }      # node class
class follows(follower: User, followee: User) [unique]      # edge class
extend "uri" { Identity }                                   # import
```

Class bodies contain **attributes only** — `name: Type [modifiers] = default`. No methods, no functions.

The only function-like thing today is `now()` in default values, registered as a "default function" in the prelude.

### Current IR (SchemaIR)

```typescript
interface SchemaIR {
  version: "1.0"
  meta: { generated_at: string; source_hash: string }
  extensions: Extension[]
  builtin_scalars: string[]
  type_aliases: TypeAlias[]
  classes: ClassDef[]  // ClassDef = NodeDef | EdgeDef
}

interface NodeDef {
  type: "node"
  name: string
  abstract: boolean
  implements: string[]
  attributes: IRAttribute[]
  origin?: string
}

interface EdgeDef {
  type: "edge"
  name: string
  endpoints: Endpoint[]
  attributes: IRAttribute[]
  constraints: EdgeConstraints
  origin?: string
}

interface IRAttribute {
  name: string
  type: TypeRef
  nullable: boolean
  default: ValueNode | null
  value_constraints?: ValueConstraints | null
  modifiers: AttributeModifiers
}

type TypeRef =
  | { kind: 'Scalar'; name: string }
  | { kind: 'Node'; name: string }
  | { kind: 'AnyEdge' }
  // ... other variants
```

### What the SDK Expects

The SDK specs (`typegraph/specs/01-client-sdk.md`) assume methods will produce:

**From the codegen:**
- Method interface per type: `interface CustomerMethods { displayName(): string | Promise<string>; ... }`
- Inherited method interfaces: `interface TimestampedMethods { age(): number | Promise<number> }`
- `SchemaMethodMap`: maps type name → method interface
- Method handler types: `MethodContext<N, Args>` with `{ self, args, graph }`
- Method metadata in `schema` const:
  ```typescript
  schema.methods = {
    Customer: {
      displayName: { params: {}, returns: 'String' },
      canPurchase: { params: { product: { type: 'Product' } }, returns: 'Boolean' },
    },
  }
  ```

**From the IR:**
- Something like `MethodDef[]` on `NodeDef` with name, params, return type
- The codegen reads this and emits the TypeScript types above

**At runtime, the developer provides implementations:**
```typescript
const graph = await createGraph({
  methods: {
    Customer: {
      displayName: ({ self }) => self.name,
      canPurchase: async ({ self, args, graph }) => args.product.in_stock,
    },
  },
})
```

So methods are **contracts only in KRL** — no body, just signature. The body is TypeScript provided by the developer.

### What the Kernel Already Has

The kernel has an **operation system** that could be the backbone for methods:

- Operations have a full lifecycle: authenticate → authorize → resolve → invariants → execute → rollback → effects
- Operations are typed with Zod schemas (params + result)
- Operations can be dynamically registered at runtime
- Each class method could map to a type-scoped operation

This means methods aren't just "call a function" — they can carry authorization, validation, and lifecycle semantics if we design it right.

---

## Design Questions to Answer

### 1. Syntax

The placeholder uses `fn`:
```krl
class Customer {
  email: Email,
  fn displayName(): String
  fn canPurchase(product: Product): Boolean
}
```

But consider:
- Should it be a keyword at all, or a different syntax? (e.g., `displayName(): String` without a keyword — method vs attribute disambiguated by `()`)
- Should methods on edges be supported? (`class follows(...) { fn mutualFriends(): Int }`)
- Should there be modifiers? (e.g., `[readonly]` methods that don't mutate) or is that superfluous ?
- Should return type be mandatory or inferable? Probably mandatory
- How do array return types work? `Order[]`? `[Order]`?
- Can methods accept graph types as params? (`product: Product` means the caller passes a Product node)
- What about optional params with defaults? (`limit: Int = 10`)
- Can method params have the same constraint syntax as attributes? (`limit: Int [range: 1..100]`)
- How to define return types that are not class/interfaces? Should we allow object types definitions ?

### 2. Abstract vs Concrete

- Interface methods are always abstract (no body in KRL, implementation required in TS)
- Class methods are also abstract (no body in KRL) — but should there be a way to mark some as optional to implement (with a default behavior)?
- What about `override` semantics? If `Timestamped` declares `fn age(): Int` and `Customer` also declares `fn age(): Int`, is that an override, a redeclaration, or an error?

### 3. Relationship to Kernel Operations

- Should methods have lifecycle hooks declarable in KRL? (e.g., `fn cancel(): Boolean [authorized, audited]`)
- Should methods be callable across the network (RPC-like) or only local? Probably both, but how to do both ?
- Should methods participate in the authorization model? (e.g., calling `customer.cancel()` checks if the caller has permission on that customer node) Yes probably. actually to define a method, you need to "bind" an operation that is already defined (with the full pipeline)

### 4. Edge Methods

- Should edges have methods? E.g., `class membership(user: User, org: Org) { fn promote(): Boolean }`
- If yes, how does the context work? (an edge method has access to both endpoint nodes)

### 5. IR Representation

Strawman:
```typescript
interface MethodDef {
  name: string
  params: MethodParam[]
  return_type: TypeRef
  modifiers?: MethodModifiers  // if we add method-level modifiers
}

interface MethodParam {
  name: string
  type: TypeRef
  default: ValueNode | null
  constraints?: ValueConstraints | null  // if we allow param constraints
}
```

But this might be too simple. Think about what the IR needs to capture for the codegen to emit the right TypeScript.

---

## Key Files

| File | What |
|------|------|
| `typegraph/compiler/src/ir/types.ts` | Current IR types (SchemaIR, ClassDef, NodeDef, etc.) |
| `typegraph/compiler/src/tokens.ts` | Lexer tokens / contextual keywords |
| `typegraph/compiler/src/parser/` | Parser grammar |
| `typegraph/compiler/src/lower/` | CST → AST lowering |
| `typegraph/compiler/src/validator/` | Validation rules |
| `typegraph/compiler/src/kernel-prelude.ts` | Kernel prelude (scalars, `now()`, kernel types) |
| `typegraph/codegen/src/emit/core.ts` | Core DSL emitter (reference for how codegen emits typed helpers) |
| `typegraph/specs/01-client-sdk.md` | SDK spec — shows what the codegen output is consumed for |
| `typegraph/specs/02-schema-runtime.md` | Runtime spec — shows method validation and enrichment |

---

## Output Format

Produce a spec file at `typegraph/specs/03-krl-methods.md` covering:

1. **Syntax** — concrete KRL examples with justification
2. **IR types** — exact TypeScript type definitions for the IR extension
3. **Codegen contract** — what the codegen must emit (types, schema metadata)
4. **Compiler pipeline impact** — which phases need changes (lexer, parser, lower, resolver, validator, serializer)
5. **Edge cases** — override semantics, diamond inheritance with methods, edge methods, empty method lists

Keep it tight — no fluff. Show the syntax, show the types, justify the decisions.
