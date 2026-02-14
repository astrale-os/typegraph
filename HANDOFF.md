# Typegraph — Session Handoff

> Context transfer document for continuing work on the Astrale Typegraph system.
> Written: 2026-02-14. Branch: `feat/authorization-v2`.

---

## What Astrale Is

Astrale is a graph-based platform. The **kernel** manages graph operations (nodes, edges, spaces, identities). The **typegraph** is the schema/type system that sits on top: it lets developers define graph schemas in a custom language (KRL), then provides a fully type-safe TypeScript SDK to build query and mutation ASTs against those schemas.

## Workspace Layout

```
workspace/
├── kernel/          # Core graph engine (boot, distribution, spaces)
├── typegraph/       # ← OUR FOCUS
│   ├── compiler/    # KRL → IR (done, battle-tested)
│   ├── codegen/     # IR → TypeScript (done, 105 tests)
│   ├── core/        # Typegraph core (empty/legacy)
│   ├── typegraph/   # Main typegraph package (legacy)
│   ├── adapters/    # Storage adapters (falkordb, neo4j, memory)
│   ├── vscode/      # LSP extension
│   └── __tests__/   # Integration tests
├── sdk/             # SDK packages
├── adapters/        # Platform adapters
├── shell/           # Shell (terminal UI)
├── gui/             # Desktop frontend
├── backoffice/      # Admin UI
├── cli/             # CLI tool
├── config/          # Shared config
├── dev/             # Dev environment
└── pnpm-workspace.yaml
```

Monorepo managed by **pnpm workspaces**. TypeScript throughout.

---

## What's Done

### 1. Compiler (`typegraph/compiler`) — Complete

**Package**: `@astrale/kernel-compiler`

**Pipeline**: KRL source → Lexer → Parser (CST) → Lower (AST) → Resolver → Validator → Serializer → `SchemaIR` (JSON)

**Key exports**:
- `compile(source, { prelude })` → `{ ir: SchemaIR, diagnostics }`
- `KERNEL_PRELUDE` — the standard prelude with scalars (`String`, `Int`, `Float`, `Boolean`, `Timestamp`), kernel source code (defines `Node`, `Identity`, `has_parent`, `instance_of`, etc.), and default functions (`now`)
- Individual phases exported for tooling: `lex`, `parse`, `lower`, `resolve`, `validate`, `serialize`
- Full IR types: `SchemaIR`, `ClassDef`, `NodeDef`, `EdgeDef`, `IRAttribute`, `Endpoint`, `EdgeConstraints`, etc.

**KRL language features**:
- `type X = String [format: email]` — type aliases with constraints
- `type X = String [in: ["a", "b"]]` — enum aliases
- `type X = String [length: 1..280]` — length range (NOT `min_length`/`max_length`)
- `interface Foo { attr: Type }` — abstract interfaces
- `interface Bar: Foo { ... }` — interface inheritance
- `class Baz: Foo, Bar { ... }` — concrete node classes (multiple inheritance)
- `class edge_name(param: Type, param2: Type) [constraints] { attrs }` — edge classes
- Edge constraints: `no_self`, `acyclic`, `unique`, `symmetric`, `on_kill_source: cascade`, `on_kill_target: cascade`, `param -> min..max` (cardinality)
- `extend "uri" { TypeName }` — import types from external schemas
- Attribute modifiers: `[unique]`, `[indexed: asc]`, `[readonly]`
- Nullable: `Type?`, Defaults: `= value`, `= now()`

**Gotcha**: Length constraints on type aliases use `[length: min..max]` syntax, NOT `[min_length: N, max_length: M]`. The compiler validator rejects modifier-style constraints on aliases.

### 2. Codegen (`typegraph/codegen`) — Complete

**Package**: `@astrale/typegraph-codegen`

**Pipeline**: `SchemaIR[]` → Loader (merge, dedup, resolve inheritance) → `GraphModel` → Emitters → TypeScript source string

