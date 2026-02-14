# Typegraph Specs — Overview

> Top-down design specs for the Client SDK and Schema Runtime.
> Clean-slate design — no backward compatibility with legacy typegraph.
> Written: 2026-02-14. Branch: `feat/authorization-v2`.

---

## End-to-End Flow

```
KRL source (schema + method contracts)
  ↓  compile()
SchemaIR (JSON) — includes method declarations
  ↓  generate()
Generated TypeScript (single file)
  • types, validators, method types, schema const, core DSL, createGraph()
  ↓  developer imports
Developer code
  • defineCore() — genesis instances
  • implement methods — runtime logic for KRL method contracts
  • createGraph() — install, wire, get typed client
  ↓
Graph client (fully typed)
  • query (with interface/polymorphic support)
  • mutations (create, update, delete, link, unlink)
  • method invocation (on enriched node/edge instances)
  • transactions
```

---

## Package Structure

```
@astrale/typegraph              — Client SDK + Schema Runtime
@astrale/typegraph-codegen      — IR → TypeScript (done, 105 tests)
@astrale/kernel-compiler        — KRL → IR (done)
@astrale/typegraph-adapter-*    — Storage adapters (memgraph, falkordb, memory)
```

Single developer-facing package. Codegen emits a pre-typed `createGraph()` factory — zero generic plumbing.

---

## What the Codegen Emits

Single `.ts` file with these sections:

| # | Section | What |
|---|---------|------|
| 1 | Enums | `const CurrencyValues = [...] as const; type Currency = ...` |
| 2 | Type Aliases | `type Email = string` |
| 3 | Node Interfaces | `interface Customer { ... }` (data shape, no methods) |
| 4 | Edge Payloads | `interface OrderItemPayload { ... }` |
| 5 | Validators | Zod schemas — one per node/edge/alias |
| 6 | Method Types | `*Methods` interfaces, `MethodContext`, `EdgeMethodContext`, `MethodsConfig`, `SchemaMethodMap` |
| 7 | Schema Value | `schema` const — topology + method metadata |
| 8 | Schema Types | `SchemaNodeType`, `SchemaEdgeType`, `SchemaType` |
| 9 | Node Map | `SchemaNodeMap` — maps type name → interface |
| 10 | Core DSL | `defineCore`, `node`, `edge`, `Refs` |
| 11 | Graph Factory | `createGraph()` — pre-typed, bound to this schema |

---

## Key Design Decisions

1. **Methods are first-class** — KRL declares method contracts (`fn name(args): Return`), codegen emits typed signatures, developer provides implementations, SDK wires them to enriched node/edge instances. Full spec: [03-krl-methods.md](./03-krl-methods.md)
2. **Edge methods** — edges can declare methods too; context includes endpoint IDs
3. **Enriched nodes** — query results are not plain objects; they carry `id`, `__type` discriminant, and bound method proxies
4. **Interface queries** — `graph.node('Timestamped')` returns a union of all concrete types implementing the interface, discriminated by `__type`
5. **Clean slate** — no backward compat with legacy typegraph; no deprecation warnings; fail fast on schema mismatch
6. **Kernel operations as method backbone** — each class method maps to a type-scoped operation with full lifecycle (auth, validation, execution)
7. **Schema is strict** — `createGraph` fails if schema changed incompatibly; no silent reconciliation
8. **Migration system** — schema diffing, migration planning, and data transformation handled by a dedicated component ([04-migration.md](./04-migration.md))

---

## Relationship to Existing Code

| Package | Relationship |
|---------|-------------|
| `typegraph/compiler` | Produces `SchemaIR` — extended with `MethodDef[]` on `NodeDef` and `EdgeDef`, `List` variant on `TypeRef` |
| `typegraph/codegen` | Produces generated TypeScript — new `emit/methods.ts` emitter for method interfaces, `MethodsConfig`, enriched types |
| `typegraph/core` | Legacy — useful patterns (AST builder) but schema/core DSL superseded by KRL + codegen |
| `typegraph/core/v2/specs` | AST redesign — orthogonal; the query AST is the compilation target for the SDK's query builder |
| `typegraph/typegraph` | Legacy — DX inspiration (fluent builder, proxy projections, cardinality inference); code superseded |
| `kernel/runtime/operations` | Method backbone — class methods map to type-scoped operations with full lifecycle |
