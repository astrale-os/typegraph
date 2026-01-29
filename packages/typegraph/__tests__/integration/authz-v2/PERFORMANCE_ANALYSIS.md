# AuthZ-V2 Performance Analysis

## Executive Summary

Deep analysis of the capability-based authorization system reveals **7 critical bottlenecks** and **12 optimization opportunities** across the hot path. The primary concerns are:

1. **Sequential DB round-trips** in identity composition evaluation
2. **Suboptimal cache eviction** strategy (FIFO vs LRU)
3. **Expensive Cypher patterns** with variable-length traversals
4. **Synchronization points** blocking parallelism in the hot path

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           REQUEST FLOW                                    │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Token → [TRUST] → Grant → [RESOLVE] → IdentityExpr → [DECIDE] → bool   │
│            │                  │                           │              │
│         ~0.5ms              ~2-8ms                     ~1-5ms            │
│       (JWT verify)     (DB composition)            (Cypher query)       │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Critical Bottlenecks

### 1. Sequential Identity Composition Fetch (identity-evaluator.ts:121-167)

**Severity: HIGH**

```typescript
// PROBLEM: Sequential awaits for each composition edge
for (const unionId of unions) {
  const unionExpr = await this.evalIdentity(unionId, new Set(visited))  // AWAIT
  result = result ? { kind: 'union', left: result, right: unionExpr } : unionExpr
}
```

**Impact:**
- Expression with 5 unions = 5 sequential DB round-trips
- At 2ms/query latency, this adds **10ms** to resolution
- Worst case: deep composition tree = O(n) round-trips

**Recommendation:**
```typescript
// Batch all identity fetches upfront
const allIds = collectAllIdentityIds(rootId)
const compositions = await this.batchFetchIdentities(allIds)  // Single query
const expr = buildExprFromCache(rootId, compositions)
```

---

### 2. Variable-Length Path Traversal (cypher.ts:257-262)

**Severity: HIGH**

```cypher
OPTIONAL MATCH (target)-[:hasParent*0..20]->(n:Node)<-[hp:hasPerm]-(i:Identity {id: $id})
WHERE $perm IN hp.perms
```

**Impact:**
- `*0..20` explores ALL paths up to depth 20
- At 4 levels deep with branching factor 3: **~120 path evaluations**
- FalkorDB lacks path pruning optimization

**Recommendation:**
- Add depth hint parameter based on known hierarchy depth
- Consider bi-directional search from both ends
- Pre-compute "permission closure" for frequent identities

---

### 3. Synchronous getTargetType Before Parallelization (checker.ts:27-36)

**Severity: MEDIUM-HIGH**

```typescript
// PROBLEM: Blocks before starting parallel execution
const typeId = await queryPort.getTargetType(nodeId)  // SYNC WAIT

if (typeId) {
  const [typeGranted, targetGranted] = await Promise.all([...])  // NOW parallel
}
```

**Impact:**
- ~1-2ms blocked before any parallel work starts
- Resource check could start immediately (no typeId dependency)

**Current state actually does start resourcePromise early** - but the pattern is fragile:
```typescript
const resourcePromise = ...  // Started line 23
const typeId = await queryPort.getTargetType(nodeId)  // Line 27
```

This is correct but the getTargetType still blocks the type check initiation.

---

### 4. FIFO Cache Eviction (queries.ts:45-51)

**Severity: MEDIUM**

```typescript
private cacheSet<K, V>(cache: Map<K, V>, key: K, value: V): void {
  if (cache.size >= this.maxCacheSize) {
    const firstKey = cache.keys().next().value!  // FIFO eviction
    cache.delete(firstKey)
  }
  cache.set(key, value)
}
```

**Impact:**
- Hot keys can be evicted while cold keys remain
- Type checks for common types (frequently accessed) get evicted
- Cache thrashing under load

**Recommendation:**
```typescript
// Use LRU with O(1) operations
class LRUCache<K, V> {
  private cache = new Map<K, V>()

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      this.cache.delete(key)  // Move to end (most recent)
      this.cache.set(key, value)
    }
    return value
  }
}
```

