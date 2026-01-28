# AUTH_V2 Component Architecture Analysis

## 1. First Principles: What Does an Authorization System Need?

Before looking at the current code, let's identify the **fundamental responsibilities**:

| Responsibility | Question It Answers |
|---------------|---------------------|
| **Authentication** | Who is making this request? |
| **Identity Resolution** | What internal ID maps to this external identity? |
| **Identity Composition** | How do identities relate to each other? |
| **Permission Storage** | Where are permissions stored? |
| **Access Decision** | Does this identity have this permission on this resource? |
| **Scope Restriction** | How do we limit an identity's effective permissions? |
| **Token Issuance** | How do we delegate permissions via tokens? |
| **Token Verification** | Is this token valid and trusted? |
| **Expression Representation** | How do we represent complex permission logic? |
| **Serialization** | How do we encode expressions for transport? |

---

## 2. Current Architecture Problems

### 2.1 Mixed Responsibilities

#### `expression-resolver.ts` - Three concerns in one:
```
├─ JWT Resolution (verify token → extract identity)
├─ Scope Application (intersect scopes onto expression)
└─ Security Validation (external apps can't embed raw IdP tokens)
```

#### `relay-token.ts` (KernelService) - God service:
```
├─ Token Issuance (RelayToken endpoint)
├─ Request Authentication (authenticate endpoint)
└─ Test Helpers (registerIdentity, createToken)
```

#### `token-verifier.ts` - Three components bundled:
```
├─ TokenVerifier (JWT signature/expiry/audience)
├─ IdentityRegistry ((issuer, subject) → IdentityId)
└─ IssuerKeyStore (issuer → verification key)
```

#### `access-checker.ts` - Too many jobs:
```
├─ Input Validation (Cypher injection prevention)
├─ Hot Path Decision (checkAccess → boolean)
├─ Cold Path Explanation (explainAccess → debugging info)
├─ Cypher Generation (expression → WHERE clause)
├─ Scope Validation (does scope allow principal/perm?)
├─ Type Resolution (resourceId → typeId, cached)
└─ Leaf Evaluation (query grantedAt/inheritancePath)
```

#### `grant-encoding.ts` vs `expression-resolver.ts` - Unclear boundary:
```
grant-encoding.ts:
├─ Grant ↔ UnresolvedGrant conversion
├─ resolveExpression() ← ALSO resolves expressions!
└─ Re-exports from expression-resolver.ts

expression-resolver.ts:
├─ resolve() for UnresolvedIdentityExpr
├─ resolveGrant() for UnresolvedGrant
└─ Security validation
```

Both files resolve expressions. Which is canonical?

#### `helpers.ts` vs `expr-builder.ts` - Duplicate APIs:
```
helpers.ts:      identity(), union(), intersect(), exclude(), grant()
expr-builder.ts: identity(), union(), intersect(), exclude(), grant()
```

Same function names, slightly different implementations. Confusing.

### 2.2 Unclear Layering

Current dependency graph has issues:
- `grant-encoding.ts` re-exports from `expression-resolver.ts`
- `relay-token.ts` imports from both
- No clear "this layer depends only on lower layers" structure

### 2.3 Test Code Mixed with Production

- `token-verifier.ts` has `createMockToken()` in production file
- `relay-token.ts` has test helper methods in `KernelService`
- `setup.ts` is test infrastructure but exports types used elsewhere

---

## 3. Proposed Pure Component Architecture

### Layer 0: Types (Zero Dependencies)

```
types/
├─ primitives.ts      # NodeId, IdentityId, PermissionT
├─ scope.ts           # Scope type definition
├─ expression.ts      # IdentityExpr (resolved)
├─ unresolved.ts      # UnresolvedIdentityExpr, UnresolvedGrant
├─ grant.ts           # Grant type
├─ decision.ts        # AccessDecision, AccessExplanation
└─ index.ts           # Re-exports all
```

**Rationale**: Types should be in one place with no logic. Currently `types.ts` is mostly this, but it includes `RawExecutor` interface which is infrastructure, not domain.

---

### Layer 1: Scope (Depends on: types)

