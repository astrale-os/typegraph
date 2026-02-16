# ReifyEdgesPass — Edge Reification Lowering

> AST-to-AST transformation that rewrites typed edge traversals into
> link-node patterns: `(A)-[:hasLink]->(link:E)-[:linksTo]->(B)`.
>
> Sits in the `CompilationPipeline` between the builder and the compiler.
> The CypherCompiler is untouched.

---

## 1. Physical Graph Model

A schema edge like `order_item` connecting `Order` → `Product` is stored as:

```
(Order)-[:hasLink]->(link:OrderItem)-[:linksTo]->(Product)
```

- **Link node label** = PascalCase of edge type (e.g., `order_item` → `OrderItem`)
- **`hasLink`** = source → link (always outgoing from source)
- **`linksTo`** = link → target (always outgoing from link)
- **Edge properties** (attributes) become **link node properties**

This is transparent to the query API — the user writes `graph.node('order').to('order_item', 'product')` and the pass rewrites the AST before compilation.

---

## 2. Schema Configuration

Two flags, composable: a global default on `SchemaShape` and a per-edge override on `SchemaEdgeDef`.

```typescript
export interface SchemaShape {
  // ...existing fields...
  readonly reifyEdges?: boolean  // global default (false if omitted)
}

export interface SchemaEdgeDef {
  readonly endpoints: Readonly<Record<string, SchemaEndpointDef>>
  readonly constraints?: Readonly<Partial<SchemaConstraints>>
  readonly attributes?: readonly string[]
  readonly reified?: boolean  // per-edge override (inherits global if omitted)
}
```

Resolution: per-edge wins, then global, then `false`.

```typescript
function isReified(edgeType: string, schema: SchemaShape): boolean {
  const edgeDef = schema.edges[edgeType]
  if (edgeDef?.reified !== undefined) return edgeDef.reified
  return schema.reifyEdges ?? false
}
```

| Strategy | `reifyEdges` | Per-edge `reified` | Effect |
|----------|-------------|-------------------|--------|
| Opt-in specific | omitted / `false` | `true` on chosen edges | Only those edges are reified |
| All reified, opt-out specific | `true` | `false` on chosen edges | Everything reified except those |
| All reified | `true` | omitted | Every edge is reified |

---

## 3. AST Transformation Rules

### 3.1 TraversalStep (single hop, direction: out)

**Input:**
```
TraversalStep {
  edges: ['order_item'], direction: 'out',
  fromAlias: 'n0',  toAlias: 'n1',  toLabels: ['product'],
  edgeAlias: 'e1',  edgeUserAlias: 'oi',
  optional: false,  cardinality: 'many',
  edgeWhere: [{ field: 'quantity', operator: 'gt', value: 5 }]
}
```

**Output (2 steps + optional where):**
```
TraversalStep {
  edges: ['hasLink'], direction: 'out',
  fromAlias: 'n0',  toAlias: 'link0',  toLabels: ['OrderItem'],
  edgeAlias: undefined,  optional: false,  cardinality: 'many',
}
WhereStep {
  conditions: [{ type: 'comparison', target: 'link0',
                  field: 'quantity', operator: 'gt', value: 5 }]
}
TraversalStep {
  edges: ['linksTo'], direction: 'out',
  fromAlias: 'link0',  toAlias: 'n1',  toLabels: ['product'],
  edgeAlias: undefined,  optional: false,  cardinality: 'one',
}
```

Key transforms:
- `edgeWhere` → `WhereStep` on link node
- `edgeAlias` → link node alias (`link0`)
- `edgeUserAlias` → becomes a regular `AliasStep` for the link node
- Second traversal cardinality is `'one'` (each link points to exactly one target)

### 3.2 TraversalStep (direction: in)

Incoming traversal: user queries "what points TO me via this edge?"

**Input:** `(n0)<-[:order_item]-(n1)` (direction: `'in'`)

**Output:**
```
(n0)<-[:linksTo]-(link0:OrderItem)<-[:hasLink]-(n1)
```

```
TraversalStep { edges: ['linksTo'], direction: 'in',
                fromAlias: 'n0', toAlias: 'link0', toLabels: ['OrderItem'] }
TraversalStep { edges: ['hasLink'], direction: 'in',
                fromAlias: 'link0', toAlias: 'n1', toLabels: [...source labels...] }
```

The two hops are **reversed** (linksTo first, then hasLink) because we're traversing backwards.

### 3.3 TraversalStep (direction: both)

**Input:** `(n0)-[:order_item]-(n1)` (direction: `'both'`)

**Output:** Two branches via UNION or an undirected two-hop pattern.

Simplest approach: reject with a clear error. Bidirectional traversals on reified edges are rare and semantically ambiguous. If needed, the user can compose two explicit directional queries.

### 3.4 Optional Traversals

