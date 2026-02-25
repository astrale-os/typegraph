import type {
  IfaceDef,
  NodeDef,
  EdgeDef,
  OpDef,
  EndpointCfg,
  Cardinality,
  IndexDef,
  Schema,
} from './types.js'
import { SchemaValidationError } from './types.js'
import { registerDef, hasDefName } from './registry.js'

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

export function defineSchema<const D extends Record<string, any>>(
  domain: string,
  defs: D,
): Schema<D> {
  const ifaces: Record<string, IfaceDef> = {}
  const nodes: Record<string, NodeDef> = {}
  const edges: Record<string, EdgeDef> = {}
  const operations: Record<string, OpDef> = {}

  // 1. Auto-categorise by __kind, register names, silently ignore non-defs
  for (const [name, def] of Object.entries(defs)) {
    if (def === null || typeof def !== 'object' || !('__kind' in def)) continue
    registerDef(def as object, domain, name)
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

  // 4. Validate implements/extends references
  const allDefValues = new Set<object>([...Object.values(ifaces), ...Object.values(nodes)])

  const isKnownDef = (target: object): boolean => allDefValues.has(target) || hasDefName(target)

  for (const [name, def] of Object.entries(ifaces)) {
    const exts = (def.config as any).extends as IfaceDef[] | undefined
    if (exts) {
      for (const parent of exts) {
        if (!isKnownDef(parent)) {
          throw new SchemaValidationError(
            `Interface '${name}' extends an unknown type`,
            `${name}.extends`,
            'a def in this schema or registered in another schema',
            'unknown reference',
          )
        }
      }
    }
  }

  for (const [name, def] of Object.entries(nodes)) {
    const config = def.config as Record<string, any>
    if (config.extends && !isKnownDef(config.extends)) {
      throw new SchemaValidationError(
        `Node '${name}' extends an unknown type`,
        `${name}.extends`,
        'a def in this schema or registered in another schema',
        'unknown reference',
      )
    }
    const impls = config.implements as IfaceDef[] | undefined
    if (impls) {
      for (const iface of impls) {
        if (!isKnownDef(iface)) {
          throw new SchemaValidationError(
            `Node '${name}' implements an unknown type`,
            `${name}.implements`,
            'a def in this schema or registered in another schema',
            'unknown reference',
          )
        }
      }
    }
  }

  // 5. Edge endpoint resolution + cardinality validation
  const validCardinalities: Cardinality[] = ['0..1', '1', '0..*', '1..*']

  for (const [edgeName, edgeDef] of Object.entries(edges)) {
    for (const endpoint of [edgeDef.from, edgeDef.to] as EndpointCfg[]) {
      for (const type of endpoint.types) {
        if (!isKnownDef(type as object)) {
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

  // 6. Eagerly resolve param thunks (methods + top-level operations)
  const resolveParamThunk = (path: string, opDef: OpDef) => {
    if (typeof opDef.config.params === 'function') {
      try {
        ;(opDef.config as any).params = (opDef.config.params as () => Record<string, unknown>)()
      } catch (e) {
        throw new SchemaValidationError(
          `Failed to resolve param thunk for '${path}': ${String(e)}`,
          `${path}.params`,
          'resolvable thunk',
          'unresolvable',
        )
      }
    }
  }

  for (const [name, def] of [
    ...Object.entries(ifaces),
    ...Object.entries(nodes),
    ...Object.entries(edges),
  ] as [string, IfaceDef | NodeDef | EdgeDef][]) {
    const methods = (def.config as any)?.methods as Record<string, OpDef> | undefined
    if (methods) {
      for (const [methodName, methodDef] of Object.entries(methods)) {
        resolveParamThunk(`${name}.${methodName}`, methodDef)
      }
    }
  }
  for (const [opName, opDef] of Object.entries(operations)) {
    resolveParamThunk(opName, opDef)
  }

  // 7. Index property validation
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

  // 8. Validate ref targets in method params/returns and top-level operations
  const validateOpRefs = (path: string, opDef: OpDef) => {
    const params = opDef.config.params
    if (params && typeof params === 'object' && typeof params !== 'function') {
      for (const [paramName, paramSchema] of Object.entries(params as Record<string, unknown>)) {
        for (const target of extractRefTargets(paramSchema)) {
          if (!isKnownDef(target)) {
            throw new SchemaValidationError(
              `'${path}' param '${paramName}' references an unknown def`,
              `${path}.params.${paramName}`,
              'a def in this schema or registered in another schema',
              'unknown reference',
            )
          }
        }
      }
    }
    for (const target of extractRefTargets(opDef.config.returns)) {
      if (!isKnownDef(target)) {
        throw new SchemaValidationError(
          `'${path}' return type references an unknown def`,
          `${path}.returns`,
          'a def in this schema or registered in another schema',
          'unknown reference',
        )
      }
    }
  }

  for (const [name, def] of [
    ...Object.entries(ifaces),
    ...Object.entries(nodes),
    ...Object.entries(edges),
  ] as [string, IfaceDef | NodeDef | EdgeDef][]) {
    const methods = (def.config as any)?.methods as Record<string, OpDef> | undefined
    if (methods) {
      for (const [methodName, methodDef] of Object.entries(methods)) {
        validateOpRefs(`${name}.${methodName}`, methodDef)
      }
    }
  }
  for (const [opName, opDef] of Object.entries(operations)) {
    validateOpRefs(opName, opDef)
  }

  return { domain, defs, ifaces, nodes, edges, operations } as unknown as Schema<D>
}