```
scope/
├─ operations.ts      # intersectScopes, intersectArrays
├─ validation.ts      # scopeAllowsPerm, scopeAllowsNode, scopeAllowsPrincipal
├─ utils.ts           # deduplicateScopes, scopeToKey
└─ index.ts
```

**Single Responsibility**: Scope is a fundamental concept with its own semantics (undefined vs [] vs [values]). Deserves isolation.

**Current location**: `scope-utils.ts` - already fairly clean, just needs extraction.

---

### Layer 2: Expression (Depends on: types, scope)

```
expression/
├─ builder.ts         # Fluent API (identity, union, intersect, exclude, grant)
├─ operations.ts      # applyScopes, extractPrimaryIdentity, collectLeaves
├─ validation.ts      # validateExpression, validateCypherId
├─ compact.ts         # toCompact, fromCompact (JSON)
├─ binary.ts          # encode, decode (Uint8Array)
├─ dedup.ts           # dedup, expand, hasRepeatedSubtrees
└─ index.ts
```

**Single Responsibility**: Expression representation and manipulation. No I/O, no verification.

**Changes from current**:
- Merge `expr-builder.ts`, `expr-compact.ts`, `expr-dedup.ts`, `expr-encoding.ts`
- Move validation functions from `access-checker.ts`
- Delete `helpers.ts` expression builders (use `builder.ts` only)

---

### Layer 3: JWT (Depends on: types)

```
jwt/
├─ types.ts           # TokenPayload, VerificationResult
├─ verifier.ts        # JwtVerifier class (verify signature, expiry, audience)
├─ decoder.ts         # decodeToken (unverified inspection)
└─ index.ts
```

**Single Responsibility**: JWT cryptographic operations. No identity resolution, no business logic.

**Changes from current**:
- Extract JWT verification from `token-verifier.ts`
- Remove IdentityRegistry and IssuerKeyStore (different concerns)
- Production implementation would use real crypto; test would use mock

---

### Layer 4: Identity Registry (Depends on: types)

```
identity/
├─ registry.ts        # IdentityRegistry: (issuer, subject) → IdentityId
├─ issuer-trust.ts    # IssuerKeyStore: issuer → key, isTrusted
└─ index.ts
```

**Single Responsibility**: Mapping external identities to internal IDs. Separate from JWT verification.

**Rationale**: "Is this JWT valid?" and "What internal ID does this represent?" are different questions. You might verify a JWT is valid but not have a mapping for it (unregistered user).

---

### Layer 5: Composition (Depends on: types, expression, database)

```
composition/
├─ evaluator.ts       # IdentityEvaluator: build expression from DB edges
├─ errors.ts          # CycleDetectedError, IdentityNotFoundError, InvalidIdentityError
└─ index.ts
```

**Single Responsibility**: Fetch identity composition from database, build expression trees.

**Current location**: `identity-evaluator.ts` - already clean. Just move errors to separate file.

---

### Layer 6: Authorization (Depends on: types, expression, scope, composition, database)

```
authorization/
├─ cypher-generator.ts    # toCypher: expression → Cypher WHERE clause
├─ access-checker.ts      # checkAccess: hot path, returns boolean
├─ access-explainer.ts    # explainAccess: cold path, returns explanation
├─ type-resolver.ts       # getTargetType: resourceId → typeId (cached)
└─ index.ts
```

**Single Responsibility**:
- `cypher-generator.ts`: Pure function, expression → string
- `access-checker.ts`: Orchestrates type check + resource check, returns decision
- `access-explainer.ts`: Same logic but collects detailed info

**Changes from current**:
- Split `access-checker.ts` into three files
- Cypher generation is reusable (could be used by other tools)
- Explainer can have heavier dependencies (leaf querying) without bloating hot path

---

### Layer 7: Resolution (Depends on: jwt, identity, expression, scope)

```
resolution/
├─ expression-resolver.ts  # UnresolvedIdentityExpr → IdentityExpr (verify JWTs, apply scopes)
├─ grant-resolver.ts       # UnresolvedGrant → Grant (with defaults)
├─ security.ts             # validateGrantSecurity (external apps rule)
└─ index.ts
```

