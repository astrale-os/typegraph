# Expression Domain - High-Level Specification

## 1. Overview

The **expression domain** covers all pure data structures and transforms related to `IdentityExpr` — the recursive binary tree that represents identity composition. This domain has **zero I/O**: no database queries, no network calls, no authentication.

### 1.1 Role in the System

```
┌────────────────────────────────────────────────────────────────────┐
│                        expression/                                  │
│                                                                     │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  builder.ts      │  │  scope.ts     │  │  encoding.ts          │ │
│  │  Build & compose │  │  Intersect &  │  │  Compact JSON +       │ │
│  │  expressions     │  │  validate     │  │  binary varint        │ │
│  └─────────────────┘  └──────────────┘  └───────────────────────┘ │
│                                                                     │
│  ┌─────────────────┐  ┌───────────────────────────────────────────┐│
│  │  dedup.ts        │  │  validation.ts                           ││
│  │  Structural      │  │  Safe ID regex, depth limits,            ││
│  │  deduplication   │  │  exhaustive checks                       ││
│  └─────────────────┘  └───────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────┘
         │                       │                     │
         ▼                       ▼                     ▼
   authentication/         authorization/          adapters/
   (resolve JWTs)         (evaluate access)       (Cypher gen)
```

### 1.2 Core Type: IdentityExpr

```typescript
type IdentityExpr =
  | { kind: 'identity'; id: IdentityId; scopes?: Scope[] }
  | { kind: 'union'; left: IdentityExpr; right: IdentityExpr }
  | { kind: 'intersect'; left: IdentityExpr; right: IdentityExpr }
  | { kind: 'exclude'; left: IdentityExpr; right: IdentityExpr }
```

A recursive binary tree with four node kinds:
- **identity**: Leaf node. A single identity (user, role, app) with optional scope restrictions.
- **union**: `A ∪ B` — grants access if either A or B grants access.
- **intersect**: `A ∩ B` — grants access only if both A and B grant access.
- **exclude**: `A \ B` — grants access if A grants but B does not.

### 1.3 Design Principles

- **Pure data, no I/O**: Every function is a transform from expression to expression (or to bytes, JSON, etc.)
- **Immutable**: Builders return new instances, never mutate
- **Round-trip safe**: All encodings round-trip exactly: `decode(encode(expr)) === expr`
- **Depth-bounded**: All recursive operations enforce a maximum depth (100) to prevent stack overflow

---

## 2. Builder API

### 2.1 Architecture

```
ExprBuilder (interface)
  └── Expr (abstract base)
       ├── IdentityExprBuilder (leaf)
       ├── BinaryExpr (union/intersect/exclude)
       └── RawExpr (wrap existing IdentityExpr)
```

All builders implement `ExprBuilder.build(): IdentityExpr`. Composition methods (`.union()`, `.intersect()`, `.exclude()`) are on the `Expr` base class, enabling method chaining.

### 2.2 Factory Functions

| Function | Signature | Semantics |
|----------|-----------|-----------|
| `identity(id, scopes?)` | `(string, Scope \| Scope[]) → IdentityExprBuilder` | Create leaf node |
| `id(...)` | Alias for `identity()` | Shorter form |
| `raw(expr)` | `(IdentityExpr) → Expr` | Wrap resolved expression for chaining |
| `union(...exprs)` | `(...Expr[]) → Expr` | Variadic: `((a ∪ b) ∪ c)` |
| `intersect(...exprs)` | `(...Expr[]) → Expr` | Variadic: `((a ∩ b) ∩ c)` |
| `exclude(base, excluded)` | `(Expr, Expr) → Expr` | Binary only: `base \ excluded` |
| `grant(forType, forResource)` | `(Expr, Expr) → GrantBuilder` | Build Grant object |

### 2.3 Method Chaining

```typescript
identity("USER1")
  .union(identity("ROLE_EDITOR"))
  .intersect(identity("TENANT_MEMBER"))
  .exclude(identity("SUSPENDED"))
  .build()
```

Produces:

```
exclude(
  intersect(
    union(
      identity("USER1"),
      identity("ROLE_EDITOR")
    ),
    identity("TENANT_MEMBER")
  ),
  identity("SUSPENDED")
)
```

Note: Chaining is left-associative. `a.union(b).intersect(c)` = `intersect(union(a, b), c)`.

### 2.4 Scope Restriction

Scopes are added to identity leaves via `.restrict()`:

```typescript
identity("USER1").restrict({ nodes: ["workspace-1"] })
identity("USER1").restrict({ perms: ["read", "write"] })
identity("USER1")
  .restrict({ nodes: ["ws-1"] })
  .restrict({ perms: ["read"] })
// Two scopes (OR'd together)
```

`.restrict()` is immutable: returns a new `IdentityExprBuilder` with the additional scope.

