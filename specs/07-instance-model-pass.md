# InstanceModelPass — Type-Instance Lowering

> AST-to-AST transformation that rewrites label-based node matching
> into a meta-model with class nodes, interface nodes, and `instanceOf` joins.
>
> Sits in the `CompilationPipeline` before `ReifyEdgesPass`.
> The CypherCompiler is untouched.

---

## 1. Physical Meta-Model

```
                    hasParent(N:1)
                  ┌──────────────┐
                  ↓              │
              ┌───────┐     hasLink(1:N)     ┌───────┐
              │ :node │ ──────────────────→  │ :link │
              └───────┘     linksTo(1:1)     └───────┘
                  │       ←──────────────────    │
                  │                              │
           instanceOf(N:1)                instanceOf(N:1)
                  │                              │
                  ↓                              ↓
          ┌──────────────┐              ┌─────────────────┐
          │ :node:class  │ ──────────→  │ :node:interface │
          └──────────────┘ implements   └─────────────────┘
                  │          (N:N)           │        ↑
           instanceOf                       │  extends(N:N)
            (N:1, self)                     └────────┘
                                            (acyclic)
```

**Entities:**

| Label | Role | Example |
|-------|------|---------|
| `:node` | Instance node (the data) | A specific user, a specific post |
| `:node:class` | Type definition node | "User", "Post" — one per schema type |
| `:node:interface` | Abstract type definition | "Timestamped", "Printable" — one per interface |
| `:link` | Reified edge (see spec 06) | An order_item instance |

**Structural edges (never reified, always physical):**

| Edge | From | To | Cardinality | Constraints |
|------|------|----|-------------|-------------|
| `instanceOf` | `:node` | `:node:class` | N:1 | — |
| `instanceOf` | `:link` | `:node:interface` | N:1 | — |
| `instanceOf` | `:node:class` | `:node:class` | N:1 (self) | — |
| `implements` | `:node:class` | `:node:interface` | N:N | — |
| `extends` | `:node:interface` | `:node:interface` | N:N | acyclic |
| `hasParent` | `:node` | `:node` | N:1 | acyclic, no-self |
| `hasLink` | `:node` | `:link` | 1:N | — |
| `linksTo` | `:link` | `:node` | 1:1 | — |

---

## 2. Schema Configuration

Add an `instanceModel` config on `SchemaShape`:

```typescript
export interface SchemaShape {
  // ...existing fields...
  readonly instanceModel?: InstanceModelConfig
}

export interface InstanceModelConfig {
  /** Whether to use the instance model */
  readonly enabled: boolean
  /**
   * Refs mapping: type name → node ID for class and interface nodes.
   * Always available — populated at bootstrap or from codegen.
   * All lookups are by ID, never by name.
   */
  readonly refs: Readonly<Record<string, string>>
  /**
   * Pre-resolved implementor map: interface name → class node IDs
   * that implement it (transitively through extends).
   * Avoids runtime joins through implements/extends.
   */
  readonly implementors: Readonly<Record<string, readonly string[]>>
}
```

The `refs` map is the canonical lookup. Every class/interface node has an `id` — we always match on `id`, never on `name`. The `refs` and `implementors` maps are populated at `createGraph()` time via bootstrap queries, or statically from codegen output.

---

## 3. Node Kind Resolution

The pass needs to know whether a schema type is a **class** (concrete) or an **interface** (abstract).

```typescript
function nodeKind(schema: SchemaShape, typeName: string): 'class' | 'interface' {
  const def = schema.nodes[typeName]
  if (!def) throw new Error(`Unknown type: ${typeName}`)
  return def.abstract ? 'interface' : 'class'
}
```

This drives which rewrite rule to apply:

| Kind | Match rewrite |
|------|---------------|
| `class` (concrete) | `instanceOf` → class node |
| `interface` (abstract) | `instanceOf` → class → `implements` → interface |

---

## 4. AST Transformation Rules

### 4.1 MatchStep — Concrete Class

User writes `graph.node('user')`.

**Input:**
```
MatchStep { label: 'user', alias: 'n0' }
```

**Output:** The pass looks up `refs['user']` to get the class node ID.

```
MatchStep { label: 'node', alias: 'n0' }
TraversalStep {
  edges: ['instanceOf'], direction: 'out',
  fromAlias: 'n0', toAlias: 'cls0',
  toLabels: ['node', 'class'],
  optional: false, cardinality: 'one',
}
WhereStep {
  conditions: [{ type: 'comparison', target: 'cls0',
                  field: 'id', operator: 'eq', value: refs['user'] }]
}
```

Compiles to:
```cypher
MATCH (n0:node)-[:instanceOf]->(cls0:node:class {id: $p0})
```

Always by ID — direct index hit, no name lookup.