---

### 5. JSON.stringify for Cache Keys (queries.ts:69-70)

**Severity: MEDIUM**

```typescript
const paramsKey = JSON.stringify(fragment.params)
const key = `${fragment.condition}|${paramsKey}|${typeId}`
```

**Impact:**
- `JSON.stringify` is slow for nested objects
- Called on every type check (hot path)
- Creates GC pressure from string allocations

**Recommendation:**
```typescript
// Pre-compute hash during fragment generation
interface CypherFragment {
  calls: string[]
  vars: string[]
  condition: string
  params: Record<string, unknown>
  _hash?: string  // Computed once during toCypher()
}
```

---

### 6. N+1 Query in queryLeafDetails (queries.ts:98-183)

**Severity: MEDIUM**

```typescript
// First query: ancestor path (if node restrictions)
if (hasNodeRestrictions) {
  const ancestorResults = await this.executor.run<...>(ancestorQuery, {...})  // Query 1
}

// Second query: batch identity lookups
const queryResults = await this.executor.run<...>(query, {...})  // Query 2
```

**Impact:**
- Cold path (explainAccess) makes 2 sequential queries
- Could be combined into single query with UNION or subquery

---

### 7. Scope Intersection Complexity (scope.ts:80-102)

**Severity: LOW-MEDIUM**

```typescript
export function intersectScopes(a: Scope[], b: Scope[]): Scope[] {
  for (const scopeA of a) {
    for (const scopeB of b) {
      const intersection = intersectScope(scopeA, scopeB)  // O(n*m)
      // ...
    }
  }
}
```

**Impact:**
- O(n*m) complexity where n,m are scope array lengths
- Typical case: n=m=1-3, so low impact
- Pathological case: delegated tokens with many scopes

---

## Secondary Optimization Opportunities

### 8. Set Copy on Every Branch (identity-evaluator.ts:141)

```typescript
const unionExpr = await this.evalIdentity(unionId, new Set(visited))
```

**Impact:** Creates new Set per branch for cycle detection. Consider persistent data structure.

---

### 9. Missing Prepared Statement Cache

FalkorDB queries are assembled as strings each time. Consider:
```typescript
class PreparedQuery {
  private static cache = new Map<string, PreparedQuery>()
  static get(template: string): PreparedQuery { ... }
}
```

---

### 10. Expression Tree Traversal Duplication

Both `toCypher` and `collectLeaves` traverse the expression tree. Could combine passes.

---

### 11. Base64 Encoding Intermediate Strings (codec.ts:61-64)

```typescript
let binaryString = ''
for (let i = 0; i < binary.length; i++) {
  binaryString += String.fromCharCode(binary[i]!)  // String concatenation
}
return btoa(binaryString)
```

**Recommendation:** Use `Buffer.from(binary).toString('base64')` directly.

---

### 12. Hash Function Uses String Concatenation (dedup.ts:111-125)

```typescript
function hashExpr(expr: IdentityExpr): string {
  case 'union':
    return `u:(${hashExpr(expr.left)}):(${hashExpr(expr.right)})`  // Concat
}
```

**Recommendation:** Use array join or pre-allocated buffer.

---

## Latency Budget Analysis

### Typical Permission Check (Happy Path)

| Phase | Operation | Expected Latency |
|-------|-----------|------------------|
| Trust | JWT decode (no verify in mock) | ~0.1ms |
| Trust | Issuer lookup | ~0.01ms |
| Resolve | Grant decode | ~0.1ms |
| Resolve | Identity composition fetch | ~2-8ms (**bottleneck**) |
| Decide | Generate Cypher | ~0.2ms |
| Decide | Execute type check | ~1-3ms |
| Decide | Execute resource check | ~1-3ms |
| **Total** | | **~4-15ms** |

### With Warm Cache

