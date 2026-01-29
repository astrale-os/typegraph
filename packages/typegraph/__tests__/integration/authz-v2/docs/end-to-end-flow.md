# End-to-End Flow - Irreducible DAG Analysis

## 1. Overview

This document captures the irreducible end-to-end authorization flow: from a client building an expression to the kernel returning a grant/deny decision. It identifies the minimum sequential steps, maximum parallelism, and architectural insights that should guide implementation.

### 1.1 The Question

> Given a client request with a JWT containing an identity expression, what are the concrete irreducible sequential steps to produce an access decision? What can be parallelized? What is the globally optimal DAG?

### 1.2 The Answer in One Formula

```
decision = check(forType, type(resourceId), 'use')
         ∧ check(forResource, resourceId, perm, principal)
```

Where `check(expr, node, perm, principal?)` evaluates an identity expression against the permission graph.

---

## 2. Three Irreducible Phases

The end-to-end flow decomposes into exactly **three** sequential phases. No phase can begin before its predecessor completes.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Phase 1: TRUST                                                         │
│  "Is this token valid? Who is speaking?"                                │
│                                                                          │
│  ┌────────────────────┐    ┌────────────────────────────────────────┐   │
│  │  JWT Verification   │    │  Identity Resolution (iss, sub) → ID  │   │
│  │  (crypto check)     │───▶│  (registry lookup)                    │   │
│  └────────────────────┘    └──────────────┬─────────────────────────┘   │
│                                            │                             │
│  ┌────────────────────────────────────────┐│                             │
│  │  Security Gate: validateGrantSecurity  ││                             │
│  │  (external apps → kernel-only tokens)  ││                             │
│  └────────────────────────────────────────┘│                             │
│                                            │                             │
│  Output: principal ID, resolved grant      │                             │
│          (IdentityExpr trees)              │                             │
└────────────────────────────────────────────┼─────────────────────────────┘
                                             │
                                             ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Phase 2: RESOLVE                                                        │
│  "What are the effective permissions?"                                   │
│                                                                          │
│  ┌────────────────────────────────────┐   ┌──────────────────────────┐  │
│  │  Expression Resolution             │   │  get_type(resourceId)    │  │
│  │  UnresolvedExpr → IdentityExpr     │   │  (resource → type lookup)│  │
│  │  (JWT leaves → plain ID leaves)    │   │                          │  │
│  └──────────────────┬─────────────────┘   └────────────┬─────────────┘  │
│                     │                                   │                │
│  These two can run ▲ IN PARALLEL ▲                      │                │
│                     │                                   │                │
│  Output: resolved expression trees + typeId             │                │
└─────────────────────┼───────────────────────────────────┼────────────────┘
                      │                                   │
                      ▼                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Phase 3: DECIDE                                                         │
│  "Grant or deny?"                                                        │
│                                                                          │
│  ┌────────────────────────────┐   ┌────────────────────────────────────┐│
│  │  Type Check                │   │  Resource Check                    ││
│  │  check(forType, typeId,    │   │  check(forResource, resourceId,   ││
│  │        'use', none)        │   │        perm, principal)            ││
│  └────────────────────────────┘   └────────────────────────────────────┘│
│                                                                          │
│  These two can run ▲ IN PARALLEL ▲                                       │
│                                                                          │
│  Output: AccessDecision { granted, deniedBy? }                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Phase Dependencies

| Phase | Depends On | Why |
|-------|-----------|-----|
| TRUST | Nothing | First step; raw JWT is the only input |
| RESOLVE | TRUST | Need principal + resolved grant to continue |
| DECIDE | RESOLVE | Need resolved expressions + typeId to evaluate |

### 2.2 Why Not 2 Phases? Why Not 4?

**Not 2**: TRUST and RESOLVE are distinct because trust establishes *who is speaking* (cryptographic verification), while resolve transforms *what they're asking for* (expression tree resolution). An untrusted token must be rejected before any resolution work.

**Not 4**: Composition expansion (evaluating `unionWith`/`intersectWith`/`excludeWith` edges from the graph) is NOT an irreducible step. It's an adapter optimization that can be fused into the DECIDE phase's Cypher query. The graph traversal that expands identity compositions and the graph traversal that checks permissions can be a single traversal.

---

## 3. The Irreducible DAG

