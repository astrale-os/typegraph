# Expression Resolver - High-Level Specification

## 1. Overview

The **Expression Resolver** is a core component of the AUTH_V2 authorization system responsible for transforming unresolved identity expressions (containing JWTs) into fully resolved expressions (containing plain identity IDs). It acts as the security boundary between external tokens and internal identity resolution.

### 1.1 Role in the System

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Client Request (with JWT)                        │
│                              {jwt: "eyJ..."}                            │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Token Verifier                                   │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. Decode JWT                                                   │   │
│  │  2. Verify issuer is trusted (JWKS lookup)                       │   │
│  │  3. Verify signature                                             │   │
│  │  4. Check expiration                                             │   │
│  │  5. Check audience                                               │   │
│  │  6. Resolve (iss, sub) → IdentityId                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Expression Resolver                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. Recursively resolve JWTs → plain IDs                         │   │
│  │  2. Handle kernel-issued tokens (extract embedded grants)        │   │
│  │  3. Apply scope intersection (not concatenation)                 │   │
│  │  4. Preserve expression tree structure                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Identity Evaluator                               │
│              (Expand DB compositions → expression tree)                 │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Access Checker                                 │
│              (Generate Cypher, execute query → grant/deny)              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Responsibilities

| Responsibility | Description |
|---------------|-------------|
| **JWT Resolution** | Verify and resolve JWT tokens to plain identity IDs via TokenVerifier |
| **Kernel Token Handling** | Extract and recursively resolve inner grants from kernel-issued tokens |
| **Scope Application** | Apply top-level scopes to all leaves via proper intersection |
| **Grant Resolution** | Resolve encoded grants with defaults for missing forType/forResource |
| **Security Validation** | Enforce that external apps can only embed kernel-signed tokens |
| **Structure Preservation** | Maintain expression tree structure (union/intersect/exclude) during resolution |

### 1.3 Scopes Are Intersected, Not Concatenated

```
WRONG (Concatenation):
  Scope A: { nodes: ['ws-1', 'ws-2'] }
  Scope B: { nodes: ['ws-1'] }
  Result:  [{ nodes: ['ws-1', 'ws-2'] }, { nodes: ['ws-1'] }]  // OR of both

CORRECT (Intersection):
  Scope A: { nodes: ['ws-1', 'ws-2'] }
  Scope B: { nodes: ['ws-1'] }
  Result:  [{ nodes: ['ws-1'] }]  // Most restrictive
```

**Rationale**: Multi-hop delegation must only **restrict** permissions, never expand. If App A restricts to `['ws-1', 'ws-2']` and forwards to App B which restricts to `['ws-1']`, the final token must only allow `['ws-1']`.

---

## 2. Data Structures

### 2.1 Input: Unresolved Identity Expression

Expressions before kernel resolution (may contain JWTs or plain IDs):

```typescript
type UnresolvedIdentityExpr =
  | { kind: 'identity'; jwt: string; scopes?: Scope[] }      // JWT reference
  | { kind: 'identity'; id: IdentityId; scopes?: Scope[] }   // Plain ID (kernel-only)
  | { kind: 'union'; left: UnresolvedIdentityExpr; right: UnresolvedIdentityExpr }
  | { kind: 'intersect'; left: UnresolvedIdentityExpr; right: UnresolvedIdentityExpr }
  | { kind: 'exclude'; left: UnresolvedIdentityExpr; right: UnresolvedIdentityExpr }
```

### 2.2 Output: Resolved Identity Expression

Expressions after resolution (only plain IDs):

```typescript
type IdentityExpr =
  | { kind: 'identity'; id: IdentityId; scopes?: Scope[] }
  | { kind: 'union'; left: IdentityExpr; right: IdentityExpr }
  | { kind: 'intersect'; left: IdentityExpr; right: IdentityExpr }
  | { kind: 'exclude'; left: IdentityExpr; right: IdentityExpr }
```

### 2.3 Scope Structure

```typescript
type Scope = {
  nodes?: NodeId[]          // Restrict to these subtrees (undefined = unrestricted)
  perms?: PermissionT[]     // Restrict to these permission types
  principals?: IdentityId[] // Restrict which principals can invoke
}
```

**Semantic distinction**:
- `scopes: undefined` → Unrestricted (no scope constraints)
- `scopes: []` → Impossible/deny (no valid scopes after intersection)
- `scopes: [{...}]` → Specific constraints apply

### 2.4 Encoded Grant (JWT Payload)

```typescript
type EncodedGrant = {
  v: 1                              // Version for future compatibility
  forType?: EncodedIdentityExpr     // Identities for type check
  forResource?: EncodedIdentityExpr // Identities for resource check
}
```

