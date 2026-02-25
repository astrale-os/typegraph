import type {
  IfaceDef,
  NodeDef,
  EdgeDef,
  OpDef,
  EndpointCfg,
  Cardinality,
  IndexDef,
  Schema,
  MethodsImpl,
} from './types.js'
import { SchemaValidationError } from './types.js'

// ── Internal helpers ────────────────────────────────────────────────────────

function collectAvailableProps(def: IfaceDef | NodeDef): Set<string> {
  const props = new Set<string>()
  const cfg = def.config as Record<string, unknown>
  if (cfg.props && typeof cfg.props === 'object') {
    for (const k of Object.keys(cfg.props as object)) props.add(k)
  }
  if (def.__kind === 'iface') {
    const exts = (cfg as any).extends as IfaceDef[] | undefined
    if (exts) for (const parent of exts) for (const p of collectAvailableProps(parent)) props.add(p)
  } else {
    const impls = (cfg as any).implements as IfaceDef[] | undefined
    if (impls) for (const i of impls) for (const p of collectAvailableProps(i)) props.add(p)
    const ext = (cfg as any).extends as NodeDef | undefined
    if (ext) for (const p of collectAvailableProps(ext)) props.add(p)
  }
  return props
}

function extractRefTargets(schema: unknown): object[] {
  if (schema === null || typeof schema !== 'object') return []
  const targets: object[] = []
  const s = schema as Record<string, unknown>
  if ('__ref_target' in s) targets.push(s.__ref_target as object)
  const inner =
    (s as any).element ??
    (s as any).innerType ??
    (s as any)._def?.innerType ??
    (s as any)._def?.type
  if (inner && typeof inner === 'object') targets.push(...extractRefTargets(inner))
  return targets
}

// ── defineSchema ────────────────────────────────────────────────────────────

