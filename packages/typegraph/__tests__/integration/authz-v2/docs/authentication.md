# Authentication Domain - High-Level Specification

## 1. Overview

The **authentication domain** answers the question: "Who are you, and what are you authorized to delegate?" It handles JWT verification, identity resolution, token issuance, and the security boundary between external tokens and internal identity.

### 1.1 Role in the System

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        authentication/                                   │
│                                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────────────┐│
│  │  jwt.ts       │  │  registry.ts  │  │  issuer-trust.ts              ││
│  │  Verify JWTs  │  │  (iss,sub)→ID │  │  Trusted issuer management    ││
│  └──────┬───────┘  └──────┬───────┘  └──────────────┬─────────────────┘│
│         │                 │                          │                   │
│         └─────────────────┼──────────────────────────┘                   │
│                           │                                              │
│         ┌─────────────────┼─────────────────────────┐                   │
│         │                 │                          │                   │
│  ┌──────▼──────┐  ┌──────▼───────┐  ┌──────────────▼─────────────────┐│
│  │  resolver.ts │  │  security.ts  │  │  token-issuer.ts               ││
│  │  Unresolved  │  │  Trust        │  │  RelayToken: resolve + issue   ││
│  │  → Resolved  │  │  boundary     │  │  kernel-signed JWT             ││
│  └─────────────┘  └──────────────┘  └────────────────────────────────┘│
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  authenticator.ts                                                   │ │
│  │  Authenticate request: verify JWT → resolve grant → AuthContext     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Responsibilities

| Responsibility | Component | Description |
|---------------|-----------|-------------|
| **JWT verification** | jwt.ts | Decode, verify issuer trust, check signature, expiry, audience |
| **Identity resolution** | registry.ts | Map `(iss, sub)` → `IdentityId` |
| **Issuer trust** | issuer-trust.ts | Manage trusted issuers and their signing keys |
| **Expression resolution** | resolver.ts | `UnresolvedIdentityExpr` → `IdentityExpr` (JWTs → plain IDs) |
| **Security enforcement** | security.ts | External apps can only embed kernel-signed tokens |
| **Token issuance** | token-issuer.ts | Resolve expression → issue kernel-signed JWT (RelayToken) |
| **Request authentication** | authenticator.ts | Verify incoming JWT → resolve grant → produce `AuthContext` |

### 1.3 Key Invariant

> **Scopes can only be made more restrictive, never less.**
>
> Every hop in the delegation chain intersects (narrows) scopes. No operation in the authentication domain can widen permissions.

---

## 2. Token Verification

### 2.1 TokenVerifier

The central verification component. Performs a 6-step verification pipeline:

```
Input: JWT string (header.payload.signature)
                │
                ▼
        1. Decode (base64url → JSON)
                │
                ▼
        2. Verify issuer is trusted
           (issuer → IssuerKeyStore lookup)
                │
                ▼
        3. Verify signature
           (mock in prototype; real JWKS in production)
                │
                ▼
        4. Check expiration
           (payload.exp < now → reject)
                │
                ▼
        5. Check audience
           (payload.aud must match expected audience)
                │
                ▼
        6. Resolve identity
           (iss, sub) → IdentityId via IdentityRegistry
                │
                ▼
Output: { payload: TokenPayload, identityId: IdentityId }
```

### 2.2 TokenPayload

```typescript
interface TokenPayload {
  iss: string              // Issuer (app ID, IdP URL, or KERNEL_ISSUER)
  sub: string              // Subject (user ID, app ID)
  aud: string              // Audience (must be KERNEL_ISSUER)
  iat: number              // Issued at (unix timestamp)
  exp: number              // Expiration (unix timestamp)
  grant?: UnresolvedGrant  // Optional: embedded grant for delegation
}
```

### 2.3 Verification Result

```typescript
interface VerificationResult {
  payload: TokenPayload
  identityId: IdentityId
}
```

### 2.4 verifyKernelIssued

Special-purpose verification that additionally requires the token's issuer to be `KERNEL_ISSUER`:

```typescript
verifyKernelIssued(token: string): VerificationResult
// Calls verify() then checks payload.iss === KERNEL_ISSUER
// Throws if issuer is not the kernel
```

Used by the security gate to validate embedded tokens in external app grants.

---

