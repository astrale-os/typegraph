# Spec 00: TypeGraph Schema IR v2

> Universal, JSON-serializable intermediate representation for graph schemas.
> Replaces both the compiler `SchemaIR` v1 and the client `SchemaShape`.
> Produced by `@astrale/builder`, consumed by `@astrale/typegraph-client` and kernel.
>
> Branch: `feat/schema-ir-v2`

---

## 1. Motivation

The current stack uses a three-step pipeline: GSL → compiler IR → codegen → TypeScript.
This works but requires maintaining a custom language, parser, LSP, and code generator.

**Goal:** Replace GSL + compiler + codegen with a pure TypeScript builder that serializes
directly to a universal IR. The IR becomes the single source of truth consumed by all
downstream packages (client SDK, kernel, tooling).

**Design principles:**
1. **JSON Schema for types** — no custom type system to maintain. Leverage Zod → JSON Schema serialization.
2. **Two custom keywords** — `$nodeRef` for graph references, `$dataRef` for datastore content. Everything else is standard JSON Schema.
3. **Single `classes[]` array** — nodes and edges in one list with `type` discriminator (proven pattern from v1).
4. **Minimal surface** — only what consumers actually need. No redundancy, no compiler artifacts.
5. **Zero codegen** — the builder produces the IR at runtime; TypeScript inference handles compile-time types.
6. **Logical schema only** — physical concerns (indexing, hierarchy, reification) belong to adapters, not the IR.

---

## 2. Package Architecture

```
@astrale/typegraph-schema          ← NEW: IR type definitions (zero deps)
    ↑
@astrale/builder                   ← EXISTING: TypeScript DSL + serializer (depends on schema + zod)
    ↑
todo-app / distributions           ← App code (depends on builder)

@astrale/typegraph-client          ← EXISTING: Query builder (depends on schema, replaces SchemaShape)
    ↑
kernel / adapters                  ← Runtime consumers
```

### 2.1 `@astrale/typegraph-schema`

**Location:** `typegraph/schema/`

Pure TypeScript type definitions for the IR. Zero runtime dependencies.

```
typegraph/schema/
├── src/
│   ├── index.ts           # Re-exports
│   ├── ir.ts              # SchemaIR top-level interface + BUILTIN_SCALARS
│   ├── classes.ts         # NodeDecl, EdgeDecl, ClassDecl
│   ├── attributes.ts      # Attribute, Param, Method
│   ├── endpoints.ts       # Endpoint, Cardinality, EdgeConstraints
│   └── values.ts          # ValueLiteral (defaults)
├── package.json
└── tsconfig.json
```

**Exports:**
- `SchemaIR` — the root IR interface
- `ClassDecl`, `NodeDecl`, `EdgeDecl` — graph declarations
- `Attribute`, `Method`, `Param` — field/method types
- `Endpoint`, `Cardinality`, `EdgeConstraints` — edge types
- `ValueLiteral` — default value representations
- `BUILTIN_SCALARS` — `['String', 'Int', 'Float', 'Boolean', 'Timestamp']`

### 2.2 `@astrale/builder`

**Location:** `typegraph/builder/`

Existing builder package, extended with a serializer.

```
typegraph/builder/
├── src/
│   ├── index.ts           # Re-exports
│   ├── builders.ts        # iface(), node(), edge(), method() — EXISTING
│   ├── types.ts           # Builder type definitions — EXISTING
│   ├── schema.ts          # defineSchema() validation — EXISTING
│   ├── data.ts            # defineCore(), defineSeed() — EXISTING
│   ├── kernel.ts          # Kernel base defs — EXISTING
│   └── serialize.ts       # NEW: Schema → SchemaIR serialization
├── package.json
└── tsconfig.json
```

**New export:** `serialize(schema: Schema): SchemaIR`

### 2.3 `@astrale/typegraph-client`

The client SDK currently uses `SchemaShape` as its schema interface. This gets replaced by
`SchemaIR` from `@astrale/typegraph-schema`. The `SchemaShape` type and all related interfaces
(`SchemaNodeDef`, `SchemaEdgeDef`, etc.) are deleted.

