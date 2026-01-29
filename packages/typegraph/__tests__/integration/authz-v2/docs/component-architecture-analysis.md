# AUTH_V2 Component Architecture

## 1. Existing Kernel Architecture

The kernel already defines the boundaries:

```
kernel/
├── core/auth/
│   ├── authn.types.ts        # AuthOrigin, Scope, IdentityExpr, Grant, AuthContext
│   ├── authz.types.ts        # AccessDecision, AccessExplanation, PhaseExplanation, LeafEvaluation
│   └── permissions.ts        # Permission constants (READ, EDIT, USE, SHARE), PermissionT
│
├── ports/domain/
│   └── identity.port.ts      # IdentityPort = IdentityMutationPort + IdentityQueryPort
│
└── toolkit/src/adapters/
    └── in-memory/
        ├── memory-identity.adapter.ts
        └── memory-authz.adapter.ts
```

### The Port IS the Contract

```typescript
interface IdentityMutationPort {
  // Lifecycle
  createIdentity, bindIdentity, freezeIdentity, unfreezeIdentity, deleteIdentity

  // Access Control
  grantAccess, revokeAccess, mintRelayToken

  // Composition
  extendIdentity      // unionWith
  constrainIdentity   // intersectWith
  excludeIdentity     // excludeWith
  removeComposition
}

interface IdentityQueryPort {
  findIdentity        // (iss, sub) → IdentityId
  checkAccess         // Hot path → AccessDecision
  explainAccess       // Cold path → AccessExplanation
  getIdentity         // → IdentityMetadata
}

interface IdentityPort extends IdentityMutationPort, IdentityQueryPort {}
```

All authz-v2 logic serves this port. There are no invented abstractions.

### Naming Convention

| Port vocabulary | authz-v2 prototype | Graph edge |
|----------------|-------------------|------------|
| `extendIdentity` | `unionWith` | `:unionWith` |
| `constrainIdentity` | `intersectWith` | `:intersectWith` |
| `excludeIdentity` | `excludeWith` | `:excludeWith` |

> **Decision**: Standardized on `exclude` with `left`/`right` fields. Core types will be updated from `except`/`base`/`excluded` to match.

---

## 2. Current Prototype: What Exists

169 functions/methods/types across 13 files in `authz-v2/`. Here's where each one actually belongs:

### By Concern

| Concern | Count | Current files |
|---------|-------|---------------|
| **expression** | 39 | expr-builder, expr-compact, expr-dedup, expr-encoding, parts of access-checker |
| **authorization** | 37 | access-checker, scope-utils, parts of expression-resolver |
| **authentication** | 25 | token-verifier, expression-resolver, grant-encoding, parts of restrict-token |
| **adapter** | 17 | identity-evaluator (entirely), parts of access-checker, setup |
| **sdk** | 29 | expr-builder, parts of access-checker, parts of types |
| **testing** | 22 | helpers, setup, parts of token-verifier, parts of restrict-token |

### Specific Problems

| File | Problem |
|------|---------|
| `access-checker.ts` | Contains authorization logic + Cypher generation (adapter) + input validation (sdk) + scope checking (expression) |
| `identity-evaluator.ts` | `fetchIdentity()` is adapter concern (DB query), rest is authorization |
| `expression-resolver.ts` | Mixes authentication (JWT resolution) + authorization (scope application) + security |
| `grant-encoding.ts` | Overlaps with expression-resolver; both resolve expressions |
| `token-verifier.ts` | Mixes authentication (verifier) + testing (mock token creation) |
| `restrict-token.ts` | God service: token issuance + request auth + test helpers |
| `helpers.ts` vs `expr-builder.ts` | Duplicate expression builders with same function names |
| `scope-utils.ts` | Pure scope operations mixed into standalone file; belongs in expression/ |

---

## 3. Target Architecture

Four domains + adapter + testing:

```
kernel/core/auth/
├── expression/                  # Pure data structures & transforms (no I/O)
├── authentication/              # Who are you? (JWT, identity, token issuance)
├── authorization/               # Can you do this? (composition, access checking)
│
├── authn.types.ts               # (existing - shared types)
├── authz.types.ts               # (existing - shared types)
└── permissions.ts               # (existing)

kernel/toolkit/src/adapters/
└── falkordb/
    └── identity.adapter.ts     # Implements IdentityPort (Cypher + composition logic lives here)

sdk/                             # Reusable client code (folder, not a separate package yet)

testing/                         # Test infrastructure (FalkorDB in Docker, no in-memory adapter)
```

---

## 4. expression/ — Pure, No I/O

Everything about the `IdentityExpr` data structure and `Scope` operations. Used by core, adapters, AND sdk.

### Files

```
expression/
├── builder.ts        # Fluent API for building expressions
├── scope.ts          # Scope intersection, validation, deduplication
├── encoding.ts       # Compact JSON + binary varint encoding
├── dedup.ts          # Structural deduplication (subtree extraction)
├── validation.ts     # Validate expression trees (safe IDs, depth limits)
└── index.ts
```

### What Moves Here

| From | Functions | To |
|------|-----------|-----|
| `expr-builder.ts` | identity(), union(), intersect(), exclude(), grant(), applyScopes(), GrantBuilder, ExprBuilder | `builder.ts` |
| `scope-utils.ts` | intersectScopes(), intersectArrays(), scopeAllowsPerm/Node/Principal(), scopesAllow(), deduplicateScopes() | `scope.ts` |
| `expr-compact.ts` | toCompact(), fromCompact(), toCompactJSON(), fromCompactJSON() | `encoding.ts` |
| `expr-encoding.ts` | encode(), decode(), encodeBase64(), decodeBase64(), BufferWriter/Reader | `encoding.ts` |
| `expr-dedup.ts` | dedup(), expand(), hasRepeatedSubtrees(), dedupStats() | `dedup.ts` |
| `access-checker.ts` | validateCypherId(), validateExpression(), validateScopes(), validateAccessInputs() | `validation.ts` |
| `grant-encoding.ts` | unresolvedJwt(), unresolvedId(), unresolvedUnion/Intersect/Exclude(), createUnresolvedGrant() | `builder.ts` (unresolved section) |

### Rules

- **Zero I/O**. No database queries, no network calls.
- **Zero auth logic**. No JWT verification, no identity resolution.
- Depends only on type definitions from `kernel/core/auth/`.

---

## 5. authentication/ — Who Are You?

JWT verification, identity resolution, token issuance, trust boundary enforcement.

### Files

```
authentication/
├── jwt.ts            # JWT verification (signature, expiry, audience)
├── registry.ts       # IdentityRegistry: (iss, sub) → IdentityId
├── issuer-trust.ts   # IssuerKeyStore: issuer → key, isTrusted()
├── resolver.ts       # UnresolvedExpr → Expr (verify JWTs, apply scopes)
├── security.ts       # Trust boundary rules (external apps can't embed raw IdP tokens)
├── token-issuer.ts   # RelayToken: resolve expression → issue kernel-signed JWT
├── authenticator.ts  # Authenticate request: verify JWT → resolve grant → AuthContext
└── index.ts
```

### What Moves Here

| From | Functions | To |
|------|-----------|-----|
| `token-verifier.ts` | TokenVerifier.verify(), verifyKernelIssued(), decodeToken() | `jwt.ts` |
| `token-verifier.ts` | IdentityRegistry, register(), resolve(), resolveOrThrow() | `registry.ts` |
| `token-verifier.ts` | IssuerKeyStore, registerIssuer(), getKey(), isTrusted() | `issuer-trust.ts` |
| `expression-resolver.ts` | ExpressionResolver.resolve(), resolveExpr(), resolveIdentity(), resolveJwtIdentity() | `resolver.ts` |
| `expression-resolver.ts` | validateGrantSecurity(), validateExpressionSecurity() | `security.ts` |
| `expression-resolver.ts` | applyTopLevelScopes(), extractPrimaryIdentity() | `resolver.ts` |
| `grant-encoding.ts` | resolveExpression(), decodeGrant(), identityExprToUnresolved(), encodeGrant() | `resolver.ts` |
| `grant-encoding.ts` | validateUnresolvedGrant(), validateUnresolvedExpr() | `security.ts` |
| `restrict-token.ts` | KernelService.relayToken() | `token-issuer.ts` |
| `restrict-token.ts` | KernelService.authenticate() | `authenticator.ts` |