## 3. Identity Registry

### 3.1 Purpose

Maps `(iss, sub)` pairs from JWT claims to internal `IdentityId` values. In production, this is a graph lookup. In the prototype, it's an in-memory map.

### 3.2 Interface

```typescript
class IdentityRegistry {
  register(iss: string, sub: string, identityId: IdentityId): void
  resolve(iss: string, sub: string): IdentityId | undefined
  resolveOrThrow(iss: string, sub: string): IdentityId
}
```

### 3.3 Kernel Identity Resolution

Kernel-issued tokens have a special rule: the `sub` claim IS the `IdentityId`:

```typescript
resolve(iss, sub):
  if iss === KERNEL_ISSUER:
    return sub  // sub IS the identityId
  return lookup(iss + "::" + sub)
```

This is secure because only the kernel can issue kernel-signed tokens, and the kernel sets `sub` to the resolved identity ID.

---

## 4. Issuer Key Store

### 4.1 Purpose

Manages trusted issuers and their signing keys. In production, this would fetch keys from issuer JWKS endpoints.

### 4.2 Interface

```typescript
class IssuerKeyStore {
  registerIssuer(issuer: string, key: string): void
  getKey(issuer: string): string | undefined
  isTrusted(issuer: string): boolean
}
```

### 4.3 Trust Model

An issuer must be explicitly registered to be trusted. Unregistered issuers are rejected during JWT verification:

```
Registered issuers (example):
  - kernel.astrale.ai  (KERNEL_ISSUER) → "kernel-key"
  - idp.test           (test IdP)      → "idp-key"
  - google.com         (OAuth provider) → "google-key"

Unregistered issuer → Error: "Untrusted issuer: evil.app"
```

---

## 5. Expression Resolution

### 5.1 Purpose

Transforms `UnresolvedIdentityExpr` (with JWT leaves) into `IdentityExpr` (with plain ID leaves). Preserves expression tree structure.

### 5.2 Resolution Algorithm

See [expression-resolver.md](./expression-resolver.md) for the full specification. Key points:

1. **Recursive tree walk**: Binary nodes resolve both branches in parallel via `Promise.all`
2. **JWT leaves**: Verified via TokenVerifier, resolved to plain ID
3. **Kernel token extraction**: If a JWT is kernel-signed and contains a grant, extract and recursively resolve the inner expression
4. **Plain ID leaves**: Passed through as-is (valid only in kernel-signed tokens)
5. **Scope intersection**: When applying scopes to resolved expressions, uses intersection (not concatenation)

### 5.3 Grant Resolution

```typescript
decodeGrant(encoded: EncodedGrant | undefined, principal: IdentityId): DecodedGrant
```

Resolves an encoded grant from a JWT payload:
- If `encoded` is undefined → default grant (principal identity for both forType and forResource)
- If `encoded.forType` is undefined → default to principal
- If `encoded.forResource` is undefined → default to principal
- Otherwise → resolve each expression

### 5.4 Top-Level Scope Application

```typescript
applyTopLevelScopes(expr: IdentityExpr, scopes: Scope[]): IdentityExpr
```

Applies scopes to ALL leaves via **intersection** (not concatenation). Used by RelayToken to narrow permissions:

```
Existing leaf scopes:  [{ nodes: ['ws-1', 'ws-2'] }]
Top-level scopes:      [{ nodes: ['ws-1'] }]
Result:                [{ nodes: ['ws-1'] }]  (intersected, more restrictive)
```

### 5.5 Extract Primary Identity

```typescript
extractPrimaryIdentity(expr: IdentityExpr): IdentityId
```

Returns the leftmost identity leaf in the expression tree. Used for the JWT `sub` claim in kernel-signed tokens. Left-to-right ordering matches the expression builder convention (user before role).

---

## 6. Security Enforcement

### 6.1 The Trust Boundary Rule

**CRITICAL**: External apps (non-kernel issuers) can ONLY embed **kernel-signed tokens** in their grants. They cannot embed raw IdP tokens or tokens from other apps.

```
ALLOWED:
  App JWT { iss: "AppA", grant: { forResource: { jwt: "<kernel-signed>" } } }

REJECTED:
  App JWT { iss: "AppA", grant: { forResource: { jwt: "<IdP-signed>" } } }
  → Error: "Token must be kernel-issued"
```