| Phase | Operation | Expected Latency |
|-------|-----------|------------------|
| Trust | JWT decode | ~0.1ms |
| Resolve | Grant decode | ~0.1ms |
| Resolve | Identity composition (cached) | ~0.1ms |
| Decide | Generate Cypher (cached fragments) | ~0.1ms |
| Decide | Type check (cached) | ~0.1ms |
| Decide | Resource check | ~1-3ms |
| **Total** | | **~1.5-3.5ms** |

---

## Query Complexity Analysis

### Simple Identity Check

```cypher
MATCH (target:Node {id: $resourceId})
CALL {
  WITH target
  OPTIONAL MATCH (target)-[:hasParent*0..20]->(n:Node)<-[hp:hasPerm]-(i:Identity {id: $id_0})
  WHERE $perm_0 IN hp.perms
  RETURN hp IS NOT NULL AS _c0
  LIMIT 1
}
WITH target, _c0
WHERE _c0
RETURN true AS found
LIMIT 1
```

**Complexity:** O(depth * branching_factor) path evaluations

### Composed Identity (Union of 3)

```cypher
MATCH (target:Node {id: $resourceId})
CALL { ... identity A ... RETURN _c0 LIMIT 1 }
CALL { ... identity B ... RETURN _c1 LIMIT 1 }
CALL { ... identity C ... RETURN _c2 LIMIT 1 }
WITH target, _c0, _c1, _c2
WHERE (_c0 OR _c1 OR _c2)
RETURN true AS found
LIMIT 1
```

**Problem:** All 3 CALL blocks execute even if first one returns true. No short-circuit.

### With Scope Restrictions

```cypher
CALL {
  WITH target
  MATCH (target)-[:hasParent*0..20]->(a:Node)
  OPTIONAL MATCH (a)<-[hp:hasPerm]-(i:Identity {id: $id_0})
  WHERE $perm_0 IN hp.perms
  RETURN count(hp) > 0 AS _c0, count(CASE WHEN a.id IN $scopeNodes_0 THEN 1 END) > 0 AS _s0
}
```

**Problem:** No early termination - must scan all ancestors.

---

## Memory Allocation Hotspots

1. **New Set() per branch** - identity-evaluator.ts:141
2. **String concatenation in hash** - dedup.ts:111-125
3. **JSON.stringify for cache keys** - queries.ts:69
4. **Array spread in scope filtering** - scope.ts:233
5. **Path arrays in leaf collection** - explainer.ts:194-196

---

## Index Requirements

Current indexes (from setup.ts):
```cypher
CREATE INDEX FOR (n:Node) ON (n.id)      -- Primary, covers all nodes
CREATE INDEX FOR (i:Identity) ON (i.id)  -- Identity lookups
```

**Missing but recommended:**
```cypher
-- Composite index for permission edge lookups
CREATE INDEX FOR ()-[r:hasPerm]-() ON (r.perms)

-- Index for type lookups (ofType edge target)
CREATE INDEX FOR (t:Type) ON (t.id)
```

---

## Recommendations Priority Matrix

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P0 | Batch identity composition fetch | Medium | High |
| P0 | Add LRU cache eviction | Low | Medium |
| P1 | Pre-compute fragment hash | Low | Medium |
| P1 | Bi-directional path search | High | High |
| P2 | Combine cold path queries | Medium | Low |
| P2 | Short-circuit union evaluation | High | Medium |
| P3 | Persistent Set for cycle detection | Low | Low |
| P3 | Optimize base64 encoding | Low | Low |

---

## Test Coverage Gaps

1. **No latency regression tests** - only correctness
2. **No cache hit rate monitoring**
3. **No memory allocation tracking**
4. **No concurrent access stress tests**
5. **Cold vs warm path not differentiated in metrics**

---

## Conclusion

The authorization system is well-architected with good separation of concerns. The primary performance bottleneck is the **sequential identity composition resolution** which can add 5-10ms per deeply composed identity. Secondary concerns are cache efficiency and Cypher query patterns.

For sub-5ms p95 latency targets:
1. Implement batch identity fetching
2. Add LRU caching with proper sizing
3. Consider pre-computing permission closures for hot identities
4. Add depth hints to Cypher traversals based on actual hierarchy depth
