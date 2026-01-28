# Access Checker - High-Level Specification

## 1. Overview

The **Access Checker** is the authorization entry point for AUTH_V2. It answers the question: "Given this grant, can this principal perform this operation on this resource?"

### 1.1 Role in the System

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Caller provides: Grant + resourceId + perm + principal                │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Access Checker                                 │
│                                                                         │
│  Phase 1: Type Check                                                    │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Does the app (forType expression) have USE on the resource type? │  │
│  │ Unrestricted — no principal scoping                               │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│                            Passes? │ No → { granted: false,            │
│                                    │        deniedBy: 'type' }         │
│                                    ▼                                    │
│  Phase 2: Resource Check                                                │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Does the user (forResource expression) have PERM on the resource?│  │
│  │ Principal-scoped — filtered by requesting principal               │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│                            Passes? │ No → { granted: false,            │
│                                    │        deniedBy: 'resource' }     │
│                                    ▼                                    │
│                    { granted: true }                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Two APIs

| API | Path | Purpose | Returns |
|-----|------|---------|---------|
| `checkAccess()` | **Hot** | Runtime authorization | `AccessDecision` (grant/deny + phase) |
| `explainAccess()` | **Cold** | Debugging & auditing | `AccessExplanation` (full breakdown per phase) |

Both APIs run the same two-phase logic. They **must always agree** — this is verified by tests.

### 1.3 Responsibilities

| Responsibility | Description |
|----------------|-------------|
| **Input validation** | Prevent Cypher injection via whitelist regex |
| **Type resolution** | Lookup resource → type via `ofType` edge (cached) |
| **Expression → Cypher** | Recursive translation of `IdentityExpr` to WHERE clause |
| **Scope filtering** | Apply principal/perm/node restrictions from scopes |
| **Query execution** | Run generated Cypher against FalkorDB |
| **Result interpretation** | Combine phase results into final decision |

### 1.4 Architectural Note

> The access checker currently contains both authorization logic (what to check) and adapter logic (how to check via Cypher). In the target architecture, these will be separated:
> - **authorization/checker.ts** — scope evaluation, expression tree semantics, decision logic
> - **adapters/falkordb/cypher.ts** — Cypher generation, query execution

---

## 2. Data Structures

### 2.1 Input: Grant

```typescript
type Grant = {
  forType: IdentityExpr       // Phase 1 — app-level identity expression
  forResource: IdentityExpr   // Phase 2 — user-level identity expression
}
```

The grant separates two concerns:
- **forType**: Does the *application* have permission to USE this type of resource? (e.g., "Can the CRM app use Module resources?")
- **forResource**: Does the *user* have permission on the specific resource? (e.g., "Can Alice read Module M1?")

### 2.2 Output: AccessDecision (Hot Path)

```typescript
type AccessDecision = {
  granted: boolean
  deniedBy?: 'type' | 'resource'
}
```

Three possible outcomes:
- `{ granted: true }` — both phases passed
- `{ granted: false, deniedBy: 'type' }` — phase 1 failed (app lacks USE on type)
- `{ granted: false, deniedBy: 'resource' }` — phase 2 failed (user lacks PERM on resource)

### 2.3 Output: AccessExplanation (Cold Path)

```typescript
type AccessExplanation = {
  resourceId: NodeId        // Echo input
  perm: PermissionT         // Echo input
  principal: IdentityId     // Echo input
  granted: boolean
  deniedBy?: 'type' | 'resource'
  typeCheck: PhaseExplanation
  resourceCheck: PhaseExplanation
}

type PhaseExplanation = {
  expression: IdentityExpr      // The expression tree evaluated
  leaves: LeafEvaluation[]      // Status of each identity leaf
  cypher: string                // Generated Cypher WHERE clause
}
```

### 2.4 Leaf Evaluation

Each identity leaf in the expression tree gets a `LeafEvaluation`:

