# Identity Evaluator - High-Level Specification

## 1. Overview

The **Identity Evaluator** is a core component of the AUTH_V2 authorization system responsible for building expression trees from identity composition relationships stored in the graph database.

### 1.1 Role in the System

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Authorization Request                            │
│                  checkAccess(grant, resourceId, perm, principal)       │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Identity Evaluator                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. Fetch identity composition data from FalkorDB               │   │
│  │  2. Detect cycles to prevent infinite recursion                 │   │
│  │  3. Build expression tree from composition edges                │   │
│  │  4. Return IdentityExpr for downstream evaluation               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Access Checker                                 │
│              (Generates Cypher queries, evaluates permissions)          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Responsibilities

| Responsibility | Description |
|---------------|-------------|
| **Composition Fetching** | Query the graph for identity relationships (`unionWith`, `intersectWith`, `excludeWith`) |
| **Tree Building** | Construct `IdentityExpr` trees from composition data |
| **Cycle Detection** | Prevent infinite loops from circular composition references |
| **Expression Resolution** | Expand SDK expressions by resolving unscoped leaves to their DB composition |

---

## 2. Core Algorithm

### 2.1 The Composition Formula

The evaluator implements the following evaluation formula for an identity `X`:

```
eval(X) = ((X? ∪ union₁ ∪ union₂...) ∩ intersect₁ ∩ intersect₂...) \ exclude₁ \ exclude₂...
```

Where:
- `X?` = X's direct permissions (included only if `hasDirectPerms = true`)
- `∪` = Union (OR) - grants access if ANY identity has permission
- `∩` = Intersect (AND) - grants access if ALL identities have permission
- `\` = Exclude (SET DIFFERENCE) - removes permissions from the result set

### 2.2 Operator Precedence

Operators are applied in a strict order:

1. **Union** applied first - builds the base permission set
2. **Intersect** applied second - restricts to common permissions
3. **Exclude** applied last - removes specific permissions

This precedence is implicit in the tree structure: unions form the innermost grouping, intersects wrap unions, and excludes wrap the entire result.

### 2.3 Associativity

All operators are applied **left-associatively**:

```
Given: X unionWith [A, B, C]

Result: ((X ∪ A) ∪ B) ∪ C

Tree structure:
        union
       /     \
    union     C
   /     \
 union    B
 /   \
X     A
```

---

## 3. Data Structures

### 3.1 Input: Identity Composition

Data fetched from the graph database:

```typescript
type IdentityComposition = {
  id: IdentityId              // The identity being evaluated
  unions: IdentityId[]        // IDs of identities to union with
  intersects: IdentityId[]    // IDs of identities to intersect with
  excludes: IdentityId[]      // IDs of identities to exclude
  hasDirectPerms: boolean     // Whether identity has direct hasPerm edges
}
```

### 3.2 Output: Identity Expression

The generated expression tree:

```typescript
type IdentityExpr =
  | { kind: 'identity'; id: IdentityId; scopes?: Scope[] }  // Leaf node
  | { kind: 'union'; left: IdentityExpr; right: IdentityExpr }
  | { kind: 'intersect'; left: IdentityExpr; right: IdentityExpr }
  | { kind: 'exclude'; left: IdentityExpr; right: IdentityExpr }
```

### 3.3 Scopes (for SDK expressions)

```typescript
type Scope = {
  nodes?: NodeId[]          // Restrict to these subtrees
  perms?: PermissionT[]     // Restrict to these permission types
  principals?: IdentityId[] // Restrict which principals can invoke
}
```

---

## 4. Database Query

### 4.1 Current Query

```cypher
MATCH (i:Identity {id: $id})
OPTIONAL MATCH (i)-[:unionWith]->(u:Identity)
OPTIONAL MATCH (i)-[:intersectWith]->(n:Identity)
OPTIONAL MATCH (i)-[:excludeWith]->(e:Identity)
OPTIONAL MATCH (i)-[:hasPerm]->(permTarget)
WITH i,
     collect(DISTINCT u.id) AS unions,
     collect(DISTINCT n.id) AS intersects,
     collect(DISTINCT e.id) AS excludes,
     count(DISTINCT permTarget) > 0 AS hasDirectPerms
RETURN
  i.id AS id,
  unions,
  intersects,
  excludes,
  hasDirectPerms