### 2.5 Resolved Grant

```typescript
interface ResolvedGrant {
  forType: IdentityExpr
  forResource: IdentityExpr
}
```

---

## 3. Core Algorithm

### 3.1 Main Resolution: `resolve(expr)`

Recursively transforms an unresolved expression into a resolved expression.

```
function resolve(expr: EncodedIdentityExpr): IdentityExpr
    switch expr.kind:
        case 'identity':
            return resolveIdentity(expr)

        case 'union', 'intersect', 'exclude':
            // Resolve both branches IN PARALLEL
            [left, right] = await Promise.all([
                resolve(expr.left),
                resolve(expr.right)
            ])
            return { kind: expr.kind, left, right }
```

### 3.2 Identity Resolution: `resolveIdentity(expr)`

```
function resolveIdentity(expr): IdentityExpr
    if 'jwt' in expr:
        return resolveJwtIdentity(expr.jwt, expr.scopes)

    // Plain ID - preserve as-is
    return expr.scopes
        ? { kind: 'identity', id: expr.id, scopes: expr.scopes }
        : { kind: 'identity', id: expr.id }
```

### 3.3 JWT Identity Resolution: `resolveJwtIdentity(jwt, leafScopes)`

This is where the security-critical logic lives:

```
function resolveJwtIdentity(jwt: string, leafScopes?: Scope[]): IdentityExpr
    // Step 1: Verify the JWT (issuer trusted, signature valid, not expired, correct audience)
    { payload, identityId } = verifier.verify(jwt)

    // Step 2: Check for kernel-issued token with embedded grant
    if payload.iss === KERNEL_ISSUER AND payload.grant?.forResource:
        inner = payload.grant.forResource

        // CRITICAL: Recursively resolve the inner expression
        // This handles multi-hop delegation chains
        resolvedInner = await resolve(inner)

        // Apply leaf scopes via INTERSECTION (not concatenation)
        if leafScopes AND leafScopes.length > 0:
            return applyTopLevelScopes(resolvedInner, leafScopes)

        return resolvedInner

    // Step 3: Regular JWT - create identity from resolved ID
    return leafScopes
        ? { kind: 'identity', id: identityId, scopes: leafScopes }
        : { kind: 'identity', id: identityId }
```

### 3.4 Grant Resolution: `resolveGrant(encoded, principal)`

```
function resolveGrant(encoded: EncodedGrant | undefined, principal: IdentityId): ResolvedGrant
    defaultExpr = { kind: 'identity', id: principal }

    if not encoded:
        return { forType: defaultExpr, forResource: defaultExpr }

    if encoded.v !== 1:
        throw Error("Unsupported grant version: ${encoded.v}")

    forType = encoded.forType
        ? await resolve(encoded.forType)
        : defaultExpr

    forResource = encoded.forResource
        ? await resolve(encoded.forResource)
        : defaultExpr

    return { forType, forResource }
```

### 3.5 Scope Application: `applyTopLevelScopes(expr, scopes)`

Apply scopes to ALL leaves in an expression tree:

```
function applyTopLevelScopes(expr: IdentityExpr, scopes: Scope[]): IdentityExpr
    if scopes.length === 0:
        return expr

    switch expr.kind:
        case 'identity':
            newScopes = expr.scopes
                ? intersectScopes(expr.scopes, scopes)  // INTERSECTION!
                : scopes
            return { kind: 'identity', id: expr.id, scopes: newScopes }

        case 'union', 'intersect', 'exclude':
            return {
                kind: expr.kind,
                left: applyTopLevelScopes(expr.left, scopes),
                right: applyTopLevelScopes(expr.right, scopes)
            }
```

---

## 4. Security Validation

### 4.1 The Problem: Token Impersonation

Without validation, a malicious app could embed a raw IdP token in its JWT:

```
App "EvilApp" creates JWT:
{
  iss: "EvilApp",
  sub: "EvilApp",
  grant: {
    forResource: { jwt: "<stolen IdP token for User X>" }  // BAD!
  }
}
```

If the kernel blindly resolves this, EvilApp gains User X's permissions.

### 4.2 The Solution: Kernel-Only Embedding Rule

**CRITICAL SECURITY CONSTRAINT**:

External apps (non-kernel issuers) can ONLY embed **kernel-signed tokens** in their grants.