#### Architecture

```
src/
├── index.ts          # Public API (re-exports)
├── generate.ts       # Orchestrator: load → emit → join
├── loader.ts         # SchemaIR[] → GraphModel (merge, dedup, inheritance)
├── model.ts          # GraphModel type definitions (re-exports IR types from compiler)
└── emit/
    ├── enums.ts       # Enum const tuples + type aliases
    ├── interfaces.ts  # Type aliases, node interfaces, edge payload interfaces
    ├── validators.ts  # Zod validators (one per alias, node, edge payload)
    ├── schema-value.ts # Runtime `schema` const (nodes, edges, constraints, endpoints)
    ├── schema-types.ts # SchemaNodeType, SchemaEdgeType, SchemaType union types
    ├── core.ts        # Core DSL (defineCore, node, edge, Refs type)
    ├── scalars.ts     # Scalar → TS type mapping
    └── utils.ts       # pascalCase, banner, section
```

#### What It Generates (sections in order)

1. **Enums** — `const ColorValues = ['red', 'green', 'blue'] as const; type Color = (typeof ColorValues)[number]`
2. **Type Aliases** — `type Email = string` with JSDoc
3. **Node Interfaces** — `interface User { name: string; email: Email }` with inheritance (`extends`)
4. **Edge Payload Interfaces** — `interface MembershipPayload { role: Role }` (only for edges with attributes)
5. **Validators** — `export const validators = { Email: z.string().email(), User: z.object({ ... }), ... }`
6. **Schema Value** — `export const schema = { scalars: [...], nodes: { ... }, edges: { ... } } as const` — full graph topology for runtime
7. **Schema Types** — `type SchemaNodeType = 'User' | 'Post'; type SchemaEdgeType = 'follows' | 'likes'; type SchemaType = SchemaNodeType | SchemaEdgeType`
8. **Core DSL** — `defineCore`, `node`, `edge` helpers + `Refs` type (see below)

#### Core DSL (the important part for next steps)

The codegen emits helpers for declaring **Core** — the foundational instances that form the skeleton of the graph. Core is defined in TypeScript by the developer using generated helpers:

```typescript
// Generated types:
interface CoreNodeProps { User: Partial<User>; Module: Partial<Module> }
interface CoreEdgeEndpoints { manages: { app: string; mod: string } }
interface CoreEdgeProps { manages: Partial<ManagesPayload> }  // only if edge has attrs
interface CoreNodeDef<T> { __type: T; props: CoreNodeProps[T]; children?: Record<string, CoreNodeDef> }
interface CoreEdgeDef<T> { __type: T; endpoints: CoreEdgeEndpoints[T]; props?: ... }
interface CoreDefinition { nodes: Record<string, CoreNodeDef>; edges?: CoreEdgeDef[] }

// Generated helpers:
function node(type, props)                     // without children
function node(type, props, { children })       // with children (preserves literal keys)
function edge(type, endpoints, props?)
function defineCore<const T>(def: T): T        // const type param for full inference

// Usage by developer:
const core = defineCore({
  nodes: {
    blog: node('Application', { name: 'Blog' }, {
      children: { posts: node('Module', { name: 'Posts' }) }
    }),
  },
  edges: [edge('manages', { app: 'blog', mod: 'posts' })],
})
```

**`Refs`** type: `Record<SchemaType | ExtractCoreKeys<T>, string>` — maps schema type names AND core instance keys (recursively flattened from nested `children`) to runtime IDs. Populated after core installation.

#### Loader Details

- **Multi-schema merging**: accepts `SchemaIR[]`, deduplicates identical definitions, throws `ConflictError` on structural mismatches
- **Inheritance resolution**: recursive, handles diamond inheritance, deduplicates attributes by name (child overrides parent)
- **Import stubs**: for `extend` imports, creates abstract placeholder nodes with `origin` set to the URI
- **`normalizeIR`**: handles legacy format (`{ nodes, edges }`) and canonical format (`{ classes }`)