```
                 ┌─────────────────┐
                 │  Input: JWT      │
                 │  + resourceId    │
                 │  + perm          │
                 └────────┬────────┘
                          │
                          ▼
                 ┌─────────────────┐
                 │  1. verify_jwt   │
                 │  (crypto)        │
                 └────────┬────────┘
                          │
                 ┌────────┴────────┐
                 │  2. security_    │
                 │     gate         │
                 │  (kernel-only    │
                 │   embedding)     │
                 └────────┬────────┘
                          │
             ┌────────────┼────────────┐
             │            │            │
             ▼            ▼            ▼
      ┌────────────┐ ┌─────────┐ ┌──────────┐
      │ 3a. resolve│ │3b. get_ │ │ (scope   │
      │ _expression│ │  type   │ │  eval is │
      │ (JWT→ID)   │ │         │ │  inline) │
      └─────┬──────┘ └────┬────┘ └──────────┘
            │              │
            └──────┬───────┘
                   │
          ┌────────┴────────┐
          │                 │
          ▼                 ▼
   ┌─────────────┐  ┌──────────────┐
   │ 4a. type_   │  │ 4b. resource_│
   │   check     │  │   check      │
   │ (DB query)  │  │ (DB query)   │
   └──────┬──────┘  └──────┬───────┘
          │                │
          └────────┬───────┘
                   │
                   ▼
          ┌────────────────┐
          │  5. combine    │
          │  (AND)         │
          └────────────────┘
```

### 3.1 Parallelism Opportunities

| Step | Can Run In Parallel With | Savings |
|------|------------------------|---------|
| 3a. resolve_expression | 3b. get_type | 1 DB round-trip saved |
| 4a. type_check | 4b. resource_check | 1 DB round-trip saved |

### 3.2 Critical Path

The minimum latency path is:

```
verify_jwt → security_gate → max(resolve_expression, get_type) → max(type_check, resource_check) → combine
```

**Minimum latency**: 1 crypto operation + 2 DB round-trips (or fewer with query fusion).

---

## 4. What Is NOT Irreducible

### 4.1 Composition Expansion

Identity composition (walking `unionWith`/`intersectWith`/`excludeWith` graph edges to build expression trees) is **not** an irreducible step. It's an adapter optimization choice.

**Current implementation**: The identity evaluator walks composition edges as a separate step before the access checker runs Cypher. This produces a materialized expression tree.

**Optimal implementation**: Composition can be fused into the Cypher query itself. Instead of first expanding `USER1 → union(USER1, ROLE1)` and then checking permissions, a single query can:

```cypher
// Fused: expand composition AND check permissions in one traversal
MATCH (target:Node {id: $resourceId})
MATCH (target)-[:hasParent*0..20]->(ancestor:Node)
MATCH (ancestor)<-[:hasPerm {perm: $perm}]-(i:Identity)
WHERE (i)-[:unionWith*0..]->(:Identity {id: $rootIdentity})
  // ... composition traversal embedded in WHERE
RETURN true AS found LIMIT 1
```

**Implication**: The adapter decides whether to materialize the expression tree first or fuse into a single query. The authorization layer doesn't need to know.

### 4.2 Short-Circuit (Type Check Before Resource Check)

The current implementation runs Phase 1 (type check) first, and skips Phase 2 if it fails. This is a **false optimization** for the success case:

- **Success path** (most common): Both checks must run regardless. Sequential execution adds one unnecessary DB round-trip.
- **Failure path**: Short-circuit saves one query, but failures are the minority case.

**Optimal**: Run both checks in parallel. The latency savings on the success path outweigh the wasted query on the (rare) failure path.

### 4.3 Scope Evaluation

Scope evaluation (filtering identity leaves by principal/perm/node restrictions) is inline computation during Cypher generation. It's not a separate step — it's part of translating the expression tree into a WHERE clause.

---

## 5. The Double-Resolution Problem

### 5.1 Current Flow

The current relay token implementation has a wasteful pattern:

```
RelayToken endpoint:
  1. Receive expression with JWT leaves
  2. RESOLVE: JWT → plain ID (verify each JWT, extract identityId)
  3. Apply scopes → resolved IdentityExpr with plain IDs
  4. identityExprToUnresolved() → CONVERT BACK to UnresolvedIdentityExpr
  5. Embed in kernel-signed JWT as grant.forResource

Authenticate endpoint:
  6. Verify the kernel-signed JWT
  7. RESOLVE AGAIN: decodeGrant() walks the expression tree
     - But all leaves are already plain IDs (no JWTs to verify)
     - This is a no-op tree walk that reconstructs the same structure
```

### 5.2 The Waste