```
function validateGrantSecurity(issuer: string, grant: EncodedGrant, verifier: TokenVerifier):
    // Kernel-issued tokens can embed anything (they're already trusted)
    if issuer === KERNEL_ISSUER:
        return

    // External app - validate all embedded tokens
    if grant.forType:
        validateExpressionSecurity(grant.forType, verifier)
    if grant.forResource:
        validateExpressionSecurity(grant.forResource, verifier)

function validateExpressionSecurity(expr: EncodedIdentityExpr, verifier: TokenVerifier):
    switch expr.kind:
        case 'identity':
            if 'jwt' in expr:
                // This JWT MUST be kernel-signed
                verifier.verifyKernelIssued(expr.jwt)  // Throws if not kernel-issued
            break

        case 'union', 'intersect', 'exclude':
            validateExpressionSecurity(expr.left, verifier)
            validateExpressionSecurity(expr.right, verifier)
```

### 4.3 Secure Delegation Flow

```
1. User authenticates with IdP → IdP JWT

2. User calls App A
   - App A sends IdP JWT to Kernel's RelayToken endpoint
   - Kernel verifies IdP JWT, returns kernel-signed JWT with grant

3. App A calls App B, embedding the kernel-signed JWT
   - App A's JWT:
     {
       iss: "AppA",
       grant: { forResource: { jwt: "<kernel-signed token>" } }  // ALLOWED
     }

4. App B authenticates with Kernel
   - Kernel verifies AppA's JWT
   - Kernel checks: embedded JWT is kernel-signed ✓
   - Kernel resolves the grant
```

---

## 5. Scope Intersection Logic

### 5.1 Single Scope Intersection

Intersect two individual scopes. Returns null if intersection is impossible:

```
function intersectScope(a: Scope, b: Scope): Scope | null
    nodes = intersectArrays(a.nodes, b.nodes)
    perms = intersectArrays(a.perms, b.perms)
    principals = intersectArrays(a.principals, b.principals)

    // If any dimension is empty array, scope allows nothing
    if nodes?.length === 0 OR perms?.length === 0 OR principals?.length === 0:
        return null

    // Build result, omitting undefined dimensions
    result = {}
    if nodes !== undefined: result.nodes = nodes
    if perms !== undefined: result.perms = perms
    if principals !== undefined: result.principals = principals

    return result
```

### 5.2 Array Intersection

```
function intersectArrays<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined
    // Both undefined = unrestricted
    if a === undefined AND b === undefined:
        return undefined

    // One undefined = use the other (more restrictive wins)
    if a === undefined: return b
    if b === undefined: return a

    // Both defined = set intersection
    return a.filter(x => b.includes(x))
```

### 5.3 Scope Array Intersection

Multiple scopes are OR'd together. Intersection of two scope arrays:

```
function intersectScopes(a: Scope[], b: Scope[]): Scope[]
    // Empty array = unrestricted
    if a.length === 0: return b
    if b.length === 0: return a

    // Pairwise intersection
    results = []
    for scopeA in a:
        for scopeB in b:
            intersection = intersectScope(scopeA, scopeB)
            if intersection !== null:
                results.push(intersection)

    return deduplicate(results)
```

### 5.4 Example: Multi-Hop Scope Restriction

```
App A restricts:  [{ nodes: ['ws-1', 'ws-2'], perms: ['read', 'write'] }]
App B restricts:  [{ nodes: ['ws-1'], perms: ['read'] }]

Pairwise intersection:
  scopeA × scopeB:
    nodes: ['ws-1', 'ws-2'] ∩ ['ws-1'] = ['ws-1']
    perms: ['read', 'write'] ∩ ['read'] = ['read']
    → { nodes: ['ws-1'], perms: ['read'] }

Final result: [{ nodes: ['ws-1'], perms: ['read'] }]
```

---

## 6. Utility Functions

### 6.1 Extract Primary Identity

Returns the "leftmost" identity from an expression tree. Used for JWT `sub` claim:

```
function extractPrimaryIdentity(expr: IdentityExpr): IdentityId
    switch expr.kind:
        case 'identity':
            return expr.id
        case 'union', 'intersect', 'exclude':
            return extractPrimaryIdentity(expr.left)  // Always left branch
```

**Design decision**: The leftmost identity is chosen as the "primary" because:
1. In `union(user, role)`, the user is semantically the primary actor
2. Consistent left-to-right ordering matches expression builder APIs

---

## 7. Error Handling

### 7.1 Error Types

