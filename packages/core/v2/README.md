# Graph Query AST Redesign Spec

## Context

We have an immutable AST builder (`builder.ts`) and type definitions (`types.ts`) for a graph database query language. The AST represents queries as a linear pipeline of steps, with a fluent builder API that returns new `QueryAST` instances on each method call. There is also a visitor pattern (`visitor.ts`) for traversing/transforming the AST.

The current AST works but was designed bottom-up from the traversal-oriented fluent API. An analysis from first principles against graph query fundamentals identified concrete gaps in expressiveness, redundant step types, and one structural issue that must be fixed.

The builder and AST remain co-located in the same class. That's intentional — simpler mental model for now.

---

## Design Principles

1. **A non-primitive AST node earns its place if it carries semantic intent the compiler can exploit** and would be costly to reverse-engineer from a desugared form.
2. **The step list (pipeline) is the correct top-level structure.** A query IS sequential: establish bindings → filter → extend → aggregate → sort → project. Graph-shaped structures live inside individual steps (PatternStep, ForkStep, SubqueryStep).
3. **Two complementary APIs coexist:** a traversal API (current, chain-oriented) and a pattern API (new, declarative subgraph matching). Both emit steps into the same pipeline and compose freely via alias references.

---

## Changes Overview

| Action | Item | Rationale |
|--------|------|-----------|
| **Add** | `PatternStep` | Declarative subgraph matching — cycles, diamonds, multi-point joins in one step |
| **Add** | `SubqueryCondition` | General correlated subquery predicates, replaces `ExistsCondition` + `ConnectedToCondition` |
| **Add** | `SubqueryStep` | Correlated subquery as a pipeline step (top-N-per-group, per-row computation) |
| **Add** | `ReturnStep` | Projection as a terminal step in the pipeline, not a side-channel field |
| **Add** | `ProjectionExpression` | Computed return values (`price * quantity`, `coalesce(name, 'Unknown')`) |
| **Add** | `UnwindStep` | Expand array properties into rows |
| **Add** | `ConditionValue` type | Distinguish literals from query parameters for plan caching |
| **Add** | `'except'` to `BranchStep.operator` | Set difference |
| **Remove** | `FirstStep` | Identical to `LimitStep` |
| **Remove** | `CursorStep` | Pagination encoding — desugar to `where` + `orderBy` + `limit` at the API layer before it reaches the AST |
| **Remove** | `ExistsCondition` | Subsumed by `SubqueryCondition` |
| **Remove** | `ConnectedToCondition` | Subsumed by `SubqueryCondition` |
| **Restructure** | `Projection` | Clean up: remove `raw`, `includeDepth`, duplicated `aggregate`; use typed `ProjectionReturn` array |
| **Update** | `visitor.ts` | Add visitor methods for all new step types; remove methods for removed types |

---

## Detailed Specifications

### 1. `PatternStep` (NEW)

**Motivation:** The current AST can only build graph patterns incrementally via chains of match + traverse. This makes simple chains easy but complex shapes (cycles, diamonds, multi-point joins) awkward. ForkStep exists as a patch for this limitation. A PatternStep declares an entire subgraph template as a unit.

**How it synergizes:** A PatternStep establishes alias bindings, just like MatchStep and TraversalStep do. Subsequent pipeline steps (WhereStep, TraversalStep, AggregateStep, etc.) reference those aliases. The traversal API can continue from any alias bound by a pattern. They interleave freely:

```
[PatternStep] → [WhereStep] → [TraversalStep from pattern alias] → [ReturnStep]
```

**Type definition:**