### 4.2 MatchStep — Interface (Polymorphic)

User writes `graph.node('timestamped')` where `timestamped` is abstract.

This means: "find all nodes whose class implements Timestamped."

The pass looks up `implementors['timestamped']` which returns the class node IDs of all concrete types that (transitively) implement it.

```
MatchStep { label: 'node', alias: 'n0' }
TraversalStep {
  edges: ['instanceOf'], direction: 'out',
  fromAlias: 'n0', toAlias: 'cls0',
  toLabels: ['node', 'class'],
  cardinality: 'one',
}
WhereStep {
  conditions: [{ type: 'comparison', target: 'cls0',
                  field: 'id', operator: 'in',
                  value: implementors['timestamped'] }]
}
```

Compiles to:
```cypher
MATCH (n0:node)-[:instanceOf]->(cls0:node:class)
WHERE cls0.id IN $p0  -- [class IDs for User, Post, Comment]
```

Single `instanceOf` hop + `IN` on IDs. No `implements` or `extends` joins at query time — the transitive closure is pre-computed in the `implementors` map at bootstrap.

### 4.3 MatchByIdStep — No Change

ID is globally unique on `:node`. The pass only relabels:

**Input:** `MatchByIdStep { id: '...', alias: 'n0' }`

**Output:** Same step, but the compiler should emit `:node` label:
```cypher
MATCH (n0:node {id: $p0})
```

No `instanceOf` join needed — we already have the specific node.

### 4.4 TraversalStep — Target Labels

When a traversal specifies `toLabels`, the same rewrite applies to the target node.

**Input:**
```
TraversalStep {
  edges: ['authored'], direction: 'out',
  fromAlias: 'n0', toAlias: 'n1',
  toLabels: ['post'],
  ...
}
```

**Output:** Same rules as §4.1 — look up `refs['post']` for the class node ID.

```
TraversalStep {
  edges: ['authored'], direction: 'out',
  fromAlias: 'n0', toAlias: 'n1',
  toLabels: ['node'],       // ← relabeled
  ...
}
TraversalStep {
  edges: ['instanceOf'], direction: 'out',
  fromAlias: 'n1', toAlias: 'cls1',
  toLabels: ['node', 'class'],
  cardinality: 'one',
}
WhereStep {
  conditions: [{ type: 'comparison', target: 'cls1',
                  field: 'id', operator: 'eq', value: refs['post'] }]
}
```

If the target is an interface, the same polymorphic expansion from §4.2 applies (ID `IN` check on `implementors`).

### 4.5 LabelCondition

Currently: `WHERE n0:Admin` checks for a label on the node.

In the meta-model, there are no type labels on instance nodes. The condition must check the class/interface chain.

**Concrete class check:**
```
// Before
LabelCondition { labels: ['Admin'], mode: 'all', target: 'n0' }

// After — check instanceOf points to the Admin class by ID
ExistsCondition or equivalent:
  EXISTS (n0)-[:instanceOf]->({id: refs['admin']})
```

**Interface check:**
```
// Before
LabelCondition { labels: ['Printable'], mode: 'all', target: 'n0' }

// After — class ID must be in the implementors set
ComparisonCondition on the class node:
  cls_n0.id IN implementors['printable']
```

**Multiple labels with AND (all mode):**

Since each node has exactly one class, `mode: 'all'` with multiple labels only makes sense when mixing a class with interfaces. Pre-resolve at pass time: check the intersection of implementor sets and emit a single `id IN [...]` check. If the intersection is empty, the query can short-circuit.

```
// n0 must be 'Agent' AND implement 'Printable'
// Pre-resolved: Agent ∈ implementors['printable']? If yes → cls_n0.id = refs['agent']
// If no → impossible, short-circuit to empty result
```

**Multiple labels with OR (any mode):**

```
// n0 is either Admin or Moderator
→ cls_n0.id IN [refs['admin'], refs['moderator']]
```

---

## 5. The `implements` Relationship

In the current system, `implements` is expressed through `SchemaNodeDef.implements` and resolved at compile time via `resolveNodeLabels()` which stacks labels:

```typescript
// Current: agent implements [module, identity]
// resolveNodeLabels(schema, 'agent') → ['Agent', 'Module', 'Identity']
// Compiled: MATCH (n0:Agent:Module:Identity)
```

In the meta-model, this becomes physical `implements` edges:

```
(Agent:node:class)-[:implements]->(Module:node:interface)
(Agent:node:class)-[:implements]->(Identity:node:interface)
```

The pass consults `schema.nodes[type].abstract` to determine if a type name refers to an interface. When querying by interface name, the pass looks up `implementors[name]` to get the class node IDs and emits a single `instanceOf` hop + `id IN [...]`.