```

### 4.2 Query Design Decisions

| Decision | Rationale |
|----------|-----------|
| **OPTIONAL MATCH** | Identity may have no composition edges - prevents empty results |
| **collect(DISTINCT ...)** | Handles multiple edges to same target; removes nulls from OPTIONAL MATCH |
| **count(DISTINCT permTarget) > 0** | FalkorDB-compatible boolean for "has permissions" check |
| **Separate OPTIONAL MATCH** | Each composition type queried independently for clarity |

### 4.3 Known Optimization: Cartesian Product

**Issue**: Multiple `OPTIONAL MATCH` clauses create intermediate row multiplication. If identity has 3 unions, 2 intersects, 1 exclude, and 5 perms → 30 intermediate rows before `collect(DISTINCT)` collapses them.

**Optimized query using list comprehensions**:

```cypher
MATCH (i:Identity {id: $id})
RETURN
  i.id AS id,
  [(i)-[:unionWith]->(u:Identity) | u.id] AS unions,
  [(i)-[:intersectWith]->(n:Identity) | n.id] AS intersects,
  [(i)-[:excludeWith]->(e:Identity) | e.id] AS excludes,
  size([(i)-[:hasPerm]->() | 1]) > 0 AS hasDirectPerms
```

> **Note**: Uses `size([...] | 1]) > 0` instead of `exists()` for FalkorDB compatibility.

### 4.4 Known Limitation: N+1 Query Pattern

**Issue**: Each `evalIdentity()` call makes a separate DB fetch. For composition chain `A → B → C → D`, this results in 4 sequential round trips. For diamonds, the same identity may be fetched multiple times via different paths.

**Potential optimization**: Batch fetch all reachable identities in one query:

```cypher
MATCH (start:Identity {id: $id})
MATCH path = (start)-[:unionWith|intersectWith|excludeWith*0..MAX_DEPTH]->(i:Identity)
WITH DISTINCT i
// fetch composition for all i at once
```

**Trade-off**: Adds complexity (pre-traversal, cycle handling in query, more memory) for performance gain. Current approach is simpler and acceptable for shallow graphs (depth ≤ 3-4). Optimize if profiling shows bottleneck.

---

## 5. Algorithm: evalIdentity()

### 5.1 Pseudocode

```
function evalIdentity(id, visited = {}):
    // Step 1: Cycle detection
    if id in visited:
        throw CycleDetectedError(id, visited)
    visited.add(id)

    // Step 2: Fetch composition data
    composition = fetchIdentity(id)

    // Step 3: Leaf node check
    if composition.unions.isEmpty AND composition.intersects.isEmpty AND composition.excludes.isEmpty:
        return { kind: 'identity', id: id }

    // Step 4: Build base expression
    result = composition.hasDirectPerms ? { kind: 'identity', id: id } : null

    // Step 5: Apply unions (left-associative)
    for each unionId in composition.unions:
        unionExpr = evalIdentity(unionId, clone(visited))  // Fresh visited for branch
        result = result ? { kind: 'union', left: result, right: unionExpr } : unionExpr

    // Step 6: Apply intersects
    for each intersectId in composition.intersects:
        intersectExpr = evalIdentity(intersectId, clone(visited))
        result = result ? { kind: 'intersect', left: result, right: intersectExpr } : intersectExpr

    // Step 7: Apply excludes
    for each excludeId in composition.excludes:
        excludeExpr = evalIdentity(excludeId, clone(visited))
        result = result ? { kind: 'exclude', left: result, right: excludeExpr } : null

    // Step 8: Validate result
    if result is null:
        throw InvalidIdentityError(id, 'Identity has no permissions and no valid composition')

    return result
```

### 5.2 Key Implementation Details

#### Fresh Visited Set per Branch

```typescript
// Each branch gets a CLONE of the visited set
const unionExpr = await this.evalIdentity(unionId, new Set(visited))
```

This is critical for handling **diamond patterns** correctly. See Section 7 for detailed explanation.

#### hasDirectPerms Handling

An identity with composition but no direct permissions starts with `result = null`:

```typescript
let result: IdentityExpr | null = hasDirectPerms ? { kind: 'identity', id } : null
```

**Semantic meaning**:
- `hasDirectPerms=true`: Identity participates in its own composition → `X ∩ A ∩ B`
- `hasDirectPerms=false`: Identity is a **named composition** (alias/role definition) → `A ∩ B`

This allows defining "RoleX = intersection of capabilities A and B" without RoleX needing its own direct permissions.

### 5.3 Known Optimization: Parallel Processing

**Issue**: Current implementation processes unions/intersects/excludes sequentially:

```typescript
for (const unionId of unions) {
  const unionExpr = await this.evalIdentity(unionId, new Set(visited))  // SEQUENTIAL
}
```

**Optimized approach**:

```typescript
const unionExprs = await Promise.all(
  unions.map(id => this.evalIdentity(id, new Set(visited)))
)
for (const unionExpr of unionExprs) {
  result = result ? { kind: 'union', left: result, right: unionExpr } : unionExpr
}
```

### 5.4 Known Optimization: Memoization

**Issue**: Diamond patterns cause the same identity to be evaluated multiple times.

**Optimized approach**: Add memoization cache (orthogonal to cycle detection):

```typescript
private memo = new Map<string, IdentityExpr>()

