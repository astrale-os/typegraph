# Kernel Schema Compiler — Architecture Spec v3

## Changelog from v2
- **Removed**: `scalar` keyword and `ScalarType` from grammar and IR. Primitives are compiler builtins.
- **Removed**: `class Scalar: Node {}` from the prelude. Scalars are not nodes in the graph.
- **Added**: `builtin_scalars` string array in IR root (documentation/codegen only).
- **Changed**: Bootstrapping sequence — builtins are injected into the primal scope *before* `kernel.krl` is parsed, not declared within it.

## Deliverables

| File | Purpose |
|---|---|
| `grammar-v3.ebnf` | Formal grammar. 4 declaration types: type_alias, interface, class, extend. |
| `ir-schema-v3.json` | JSON Schema for compiler output. The contract. |
| `ir-example-v3.json` | Blog schema fully serialized. |
| `kernel-v3.krl` | Kernel prelude. Pure graph structure. |

## Bootstrapping Sequence

```
0. Inject builtin scalars into empty scope
   → { String, Int, Float, Boolean, Timestamp, Bitmask, ByteString }

1. Lex + Parse  kernel-v3.krl  → Kernel CST
2. Lower                        → Kernel AST
3. Resolve (builtin scope)     → Kernel Resolved Schema (primal scope)
4. Validate                     → Kernel Validated Schema

5. Lex + Parse  user.krl       → User CST
6. Lower                        → User AST
7. Resolve (primal scope)      → User Resolved Schema
8. Validate                     → User Validated Schema
9. Serialize                    → IR JSON
```

Step 0 is the only place where the compiler has "magic" knowledge. Everything after that is derived from source.

When `kernel.krl` references `Bitmask` in `has_perm`, it resolves against the builtins injected in step 0. When user code references `String`, same mechanism.

## Key Design Decisions

### Why builtins, not `scalar` declarations

Scalars are fundamentally different from graph types. They have no attributes, no edges, no inheritance. A `scalar String` declaration in the DSL would be ceremonial — it can't express what matters about `String` (storage semantics, comparison behavior, serialization). The compiler needs internal knowledge of these types regardless. Declaring them in the grammar adds a production that does nothing the compiler doesn't already know.

The `builtin_scalars` field in the IR lists them for consumers who need the full type namespace (SDK codegen, documentation tools).

### Structured defaults (ValueNode)

Defaults are discriminated unions, not strings:

| Kind | Example |
|---|---|
| `StringLiteral` | `{ "kind": "StringLiteral", "value": "draft" }` |
| `NumberLiteral` | `{ "kind": "NumberLiteral", "value": 0 }` |
| `BooleanLiteral` | `{ "kind": "BooleanLiteral", "value": true }` |
| `Null` | `{ "kind": "Null" }` |
| `Call` | `{ "kind": "Call", "fn": "now", "args": [] }` |

No consumer ever parses a string to determine what a default means.

### Discriminated TypeRef

Every type reference carries a `kind` tag:

| Kind | Resolves to |
|---|---|
| `Scalar` | A builtin primitive |
| `Node` | A class or interface |
| `Alias` | A type alias (follow through `type_aliases`) |
| `Edge` | An edge class (for `edge<Name>`) |
| `AnyEdge` | The `edge<any>` wildcard |
| `Union` | Array of TypeRef (for `Post \| Comment`) |

### Named endpoints (not source/target)

Edges use ordered arrays of named endpoints. Rationale:
1. Preserves parameter names from the DSL
2. Per-endpoint cardinality
3. N-ary extensibility

### Typed edge constraints (not bag-of-strings)

Each constraint is a typed field. New constraints get new fields. The schema is versioned.

## Open Questions

1. **Error recovery sync tokens**: `class`, `interface`, `type`, `extend`, `}`. Validate during implementation.
2. **Extension resolution**: stub for v1. Compiler accepts a map of URI → pre-parsed IR.
3. **CST node interfaces**: follow mechanically from grammar. Write before coding parser.
4. **Attribute inheritance materialization**: defer unless consumers request it.