### Rules

- Depends on `expression/` for type manipulation.
- Calls ports for identity lookup (IdentityRegistry is a port implementation detail).
- **No database queries**. No Cypher. No FalkorDB.

---

## 6. authorization/ — Can You Do This?

Permission evaluation, access decision logic. Pure authorization rules — no composition, no DB queries.

### Files

```
authorization/
├── checker.ts        # checkAccess: two-phase type+resource check (hot path)
├── explainer.ts      # explainAccess: detailed reasoning (cold path)
└── index.ts
```

### What Moves Here

| From | Functions | To |
|------|-----------|-----|
| `access-checker.ts` | AccessChecker.checkAccess(), evaluateGranted() | `checker.ts` |
| `access-checker.ts` | AccessChecker.explainAccess(), explainPhase(), collectLeaves(), queryLeafDetails() | `explainer.ts` |
| `access-checker.ts` | scopePasses(), checkFilter(), scopesAllow() | `checker.ts` (scope evaluation in authorization context) |

### What Does NOT Live Here

- **Identity composition** (`IdentityEvaluator`, `evalIdentity()`, cycle detection) → **adapter** (composition is how the adapter resolves identity graphs; it's tightly coupled to the storage model)
- `fetchIdentity()` → adapter (it's a DB query)
- `toCypher()`, `identityToCypher()` → adapter (Cypher generation)
- `executeCheck()` → adapter (DB query execution)
- `getTargetType()` → adapter (DB lookup)

### Rules

- Depends on `expression/` for types and scope operations.
- **Receives resolved expressions**, doesn't build them. The adapter is responsible for resolving identity composition before handing to authorization.
- **No Cypher.** Authorization defines WHAT to check, adapter defines HOW to check.
- **No composition logic.** The identity evaluator is the adapter's responsibility entirely — it will be made very clean inside the adapter.

---

## 7. Adapter — Cypher + Composition Live Here

The adapter implements `IdentityPort` using FalkorDB + Cypher. Identity composition (expression tree building from graph edges) is the adapter's responsibility — it's tightly coupled to how identities are stored and traversed.

### Files

```
adapters/falkordb/
├── identity.adapter.ts    # Implements IdentityPort, orchestrates everything
├── composition.ts         # IdentityEvaluator: build expression trees from graph composition edges
├── cypher.ts              # Expression → Cypher WHERE clause generation
├── queries.ts             # Named Cypher query templates
└── index.ts
```

### What Moves Here

| From | Functions | To |
|------|-----------|-----|
| `identity-evaluator.ts` | IdentityEvaluator.evalIdentity(), evalExpr(), resolveExpr() | `composition.ts` |
| `identity-evaluator.ts` | CycleDetectedError, IdentityNotFoundError, InvalidIdentityError | `composition.ts` |
| `identity-evaluator.ts` | fetchIdentity(), FETCH_IDENTITY_QUERY | `composition.ts` / `queries.ts` |
| `access-checker.ts` | toCypher(), identityToCypher() | `cypher.ts` |
| `access-checker.ts` | executeCheck(), getTargetType() | `identity.adapter.ts` |
| `setup.ts` | createRawExecutor(), createFalkorDBConnection(), createIndexes(), clearDatabase() | `identity.adapter.ts` / infrastructure |

### How It Connects

```typescript
// adapters/falkordb/identity.adapter.ts

class FalkorDBIdentityAdapter implements IdentityPort {
  // Composition logic lives in the adapter (graph-native)
  private composition: IdentityEvaluator
  // Cypher generation is adapter-specific
  private cypher: CypherGenerator

  async checkAccess(params) {
    // 1. Resolve identity composition from graph (adapter concern)
    const resolvedExpr = await this.composition.evalExpr(params.grant.resource)
    // 2. Generate Cypher (adapter concern)
    const query = this.cypher.buildCheckQuery(resolvedExpr, params.nodeId, params.perm)
    // 3. Execute against FalkorDB (adapter concern)
    const result = await this.graph.query(query)
    // 4. Interpret result (core concern)
    return interpretResult(result)
  }

  async extendIdentity(params) {
    // Create unionWith edge in FalkorDB
    await this.graph.query(
      `MATCH (a:Identity {id: $id}), (b:Identity {id: $with})
       CREATE (a)-[:unionWith]->(b)`,
      params
    )
  }
}
```

### Why Composition Lives in the Adapter

The identity evaluator traverses graph edges (`unionWith`, `intersectWith`, `excludeWith`) and fetches composition data via Cypher queries. This is fundamentally a storage-specific operation:
- The graph traversal pattern is FalkorDB-specific
- The query format is Cypher-specific
- The optimization strategies (batch fetch, list comprehensions) are adapter-specific
- A different adapter (e.g., SQL-based) would resolve composition completely differently

The adapter will make this clean: composition is just one part of how the adapter implements `IdentityPort`.

---

## 8. sdk/ — Developer Experience

What app developers import. Nice API over `expression/`, domain language matching the port.

### Files

```
sdk/
├── identity.ts       # User/app/role identity builders
├── grant.ts          # Grant construction with fluent API
├── token.ts          # JWT minting for apps
├── relay.ts          # RelayToken request builder
└── index.ts
```

### API Design

```typescript
import { authz } from '@astrale-os/sdk'

// Build identities with domain language
const user = authz.user('USER1')
const editor = authz.role('EDITOR')
const app = authz.app('APP1')

// Compose with port vocabulary
const resourceExpr = user
  .extend(editor)                          // extendIdentity (union)
  .constrain(authz.role('TENANT_MEMBER'))  // constrainIdentity (intersect)
  .exclude(authz.role('SUSPENDED'))        // excludeIdentity (exclude)
  .restrictTo({ nodes: ['workspace-1'] })

// Build grant
const grant = authz.grant()
  .forType(app)
  .forResource(resourceExpr)

// Mint token
const appToken = authz.mintAppToken('APP1', {
  audience: 'kernel',
  grant: grant
})

// Request relay token
const relayRequest = authz.relayToken()
  .expression(resourceExpr)
  .scopes({ nodes: ['workspace-1'], perms: ['read'] })
  .ttl(3600)
```

### Rules

- Depends on `expression/` for data structures.
- Uses port vocabulary: `extend`/`constrain`/`exclude` not `union`/`intersect`/`exclude`.
- **No kernel internals.** No adapters, no authorization logic, no JWT verification.
- Currently a folder of reusable code — will be moved to a separate package later.

---

## 9. testing/ — Isolated

```
testing/
├── fixtures.ts       # seedAuthzTestData(), AuthzTestData
├── mocks.ts          # MockJwtVerifier, createMockToken(), createTestVerifier()
├── assertions.ts     # expectGranted(), expectDeniedByType(), expectDeniedByResource()
├── setup.ts          # FalkorDB connection, test context lifecycle
└── index.ts
```

### What Moves Here

| From | Functions | To |
|------|-----------|-----|
| `helpers.ts` | expectGranted(), expectDeniedByType(), expectDeniedByResource() | `assertions.ts` |
| `helpers.ts` | identity(), union(), grant(), grantFromIds(), *Scope() | `assertions.ts` (test builders) |
| `token-verifier.ts` | createMockToken(), createTestVerifier() | `mocks.ts` |
| `restrict-token.ts` | registerIdentity(), createToken(), createAppJwt(), createUserJwt() | `mocks.ts` |
| `setup.ts` | seedAuthzTestData(), setupAuthzTest(), teardownAuthzTest() | `fixtures.ts` / `setup.ts` |

### Rules

- Can import anything.
- **Never imported by production code.**

---

## 10. Dependency Graph

```
                    kernel/core/auth/
                    authn.types.ts
                    authz.types.ts
                    permissions.ts
                          │
                          ▼
              ┌───── expression/ ──────┐
              │   (pure, no I/O)       │
              │                        │
              ▼                        ▼
     authentication/            authorization/
     (who are you?)             (can you do this?)
              │                        │
              │                        │
              └──────────┬─────────────┘
                         │
                         ▼
                    adapters/falkordb/
                 (implements IdentityPort,
                  identity composition,
                  Cypher generation,
                  FalkorDB queries)
                         │
                         │
      ┌──────────────────┤
      ▼                  ▼
    sdk/              testing/
  (reusable code)   (FalkorDB + Docker)
```

**Rule**: Dependencies point downward only. No layer imports from above.

> **Note**: No in-memory adapter. Tests run against real FalkorDB in Docker.

---

## 11. Reconciliation Notes

### Naming: ~~`except` vs~~ `exclude` ✓ DECIDED

Standardized on `exclude` with `left`/`right` fields.

| Layer | Before | After |
|-------|--------|-------|
| Core types | `{ kind: 'except'; base; excluded }` | `{ kind: 'exclude'; left; right }` |
| Prototype | `{ kind: 'exclude'; left; right }` | *(unchanged)* |
| Port | `excludeIdentity()` | *(unchanged)* |
| SDK | — | `.exclude()` |

### Types That Already Exist in Core

These types in `authz-v2/types.ts` already exist in `kernel/core/auth/`:
- `IdentityExpr` → `authn.types.ts`
- `Scope` → `authn.types.ts`
- `Grant` → `authn.types.ts`
- `AccessDecision` → `authz.types.ts`
- `AccessExplanation` → `authz.types.ts`
- `PermissionT` → `permissions.ts`

**Action**: Delete duplicates from prototype, import from `@astrale-os/kernel-core`.

### Types That Need to Move to Core

These exist only in the prototype:
- `UnresolvedIdentityExpr` → core types (client boundary)
- `UnresolvedGrant` → core types (client boundary)
- `RelayTokenRequest` / `RelayTokenResponse` → core types
- `IdentityComposition` → authorization/composition.ts (internal)
- `AccessCheckerConfig` → authorization/ (internal)
- `Reason`, `LeafReason`, `CompositeReason`, `AccessResult` → already in identity.port.ts

---

## 12. Complete Function Mapping

### expression/ (39 items)

| File | Function | Source |
|------|----------|--------|
| `builder.ts` | identity(), id(), union(), intersect(), exclude(), grant() | expr-builder.ts |
| `builder.ts` | IdentityExprBuilder, BinaryExpr, RawExpr, GrantBuilder | expr-builder.ts |
| `builder.ts` | isExprBuilder(), raw(), applyScopes() | expr-builder.ts |
| `builder.ts` | unresolvedJwt(), unresolvedId(), unresolvedUnion/Intersect/Exclude() | grant-encoding.ts |
| `builder.ts` | createUnresolvedGrant() | grant-encoding.ts |
| `scope.ts` | intersectScopes(), intersectArrays(), intersectScope() | scope-utils.ts |
| `scope.ts` | scopeAllowsPerm(), scopeAllowsNode(), scopeAllowsPrincipal() | scope-utils.ts |
| `scope.ts` | scopesAllow(), deduplicateScopes(), scopeToKey() | scope-utils.ts |
| `encoding.ts` | toCompact(), fromCompact(), toCompactJSON(), fromCompactJSON() | expr-compact.ts |
| `encoding.ts` | encode(), decode(), encodeBase64(), decodeBase64() | expr-encoding.ts |
| `encoding.ts` | BufferWriter, BufferReader, compareSizes() | expr-encoding.ts |
| `dedup.ts` | dedup(), expand(), hasRepeatedSubtrees(), dedupStats() | expr-dedup.ts |
| `dedup.ts` | Ref, RefExpr, DedupedExpr, isRef(), isDedupedExpr() | expr-dedup.ts |
| `validation.ts` | validateCypherId(), validateExpression(), validateScopes() | access-checker.ts |
| `validation.ts` | validateAccessInputs(), throwExhaustiveCheck() | access-checker.ts |

### authentication/ (25 items)

| File | Function | Source |
|------|----------|--------|
| `jwt.ts` | TokenVerifier.verify(), verifyKernelIssued(), decodeToken() | token-verifier.ts |
| `jwt.ts` | TokenPayload, VerificationResult | token-verifier.ts |
| `registry.ts` | IdentityRegistry.register(), resolve(), resolveOrThrow() | token-verifier.ts |
| `issuer-trust.ts` | IssuerKeyStore.registerIssuer(), getKey(), isTrusted() | token-verifier.ts |
| `resolver.ts` | ExpressionResolver.resolve(), decodeGrant(), applyScopes() | expression-resolver.ts |
| `resolver.ts` | resolveExpression(), decodeGrant() | grant-encoding.ts |
| `resolver.ts` | identityExprToUnresolved(), encodeGrant() | grant-encoding.ts |
| `resolver.ts` | applyTopLevelScopes(), extractPrimaryIdentity() | expression-resolver.ts |
| `security.ts` | validateGrantSecurity(), validateExpressionSecurity() | expression-resolver.ts |
| `security.ts` | validateUnresolvedGrant(), validateUnresolvedExpr() | grant-encoding.ts |
| `token-issuer.ts` | KernelService.relayToken() | restrict-token.ts |
| `authenticator.ts` | KernelService.authenticate() | restrict-token.ts |

### authorization/ (37 items)

| File | Function | Source |
|------|----------|--------|
| `checker.ts` | AccessChecker.checkAccess(), evaluateGranted() | access-checker.ts |
| `checker.ts` | scopePasses(), checkFilter(), scopesAllow() | access-checker.ts |
| `explainer.ts` | explainAccess(), explainPhase(), collectLeaves() | access-checker.ts |

### adapters/falkordb/ (17 items)

| File | Function | Source |
|------|----------|--------|
| `composition.ts` | IdentityEvaluator.evalIdentity(), evalExpr(), resolveExpr() | identity-evaluator.ts |
| `composition.ts` | CycleDetectedError, IdentityNotFoundError, InvalidIdentityError | identity-evaluator.ts |
| `composition.ts` | fetchIdentity(), FETCH_IDENTITY_QUERY | identity-evaluator.ts |
| `cypher.ts` | toCypher(), identityToCypher() | access-checker.ts |
| `identity.adapter.ts` | executeCheck(), getTargetType(), clearCache() | access-checker.ts |
| `identity.adapter.ts` | createRawExecutor(), createFalkorDBConnection() | setup.ts |

### testing/ (22 items)

| File | Function | Source |
|------|----------|--------|
| `assertions.ts` | expectGranted(), expectDeniedByType(), expectDeniedByResource() | helpers.ts |
| `assertions.ts` | identity(), union(), grant(), grantFromIds(), *Scope() | helpers.ts |
| `mocks.ts` | createMockToken(), createTestVerifier() | token-verifier.ts |
| `mocks.ts` | createAppJwt(), createUserJwt(), decodeMockJwt() | restrict-token.ts |
| `fixtures.ts` | seedAuthzTestData() | setup.ts |
| `setup.ts` | setupAuthzTest(), teardownAuthzTest(), clearDatabase(), createIndexes() | setup.ts |

---

## 13. Decisions & Open Questions

### Resolved

| # | Question | Decision |
|---|----------|----------|
| 1 | `except` vs `exclude` naming | **`exclude`** with `left`/`right` fields. Core types will be updated. |
| 2 | Composition fetching | **Adapter owns it entirely.** `IdentityEvaluator` lives in `adapters/falkordb/composition.ts`. |
| 4 | sdk/ packaging | **Folder for now.** Reusable code, will be moved to separate package later. |
| 5 | In-memory adapter | **No in-memory adapter.** Test against real FalkorDB in Docker. |

### Open

| # | Question | Context |
|---|----------|---------|
| 3 | **Scope location**: `expression/` or elsewhere? | Scope operations are pure transforms, heavily used in authorization. `expression/scope.ts` is tentative. Undecided. |