async evalIdentity(id: string, visited: Set<string>): Promise<IdentityExpr> {
  // Cycle check FIRST (per-path)
  if (visited.has(id)) throw new CycleDetectedError(...)

  // Memo check SECOND (global)
  if (this.memo.has(id)) return this.memo.get(id)!

  visited.add(id)
  const result = /* ... compute ... */
  this.memo.set(id, result)
  return result
}
```

---

## 6. Algorithm: evalExpr()

### 6.1 Purpose

Resolve SDK-built expressions by expanding unscoped identity leaves from their database composition.

### 6.2 Rules

| Leaf Type | Behavior |
|-----------|----------|
| **Unscoped leaf** (`{ kind: 'identity', id: 'X' }`) | Expanded via `evalIdentity()` |
| **Scoped leaf** (`{ kind: 'identity', id: 'X', scopes: [...] }`) | Preserved as-is (explicit restriction) |

### 6.3 Rationale

Scoped leaves indicate the caller has explicitly restricted this identity's permissions. Expanding would override their intent:

```typescript
// User explicitly wants USER1 restricted to read permission only
identity("USER1", { perms: ['read'] })

// If expanded, USER1's ROLE1 union would add edit permissions - WRONG
// So scoped leaves are preserved, not expanded
```

### 6.4 Binary Node Handling

Both branches are resolved in parallel:

```typescript
const [left, right] = await Promise.all([
  this.resolveExpr(expr.left),
  this.resolveExpr(expr.right),
])
```

---

## 7. Cycles vs Diamonds

### 7.1 Why Cycles Are Blocked

A cycle creates **infinite recursion** with no finite expression tree:

```
A unionWith B
B unionWith A
```

Evaluation attempt:
```
evalIdentity(A)
  → A unions with B
  → evalIdentity(B)
    → B unions with A
    → evalIdentity(A)
      → A unions with B
        → ... infinite
```

The expression would be: `A ∪ B ∪ A ∪ B ∪ A ∪ B...` — **mathematically undefined**.

### 7.2 Can Cycles Be Computed?

**For union-only or intersect-only cycles**: Yes, via fixed-point computation.

```
A unionWith B, B unionWith A

Equations:
  perms(A) = A_direct ∪ perms(B)
  perms(B) = B_direct ∪ perms(A)

Solution (least fixed point):
  perms(A) = perms(B) = A_direct ∪ B_direct
```

**For exclude cycles**: No — non-deterministic (multiple valid solutions).

**For mixed-operator cycles**: May have no solution or multiple solutions.

### 7.3 Why We Don't Support Cycles

1. **Exclude cycles are non-deterministic** — no single correct answer
2. **Mixed cycles may have no solution**
3. **Cycles add no expressive power** — any cyclic composition can be rewritten as equivalent acyclic composition
4. **Complexity cost exceeds benefit**

### 7.4 Cycles Indicate Modeling Problems

| What You Write | What You Mean | Better Model |
|----------------|---------------|--------------|
| A extends B, B extends A | A and B are identical | Single identity, or shared base |
| A extends B, B extends C, C extends A | Circular hierarchy | Flat group, or find the actual hierarchy |

**Every valid business case for "mutual extension" can be expressed without cycles.**

### 7.5 Why Diamonds Are Allowed

A diamond is when the same identity is reached via **different branches**:

```
    A
   / \
  B   C
   \ /
    D
```

Evaluation:
```
evalIdentity(A)
  → evalIdentity(B) with visited={A}
    → evalIdentity(D) with visited={A,B} ✓ terminates
  → evalIdentity(C) with visited={A}     // Fresh clone!
    → evalIdentity(D) with visited={A,C} ✓ terminates (D not in THIS path)
