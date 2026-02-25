import type {
  Schema,
  NodeDef,
  Ref,
  CoreDef,
  SeedDef,
  CoreInstance,
  CoreLink,
  RefsFromInstances,
} from './types.js'
import { SchemaValidationError } from './types.js'

// ── Builders ────────────────────────────────────────────────────────────────

export function node<N extends NodeDef<any>>(
  def: N,
  data: Record<string, unknown>,
): CoreInstance<N> {
  return { __kind: 'core-instance', __nodeDef: def, __data: data }
}

export function edge(
  from: CoreInstance | Ref,
  edgeName: string,
  to: CoreInstance | Ref,
  data?: Record<string, unknown>,
): CoreLink {
  return { __kind: 'core-link', __from: from, __to: to, __edge: edgeName, __data: data }
}

// ── Kernel references ───────────────────────────────────────────────────────

export const kernelRefs = {
  root: { __ref: true, __def: null, __id: '__kernel:root' } as Ref,
  system: { __ref: true, __def: null, __id: '__kernel:system' } as Ref,
}

// ── Internal helpers ────────────────────────────────────────────────────────

let refCounter = 0

function resolveTarget(target: CoreInstance | Ref, instanceToRef: Map<CoreInstance, Ref>): Ref {
  if ('__kind' in target) {
    const resolved = instanceToRef.get(target as CoreInstance)
    if (!resolved) throw new Error('CoreInstance not found in this core/seed definition')
    return resolved
  }
  return target as Ref
}

// ── defineCore ──────────────────────────────────────────────────────────────

export function defineCore<
  S extends Schema,
  const N extends string,
  const Nodes extends Record<string, CoreInstance>,
>(
  schema: S,
  namespace: N,
  config: { nodes: Nodes; links?: readonly CoreLink[] },
): CoreDef<S, N, RefsFromInstances<Nodes>> {
  const operations: Array<{ type: 'create' | 'link'; args: unknown[] }> = []
  const instanceToRef = new Map<CoreInstance, Ref>()

  for (const [, instance] of Object.entries(config.nodes)) {
    const id = `${namespace}:__ref_${++refCounter}`
    const r: Ref = { __ref: true, __def: instance.__nodeDef, __id: id } as Ref
    instanceToRef.set(instance, r)
    operations.push({ type: 'create', args: [instance.__nodeDef, instance.__data, r] })
  }

  if (config.links) {
    for (const lnk of config.links) {
      if (!(lnk.__edge in schema.edges)) {
        throw new SchemaValidationError(
          `Edge '${lnk.__edge}' does not exist in schema. Available: ${Object.keys(schema.edges).join(', ')}`,
          'edges',
          Object.keys(schema.edges).join(', '),
          lnk.__edge,
        )
      }
      const from = resolveTarget(lnk.__from, instanceToRef)
      const to = resolveTarget(lnk.__to, instanceToRef)
      operations.push({ type: 'link', args: [from, lnk.__edge, to, lnk.__data] })
    }
  }

  const refs: Record<string, Ref> = {}
  for (const [name, instance] of Object.entries(config.nodes)) {
    refs[name] = instanceToRef.get(instance)!
  }

  return { schema, namespace, refs, __operations: operations } as unknown as CoreDef<
    S,
    N,
    RefsFromInstances<Nodes>
  >
}

// ── defineSeed ──────────────────────────────────────────────────────────────

export function defineSeed<
  S extends Schema,
  C extends CoreDef<S>,
  const Nodes extends Record<string, CoreInstance>,
>(
  schema: S,
  core: C,
  config: { nodes: Nodes; links?: readonly CoreLink[] },
): SeedDef<S, C, RefsFromInstances<Nodes>> {
  const operations: Array<{ type: 'create' | 'link'; args: unknown[] }> = []
  const namespace = core.namespace
  const instanceToRef = new Map<CoreInstance, Ref>()

  for (const [, instance] of Object.entries(config.nodes)) {
    const id = `${namespace}:__seed_${++refCounter}`
    const r: Ref = { __ref: true, __def: instance.__nodeDef, __id: id } as Ref
    instanceToRef.set(instance, r)
    operations.push({ type: 'create', args: [instance.__nodeDef, instance.__data, r] })
  }

  if (config.links) {
    for (const lnk of config.links) {
      if (!(lnk.__edge in schema.edges)) {
        throw new SchemaValidationError(
          `Edge '${lnk.__edge}' does not exist in schema. Available: ${Object.keys(schema.edges).join(', ')}`,
          'edges',
          Object.keys(schema.edges).join(', '),
          lnk.__edge,
        )
      }
      const from = resolveTarget(lnk.__from, instanceToRef)
      const to = resolveTarget(lnk.__to, instanceToRef)
      operations.push({ type: 'link', args: [from, lnk.__edge, to, lnk.__data] })
    }
  }

  const refs: Record<string, Ref> = {}
  for (const [name, instance] of Object.entries(config.nodes)) {
    refs[name] = instanceToRef.get(instance)!
  }

  return { schema, core, refs, __operations: operations } as unknown as SeedDef<
    S,
    C,
    RefsFromInstances<Nodes>
  >
}