The `optional` flag propagates to **both** generated traversal steps. If the original was `OPTIONAL MATCH`, both hops become optional.

### 3.5 Multi-Edge Traversals (`edges: ['a', 'b']`)

When `edges` has multiple types (from `toAny`/`viaAny`), each reified edge type gets its own link node label. The pass expands to:

```
OPTIONAL MATCH (n0)-[:hasLink]->(link0:A)-[:linksTo]->(n1)
OPTIONAL MATCH (n0)-[:hasLink]->(link1:B)-[:linksTo]->(n1_b)
```

Or, if all listed edges share the same reification pattern, use label union on the link node:

```
(n0)-[:hasLink]->(link0:A|B)-[:linksTo]->(n1)
```

This requires care — only safe when all edges in the array are reified with the same endpoint structure.

---

## 4. Condition Rewrites

### 4.1 ExistsCondition

```
// Before: EXISTS (n0)-[:order_item]->()
ExistsCondition { edge: 'order_item', direction: 'out', target: 'n0' }

// After:  EXISTS (n0)-[:hasLink]->(:OrderItem)
ExistsCondition { edge: 'hasLink', direction: 'out', target: 'n0' }
// + label filter on the anonymous node (or convert to a pattern with label)
```

Since `ExistsCondition` doesn't have a target label field, this may need to be compiled as a `WhereCondition` with a pattern instead. Alternative: extend `ExistsCondition` to carry a target label.

### 4.2 ConnectedToCondition

```
// Before: MATCH (n0)-[:order_item]->({id: $p0})
ConnectedToCondition { edge: 'order_item', direction: 'out', target: 'n0', nodeId: '...' }

// After:  MATCH (n0)-[:hasLink]->(:OrderItem)-[:linksTo]->({id: $p0})
```

This becomes a two-hop pattern. Since `ConnectedToCondition` compiles to a MATCH pattern in the compiler, the rewrite produces two MATCH patterns (or one chained pattern).

Best approach: convert the `ConnectedToCondition` into two `TraversalStep`s + a `WhereStep` with id comparison. This keeps the transformation entirely at AST level.

---

## 5. Edge Alias Handling

When the user captures an edge alias via `toWithEdge('oi')`:

| Original | Reified |
|----------|---------|
| `edgeAlias: 'e1'` | `link0` (link node alias) |
| `edgeUserAlias: 'oi'` | `AliasStep { internalAlias: 'link0', userAlias: 'oi' }` |
| `e1.quantity` in WHERE | `link0.quantity` in WHERE |
| `oi` in RETURN | Returns link node properties |

The edge user alias transparently becomes a node alias on the link node. Edge properties are now node properties — the compiler doesn't need to know the difference.

---

## 6. Projection Adjustments

The pass must ensure link nodes don't leak into results unless explicitly aliased.

- **`edgeAliases`** in projection → rewritten to **`nodeAliases`** for the link node
- If the user didn't alias the edge, the link node stays internal (not returned)
- `edgeCollection` projection type → `collection` (link nodes are nodes now)

---

## 7. Variable-Length Paths

This is the one case where a pure AST rewrite isn't sufficient.

| Pattern | Difficulty | Approach |
|---------|-----------|----------|
| Fixed-hop `*1` | Trivial | Already covered (§3.1) |
| Variable-length `*min..max` | Hard | See below |
| Hierarchy (`ancestors`, `descendants`) | Hard | Same as variable-length |
| Reachable (`*min..max`) | Hard | Same as variable-length |

**Problem:** `(a)-[:order_item*2..5]->(b)` means 2–5 logical hops. Each logical hop = 2 physical hops. Naively doubling to `[:hasLink|linksTo*4..10]` allows invalid sequences (`hasLink→hasLink`).

### Options

**A. Quantified Path Patterns (Neo4j 5+ / GQL)**

```cypher
MATCH (a)(()-[:hasLink]->(:OrderItem)-[:linksTo]->()){2,5}(b)
```

Clean, correct, but requires Neo4j 5+. The pass would annotate the step and the compiler emits QPP syntax.

**B. Reject with clear error**

```
Error: Variable-length traversal on reified edge 'order_item' is not supported.
Use fixed-hop traversals or compose explicit paths.
```

Safe default. Most variable-length patterns are on hierarchy/reachability edges which may not be reified.

**C. Hybrid: flag on the step**

Add `reified: { linkLabel: 'OrderItem' }` metadata to `TraversalStep`/`HierarchyStep`. The AST pass tags it, the compiler handles the QPP emission. This keeps the compiler change minimal and scoped.

**Recommendation:** Start with **B** (reject). Add **A** or **C** when a concrete use case requires it.

---

## 8. Steps Not Affected