**Single Responsibility**: Convert client-side (unresolved) types to kernel-side (resolved) types.

**Changes from current**:
- Rename from `expression-resolver.ts` to make role clear
- Extract security validation to own file
- Delete `grant-encoding.ts` - its resolution logic moves here, encoding moves to expression/

---

### Layer 8: Kernel Services (Depends on: resolution, authorization)

```
kernel/
├─ relay-token.ts         # RelayToken endpoint only
├─ authenticator.ts       # Authenticate request → AuthContext
├─ types.ts               # AuthContext, KernelServiceConfig
└─ index.ts
```

**Single Responsibility**:
- `relay-token.ts`: Issue restricted tokens
- `authenticator.ts`: Verify incoming request, resolve grant, return context

**Changes from current**:
- Split `KernelService` into two services
- Remove test helpers from production code

---

### Layer 9: Client SDK (Depends on: types, expression)

```
sdk/
├─ builders.ts            # Client-side expression builders
├─ token-request.ts       # RelayTokenRequest construction
├─ jwt-helpers.ts         # createAppJwt, createUserJwt (for testing)
└─ index.ts
```

**Single Responsibility**: Client-side utilities for building requests.

**Note**: This is what apps import, not kernel internals.

---

### Layer 10: Testing (Depends on: everything)

```
testing/
├─ fixtures.ts            # seedAuthzTestData, AuthzTestData
├─ assertions.ts          # expectGranted, expectDeniedByType, expectDeniedByResource
├─ mocks.ts               # MockJwtVerifier, MockIdentityRegistry
├─ setup.ts               # FalkorDB connection, createRawExecutor
└─ index.ts
```

**Single Responsibility**: Test infrastructure. Never imported by production code.

**Changes from current**:
- Move all test helpers here
- `createMockToken`, `createTestVerifier` → `mocks.ts`
- Test assertions from `helpers.ts` → `assertions.ts`

---

## 4. Proposed Directory Structure

```
authz-v2/
├─ types/
│   ├─ primitives.ts
│   ├─ scope.ts
│   ├─ expression.ts
│   ├─ unresolved.ts
│   ├─ grant.ts
│   ├─ decision.ts
│   └─ index.ts
│
├─ scope/
│   ├─ operations.ts
│   ├─ validation.ts
│   └─ index.ts
│
├─ expression/
│   ├─ builder.ts
│   ├─ operations.ts
│   ├─ validation.ts
│   ├─ compact.ts
│   ├─ binary.ts
│   ├─ dedup.ts
│   └─ index.ts
│
├─ jwt/
│   ├─ types.ts
│   ├─ verifier.ts
│   ├─ decoder.ts
│   └─ index.ts
│
├─ identity/
│   ├─ registry.ts
│   ├─ issuer-trust.ts
│   └─ index.ts
│
├─ composition/
│   ├─ evaluator.ts
│   ├─ errors.ts
│   └─ index.ts
│
├─ authorization/
│   ├─ cypher-generator.ts
│   ├─ access-checker.ts
│   ├─ access-explainer.ts
│   ├─ type-resolver.ts
│   └─ index.ts
│
├─ resolution/
│   ├─ expression-resolver.ts
│   ├─ grant-resolver.ts
│   ├─ security.ts
│   └─ index.ts
│
├─ kernel/
│   ├─ relay-token.ts
│   ├─ authenticator.ts
│   ├─ types.ts
│   └─ index.ts
│
├─ sdk/
│   ├─ builders.ts
│   ├─ token-request.ts
│   └─ index.ts
│
├─ testing/
│   ├─ fixtures.ts
│   ├─ assertions.ts
│   ├─ mocks.ts
│   ├─ setup.ts
│   └─ index.ts
│
├─ index.ts               # Public API
└─ docs/
    └─ *.md
```

---

## 5. Dependency Graph (Clean Layering)

```
Layer 0: types/
    ↑
Layer 1: scope/
    ↑
Layer 2: expression/
    ↑
Layer 3: jwt/          identity/
    ↑                      ↑
Layer 4: composition/ (+ database)
    ↑
Layer 5: authorization/ (+ database)
    ↑
Layer 6: resolution/
    ↑
Layer 7: kernel/
    ↑
Layer 8: sdk/ (client-side only)

Layer X: testing/ (can import anything)
```

