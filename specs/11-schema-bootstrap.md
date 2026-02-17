# SchemaBootstrap — Meta-Model Materialization

> Given a `SchemaShape`, materialize the kernel meta-model in the graph:
> class nodes, interface nodes, `instanceOf`, `implements`, `extends` edges.
>
> This is the bridge between "schema as TypeScript const" and
> "schema as graph structure" that the `InstanceModelPass` (spec 07) and
> `ReifyEdgesPass` (spec 06) rely on at query time.
>
> Nothing in this spec changes the compiler or query builder.
> It is purely a graph-write procedure that runs once per schema installation.

---

## 1. Problem

Today the system uses **label stacking** to represent types:

```cypher
CREATE (n:Customer:Identity:Timestamped)
```

The kernel prelude defines a richer meta-model where types are first-class
graph citizens:

```
(:node:class {id, key, type})-[:implements]->(:node:interface {id, key})
(:node)-[:instanceOf]->(:node:class)
```

But nothing currently creates those class/interface nodes or wires the
`implements`/`extends` edges. The bootstrap process (spec 07 §6.2) assumes
they already exist. This spec defines exactly how they get created.

### What needs to happen

1. **For each concrete type** in `schema.nodes` where `abstract: false` — create a `:node:class` node with `type: 'node'`
2. **For each reified edge type** — create a `:node:class` node with `type: 'link'` (same `classes` list, discriminated by `type`)
3. **For each abstract type** in `schema.nodes` where `abstract: true` — create a `:node:interface` node
4. **For each `implements` entry** — create an `implements` edge from class → interface
5. **For each interface that extends another** — create an `extends` edge (inferred from interface inheritance chains)
6. **For every created node** — create a `hasParent` edge to the given `rootId` node
7. **Return a `refs` map** (`key → NodeId`) and an `implementors` map (`interfaceKey → NodeId[]`) for use by `InstanceModelConfig`

---

## 2. Inputs and Outputs

### Input

```typescript
interface BootstrapInput {
  /** The schema to materialize. */
  schema: SchemaShape
  /** Graph instance to write into. */
  graph: Graph<any, any>
  /** Root node under which all bootstrapped nodes are parented. */
  rootId: NodeId
}
```

### Output

```typescript
interface BootstrapResult {
  /**
   * Map of type key → NodeId for every class and interface node created.
   * Directly feeds into InstanceModelConfig.refs.
   *
   * Keys are unique across both node classes and link classes.
   * e.g., { Customer: NodeId('Class_abc'), orderItem: NodeId('Class_def'), Timestamped: NodeId('Interface_xyz') }
   */
  refs: Record<string, NodeId>
  /**
   * Map of interface key → NodeId[] of class nodes that satisfy it (transitively).
   * Directly feeds into InstanceModelConfig.implementors.
   */
  implementors: Record<string, NodeId[]>
  /** Summary stats. */
  stats: {
    classesCreated: number
    interfacesCreated: number
    implementsEdges: number
    extendsEdges: number
    hasParentEdges: number
  }
}
```

This output is exactly what `InstanceModelConfig` needs (spec 07 §2).

---

## 3. Node Identity

### Auto-Generated IDs, Keyed by `key`

Class and interface nodes follow the same ID philosophy as every other node
in the system: **IDs are auto-generated** (UUID-based, e.g., `Class_<uuid>`).
They are never deterministic or hand-crafted.

The `key` property is the **unique lookup key** within the type system.
It's unique across both node classes (`type: 'node'`) and link classes
(`type: 'link'`).

```typescript
// A class node for the "Customer" type:
{
  id: NodeId('Class_9f3a...'),    // auto-generated
  key: 'Customer',                 // unique — used for lookups
  type: 'node',                    // distinguishes node-class from link-class
}

// A class node for the "orderItem" reified edge:
{
  id: NodeId('Class_7b2e...'),    // auto-generated
  key: 'orderItem',                // original casing — same namespace as node classes
  type: 'link',                    // marks this as a link-class
}

// An interface node for "Timestamped":
{
  id: NodeId('Interface_c4d1...'), // auto-generated
  key: 'Timestamped',              // unique within interfaces
}
```

### Idempotency via MERGE on `key`

Since IDs are auto-generated, idempotency is achieved by MERGE on the `key`
property (which has a unique index), not on `id`:

```cypher
MERGE (n:node:class {key: $key})
ON CREATE SET n.id = $newId, n.type = $type
RETURN n
```

If a class with that key already exists, its existing ID is preserved.
If it's new, a fresh ID is generated and assigned.

### The `refs` Map is Runtime-Only

Because IDs are auto-generated, the `refs` map cannot be known at codegen
time. It is populated at bootstrap time by collecting the IDs of created
(or matched) nodes:

```typescript
// After bootstrap:
const refs: Record<string, NodeId> = {
  Customer:    NodeId('Class_9f3a...'),    // from MERGE result
  Product:     NodeId('Class_4e1b...'),
  orderItem:   NodeId('Class_7b2e...'),   // link-class, same namespace
  Timestamped: NodeId('Interface_c4d1...'),
  Identity:    NodeId('Interface_8a7f...'),
}
```

The `implementors` map is then computed from the `refs` map + schema
structure (no graph queries needed — it's a pure function of the schema
topology + the resolved IDs).

---

## 4. Node Model

All type-system nodes are `:node:class` or `:node:interface`. Link classes
are just `:node:class` nodes with `type: 'link'` — there is no separate
label or node kind.

| Concept | Graph Label(s) | Properties | `key` examples |
|---------|---------------|------------|----------------|
| Node class | `:node:class` | `{ id: NodeId, key: string, type: 'node' }` | `Customer`, `Order`, `Product` |
| Link class | `:node:class` | `{ id: NodeId, key: string, type: 'link' }` | `orderItem`, `reviewed` |
| Interface | `:node:interface` | `{ id: NodeId, key: string }` | `Timestamped`, `Identity`, `HasSlug` |

The `key` is unique across **all** class nodes (both `type: 'node'` and
`type: 'link'`). A link class key uses the **original edge type name** as-is
(e.g., `orderItem` stays `orderItem` — no casing normalization).

### Uniqueness Constraint

```cypher
CREATE CONSTRAINT FOR (n:class) REQUIRE n.key IS UNIQUE
CREATE CONSTRAINT FOR (n:interface) REQUIRE n.key IS UNIQUE
```

Or equivalently, unique indexes on `key` for both labels.

---

## 5. Algorithm

### Phase 1: Collect types

Walk `schema.nodes` and `schema.edges` to build a unified `classes` list
(discriminated by `type`) and an `interfaces` list:

```typescript
const classes: { key: string; type: 'node' | 'link'; implements: string[] }[] = []
const interfaces: { key: string; implements: string[] }[] = []

for (const [name, def] of Object.entries(schema.nodes)) {
  if (def.abstract) {
    interfaces.push({ key: name, implements: [...(def.implements ?? [])] })
  } else {
    classes.push({ key: name, type: 'node', implements: [...(def.implements ?? [])] })
  }
}

// Reified edges become link-classes in the same list
for (const [edgeType] of Object.entries(schema.edges)) {
  if (isReified(schema, edgeType)) {
    classes.push({ key: edgeType, type: 'link', implements: [] })
  }
}
```

### Phase 2: Create nodes (idempotent, collect IDs)

All class/interface nodes are created via `MERGE` on `key` to ensure
idempotency. The MERGE returns the node (created or matched), and we
collect the auto-generated IDs.

```typescript
const classResults = await graph.adapter.mutate(BATCH_MERGE_CLASSES, {
  items: classes.map(c => ({
    key: c.key,
    type: c.type,
    newId: generateNodeId(),  // Only used if node is created
  })),
})

const interfaceResults = await graph.adapter.mutate(BATCH_MERGE_INTERFACES, {
  items: interfaces.map(i => ({
    key: i.key,
    newId: generateNodeId(),
  })),
})
```

### Phase 3: Build refs map

```typescript
const refs: Record<string, NodeId> = {}

// From class MERGE results
for (const row of classResults) {
  refs[row.key] = NodeId(row.id)
}

// From interface MERGE results
for (const row of interfaceResults) {
  refs[row.key] = NodeId(row.id)
}
```

### Phase 4: Create structural edges

Edges reference nodes by their `key` (resolved via MATCH), not by ID.
This way the edge creation doesn't depend on knowing IDs upfront.