| Step Type | Affected? | Notes |
|-----------|-----------|-------|
| `MatchStep` | No | Matches nodes, not edges |
| `MatchByIdStep` | No | Same |
| `WhereStep` | Partially | Only if it contains `ExistsCondition` or `ConnectedToCondition` on a reified edge |
| `AliasStep` | No | Pass-through |
| `BranchStep` | Recurse | Transform branch sub-ASTs |
| `ForkStep` | Recurse | Transform fork branch sub-ASTs |
| `OrderByStep` | No | Operates on aliases (already rewritten) |
| `LimitStep` | No | |
| `SkipStep` | No | |
| `DistinctStep` | No | |
| `AggregateStep` | Partially | If aggregating on edge alias, rewrite to link alias |
| `PathStep` | Yes | Variable-length — reject or QPP |
| `HierarchyStep` | Yes | Variable-length — reject or QPP |
| `ReachableStep` | Yes | Variable-length — reject or QPP |

---

## 9. Algorithm (pseudo-code)

```typescript
class ReifyEdgesPass implements CompilationPass {
  name = 'ReifyEdges'

  transform(ast: QueryAST, schema: SchemaDefinition): QueryAST {
    const reifiedEdges = this.collectReifiedEdges(schema)
    if (reifiedEdges.size === 0) return ast  // no-op

    let result = ast
    const newSteps: ASTNode[] = []
    const linkAliasMap = new Map<string, string>() // edgeAlias -> linkAlias

    for (const step of ast.steps) {
      switch (step.type) {
        case 'traversal':
          if (this.isReified(step.edges, reifiedEdges)) {
            this.rejectIfVariableLength(step)
            const expanded = this.expandTraversal(step, reifiedEdges, result)
            newSteps.push(...expanded.steps)
            // Track alias mappings
            linkAliasMap.set(step.edgeAlias!, expanded.linkAlias)
            result = expanded.updatedAST
          } else {
            newSteps.push(step)
          }
          break

        case 'where':
          newSteps.push(this.rewriteWhereConditions(step, reifiedEdges, linkAliasMap))
          break

        case 'branch':
        case 'fork':
          newSteps.push(this.recurseIntoBranches(step, reifiedEdges, schema))
          break

        default:
          newSteps.push(step)
      }
    }

    // Rebuild AST with rewritten steps, aliases, and projection
    return this.rebuildAST(result, newSteps, linkAliasMap)
  }
}
```

### `expandTraversal` (direction: out)

```typescript
private expandTraversal(step: TraversalStep, ...): ExpandResult {
  const linkAlias = this.nextLinkAlias()  // 'link0', 'link1', ...
  const linkLabel = toPascalCase(step.edges[0])

  const hop1: TraversalStep = {
    type: 'traversal',
    edges: ['hasLink'], direction: 'out',
    fromAlias: step.fromAlias, toAlias: linkAlias,
    toLabels: [linkLabel],
    optional: step.optional, cardinality: step.cardinality,
  }

  const hop2: TraversalStep = {
    type: 'traversal',
    edges: ['linksTo'], direction: 'out',
    fromAlias: linkAlias, toAlias: step.toAlias,
    toLabels: step.toLabels,
    optional: step.optional, cardinality: 'one',
  }

  const steps: ASTNode[] = [hop1]

  // Convert edgeWhere to node WHERE on link
  if (step.edgeWhere?.length) {
    steps.push({
      type: 'where',
      conditions: step.edgeWhere.map(ew => ({
        type: 'comparison', target: linkAlias,
        field: ew.field, operator: ew.operator, value: ew.value,
      })),
    })
  }

  steps.push(hop2)

  return { steps, linkAlias, ... }
}
```

---

## 10. Pipeline Position

```
QueryBuilder
  → QueryAST (user intent)
  → CompilationPipeline
      1. ReifyEdgesPass        ← NEW (lowering)
      2. MergeWhereClausesPass (optimization)
      3. PushDownFiltersPass   (optimization)
      4. ...
  → CypherCompiler
  → Cypher string + params
```

`ReifyEdgesPass` runs **first** — it's a lowering pass, not an optimization. Subsequent optimization passes operate on the already-reified AST, which means filter pushdown and WHERE merging work correctly on the expanded pattern.

---

## 11. Summary

| Aspect | Approach |
|--------|----------|
| **Where** | `CompilationPass` in `CompilationPipeline`, before optimizations |
| **Trigger** | Per-edge `reified` overrides global `reifyEdges` (default `false`) |
| **Single-hop traversal** | 1 `TraversalStep` → 2 `TraversalStep`s + optional `WhereStep` |
| **Edge properties** | Become link node properties |
| **Edge aliases** | Become link node aliases |
| **Conditions** | `edgeWhere` → node WHERE; `ExistsCondition`/`ConnectedTo` → pattern rewrite |
| **Variable-length** | Reject initially; QPP for Neo4j 5+ later |
| **Compiler changes** | None |
| **Projection** | Edge aliases → node aliases on link; link nodes don't leak unless aliased |