**Rule**: Each layer can only import from layers below it. No lateral imports within the same layer (except through index.ts).

---

## 6. Key Decisions to Make

### 6.1 Where does scope application live?

**Option A**: In `expression/operations.ts` (pure transformation)
**Option B**: In `resolution/` (part of resolution flow)

**Recommendation**: Option A. `applyScopes(expr, scopes)` is a pure function that transforms expressions. It doesn't need JWT verification or identity resolution.

### 6.2 Where does security validation live?

**Option A**: In `resolution/security.ts` (called during resolution)
**Option B**: In `kernel/authenticator.ts` (called during authentication)

**Recommendation**: Option A. Security rules ("external apps can't embed raw IdP tokens") are about the structure of grants, not about kernel orchestration.

### 6.3 Should Cypher generation be in authorization/ or expression/?

**Option A**: `expression/cypher.ts` - it's just serialization
**Option B**: `authorization/cypher-generator.ts` - it's authorization-specific

**Recommendation**: Option B. Cypher generation is tightly coupled to how we check permissions (hasParent traversal, perm property, etc.). It's not general-purpose expression serialization.

### 6.4 What's the canonical way to build expressions?

**Current**: Two APIs (`expr-builder.ts` and `helpers.ts`)
**Recommendation**: One API in `expression/builder.ts`. Delete duplicate.

### 6.5 Should IdentityEvaluator use memoization?

**Current**: No memoization (diamonds re-evaluate)
**Recommendation**: Add optional memoization. The evaluator instance can hold a cache that's cleared between requests.

---

## 7. Migration Path

### Phase 1: Extract Types
1. Create `types/` directory
2. Split `types.ts` into domain-specific files
3. Update imports

### Phase 2: Extract Scope
1. Create `scope/` directory
2. Move `scope-utils.ts` content
3. Update imports

### Phase 3: Consolidate Expression
1. Create `expression/` directory
2. Move `expr-builder.ts`, `expr-compact.ts`, `expr-dedup.ts`, `expr-encoding.ts`
3. Move validation from `access-checker.ts`
4. Delete expression builders from `helpers.ts`

### Phase 4: Extract JWT & Identity
1. Create `jwt/` and `identity/` directories
2. Split `token-verifier.ts`
3. Update imports

### Phase 5: Keep Composition
1. Create `composition/` directory
2. Move `identity-evaluator.ts` (minimal changes)

### Phase 6: Split Authorization
1. Create `authorization/` directory
2. Extract `cypher-generator.ts` from `access-checker.ts`
3. Extract `access-explainer.ts` from `access-checker.ts`
4. Slim down `access-checker.ts`

### Phase 7: Consolidate Resolution
1. Create `resolution/` directory
2. Merge `expression-resolver.ts` and resolution parts of `grant-encoding.ts`
3. Extract security validation

### Phase 8: Split Kernel
1. Create `kernel/` directory
2. Split `relay-token.ts` (KernelService) into `relay-token.ts` + `authenticator.ts`

### Phase 9: Create SDK
1. Create `sdk/` directory
2. Move client-side helpers

### Phase 10: Isolate Testing
1. Create `testing/` directory
2. Move all test infrastructure
3. Remove test helpers from production files

---

## 8. Open Questions for Review

1. **Is the layer separation correct?** Does jwt/ belong at the same level as identity/, or should one depend on the other?

2. **Should composition/ depend on database directly?** Currently it does (RawExecutor). Alternative: pass in a `CompositionFetcher` interface.

3. **Is resolution/ the right name?** Alternatives: `token-processing/`, `grant-resolution/`, `client-to-kernel/`

4. **Should we have a separate `database/` layer?** To abstract FalkorDB specifics.

5. **What's the public API surface?** Should `index.ts` export everything, or have separate entry points for kernel vs client?

6. **Should expression builders be sync or async?** Currently sync (just build data structures). But `evalExpr` is async. Is this confusing?
