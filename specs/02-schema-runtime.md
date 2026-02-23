# Spec 02: Schema Runtime

> Installation, constraint enforcement, validation, and method wiring.
> Internal to `@astrale/typegraph-client` — not exposed to developers.
> Clean-slate — no backward compat, fail fast on mismatch.

---

## 1. createGraph Orchestration

```typescript
async function createGraph(config): Promise<Graph> {
  // 1. Connect
  const conn = await config.adapter.connect()

  // 2. Install schema (create/verify meta-nodes, indexes, constraints)
  const schemaRefs = await installSchema(conn, config.schema)

  // 3. Install core (create genesis instances, return refs)
  const coreRefs = await installCore(conn, config.core, schemaRefs, config.validators)

  // 4. Validate method implementations (fail fast if any missing)
  validateMethodImplementations(config.schema, config.methods)

  // 5. Build and return the graph client
  return buildGraph(conn, config, { core: coreRefs, schema: schemaRefs })
}
```

Strict behavior:
- Schema mismatch → `SchemaMismatchError` (fail, don't reconcile)
- Missing method implementation → `MethodNotImplementedError` (fail at startup)
- Core instance conflict → error (no silent merge)

---

## 2. Schema Installation

`installSchema(conn, schema)` materializes the graph's type system into the database.

**What it does:**
- Creates `__Type` meta-nodes for each node and edge type (storing name, attributes, methods, constraints, endpoints)
- Ensures database-level indexes and unique constraints
- Returns `SchemaRefs` — maps type name → meta-node ID

**On subsequent runs:** detects existing schema, computes diff, applies additive changes, rejects breaking changes with `SchemaMismatchError`. Developer resolves via the migration system.

Schema diffing, migration planning, and data transformation are specified in [04-migration.md](./04-migration.md).

---

## 3. Core Installation

`installCore(conn, core, schemaRefs, validators)` creates genesis graph instances from the `defineCore()` definition.

**What it does:**
- Flattens nested core node tree
- Creates nodes in topological order (parents before children), validated via Zod
- Links each node to its `__Type` meta-node (`instance_of`) and parent (`has_parent`)
- Creates core edges with constraint enforcement
- Returns `CoreRefs` — maps key → node ID

**Idempotent:** repeated `createGraph` calls match existing core nodes by `(type, key)` — reuse if same props, update if different, create if missing. Core edges matched by `(type, from, to)`.

Installation internals (meta-node structure, flattening, topological ordering) will be detailed during implementation.

---

## 4. Constraint Enforcement

Every `graph.link()` call runs constraints before the edge is created.

### 4.1 Enforcement Pipeline

```typescript
async function enforceConstraints(
  conn: Connection,
  edgeType: string,
  endpoints: ResolvedEndpoints,
  schema: SchemaValue,
): Promise<void> {
  const c = schema.edges[edgeType].constraints ?? {}

  // no_self: reject same node on both sides
  if (c.no_self && endpoints.from === endpoints.to) {
    throw new ConstraintViolation(edgeType, 'no_self',
      'Cannot connect a node to itself')
  }

  // unique: reject duplicate (type, from, to) tuple
  if (c.unique) {
    if (await conn.edgeExists(edgeType, endpoints.from, endpoints.to)) {
      throw new ConstraintViolation(edgeType, 'unique',
        'Edge already exists between these nodes')
    }
  }

  // acyclic: reject if creating edge would form a cycle
  if (c.acyclic) {
    if (await conn.isReachable(endpoints.to, endpoints.from, edgeType)) {
      throw new ConstraintViolation(edgeType, 'acyclic',
        'Edge would create a cycle')
    }
  }

  // cardinality: check per-endpoint participation limits
  for (const [param, epDef] of Object.entries(schema.edges[edgeType].endpoints)) {
    if (epDef.cardinality?.max !== undefined && epDef.cardinality.max !== null) {
      const nodeId = endpoints.mapping[param]
      const side = param === Object.keys(schema.edges[edgeType].endpoints)[0] ? 'from' : 'to'
      const count = await conn.countEdges(edgeType, nodeId, side)
      if (count >= epDef.cardinality.max) {
        throw new ConstraintViolation(edgeType, 'cardinality',
          `Endpoint '${param}' exceeds max cardinality ${epDef.cardinality.max}`)
      }
    }
  }
}
```

### 4.2 Symmetric Edges

```typescript
async function createEdge(
  conn: Connection,
  edgeType: string,
  endpoints: ResolvedEndpoints,
  props: Record<string, unknown> | undefined,
  schema: SchemaValue,
): Promise<void> {
  await enforceConstraints(conn, edgeType, endpoints, schema)
  await conn.createEdge(edgeType, endpoints.from, endpoints.to, props)

  if (schema.edges[edgeType].constraints?.symmetric && endpoints.from !== endpoints.to) {
    await conn.createEdge(edgeType, endpoints.to, endpoints.from, props)
  }
}
```

### 4.3 Lifecycle Actions (on_kill)

On `graph.delete(type, id)`:

```typescript
async function deleteWithLifecycle(
  conn: Connection,
  id: string,
  schema: SchemaValue,
): Promise<void> {
  const connectedEdges = await findConnectedEdges(conn, id)

  for (const edge of connectedEdges) {
    const c = schema.edges[edge.type].constraints ?? {}

    if (edge.role === 'source' && c.on_kill_source === 'cascade') {
      await conn.deleteEdge(edge.type, edge.from, edge.to)
      await deleteWithLifecycle(conn, edge.to, schema)
    } else if (edge.role === 'target' && c.on_kill_target === 'cascade') {
      await conn.deleteEdge(edge.type, edge.from, edge.to)
      await deleteWithLifecycle(conn, edge.from, schema)
    } else {
      // Default: detach (delete edge only)
      await conn.deleteEdge(edge.type, edge.from, edge.to)
    }
  }

  await conn.deleteNode(id)
}
```

---

## 5. Validation Bridge

### 5.1 Create

```typescript
async function validateAndCreate(
  conn: Connection,
  type: string,
  input: unknown,
  validators: ValidatorMap,
): Promise<RawNode> {
  const validated = validators[type].parse(input)
  return conn.createNode(type, validated)
}
```

Zod `.parse()` applies defaults (e.g., `created_at: now()`) and validates all fields. Throws `ValidationError` on failure.

### 5.2 Update

```typescript
async function validateAndUpdate(
  conn: Connection,
  type: string,
  id: string,
  input: unknown,
  validators: ValidatorMap,
): Promise<void> {
  const partialSchema = validators[type].partial()
  const validated = partialSchema.parse(input)
  await conn.updateNode(id, validated)
}
```

### 5.3 Edge Payload

```typescript
async function validateEdgePayload(
  edgeType: string,
  payload: unknown,
  validators: ValidatorMap,
): Promise<Record<string, unknown> | undefined> {
  if (!payload) return undefined
  const name = pascalCase(edgeType)  // 'order_item' → 'OrderItem'
  const validator = validators[name]
  if (!validator) return payload as Record<string, unknown>
  return validator.parse(payload)
}
```

---

## 6. Method Wiring

### 6.1 Validation at Startup

```typescript
function validateMethodImplementations(
  schema: SchemaValue,
  methods: MethodsConfig | undefined,
): void {
  const errors: string[] = []

  // Validate node methods
  for (const [typeName, typeDef] of Object.entries(schema.nodes)) {
    if (typeDef.abstract) continue  // interfaces don't need implementations

    // Collect all required methods: own + inherited from interfaces
    const required = collectRequiredMethods(schema, typeName)

    for (const [methodName, source] of required) {
      if (!methods?.[typeName]?.[methodName]) {
        errors.push(
          source === typeName
            ? `${typeName}.${methodName}()`
            : `${typeName}.${methodName}() (inherited from ${source})`
        )
      }
    }
  }

  // Validate edge methods
  for (const [edgeName, edgeDef] of Object.entries(schema.edges)) {
    const edgeMethods = Object.keys(schema.methods?.[edgeName] ?? {})
    for (const methodName of edgeMethods) {
      if (!methods?.[edgeName]?.[methodName]) {
        errors.push(`${edgeName}.${methodName}()`)
      }
    }
  }

  if (errors.length > 0) {
    throw new MethodNotImplementedError(errors)
  }
}
```

### 6.2 Collecting Required Methods

Returns a `Map<methodName, sourceName>` — tracks where each method was declared.

```typescript
function collectRequiredMethods(
  schema: SchemaValue,
  typeName: string,
): Map<string, string> {
  const result = new Map<string, string>()

  // Own methods
  for (const name of Object.keys(schema.methods?.[typeName] ?? {})) {
    result.set(name, typeName)
  }

  // Inherited methods (walk the implements chain)
  const impl = schema.nodes[typeName]?.implements ?? []
  for (const iface of impl) {
    // Direct methods on the interface
    for (const name of Object.keys(schema.methods?.[iface] ?? {})) {
      if (!result.has(name)) result.set(name, iface)
    }
    // KRL interfaces can extend other interfaces (class Bar: Foo)
    // Recurse to collect their methods too
    const inherited = collectRequiredMethods(schema, iface)
    for (const [name, source] of inherited) {
      if (!result.has(name)) result.set(name, source)
    }
  }

  return result
}
```

**Interface inheritance**: KRL interfaces can extend other interfaces (`interface Bar: Foo { ... }`). The `implements` field captures the full chain. `collectRequiredMethods` recursively walks it, so a class implementing `Bar` also inherits methods from `Foo`.

### 6.3 Node Enrichment

Every node returned from any SDK operation (query, get, create) is enriched with `id`, `__type`, and method proxies:

```typescript
function enrichNode(
  type: string,
  raw: RawNode,
  methods: MethodsConfig,
  graph: Graph,
): EnrichedNode {
  const handlers = methods?.[type] ?? {}

  return new Proxy({ ...raw.props, id: raw.id, __type: type }, {
    get(target, prop) {
      if (typeof prop === 'string' && handlers[prop]) {
        return (args?: unknown) => handlers[prop]({
          self: target,
          args: args ?? undefined,
          graph,
        })
      }
      return (target as any)[prop]
    },
  })
}
```

For types with no methods (e.g., `Category`), `handlers` is `{}` and the proxy just passes through attribute access.

### 6.4 Edge Enrichment

Edges with methods are enriched similarly — `self` includes the payload and endpoint IDs:

```typescript
function enrichEdge(
  edgeType: string,
  raw: RawEdge,
  methods: MethodsConfig,
  graph: Graph,
): EnrichedEdge {
  const handlers = methods?.[edgeType] ?? {}

  return new Proxy({
    ...raw.props,
    endpoints: { [raw.fromParam]: raw.from, [raw.toParam]: raw.to },
  }, {
    get(target, prop) {
      if (typeof prop === 'string' && handlers[prop]) {
        return (args?: unknown) => handlers[prop]({
          self: target,
          args: args ?? undefined,
          graph,
        })
      }
      return (target as any)[prop]
    },
  })
}
```

For edges with no methods, `enrichEdge` is skipped — raw payload returned as-is.

### 6.5 Method Invocation via graph.call()

Direct call without loading the full node into memory first:

```typescript
async function callMethod(
  conn: Connection,
  type: string,
  id: string,
  method: string,
  args: unknown,
  methods: MethodsConfig,
  graph: Graph,
  schema: SchemaValue,
): Promise<unknown> {
  const handler = methods?.[type]?.[method]
  if (!handler) throw new MethodNotImplementedError([`${type}.${method}()`])

  // Load the node
  const raw = await conn.getNodeTyped(type, id)
  if (!raw) throw new NotFoundError(type, id)

  // Validate method args against schema
  const methodDef = schema.methods?.[type]?.[method]
  if (methodDef?.params && args) {
    validateMethodArgs(methodDef.params, args)
  }

  return handler({ self: { ...raw.props, id: raw.id }, args: args ?? undefined, graph })
}

function validateMethodArgs(
  paramDefs: Record<string, { type: string; default?: unknown }>,
  args: unknown,
): void {
  if (typeof args !== 'object' || args === null) return
  // Apply defaults for missing params
  for (const [name, def] of Object.entries(paramDefs)) {
    if ((args as any)[name] === undefined && def.default !== undefined) {
      (args as any)[name] = def.default
    }
  }
}
```

### 6.6 Edge Method Invocation via graph.callEdge()

```typescript
async function callEdgeMethod(
  conn: Connection,
  edgeType: string,
  endpoints: Record<string, string>,
  method: string,
  args: unknown,
  methods: MethodsConfig,
  graph: Graph,
  schema: SchemaValue,
): Promise<unknown> {
  const handler = methods?.[edgeType]?.[method]
  if (!handler) throw new MethodNotImplementedError([`${edgeType}.${method}()`])

  // Load the edge by endpoints
  const resolved = resolveEdgeEndpoints(edgeType, endpoints, schema)
  const raw = await conn.getEdge(edgeType, resolved.from, resolved.to)
  if (!raw) throw new NotFoundError(edgeType, `${resolved.from}->${resolved.to}`)

  // Validate method args
  const methodDef = schema.methods?.[edgeType]?.[method]
  if (methodDef?.params && args) {
    validateMethodArgs(methodDef.params, args)
  }

  return handler({
    self: { ...raw.props, endpoints },
    args: args ?? undefined,
    graph,
  })
}
```

---

## 7. Endpoint Resolution

### 7.1 For link/unlink

```typescript
function resolveEdgeEndpoints(
  edgeType: string,
  endpointValues: Record<string, string>,
  schema: SchemaValue,
): ResolvedEndpoints {
  const epDef = schema.edges[edgeType].endpoints
  const paramNames = Object.keys(epDef)

  // Validate all params provided
  for (const p of paramNames) {
    if (!endpointValues[p]) {
      throw new Error(`Missing endpoint '${p}' for edge '${edgeType}'`)
    }
  }

  // Edge endpoints are ordered by KRL declaration order
  // First endpoint = from side, second = to side
  const [fromParam, toParam] = paramNames
  return {
    from: endpointValues[fromParam],
    to: endpointValues[toParam],
    mapping: endpointValues,
  }
}
```

### 7.2 For Traversal Direction Inference

```typescript
function inferTraversalDirection(
  schema: SchemaValue,
  edgeType: string,
  currentType: string,
): { fromEndpoint: string, toEndpoint: string } | 'ambiguous' {
  const endpoints = schema.edges[edgeType].endpoints
  const entries = Object.entries(endpoints)
  const matching: string[] = []

  for (const [param, epDef] of entries) {
    // Check if currentType (or any interface it implements) is in the endpoint's types
    const nodeImpl = schema.nodes[currentType]?.implements ?? []
    const allTypes = [currentType, ...nodeImpl]
    if (epDef.types.some(t => allTypes.includes(t))) {
      matching.push(param)
    }
  }

  if (matching.length === 0) {
    throw new Error(`Type '${currentType}' is not an endpoint of edge '${edgeType}'`)
  }
  if (matching.length > 1) {
    return 'ambiguous'
  }

  const fromEndpoint = matching[0]
  const toEndpoint = entries.find(([p]) => p !== fromEndpoint)![0]
  return { fromEndpoint, toEndpoint }
}
```

---

## 8. Supporting Types

```typescript
// Schema diff result
interface SchemaDiff {
  hasBreaking: boolean
  additions: SchemaAddition[]
  breaking: SchemaBreaking[]
}

type SchemaAddition =
  | { kind: 'new_type'; name: string; def: NodeDef | EdgeDef }
  | { kind: 'new_attribute'; type: string; attribute: string }
  | { kind: 'new_method'; type: string; method: string }

type SchemaBreaking =
  | { kind: 'removed_type'; name: string }
  | { kind: 'removed_attribute'; type: string; attribute: string }
  | { kind: 'removed_method'; type: string; method: string }
  | { kind: 'changed_attribute_type'; type: string; attribute: string; was: string; now: string }
  | { kind: 'added_constraint'; edge: string; constraint: string }

// Validator map
type ValidatorMap = Record<string, ZodSchema>

// Resolved endpoints (from endpoint params to from/to IDs)
interface ResolvedEndpoints {
  from: string
  to: string
  mapping: Record<string, string>  // param name → node ID
}

// Raw types from adapter
interface RawNode {
  id: string
  type: string
  props: Record<string, unknown>
}

interface RawEdge {
  type: string
  from: string
  to: string
  fromParam: string   // KRL endpoint param name (e.g., 'order')
  toParam: string     // KRL endpoint param name (e.g., 'product')
  props?: Record<string, unknown>
}

// MethodsConfig (matches codegen output — see 03-krl-methods.md §3.3)
// Includes both node types and edge types with methods
type MethodsConfig = Record<string, Record<string, (ctx: any) => any>>
// Keys are type names (e.g., 'Customer', 'Order', 'order_item')
// Node handlers receive MethodContext, edge handlers receive EdgeMethodContext
```

---

## 9. Architecture Diagram

```
┌───────────────────────────────────────────────────────────────┐
│  createGraph({ core, adapter, methods })                      │
├───────────────────────────────────────────────────────────────┤
│  1. adapter.connect()                                         │
│  2. installSchema(conn, schema)                               │
│     → create __Type meta-nodes                                │
│     → ensure indexes + constraints                            │
│     → returns SchemaRefs                                      │
│  3. installCore(conn, core, schemaRefs, validators)           │
│     → flatten node tree                                       │
│     → create nodes (topological order, validated)             │
│     → link instance_of, has_parent                            │
│     → create edges (with constraint enforcement)              │
│     → returns CoreRefs                                        │
│  4. validateMethodImplementations(schema, methods)            │
│     → check every concrete class has all required handlers    │
│     → check every edge with methods has handlers              │
│     → fail fast with MethodNotImplementedError                │
│  5. buildGraph(conn, config, refs)                            │
│     → wire validators into mutation pipeline                  │
│     → wire constraints into link/unlink pipeline              │
│     → wire lifecycle actions into delete pipeline             │
│     → wire method handlers into node + edge enrichment layer  │
│     → returns Graph                                           │
└───────────────────────────────────────────────────────────────┘
```

---

## 10. Summary

| Aspect | Approach |
|--------|----------|
| **Entry point** | `createGraph(config)` — connect, install, validate, build |
| **Schema install** | `__Type` meta-nodes in graph; indexes + constraints in database |
| **Schema mismatch** | Fail with `SchemaMismatchError` — resolve via migration system ([04-migration.md](./04-migration.md)) |
| **Core install** | Flatten → create → link; idempotent for repeated runs |
| **Constraints** | Pre-mutation: `no_self`, `unique`, `acyclic`, `cardinality` |
| **Symmetric** | Auto-create mirror edge |
| **Lifecycle** | `on_kill_source`/`on_kill_target` → recursive cascade |
| **Validation** | Zod validators on create/update/link; method args validated |
| **Methods** | Validated at startup (nodes + edges) → bound via Proxy on enriched nodes and edges |
| **Refs** | `{ core: { key → id }, schema: { type → meta-id } }` |