```typescript
interface PatternNode {
  /** Internal alias for this node (e.g., 'n0', 'n1') */
  alias: string
  /** User-facing alias if set via .as() */
  userAlias?: string
  /** Match nodes with any of these labels (empty = any label) */
  labels?: string[]
  /** Optional direct ID binding (for known-node patterns) */
  id?: string
  /** Inline property constraints on this node */
  where?: WhereCondition[]
}

interface PatternEdge {
  /** Optional alias for referencing edge properties */
  alias?: string
  /** User-facing edge alias */
  userAlias?: string
  /** Edge type(s) to match */
  types: string[]
  /** Direction: out = from→to, in = to→from, both = either */
  direction: 'out' | 'in' | 'both'
  /** Alias of source node (must reference a PatternNode.alias in the same pattern) */
  from: string
  /** Alias of target node (must reference a PatternNode.alias in the same pattern) */
  to: string
  /** Variable-length traversal config */
  variableLength?: VariableLengthConfig
  /** Inline edge property constraints */
  where?: EdgeWhereCondition[]
  /** Per-edge optionality (LEFT JOIN semantics for THIS edge) */
  optional: boolean
}

interface PatternStep {
  type: 'pattern'
  nodes: PatternNode[]
  edges: PatternEdge[]
}
```

**Key design decisions:**
- Optionality is per-edge, not per-pattern. "Match person→company, optionally match company→address" is one pattern with mixed optionality.
- Nodes can have inline where conditions for convenience. These are semantically identical to a subsequent WhereStep targeting the same alias.
- A single-node zero-edge pattern is equivalent to MatchStep. A two-node one-edge pattern is equivalent to MatchStep + TraversalStep. The compiler can recognize and optimize these degenerate cases.

**Builder impact:** Add a new `addPattern(config)` method on `QueryAST`. The builder should register all node and edge aliases in the alias registry, same as it does for match/traverse. After a pattern step, `currentNodeAlias` can be set to the last node in the pattern, or the builder can require explicit alias selection for subsequent traversals.

---

### 2. `SubqueryCondition` (NEW — replaces `ExistsCondition` and `ConnectedToCondition`)

**Motivation:** The current `ExistsCondition` only checks single-edge existence. You cannot express "nodes where there exists a 3-hop path to a node with property X." `ConnectedToCondition` is a special case of single-edge existence to a specific node ID. Both are subsumed by a general subquery predicate.

**Type definition:**

```typescript
interface SubqueryCondition {
  type: 'subquery'
  /** What to check */
  mode: 'exists' | 'notExists' | 'count'
  /** 
   * Full sub-AST. Can contain any steps: pattern, traversal, where, aggregate, etc.
   * The last step should be a ReturnStep if mode is 'count'.
   */
  query: ASTNode[]
  /** For count mode: compare the result count against a value */
  countPredicate?: { operator: ComparisonOperator; value: number }
  /** Aliases from the outer scope that this subquery references */
  correlatedAliases: string[]
}
```

**Migration from removed types:**

Current `ExistsCondition`:
```typescript
// Before
{ type: 'exists', edge: 'KNOWS', direction: 'out', target: 'n0', negated: false }

// After
{ 
  type: 'subquery', 
  mode: 'exists',
  query: [
    { type: 'traversal', edges: ['KNOWS'], direction: 'out', fromAlias: 'n0', ... }
  ],
  correlatedAliases: ['n0']
}
```

Current `ConnectedToCondition`:
```typescript
// Before
{ type: 'connectedTo', edge: 'WORKS_AT', direction: 'out', nodeId: '123', target: 'n0' }

// After
{
  type: 'subquery',
  mode: 'exists',
  query: [
    { type: 'traversal', edges: ['WORKS_AT'], direction: 'out', fromAlias: 'n0', toAlias: 'n_sub0', ... },
    { type: 'where', conditions: [{ type: 'comparison', field: 'id', operator: 'eq', value: '123', target: 'n_sub0' }] }
  ],
  correlatedAliases: ['n0']
}
```

**Note:** The builder can still expose convenience methods like `.whereConnectedTo(edge, nodeId)` and `.whereEdgeExists(edge, direction)` — they just emit `SubqueryCondition` nodes internally.

---

### 3. `SubqueryStep` (NEW)