#### GraphModel Shape

```typescript
interface GraphModel {
  scalars: string[]
  aliases: Map<string, ResolvedAlias>     // name → { underlyingType, constraints, isEnum, enumValues }
  nodeDefs: Map<string, ResolvedNode>     // name → { abstract, implements, ownAttributes, allAttributes, origin? }
  edgeDefs: Map<string, ResolvedEdge>     // name → { endpoints, ownAttributes, allAttributes, constraints, origin? }
  extensions: { uri: string; importedTypes: string[] }[]
}
```

#### Test Suite (105 tests, 12 files)

```
__tests__/
├── helpers.ts           # compileKRL, compileAndGenerate, mergeAndGenerate, extractors
├── types.test.ts        # Enums + type aliases (8)
├── inheritance.test.ts  # Deep chains, diamond, overrides (5)
├── nodes.test.ts        # Interfaces, attributes, scalars (5)
├── edges.test.ts        # Endpoints, payloads, constraints, polymorphism (11)
├── validators.test.ts   # Zod generation, codegen vs runtime boundaries (9)
├── schema.test.ts       # SchemaNodeType/EdgeType + schema value (7)
├── core.test.ts         # Core DSL generation (12)
├── merging.test.ts      # Multi-schema merge, dedup, conflicts (5)
├── kernel.test.ts       # Kernel extend integration (4)
├── edge-cases.test.ts   # Empty schema, stress test, alias refs (5)
├── e-commerce.test.ts   # Full real-world scenario + snapshot (10)
└── __snapshots__/
    └── e-commerce.test.ts.snap
```

Plus `src/generate.test.ts` (24 tests) — older file-based tests using a compiled blog IR JSON.

All tests are **end-to-end**: KRL source → compile → generate → assert on TypeScript output. No hardcoded IR.

Test config: `vitest.config.ts` includes `['src/**/*.test.ts', '__tests__/**/*.test.ts']`. Separate `tsconfig.test.json` extends main `tsconfig.json` with `rootDir: "."` and `include: ["src", "__tests__"]` for type-checking tests without breaking the build.

---

## What's Next

Two remaining components to reach the end goal (type-safe query/mutation AST builder):

### 1. Schema Runtime — Install schemas into the graph

Takes the generated `schema` value + `defineCore(...)` definition and materializes them:

- **Schema installation** — iterate the schema object, create meta-model nodes for every type definition
- **Core installation** — take a core definition + root node ID, instantiate all declared nodes/edges, return the **Refs** map (core key → runtime node ID, schema type name → runtime meta-node ID)
- **Constraint enforcement** — runtime logic for `no_self`, `acyclic`, `unique`, `symmetric`, cardinality, `on_kill_source/target` (codegen captures these in `schema.edges[name].constraints` but can't enforce at build time)
- **Validation bridge** — wire up generated Zod validators for create/update operations

### 2. TypeGraph Client (the SDK) — Type-safe query/mutation builder

The developer-facing API that consumes generated TypeScript:

- **Query builder** — traverse/filter/select with type inference from schema
- **Mutation builder** — create node, create edge, update, delete — typed against generated interfaces
- **Refs integration** — client loads the Refs map, resolves string keys to IDs transparently
- **AST serialization** — builders produce query/mutation AST for the engine

**Recommended approach**: design the Client API top-down (what the developer writes) then work backward into Schema Runtime.

---

## Critical Insights & Lessons

1. **KRL syntax gotcha**: Type alias constraints use `[length: min..max]`, `[format: email]`, `[in: [...]]`. NOT `[min_length: N]`. The compiler's validator phase rejects invalid modifier names on aliases. Always check `compiler/src/validator/declarations.ts` and `compiler/src/lower/modifiers.ts` for allowed syntax.

2. **Inheritance model**: KRL uses `class Foo: Bar, Baz` where `Bar`/`Baz` can be interfaces OR imported types. The `implements` field on a ResolvedNode lists all parents. Diamond inheritance is handled by deduplicating attributes by name (child wins).

3. **Edge polymorphism**: Edges can declare interface types as endpoints (e.g., `class link(src: Connectable, tgt: Connectable) []`). The schema value records the declared endpoint type (the interface), not the concrete classes. Runtime resolves subtype compatibility by checking `implements` on concrete nodes.

4. **Codegen vs runtime boundary**: Codegen emits metadata and validators. It does NOT enforce graph invariants. The generated `schema.edges[name].constraints` object contains everything the runtime needs to enforce `no_self`, `acyclic`, `unique`, `symmetric`, cardinality, and lifecycle actions. All constraint types are fully captured.

5. **Import stubs**: `extend "uri" { Identity }` creates an abstract placeholder in the model with `origin: "uri"`. These are excluded from `SchemaNodeType` (not concrete). They appear in interfaces as `extends Identity` and in schema value as `abstract: true`.

6. **Kernel prelude**: `KERNEL_PRELUDE` from the compiler provides base types (`Node`, `Identity`, `has_parent`, `instance_of`). These are compiled as prelude source, not imports. `Node` appears as an abstract node in the model. `Identity` is typically imported via `extend`.

7. **Test pattern**: All codegen tests use the `compileAndGenerate(krlSource)` helper from `__tests__/helpers.ts`. It compiles KRL with the kernel prelude and runs codegen in one call. Returns `{ source, model }`. This is the gold standard for testing — no static IR files.

8. **Multi-schema merging**: The loader accepts `SchemaIR[]` and merges them. Identical definitions are silently deduplicated (structural equality via JSON.stringify). Conflicting definitions throw `ConflictError`. This handles the common case where multiple schemas extend the same kernel types.

9. **Generated output is a single file**: All codegen output is concatenated into one TypeScript source string. Sections are separated by comments. The `generate()` function returns `{ source: string, model: GraphModel }`.

10. **User preferences**: The developer (Bryan) values S-tier DX, elegant APIs, KISS with justified complexity, minimal comments (only permanently relevant ones), no fluff documentation, and world-class quality. Does not care about breaking changes — clean slate is preferred over legacy compatibility.

---

## Key File Paths

| File | Purpose |
|---|---|
| `typegraph/compiler/src/index.ts` | Compiler public API |
| `typegraph/compiler/src/kernel-prelude.ts` | Kernel prelude (Node, Identity, has_parent, etc.) |
| `typegraph/compiler/src/ir/types.ts` | IR type definitions (SchemaIR, ClassDef, etc.) |
| `typegraph/codegen/src/index.ts` | Codegen public API |
| `typegraph/codegen/src/generate.ts` | Codegen orchestrator |
| `typegraph/codegen/src/loader.ts` | SchemaIR[] → GraphModel |
| `typegraph/codegen/src/model.ts` | GraphModel types |
| `typegraph/codegen/src/emit/core.ts` | Core DSL emitter (defineCore, node, edge, Refs) |
| `typegraph/codegen/src/emit/schema-value.ts` | Runtime schema object emitter |
| `typegraph/codegen/src/emit/schema-types.ts` | SchemaNodeType/EdgeType/SchemaType emitter |
| `typegraph/codegen/__tests__/helpers.ts` | Test utilities (compileKRL, compileAndGenerate, etc.) |
| `typegraph/codegen/__tests__/*.test.ts` | 11 domain-specific test files (105 tests total) |
| `typegraph/codegen/vitest.config.ts` | Test runner config |
| `typegraph/codegen/tsconfig.json` | Build config (rootDir: src) |
| `typegraph/codegen/tsconfig.test.json` | Test type-check config (rootDir: ., includes __tests__) |

---

## How to Run

```bash
# From typegraph/codegen/
pnpm test              # or: npx vitest run
npx vitest run --update # update snapshots
npx tsc -p tsconfig.test.json --noEmit  # type-check including tests
```