```

Result: `(A ∪ (B ∪ D)) ∪ (C ∪ D)` — **finite tree, valid**.

D appears twice but that's just duplication, not infinite recursion.

### 7.6 The Key Distinction

| Pattern | Same node in... | Result |
|---------|-----------------|--------|
| **Cycle** | Its own ancestry (path from root to current) | Infinite loop |
| **Diamond** | Different branches (siblings) | Finite tree with duplication |

### 7.7 Why Set Cloning Is Necessary

The `new Set(visited)` clone for each branch is **required for correctness**, not an inefficiency to optimize away:

```typescript
// If we shared the visited set (WRONG):
visited.add('A')
evalIdentity('B', visited)  // adds B, D
evalIdentity('C', visited)  // D already in visited! FALSE CYCLE ERROR
```

Cloning allows diamonds while catching real cycles.

---

## 8. Error Handling

### 8.1 Error Types

| Error | Condition | Example |
|-------|-----------|---------|
| `CycleDetectedError` | Identity appears twice in same evaluation path | `A → B → A` |
| `IdentityNotFoundError` | Identity ID doesn't exist in graph | `evalIdentity("NONEXISTENT")` |
| `InvalidIdentityError` | Identity has no permissions AND no valid composition | Exclude-only identity |

### 8.2 Exclude-Only Identity Rejection

An identity with only `excludeWith` edges (no unions, no intersects, no direct perms) is invalid:

```typescript
// EXCLUDE_ONLY excludeWith TARGET
// result starts null (no direct perms, no unions, no intersects)
// exclude processing: result = result ? ... : null  → still null
// → throws InvalidIdentityError
```

**Rationale**: Mathematically, `∅ \ A = ∅`. But there's no "empty set" expression type in `IdentityExpr`. Rather than adding complexity for a dubious use case, we reject it and force the user to fix their model.

An exclude-only identity typically indicates a modeling error — you can't exclude permissions from nothing.

### 8.3 Leaf Identity Without Permissions

A leaf identity (no composition edges) is valid even if `hasDirectPerms=false`:

```typescript
if (unions.length === 0 && intersects.length === 0 && excludes.length === 0) {
  return { kind: 'identity', id }  // Valid even if hasDirectPerms=false
}
```

**Rationale**: Separation of concerns. The evaluator builds expressions; the AccessChecker validates permissions. A permission-less identity will simply deny access at check time, which is the correct behavior. The identity may:
- Get permissions added later
- Be used in a union where another branch grants access

---

## 9. Edge Cases

### 9.1 Leaf Identity (No Composition)

```typescript
// Identity with no unionWith, intersectWith, or excludeWith edges
// Returns simple leaf expression regardless of hasDirectPerms
return { kind: 'identity', id: id }
```

**Note**: This returns a leaf even if `hasDirectPerms = false`. The AccessChecker handles permission checking - the evaluator just builds the expression.

### 9.2 Identity with Only Union Composition

```typescript
// UNION_ONLY unionWith ROLE1 (UNION_ONLY has no direct perms)
// result starts as null
// After union processing: result = ROLE1's expression
// Final result: just ROLE1's tree (UNION_ONLY not included)
```

### 9.3 Identity with Only Intersection Composition

```typescript
// X intersectWith A, X intersectWith B (X has no direct perms)
// result starts as null
// After first intersect: result = A's expression
// After second intersect: result = { kind: 'intersect', left: A, right: B }
// X itself is NOT in the tree (no direct perms)
```

**Note**: X is a "named composition" — it defines `A ∩ B` without participating itself.

### 9.4 Complex Nested Composition

```typescript
// W unionWith A, W unionWith B, W intersectWith D, W excludeWith E
// (where A, D, E may themselves have composition)

// Step 1: Build union chain
result = A_expr
result = { union: result, B_expr }  // (A ∪ B)

// Step 2: Apply intersects
result = { intersect: result, D_expr }  // (A ∪ B) ∩ D

// Step 3: Apply excludes
result = { exclude: result, E_expr }  // ((A ∪ B) ∩ D) \ E
```

### 9.5 Deep Composition Chains

```typescript
// A unionWith B unionWith C unionWith D...
// Each is recursively evaluated
// Maximum depth limited by stack/FalkorDB query timeout, not by evaluator
```

---

## 10. Integration with Access Checker

### 10.1 Expression to Cypher Translation

The AccessChecker converts the expression tree to Cypher WHERE clauses:

```typescript
// Expression: (A ∪ B) ∩ C \ D