### 6.2 Why This Rule Exists

Without this rule, a malicious app could steal an IdP token and embed it in its own JWT to impersonate the user. The kernel-signed token acts as a proof that:
1. The kernel verified the original identity
2. The kernel approved the delegation chain
3. Scope restrictions were properly applied at each hop

### 6.3 Validation Functions

```typescript
validateGrantSecurity(issuer: string, grant: EncodedGrant, verifier: TokenVerifier): void
```

If `issuer !== KERNEL_ISSUER`, recursively validates that all JWT leaves in the grant are kernel-signed.

```typescript
validateExpressionSecurity(expr: EncodedIdentityExpr, verifier: TokenVerifier): void
```

Recursive tree walk that calls `verifier.verifyKernelIssued(jwt)` for every JWT leaf.

### 6.4 Structural Validation

```typescript
validateUnresolvedGrant(grant: unknown): asserts grant is UnresolvedGrant
validateUnresolvedExpr(expr: unknown, path: string): asserts expr is UnresolvedIdentityExpr
```

Validates the structure of unresolved expressions:
- Grant must have `v: 1`
- Identity leaves must have exactly one of `jwt` or `id`
- Binary nodes must have `left` and `right`
- `kind` must be valid

---

## 7. Token Issuance (RelayToken)

### 7.1 Purpose

The RelayToken endpoint is how delegation works. An app sends an expression (with JWT leaves) and the kernel returns a kernel-signed JWT containing the resolved, scope-restricted expression.

### 7.2 Flow

```
Client sends: RelayTokenRequest
  { expression: UnresolvedIdentityExpr, scopes?: Scope[], ttl?: number }

Kernel performs:
  1. Resolve expression (JWTs → plain IDs)          [TRUST + RESOLVE]
  2. Apply top-level scopes (intersection)            [RESTRICT]
  3. Extract primary identity (for sub claim)         [METADATA]
  4. Build kernel-signed JWT with resolved grant      [ISSUE]

Client receives: RelayTokenResponse
  { token: string, expires_at: number }
```

### 7.3 Token Contents

The kernel-signed JWT contains:

```typescript
{
  iss: KERNEL_ISSUER,         // "kernel.astrale.ai"
  sub: primaryIdentityId,     // Leftmost identity from resolved expression
  aud: KERNEL_ISSUER,
  iat: now,
  exp: now + ttl,
  grant: {
    v: 1,
    forResource: unresolvedExpr  // The resolved expression, re-encoded as UnresolvedIdentityExpr
  }
}
```

### 7.4 The Double-Resolution Problem

The current implementation has a wasteful pattern:

```
RelayToken:
  1. Resolve: JWT → IdentityExpr (plain IDs)
  2. identityExprToUnresolved() → UnresolvedIdentityExpr (back to unresolved form)
  3. Embed in kernel JWT

Authenticate:
  4. decodeGrant() → walks the tree again
  5. But every leaf already has plain ID → no-op tree walk
```

Step 2 converts resolved expressions back to unresolved form. Step 4-5 resolves them again (but it's a no-op since they're already plain IDs). This is a complete waste.

**Fix**: Kernel tokens should either carry `IdentityExpr` directly or skip re-resolution for kernel-issued grants.

### 7.5 TTL Management

```typescript
const ttl = Math.min(request.ttl ?? defaultTtl, maxTtl)

// Default config:
defaultTtl: 3600   // 1 hour
maxTtl: 86400      // 24 hours
```

Client can request a TTL, but it's capped at `maxTtl`.

---

## 8. Request Authentication

### 8.1 Purpose

When a request arrives with a JWT, the authenticator verifies it and produces an `AuthContext` for downstream authorization.

### 8.2 AuthContext

```typescript
interface AuthContext {
  origin: 'backend' | 'shell' | 'system'
  principal: IdentityId
  grant: Grant
}
```

| Field | Description |
|-------|-------------|
| `origin` | Where the request came from (kernel → 'system', external → 'backend') |
| `principal` | The authenticated identity |
| `grant` | Resolved grant with `forType` and `forResource` expressions |

### 8.3 Authentication Flow