### 2.5 RawExpr: Mixing Builders and Resolved Expressions

When an expression has already been resolved (e.g., from the identity evaluator), `raw()` wraps it for use with builders:

```typescript
const resolved = await evaluator.evalIdentity("USER1")
// resolved: { kind: 'union', left: { id: 'USER1' }, right: { id: 'ROLE1' } }

const composed = raw(resolved).intersect(identity("TENANT_MEMBER"))
const result = composed.build()
```

### 2.6 GrantBuilder

Combines `forType` and `forResource` expressions into a `Grant`:

```typescript
const g = grant(identity("APP1"), userExpr)
const rawGrant = g.build()
// { forType: { kind: 'identity', id: 'APP1' },
//   forResource: { kind: 'union', ... } }
```

### 2.7 applyScopes (Builder Utility)

Adds a scope to ALL identity leaves in an expression tree:

```typescript
function applyScopes(expr: IdentityExpr, scope: Scope): IdentityExpr
```

This **concatenates** (appends) the scope to each leaf's scope array. This is the builder-level operation. It differs from `applyTopLevelScopes` in the authentication domain, which uses scope **intersection** for security enforcement.

| Operation | Method | Semantics | Used By |
|-----------|--------|-----------|---------|
| `applyScopes` (builder) | Concatenation | Adds scope to all leaves | SDK, tests |
| `applyTopLevelScopes` (authentication) | Intersection | Restricts all leaves | Kernel (relay token) |

---

## 3. Scope Operations

### 3.1 Scope Type

```typescript
type Scope = {
  nodes?: NodeId[]          // Restrict to subtrees (AND with other dimensions)
  perms?: PermissionT[]     // Restrict permission types
  principals?: IdentityId[] // Restrict who can invoke
}
```

### 3.2 Semantic Conventions

| Value | Meaning |
|-------|---------|
| `undefined` (field absent) | Unrestricted in this dimension |
| `[]` (empty array) | Nothing allowed in this dimension (deny) |
| `[...values]` | Only these values allowed |

| Context | Meaning |
|---------|---------|
| `scopes: undefined` on a leaf | No scope restrictions (unrestricted) |
| `scopes: []` on a leaf | No valid scopes = deny all (impossible after intersection) |
| `scopes: [{...}, {...}]` on a leaf | Multiple scopes, OR'd together |

### 3.3 Intersection Functions

#### `intersectArrays<T>(a, b): T[] | undefined`

Intersect two dimension arrays:

```
undefined ∩ undefined = undefined   (both unrestricted)
undefined ∩ B        = B            (one restricts)
A ∩ undefined        = A            (one restricts)
A ∩ B                = A.filter(x => B.has(x))  (set intersection)
```

#### `intersectScope(a, b): Scope | null`

Intersect two individual scopes. Returns `null` if any dimension produces an empty array:

```
intersectScope(
  { nodes: ['ws-1', 'ws-2'], perms: ['read', 'write'] },
  { nodes: ['ws-1'],         perms: ['read'] }
)
→ { nodes: ['ws-1'], perms: ['read'] }

intersectScope(
  { perms: ['read'] },
  { perms: ['write'] }
)
→ null  (perms intersection is empty)
```

#### `intersectScopes(a, b): Scope[]`

Intersect two scope arrays. Since multiple scopes are OR'd, intersection requires **pairwise** computation:

```
For each scopeA in a:
  For each scopeB in b:
    result = intersectScope(scopeA, scopeB)
    if result !== null: keep it

Deduplicate results.
```

**Empty array semantics**:
- `intersectScopes([], anything)` → returns `anything` (empty = unrestricted)
- `intersectScopes(anything, [])` → returns `anything`

This is counterintuitive but correct: an empty scope array means "no restrictions", not "deny all". The denial case is `scopes: []` on a leaf (no valid scopes remain after intersection).

### 3.4 Scope Validation Functions

| Function | Purpose |
|----------|---------|
| `scopeAllowsPerm(scope, perm)` | Does this scope allow this permission? |
| `scopeAllowsNode(scope, node)` | Does this scope allow this node? |
| `scopeAllowsPrincipal(scope, principal)` | Does this scope allow this principal? |
| `scopesAllow(scopes, params)` | Do any scopes in the array allow the given parameters? |

`scopesAllow` handles the three-valued semantics:
- `scopes === undefined` → `true` (unrestricted)
- `scopes === []` → `false` (no valid scopes = deny)
- `scopes === [{...}]` → check each scope, any passing = `true`

### 3.5 Deduplication

`deduplicateScopes(scopes)` removes structurally identical scopes using a deterministic string key:

```
key = "n:{sorted nodes}|p:{sorted perms}|pr:{sorted principals}"
```

---

## 4. Encoding Pipeline

Expressions can be encoded in multiple formats for different use cases. Each stage is optional and composable:

```
IdentityExpr
  │
  ├──► toCompact() ──► CompactExpr (JSON arrays)
  │                      │
  │                      ├──► toCompactJSON() ──► string
  │                      │
  │                      └──► fromCompact() ──► IdentityExpr
  │
  ├──► dedup() ──► DedupedExpr (defs + root with $ref)
  │                  │
  │                  └──► expand() ──► IdentityExpr
  │
  └──► encode() ──► Uint8Array (binary varint)
                      │
                      ├──► encodeBase64() ──► string
                      │
                      └──► decode() ──► IdentityExpr | DedupedExpr
```

### 4.1 Compact JSON Encoding

Reduces verbose `IdentityExpr` to compact JSON arrays:

| Verbose | Compact |
|---------|---------|
| `{ kind: 'identity', id: 'X' }` | `['i', 'X']` |
| `{ kind: 'identity', id: 'X', scopes: [...] }` | `['i', 'X', [{n: [...], p: [...], r: [...]}]]` |
| `{ kind: 'union', left, right }` | `['u', left, right]` |
| `{ kind: 'intersect', left, right }` | `['n', left, right]` |
| `{ kind: 'exclude', left, right }` | `['x', left, right]` |

**Scope abbreviations**: `nodes` → `n`, `perms` → `p`, `principals` → `r`

**Safety**: Max depth 100, validated on decode. Invalid structures throw.

### 4.2 Structural Deduplication

Finds repeated subtrees in an expression and replaces them with `$ref` references:

```typescript
// Input: shared subtree appears twice
const shared = union(identity("A"), identity("B")).build()
const expr = intersect(raw(shared), exclude(raw(shared), identity("C"))).build()

// After dedup:
{
  defs: [
    { kind: 'union', left: { id: 'A' }, right: { id: 'B' } }
  ],
  root: {
    kind: 'intersect',
    left: { $ref: 0 },
    right: {
      kind: 'exclude',
      left: { $ref: 0 },
      right: { kind: 'identity', id: 'C' }
    }
  }
}
```

#### Algorithm

1. **Count subtrees**: Walk the tree, hash each subtree, count occurrences, track child relationships
2. **Find duplicates**: Filter to subtrees appearing 2+ times, sort by hash length (largest first)
3. **Extract definitions**: Add to `defs` array, skipping subtrees that are children of already-included subtrees (avoids redundant extraction)
4. **Replace with refs**: Walk the tree again, replacing duplicate subtrees with `{ $ref: index }`

#### Hashing

Uses length-prefixed IDs to avoid false substring matches:

```
identity("A")     → "i[1]:A:"
identity("AB")    → "i[2]:AB:"
union(A, B)       → "u:(hashA):(hashB)"
```

#### Utilities

| Function | Purpose |
|----------|---------|
| `dedup(expr)` | Extract repeated subtrees into definitions |
| `expand(deduped)` | Restore full expression from definitions + refs |
| `hasRepeatedSubtrees(expr)` | Check if dedup would help |
| `dedupStats(expr)` | Get statistics: total/unique/duplicate/savings% |

### 4.3 Binary Varint Encoding

Zero-dependency binary encoding for maximum compression (~79% size reduction vs verbose JSON).

#### Type Tags

| Tag | Meaning |
|-----|---------|
| `0x01` | Identity (no scopes) |
| `0x02` | Identity (with scopes) |
| `0x10` | Union |
| `0x11` | Intersect |
| `0x12` | Exclude |
| `0x20` | Reference ($ref for deduped) |
| `0x30` | Deduped wrapper (defs + root) |

#### Scope Encoding

Each scope is encoded with a flags byte:

| Flag | Meaning |
|------|---------|
| `0x01` | Has nodes |
| `0x02` | Has perms |
| `0x04` | Has principals |

Each flag-enabled dimension: varint count + varint-prefixed strings.

#### Wire Format

```
Identity (no scopes):   TAG_IDENTITY + varint(len) + utf8(id)
Identity (with scopes): TAG_IDENTITY_SCOPED + varint(len) + utf8(id) + varint(scopeCount) + scopes...
Binary node:            TAG_UNION/INTERSECT/EXCLUDE + left + right
Reference:              TAG_REF + varint(refIndex)
Deduped:                TAG_DEDUPED + varint(defCount) + defs... + root
```

Strings are varint-length-prefixed UTF-8. Integers use unsigned varint encoding (7 bits per byte, MSB = continuation).

#### Safety

- Varint limited to 5 bytes (35 bits) to prevent data corruption attacks
- String length validated against remaining buffer
- Buffer must be fully consumed (trailing bytes = error)

#### API

