# TypeGraph SDK Migration — Handoff Context

> Written 2026-02-14 after completing the core migration.
> For next Claude to resume work on `@astrale/typegraph`.

---

## 1. What Was Done

### 1.1 Dependency Elimination

The SDK (`typegraph/typegraph/`) was fully decoupled from two dependencies:

- **`@astrale/typegraph-core`** — The legacy schema DSL library (900+ lines of Zod generics, `defineSchema()`, `node()`, `edge()` builders). Completely removed. Everything needed was inlined or rewritten.
- **`zod`** — Was used for runtime validation and type inference. Removed. Validation is now deferred to codegen-generated validators.

`package.json` has **zero dependencies** now.

### 1.2 New Internal Modules Created

| Module | Purpose |
|--------|---------|
| `src/schema.ts` | `SchemaShape` interface — the universal schema type matching codegen output |
| `src/inference.ts` | Simplified type-level inference (was 980+ lines, now ~114 lines) |
| `src/helpers.ts` | Runtime helpers: `resolveNodeLabels`, `edgeFrom`, `edgeTo`, `edgeCardinality`, `isReified` |
| `src/errors.ts` | Inlined base errors: `GraphQueryError`, `CardinalityError`, `ExecutionError`, `MethodNotDispatchedError` |
| `src/ast/` | AST types + immutable builder + visitor, copied from core (schema-agnostic) |
| `src/methods.ts` | Method dispatch types and method name resolution for KRL `fn` declarations |
| `src/enrichment.ts` | Proxy-based method binding on returned nodes/edges |
| `src/constraints.ts` | Runtime constraint enforcement (unique, no_self, acyclic, cardinality) |

### 1.3 Type Simplifications

- **Killed `M extends NodeIdMap<S>`** — This 5th generic parameter was on every builder/interface to support custom ID types per node. All IDs are now `string`. Removed from 12 files, 19 occurrences.
- **Killed `AnySchema` compat alias** — Replaced with `SchemaShape` across all 33 source files.
- **Killed dead types** — `NodeIdMap`, `NodeIdFor`, `BaseNodeProps`, `BaseNodeInputProps`, `BaseEdgeProps`, `BaseEdgeInputProps`, `NodeUserProps`, `EdgeUserProps`.
- **Killed `SchemaDefinition` alias** in compiler files.
- **Killed `isDateSchema()`** — Dead Zod introspection code.

### 1.4 Schema Shape

The `SchemaShape` interface (`src/schema.ts`) is the universal schema contract. It matches what codegen emits:

```typescript
interface SchemaShape {
  readonly scalars?: readonly string[]
  readonly nodes: Record<string, SchemaNodeDef>      // { abstract, implements?, attributes? }
  readonly edges: Record<string, SchemaEdgeDef>      // { endpoints, constraints?, attributes?, reified? }
  readonly methods?: Record<string, Record<string, SchemaMethodDef>>
  readonly hierarchy?: HierarchyConfig               // { defaultEdge, direction }
  readonly reifyEdges?: boolean                       // global reification default
}
```

Key design: edges use **named endpoints** with types and optional cardinality:
```typescript
endpoints: {
  customer: { types: ['Customer'] },
  order: { types: ['Order'], cardinality: { min: 1, max: 1 } },
}
```

Helper functions abstract this: `edgeFrom(schema, edgeType)`, `edgeTo(schema, edgeType)`, `edgeCardinality(schema, edgeType)`.

### 1.5 Test Suite

**14 test files, 369 passing, 5 skipped.**

Legacy spec tests (9 files):
- `ast.spec.ts` — AST builder immutability, aliases, step generation
- `methods.spec.ts` — Method validation, enrichment, edge methods
- `mutations.spec.ts` — Mutation Cypher template generation
- `query-connected-to.spec.ts` — whereConnectedTo optimization
- `query-execution.spec.ts` — Execution with mock adapter
- `query-hierarchy.spec.ts` — Hierarchy Cypher compilation
- `query-match.spec.ts` — MATCH/WHERE compilation
- `query-projection.spec.ts` — Projection, aggregation, ordering
- `query-traversal.spec.ts` — Traversal Cypher compilation

E2E tests (5 files, using a realistic e-commerce KRL-derived schema):
- `e2e/query-basic.spec.ts` — 35 tests: match, byId, where, pagination, ordering, distinct
- `e2e/query-traversal.spec.ts` — 18 tests: forward/reverse/bidirectional, multi-hop, with filters
- `e2e/query-hierarchy.spec.ts` — 4 tests: parent, children, ancestors, descendants
- `e2e/query-return.spec.ts` — 13 tests: aliasing, return projections, collect aggregation
- `e2e/schema-resolution.spec.ts` — 34 tests: label resolution, edge endpoints, cardinality, inheritance

**5 skipped tests:**
- 3× date deserialization (stubbed — needs codegen validators)
- 1× optional parent resolution (hierarchy edge not configured for category type)
- 1× optional traversal with whereConnectedTo (not implemented)