**Key difference:** Currently, `resolveNodeLabels` is called by the CypherCompiler to build `:Label:Label` syntax. With InstanceModelPass, the compiler no longer needs `resolveNodeLabels` — all type resolution is handled by the pass via `instanceOf` joins to class nodes by ID. The compiler just sees `:node` and `:node:class` labels.

---

## 6. The `extends` Relationship (Interface Inheritance)

Interfaces can extend other interfaces, forming an acyclic directed graph:

```
(Printable:node:interface)-[:extends]->(Displayable:node:interface)
(Displayable:node:interface)-[:extends]->(Renderable:node:interface)
```

This means querying by `Renderable` should also return nodes whose class implements `Displayable` or `Printable` (transitively).

### 6.1 Resolution Strategy

The `extends` transitive closure is always pre-computed at bootstrap. The `implementors` map already accounts for `extends` — it maps each interface name to the **class node IDs** of all concrete types that satisfy it (directly or through transitive `extends`).

```typescript
// implementors map (computed at bootstrap, stored in InstanceModelConfig):
implementors: {
  'renderable':  ['id-widget', 'id-document', 'id-canvas'],
  'displayable': ['id-widget', 'id-document', 'id-canvas'],
  'printable':   ['id-widget', 'id-document'],
}
```

At query time, any polymorphic query is a single `instanceOf` hop + `id IN [...]`:

```cypher
MATCH (n0:node)-[:instanceOf]->(cls0:node:class)
WHERE cls0.id IN $p0  -- pre-resolved class IDs
```

No `implements` or `extends` joins at query time. The graph of interfaces is walked once at startup.

### 6.2 Bootstrap Queries

Run at `createGraph()` to populate `refs` and `implementors`:

```cypher
// 1. Collect refs: all class and interface nodes → name:id mapping
MATCH (c:node:class) RETURN c.name AS name, c.id AS id
UNION ALL
MATCH (i:node:interface) RETURN i.name AS name, i.id AS id

// 2. Compute implementors (transitive through extends) → interface name : class IDs
MATCH (c:node:class)-[:implements]->(i:node:interface)-[:extends*0..]->(root:node:interface)
RETURN root.name AS interface, collect(DISTINCT c.id) AS classIds
```

Two queries at startup. Results cached for the lifetime of the graph instance.

---

## 7. Interaction with Other Passes

### Pipeline Order

```
QueryAST (user intent: labels + typed edges)
  → InstanceModelPass    ← labels → instanceOf joins
  → ReifyEdgesPass       ← typed edges → link node patterns
  → MergeWhereClausesPass
  → PushDownFiltersPass
  → ...
  → CypherCompiler
```

`InstanceModelPass` runs **first** because:
1. It rewrites `MatchStep` labels — `ReifyEdgesPass` doesn't touch these
2. It rewrites `TraversalStep.toLabels` — must happen before edge reification replaces traversals
3. After this pass, all nodes are `:node` and all type info is structural edges

### What doesn't change

The CypherCompiler has zero changes. It sees standard AST steps with `:node`, `:node:class`, `:node:interface` labels and `instanceOf`, `implements`, `extends` edges — all compiled as normal MATCH patterns.

The `resolveNodeLabels()` helper is no longer called by the compiler when `instanceModel` is enabled. The pass handles it.

### Structural edges are exempt from ReifyEdgesPass