export function defineSchema<const D extends Record<string, any>>(defs: D): Schema<D> {
  const ifaces: Record<string, IfaceDef> = {}
  const nodes: Record<string, NodeDef> = {}
  const edges: Record<string, EdgeDef> = {}
  const operations: Record<string, OpDef> = {}

  // 1. Auto-categorise by __kind, silently ignore non-defs
  for (const [name, def] of Object.entries(defs)) {
    if (def === null || typeof def !== 'object' || !('__kind' in def)) continue
    switch ((def as { __kind: string }).__kind) {
      case 'iface':
        ifaces[name] = def as IfaceDef
        break
      case 'node':
        nodes[name] = def as NodeDef
        break
      case 'edge':
        edges[name] = def as EdgeDef
        break
      case 'op':
        operations[name] = def as OpDef
        break
    }
  }

  // 2. Unique names across categories
  const allNames = new Set<string>()
  for (const name of [
    ...Object.keys(ifaces),
    ...Object.keys(nodes),
    ...Object.keys(edges),
    ...Object.keys(operations),
  ]) {
    if (allNames.has(name)) {
      throw new SchemaValidationError(
        `Duplicate definition name '${name}'`,
        'defs',
        'unique names',
        name,
      )
    }
    allNames.add(name)
  }

  // 3. Resolve config thunks on ifaces and nodes
  for (const [name, def] of [...Object.entries(ifaces), ...Object.entries(nodes)] as [
    string,
    any,
  ][]) {
    if (def.__configThunk && typeof def.__configThunk === 'function') {
      try {
        def.config = def.__configThunk()
        delete def.__configThunk
      } catch (e) {
        throw new SchemaValidationError(
          `Failed to resolve config thunk for '${name}': ${String(e)}`,
          name,
          'resolvable config thunk',
          'unresolvable',
        )
      }
    }
  }

  // 4. Edge endpoint resolution + cardinality validation
  const allDefValues = new Set<object>([...Object.values(ifaces), ...Object.values(nodes)])
  const validCardinalities: Cardinality[] = ['0..1', '1', '0..*', '1..*']

  for (const [edgeName, edgeDef] of Object.entries(edges)) {
    for (const endpoint of [edgeDef.from, edgeDef.to] as EndpointCfg[]) {
      for (const type of endpoint.types) {
        if (!allDefValues.has(type as object)) {
          throw new SchemaValidationError(
            `Edge '${edgeName}' references an unknown type in endpoint '${endpoint.as}'`,
            `edges.${edgeName}.${endpoint.as}`,
            'a def in this schema',
            'unknown reference',
          )
        }
      }
      if (
        endpoint.cardinality !== undefined &&
        !validCardinalities.includes(endpoint.cardinality)
      ) {
        throw new SchemaValidationError(
          `Invalid cardinality '${String(endpoint.cardinality)}' on edge '${edgeName}' endpoint '${endpoint.as}'`,
          `edges.${edgeName}.${endpoint.as}.cardinality`,
          validCardinalities.join(', '),
          String(endpoint.cardinality),
        )
      }
    }
  }

  // 5. Eagerly resolve method param thunks
  const resolveThunks = (
    defName: string,
    def: { config?: { methods?: Record<string, OpDef> } },
  ) => {
    const methods = def.config?.methods
    if (!methods) return
    for (const [methodName, methodDef] of Object.entries(methods)) {
      if (typeof methodDef.config.params === 'function') {
        try {
          const resolved = (methodDef.config.params as () => Record<string, unknown>)()
          ;(methodDef.config as any).params = resolved
        } catch (e) {
          throw new SchemaValidationError(
            `Failed to resolve param thunk for '${defName}.${methodName}': ${String(e)}`,
            `${defName}.${methodName}.params`,
            'resolvable thunk',
            'unresolvable',
          )
        }
      }
    }
  }

  for (const [name, def] of Object.entries(ifaces)) resolveThunks(name, def)
  for (const [name, def] of Object.entries(nodes)) resolveThunks(name, def)
  for (const [name, def] of Object.entries(edges)) resolveThunks(name, def)

  // 5b. Resolve top-level operation param thunks
  for (const [opName, opDef] of Object.entries(operations)) {
    if (typeof opDef.config.params === 'function') {
      try {
        const resolved = (opDef.config.params as () => Record<string, unknown>)()
        ;(opDef.config as any).params = resolved
      } catch (e) {
        throw new SchemaValidationError(
          `Failed to resolve param thunk for operation '${opName}': ${String(e)}`,
          `${opName}.params`,
          'resolvable thunk',
          'unresolvable',
        )
      }
    }
  }

  // 6. Index property validation
  for (const [name, def] of [...Object.entries(ifaces), ...Object.entries(nodes)] as [
    string,
    IfaceDef | NodeDef,
  ][]) {
    const indexes = (def.config as any).indexes as IndexDef[] | undefined
    if (!indexes) continue
    const available = collectAvailableProps(def)
    for (const idx of indexes) {
      const prop = typeof idx === 'string' ? idx : idx.property
      if (!available.has(prop)) {
        throw new SchemaValidationError(
          `Index on '${name}' references unknown property '${prop}'`,
          `${name}.indexes`,
          [...available].join(', ') || '(no props)',
          prop,
        )
      }
    }
  }

  // 7. Validate method param/return refs point to schema defs
  const validateMethodRefs = (defName: string, methods: Record<string, OpDef> | undefined) => {
    if (!methods) return
    for (const [methodName, methodDef] of Object.entries(methods)) {
      const params = methodDef.config.params
      if (params && typeof params === 'object' && typeof params !== 'function') {
        for (const [paramName, paramSchema] of Object.entries(params as Record<string, unknown>)) {
          for (const target of extractRefTargets(paramSchema)) {
            if (!allDefValues.has(target)) {
              throw new SchemaValidationError(
                `Method '${defName}.${methodName}' param '${paramName}' references a def not in this schema`,
                `${defName}.${methodName}.params.${paramName}`,
                'a def in this schema',
                'unknown reference',
              )
            }
          }
        }
      }
      for (const target of extractRefTargets(methodDef.config.returns)) {
        if (!allDefValues.has(target)) {
          throw new SchemaValidationError(
            `Method '${defName}.${methodName}' return type references a def not in this schema`,
            `${defName}.${methodName}.returns`,
            'a def in this schema',
            'unknown reference',
          )
        }
      }
    }
  }

  for (const [name, def] of Object.entries(ifaces))
    validateMethodRefs(name, (def.config as any).methods)
  for (const [name, def] of Object.entries(nodes))
    validateMethodRefs(name, (def.config as any).methods)
  for (const [name, def] of Object.entries(edges))
    validateMethodRefs(name, (def.config as any).methods)

  // 7b. Validate top-level operation refs
  for (const [opName, opDef] of Object.entries(operations)) {
    const params = opDef.config.params
    if (params && typeof params === 'object' && typeof params !== 'function') {
      for (const [paramName, paramSchema] of Object.entries(params as Record<string, unknown>)) {
        for (const target of extractRefTargets(paramSchema)) {
          if (!allDefValues.has(target)) {
            throw new SchemaValidationError(
              `Operation '${opName}' param '${paramName}' references a def not in this schema`,
              `${opName}.params.${paramName}`,
              'a def in this schema',
              'unknown reference',
            )
          }
        }
      }
    }
    for (const target of extractRefTargets(opDef.config.returns)) {
      if (!allDefValues.has(target)) {
        throw new SchemaValidationError(
          `Operation '${opName}' return type references a def not in this schema`,
          `${opName}.returns`,
          'a def in this schema',
          'unknown reference',
        )
      }
    }
  }

  return { defs, ifaces, nodes, edges, operations } as unknown as Schema<D>
}

// ── defineMethods ───────────────────────────────────────────────────────────

function extractMethodNames(def: { config?: { methods?: Record<string, unknown> } }): string[] {
  const methods = def.config?.methods
  if (methods && typeof methods === 'object') {
    return Object.keys(methods)
  }
  return []
}

export function defineMethods<S extends Schema>(
  schema: S,
  methods: MethodsImpl<S>,
): MethodsImpl<S> {
  // Runtime completeness check
  const defsWithMethods: [string, any][] = [
    ...Object.entries(schema.nodes),
    ...Object.entries(schema.edges),
  ]

  for (const [name, def] of defsWithMethods) {
    const declared = extractMethodNames(def)
    if (declared.length === 0) continue

    const impl = (methods as Record<string, Record<string, unknown>>)[name]
    if (!impl) {
      throw new SchemaValidationError(
        `Missing method implementations for '${name}'. Expected: ${declared.join(', ')}`,
        `methods.${name}`,
        declared.join(', '),
        'undefined',
      )
    }

    const missing = declared.filter((m) => typeof impl[m] !== 'function')
    if (missing.length > 0) {
      throw new SchemaValidationError(
        `'${name}' is missing methods: ${missing.join(', ')}`,
        `methods.${name}`,
        declared.join(', '),
        Object.keys(impl).join(', '),
      )
    }
  }

  return methods
}