```
Input: JWT string

1. Verify JWT
   { payload, identityId } = verifier.verify(token)

2. Security gate (if external app)
   if payload.iss !== KERNEL_ISSUER AND payload.grant:
     validateGrantSecurity(payload.iss, payload.grant, verifier)

3. Determine origin
   origin = payload.iss === KERNEL_ISSUER ? 'system' : 'backend'

4. Resolve grant
   resolvedGrant = resolver.decodeGrant(payload.grant, identityId)
   grant = {
     forType: resolvedGrant.forType,
     forResource: resolvedGrant.forResource
   }

5. Return AuthContext
   { origin, principal: identityId, grant }
```

### 8.4 Default Grant

When a JWT has no `grant` field, the default grant uses the principal for both forType and forResource:

```typescript
// JWT without grant → default grant
{
  forType: { kind: 'identity', id: principalId },
  forResource: { kind: 'identity', id: principalId }
}
```

This means the principal is checked for both USE permission on the type and the requested permission on the resource.

---

## 9. Grant Encoding

### 9.1 Purpose

Bridges between resolved expressions (internal) and unresolved expressions (JWT payloads). Provides encode/decode functions for grant serialization.

### 9.2 Encoding: Grant → UnresolvedGrant

```typescript
encodeGrant(grant: Grant): UnresolvedGrant
```

Converts resolved expressions to unresolved form (all leaves have `id`, no `jwt`). Used when embedding resolved grants in kernel-signed JWTs.

### 9.3 Decoding: UnresolvedGrant → Grant

```typescript
decodeGrant(encoded: UnresolvedGrant, verifier: JwtVerifier, principal: IdentityId): Grant
```

Resolves an unresolved grant:
1. Validate version (`v: 1`)
2. Resolve `forType` (or default to principal)
3. Resolve `forResource` (or default to principal)

### 9.4 Expression Conversion

```typescript
identityExprToUnresolved(expr: IdentityExpr): UnresolvedIdentityExpr
```

Recursive tree walk that converts each identity leaf from `{ id }` to `{ id }` format (structurally identical for resolved expressions, but typed as `UnresolvedIdentityExpr`).

---

## 10. Delegation Flow (Complete Example)

### 10.1 Simple: User → Kernel → Access Check

```
1. User authenticates with IdP (Google, WorkOS, etc.)
   → Receives IdP JWT: { iss: "google.com", sub: "user-123" }

2. User's request arrives at kernel with IdP JWT
   → Kernel authenticates:
     - Verify JWT (google.com is trusted)
     - Resolve identity: ("google.com", "user-123") → "USER1"
     - No grant field → default grant (USER1 for both)
   → AuthContext: { principal: "USER1", grant: { forType: id("USER1"), forResource: id("USER1") } }

3. Access check:
   → check(forType=id("USER1"), type("M1"), 'use')
   → check(forResource=id("USER1"), "M1", 'read', "USER1")
```

### 10.2 Delegation: User → App A → Kernel → Access Check

```
1. User authenticates with IdP → IdP JWT

2. App A calls RelayToken with user's IdP JWT:
   { expression: { kind: 'identity', jwt: "<IdP JWT>" },
     scopes: [{ nodes: ['ws-1'] }] }

3. Kernel processes RelayToken:
   - Verify IdP JWT → resolve USER1
   - Apply scope intersection → { id: "USER1", scopes: [{ nodes: ['ws-1'] }] }
   - Issue kernel JWT with grant

4. App A creates its own JWT embedding the kernel token:
   { iss: "AppA", sub: "AppA",
     grant: { forResource: { jwt: "<kernel-signed token>" } } }

5. App A's request arrives at kernel:
   - Verify App A's JWT
   - Security gate: embedded JWT is kernel-signed ✓
   - Resolve grant:
     - Kernel token's inner grant has the resolved expression
     - Expression: { id: "USER1", scopes: [{ nodes: ['ws-1'] }] }
   - AuthContext: { principal: "APPA", grant: { forType: id("APPA"), forResource: scoped_id("USER1", ws-1) } }

6. Access check with the scoped expression
```

### 10.3 Multi-Hop: User → App A → App B → Kernel