---

## 2. Architecture Overview

```
KRL Source (.krl)
    ↓  (compiler — separate package)
SchemaIR (JSON)
    ↓  (codegen — @astrale/typegraph-codegen)
Generated TypeScript:
  - schema const (satisfies SchemaShape)
  - TypeScript types (CustomerNode, ProductPayload, etc.)
  - Zod validators
  - Method interfaces & config types
    ↓
SDK (@astrale/typegraph)
  createGraph(schema, { adapter }) → Graph<S>
    graph.node('Customer')          → CollectionBuilder
      .where('tier', 'eq', 'gold') → CollectionBuilder (filtered)
      .to('placed_order', 'Order') → CollectionBuilder (traversed)
      .compile()                    → { cypher, params }
      .execute()                    → Promise<NodeProps[]>
```

### Key internals:

1. **Query chain**: `GraphQueryImpl.node()` → `CollectionBuilder` → `.where()/.to()/.byId()` → mutates `QueryAST` → `.compile()` calls `CypherCompiler`
2. **Builder generics**: `<S extends SchemaShape, N extends NodeLabels<S>, Aliases extends AliasMap<S>, EdgeAliases extends EdgeAliasMap<S>>` — 4 params, all justified
3. **Cardinality branching**: `.to()` returns `CollectionBuilder` (many), `SingleNodeBuilder` (one), or `OptionalNodeBuilder` (optional) based on schema cardinality
4. **Label resolution**: `resolveNodeLabels()` applies `toPascalCase` and resolves inheritance chain. `Customer` → `['Customer', 'Timestamped']` → Cypher `(n0:Customer:Timestamped)`

---

## 3. KRL Syntax Reference

The KRL written in E2E test comments follows the **actual grammar** from `typegraph/compiler/grammar.ebnf`:

```krl
-- Comments use double-dash

-- Interfaces (abstract types)
interface Timestamped {
  created_at: Timestamp [readonly] = now(),
  updated_at: Timestamp?
}

-- Node classes
class Customer: Identity, Timestamped {
  email: Email [unique],
  username: String [unique],
  tier: String
}

-- Edge classes (signature = endpoints)
class placed_order(customer: Customer, order: Order)

-- Edge with attributes and constraints
class follows(follower: Customer, followed: Customer) [no_self, unique] {
  since: Timestamp
}

-- Edge with cardinality
class category_parent(child: Category, parent: Category) [
  no_self,
  acyclic,
  child -> 0..1
]

-- Type aliases
type Email = String [format: email]
type OrderStatus = String [in: ["pending", "confirmed", "shipped"]]

-- Methods (contract only, body is TypeScript)
class Customer: Identity, Timestamped {
  fn displayName(): String
  fn canPurchase(product: Product): Boolean
  fn recentOrders(limit: Int = 10): Order[]
}
```

Key syntax:
- Edges are `class` with parenthesized signatures, NOT a separate `edge` keyword
- Inheritance: `:` (colon), not `extends`
- Constraints/modifiers: `[...]` brackets
- Cardinality: `child -> 0..1` inside edge modifier list
- Methods: `fn` keyword inside class body
- Built-in types: `String`, `Int`, `Float`, `Boolean`, `Timestamp`, `Bitmask`, `ByteString`

---

## 4. Open Questions & Decisions Needed

### 4.1 Validation Wiring
Mutation validation is currently a pass-through (`src/mutation/validation.ts`). The old Zod-based `.parse()` calls were removed. The codegen generates `validators` (Zod schemas) as a separate output. **Decision needed**: how does the SDK receive and use these validators? Options:
- Pass `validators` object to `createGraph()` options
- Import validators alongside schema in graph setup
- Lazy resolution via TypeMap

### 4.2 Date Deserialization
`deserializeDateFields()` in `src/utils/dates.ts` is a pass-through. Dates come back as ISO strings. The old system used Zod schema introspection to detect date fields. **Decision needed**: how does codegen expose date field metadata? Options:
- Add `dateFields` to `SchemaNodeDef`
- Include in TypeMap
- Separate codegen output

### 4.3 TypeMap Wiring
`Graph<S>` returns `Record<string, unknown>` for all node/edge properties. The codegen produces concrete types (e.g., `CustomerNode`, `OrderPayload`). The `TypeMap` interface exists in `src/schema.ts` but isn't wired into the builder chain. **Next step**: make `graph.node('Customer').execute()` return `CustomerNode[]` by parameterizing `Graph<S, T extends TypeMap>` and flowing `T` through the builder chain.

### 4.4 ReifyEdgesPass
The spec at `typegraph/specs/06-reify-edges-pass.md` defines an AST-to-AST pass that rewrites edge traversals into link-node patterns (`(A)-[:hasLink]->(link:E)-[:linksTo]->(B)`). Schema support is wired (`reified?: boolean` on edges, `reifyEdges?: boolean` on schema, `isReified()` helper). The actual AST transformation pass does not exist yet. It should sit in `src/compiler/optimizer.ts` as a `CompilationPass`.

