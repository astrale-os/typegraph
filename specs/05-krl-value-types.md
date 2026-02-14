# Spec 05: KRL Value Types

> Structured value types via the `type` keyword — plain data shapes that are not graph entities.
> Usable as method params, method returns, and attribute types.

---

## 1. Syntax

### 1.1 Existing: Scalar Aliases

```krl
type Email = String [format: email]
type Plan = String [in: ["free", "pro", "enterprise"]]
```

These alias a scalar with optional constraints. The right-hand side is always a named type.

### 1.2 New: Structured Value Types

```krl
type GeoPoint = {
  lat: Float,
  lng: Float
}

type PageResult = {
  items: Order[],
  total: Int,
  next_cursor: String?
}

type ValidationResult = {
  valid: Boolean,
  errors: String[]
}
```

**Disambiguation rule:** After `type Name =`, if the next token is `{`, it's a structured value type. Otherwise, it's a scalar alias. 1-token lookahead, no ambiguity.

### 1.3 Usage in Methods

```krl
class Store {
  fn geocode(): GeoPoint
  fn search(criteria: SearchCriteria): PageResult
  fn validate(): ValidationResult
}
```

Value types are first-class type references — usable anywhere a type name is valid:
- Method return types
- Method parameter types
- Attribute types (rare but legal — an attribute could hold a structured value)

### 1.4 Field Syntax

Fields inside a value type use the same syntax as class/interface attributes:

```
name: Type          # required field
name: Type?         # nullable field
name: Type = value  # field with default
name: Type[]        # list field (proposed — uses same [] suffix as method returns)
```

No modifiers (`[unique]`, `[indexed]`, etc.) — those are graph-level concerns that don't apply to value types.

### 1.5 Nesting

Value types can reference other value types:

```krl
type Address = {
  street: String,
  city: String,
  geo: GeoPoint
}
```

And graph types:

```krl
type SearchHit = {
  node: Customer,
  score: Float
}
```