```typescript
type LeafEvaluation = {
  path: number[]             // Position in tree (e.g., [0, 1] = left.right)
  identityId: IdentityId

  // One of three statuses:
  status: 'granted' | 'filtered' | 'missing'

  // When status = 'granted':
  grantedAt?: NodeId         // Ancestor where permission was found
  inheritancePath?: NodeId[] // resource → ... → grantedAt

  // When status = 'filtered':
  filterDetail?: FilterDetail[]  // Why each scope rejected this leaf

  // When status = 'missing':
  searchedPath?: NodeId[]    // resource → ... → root (searched but not found)

  // Node scope restrictions to verify (if any):
  nodeRestrictions?: NodeId[]
}
```

**Path encoding**:
- `[]` — root (single identity)
- `[0]` — left branch
- `[1]` — right branch
- `[0, 1]` — left.right
- `[0, 0, 1]` — left.left.right

**Status meanings**:
- `granted` — permission found and all scope restrictions satisfied
- `filtered` — scope rejected this leaf (principal or perm didn't match)
- `missing` — scope allowed but permission not found in ancestor chain

### 2.5 Filter Detail

```typescript
type FilterDetail = {
  scopeIndex: number              // Which scope failed
  failedCheck: 'principal' | 'perm'  // Why it failed
}
```

Note: Node restrictions are **not** filter details. They're enforced in Cypher (hot path) or verified after querying (cold path), not during leaf collection.

---

## 3. Two-Phase Architecture

### 3.1 Why Two Phases?

The system separates **application-level access** from **user-level access**:

| Phase | Expression | Permission | Principal Scoping | Semantics |
|-------|-----------|-----------|------------------|-----------|
| **Type** | `grant.forType` | `'use'` (hardcoded) | **None** (unrestricted) | "Can this app USE this type of resource?" |
| **Resource** | `grant.forResource` | Caller-provided | **Yes** (filtered) | "Can this user perform this operation here?" |

### 3.2 Type Check Details

1. Look up the resource's type via `ofType` edge
2. If resource has no type → **skip phase 1** (always passes)
3. Generate Cypher from `forType` with permission `'use'` and no principal
4. Execute against the type node
5. If not found → `{ granted: false, deniedBy: 'type' }`

### 3.3 Resource Check Details

1. Generate Cypher from `forResource` with the requested `perm` and `principal`
2. Principal triggers scope filtering (scoped leaves may be rejected)
3. Execute against the resource node
4. If not found → `{ granted: false, deniedBy: 'resource' }`

### 3.4 No-Type Shortcut

When a resource has no `ofType` edge (e.g., a workspace node), the type check is skipped entirely:

```typescript
// Hot path: typeId is null, skip phase 1
if (typeId) { /* type check */ }

// Cold path: synthetic pass
typeCheck = { expression: forType, leaves: [], cypher: 'true' }
typeGranted = true
```

---

## 4. Hot Path: checkAccess()

### 4.1 Signature

```typescript
async checkAccess(
  grant: Grant,
  resourceId: NodeId,
  perm: PermissionT,
  principal: IdentityId,
): Promise<AccessDecision>
```

### 4.2 Flow

```
1. validateAccessInputs(grant, resourceId, perm, principal)
2. typeId = await getTargetType(resourceId)           // Cached
3. if (typeId):
     typeCypher = toCypher(forType, 'target', 'use', undefined)
     if typeCypher === 'false' → return deniedBy: 'type'
     typeGranted = await executeCheck(typeCypher, typeId)
     if !typeGranted → return deniedBy: 'type'
4. targetCypher = toCypher(forResource, 'target', perm, principal)
   if targetCypher === 'false' → return deniedBy: 'resource'
   targetGranted = await executeCheck(targetCypher, resourceId)
5. return { granted: targetGranted, deniedBy: targetGranted ? undefined : 'resource' }
```

### 4.3 Query Template

```cypher
MATCH (target:Node {id: $resourceId})
WHERE ${cypherCheck}
RETURN true AS found
LIMIT 1
```

Returns `true` if at least one match exists, `false` otherwise.

### 4.4 Early Exit: 'false' Optimization

`toCypher()` can return the string `'false'` when it determines the expression is unsatisfiable (e.g., all leaves are scope-filtered). When this happens, the check skips the DB query entirely:

```typescript
if (typeCypher === 'false') {
  return { granted: false, deniedBy: 'type' }
}
```

---

## 5. Cold Path: explainAccess()

### 5.1 Signature

```typescript
async explainAccess(
  grant: Grant,
  resourceId: NodeId,
  perm: PermissionT,
  principal: IdentityId,
): Promise<AccessExplanation>
```

### 5.2 Flow

```
1. validateAccessInputs(grant, resourceId, perm, principal)
2. typeId = await getTargetType(resourceId)
3. Phase 1:
     if (typeId):
       typeCheck = await explainPhase(forType, typeId, 'use', undefined)
       typeGranted = evaluateGranted(forType, typeCheck.leaves)
     else:
       typeCheck = { expression: forType, leaves: [], cypher: 'true' }
       typeGranted = true
4. Phase 2:
     resourceCheck = await explainPhase(forResource, resourceId, perm, principal)
     targetGranted = evaluateGranted(forResource, resourceCheck.leaves)
5. return {
     resourceId, perm, principal,
     granted: typeGranted && targetGranted,
     deniedBy: !typeGranted ? 'type' : !targetGranted ? 'resource' : undefined,
     typeCheck, resourceCheck
   }
```

### 5.3 Phase Explanation: explainPhase()

For each phase:

```
1. collectLeaves(expr, [], principal, perm)
   → Traverse expression tree
   → Apply scope filters (principal/perm)
   → Extract node restrictions
   → Return LeafEvaluation[] with status='filtered' or status='missing'

2. toCypher(expr, 'target', perm, principal)
   → Generate Cypher WHERE clause

3. queryLeafDetails(activeLeaves, resourceId, perm)
   → For each non-filtered leaf, query DB for permission
   → Update status to 'granted' or 'missing'
   → Populate grantedAt, inheritancePath, searchedPath

4. return { expression, leaves, cypher }
```

### 5.4 Expression Evaluation: evaluateGranted()

After leaf statuses are populated, the expression tree is evaluated semantically:

```typescript
evaluateGranted(expr, leaves, path = []):
  case 'identity':
    leaf = leaves.find(l => l.path matches path)
    return leaf?.status === 'granted'

  case 'union':
    return evaluateGranted(left, ..., [...path, 0])
        || evaluateGranted(right, ..., [...path, 1])

  case 'intersect':
    return evaluateGranted(left, ..., [...path, 0])
        && evaluateGranted(right, ..., [...path, 1])

  case 'exclude':
    return evaluateGranted(left, ..., [...path, 0])
        && !evaluateGranted(right, ..., [...path, 1])
```

This correctly implements set operation semantics. A `filtered` or `missing` leaf evaluates as `false` (not granted).

### 5.5 Leaf Detail Query

For each unique identity in the active leaves:

```cypher
MATCH (target:Node {id: $resourceId})
MATCH path = (target)-[:hasParent*0..${maxDepth}]->(ancestor:Node)
OPTIONAL MATCH (ancestor)<-[:hasPerm {perm: $perm}]-(i:Identity {id: $identityId})
WITH target, ancestor, path, i
ORDER BY length(path)
WITH collect({
  ancestor: ancestor.id,
  pathNodes: [n IN nodes(path) | n.id],
  hasPermission: i IS NOT NULL
}) AS results
RETURN results
```

Results are ordered by path length (nearest ancestor first). The first result with `hasPermission: true` is the grant point.

For leaves with node restrictions, the system also checks whether the resource is a descendant of one of the restricted nodes.

---

## 6. Cypher Generation

### 6.1 Expression → Cypher Translation

The `toCypher()` method recursively converts an `IdentityExpr` into a Cypher WHERE clause:

| Expression Kind | Cypher Pattern |
|----------------|---------------|
| `identity` | `identityToCypher()` (see 6.2) |
| `union` | `(left OR right)` |
| `intersect` | `(left AND right)` |
| `exclude` | `(left AND NOT right)` |

### 6.2 Identity Leaf → Cypher

Base pattern (no scope restrictions):

```cypher
(target)-[:hasParent*0..20]->(ancestor:Node)
  <-[:hasPerm {perm: 'read'}]-(:Identity {id: 'USER1'})
```

This checks: does the target have ANY ancestor (including itself, via `*0..`) that has a `hasPerm` edge from the specified identity?

### 6.3 Empty Set Propagation

When a branch evaluates to `'false'` (empty set), it propagates through operators:

```typescript
// Union: ∅ ∪ B = B, A ∪ ∅ = A, ∅ ∪ ∅ = ∅
case 'union':
  if (left === 'false' && right === 'false') return 'false'
  if (left === 'false') return right
  if (right === 'false') return left
  return `(${left} OR ${right})`

// Intersect: ∅ ∩ B = ∅, A ∩ ∅ = ∅
case 'intersect':
  if (left === 'false' || right === 'false') return 'false'
  return `(${left} AND ${right})`

// Exclude: ∅ \ B = ∅, A \ ∅ = A
case 'exclude':
  if (left === 'false') return 'false'
  if (right === 'false') return left
  return `(${left} AND NOT ${right})`
```

This optimization avoids generating complex Cypher for provably-empty branches.

---

## 7. Scope Evaluation

### 7.1 Scope Semantics

```typescript
type Scope = {
  nodes?: NodeId[]          // Restrict to subtrees (AND with other dimensions)
  perms?: PermissionT[]     // Restrict permission types
  principals?: IdentityId[] // Restrict who can invoke
}
```

**Key rules**:
- Within a single scope: all dimensions are **AND'd** (principal AND perm AND nodes must pass)
- Multiple scopes on one identity: **OR'd** (ANY scope passing allows the identity)
- `undefined` or `[]` for any dimension = **unrestricted** (that dimension always passes)

### 7.2 Scope Check Flow

```
scopePasses(scope, principal, perm):
  1. If scope.principals defined AND principal not in list → fails (principal)
  2. If scope.perms defined AND perm not in list → fails (perm)
  3. Otherwise → passes
  // Note: scope.nodes is NOT checked here — enforced in Cypher or post-query
```

```
scopesAllow(scopes, principal, perm):
  1. If no scopes → allowed, applicableScopes = []
  2. Filter scopes by scopePasses()
  3. If any passes → allowed, return passing scopes
  4. If none pass → not allowed
```

### 7.3 Where Each Dimension Is Enforced

| Dimension | Hot Path | Cold Path |
|-----------|----------|-----------|
| `principals` | `identityToCypher()` returns `'false'` | `collectLeaves()` marks as `filtered` |
| `perms` | `identityToCypher()` returns `'false'` | `collectLeaves()` marks as `filtered` |
| `nodes` | Cypher WHERE clause adds ancestor check | `queryLeafDetails()` verifies post-query |

### 7.4 Node Scope in Cypher

When applicable scopes have node restrictions, the Cypher pattern adds an ancestor constraint:

**Single scope, single node**:
```cypher
(target)-[:hasParent*0..20]->(:Node {id: 'workspace-1'})
AND (target)-[:hasParent*0..20]->(ancestor:Node)
  <-[:hasPerm {perm: 'read'}]-(:Identity {id: 'USER1'})
```

**Single scope, multiple nodes** (OR'd within scope):
```cypher
((target)-[:hasParent*0..20]->(:Node {id: 'ws-1'})
  OR (target)-[:hasParent*0..20]->(:Node {id: 'ws-2'}))
AND (permission pattern)
```

**Multiple scopes** (OR'd between scopes):
```cypher
(
  (node-check-scope-1 AND permission-pattern)
) OR (
  (node-check-scope-2 AND permission-pattern)
)
```

### 7.5 Node Scope in Cold Path

The cold path cannot embed node restrictions in the Cypher query (it queries all leaves uniformly). Instead:

1. During `collectLeaves()`: extract `nodeRestrictions` from applicable scopes
2. During `queryLeafDetails()`: if the leaf has node restrictions, fetch the target's ancestors and verify that at least one restricted node is in the ancestor chain
3. If not satisfied: mark as `missing` despite the permission existing

---

## 8. Security: Input Validation

### 8.1 Cypher Injection Prevention

All string inputs are validated before Cypher interpolation. This is critical because the access checker generates Cypher by string concatenation (identity IDs, permission names, node IDs are interpolated directly).

### 8.2 Validation Rules

```
SAFE_ID_REGEX = /^[a-zA-Z0-9_:-]{1,256}$/
```

| Validated Input | Check |
|----------------|-------|
| `resourceId` | Matches SAFE_ID_REGEX |
| `perm` | Matches SAFE_ID_REGEX |
| `principal` | Matches SAFE_ID_REGEX |
| All identity IDs in expression trees | Matches SAFE_ID_REGEX |
| All node IDs in scopes | Matches SAFE_ID_REGEX |
| All principal IDs in scopes | Matches SAFE_ID_REGEX |
| All perm values in scopes | Matches SAFE_ID_REGEX |
| Expression tree depth | Max 100 levels |

### 8.3 Allowed Characters

```
a-z A-Z 0-9 _ - :
```

Colons support namespaced IDs (e.g., `org:workspace-1`). Max length of 256 prevents DoS via oversized IDs.

### 8.4 Exhaustive Check

The `throwExhaustiveCheck()` function ensures all expression kinds are handled:

```typescript
function throwExhaustiveCheck(expr: never): never {
  throw new Error(`Unknown expression kind: ${(expr as { kind: string }).kind}`)
}
```

TypeScript's `never` type guarantees compile-time exhaustiveness. The runtime check is a safety net.

---

## 9. Type Caching

### 9.1 Cache Design

```typescript
private typeCache = new Map<NodeId, NodeId | null>()
```

- Key: resource ID
- Value: type ID or `null` (explicitly caches "no type")
- Scope: per `AccessChecker` instance (no global state)

### 9.2 Query

```cypher
MATCH (t:Node {id: $resourceId})
OPTIONAL MATCH (t)-[:ofType]->(type:Type)
RETURN type.id AS typeId
LIMIT 1
```

### 9.3 Invalidation

```typescript
clearCache(): void {
  this.typeCache.clear()
}
```

Manual invalidation only. No TTL, no automatic eviction. Suitable for request-scoped instances or explicit cache management.

---

## 10. Integration with Identity Evaluator

The access checker operates on **resolved** `IdentityExpr` trees. It does not resolve identity composition itself — that's the evaluator's job.

### 10.1 Typical Flow

```typescript
// 1. Evaluator resolves identity composition from graph
const evaluator = new IdentityEvaluator(executor)
const userExpr = await evaluator.evalIdentity('USER1')
// Returns: { kind: 'union', left: { id: 'USER1' }, right: { id: 'ROLE1' } }

// 2. Checker evaluates the resolved expression
const checker = createAccessChecker(executor)
const result = await checker.checkAccess(
  grant(identity('APP1'), userExpr),
  'M1', 'read', 'principal'
)
```

### 10.2 Pre-resolved vs On-the-fly

The access checker can work with:
- **Pre-resolved expressions** — evaluator ran beforehand, expression embedded in grant
- **Simple leaf expressions** — no composition, just `identity('USER1')`
- **SDK-built expressions** — union/intersect/exclude built by client, not from DB

The checker doesn't care how the expression was built — it just translates to Cypher.

---

## 11. Edge Cases

### 11.1 Empty Expression (No Identities)

An empty union (no identities) produces an expression with an impossible scope that always filters to `false`:

```typescript
// From helpers.ts: union() with 0 args
return identity('__EMPTY__', [{ principals: ['__IMPOSSIBLE__'] }])
```

This identity will be filtered by any principal, producing `'false'` in Cypher.

### 11.2 Resource Without Type

When a resource has no `ofType` edge:
- Hot path: Phase 1 is skipped entirely
- Cold path: `typeCheck = { leaves: [], cypher: 'true' }`
- Type-only identities in `forType` are never evaluated

### 11.3 Permission Inheritance

Permissions propagate down the `hasParent` hierarchy:

```
Root                    ← USER1 has 'read' here
  └── workspace-1
       └── M1           ← USER1 has 'read' (inherited from Root)
```

The Cypher pattern `(target)-[:hasParent*0..20]->(ancestor:Node)<-[:hasPerm]-(identity)` traverses up to `maxDepth` ancestors to find inherited permissions.

### 11.4 Multiple Identical Leaves

If the same identity appears multiple times in the expression tree (e.g., after diamond resolution), each occurrence is evaluated independently with its own path. They may have different scope restrictions.

### 11.5 Deep Expression Trees

Expression depth is capped at 100 during validation. Beyond that, validation throws. This prevents stack overflow during recursive Cypher generation and leaf collection.

---

## 12. Performance Characteristics

### 12.1 Hot Path Costs

| Operation | Cost |
|-----------|------|
| Input validation | O(N) where N = total nodes in expression trees |
| Type lookup | 1 query (cached after first call) |
| Cypher generation | O(N) recursive traversal |
| Phase 1 query | 1 query (or 0 if type check skipped or Cypher is 'false') |
| Phase 2 query | 1 query (or 0 if Cypher is 'false') |
| **Total DB queries** | **1-3 per checkAccess() call** |

### 12.2 Cold Path Costs

| Operation | Cost |
|-----------|------|
| Leaf collection | O(N) traversal |
| Cypher generation | O(N) per phase |
| Ancestor query | 1 query (only if node restrictions exist) |
| Leaf detail queries | 1 per unique identity (not per leaf) |
| **Total DB queries** | **2 + unique_identities** (up to ancestors + unique_ids + type) |

### 12.3 Optimizations Present

- **Type caching**: Avoids repeated type lookups for same resource
- **Early `'false'` exit**: Skips DB query when expression is provably unsatisfiable
- **Empty set propagation**: Prunes dead branches during Cypher generation
- **Unique identity batching**: In cold path, queries per identity, not per leaf

### 12.4 Known Limitations

- **String interpolation for Cypher**: IDs are interpolated directly, requiring strict validation. Parameterized queries would be safer but FalkorDB's parameter support is limited for pattern matching.
- **No query caching**: Same expression with different resources generates same Cypher structure but requires re-execution.
- **Sequential phases**: Phase 2 waits for Phase 1 to complete. Could be parallelized when type check is skippable (no type → start resource check immediately).

---

## 13. API Reference

### 13.1 AccessChecker Class

```typescript
class AccessChecker {
  constructor(executor: RawExecutor, config?: AccessCheckerConfig)

  // Hot path: simple grant/deny
  checkAccess(grant: Grant, resourceId: NodeId, perm: PermissionT, principal: IdentityId): Promise<AccessDecision>

  // Cold path: detailed explanation
  explainAccess(grant: Grant, resourceId: NodeId, perm: PermissionT, principal: IdentityId): Promise<AccessExplanation>

  // Evaluate expression tree from leaf statuses (public for testing)
  evaluateGranted(expr: IdentityExpr, leaves: LeafEvaluation[], path?: number[]): boolean

  // Clear type cache
  clearCache(): void
}
```

### 13.2 Configuration

```typescript
interface AccessCheckerConfig {
  maxDepth?: number  // Max hierarchy traversal depth (default: 20)
}
```

### 13.3 Factory

```typescript
function createAccessChecker(executor: RawExecutor, config?: AccessCheckerConfig): AccessChecker
```

---

## 14. Test Coverage Summary

| Category | Test File | Cases |
|----------|-----------|-------|
| **Hot path basics** | `new-api.test.ts` | Granted, denied by type, denied by resource, missing type identity, missing target identity |
| **Type check** | `new-api.test.ts` | App lacks USE permission, non-typed targets skip type check |
| **Multiple identities** | `new-api.test.ts` | OR semantics across multiple type identities |
| **Cold path** | `new-api.test.ts` | Detailed explanation for granted/denied, path indices, filtered leaves, missing leaves |
| **API consistency** | `new-api.test.ts` | checkAccess and explainAccess agree on all outcomes (granted, type denial, resource denial, intersect, exclude, node scopes) |
| **Node scopes** | `scopes.test.ts` | Target in/out of scope, scope + composition, multi-scope OR |
| **Perm scopes** | `scopes.test.ts` | Permission in/out of scope |
| **Complex scopes** | `scopes.test.ts` | Both node and perm restrictions simultaneously |
| **Scope edge cases** | `scopes.test.ts` | Empty scopes array, undefined scopes, empty perms array |
| **Composition + scopes** | `scopes.test.ts` | Scopes on evaluated expressions (intersect/union) |
| **Input validation** | `new-api.test.ts` | Cypher injection in resourceId, perm, identity ID, scope node ID; valid IDs with hyphens/colons |
| **Deep hierarchy** | `edge-cases.test.ts` | 15-level deep hierarchy traversal |
| **Caching** | `edge-cases.test.ts` | Consistent results, cache clear |
| **Type permission** | `edge-cases.test.ts` | App without/with type USE permission |

---

## 15. Concerns Separation Analysis

### 15.1 Current Mixing

The access checker currently combines multiple concerns in one class:

| Method | Authorization (what) | Adapter (how) |
|--------|---------------------|---------------|
| `checkAccess()` | Two-phase logic, scope semantics | Cypher generation, query execution |
| `explainAccess()` | Phase evaluation, result assembly | Cypher generation, leaf queries |
| `toCypher()` | — | Pure adapter (Cypher generation) |
| `identityToCypher()` | — | Pure adapter (Cypher + scope → node patterns) |
| `executeCheck()` | — | Pure adapter (query execution) |
| `getTargetType()` | — | Pure adapter (type lookup) |
| `evaluateGranted()` | Pure authorization (expression semantics) | — |
| `collectLeaves()` | Pure authorization (scope filtering, tree traversal) | — |
| `scopePasses()` | Pure authorization (scope rules) | — |
| `checkFilter()` | Pure authorization (scope composition) | — |
| `queryLeafDetails()` | Node restriction verification | Query execution, ancestor traversal |

### 15.2 Target Split

**authorization/checker.ts** will contain:
- `evaluateGranted()` — expression tree semantics
- `collectLeaves()` — leaf extraction with scope filtering
- `scopePasses()`, `checkFilter()`, `scopesAllow()` — scope rules
- Two-phase orchestration logic

**adapters/falkordb/cypher.ts** will contain:
- `toCypher()`, `identityToCypher()` — expression → Cypher
- `executeCheck()` — query execution
- `getTargetType()` — type lookup
- `queryLeafDetails()` — leaf detail queries

---

## 16. Open Questions

1. **Phase parallelization**: When the resource has no type, Phase 2 could start immediately. Should we pre-check for type existence before starting Phase 1?

2. **Cypher parameterization**: Currently IDs are interpolated directly into Cypher strings, requiring strict validation. FalkorDB's parameter support for pattern matching is limited — can this be improved?

3. **Cold path node restriction verification**: The cold path queries permission existence first, then verifies node restrictions post-hoc. This means a leaf might show as "missing" despite having the permission — because the node restriction wasn't satisfied. Should the explanation distinguish "permission exists but node scope unsatisfied" from "no permission"?

4. **evaluateGranted() public visibility**: This method is public (used in tests). In the target architecture, should it be a standalone pure function in authorization/ rather than an instance method?