| Error | Condition | Example |
|-------|-----------|---------|
| `Untrusted issuer` | JWT issuer not in trusted issuer registry | Unknown app or attacker |
| `Token expired` | JWT `exp` claim is in the past | Stale token |
| `Invalid audience` | JWT `aud` doesn't match kernel | Token for different system |
| `Unknown identity` | (iss, sub) pair not in identity registry | User not registered |
| `Token must be kernel-issued` | External app embedded non-kernel JWT | Security violation |
| `Unsupported grant version` | Grant `v` field is not 1 | Future/incompatible version |

### 7.2 Error Propagation

Errors during resolution propagate immediately. The resolver does **not** attempt partial resolution or fallback:

```
union(
    identity("valid-jwt"),
    identity("invalid-jwt")  // Throws here
)
→ Entire resolution fails
```

**Rationale**: Partial resolution could lead to permission escalation or unexpected behavior. Fail-fast is safer.

---

## 8. Integration Points

### 8.1 With TokenVerifier

The Expression Resolver depends on TokenVerifier for:
- JWT signature verification
- Issuer trust validation
- (iss, sub) → IdentityId resolution
- Kernel-issued token verification

```typescript
class ExpressionResolver {
  constructor(private verifier: TokenVerifier) {}
  // ...
}
```

### 8.2 With KernelService (RelayToken)

The KernelService uses ExpressionResolver for the RelayToken endpoint:

```typescript
async relayToken(request: RelayTokenRequest): Promise<RelayTokenResponse> {
  // 1. Resolve expression using ExpressionResolver
  const resolved = await this.resolver.resolve(request.expression)

  // 2. Apply top-level scopes
  const withScopes = request.scopes
    ? this.resolver.applyScopes(resolved, request.scopes)
    : resolved

  // 3. Issue kernel-signed token with resolved grant
  return createKernelToken(withScopes)
}
```

### 8.3 With KernelService (Authentication)

The KernelService uses ExpressionResolver during authentication:

```typescript
async authenticate(token: string): Promise<AuthContext> {
  // 1. Verify JWT
  const { payload, identityId } = this.verifier.verify(token)

  // 2. SECURITY CHECK: External apps can only embed kernel-signed tokens
  if (payload.iss !== KERNEL_ISSUER && payload.grant) {
    validateGrantSecurity(payload.iss, payload.grant, this.verifier)
  }

  // 3. Resolve the grant
  const grant = await this.resolver.resolveGrant(payload.grant, identityId)

  return { principal: identityId, grant, origin: determineOrigin(payload.iss) }
}
```

### 8.4 Downstream: Identity Evaluator

After Expression Resolver, the Identity Evaluator expands database compositions. The Expression Resolver produces **resolved but unexpanded** expressions:

```
Expression Resolver output:   { kind: 'identity', id: 'USER1', scopes: [...] }
Identity Evaluator expands:   { kind: 'union',
                                left: { kind: 'identity', id: 'USER1' },
                                right: { kind: 'identity', id: 'ROLE1' } }
```

---

## 9. Edge Cases

### 9.1 Empty Scope Array After Intersection

When scope intersection produces an empty array, this means "no valid access":

```typescript
// Original: { perms: ['read'] }
// Applied:  { perms: ['write'] }
// Intersection: perms = [] → impossible

result.scopes = []  // Empty array means DENY, not unrestricted
```

**Important**: Empty array `[]` is distinct from `undefined`:
- `undefined` = unrestricted
- `[]` = nothing allowed (intersection was impossible)

### 9.2 Deeply Nested Kernel Tokens

Multi-hop delegation creates nested kernel tokens:

```
User JWT
  → Kernel-signed (App A restriction)
    → Kernel-signed (App B restriction)
      → Kernel-signed (App C restriction)
```

Each kernel token's inner grant is recursively resolved:

```
resolveJwtIdentity(appC_token)
  → payload.grant.forResource contains appB_token
  → resolveJwtIdentity(appB_token)
    → payload.grant.forResource contains appA_token
    → resolveJwtIdentity(appA_token)
      → payload.grant.forResource contains USER1
      → return { kind: 'identity', id: 'USER1' }
```

### 9.3 Plain ID Without JWT

Plain IDs are allowed in kernel-issued tokens:

```typescript
// Kernel can use plain IDs (trusted context)
const expr = { kind: 'identity', id: 'USER1' }

// External apps MUST use JWTs
const expr = { kind: 'identity', jwt: kernelSignedToken }
```

### 9.4 Grant with Missing Fields

Missing forType/forResource default to principal:

```typescript
// Grant: { v: 1 }  (no forType, no forResource)
// Principal: "APP1"
// Result: { forType: identity(APP1), forResource: identity(APP1) }
```

---

## 10. Performance Characteristics

### 10.1 Current Implementation

