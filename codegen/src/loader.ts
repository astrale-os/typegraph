import type {
  SchemaIR,
  ClassDef,
  NodeDef,
  EdgeDef,
  IRAttribute,
  ValueConstraints,
  GraphModel,
  ResolvedAlias,
  ResolvedNode,
  ResolvedEdge,
  MethodDef,
} from './model'

// ─── Public API ─────────────────────────────────────────────

export interface LoadOptions {
  /** Throw on conflicting definitions across multiple schemas. Default: true. */
  strict?: boolean
}

/**
 * Build a `GraphModel` from one or more `SchemaIR` inputs.
 *
 * Handles deduplication (identical definitions are merged silently)
 * and conflict detection (same name, different shape → error).
 * Resolves node inheritance to produce flattened `allAttributes`.
 */
export function load(inputs: SchemaIR[], options?: LoadOptions): GraphModel {
  const strict = options?.strict ?? true

  const model: GraphModel = {
    scalars: [],
    aliases: new Map(),
    valueTypes: new Map(),
    taggedUnions: new Map(),
    dataTypes: new Map(),
    nodeDefs: new Map(),
    edgeDefs: new Map(),
    extensions: [],
  }

  const scalarSet = new Set<string>()

  for (const ir of inputs) {
    for (const s of ir.builtin_scalars) scalarSet.add(s)

    for (const ext of ir.extensions) {
      model.extensions.push({ uri: ext.uri, importedTypes: ext.imported_types })
    }

    for (const alias of ir.type_aliases) {
      const existing = model.aliases.get(alias.name)
      if (existing) {
        if (structurallyEqualAlias(existing, alias)) continue
        if (strict) throw new ConflictError('type alias', alias.name)
        continue
      }
      const enumValues = alias.constraints?.enum_values ?? null
      model.aliases.set(alias.name, {
        name: alias.name,
        underlyingType: alias.underlying_type,
        constraints: alias.constraints,
        isEnum: enumValues !== null && enumValues.length > 0,
        enumValues,
      })
    }

    for (const vt of ir.value_types ?? []) {
      const existing = model.valueTypes.get(vt.name)
      if (existing) {
        if (JSON.stringify(existing.fields) === JSON.stringify(vt.fields)) continue
        if (strict) throw new ConflictError('value type', vt.name)
        continue
      }
      model.valueTypes.set(vt.name, {
        name: vt.name,
        fields: vt.fields,
      })
    }

    for (const tu of ir.tagged_unions ?? []) {
      const existing = model.taggedUnions.get(tu.name)
      if (existing) {
        if (JSON.stringify(existing.variants) === JSON.stringify(tu.variants)) continue
        if (strict) throw new ConflictError('tagged union', tu.name)
        continue
      }
      model.taggedUnions.set(tu.name, {
        name: tu.name,
        variants: tu.variants,
      })
    }

    for (const dt of ir.data_types ?? []) {
      const existing = model.dataTypes.get(dt.name)
      if (existing) {
        if (JSON.stringify(existing) === JSON.stringify({ name: dt.name, fields: dt.fields, scalarType: dt.scalar_type })) continue
        if (strict) throw new ConflictError('data type', dt.name)
        continue
      }
      model.dataTypes.set(dt.name, {
        name: dt.name,
        fields: dt.fields,
        scalarType: dt.scalar_type,
      })
    }

    for (const cls of ir.classes) {
      if (cls.type === 'node') registerNode(model, cls, strict)
      else registerEdge(model, cls, strict)
    }
  }

  model.scalars = [...scalarSet]

  resolveInheritance(model)
  createImportStubs(model)

  return model
}

/**
 * Normalize a raw JSON value into a canonical `SchemaIR`.
 *
 * Accepts either:
 * - Canonical format: `{ classes: [...] }`
 * - Legacy format: `{ nodes: [...], edges: [...] }`
 */
export function normalizeIR(raw: Record<string, unknown>): SchemaIR {
  if ('classes' in raw && Array.isArray(raw.classes)) return raw as unknown as SchemaIR

  // Legacy format: separate nodes/edges arrays without `type` discriminator
  const classes: ClassDef[] = []
  if ('nodes' in raw && Array.isArray(raw.nodes)) {
    for (const n of raw.nodes as Record<string, unknown>[]) {
      classes.push({ ...n, type: 'node' as const } as ClassDef)
    }
  }
  if ('edges' in raw && Array.isArray(raw.edges)) {
    for (const e of raw.edges as Record<string, unknown>[]) {
      classes.push({ ...e, type: 'edge' as const } as ClassDef)
    }
  }

  return {
    version: (raw.version as '1.0') ?? '1.0',
    meta: (raw.meta as SchemaIR['meta']) ?? { generated_at: '', source_hash: '' },
    extensions: (raw.extensions as SchemaIR['extensions']) ?? [],
    builtin_scalars: (raw.builtin_scalars as string[]) ?? [],
    type_aliases: (raw.type_aliases as SchemaIR['type_aliases']) ?? [],
    value_types: (raw.value_types as SchemaIR['value_types']) ?? [],
    tagged_unions: (raw.tagged_unions as SchemaIR['tagged_unions']) ?? [],
    data_types: (raw.data_types as SchemaIR['data_types']) ?? [],
    classes,
  }
}

// ─── Registration ───────────────────────────────────────────