Migration is covered in [§6](#6-client-sdk-migration).

---

## 3. IR Specification

### 3.1 Top-Level Structure

```typescript
interface SchemaIR {
  /** IR format version. */
  version: '2.0'

  /**
   * Shared type definitions as JSON Schemas.
   * Keyed by type name. Referenced via $ref: '#/types/<name>'.
   * Used for enums, constrained scalars, records, tagged unions.
   */
  types: Record<string, JsonSchema>

  /**
   * Graph class declarations: nodes and edges.
   * Discriminated on `type: 'node' | 'edge'`.
   * Interfaces are nodes with `abstract: true`.
   */
  classes: ClassDecl[]
}
```

**Design notes:**
- `types` is a record (keyed by name) because JSON Schema `$ref` resolves by path: `$ref: '#/types/Priority'` resolves to `ir.types.Priority`.
- `classes` is an ordered array (preserves declaration order, no duplicate key issues).
- No `meta`, `extensions`, or `builtin_scalars` — these are compiler/tooling concerns, not IR concerns.

### 3.2 Built-in Scalars

Built-in scalars are **implicit** — not declared in the IR. All consumers know them.

| Name        | JSON Schema                              | Zod equivalent          |
|-------------|------------------------------------------|-------------------------|
| `String`    | `{ "type": "string" }`                   | `z.string()`            |
| `Int`       | `{ "type": "integer" }`                  | `z.number().int()`      |
| `Float`     | `{ "type": "number" }`                   | `z.number()`            |
| `Boolean`   | `{ "type": "boolean" }`                  | `z.boolean()`           |
| `Timestamp` | `{ "type": "string", "format": "date-time" }` | `z.string().datetime()` or `z.iso.datetime()` |

Exported as a constant for consumers:

```typescript
const BUILTIN_SCALARS = ['String', 'Int', 'Float', 'Boolean', 'Timestamp'] as const
```

### 3.3 Shared Type Definitions (`types`)

The `types` record holds **named, reusable value types** as standard JSON Schemas.

**Constrained scalars:**
```json
{
  "Email": { "type": "string", "format": "email" },
  "Slug": { "type": "string", "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$" }
}
```

**Enums:**
```json
{
  "Priority": { "enum": ["low", "medium", "high", "urgent"] },
  "TaskStatus": { "enum": ["todo", "in_progress", "done", "cancelled"] }
}
```

**Records (structured value types):**
```json
{
  "Address": {
    "type": "object",
    "properties": {
      "street": { "type": "string" },
      "city": { "type": "string" },
      "zip": { "type": "string" }
    },
    "required": ["street", "city", "zip"]
  }
}
```

**Tagged unions:**
```json
{
  "ContentBlock": {
    "oneOf": [
      {
        "type": "object",
        "properties": {
          "kind": { "const": "text" },
          "body": { "type": "string" }
        },
        "required": ["kind", "body"]
      },
      {
        "type": "object",
        "properties": {
          "kind": { "const": "image" },
          "url": { "type": "string", "format": "uri" }
        },
        "required": ["kind", "url"]
      }
    ],
    "discriminator": { "propertyName": "kind" }
  }
}
```

**Referencing shared types:** Use standard JSON Schema `$ref`:
```json
{ "$ref": "#/types/Priority" }
```

This resolves via JSON Pointer to `ir.types.Priority` → the enum schema. Standard, no custom logic.

### 3.4 Class Declarations

```typescript
type ClassDecl = NodeDecl | EdgeDecl
```

#### 3.4.1 Nodes

Nodes represent entities in the graph. Interfaces are nodes with `abstract: true`.

```typescript
interface NodeDecl {
  type: 'node'

  /** Unique name within the schema. */
  name: string

  /** If true, this is an interface (cannot be instantiated directly). */
  abstract: boolean

  /**
   * Parent type names (interfaces or concrete nodes).
   * For abstract nodes: interface extension.
   * For concrete nodes: interface implementation + optional single parent node.
   * Consumer resolves by looking up the referenced class and checking `abstract`.
   */
  implements: string[]

  /** Own attributes (NOT inherited — consumer resolves inheritance). */
  attributes: Attribute[]

  /** Own methods (NOT inherited). */
  methods: Method[]

  /**
   * Optional datastore content schema.
   * JSON Schema describing blob/document data associated with this node type.
   * Separate from graph attributes — this is opaque content storage.
   */
  data?: JsonSchema

  /**
   * Origin identifier for imported/external definitions.
   * e.g., 'astrale:kernel' for kernel-provided types.
   * Absent for user-defined types.
   */
  origin?: string
}
```

**Interface example:**
```json
{
  "type": "node",
  "name": "Timestamped",
  "abstract": true,
  "implements": [],
  "attributes": [
    {
      "name": "createdAt",
      "schema": { "type": "string", "format": "date-time" },
      "default": { "kind": "fn", "name": "now" }
    },
    {
      "name": "updatedAt",
      "schema": { "type": "string", "format": "date-time" },
      "nullable": true
    }
  ],
  "methods": []
}
```

**Concrete node example:**
```json
{
  "type": "node",
  "name": "Project",
  "abstract": false,
  "implements": ["Identity", "Timestamped"],
  "attributes": [
    {
      "name": "name",
      "schema": { "type": "string" }
    },
    {
      "name": "description",
      "schema": { "type": "string" },
      "nullable": true
    },
    {
      "name": "archived",
      "schema": { "type": "boolean" },
      "default": { "kind": "boolean", "value": false }
    }
  ],
  "methods": [
    {
      "name": "summary",
      "access": "public",
      "params": [],
      "returns": { "type": "string" }
    },
    {
      "name": "taskCount",
      "access": "public",
      "params": [],
      "returns": { "type": "integer" }
    },
    {
      "name": "addTask",
      "access": "public",
      "params": [
        {
          "name": "title",
          "schema": { "type": "string" }
        },
        {
          "name": "priority",
          "schema": { "$ref": "#/types/Priority" },
          "default": { "kind": "string", "value": "medium" }
        }
      ],
      "returns": { "type": "boolean" }
    }
  ]
}
```

#### 3.4.2 Edges

Edges represent relationships between nodes.

```typescript
interface EdgeDecl {
  type: 'edge'

  /** Unique name within the schema. */
  name: string

  /** Exactly two endpoints defining the relationship. */
  endpoints: [Endpoint, Endpoint]

  /** Own attributes on the edge (e.g., weight, role, timestamp). */
  attributes: Attribute[]

  /** Own methods on the edge. */
  methods: Method[]

  /** Structural constraints. */
  constraints?: EdgeConstraints

  /** Origin identifier. */
  origin?: string
}
```

**Example:**
```json
{
  "type": "edge",
  "name": "belongsTo",
  "endpoints": [
    { "name": "task", "types": ["Task"] },
    { "name": "project", "types": ["Project"], "cardinality": { "min": 0, "max": 1 } }
  ],
  "attributes": [],
  "methods": [],
  "constraints": { "unique": true }
}
```

### 3.5 Type References (JSON Schema)

All value types in the IR are expressed as **standard JSON Schema**. This includes attribute types,
method params, method returns, and data schemas.

```typescript
/**
 * Standard JSON Schema object.
 * Any valid JSON Schema is accepted.
 */
type JsonSchema = Record<string, unknown>
```

#### Scalar types → JSON Schema

| Concept           | JSON Schema                                          |
|-------------------|------------------------------------------------------|
| String            | `{ "type": "string" }`                               |
| Int               | `{ "type": "integer" }`                              |
| Float             | `{ "type": "number" }`                               |
| Boolean           | `{ "type": "boolean" }`                              |
| Timestamp         | `{ "type": "string", "format": "date-time" }`       |
| Email             | `{ "type": "string", "format": "email" }`           |
| URL               | `{ "type": "string", "format": "uri" }`             |
| UUID              | `{ "type": "string", "format": "uuid" }`            |
| Pattern           | `{ "type": "string", "pattern": "^[a-z]+$" }`       |
| Bounded string    | `{ "type": "string", "minLength": 1, "maxLength": 255 }` |
| Bounded number    | `{ "type": "integer", "minimum": 0, "maximum": 100 }` |

#### Enums → JSON Schema

```json
{ "enum": ["low", "medium", "high", "urgent"] }
```

Or via shared type reference:
```json
{ "$ref": "#/types/Priority" }
```

#### Arrays → JSON Schema

```json
{ "type": "array", "items": { "type": "string" } }
```

#### Objects/Records → JSON Schema

```json
{
  "type": "object",
  "properties": {
    "street": { "type": "string" },
    "city": { "type": "string" }
  },
  "required": ["street", "city"]
}
```

#### Graph references → `$nodeRef`

Custom keyword for referencing graph nodes. Used in method params and return types.

```json
{ "$nodeRef": "Project" }
```

**Semantics:** The wire type is `{ id: string }`. The `$nodeRef` annotation tells consumers
which node type this ID references. This enables:
- Validation (check the ID belongs to a Project)
- Type inference (client SDK types the result as Project props)
- Documentation

**In arrays:**
```json
{ "type": "array", "items": { "$nodeRef": "Order" } }
```

**Rule:** `$nodeRef` is only used in method params and method returns. Attribute types
are always value types (never graph references). Edge topology is expressed via endpoints,
not attribute schemas.

#### Data references → `$dataRef`

Custom keyword for datastore content access. Used in method return types when a method
returns the associated datastore content of a node.

```json
{ "$dataRef": "self" }
{ "$dataRef": "Post" }
```

**`"self"`** — returns the data schema of the node this method belongs to (from `data()` in the builder).
**`"<NodeName>"`** — returns the data schema of a different node (from `data(target)` in the builder).

**Semantics:** The return type resolves to the `data` JSON Schema of the referenced node.
Consumers look up the node's `data` field to determine the concrete type.

**Example:**
```json
{
  "type": "node",
  "name": "Post",
  "data": {
    "type": "object",
    "properties": { "body": { "type": "string" } },
    "required": ["body"]
  },
  "methods": [
    {
      "name": "content",
      "access": "public",
      "params": [],
      "returns": { "$dataRef": "self" }
    }
  ]
}
```

**Summary:** Two custom keywords total — `$nodeRef` and `$dataRef`. Everything else is standard JSON Schema.

### 3.6 Attributes

```typescript
interface Attribute {
  /** Attribute name. */
  name: string

  /** Value type as JSON Schema. */
  schema: JsonSchema

  /** Whether this attribute accepts null. Default: false. */
  nullable?: boolean

  /** Default value. Separate from schema to support computed defaults. */
  default?: ValueLiteral
}
```

**Why `nullable` is separate from JSON Schema:**
JSON Schema handles nullability via `anyOf: [{...}, { type: 'null' }]`, which is verbose
and makes the base type harder to extract. A separate boolean flag is cleaner for consumers.

**Why `default` is separate from JSON Schema:**
JSON Schema's `default` keyword only supports literal values. We need computed defaults
like `now()`. Keeping defaults in a separate field with a discriminated union covers both.

**No modifiers (unique, readonly, indexed):** Indexing and physical constraints are
deferred — they belong to adapter configuration, not the logical schema IR. Compound
indexes and indexing strategies will be designed separately when needed.

### 3.7 Methods

```typescript
interface Method {
  /** Method name. */
  name: string

  /** Visibility. */
  access: 'public' | 'private'

  /** Ordered parameter list. */
  params: Param[]

  /** Return type as JSON Schema. */
  returns: JsonSchema

  /** Whether the return value can be null. Default: false. */
  returnsNullable?: boolean
}

interface Param {
  /** Parameter name. */
  name: string

  /** Parameter type as JSON Schema. May contain $nodeRef for graph references. */
  schema: JsonSchema

  /** Whether this param accepts null. Default: false. */
  nullable?: boolean

  /** Default value. */
  default?: ValueLiteral
}
```

### 3.8 Edge Endpoints & Constraints

```typescript
interface Endpoint {
  /** Role name (e.g., 'task', 'project'). */
  name: string

  /** Allowed node type names that can connect at this endpoint. */
  types: string[]

  /** Cardinality constraint. Absent = unbounded (0..*). */
  cardinality?: Cardinality
}

interface Cardinality {
  min: number
  /** null = unbounded. */
  max: number | null
}

interface EdgeConstraints {
  /** At most one edge between any node pair. */
  unique?: boolean

  /** Cannot connect a node to itself. */
  noSelf?: boolean

  /** No cycles — forms a DAG. */
  acyclic?: boolean

  /** If A→B exists, B→A must also exist. */
  symmetric?: boolean
}
```

**Cardinality shorthand mapping** (builder → IR):

| Builder  | IR Cardinality         |
|----------|------------------------|
| `'0..1'` | `{ min: 0, max: 1 }`  |
| `'1'`    | `{ min: 1, max: 1 }`  |
| `'0..*'` | absent (default)       |
| `'1..*'` | `{ min: 1, max: null }`|

### 3.9 Value Literals (Defaults)

```typescript
type ValueLiteral =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'fn'; name: string; args?: ValueLiteral[] }
```

The `fn` variant supports computed defaults:
```json
{ "kind": "fn", "name": "now" }
{ "kind": "fn", "name": "uuid" }
{ "kind": "fn", "name": "seq", "args": [{ "kind": "string", "value": "order_number" }] }
```

### 3.10 Data Declarations

Nodes may have an associated **data schema** for datastore/blob content. This is separate
from graph attributes — it represents opaque document storage accessible via `ctx.data()`.

```json
{
  "type": "node",
  "name": "Post",
  "abstract": false,
  "implements": ["Publishable"],
  "attributes": [...],
  "methods": [...],
  "data": {
    "type": "object",
    "properties": {
      "body": { "type": "string" },
      "metadata": { "type": "object", "additionalProperties": true }
    },
    "required": ["body"]
  }
}
```

The `data` field is a JSON Schema describing the content shape. It is always a JSON Schema
of type `object`. Absent means the node has no datastore content.

---

## 4. Builder Serialization

### 4.1 `serialize(schema): SchemaIR`

The serializer converts a validated `Schema` (from `defineSchema()`) into a `SchemaIR`.

```typescript
import { serialize } from '@astrale/builder'

const schema = defineSchema({ ...kernel, Timestamped, Project, Task, belongsTo })
const ir: SchemaIR = serialize(schema)
```

### 4.2 Serialization Pipeline

```
Schema (runtime objects with Zod schemas)
    ↓
[1. Walk defs] — iterate schema.ifaces, schema.nodes, schema.edges
    ↓
[2. Extract types] — detect shared Zod schemas (enums, objects), hoist to types{}
    ↓
[3. Map attributes] — Zod prop schemas → JSON Schema + nullable + default + modifiers
    ↓
[4. Map methods] — Zod param/return schemas → JSON Schema, detect $nodeRef
    ↓
[5. Map edges] — endpoints, cardinality, constraints
    ↓
[6. Assemble] — { version: '2.0', types: {...}, classes: [...] }
    ↓
SchemaIR (JSON-serializable)
```

### 4.3 Zod → JSON Schema Mapping

The serializer uses Zod's built-in `z.toJsonSchema()` (Zod 4) for standard types.
Special builder types are handled before the Zod conversion.

**Pre-processing (before `z.toJsonSchema()`):**

| Builder construct | Detection | IR output |
|---|---|---|
| `ref(NodeDef)` | `schema.__ref_target` exists | `{ "$nodeRef": "<name>" }` |
| `data()` | `schema.__data_self` exists | `{ "$dataRef": "self" }` |
| `data(target)` | `schema.__data_grant` exists | `{ "$dataRef": "<name>" }` |
| `bitmask()` | `def.__kind === 'bitmask'` | `{ "type": "integer", "x-bitmask": true }` |

**Standard Zod → JSON Schema** (via `z.toJsonSchema()`):

| Zod | JSON Schema |
|-----|-------------|
| `z.string()` | `{ "type": "string" }` |
| `z.string().email()` | `{ "type": "string", "format": "email" }` |
| `z.string().max(100)` | `{ "type": "string", "maxLength": 100 }` |
| `z.number()` | `{ "type": "number" }` |
| `z.number().int()` | `{ "type": "integer" }` |
| `z.number().min(0).max(100)` | `{ "type": "integer", "minimum": 0, "maximum": 100 }` |
| `z.boolean()` | `{ "type": "boolean" }` |
| `z.enum(['a', 'b', 'c'])` | `{ "enum": ["a", "b", "c"] }` |
| `z.array(z.string())` | `{ "type": "array", "items": { "type": "string" } }` |
| `z.object({ x: z.string() })` | `{ "type": "object", "properties": { "x": { "type": "string" } }, "required": ["x"] }` |

### 4.4 Type Extraction & Naming

Named types are **explicitly hoisted** to `types{}` via `serialize(schema, { types: { ... } })`.

**Strategy:**
1. The user passes a `types` record mapping names to Zod schemas.
2. Each Zod schema in the record is converted to JSON Schema and stored in `ir.types`.
3. When the serializer encounters the same Zod instance (by identity) in attributes, params, or returns, it emits a `$ref: '#/types/<name>'` instead of inlining.
4. Types not in the explicit record are inlined at point of use.

This approach is explicit over implicit — the user controls exactly which types are shared
and what they are named. No automatic hoisting or name inference.

**Example:**

```typescript
// Builder code
const Priority = z.enum(['low', 'medium', 'high', 'urgent'])

export const Task = node({
  props: { priority: Priority.default('medium') }
})

const ir = serialize(schema, { types: { Priority } })
```

Serializes to:
```json
{
  "types": {
    "Priority": { "enum": ["low", "medium", "high", "urgent"] }
  },
  "classes": [{
    "type": "node",
    "name": "Task",
    "attributes": [{
      "name": "priority",
      "schema": { "$ref": "#/types/Priority" },
      "default": { "kind": "string", "value": "medium" }
    }]
  }]
}
```

### 4.5 Default Value Extraction

The serializer extracts defaults from Zod schemas:

| Zod | ValueLiteral |
|-----|--------------|
| `.default('hello')` | `{ kind: 'string', value: 'hello' }` |
| `.default(42)` | `{ kind: 'number', value: 42 }` |
| `.default(false)` | `{ kind: 'boolean', value: false }` |
| `.optional()` | Sets `nullable: true` on the attribute |

**Computed defaults** require explicit annotation since Zod doesn't distinguish
`z.string().default('now')` (literal) from "call now()". The builder provides a helper:

```typescript
import { fn } from '@astrale/builder'

const Timestamped = iface({
  props: {
    createdAt: z.string().datetime().default(fn('now')),
  }
})
```

Where `fn('now')` produces a sentinel value that the serializer detects and emits as
`{ kind: 'fn', name: 'now' }`.

### 4.6 Nullable Extraction

| Zod | IR |
|-----|-----|
| `z.string()` | `nullable: false` (default, omitted) |
| `z.string().optional()` | `nullable: true` |
| `z.string().nullable()` | `nullable: true` |
| `z.optional(z.string())` | `nullable: true` |

The serializer strips the optional/nullable wrapper and sets the flag. The `schema` field
contains the inner (non-null) JSON Schema.

---

## 5. Builder API (Unchanged + New)

### 5.1 Existing API (No Changes)

The builder API from the existing sketch is preserved as-is:

```typescript
// Schema definition
iface(config | thunk)     → IfaceDef
node(config | thunk)      → NodeDef
edge(from, to, opts?)     → EdgeDef
method(config)            → MethodDef
bitmask()                 → BitmaskDef
ref(target)               → RefSchema (for method params/returns)
data() / data(target)     → DataSchema (for method returns)

// Schema assembly & validation
defineSchema(defs)        → Schema

// Method implementation
defineMethods(schema, impl) → MethodsImpl

// Data definitions
create(nodeDef, data)     → CoreInstance
link(from, edge, to, data?) → CoreLink
defineCore(schema, namespace, config) → CoreDef
defineSeed(schema, core, config)      → SeedDef
```

### 5.2 New API

```typescript
// Serialization
serialize(schema: Schema, options?: SerializeOptions): SchemaIR

interface SerializeOptions {
  /** Named types to hoist into the IR `types` record. */
  types?: Record<string, z.ZodType>
}

// Computed default helper
fn(name: string, ...args: unknown[]): FnDefault
```

### 5.3 Kernel Definitions

The kernel schema (Identity, Node, Link, Class, etc.) is defined in `@astrale/builder/kernel`
and exported as a flat record for spreading into `defineSchema()`:

```typescript
import * as kernel from '@astrale/builder/kernel'

const Schema = defineSchema({ ...kernel, ...myDefs })
```

When serialized, kernel classes have `origin: 'astrale:kernel'`.

---

## 6. Client SDK Migration

The client SDK (`@astrale/typegraph-client`) currently uses `SchemaShape` from
`src/schema/types.ts`. This is replaced by `SchemaIR` from `@astrale/typegraph-schema`.

### 6.1 What Changes

| Current (`SchemaShape`) | New (`SchemaIR`) |
|---|---|
| `nodes: Record<string, SchemaNodeDef>` | `classes: ClassDecl[]` (filter by `type === 'node'`) |
| `edges: Record<string, SchemaEdgeDef>` | `classes: ClassDecl[]` (filter by `type === 'edge'`) |
| `methods: Record<string, Record<string, SchemaMethodDef>>` | Methods live on their owning `ClassDecl` |
| `scalars: string[]` | Implicit (BUILTIN_SCALARS constant) |
| `hierarchy: HierarchyConfig` | Adapter config (not in IR) |
| `reifyEdges: boolean` | Adapter config (not in IR) |
| `classRefs: ClassRefs` | Runtime-only (set by `materializeSchema()`, not in IR) |

### 6.2 Client Initialization

```typescript
// Before:
const graph = createGraph(schemaShape, { adapter })

// After:
const graph = createGraph(ir, { adapter })
```

The client builds internal indexes (by-name lookups, endpoint maps) from the IR on creation.
This is a one-time cost at startup.

### 6.3 Type Inference

The client's TypeScript inference system (`inference.ts`) currently uses literal types
from `SchemaShape` (e.g., endpoint `types: readonly ['Order']` narrowed via `as const`).

With the IR, type inference works differently:
- **Runtime IR** (JSON): No TypeScript type narrowing. The client works with string names.
- **Builder-provided types**: The builder's TypeScript generics provide compile-time safety.

For type-safe queries, the client accepts a type parameter:

```typescript
// The builder's Schema type carries full TypeScript inference
const graph = createGraph<typeof Schema>(ir, { adapter })
```

The generic `typeof Schema` provides compile-time types, the `ir` provides runtime data.
This is the same dual-layer pattern used by ORMs like Drizzle and Prisma.

---

## 7. Complete Example: Todo App

### 7.1 Builder Code

```typescript
// todo-app/schema.ts
import { iface, node, edge, method, defineSchema, serialize, ref, fn } from '@astrale/builder'
import * as kernel from '@astrale/builder/kernel'
import { z } from 'zod'

// ── Type declarations ─────────────────────────────────

const Priority = z.enum(['low', 'medium', 'high', 'urgent'])
const TaskStatus = z.enum(['todo', 'in_progress', 'done', 'cancelled'])
const Color = z.string()

// ── Interfaces ────────────────────────────────────────

export const Timestamped = iface({
  props: {
    createdAt: z.string().datetime().default(fn('now')),
    updatedAt: z.string().datetime().optional(),
  }
})

// ── Nodes ─────────────────────────────────────────────

export const Project = node({
  implements: [kernel.Identity, Timestamped],
  props: {
    name: z.string(),
    description: z.string().optional(),
    archived: z.boolean().default(false),
  },
  methods: {
    summary: method({ returns: z.string() }),
    taskCount: method({ returns: z.number().int() }),
    addTask: method({
      params: { title: z.string(), priority: Priority.default('medium') },
      returns: z.boolean(),
    }),
  }
})

export const Task = node({
  implements: [Timestamped],
  props: {
    title: z.string(),
    description: z.string().optional(),
    status: TaskStatus.default('todo'),
    priority: Priority.default('medium'),
    dueDate: z.string().datetime().optional(),
  },
  methods: {
    formatTitle: method({ returns: z.string() }),
    complete: method({ returns: z.boolean() }),
    reopen: method({ returns: z.boolean() }),
  }
})

export const Tag = node({
  implements: [Timestamped],
  props: {
    name: z.string(),
    color: Color.optional(),
  },
})

// ── Edges ─────────────────────────────────────────────

export const belongsTo = edge(
  { as: 'task', types: [Task] },
  { as: 'project', types: [Project], cardinality: '0..1' },
  { unique: true },
)

export const taggedWith = edge(
  { as: 'task', types: [Task] },
  { as: 'tag', types: [Tag] },
  { unique: true },
)

export const dependsOn = edge(
  { as: 'blocker', types: [Task] },
  { as: 'blocked', types: [Task] },
  { noSelf: true, acyclic: true },
)

// ── Schema ────────────────────────────────────────────

export const Schema = defineSchema({
  ...kernel,
  Timestamped, Project, Task, Tag,
  belongsTo, taggedWith, dependsOn,
})

// ── Serialize ─────────────────────────────────────────

export const ir = serialize(Schema, { types: { Priority, TaskStatus } })
```

### 7.2 Serialized IR Output

```json
{
  "version": "2.0",
  "types": {
    "Priority": { "enum": ["low", "medium", "high", "urgent"] },
    "TaskStatus": { "enum": ["todo", "in_progress", "done", "cancelled"] }
  },
  "classes": [
    {
      "type": "node",
      "name": "Node",
      "abstract": true,
      "implements": [],
      "attributes": [],
      "methods": [
        {
          "name": "create",
          "access": "public",
          "params": [
            { "name": "parent", "schema": { "$nodeRef": "Node" } }
          ],
          "returns": { "type": "string" }
        }
      ],
      "origin": "astrale:kernel"
    },
    {
      "type": "node",
      "name": "Identity",
      "abstract": true,
      "implements": ["Node"],
      "attributes": [],
      "methods": [],
      "origin": "astrale:kernel"
    },
    {
      "type": "node",
      "name": "Timestamped",
      "abstract": true,
      "implements": [],
      "attributes": [
        {
          "name": "createdAt",
          "schema": { "type": "string", "format": "date-time" },
          "default": { "kind": "fn", "name": "now" }
        },
        {
          "name": "updatedAt",
          "schema": { "type": "string", "format": "date-time" },
          "nullable": true
        }
      ],
      "methods": []
    },
    {
      "type": "node",
      "name": "Project",
      "abstract": false,
      "implements": ["Identity", "Timestamped"],
      "attributes": [
        {
          "name": "name",
          "schema": { "type": "string" }
        },
        {
          "name": "description",
          "schema": { "type": "string" },
          "nullable": true
        },
        {
          "name": "archived",
          "schema": { "type": "boolean" },
          "default": { "kind": "boolean", "value": false }
        }
      ],
      "methods": [
        {
          "name": "summary",
          "access": "public",
          "params": [],
          "returns": { "type": "string" }
        },
        {
          "name": "taskCount",
          "access": "public",
          "params": [],
          "returns": { "type": "integer" }
        },
        {
          "name": "addTask",
          "access": "public",
          "params": [
            {
              "name": "title",
              "schema": { "type": "string" }
            },
            {
              "name": "priority",
              "schema": { "$ref": "#/types/Priority" },
              "default": { "kind": "string", "value": "medium" }
            }
          ],
          "returns": { "type": "boolean" }
        }
      ]
    },
    {
      "type": "node",
      "name": "Task",
      "abstract": false,
      "implements": ["Timestamped"],
      "attributes": [
        {
          "name": "title",
          "schema": { "type": "string" }
        },
        {
          "name": "description",
          "schema": { "type": "string" },
          "nullable": true
        },
        {
          "name": "status",
          "schema": { "$ref": "#/types/TaskStatus" },
          "default": { "kind": "string", "value": "todo" }
        },
        {
          "name": "priority",
          "schema": { "$ref": "#/types/Priority" },
          "default": { "kind": "string", "value": "medium" }
        },
        {
          "name": "dueDate",
          "schema": { "type": "string", "format": "date-time" },
          "nullable": true
        }
      ],
      "methods": [
        {
          "name": "formatTitle",
          "access": "public",
          "params": [],
          "returns": { "type": "string" }
        },
        {
          "name": "complete",
          "access": "public",
          "params": [],
          "returns": { "type": "boolean" }
        },
        {
          "name": "reopen",
          "access": "public",
          "params": [],
          "returns": { "type": "boolean" }
        }
      ]
    },
    {
      "type": "node",
      "name": "Tag",
      "abstract": false,
      "implements": ["Timestamped"],
      "attributes": [
        {
          "name": "name",
          "schema": { "type": "string" }
        },
        {
          "name": "color",
          "schema": { "type": "string" },
          "nullable": true
        }
      ],
      "methods": []
    },
    {
      "type": "edge",
      "name": "belongsTo",
      "endpoints": [
        { "name": "task", "types": ["Task"] },
        { "name": "project", "types": ["Project"], "cardinality": { "min": 0, "max": 1 } }
      ],
      "attributes": [],
      "methods": [],
      "constraints": { "unique": true }
    },
    {
      "type": "edge",
      "name": "taggedWith",
      "endpoints": [
        { "name": "task", "types": ["Task"] },
        { "name": "tag", "types": ["Tag"] }
      ],
      "attributes": [],
      "methods": [],
      "constraints": { "unique": true }
    },
    {
      "type": "edge",
      "name": "dependsOn",
      "endpoints": [
        { "name": "blocker", "types": ["Task"] },
        { "name": "blocked", "types": ["Task"] }
      ],
      "attributes": [],
      "methods": [],
      "constraints": { "noSelf": true, "acyclic": true }
    }
  ]
}
```

---

## 8. Differences from v1

| Aspect | v1 (Compiler IR) | v2 (This spec) |
|--------|-------------------|-----------------|
| **Type system** | Custom `TypeRef` discriminated union (Scalar, Node, Alias, Edge, Union, List, etc.) | Standard JSON Schema + `$nodeRef` + `$dataRef` |
| **Type declarations** | 4 separate arrays (`type_aliases`, `value_types`, `tagged_unions`, `data_types`) | Single `types: Record<string, JsonSchema>` |
| **Built-in scalars** | Explicit `builtin_scalars: string[]` | Implicit (`BUILTIN_SCALARS` constant) |
| **Metadata** | `meta: { generated_at, source_hash }` | None (compiler concern, not IR concern) |
| **Extensions** | `extensions: Extension[]` + per-class `origin` | Per-class `origin` only |
| **Nullable** | `nullable: boolean` on attributes | Same |
| **Defaults** | `ValueNode` (PascalCase kinds) | `ValueLiteral` (lowercase kinds, `fn` instead of `Call`) |
| **Constraints** | `ValueConstraints` on attributes | Standard JSON Schema constraints on the schema itself |
| **Naming** | snake_case keys (`type_aliases`, `param_name`) | camelCase keys (`returnsNullable`) |
| **Data types** | Separate `data_types[]` + `data_ref` on nodes | Inline `data?: JsonSchema` on nodes |
| **Method projection** | `MethodProjection` with `star`, `fields`, `include_data` | Removed (builder concern, not IR concern) |
| **Edge endpoints** | `endpoints: Endpoint[]` (any length) | `endpoints: [Endpoint, Endpoint]` (always binary) |
| **Producer** | GSL compiler | TypeScript builder (`serialize()`) |
| **Primary consumer** | Codegen | Client SDK + kernel (directly) |

---

## 9. Resolved Decisions

1. **`hierarchy` and `reifyEdges`** — **Adapter concern.** These describe how the graph is
   physically stored (hierarchy edges, edge reification), not the logical schema. They move
   to adapter configuration, not the IR.

2. **Method `data()` returns** — **`$dataRef` keyword.** `{ "$dataRef": "self" }` for own data,
   `{ "$dataRef": "Post" }` for another node's data. Consistent with `$nodeRef` pattern.

3. **Indexes** — **Deferred.** Indexing (including compound/multi-property indexes) is not
   part of the logical schema IR. Will be designed separately as adapter-level or
   deployment-level configuration when needed.

## 10. Open Questions

1. **`classRefs`** — Runtime-only (materialized schema node IDs). Not in IR. Set by
   `materializeSchema()` at boot time. Needs a clean place in the client.

---

## 11. Summary

| Decision | Choice |
|----------|--------|
| Type system | JSON Schema (standard) + `$nodeRef` + `$dataRef` (two custom keywords) |
| Type declarations | `types: Record<string, JsonSchema>` with standard `$ref` |
| Class structure | `classes: ClassDecl[]` with `type: 'node' \| 'edge'` discriminator |
| Interfaces | Nodes with `abstract: true` |
| Inheritance | `implements: string[]` (consumer resolves) |
| Nullability | Separate `nullable` flag (not in JSON Schema) |
| Defaults | Separate `ValueLiteral` (supports computed defaults) |
| Constraints | JSON Schema constraints (format, pattern, min, max) on the schema itself |
| Indexing | Deferred — adapter/deployment concern, not in IR |
| Naming | camelCase throughout |
| Metadata | None in IR (runtime/tooling concern) |
| Physical storage | `hierarchy`, `reifyEdges` → adapter config, not IR |
| Data access | `$dataRef: "self" \| "<NodeName>"` in method returns |
| Serialization | `serialize(schema)` in builder, Zod → JSON Schema via `z.toJsonSchema()` |
| Client migration | `SchemaIR` replaces `SchemaShape`, type inference via `typeof Schema` generic |
| Package | `@astrale/typegraph-schema` (zero deps) holds IR types |