Circular references between value types are an error (they're value objects, not references).

---

## 2. What Value Types Are NOT

- **Not graph entities.** No ID, no storage, no edges. They don't appear in `schema.nodes` or `schema.edges`.
- **Not interfaces.** Can't be implemented by classes. No inheritance.
- **Not constrainable.** No `[format: email]` modifiers on the type itself. Individual fields can use their own type's constraints (e.g., `email: Email` where `Email` has a format constraint).
- **Not classes.** No methods. Pure data.

---

## 3. IR Representation

### 3.1 New IR Type

Add `value_types` to `SchemaIR`:

```typescript
interface SchemaIR {
  // ...existing fields...
  type_aliases: TypeAlias[]     // scalar aliases (unchanged)
  value_types: ValueTypeDef[]   // structured value types (new)
  classes: ClassDef[]
}
```

```typescript
interface ValueTypeDef {
  name: string
  fields: ValueTypeField[]
}

interface ValueTypeField {
  name: string
  type: TypeRef
  nullable: boolean
  default: ValueNode | null
  list: boolean
}
```

`list: boolean` indicates the field is an array. When `true`, the `type` holds the element type (not wrapped in a `List` TypeRef). This mirrors how method returns handle `returnList`.

Alternatively, `list` could be represented by wrapping `type` in `{ kind: 'List', element: ... }` for consistency with method returns. Prefer the `List` wrapper for uniformity — one representation for "array of X" throughout the IR.

**Decision: use `List` wrapper in `type`:**

```typescript
interface ValueTypeField {
  name: string
  type: TypeRef        // { kind: 'List', element: ... } for array fields
  nullable: boolean
  default: ValueNode | null
}
```

### 3.2 New TypeRef Variant

Add `ValueType` to the `TypeRef` union:

```typescript
export type TypeRef =
  | { kind: 'Scalar'; name: string }
  | { kind: 'Node'; name: string }
  | { kind: 'Alias'; name: string }
  | { kind: 'Edge'; name: string }
  | { kind: 'AnyEdge' }
  | { kind: 'Union'; types: TypeRef[] }
  | { kind: 'List'; element: TypeRef }
  | { kind: 'ValueType'; name: string }  // new
```

When the serializer encounters a `NamedType` that resolves to a `ValueType` symbol, it emits `{ kind: 'ValueType', name }`.

### 3.3 SymbolKind

Add `'ValueType'` to the resolver's `SymbolKind`:

```typescript
type SymbolKind = 'Scalar' | 'TypeAlias' | 'Interface' | 'Class' | 'Edge' | 'ValueType'
```

---

## 4. Compiler Pipeline Impact

### 4.1 Parser

Modify `parseTypeAlias()`: After consuming `type Name =`, check if next token is `LBrace`. If yes, parse a value type body. Otherwise, proceed with existing scalar alias logic.

**New CST node:**

```typescript
interface ValueTypeDeclNode extends CstNode {
  kind: 'ValueTypeDecl'
  typeKeyword: Token
  name: Token
  eq: Token
  lbrace: Token
  fields: ValueTypeFieldNode[]
  rbrace: Token
}

interface ValueTypeFieldNode extends CstNode {
  kind: 'ValueTypeField'
  name: Token
  colon: Token
  typeExpr: TypeExprNode
  listSuffix: { lbracket: Token; rbracket: Token } | null
  nullable: Token | null      // extracted from NullableType, same as methods
  defaultValue: DefaultValueNode | null
}
```

The `parseTypeAlias` function becomes a dispatch:

```
if (next is '{') → parseValueType()
else             → parseScalarAlias()  (current behavior)
```

Both still use the `type` keyword. The CST node kinds differ: `TypeAliasDecl` vs `ValueTypeDecl`.

### 4.2 Lowering (CST → AST)

**New AST node:**

```typescript
interface ValueTypeDecl extends AstNode {
  kind: 'ValueTypeDecl'
  name: Name
  fields: ValueTypeField[]
}

interface ValueTypeField extends AstNode {
  name: Name
  type: TypeExpr
  nullable: boolean
  list: boolean
  defaultValue: Expression | null
}
```

Add `ValueTypeDecl` to the `Declaration` union.

Add `lowerValueType()` function: converts CST `ValueTypeDeclNode` → AST `ValueTypeDecl`. Extracts `nullable` from `NullableType` unwrapping (same pattern as method return types). Extracts `list` from `listSuffix` presence.

### 4.3 Resolver

- In `registerDeclaration()`: register `ValueTypeDecl` with `symbolKind: 'ValueType'`
- In `resolveDeclaration()`: resolve each field's type expression
- In `resolveTypeExpr()` for `NamedType`: add `'ValueType'` to the allowed kinds list (alongside `Scalar`, `TypeAlias`, `Interface`, `Class`)
- Cycle detection: walk value type fields, detect circular references (value type A has field of type B, B has field of type A). Emit diagnostic.

### 4.4 Validator

- Validate field names are unique within the value type
- Validate default value compatibility with field types (reuse `validateDefaultCompatibility` from attribute validation)
- No modifiers to validate

### 4.5 Serializer

- Add `serializeValueType()`: converts AST `ValueTypeDecl` → IR `ValueTypeDef`
- In `symbolToTypeRef()`: add `case 'ValueType': return { kind: 'ValueType', name }`
- In the top-level serializer, collect value type declarations into `ir.value_types`

---

## 5. Codegen Contract

### 5.1 TypeScript Interface Emission

Each value type emits a TypeScript interface:

```typescript
export interface GeoPoint {
  lat: number
  lng: number
}

export interface PageResult {
  items: Order[]
  total: number
  next_cursor?: string | null
}
```

Emitted alongside (or within) the interfaces section, before node interfaces. This ensures value types are available when node/method types reference them.

### 5.2 Zod Validator Emission

Each value type emits a Zod schema in the `validators` object:

```typescript
export const validators = {
  GeoPoint: z.object({
    lat: z.number(),
    lng: z.number(),
  }),
  PageResult: z.object({
    items: z.array(z.string()),  // Order = node ref = string
    total: z.number().int(),
    next_cursor: z.string().nullable().optional(),
  }),
  // ...existing node/edge validators...
}
```

### 5.3 TypeRef Resolution

In `resolveTypeRef()` and `resolveMethodTypeRef()`:

```typescript
case 'ValueType':
  return ref.name  // The TypeScript interface name
```

In `resolveZodTypeRef()`:

```typescript
case 'ValueType':
  return `validators.${ref.name}`  // Forward reference to the Zod schema
```

### 5.4 Schema Metadata

Value types are included in a new `valueTypes` section of the schema const:

```typescript
export const schema = {
  // ...existing...
  valueTypes: {
    GeoPoint: {
      fields: ['lat', 'lng'],
    },
    PageResult: {
      fields: ['items', 'total', 'next_cursor'],
    },
  },
} as const
```

This gives the runtime enough metadata to validate and traverse value type shapes.

### 5.5 GraphModel Extension

Add to `GraphModel`:

```typescript
interface GraphModel {
  // ...existing...
  valueTypes: Map<string, ResolvedValueType>
}

interface ResolvedValueType {
  name: string
  fields: ValueTypeField[]  // re-export from IR
}
```

The loader registers value types from `ir.value_types` into the model.

---

## 6. Edge Cases

### 6.1 Value Type with No Fields

```krl
type Empty = {}
```

Legal but useless. Emits `export interface Empty {}` and `Empty: z.object({})`. No diagnostic — consistent with empty class bodies.

### 6.2 Value Type Referencing Other Value Types

```krl
type Inner = { x: Int }
type Outer = { inner: Inner, label: String }
```

`Inner` resolves to `{ kind: 'ValueType', name: 'Inner' }`. The codegen emits:

```typescript
export interface Inner { x: number }
export interface Outer { inner: Inner; label: string }
```

Ordering: the codegen should emit value types before they're referenced, or rely on TypeScript's structural typing (no forward-declaration issue for interfaces).

### 6.3 Circular References

```krl
type A = { b: B }
type B = { a: A }
```

Error. Value types are inlined data — circular references create infinite structures. The resolver should detect and report this.

### 6.4 Value Type as Attribute Type

```krl
type Metadata = { source: String, version: Int }
class Document {
  meta: Metadata
}
```

Legal. The attribute's `TypeRef` is `{ kind: 'ValueType', name: 'Metadata' }`. The codegen emits `meta: Metadata` in the interface and `meta: validators.Metadata` in the Zod schema.

### 6.5 List Fields

```krl
type SearchResult = {
  items: Customer[],
  facets: String[]
}
```

The `[]` suffix on fields works identically to method return `[]`. The parser checks for `LBracket RBracket` after the type expression. In the IR, the field `type` is wrapped: `{ kind: 'List', element: { kind: 'Node', name: 'Customer' } }`.

### 6.6 Name Collision with Scalar Alias

```krl
type Foo = String [format: email]
type Foo = { bar: Int }
```

Error: duplicate declaration `Foo`. The resolver catches this — same as any other duplicate name.

### 6.7 Defaults on Value Type Fields

```krl
type Config = {
  retries: Int = 3,
  timeout: Int = 5000,
  verbose: Boolean = false
}
```

Legal. Defaults are serialized into the IR and used by the Zod validator:

```typescript
Config: z.object({
  retries: z.number().int().default(3),
  timeout: z.number().int().default(5000),
  verbose: z.boolean().default(false),
})
```

---

## 7. Summary of Changes

| Layer | What |
|-------|------|
| **IR** | New `value_types: ValueTypeDef[]` on `SchemaIR`, new `ValueTypeDef`/`ValueTypeField` types, new `ValueType` variant on `TypeRef` |
| **CST** | New `ValueTypeDeclNode` and `ValueTypeFieldNode` node kinds |
| **Parser** | Branch in `parseTypeAlias()` on `{` lookahead. New `parseValueType()` and `parseValueTypeField()` |
| **AST** | New `ValueTypeDecl` and `ValueTypeField` types, add to `Declaration` union |
| **Lowering** | New `lowerValueType()` and `lowerValueTypeField()` |
| **Resolver** | New `ValueType` symbol kind, resolve field types, cycle detection |
| **Validator** | Field uniqueness, default compatibility |
| **Serializer** | New `serializeValueType()`, handle `ValueType` in `symbolToTypeRef()`, add to `ir.value_types` |
| **Codegen Model** | New `valueTypes: Map<string, ResolvedValueType>` on `GraphModel` |
| **Codegen Loader** | Register value types from IR |
| **Codegen Interfaces** | Emit `export interface` for each value type |
| **Codegen Validators** | Emit `z.object({...})` for each value type |
| **Codegen Schema** | Emit `schema.valueTypes` metadata |
| **Codegen TypeRef** | Handle `ValueType` in `resolveTypeRef`, `resolveMethodTypeRef`, `resolveZodTypeRef` |