**Motivation:** Different from `SubqueryCondition`. This is for correlated subqueries that produce rows, not boolean predicates. Required for "top N per group" patterns: "For each department, return the 3 highest-paid employees." Cannot be expressed with aggregation + post-filtering.

**Type definition:**

```typescript
interface SubqueryStep {
  type: 'subquery'
  /** Aliases imported from the outer scope */
  correlatedAliases: string[]
  /** 
   * The inner query pipeline. 
   * Should end with a ReturnStep defining what the subquery produces.
   * Can contain any steps including limit, orderBy, pattern, traversal, etc.
   */
  steps: ASTNode[]
  /** Aliases exported back to the outer scope */
  exportedAliases: string[]
}
```

**Note on naming collision:** Both `SubqueryCondition` (a where condition) and `SubqueryStep` (a pipeline step) use `type: 'subquery'`. This is fine because they exist in different discriminated union hierarchies: `WhereCondition` vs `ASTNode`. If this causes confusion in practice, rename the step to `type: 'call'` or `type: 'correlated'`.

---

### 4. `ReturnStep` (NEW — replaces `Projection` as side field)

**Motivation:** Projection must become a pipeline step (not a side field on the builder) because `SubqueryStep` contains `steps: ASTNode[]`. A subquery needs its own projection. If projection is a side field, every nested structure (SubqueryStep, SubqueryCondition, BranchStep) would need its own parallel projection field, and every compiler pass would have to look in two places.

**Type definition:**

```typescript
interface ReturnStep {
  type: 'return'
  /** What to return */
  returns: ProjectionReturn[]
  /** Return only existence check (wraps entire query) */
  existsOnly?: boolean
  /** Return only count (wraps entire query) */
  countOnly?: boolean
}

type ProjectionReturn =
  | { kind: 'alias'; alias: string; fields?: string[] }
  | { kind: 'expression'; expression: ProjectionExpression; resultAlias: string }
  | { kind: 'collect'; sourceAlias: string; distinct?: boolean; resultAlias: string }
  | { kind: 'path'; pathAlias: string }
```

**Migration:** The existing `Projection` type and `_projection` field on `QueryAST` should be replaced. All methods that currently modify `_projection` (`setProjection`, `setMultiNodeProjection`, `setCountProjection`, `setExistsProjection`, `setProjectionType`, `setFieldSelection`, `setIncludeDepth`) should instead append or modify a `ReturnStep` at the end of the step list.

**Fields to drop from the old Projection:**
- `raw` — escape hatch indicating the abstraction is leaking. If needed, add a proper raw expression type.
- `includeDepth` — this is a field selection on hierarchy/reachable results, not a projection concern. The depth alias produced by those steps can be selected like any other alias.
- `aggregate` — already represented by `AggregateStep`. Was duplicated in projection.

---

### 5. `ProjectionExpression` (NEW)

**Motivation:** No ability to return computed values. Can't express `node.price * node.quantity` or `coalesce(name, 'Unknown')`. This is a serious gap for real-world queries.

**Type definition:**

```typescript
type ProjectionExpression =
  | { type: 'field'; alias: string; field: string }
  | { type: 'literal'; value: unknown }
  | { 
      type: 'computed'
      operator: 'add' | 'subtract' | 'multiply' | 'divide' 
        | 'coalesce' | 'toString' | 'toInteger' | 'toFloat'
        | 'size' | 'trim' | 'toLower' | 'toUpper'
        | 'substring' | 'concat'
      operands: ProjectionExpression[]
    }
  | {
      type: 'case'
      /** Array of [condition, result] pairs */
      branches: Array<{ when: WhereCondition; then: ProjectionExpression }>
      else?: ProjectionExpression
    }
```

This is recursive: a computed expression's operands are themselves expressions. This allows arbitrary nesting: `price * (1 - discountRate)`.

---

### 6. `UnwindStep` (NEW)

**Motivation:** Array properties are common in graph databases. Without unwind, you can't query into them or expand them into rows.