```
1. User → IdP JWT
2. App A → RelayToken(IdP JWT, scopes: [{ nodes: ['ws-1', 'ws-2'] }])
3. Kernel → Kernel JWT (USER1 scoped to ws-1, ws-2)
4. App A → App B, embedding kernel JWT
5. App B → RelayToken(kernel JWT, scopes: [{ nodes: ['ws-1'] }])
6. Kernel → resolves kernel JWT → USER1 scoped to ws-1, ws-2
           → intersect with App B's scopes → USER1 scoped to ws-1 only
           → new kernel JWT
7. App B → request to kernel with final kernel JWT
8. Access check: USER1 restricted to ws-1 only
```

Each hop can only narrow, never widen.

---

## 11. Error Catalogue

| Error | Component | Cause |
|-------|-----------|-------|
| `Invalid token format` | jwt.ts | Token doesn't have 3 dot-separated parts |
| `Untrusted issuer: {iss}` | jwt.ts | Issuer not in IssuerKeyStore |
| `Token expired` | jwt.ts | `exp < now` |
| `Invalid audience: expected {x}, got {y}` | jwt.ts | `aud` doesn't match |
| `Unknown identity: {iss}::{sub}` | registry.ts | (iss, sub) not registered |
| `Token must be kernel-issued, got issuer: {iss}` | security.ts | External app embedded non-kernel JWT |
| `Unsupported grant version: {v}` | resolver.ts | Grant version is not 1 |

All errors are fail-fast. No partial resolution, no fallback, no retry.

---

## 12. Target File Layout

```
authentication/
├── jwt.ts            # TokenVerifier: verify(), verifyKernelIssued(), decodeToken()
│                     # TokenPayload, VerificationResult
│
├── registry.ts       # IdentityRegistry: register(), resolve(), resolveOrThrow()
│                     # Kernel identity resolution rule (sub = identityId)
│
├── issuer-trust.ts   # IssuerKeyStore: registerIssuer(), getKey(), isTrusted()
│
├── resolver.ts       # ExpressionResolver: resolve(), decodeGrant(), applyScopes()
│                     # resolveExpression(), decodeGrant(), identityExprToUnresolved()
│                     # applyTopLevelScopes(), extractPrimaryIdentity()
│
├── security.ts       # validateGrantSecurity(), validateExpressionSecurity()
│                     # validateUnresolvedGrant(), validateUnresolvedExpr()
│
├── token-issuer.ts   # KernelService.relayToken() → kernel-signed JWT
│
├── authenticator.ts  # KernelService.authenticate() → AuthContext
│
└── index.ts          # Re-exports
```

---

## 13. Dependencies

```
authentication/ depends on:
  ├── expression/                    (scope intersection, expression types, builders)
  └── kernel/core/auth/             (type definitions)

authentication/ is depended on by:
  ├── adapters/                      (AuthContext → access check)
  └── sdk/                           (token minting helpers)
```

**Rule**: No database queries. No Cypher. No FalkorDB. Authentication is purely about token verification and expression resolution.

---

## 14. Relationship to Other Specs

| Spec | Relationship |
|------|-------------|
| [expression-resolver.md](./expression-resolver.md) | Detailed spec of the expression resolution algorithm (sections 3-5 of this doc elaborated) |
| [access-checker.md](./access-checker.md) | Consumes the `AuthContext` produced here; handles the DECIDE phase |
| [component-architecture-analysis.md](./component-architecture-analysis.md) | Maps current prototype files to target architecture |
| [end-to-end-flow.md](./end-to-end-flow.md) | Shows where authentication fits in the irreducible DAG (Phase 1: TRUST) |
| [identity-evaluator.md](./identity-evaluator.md) | Runs after authentication resolves the expression; expands DB compositions |

---

## 15. Open Questions

1. **Double-resolution fix**: Should kernel tokens carry `IdentityExpr` directly (avoiding re-encoding as `UnresolvedIdentityExpr`), or should `decodeGrant` detect kernel tokens and skip re-resolution?

2. **Token caching**: Should `TokenVerifier` cache verification results for repeated JWTs within the same request? Relevant for expressions with shared subtrees.

3. **JWKS rotation**: In production, how should the IssuerKeyStore handle key rotation? Current prototype uses static registration. Real implementation needs periodic JWKS endpoint polling.

4. **KernelService split**: The current `KernelService` combines token issuance (RelayToken) and request authentication (Authenticate) in one class. Should these be separate services or remain unified?