| Function | Input | Output |
|----------|-------|--------|
| `encode(expr)` | `IdentityExpr \| DedupedExpr` | `Uint8Array` |
| `decode(bytes)` | `Uint8Array` | `IdentityExpr \| DedupedExpr` |
| `encodeBase64(expr)` | `IdentityExpr \| DedupedExpr` | `string` |
| `decodeBase64(base64)` | `string` | `IdentityExpr \| DedupedExpr` |
| `compareSizes(expr)` | `IdentityExpr` | `{ verbose, compact, binary, binaryBase64 }` |

### 4.4 Size Comparison

For a typical expression (`union(identity("USER1"), identity("ROLE_EDITOR"))`):

| Format | Example Size | Relative |
|--------|-------------|----------|
| Verbose JSON | ~120 bytes | 100% |
| Compact JSON | ~40 bytes | ~33% |
| Binary | ~25 bytes | ~21% |
| Binary Base64 | ~34 bytes | ~28% |

---

## 5. Unresolved Expression Builders

The expression domain also provides builders for `UnresolvedIdentityExpr` (pre-resolution expressions with JWT or plain ID leaves). These are used by the SDK and authentication domain.

### 5.1 Builder Functions

| Function | Purpose |
|----------|---------|
| `unresolvedJwt(jwt, scopes?)` | Create leaf from JWT token |
| `unresolvedId(id, scopes?)` | Create leaf from plain ID (kernel-only) |
| `unresolvedUnion(left, right)` | Union of unresolved expressions |
| `unresolvedIntersect(left, right)` | Intersect of unresolved expressions |
| `unresolvedExclude(left, right)` | Exclude of unresolved expressions |
| `createUnresolvedGrant(forType?, forResource?)` | Build unresolved grant |

### 5.2 Conversion

| Function | Direction |
|----------|-----------|
| `identityExprToUnresolved(expr)` | `IdentityExpr → UnresolvedIdentityExpr` |
| `encodeGrant(grant)` | `Grant → UnresolvedGrant` |

These are used when re-encoding a resolved expression into a JWT payload (e.g., for relay tokens).

### 5.3 Validation

| Function | Purpose |
|----------|---------|
| `validateUnresolvedGrant(grant)` | Assert grant structure is valid |
| `validateUnresolvedExpr(expr, path)` | Assert expression structure is valid |

Validation rules:
- Identity leaves must have exactly one of `jwt` or `id` (not both, not neither)
- Binary nodes must have `left` and `right`
- `kind` must be one of: `identity`, `union`, `intersect`, `exclude`
- Scopes, if present, must be arrays

---

## 6. Target File Layout

```
expression/
├── builder.ts        # Fluent API: identity(), union(), intersect(), exclude(), grant()
│                     # Also: unresolvedJwt(), unresolvedId(), etc.
│                     # Also: GrantBuilder, RawExpr, applyScopes()
│
├── scope.ts          # intersectScopes(), intersectScope(), intersectArrays()
│                     # scopeAllowsPerm/Node/Principal(), scopesAllow()
│                     # deduplicateScopes(), scopeToKey()
│
├── encoding.ts       # Compact JSON: toCompact(), fromCompact(), toCompactJSON(), fromCompactJSON()
│                     # Binary varint: encode(), decode(), encodeBase64(), decodeBase64()
│                     # BufferWriter, BufferReader, compareSizes()
│
├── dedup.ts          # dedup(), expand(), hasRepeatedSubtrees(), dedupStats()
│                     # Ref, RefExpr, DedupedExpr, isRef(), isDedupedExpr()
│
├── validation.ts     # validateCypherId(), validateExpression(), validateScopes()
│                     # validateAccessInputs(), throwExhaustiveCheck()
│                     # validateUnresolvedGrant(), validateUnresolvedExpr()
│
└── index.ts          # Re-exports
```

---

## 7. Dependencies

```
expression/ depends on:
  └── kernel/core/auth/authn.types.ts   (IdentityExpr, Scope, Grant types)
  └── kernel/core/auth/permissions.ts   (PermissionT)

expression/ is depended on by:
  ├── authentication/   (scope intersection, expression types)
  ├── authorization/    (scope validation, expression types)
  ├── adapters/         (Cypher generation from expressions)
  └── sdk/              (builder API)
```

**Rule**: Zero I/O. No database queries, no network calls, no JWT verification.

---

## 8. Open Questions

1. **Scope location**: Should scope operations live in `expression/scope.ts` or be a sibling module? They're pure transforms heavily used by both expression building and authorization evaluation. Currently tentatively placed in `expression/`.

2. **Builder vs unresolved split**: Should unresolved expression builders be in `expression/builder.ts` alongside resolved builders, or in a separate `expression/unresolved.ts`? They serve different audiences (SDK builds unresolved, core builds resolved).

3. **Encoding composition**: Should compact JSON and binary varint be in the same file (`encoding.ts`) or split (`compact.ts` + `binary.ts`)? They're independent encodings but share the same domain.