```typescript
// implements: class → interface (only node-classes have implements)
const implementsEdges: { classKey: string; interfaceKey: string }[] = []
for (const cls of classes) {
  for (const ifaceName of cls.implements) {
    implementsEdges.push({ classKey: cls.key, interfaceKey: ifaceName })
  }
}

// extends: interface → interface
const extendsEdges: { childKey: string; parentKey: string }[] = []
for (const iface of interfaces) {
  for (const parentName of iface.implements) {
    extendsEdges.push({ childKey: iface.key, parentKey: parentName })
  }
}

if (implementsEdges.length > 0) {
  await graph.adapter.mutate(BATCH_MERGE_IMPLEMENTS, { edges: implementsEdges })
}
if (extendsEdges.length > 0) {
  await graph.adapter.mutate(BATCH_MERGE_EXTENDS, { edges: extendsEdges })
}
```

### Phase 5: Create hasParent edges

Every bootstrapped class and interface node gets a `hasParent` edge to
the given `rootId` node.

```typescript
const allKeys = [...classes.map(c => c.key), ...interfaces.map(i => i.key)]
await graph.adapter.mutate(BATCH_MERGE_HAS_PARENT, {
  items: allKeys.map(key => ({ key })),
  rootId,
})
```

### Phase 6: Compute implementors map

The `implementors` map resolves the transitive closure of `extends` so that
queries can use a single `id IN [...]` check instead of graph traversals.

```typescript
function computeImplementors(
  classes: { key: string; implements: string[] }[],
  interfaces: { key: string; implements: string[] }[],
  refs: Record<string, NodeId>,
): Record<string, NodeId[]> {
  // Build extends DAG: interface → parent interfaces (transitive)
  const extendsMap = new Map<string, Set<string>>()
  for (const iface of interfaces) {
    extendsMap.set(iface.key, new Set(iface.implements))
  }

  // Transitively expand extends
  function allAncestors(name: string, visited = new Set<string>()): Set<string> {
    if (visited.has(name)) return new Set()
    visited.add(name)
    const result = new Set<string>([name])
    const parents = extendsMap.get(name)
    if (parents) {
      for (const parent of parents) {
        for (const ancestor of allAncestors(parent, visited)) {
          result.add(ancestor)
        }
      }
    }
    return result
  }

  // For each interface, collect all class NodeIds that satisfy it
  const implementors: Record<string, NodeId[]> = {}

  for (const iface of interfaces) {
    implementors[iface.key] = []
  }

  for (const cls of classes) {
    const classNodeId = refs[cls.key]
    const satisfiedInterfaces = new Set<string>()
    for (const directIface of cls.implements) {
      for (const ancestor of allAncestors(directIface)) {
        satisfiedInterfaces.add(ancestor)
      }
    }

    for (const ifaceKey of satisfiedInterfaces) {
      implementors[ifaceKey] ??= []
      implementors[ifaceKey].push(classNodeId)
    }
  }

  return implementors
}
```

---

## 6. Cypher Patterns

### 6.1 Class Nodes (MERGE on key)

```cypher
UNWIND $items AS cls
MERGE (n:node:class {key: cls.key})
ON CREATE SET n.id = cls.newId, n.type = cls.type
ON MATCH SET n.type = cls.type
RETURN n.key AS key, n.id AS id
```