function registerNode(model: GraphModel, node: NodeDef, strict: boolean): void {
  const existing = model.nodeDefs.get(node.name)
  if (existing) {
    if (structurallyEqualNode(existing, node)) return
    if (strict) throw new ConflictError('node', node.name)
    return
  }
  model.nodeDefs.set(node.name, {
    name: node.name,
    abstract: node.abstract,
    implements: node.implements ?? [],
    ownAttributes: node.attributes,
    allAttributes: [], // populated by resolveInheritance
    ownMethods: node.methods ?? [],
    allMethods: [], // populated by resolveInheritance
    dataRef: node.data_ref,
  })
}

function registerEdge(model: GraphModel, edge: EdgeDef, strict: boolean): void {
  const existing = model.edgeDefs.get(edge.name)
  if (existing) {
    if (structurallyEqualEdge(existing, edge)) return
    if (strict) throw new ConflictError('edge', edge.name)
    return
  }
  model.edgeDefs.set(edge.name, {
    name: edge.name,
    endpoints: edge.endpoints,
    ownAttributes: edge.attributes,
    allAttributes: [], // edges don't inherit; set to ownAttributes below
    ownMethods: edge.methods ?? [],
    allMethods: [], // edges don't inherit; set to ownMethods below
    constraints: edge.constraints,
    dataRef: edge.data_ref,
  })
}

// ─── Inheritance Resolution ─────────────────────────────────

function resolveInheritance(model: GraphModel): void {
  const resolved = new Set<string>()
  for (const [name] of model.nodeDefs) {
    resolveNodeInheritance(model, name, resolved, new Set())
  }
  for (const [, edge] of model.edgeDefs) {
    edge.allAttributes = [...edge.ownAttributes]
    edge.allMethods = [...edge.ownMethods]
  }
}

function resolveNodeInheritance(
  model: GraphModel,
  name: string,
  resolved: Set<string>,
  visiting: Set<string>,
): { attributes: IRAttribute[]; methods: MethodDef[] } {
  if (resolved.has(name)) {
    const node = model.nodeDefs.get(name)!
    return { attributes: node.allAttributes, methods: node.allMethods }
  }

  const node = model.nodeDefs.get(name)
  if (!node) return { attributes: [], methods: [] } // imported/external

  if (visiting.has(name)) {
    throw new Error(`Circular inheritance detected: ${name}`)
  }
  visiting.add(name)

  // Collect inherited attributes (parent-first, later parents override earlier)
  const mergedAttrs = new Map<string, IRAttribute>()
  const mergedMethods = new Map<string, MethodDef>()

  for (const parentName of node.implements) {
    const parent = resolveNodeInheritance(model, parentName, resolved, visiting)
    for (const attr of parent.attributes) {
      mergedAttrs.set(attr.name, attr)
    }
    for (const method of parent.methods) {
      mergedMethods.set(method.name, method)
    }
  }

  // Own attributes/methods override inherited
  for (const attr of node.ownAttributes) {
    mergedAttrs.set(attr.name, attr)
  }
  for (const method of node.ownMethods) {
    mergedMethods.set(method.name, method)
  }

  node.allAttributes = [...mergedAttrs.values()]
  node.allMethods = [...mergedMethods.values()]
  resolved.add(name)
  visiting.delete(name)

  return { attributes: node.allAttributes, methods: node.allMethods }
}

// ─── Import Stubs ───────────────────────────────────────────

function createImportStubs(model: GraphModel): void {
  for (const [, node] of model.nodeDefs) {
    for (const parent of node.implements) {
      if (!model.nodeDefs.has(parent)) {
        model.nodeDefs.set(parent, {
          name: parent,
          abstract: true,
          implements: [],
          ownAttributes: [],
          allAttributes: [],
          ownMethods: [],
          allMethods: [],
        })
      }
    }
  }
}

// ─── Structural Equality ────────────────────────────────────

function structurallyEqualAlias(
  a: ResolvedAlias,
  b: { name: string; underlying_type: string; constraints: ValueConstraints | null },
): boolean {
  return (
    a.name === b.name &&
    a.underlyingType === b.underlying_type &&
    JSON.stringify(a.constraints) === JSON.stringify(b.constraints)
  )
}

function structurallyEqualNode(a: ResolvedNode, b: NodeDef): boolean {
  return (
    a.name === b.name &&
    a.abstract === b.abstract &&
    a.dataRef === b.data_ref &&
    JSON.stringify(a.implements) === JSON.stringify(b.implements ?? []) &&
    JSON.stringify(a.ownAttributes) === JSON.stringify(b.attributes) &&
    JSON.stringify(a.ownMethods) === JSON.stringify(b.methods ?? [])
  )
}

function structurallyEqualEdge(a: ResolvedEdge, b: EdgeDef): boolean {
  return (
    a.name === b.name &&
    a.dataRef === b.data_ref &&
    JSON.stringify(a.endpoints) === JSON.stringify(b.endpoints) &&
    JSON.stringify(a.ownAttributes) === JSON.stringify(b.attributes) &&
    JSON.stringify(a.constraints) === JSON.stringify(b.constraints) &&
    JSON.stringify(a.ownMethods) === JSON.stringify(b.methods ?? [])
  )
}

// ─── Errors ─────────────────────────────────────────────────

export class ConflictError extends Error {
  constructor(kind: string, name: string) {
    super(
      `Conflicting ${kind} definition: '${name}' is defined in multiple schemas with different shapes`,
    )
    this.name = 'ConflictError'
  }
}