Step 7 is a complete waste. The expression was already resolved in Step 2. Converting it back to `UnresolvedIdentityExpr` in Step 4 only to re-resolve it in Step 7 does nothing useful — every leaf already has a plain `id` field, so `resolveIdentity()` just copies it.

### 5.3 The Fix

The kernel-signed JWT should carry the **resolved** expression directly. When authenticating a kernel-issued token, the grant's expression trees should be trusted as-is without re-resolution:

```
Option A: Skip re-resolution for kernel tokens
  If payload.iss === KERNEL_ISSUER:
    grant = payload.grant  // Already resolved, trust it

Option B: Carry IdentityExpr directly (not UnresolvedIdentityExpr)
  Token payload carries resolved IdentityExpr
  No conversion back-and-forth needed
```

---

## 6. The Single-Query Possibility

### 6.1 Concept

Both the type check and resource check can theoretically be executed in a **single database query** using `OPTIONAL MATCH` and conditional `WHERE`:

```cypher
// Single query: type check + resource check
MATCH (target:Node {id: $resourceId})
OPTIONAL MATCH (target)-[:ofType]->(type:Type)

// Type check (forType expression against type node)
OPTIONAL MATCH (type)-[:hasParent*0..20]->(typeAncestor:Node)
  <-[:hasPerm {perm: 'use'}]-(typeIdentity:Identity)
WHERE ${forTypeCypher(typeIdentity)}

// Resource check (forResource expression against resource node)
OPTIONAL MATCH (target)-[:hasParent*0..20]->(resAncestor:Node)
  <-[:hasPerm {perm: $perm}]-(resIdentity:Identity)
WHERE ${forResourceCypher(resIdentity, principal)}

RETURN
  type IS NULL OR typeIdentity IS NOT NULL AS typeCheck,
  resIdentity IS NOT NULL AS resourceCheck
LIMIT 1
```

### 6.2 Trade-offs

| Aspect | Single Query | Two Queries |
|--------|-------------|-------------|
| Round-trips | 1 | 2 (or 3 with type lookup) |
| Latency | Minimum | Higher |
| Complexity | Higher Cypher | Simpler Cypher |
| Error reporting | Less granular | Clear phase identification |
| Graph engine load | One larger traversal | Two smaller traversals |
| Short-circuit | Not possible | Can skip resource check |

### 6.3 Recommendation

The single-query approach is worth pursuing for the hot path. The cold path (explainAccess) should remain multi-query for better error reporting and per-leaf detail.

---

## 7. Minimum Latency Analysis

### 7.1 Theoretical Minimum

```
1 crypto operation (JWT verify)          ~1ms
+ 1 DB round-trip (fused single query)   ~2-5ms
────────────────────────────────────────
Total: ~3-6ms
```

### 7.2 Practical Minimum (Current Architecture)

```
1 crypto operation (JWT verify)           ~1ms
+ 1 DB round-trip (get_type || resolve)   ~2-5ms  (parallel)
+ 1 DB round-trip (type + resource check) ~2-5ms  (parallel)
────────────────────────────────────────
Total: ~5-11ms
```

### 7.3 Current Implementation

```
1 crypto operation (JWT verify)           ~1ms
+ 1 DB round-trip (get_type)              ~2-5ms
+ 1 DB round-trip (type check)            ~2-5ms  (sequential!)
+ 1 DB round-trip (resource check)        ~2-5ms  (sequential!)
────────────────────────────────────────
Total: ~7-16ms
```

### 7.4 Improvement Roadmap

| Optimization | Saves | Effort |
|-------------|-------|--------|
| Parallel type + resource check | 1 round-trip | Low (Promise.all) |
| Parallel get_type + resolve | 1 round-trip | Low (Promise.all) |
| Fuse type + resource into single query | 1 round-trip | Medium (Cypher complexity) |
| Fuse composition into check query | 1 round-trip | High (Cypher rewrite) |

---

## 8. Composition: Two Mechanisms

The system has two distinct composition mechanisms that operate at different levels:

### 8.1 Client-Side Expression Composition

Built by the SDK, carried in JWTs:

```typescript
union(identity("USER1"), identity("ROLE1"))
  .intersect(identity("TENANT_MEMBER"))
  .exclude(identity("SUSPENDED"))
```

**Properties**:
- Built before any DB interaction
- Encoded into JWT payloads (compact JSON or binary)
- Fixed at token issuance time
- Explicit: the client says exactly what they want

### 8.2 Database-Side Identity Composition

Graph edges between Identity nodes:

```
USER1 --[:unionWith]--> ROLE_EDITOR
USER1 --[:intersectWith]--> TENANT_MEMBER
USER1 --[:excludeWith]--> SUSPENDED
```

**Properties**:
- Dynamic: changes when admin modifies identity relationships
- Resolved by the adapter at query time
- Reflects organizational policy, not per-request decisions

### 8.3 How They Combine

The client expression references identities. Each referenced identity may have DB compositions. The adapter resolves DB compositions and merges them with the client expression:

```
Client expression:   identity("USER1")
DB composition:      USER1 = union(USER1, ROLE_EDITOR)

Effective:           union(USER1, ROLE_EDITOR)
```

With the fused approach, this expansion happens inside the Cypher query, not as a separate step.

---

## 9. The Security Gate

### 9.1 Why It's Irreducible

The security gate (`validateGrantSecurity`) is a distinct sequential step between TRUST and RESOLVE. It cannot be parallelized with resolution because:

1. It must examine the grant **before** resolving it
2. If an external app embeds a raw IdP token (not kernel-signed), we must reject **before** attempting JWT verification on the embedded token
3. The gate is an authorization check on the token structure itself, not on the resolved content

### 9.2 The Rule

```
If JWT issuer !== KERNEL_ISSUER:
  ALL embedded JWTs in the grant MUST be kernel-signed
```

This prevents privilege escalation where a malicious app embeds a stolen IdP token to impersonate a user.

### 9.3 Position in the DAG

```
verify_jwt → security_gate → resolve_expression
                           → get_type (parallel)
```

The security gate runs after JWT verification (need to know the issuer) and before expression resolution (need to validate before resolving).

---

## 10. Scope Semantics Summary

Scopes are not a separate step but are woven into the DECIDE phase. They modify how identity leaves contribute to the expression evaluation.

### 10.1 The Three Dimensions

| Dimension | Checked Against | When Evaluated |
|-----------|----------------|----------------|
| `principals` | Requesting principal | During expression → Cypher (filters leaves) |
| `perms` | Requested permission | During expression → Cypher (filters leaves) |
| `nodes` | Resource ancestry | In Cypher WHERE clause (ancestor check) |

### 10.2 Interaction Rules

```
Within one scope:     principals AND perms AND nodes  (all must pass)
Across scopes:        scope_1 OR scope_2 OR scope_3   (any can pass)
Across identities:    depends on operator (union/intersect/exclude)
Scope intersection:   makes MORE restrictive (never less)
```

### 10.3 Empty Set Propagation

When a scope filters an identity leaf to the empty set (`false`), it propagates through operators:

```
union(false, B)     = B       (∅ ∪ B = B)
union(false, false) = false   (∅ ∪ ∅ = ∅)
intersect(false, B) = false   (∅ ∩ B = ∅)
exclude(false, B)   = false   (∅ \ B = ∅)
exclude(A, false)   = A       (A \ ∅ = A)
```

---

## 11. Summary: The Irreducible Flow

### 11.1 Steps

| # | Step | Phase | Sequential Gate? | Parallelizable? |
|---|------|-------|-----------------|-----------------|
| 1 | `verify_jwt` | TRUST | Yes (entry point) | No |
| 2 | `security_gate` | TRUST | Yes (must precede resolve) | No |
| 3a | `resolve_expression` | RESOLVE | No | Yes (with 3b) |
| 3b | `get_type` | RESOLVE | No | Yes (with 3a) |
| 4a | `type_check` | DECIDE | No | Yes (with 4b) |
| 4b | `resource_check` | DECIDE | No | Yes (with 4a) |
| 5 | `combine (AND)` | DECIDE | Yes (final) | No |

### 11.2 Minimum Operations

| Resource | Count | Description |
|----------|-------|-------------|
| Crypto ops | 1 | JWT signature verification |
| DB round-trips | 1-3 | Depends on query fusion level |
| Tree walks | 1 | Expression → Cypher translation |

### 11.3 Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Composition is not a phase | Fuse into adapter | Adapter-specific optimization, not core semantics |
| Short-circuit is a false optimization | Parallel checks | Success path (majority) benefits from parallelism |
| Security gate is a distinct step | Sequential after verify | Must validate token structure before resolving |
| get_type can start early | Parallel with resolve | No dependency on resolved expressions |
| Single-query is possible | Worth pursuing for hot path | Minimum latency, acceptable complexity |
| Double-resolution is waste | Fix in implementation | Kernel tokens should carry resolved expressions |