The `newId` is only applied on CREATE. On MATCH, the existing ID is preserved.
The `type` is always updated (safe — it's derived from the schema).

### 6.2 Interface Nodes (MERGE on key)

```cypher
UNWIND $items AS iface
MERGE (n:node:interface {key: iface.key})
ON CREATE SET n.id = iface.newId
RETURN n.key AS key, n.id AS id
```

### 6.3 Implements Edge (MERGE on matched nodes)

```cypher
UNWIND $edges AS edge
MATCH (c:node:class {key: edge.classKey})
MATCH (i:node:interface {key: edge.interfaceKey})
MERGE (c)-[:implements]->(i)
```

### 6.4 Extends Edge (MERGE on matched nodes)

```cypher
UNWIND $edges AS edge
MATCH (child:node:interface {key: edge.childKey})
MATCH (parent:node:interface {key: edge.parentKey})
MERGE (child)-[:extends]->(parent)
```

### 6.5 HasParent Edge (MERGE on matched nodes)

```cypher
UNWIND $items AS item
MATCH (n {key: item.key}) WHERE n:class OR n:interface
MATCH (root {id: $rootId})
MERGE (n)-[:hasParent]->(root)
```

Every bootstrapped node (class or interface) gets a `hasParent` edge to
the root. This anchors the meta-model nodes in the graph hierarchy.

### Total: 5 queries

Regardless of schema size, bootstrap runs exactly 5 Cypher queries
(classes, interfaces, implements, extends, hasParent). All are idempotent via MERGE.

---

## 7. Integration Points

### 7.1 Where It Runs

Bootstrap runs at **distribution installation** time, before core data seeding.

```
defineDistribution(schema, core, methods)
  ↓
installDistribution(kernel, auth, graph, dist)
  ↓
  1. mergeWithKernelSchema(schema)              ← existing
  2. bootstrapSchema(schema, graph, rootId)     ← NEW — this spec
  3. installCore(graph, core)                   ← existing (now uses instanceOf)
  4. registerOperations(kernel, ops)            ← existing
```

After step 2, the graph contains all class/interface nodes and structural
edges. Step 3 (`installCore`) can then create instance nodes with
`instanceOf` links to their class nodes.

### 7.2 How Core Installation Changes

Currently, `installCore` creates nodes with label stacking:

```cypher
CREATE (n:Customer:Identity:Timestamped {id: $id, ...})
```

After bootstrap, it creates nodes as `:node` instances linked to their class:

```cypher
MATCH (cls:node:class {key: $classKey})
CREATE (n:node {id: $id, ...})
CREATE (n)-[:instanceOf]->(cls)
```

This change is handled by the `InstanceModelPass` on the mutation pipeline
(spec 07), not by this bootstrap spec. But bootstrap must run first to
ensure the class nodes exist.

### 7.3 How createGraph() Wires InstanceModelConfig

Because `refs` requires graph queries (IDs are auto-generated), the wiring
is async — either from bootstrap results or from a startup query:

```typescript
async function createGraph(schema, options) {
  const graph = /* ... adapter setup ... */

  if (schema.instanceModel?.enabled) {
    // Refs come from bootstrap (at install) or from a startup query:
    const refs = await queryRefs(graph)
    const implementors = computeImplementors(schema, refs)

    graph.pipeline.addPass(new InstanceModelPass({ refs, implementors }))
  }

  return graph
}

// Startup query — resolve key → NodeId for all class/interface nodes
async function queryRefs(graph: Graph): Promise<Record<string, NodeId>> {
  const classes = await graph.adapter.query(
    `MATCH (c:node:class) RETURN c.key AS key, c.id AS id`
  )
  const interfaces = await graph.adapter.query(
    `MATCH (i:node:interface) RETURN i.key AS key, i.id AS id`
  )

  const refs: Record<string, NodeId> = {}
  for (const row of [...classes, ...interfaces]) {
    refs[row.key] = NodeId(row.id)
  }
  return refs
}
```

Alternatively, if the graph was just bootstrapped in the same process,
the `BootstrapResult.refs` can be passed directly — no extra query needed.

### 7.4 Relationship to Kernel Bootstrap

The kernel's own bootstrap (`bootstrapKernel` in `kernel/boot/`) creates
a single self-referential `type` node (`__SYSTEM__`). Schema bootstrap is
**separate** — it creates the application-level meta-model.

```
Kernel boot:
  1. createSystemType(__SYSTEM__)        ← kernel's own type node
  2. createSystemIdentity(...)           ← system identity
  3. grantSystemAccess(...)              ← permissions

Distribution install:
  4. bootstrapSchema(schema, graph)      ← THIS SPEC — app meta-model
  5. installCore(graph, core)            ← genesis data
  6. registerOperations(kernel, ops)     ← methods
```

The kernel bootstrap and schema bootstrap are orthogonal. The kernel
doesn't need to know about `Customer` or `Product` types — those belong
to the distribution.

---

## 8. Codegen Integration

Codegen can statically compute **what to create** but not the resulting
IDs. It emits the bootstrap manifest — the runtime executes it and
collects the auto-generated IDs.

### 8.1 Generated Artifacts

Add to `schema.generated.ts`:

```typescript
// ─── Schema Meta-Model ──────────────────────────────────────

/** Bootstrap manifest — what class/interface nodes to create. */
export const schemaBootstrap = {
  classes: [
    // node-classes (concrete types)
    { key: 'Customer', type: 'node' as const },
    { key: 'Product', type: 'node' as const },
    { key: 'Category', type: 'node' as const },
    { key: 'Order', type: 'node' as const },
    { key: 'Review', type: 'node' as const },
    // link-classes (reified edges) — same list, discriminated by type
    { key: 'orderItem', type: 'link' as const },
    { key: 'reviewed', type: 'link' as const },
  ],
  interfaces: [
    { key: 'Timestamped' },
    { key: 'HasSlug' },
    { key: 'Priceable' },
    { key: 'Identity' },
  ],
  implements: [
    { classKey: 'Customer', interfaceKey: 'Identity' },
    { classKey: 'Customer', interfaceKey: 'Timestamped' },
    { classKey: 'Product', interfaceKey: 'Timestamped' },
    { classKey: 'Product', interfaceKey: 'HasSlug' },
    { classKey: 'Product', interfaceKey: 'Priceable' },
    { classKey: 'Category', interfaceKey: 'HasSlug' },
    { classKey: 'Order', interfaceKey: 'Timestamped' },
    { classKey: 'Review', interfaceKey: 'Timestamped' },
  ],
  extends: [],  // No interface inheritance in e-commerce schema
} as const
```

No `schemaRefs` or `schemaImplementors` at codegen time — those are
runtime artifacts.

### 8.2 What's Static vs Dynamic

| Data | Static (codegen) | Dynamic (runtime) |
|------|------------------|-------------------|
| Bootstrap manifest | Yes — keys, types, implements | — |
| `refs` (key → NodeId) | No | Yes — from MERGE results or startup query |
| `implementors` (key → NodeId[]) | No | Yes — computed from refs + schema topology |
| Node existence | — | Yes — MERGE writes at install time |

---

## 9. bootstrapSchema() Function

```typescript
import type { SchemaShape } from './schema'
import type { Graph } from './graph'
import { isReified } from './helpers'
import { NodeId } from './types'

export interface BootstrapOptions {
  /** Callback per node created/matched. */
  onNode?: (kind: 'class' | 'interface', key: string, id: NodeId) => void
  /** Callback per edge created. */
  onEdge?: (type: 'implements' | 'extends' | 'hasParent', fromKey: string, toKey: string) => void
}

export async function bootstrapSchema(
  schema: SchemaShape,
  graph: Graph<any, any>,
  rootId: NodeId,
  options?: BootstrapOptions,
): Promise<BootstrapResult> {

  // ── Phase 1: Collect types ─────────────────────────────────
  const classes: { key: string; type: 'node' | 'link'; implements: string[] }[] = []
  const interfaces: { key: string; implements: string[] }[] = []

  for (const [name, def] of Object.entries(schema.nodes)) {
    if (def.abstract) {
      interfaces.push({ key: name, implements: [...(def.implements ?? [])] })
    } else {
      classes.push({ key: name, type: 'node', implements: [...(def.implements ?? [])] })
    }
  }

  // Reified edges become link-classes in the same list
  for (const [edgeType] of Object.entries(schema.edges)) {
    if (isReified(schema, edgeType)) {
      classes.push({ key: edgeType, type: 'link', implements: [] })
    }
  }

  // ── Phase 2: MERGE nodes, collect IDs ──────────────────────
  const classResults = await graph.adapter.mutate(BATCH_MERGE_CLASSES, {
    items: classes.map(c => ({
      key: c.key,
      type: c.type,
      newId: generateNodeId(),
    })),
  })

  const interfaceResults = await graph.adapter.mutate(BATCH_MERGE_INTERFACES, {
    items: interfaces.map(i => ({
      key: i.key,
      newId: generateNodeId(),
    })),
  })

  // ── Phase 3: Build refs map ────────────────────────────────
  const refs: Record<string, NodeId> = {}

  for (const row of classResults) {
    const nodeId = NodeId(row.id)
    refs[row.key] = nodeId
    options?.onNode?.('class', row.key, nodeId)
  }

  for (const row of interfaceResults) {
    const nodeId = NodeId(row.id)
    refs[row.key] = nodeId
    options?.onNode?.('interface', row.key, nodeId)
  }

  // ── Phase 4: Create structural edges ───────────────────────
  const implementsEdges: { classKey: string; interfaceKey: string }[] = []
  const extendsEdges: { childKey: string; parentKey: string }[] = []

  for (const cls of classes) {
    for (const ifaceName of cls.implements) {
      implementsEdges.push({ classKey: cls.key, interfaceKey: ifaceName })
    }
  }

  for (const iface of interfaces) {
    for (const parentName of iface.implements) {
      extendsEdges.push({ childKey: iface.key, parentKey: parentName })
    }
  }

  if (implementsEdges.length > 0) {
    await graph.adapter.mutate(BATCH_MERGE_IMPLEMENTS, { edges: implementsEdges })
    for (const e of implementsEdges) {
      options?.onEdge?.('implements', e.classKey, e.interfaceKey)
    }
  }
  if (extendsEdges.length > 0) {
    await graph.adapter.mutate(BATCH_MERGE_EXTENDS, { edges: extendsEdges })
    for (const e of extendsEdges) {
      options?.onEdge?.('extends', e.childKey, e.parentKey)
    }
  }

  // ── Phase 5: Create hasParent edges ────────────────────────
  const allKeys = [...classes.map(c => c.key), ...interfaces.map(i => i.key)]
  await graph.adapter.mutate(BATCH_MERGE_HAS_PARENT, {
    items: allKeys.map(key => ({ key })),
    rootId,
  })
  for (const key of allKeys) {
    options?.onEdge?.('hasParent', key, String(rootId))
  }

  // ── Phase 6: Compute implementors ─────────────────────────
  const implementors = computeImplementors(classes, interfaces, refs)

  return {
    refs,
    implementors,
    stats: {
      classesCreated: classes.length,
      interfacesCreated: interfaces.length,
      implementsEdges: implementsEdges.length,
      extendsEdges: extendsEdges.length,
      hasParentEdges: allKeys.length,
    },
  }
}

// ── Batch Cypher Constants ──────────────────────────────────

const BATCH_MERGE_CLASSES = `
UNWIND $items AS cls
MERGE (n:node:class {key: cls.key})
ON CREATE SET n.id = cls.newId, n.type = cls.type
ON MATCH SET n.type = cls.type
RETURN n.key AS key, n.id AS id
`

const BATCH_MERGE_INTERFACES = `
UNWIND $items AS iface
MERGE (n:node:interface {key: iface.key})
ON CREATE SET n.id = iface.newId
RETURN n.key AS key, n.id AS id
`

const BATCH_MERGE_IMPLEMENTS = `
UNWIND $edges AS edge
MATCH (c:node:class {key: edge.classKey})
MATCH (i:node:interface {key: edge.interfaceKey})
MERGE (c)-[:implements]->(i)
`

const BATCH_MERGE_EXTENDS = `
UNWIND $edges AS edge
MATCH (child:node:interface {key: edge.childKey})
MATCH (parent:node:interface {key: edge.parentKey})
MERGE (child)-[:extends]->(parent)
`

const BATCH_MERGE_HAS_PARENT = `
UNWIND $items AS item
MATCH (n {key: item.key}) WHERE n:class OR n:interface
MATCH (root {id: $rootId})
MERGE (n)-[:hasParent]->(root)
`
```

---

## 10. E-Commerce Example — Before and After

### Before (label stacking)

```
graph.mutate.create('Customer', { email: 'alice@shop.com', name: 'Alice' })
```

Compiles to:
```cypher
CREATE (n:Customer:Identity:Timestamped {id: $id})
SET n = $props, n.id = $id
RETURN n
```

Graph state:
```
(:Customer:Identity:Timestamped {id: 'Customer_abc', email: 'alice@shop.com'})
```

Query `graph.node('Customer')`:
```cypher
MATCH (n0:Customer:Identity:Timestamped)
RETURN n0
```

### After (instance model)

Bootstrap creates (once, IDs auto-generated):
```
(:node:class {id: 'Class_9f3a...', key: 'Customer', type: 'node'})
(:node:interface {id: 'Interface_c4d1...', key: 'Identity'})
(:node:interface {id: 'Interface_8a7f...', key: 'Timestamped'})
(Customer class)-[:implements]->(Identity interface)
(Customer class)-[:implements]->(Timestamped interface)
(Customer class)-[:hasParent]->(root)
(Identity interface)-[:hasParent]->(root)
(Timestamped interface)-[:hasParent]->(root)
```

Then `graph.mutate.create('Customer', ...)` compiles to (via InstanceModelPass):
```cypher
MATCH (cls:node:class {key: $classKey})
CREATE (n:node {id: $id})
SET n = $props, n.id = $id
CREATE (n)-[:instanceOf]->(cls)
RETURN n
```

Query `graph.node('Customer')` (via InstanceModelPass):
```cypher
MATCH (n0:node)-[:instanceOf]->(cls0:node:class {id: $p0})
RETURN n0
-- $p0 = refs['Customer'] (the auto-generated NodeId)
```

Query `graph.node('Timestamped')` (polymorphic, via InstanceModelPass):
```cypher
MATCH (n0:node)-[:instanceOf]->(cls0:node:class)
WHERE cls0.id IN $p0
RETURN n0
-- $p0 = implementors['Timestamped'] (NodeIds of Customer, Product, Order, Review classes)
```

---

## 11. Reified Edges — Link Class Nodes

When an edge is reified (spec 06), its link nodes also need `instanceOf`
links. The bootstrap creates link class nodes for this purpose.

Link classes are just `:node:class` nodes with `type: 'link'`. The `key`
is the **original edge type name** (no casing normalization) and occupies
the **same unique namespace** as node classes. This means the edge type
name must not collide with a node type name.

### Example: `orderItem` (reified)

Bootstrap creates:
```
(:node:class {id: 'Class_7b2e...', key: 'orderItem', type: 'link'})
(orderItem class)-[:hasParent]->(root)
```

When `graph.mutate.link('orderItem', orderId, productId, { quantity: 1 })`:

**Before (reify only):**
```cypher
MATCH (a:Order {id: $from}), (b:Product {id: $to})
CREATE (link:OrderItem {id: $linkId, quantity: $qty})
CREATE (a)-[:hasLink]->(link)
CREATE (link)-[:linksTo]->(b)
```

**After (reify + instance model):**
```cypher
MATCH (a:node {id: $from}), (b:node {id: $to})
MATCH (cls:node:class {key: $classKey})
CREATE (link:node {id: $linkId, quantity: $qty})
CREATE (link)-[:instanceOf]->(cls)
CREATE (a)-[:hasLink]->(link)
CREATE (link)-[:linksTo]->(b)
```

The `link` node is a `:node` with `instanceOf → orderItem class`, not
a bare `:OrderItem` label.

---

## 12. Kernel Structural Edges — Excluded from Instance Model

The following edges are structural (kernel prelude) and are **never**
reified or subject to instance model transformation:

| Edge | Purpose | Why exempt |
|------|---------|------------|
| `instanceOf` | Node → class membership | **IS** the instance model |
| `implements` | Class → interface | Meta-model structural |
| `extends` | Interface → interface | Meta-model structural |
| `hasParent` | Node → parent node | Hierarchy structural |
| `hasLink` | Node → link node | Reification structural |
| `linksTo` | Link → target node | Reification structural |
| `hasPerm` | Identity → node permission | Authorization |
| `excludedFrom` | Identity algebra | Authorization |
| `constrainedBy` | Identity algebra | Authorization |
| `extendsWith` | Identity algebra | Authorization |

These edges exist in the kernel schema but not in `schema.edges` (user schema).
The passes skip them because they only operate on edges listed in `schema.edges`.

---

## 13. Validation & Error Handling

### Pre-bootstrap Validation

```typescript
function validateSchema(schema: SchemaShape): ValidationError[] {
  const errors: ValidationError[] = []

  // 1. All implements targets must exist and be abstract
  for (const [name, def] of Object.entries(schema.nodes)) {
    for (const ifaceName of def.implements ?? []) {
      const target = schema.nodes[ifaceName]
      if (!target) {
        errors.push({ type: 'missing_interface', node: name, interface: ifaceName })
      } else if (!target.abstract) {
        errors.push({ type: 'implements_non_interface', node: name, target: ifaceName })
      }
    }
  }

  // 2. No circular extends (interfaces extending each other in a cycle)
  for (const [name, def] of Object.entries(schema.nodes)) {
    if (!def.abstract) continue
    if (hasCycle(name, schema)) {
      errors.push({ type: 'circular_extends', interface: name })
    }
  }

  // 3. Link class keys must not collide with node class keys
  for (const [edgeType] of Object.entries(schema.edges)) {
    if (isReified(schema, edgeType)) {
      const existingNode = schema.nodes[edgeType]
      if (existingNode && !existingNode.abstract) {
        errors.push({ type: 'link_key_collision', edge: edgeType, key: edgeType })
      }
    }
  }

  return errors
}
```

### Runtime Errors

| Error | Cause | Recovery |
|-------|-------|----------|
| `Interface not found` | `implements` references non-existent type | Fail fast with clear error |
| `Circular extends` | Interface inheritance cycle | Fail fast at validation |
| `Link key collision` | Edge type name collides with a node type key | Fail fast at validation |
| `MERGE returned no rows` | Unexpected adapter issue | Fail with diagnostic info |

---

## 14. Migration & Schema Evolution

When a schema evolves (new types, removed types, changed implements):

### Add Type
- Bootstrap MERGE creates new class/interface node with auto-generated ID
- `refs` and `implementors` maps gain new entries
- Existing data unaffected

### Remove Type
- Bootstrap doesn't delete — old class/interface nodes remain
- A separate migration step can clean them up
- Queries won't match them (not in `implementors` or `refs`)

### Change Implements
- Bootstrap MERGE re-creates `implements` edges (idempotent)
- Old `implements` edges to removed interfaces remain — harmless
- `implementors` map recomputed from current schema

### Rename Type
- New class node created (new key), old one remains
- Existing instance nodes still `instanceOf` old class
- Migration required: update `instanceOf` edges on existing data

---

## 15. Pipeline Summary

```
KRL source
  ↓ compile()
SchemaIR
  ↓ generate()
schema.generated.ts
  ├─ schema: SchemaShape
  └─ schemaBootstrap: { classes, interfaces, implements, extends }

At install time:
  ↓ bootstrapSchema(schema, graph, rootId)
  ├─ MERGE :node:class nodes (type: 'node' + 'link')  → collect NodeIds
  ├─ MERGE :node:interface nodes                        → collect NodeIds
  ├─ MERGE :implements edges (class → interface)
  ├─ MERGE :extends edges (interface → interface)
  ├─ MERGE :hasParent edges (all nodes → rootId)
  └─ Return { refs: Record<key, NodeId>, implementors: Record<key, NodeId[]> }

  ↓ installCore(graph, core)
  ├─ :node instances with :instanceOf → :node:class (by key → NodeId)
  └─ :node link instances with :instanceOf → :node:class (type: 'link')

At query time (using refs + implementors from bootstrap):
  ↓ InstanceModelPass (spec 07)
  AST labels → instanceOf joins (cls.id = refs[key] or cls.id IN implementors[key])
  ↓ ReifyEdgesPass (spec 06)
  Typed edge traversals → hasLink/linksTo patterns
  ↓ CypherCompiler
  Standard Cypher (no label stacking, no type labels)
```

---

## 16. Summary

| Aspect | Approach |
|--------|----------|
| **What** | Create class/interface nodes + structural edges from `SchemaShape` |
| **When** | At distribution install, before core data seeding |
| **IDs** | Auto-generated (`NodeId`), never deterministic |
| **Lookup** | By `key` property (unique index on `:class` and `:interface`) |
| **Idempotent** | MERGE on `key` — safe to re-run, preserves existing IDs |
| **Output** | `refs: Record<key, NodeId>` + `implementors: Record<key, NodeId[]>` |
| **Codegen** | Emits bootstrap manifest (keys, types, implements); IDs are runtime |
| **Root** | Every bootstrapped node gets a `hasParent` edge to `rootId` |
| **Batch** | 5 Cypher queries total (classes, interfaces, implements, extends, hasParent) |
| **Link classes** | `:node:class` with `type: 'link'`, same `key` namespace as node classes |
| **Key casing** | Original casing preserved (no normalization): `orderItem` stays `orderItem` |
| **Structural edges** | `instanceOf`, `implements`, `extends`, `hasParent` exempt from reification |
| **Validation** | Pre-flight checks for missing interfaces, cycles, key collisions |
| **Migration** | Additive by default; removals require explicit cleanup |