// Generated Cypher pattern:
WHERE (
  (target)-[:hasParent*0..20]->(:Node)<-[:hasPerm {perm: $perm}]-(:Identity {id: 'A'})
  OR
  (target)-[:hasParent*0..20]->(:Node)<-[:hasPerm {perm: $perm}]-(:Identity {id: 'B'})
) AND (
  (target)-[:hasParent*0..20]->(:Node)<-[:hasPerm {perm: $perm}]-(:Identity {id: 'C'})
) AND NOT (
  (target)-[:hasParent*0..20]->(:Node)<-[:hasPerm {perm: $perm}]-(:Identity {id: 'D'})
)
```

### 10.2 Empty Set Propagation

When scopes filter out an identity, it becomes an empty set (∅):

| Expression | Result | Explanation |
|-----------|--------|-------------|
| A ∪ ∅     | A      | Union with empty adds nothing |
| A ∩ ∅     | ∅      | Intersect with empty yields empty |
| A \ ∅     | A      | Excluding nothing changes nothing |

---

## 11. API Reference

### 11.1 IdentityEvaluator Class

```typescript
class IdentityEvaluator {
  constructor(executor: RawExecutor)

  // Fetch raw composition data from graph
  fetchIdentity(id: string): Promise<IdentityComposition>

  // Build expression tree from identity's DB composition
  evalIdentity(id: string, visited?: Set<string>): Promise<IdentityExpr>

  // Resolve SDK expression by expanding unscoped leaves
  evalExpr(exprOrBuilder: IdentityExpr | ExprBuilder): Promise<IdentityExpr>
}
```

### 11.2 Factory Function

```typescript
function createIdentityEvaluator(executor: RawExecutor): IdentityEvaluator
```

---

## 12. Usage Examples

### 12.1 Basic Identity Evaluation

```typescript
const evaluator = createIdentityEvaluator(executor)

// Evaluate USER1 (which has unionWith ROLE1 in DB)
const userExpr = await evaluator.evalIdentity('USER1')
// Result: { kind: 'union', left: { kind: 'identity', id: 'USER1' }, right: { kind: 'identity', id: 'ROLE1' } }
```

### 12.2 SDK Expression Resolution

```typescript
const evaluator = createIdentityEvaluator(executor)

// SDK expression with unscoped leaves
const expr = union(identity('USER1'), identity('A'))
const resolved = await evaluator.evalExpr(expr)
// USER1 expanded to union(USER1, ROLE1)
// A expanded to its DB composition
// Result: union(union(USER1, ROLE1), A_expanded)
```

### 12.3 Scoped Leaves Preserved

```typescript
const evaluator = createIdentityEvaluator(executor)

// Scoped leaf - NOT expanded
const expr = identity('USER1', { perms: ['read'] })
const resolved = await evaluator.evalExpr(expr)
// Result: { kind: 'identity', id: 'USER1', scopes: [{ perms: ['read'] }] }
```

---

## 13. Test Coverage Summary

| Category | Test Cases |
|----------|------------|
| **Union** | Basic union, 3-way union, union grants access via role |
| **Intersect** | Basic intersect, 3-way intersect, grants only when all have permission |
| **Exclude** | Basic exclude, multiple excludes, union+exclude, complex composition |
| **Cycles** | Direct cycle, indirect cycle, diamond pattern (allowed) |
| **Edge Cases** | Leaf identity, union-only identity, intersect-only identity, exclude-only (error) |
| **evalExpr** | Builder acceptance, scoped leaf preservation, mixed scoped/unscoped, nested resolution |

---

## 14. Performance Characteristics

### 14.1 Current Implementation

| Aspect | Behavior | Complexity |
|--------|----------|------------|
| **DB Queries** | One per identity (N+1 pattern) | O(N) round trips where N = nodes in composition tree |
| **Tree Building** | Sequential within categories | O(N) with sequential awaits |
| **Cycle Detection** | Set clone per branch | O(D) per branch where D = depth |
| **Diamond Handling** | Re-evaluates same identity | Duplicated work |

### 14.2 Optimization Opportunities

| Optimization | Impact | Complexity | Recommendation |
|--------------|--------|------------|----------------|
| List comprehension query | Eliminates cartesian product | Low | **Implement** |
| Parallel processing | Faster tree building | Low | **Implement** |
| Memoization | Eliminates diamond re-evaluation | Medium | **Implement** |
| Batch fetching | Single DB round trip | High | Profile first |

---

## 15. Open Questions

1. **Max Composition Depth**: Should the evaluator enforce a maximum depth to prevent stack overflow? Current behavior relies on runtime limits.

2. **Diamond Duplication**: When the same identity is reached via multiple paths, it appears multiple times in the expression tree. Should deduplication be performed at the evaluator level, or is this the responsibility of downstream optimization (e.g., `expr-dedup.ts`)?

3. **Scoped + Expanded**: The rule "scoped leaves are not expanded" assumes callers explicitly set scopes when they want to restrict. What if a caller wants both: apply scopes AND expand composition? Currently not supported.