`instanceOf`, `implements`, `extends`, `hasParent` are **structural edges** — they should not be reified. The schema should mark them as `reified: false` (or they should be excluded by convention since they don't appear in `schema.edges`).

---

## 8. Steps Affected

| Step Type | Rewrite | Notes |
|-----------|---------|-------|
| `MatchStep` | Label → `:node` + `instanceOf` join | Concrete or polymorphic |
| `MatchByIdStep` | Label → `:node` only | No join needed |
| `TraversalStep` | `toLabels` → `:node` + `instanceOf` join on target | Same as MatchStep |
| `WhereStep` (LabelCondition) | Label check → `instanceOf` pattern or `IN` check | Pre-resolved preferred |
| `WhereStep` (ExistsCondition) | If edge target has a label, add `instanceOf` | Rare |
| `HierarchyStep` | `targetLabel` → `:node` | Label on target node |
| `BranchStep` / `ForkStep` | Recurse into sub-ASTs | Same rules apply |
| `AliasStep` | Pass-through | — |
| `OrderByStep` | Pass-through | — |
| `LimitStep` / `SkipStep` | Pass-through | — |
| `PathStep` | Target labels → `:node` | — |

---

## 9. Algorithm (pseudo-code)

```typescript
class InstanceModelPass implements CompilationPass {
  name = 'InstanceModel'

  private config: InstanceModelConfig
  private clsCounter = 0

  transform(ast: QueryAST, schema: SchemaDefinition): QueryAST {
    if (!this.isEnabled(schema)) return ast

    const newSteps: ASTNode[] = []

    for (const step of ast.steps) {
      switch (step.type) {
        case 'match':
          newSteps.push(...this.expandMatch(step, schema))
          break

        case 'matchById':
          // Just relabel to :node, no join
          newSteps.push({ ...step })  // compiler emits :node
          break

        case 'traversal':
          newSteps.push(...this.expandTraversalTarget(step, schema))
          break

        case 'where':
          newSteps.push(this.rewriteWhereConditions(step, schema))
          break

        case 'branch':
        case 'fork':
          newSteps.push(this.recurseIntoBranches(step, schema))
          break

        default:
          newSteps.push(step)
      }
    }

    return this.rebuildAST(ast, newSteps)
  }

  private expandMatch(step: MatchStep, schema: SchemaDefinition): ASTNode[] {
    const kind = this.nodeKind(schema, step.label)
    const clsAlias = this.nextClassAlias()

    const result: ASTNode[] = [
      // Relabel to :node
      { ...step, label: 'node' },
      // instanceOf join
      this.instanceOfTraversal(step.alias, clsAlias),
    ]

    if (kind === 'class') {
      // Direct class match by ID
      result.push(this.classIdCondition(clsAlias, this.config.refs[step.label]))
    } else {
      // Interface — polymorphic, match any implementing class by ID
      result.push(this.polymorphicCondition(clsAlias, step.label))
    }

    return result
  }

  private expandTraversalTarget(step: TraversalStep, schema: SchemaDefinition): ASTNode[] {
    if (step.toLabels.length === 0) return [step]

    const targetType = step.toLabels[0]
    const clsAlias = this.nextClassAlias()
    const kind = this.nodeKind(schema, targetType)

    const result: ASTNode[] = [
      // Relabel target to :node
      { ...step, toLabels: ['node'] },
      // instanceOf join on target
      this.instanceOfTraversal(step.toAlias, clsAlias),
    ]

    if (kind === 'class') {
      result.push(this.classIdCondition(clsAlias, this.config.refs[targetType]))
    } else {
      result.push(this.polymorphicCondition(clsAlias, targetType))
    }

    return result
  }

  /** Match a single class node by ID */
  private classIdCondition(clsAlias: string, classId: string): WhereStep {
    return {
      type: 'where',
      conditions: [{
        type: 'comparison', target: clsAlias,
        field: 'id', operator: 'eq', value: classId,
      }],
    }
  }

  /** Match any class that implements an interface (by pre-resolved class IDs) */
  private polymorphicCondition(clsAlias: string, interfaceName: string): WhereStep {
    const classIds = this.config.implementors[interfaceName]
    if (!classIds?.length) {
      throw new Error(`No implementors found for interface '${interfaceName}'`)
    }
    return {
      type: 'where',
      conditions: [{
        type: 'comparison', target: clsAlias,
        field: 'id', operator: 'in', value: classIds,
      }],
    }
  }
}
```

---

## 10. Performance Considerations

Every typed node match is exactly **one extra hop** (`instanceOf`) + an `id` check on the class node. With an index on `id`, this is a direct index hit.

Polymorphic queries have the same cost — the `implements`/`extends` transitive closure is pre-computed in the `implementors` map, so queries become `id IN [...]` on the same single hop.

No runtime `implements` or `extends` traversals ever occur in queries.

### Recommended indexes

```cypher
CREATE INDEX FOR (n:node) ON (n.id)
CREATE INDEX FOR (c:class) ON (c.id)
CREATE INDEX FOR (i:interface) ON (i.id)
```

---

## 11. Summary

| Aspect | Approach |
|--------|----------|
| **Where** | `CompilationPass`, runs before `ReifyEdgesPass` |
| **Trigger** | `SchemaShape.instanceModel` enabled |
| **Concrete type match** | `MatchStep` → `:node` + `instanceOf` → class node by `id` |
| **Polymorphic match** | `instanceOf` → class `id IN` pre-resolved implementor IDs |
| **Interface inheritance** | `extends` transitive closure computed at bootstrap, stored in `implementors` |
| **MatchByIdStep** | Relabel to `:node`, no join (ID is unique) |
| **TraversalStep targets** | Same rewrite on `toLabels` |
| **LabelCondition** | Converted to `instanceOf` + `id` check or `id IN [...]` |
| **Refs** | `refs` (name→id) and `implementors` (interface→class IDs) populated at bootstrap |
| **Structural edges** | `instanceOf`, `implements`, `extends` are exempt from `ReifyEdgesPass` |
| **Compiler changes** | None |
| **Performance** | +1 hop per typed match (with index, negligible) |