| Aspect | Behavior | Complexity |
|--------|----------|------------|
| **JWT Verification** | One per JWT in expression | O(N) where N = JWTs |
| **Tree Traversal** | Parallel branch resolution | O(depth) with parallelism |
| **Scope Intersection** | Pairwise for scope arrays | O(M × N) for scope arrays of size M, N |
| **Token Decoding** | Base64 decode + JSON parse | O(token size) |

### 10.2 Optimization: Parallel Resolution

Binary nodes (union, intersect, exclude) resolve both branches in parallel:

```typescript
const [left, right] = await Promise.all([
  this.resolveExpr(expr.left),
  this.resolveExpr(expr.right),
])
```

This means a balanced tree of depth D with 2^D leaves completes in O(D) time, not O(2^D).

### 10.3 Potential Optimization: Token Caching

Currently, if the same JWT appears multiple times in an expression, it's verified multiple times. A cache could prevent this:

```typescript
private tokenCache = new Map<string, VerificationResult>()

verify(token: string): VerificationResult {
  if (this.tokenCache.has(token)) {
    return this.tokenCache.get(token)!
  }
  const result = /* ... verify ... */
  this.tokenCache.set(token, result)
  return result
}
```

**Trade-off**: Memory vs. CPU. Relevant for expressions with repeated tokens.

---

## 11. API Reference

### 11.1 ExpressionResolver Class

```typescript
class ExpressionResolver {
  constructor(verifier: TokenVerifier)

  // Resolve an encoded expression to a fully resolved expression
  resolve(expr: EncodedIdentityExpr): Promise<IdentityExpr>

  // Resolve an encoded grant with principal defaults
  resolveGrant(encoded: EncodedGrant | undefined, principal: IdentityId): Promise<ResolvedGrant>

  // Apply top-level scopes to all leaves in an expression
  applyScopes(expr: IdentityExpr, scopes: Scope[]): IdentityExpr
}
```

### 11.2 Standalone Functions

```typescript
// Security validation for external app grants
function validateGrantSecurity(
  issuer: string,
  grant: EncodedGrant | undefined,
  verifier: TokenVerifier
): void

// Apply scopes to all leaves (exported for direct use)
function applyTopLevelScopes(expr: IdentityExpr, scopes: Scope[]): IdentityExpr

// Extract leftmost identity from expression (for JWT sub claim)
function extractPrimaryIdentity(expr: IdentityExpr): IdentityId
```

---

## 12. Test Coverage Summary

| Category | Test Cases |
|----------|------------|
| **Basic Resolution** | Plain ID, JWT with scopes, JWT without scopes |
| **Binary Operations** | Union resolution, intersect resolution, exclude resolution |
| **Scope Intersection** | Basic intersection, empty result, unrestricted handling |
| **Multi-Hop Delegation** | Nested kernel tokens, scope accumulation |
| **Security Validation** | External app with raw IdP token (rejected), external app with kernel token (allowed) |
| **Error Cases** | Expired token, untrusted issuer, wrong audience, unknown identity |
| **Grant Resolution** | Both fields present, defaults for missing fields, version validation |

---

## 13. Known Limitations

### 13.1 No Scope Expansion

Scopes can only be **restricted**, never expanded. There's no mechanism for a downstream app to widen scope restrictions:

```
App A restricts: { nodes: ['ws-1'] }
App B cannot add: { nodes: ['ws-1', 'ws-2'] }  // ws-2 would be dropped by intersection
```

This is by design for security, but may be limiting for certain delegation patterns.

### 13.2 Single Version Support

Only grant version `v: 1` is supported. Future versions would require migration logic.

### 13.3 Synchronous Scope Application

`applyScopes()` is synchronous and doesn't validate that scope values exist in the database. Invalid node/perm/principal IDs will only fail at AccessChecker time.

---

## 14. Open Questions

1. **Token Caching**: Should we implement token verification caching to avoid repeated JWT verification for the same token in an expression?

2. **Maximum Nesting Depth**: Should we enforce a maximum nesting depth for kernel tokens to prevent abuse? Current implementation has no limit.

3. **Scope Array Size Limits**: Pairwise intersection of large scope arrays is O(M×N). Should there be a maximum scope array size?

4. **Empty Scope Handling**: Currently, `scopes: []` after intersection means "deny all". Should we detect this early and short-circuit evaluation?

5. **Plain ID in External Apps**: Should external apps ever be allowed to use plain IDs (not JWTs)? Current design requires JWTs for all external app references.

6. **Partial Resolution**: If one branch of a union fails to resolve, should we allow the other branch to succeed (soft failure), or always fail-fast (current behavior)?