### 4.5 Hierarchy Resolution for Non-Default Edges
Currently `.parent()` uses the global `hierarchy.defaultEdge`. There's no per-node-type hierarchy edge resolution. The test for `category.parent()` is skipped because the hierarchy edge `category_parent` connects categories, but the same `.parent()` API doesn't know to use `category_parent` vs `has_parent` for different node types. **Decision needed**: should hierarchy be configurable per node type?

### 4.6 Edge Endpoint Ordering
`edgeFrom(schema, edgeType)` returns the types from the **first** endpoint, `edgeTo()` returns the **second**. This relies on object key ordering in the schema. This is fragile — endpoint names like `customer`, `order` are semantic but ordering is implicit. Consider whether the schema needs explicit `source`/`target` markers or if convention (first param = source) is sufficient.

---

## 5. File Map

### Source (55 files, ~12,850 lines)

```
src/
├── schema.ts              (92 lines)  — SchemaShape, SchemaNodeDef, SchemaEdgeDef, TypeMap
├── inference.ts           (114 lines) — Type-level utilities: NodeLabels, EdgeTypes, NodeProps, Proxies
├── helpers.ts             (206 lines) — Runtime: resolveNodeLabels, edgeFrom/To/Cardinality, isReified
├── errors.ts              (44 lines)  — GraphQueryError, CardinalityError, ExecutionError
├── graph.ts               (471 lines) — Graph<S>, createGraph(), TransactionScope
├── index.ts               (265 lines) — Public API barrel export
├── methods.ts             (133 lines) — Method validation + invocation
├── enrichment.ts          (86 lines)  — Proxy-based method binding
├── constraints.ts         (146 lines) — Edge constraint enforcement
├── ast/                   — Immutable AST builder + types + visitor (1,200+ lines)
├── compiler/              — CypherCompiler, optimizer pipeline, caching (1,200+ lines)
├── query/                 — Builder chain: Collection/Single/Optional/Edge/Path/Hierarchy (4,500+ lines)
├── mutation/              — GraphMutations, templates, hooks, validation, dry-run (3,200+ lines)
├── adapter/               — GraphAdapter interface
└── utils/                 — Date utils, Neo4j helpers
```

### Tests (14 spec files)

```
__tests__/
├── e2e/
│   ├── schema.ts                    — KRL-derived e-commerce SchemaShape
│   ├── helpers.ts                   — Query builder factory + cypher normalizer
│   ├── query-basic.spec.ts          — 35 tests
│   ├── query-traversal.spec.ts      — 18 tests
│   ├── query-hierarchy.spec.ts      — 4 tests
│   ├── query-return.spec.ts         — 13 tests
│   └── schema-resolution.spec.ts    — 34 tests
├── spec/
│   ├── fixtures/test-schema.ts      — Legacy test schema (SchemaShape format)
│   ├── ast.spec.ts
│   ├── methods.spec.ts
│   ├── mutations.spec.ts
│   ├── query-connected-to.spec.ts
│   ├── query-execution.spec.ts
│   ├── query-hierarchy.spec.ts
│   ├── query-match.spec.ts
│   ├── query-projection.spec.ts
│   └── query-traversal.spec.ts
└── integration/authz-v2/            — Authorization integration tests (separate concern)
```

---

## 6. Suggested Next Steps (Priority Order)

1. **Wire TypeMap into builders** — Make `graph.node('Customer').execute()` return typed results. This is the biggest DX win remaining.

2. **Wire codegen validators** — Connect the generated Zod validators into the mutation pipeline so `graph.mutate.create('Customer', data)` validates at runtime.

3. **Implement ReifyEdgesPass** — AST-to-AST transformation per spec `06-reify-edges-pass.md`. The `isReified()` helper and schema flags are ready.

4. **Date deserialization** — Once codegen exposes date field metadata, update `deserializeDateFields()` to convert ISO strings back to Date objects.

5. **Restore deleted test coverage** — Tests for edge filtering, fork patterns, multi-label queries, union queries were deleted during migration. The functionality still exists — tests just need rewriting with the new SchemaShape format.

6. **Review `edgeFrom`/`edgeTo` ordering assumption** — Currently relies on JS object key order. May need explicit source/target markers in SchemaEdgeDef.

---

## 7. Build & Test Commands

```bash
cd typegraph/typegraph

# Type check (should be 0 errors)
npx tsc --noEmit

# Run all tests
npx vitest run

# Run specific test file
npx vitest run __tests__/e2e/query-basic.spec.ts

# Run with verbose output
npx vitest run --reporter=verbose
```

Current state: **0 type errors, 14/14 test files passing, 369/374 tests green, 5 skipped.**