**Type definition:**

```typescript
interface UnwindStep {
  type: 'unwind'
  /** The alias of the node containing the array property */
  sourceAlias: string
  /** The property name containing the array */
  field: string
  /** Alias for each unwound element (available in subsequent steps) */
  itemAlias: string
}
```

---

### 7. `ConditionValue` (NEW)

**Motivation:** Enables query plan caching (same AST structure, different parameter bindings) and prevents injection if the system ever accepts user-supplied filter values.

**Type definition:**

```typescript
type ConditionValue =
  | { kind: 'literal'; value: unknown }
  | { kind: 'param'; name: string }
```

**Migration:** Replace all `value?: unknown` fields in `ComparisonCondition` and `EdgeWhereCondition` with `value?: ConditionValue`. The builder methods that accept raw values should wrap them in `{ kind: 'literal', value }` automatically.

---

### 8. Add `'except'` to `BranchStep.operator`

**Current:** `operator: 'union' | 'intersect'`

**New:** `operator: 'union' | 'intersect' | 'except'`

Set difference is a standard set operation. Without it, you cannot express "all nodes in set A that are not in set B" without double-negation workarounds.

---

### 9. Remove `FirstStep`

Identical semantics to `LimitStep`. Remove the type definition, remove from the `ASTNode` union, remove from the visitor. Any builder method that emits `FirstStep` should emit `LimitStep` instead.

---

### 10. Remove `CursorStep`

Cursor-based pagination is an encoding concern, not a query primitive. Desugar at the API/builder layer into `WhereStep` (on the ordering fields) + `OrderByStep` + `LimitStep` before the AST is constructed. Remove the type definition, remove from `ASTNode`, remove from the visitor.

---

### 11. Remove `ExistsCondition`

Subsumed by `SubqueryCondition` with `mode: 'exists' | 'notExists'`. Remove from the `WhereCondition` union. Builder convenience methods can still exist but emit `SubqueryCondition`.

---

### 12. Remove `ConnectedToCondition`

Subsumed by `SubqueryCondition`. A connected-to check is a single-hop traversal subquery with an ID filter. Remove from the `WhereCondition` union.

---

## Updated Type Unions

After all changes, the discriminated unions become:

```typescript
// ASTNode union
export type ASTNode =
  | MatchStep
  | MatchByIdStep
  | PatternStep        // NEW
  | TraversalStep
  | WhereStep
  | AliasStep
  | BranchStep         // updated: operator includes 'except'
  | PathStep
  | AggregateStep
  | OrderByStep
  | LimitStep
  | SkipStep
  | DistinctStep
  | HierarchyStep
  | ReachableStep
  | ForkStep
  | SubqueryStep       // NEW
  | UnwindStep         // NEW
  | ReturnStep         // NEW
  // Removed: FirstStep, CursorStep

// WhereCondition union
export type WhereCondition =
  | ComparisonCondition  // updated: value uses ConditionValue
  | LogicalCondition
  | LabelCondition
  | SubqueryCondition    // NEW (replaces ExistsCondition + ConnectedToCondition)
```

---

## Visitor Updates (`visitor.ts`)

The visitor currently is missing `visitMatchById` and `visitFork` handlers. After changes:

**Add:**
- `visitPattern?(node: PatternStep, context: TContext): TResult`
- `visitMatchById?(node: MatchByIdStep, context: TContext): TResult`
- `visitSubquery?(node: SubqueryStep, context: TContext): TResult`
- `visitUnwind?(node: UnwindStep, context: TContext): TResult`
- `visitReturn?(node: ReturnStep, context: TContext): TResult`
- `visitFork?(node: ForkStep, context: TContext): TResult`

**Remove:**
- `visitFirst`
- `visitCursor`

**Update the `visit()` switch statement** to handle all new types and remove removed types.

---

## Builder Updates (`builder.ts`)

### New methods to add:

- `addPattern(config: { nodes: PatternNode[], edges: PatternEdge[] }): QueryAST`
  - Registers all node/edge aliases
  - Sets `currentNodeAlias` to the last node in the pattern (or requires explicit selection)
  
- `addSubquery(config: { correlatedAliases: string[], steps: ASTNode[], exportedAliases: string[] }): QueryAST`

- `addUnwind(config: { sourceAlias: string, field: string, itemAlias: string }): QueryAST`

- `addReturn(config: { returns: ProjectionReturn[], countOnly?: boolean, existsOnly?: boolean }): QueryAST`

### Methods to update:

- All `setProjection*` methods: should now append/modify a `ReturnStep` in the steps array instead of modifying the `_projection` field. Consider deprecating the old methods and adding new `addReturn`-based equivalents.

- `addWhere`: when constructing `SubqueryCondition` nodes, the builder should provide convenience wrappers:
  - `addWhereExists(subqueryBuilder: (ast: QueryAST) => QueryAST): QueryAST`
  - `addWhereNotExists(subqueryBuilder: (ast: QueryAST) => QueryAST): QueryAST`

### Fields to phase out:

- `_projection`: once `ReturnStep` is fully adopted, this field becomes redundant. During migration, both can coexist — the compiler checks for a `ReturnStep` first, falls back to `_projection`.

### Methods to remove:

- Any method that emits `FirstStep` (replace with `addLimit`)
- Any method that emits `CursorStep` (desugar at API layer)

---

## Migration Strategy

This can be done incrementally:

**Phase 1 — Additive changes (no breaking changes):**
1. Add all new type definitions (`PatternStep`, `SubqueryCondition`, `SubqueryStep`, `ReturnStep`, `ProjectionExpression`, `UnwindStep`, `ConditionValue`)
2. Add `'except'` to `BranchStep.operator`
3. Add new builder methods (`addPattern`, `addSubquery`, `addUnwind`, `addReturn`)
4. Update the visitor with new handler methods
5. Update the `ASTNode` and `WhereCondition` unions to include new types

**Phase 2 — Removals:**
1. Remove `FirstStep` (replace usages with `LimitStep`)
2. Remove `CursorStep` (move desugaring to API layer)
3. Remove `ExistsCondition` (migrate usages to `SubqueryCondition`)
4. Remove `ConnectedToCondition` (migrate usages to `SubqueryCondition`)
5. Remove visitor methods for removed types

**Phase 3 — Projection migration:**
1. Migrate all projection logic to use `ReturnStep`
2. Update compiler(s) to read `ReturnStep` from the step list
3. Deprecate `_projection` field and `setProjection*` methods
4. Clean up old `Projection` type (remove `raw`, `includeDepth`, duplicated `aggregate`)

---

## What We Explicitly Chose NOT To Do (And Why)

- **Separate AST from builder:** Simpler mental model to keep them together for now. Revisit if multiple compiler backends are added.
- **Fold MatchStep/MatchByIdStep into PatternStep:** They carry optimization-relevant intent (direct index lookup) and the compiler would have to pattern-match degenerate single-node patterns to recover this. Not worth the churn.
- **Fold HierarchyStep into variable-length traversal:** Tells the compiler "this is a tree walk on a known hierarchy edge," enabling specialized recursive CTE generation. Worth keeping.
- **Fold ReachableStep into TraversalStep:** Transitive closure has different result set semantics and compilation strategy. Worth keeping.
- **Remove AliasStep:** Slightly inelegant as a separate step but harmless. Folding it into source steps would touch many code paths for minimal gain.
- **Only-primitives AST:** Would destroy semantic information the compiler needs. Extended types that carry optimization-relevant intent earn their place.
- **Regular path queries (edge-sequence patterns):** Identified as a real expressiveness gap but out of scope for this change. Flag for future work.
- **WITH / intermediate materialization step:** Identified as potentially needed when aggregation mid-pipeline changes the binding context. Out of scope; revisit when pipeline-aggregate-then-traverse patterns are needed.